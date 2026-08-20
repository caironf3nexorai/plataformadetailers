-- Migration 0035: Alteração de Orçamento e Re-assinatura Digital pelo Cliente
-- Permite que a oficina solicite a confirmação/assinatura digital do cliente após edições no orçamento.

-- 1. ADICIONA COLUNAS DE ALTERAÇÃO E ASSINATURA NA TABELA ORÇAMENTOS
alter table public.orcamentos
  add column if not exists alteracao_pendente boolean not null default false,
  add column if not exists alteracao_historico jsonb default '[]'::jsonb,
  add column if not exists assinatura_path text,
  add column if not exists assinatura_data timestamptz,
  add column if not exists assinatura_nome text;

-- 2. RPC RESPONDER_ORCAMENTO ATUALIZADA (Permite trocar de nível se não houver agendamento)
create or replace function public.responder_orcamento(
  p_token uuid,
  p_nivel text,
  p_aceite boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
begin
  select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  -- Valida se expirou
  if v_orcamento.status in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
    if (v_orcamento.enviado_em::date + v_orcamento.validade_dias) < current_date then
      update public.orcamentos set status = 'expirado', updated_at = now() where id = v_orcamento.id;
      raise exception 'Este orçamento está expirado e não aceita mais respostas.';
    end if;
  end if;

  if v_orcamento.status = 'expirado' then
    raise exception 'Este orçamento está expirado e não aceita mais respostas.';
  end if;

  -- Se o agendamento já foi finalizado, bloqueia alteração direta pelo cliente
  if v_orcamento.agendamento_id is not null then
    raise exception 'Este orçamento já possui um agendamento finalizado. Entre em contato com a oficina para realizar alterações.';
  end if;

  if p_aceite then
    if p_nivel not in ('essencial', 'recomendado', 'completo') then
      raise exception 'Nível de orçamento inválido.';
    end if;

    if not exists (
      select 1 from public.orcamento_niveis
      where orcamento_id = v_orcamento.id and nivel = p_nivel
    ) then
      raise exception 'O nível escolhido não existe neste orçamento.';
    end if;

    update public.orcamentos
    set status = 'aprovado',
        nivel_aprovado = p_nivel,
        respondido_em = now(),
        updated_at = now()
    where id = v_orcamento.id;
  else
    update public.orcamentos
    set status = 'recusado',
        nivel_aprovado = null,
        respondido_em = now(),
        updated_at = now()
    where id = v_orcamento.id;
  end if;
end;
$$;

grant execute on function public.responder_orcamento(uuid, text, boolean) to anon, authenticated;

-- 3. RPC PARA OFICINA SOLICITAR REASSINATURA DE ALTERAÇÃO
create or replace function public.solicitar_reassinatura_orcamento(
  p_orcamento_id uuid,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_nivel_aprovado_obj record;
  v_historico jsonb;
  v_nova_revisao jsonb;
begin
  select * into v_orcamento from public.orcamentos where id = p_orcamento_id;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  select * into v_nivel_aprovado_obj
  from public.orcamento_niveis
  where orcamento_id = v_orcamento.id and nivel = v_orcamento.nivel_aprovado;

  v_historico := coalesce(v_orcamento.alteracao_historico, '[]'::jsonb);

  v_nova_revisao := jsonb_build_object(
    'id', gen_random_uuid(),
    'solicitado_em', now(),
    'nivel', v_orcamento.nivel_aprovado,
    'titulo_nivel', coalesce(v_nivel_aprovado_obj.titulo, 'Opção Selecionada'),
    'valor_total', coalesce(v_nivel_aprovado_obj.valor_total, 0),
    'motivo', coalesce(p_motivo, 'Atualização de itens e valores do orçamento'),
    'status', 'pendente'
  );

  update public.orcamentos
  set alteracao_pendente = true,
      alteracao_historico = v_historico || v_nova_revisao,
      updated_at = now()
  where id = p_orcamento_id;
end;
$$;

grant execute on function public.solicitar_reassinatura_orcamento(uuid, text) to authenticated;

-- 4. RPC PARA CLIENTE ASSINAR E CONFIRMAR ALTERAÇÃO DIGITALMENTE
create or replace function public.confirmar_alteracao_orcamento(
  p_token uuid,
  p_assinatura_base64 text,
  p_nome_assinante text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_historico jsonb;
  v_len int;
  v_elem jsonb;
  v_novo_historico jsonb := '[]'::jsonb;
  i int;
begin
  select * into v_orcamento from public.orcamentos where token_publico = p_token;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if not coalesce(v_orcamento.alteracao_pendente, false) then
    raise exception 'Não há nenhuma alteração pendente de assinatura para este orçamento.';
  end if;

  v_historico := coalesce(v_orcamento.alteracao_historico, '[]'::jsonb);
  v_len := jsonb_array_length(v_historico);

  -- Atualiza o último item do histórico para "assinado"
  for i in 0 .. (v_len - 1) loop
    v_elem := v_historico->i;
    if i = (v_len - 1) then
      v_elem := jsonb_set(v_elem, '{status}', '"assinado"'::jsonb);
      v_elem := jsonb_set(v_elem, '{assinado_em}', to_jsonb(now()));
      v_elem := jsonb_set(v_elem, '{assinante}', to_jsonb(coalesce(p_nome_assinante, 'Cliente')));
    end if;
    v_novo_historico := v_novo_historico || v_elem;
  end loop;

  update public.orcamentos
  set alteracao_pendente = false,
      alteracao_historico = v_novo_historico,
      assinatura_nome = coalesce(p_nome_assinante, v_orcamento.assinatura_nome),
      assinatura_data = now(),
      updated_at = now()
  where id = v_orcamento.id;
end;
$$;

grant execute on function public.confirmar_alteracao_orcamento(uuid, text, text) to anon, authenticated;

-- 5. ATUALIZA A RPC ORCAMENTO_PUBLICO PARA INCLUIR DADOS DE ALTERAÇÃO E ASSINATURA
create or replace function public.orcamento_publico(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_tenant_id uuid;
  v_tenant_nome text;
  v_tenant_logo_path text;
  v_tenant_telefone text;
  v_tenant_cidade text;
  v_tenant_uf text;
  v_tenant_agendamento_cliente boolean;
  v_tenant_antecedencia_minima smallint;
  v_primeiro_nome text := '';
  v_veiculo_placa text;
  v_veiculo_modelo text;
  v_veiculo_marca text;
  v_agendamento_id uuid;
  v_agendamento_inicio timestamptz;
  v_agendamento_status text;
  v_niveis_json jsonb;
begin
  select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
  if not found then
    return jsonb_build_object('erro', 'Orçamento não encontrado.');
  end if;

  -- Checar validade
  if v_orcamento.status in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
    if (v_orcamento.enviado_em::date + v_orcamento.validade_dias) < current_date then
      update public.orcamentos set status = 'expirado', updated_at = now() where id = v_orcamento.id;
      v_orcamento.status := 'expirado';
    end if;
  end if;

  -- Atualizar status para visualizado se enviado
  if v_orcamento.status = 'enviado' then
    update public.orcamentos set status = 'visualizado', updated_at = now() where id = v_orcamento.id;
    v_orcamento.status := 'visualizado';
  end if;

  -- Buscar dados da Oficina (tenant)
  select t.id, t.nome, t.logo_path, t.telefone, t.cidade, t.uf,
         coalesce(t.orcamento_agendamento_cliente, true), coalesce(t.antecedencia_minima_horas, 2)
  into v_tenant_id, v_tenant_nome, v_tenant_logo_path, v_tenant_telefone, v_tenant_cidade, v_tenant_uf,
       v_tenant_agendamento_cliente, v_tenant_antecedencia_minima
  from public.tenants t where t.id = v_orcamento.tenant_id;

  -- Buscar primeiro nome do cliente
  if v_orcamento.cliente_id is not null then
    select split_part(trim(c.nome), ' ', 1) into v_primeiro_nome
    from public.clientes c where c.id = v_orcamento.cliente_id;
  end if;
  if v_primeiro_nome = '' or v_primeiro_nome is null then
    v_primeiro_nome := 'Cliente';
  end if;

  -- Buscar veículo
  if v_orcamento.veiculo_id is not null then
    select v.placa, v.modelo, v.marca into v_veiculo_placa, v_veiculo_modelo, v_veiculo_marca
    from public.veiculos v where v.id = v_orcamento.veiculo_id;
  end if;

  -- Buscar dados do agendamento se vinculado
  if v_orcamento.agendamento_id is not null then
    select a.id, a.inicio, a.status into v_agendamento_id, v_agendamento_inicio, v_agendamento_status
    from public.agendamentos a where a.id = v_orcamento.agendamento_id;
  end if;

  -- Montar jsonb dos níveis com seus itens
  select jsonb_agg(
    jsonb_build_object(
      'nivel', n.nivel,
      'titulo', n.titulo,
      'descricao', n.descricao,
      'destaque', n.destaque,
      'valor_total', n.valor_total,
      'duracao_total', n.duracao_total,
      'itens', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'servico_id', i.servico_id,
              'servico_nome', coalesce(s.nome, 'Serviço'),
              'servico_descricao', s.descricao,
              'preco', i.preco,
              'duracao_minutos', i.duracao_minutos,
              'ordem', i.ordem
            ) order by i.ordem asc
          )
          from public.orcamento_nivel_itens i
          left join public.servicos s on s.id = i.servico_id
          where i.nivel_id = n.id
        ), '[]'::jsonb
      )
    ) order by case n.nivel when 'essencial' then 1 when 'recomendado' then 2 when 'completo' then 3 else 4 end
  ) into v_niveis_json
  from public.orcamento_niveis n
  where n.orcamento_id = v_orcamento.id;

  return jsonb_build_object(
    'id', v_orcamento.id,
    'numero', v_orcamento.numero,
    'status', v_orcamento.status,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'observacoes', v_orcamento.observacoes,
    'categoria_id', v_orcamento.categoria_id,
    'servico_principal_id', v_orcamento.servico_principal_id,
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', case when v_orcamento.enviado_em is not null then (v_orcamento.enviado_em::date + v_orcamento.validade_dias) else null end,
    'alteracao_pendente', coalesce(v_orcamento.alteracao_pendente, false),
    'alteracao_historico', coalesce(v_orcamento.alteracao_historico, '[]'::jsonb),
    'assinatura_data', v_orcamento.assinatura_data,
    'assinatura_nome', v_orcamento.assinatura_nome,
    'oficina', jsonb_build_object(
      'tenant_id', v_tenant_id,
      'nome', coalesce(v_tenant_nome, 'Oficina'),
      'logo_path', v_tenant_logo_path,
      'telefone', v_tenant_telefone,
      'cidade', v_tenant_cidade,
      'uf', v_tenant_uf,
      'orcamento_agendamento_cliente', coalesce(v_tenant_agendamento_cliente, true),
      'antecedencia_minima_horas', coalesce(v_tenant_antecedencia_minima, 2)
    ),
    'cliente_primeiro_nome', v_primeiro_nome,
    'veiculo', case when v_veiculo_placa is not null then jsonb_build_object(
      'placa', v_veiculo_placa,
      'modelo', v_veiculo_modelo,
      'marca', v_veiculo_marca
    ) else null end,
    'agendamento', case when v_agendamento_id is not null then jsonb_build_object(
      'id', v_agendamento_id,
      'inicio', v_agendamento_inicio,
      'status', v_agendamento_status
    ) else null end,
    'niveis', coalesce(v_niveis_json, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.orcamento_publico(uuid) to anon, authenticated;
