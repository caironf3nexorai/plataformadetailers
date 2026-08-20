-- Migration 0014: Entrada Avulsa com Múltiplos Serviços e Combos

create or replace function public.entrada_avulsa(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_observacoes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_duracao integer;
  v_modo text;
  v_dias integer;
  v_preco numeric(10,2);
  v_ordem smallint := 0;
  v_duracao_total integer := 0;
  v_preco_total numeric(10,2) := 0.00;
  v_modo_mais_restritivo text := 'horario_especifico';
  v_dias_mais_restritivo integer := 1;
  v_primeiro_servico uuid := null;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Usuário não autenticado.';
  end if;

  -- Obter tenant do cliente
  select cl.tenant_id into v_tenant
  from public.clientes cl
  where cl.id = p_cliente;

  if v_tenant is null then
    raise exception 'Cliente não encontrado.';
  end if;

  if not public.tem_papel(v_tenant, array['dono', 'gerente', 'operador']::app_role[]) then
    raise exception 'Acesso negado. Usuário não é membro ativo desta oficina.';
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para a entrada avulsa.';
  end if;

  -- 1. Cria agendamento com status 'confirmado' e origem 'balcao'
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    categoria_id,
    inicio,
    status,
    origem,
    observacoes,
    criado_por,
    duracao_total,
    duracao_minutos,
    preco_estimado_total,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados
  ) values (
    v_tenant,
    p_cliente,
    p_veiculo,
    p_categoria,
    now(),
    'confirmado',
    'balcao',
    p_observacoes,
    v_user,
    0,
    0,
    0.00,
    0.00,
    'horario_especifico',
    1
  ) returning id into v_agendamento_id;

  -- 2. Processa os itens informados (serviços ou combos)
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_ordem := v_ordem + 1;
    v_servico_id := (v_item->>'servico_id')::uuid;
    v_combo_id   := (v_item->>'combo_id')::uuid;

    if v_servico_id is not null then
      select
        coalesce(sp.duracao_minutos, s.duracao_minutos, 60),
        coalesce(sp.preco, s.preco_base, 0.00),
        coalesce(s.modo_ocupacao, 'horario_especifico'),
        coalesce(s.dias_ocupados, 1)
      into v_duracao, v_preco, v_modo, v_dias
      from public.servicos s
      left join public.servico_precos sp on sp.servico_id = s.id and sp.categoria_id = p_categoria
      where s.id = v_servico_id and s.tenant_id = v_tenant;

      if v_primeiro_servico is null then
        v_primeiro_servico := v_servico_id;
      end if;

      insert into public.agendamento_itens (
        agendamento_id, servico_id, combo_id, categoria_id,
        duracao_minutos, preco_aplicado, preco_estimado, ordem
      ) values (
        v_agendamento_id, v_servico_id, null, p_categoria,
        v_duracao, v_preco, v_preco, v_ordem
      );

      v_duracao_total := v_duracao_total + v_duracao;
      v_preco_total := v_preco_total + v_preco;

      if v_modo = 'multiplos_dias' then
        v_modo_mais_restritivo := 'multiplos_dias';
        if v_dias > v_dias_mais_restritivo then
          v_dias_mais_restritivo := v_dias;
        end if;
      elsif v_modo = 'dia_inteiro' and v_modo_mais_restritivo <> 'multiplos_dias' then
        v_modo_mais_restritivo := 'dia_inteiro';
      end if;

    elsif v_combo_id is not null then
      select
        coalesce(cp.duracao_minutos, c.duracao_minutos, 60),
        coalesce(cp.preco, c.preco_base, 0.00)
      into v_duracao, v_preco
      from public.combos c
      left join public.combo_precos cp on cp.combo_id = c.id and cp.categoria_id = p_categoria
      where c.id = v_combo_id and c.tenant_id = v_tenant;

      insert into public.agendamento_itens (
        agendamento_id, servico_id, combo_id, categoria_id,
        duracao_minutos, preco_aplicado, preco_estimado, ordem
      ) values (
        v_agendamento_id, null, v_combo_id, p_categoria,
        v_duracao, v_preco, v_preco, v_ordem
      );

      v_duracao_total := v_duracao_total + v_duracao;
      v_preco_total := v_preco_total + v_preco;
    end if;
  end loop;

  -- 3. Atualiza totais e primeiro servico no agendamento
  update public.agendamentos
  set servico_id = v_primeiro_servico,
      duracao_total = v_duracao_total,
      duracao_minutos = v_duracao_total,
      preco_estimado_total = v_preco_total,
      preco_estimado = v_preco_total,
      modo_ocupacao = v_modo_mais_restritivo,
      dias_ocupados = case when v_modo_mais_restritivo = 'multiplos_dias' then v_dias_mais_restritivo else 1 end
  where id = v_agendamento_id;

  return v_agendamento_id;
end;
$$;

grant execute on function public.entrada_avulsa(uuid, uuid, jsonb, uuid, text) to authenticated;
