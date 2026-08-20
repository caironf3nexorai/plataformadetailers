-- Migration 0036: Nomenclatura Sequencial ORC/OS e Sistema de Desconto / Cupom no Orçamento

-- 1. ADICIONA COLUNAS DE NUMERO DE OS E DESCONTO/CUPOM NA TABELA ORCAMENTOS
alter table public.orcamentos
  add column if not exists numero_os integer,
  add column if not exists desconto_tipo text check (desconto_tipo in ('porcentagem', 'valor_fixo')),
  add column if not exists desconto_valor numeric(10,2) default 0,
  add column if not exists desconto_motivo text,
  add column if not exists desconto_cupom_codigo text,
  add column if not exists desconto_aplicado_por uuid references auth.users(id),
  add column if not exists desconto_aplicado_em timestamptz;

-- Index para otimizar busca por número de OS em orçamentos
create index if not exists idx_orcamentos_tenant_numero_os on public.orcamentos(tenant_id, numero_os);

-- 2. RPC APLICAR DESCONTO NO ORÇAMENTO (Apenas Dono e Gerente)
create or replace function public.aplicar_desconto_orcamento(
  p_orcamento uuid,
  p_tipo text,
  p_valor numeric,
  p_motivo text default null,
  p_cupom_codigo text default null
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
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select o.* into v_orcamento from public.orcamentos o where o.id = p_orcamento;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if not public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado. Apenas Donos ou Gerentes podem conceder cupons de desconto.';
  end if;

  if p_tipo not in ('porcentagem', 'valor_fixo') then
    raise exception 'Tipo de desconto inválido. Use "porcentagem" ou "valor_fixo".';
  end if;

  if p_valor <= 0 then
    raise exception 'O valor do desconto deve ser maior que zero.';
  end if;

  if p_tipo = 'porcentagem' and p_valor > 100 then
    raise exception 'Desconto em porcentagem não pode exceder 100%%.';
  end if;

  update public.orcamentos
  set desconto_tipo = p_tipo,
      desconto_valor = p_valor,
      desconto_motivo = trim(p_motivo),
      desconto_cupom_codigo = upper(trim(p_cupom_codigo)),
      desconto_aplicado_por = auth.uid(),
      desconto_aplicado_em = now(),
      updated_at = now()
  where id = p_orcamento;
end;
$$;

grant execute on function public.aplicar_desconto_orcamento(uuid, text, numeric, text, text) to authenticated;

-- 3. RPC REMOVER DESCONTO DO ORÇAMENTO (Apenas Dono e Gerente)
create or replace function public.remover_desconto_orcamento(
  p_orcamento uuid
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
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select o.* into v_orcamento from public.orcamentos o where o.id = p_orcamento;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if not public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado. Apenas Donos ou Gerentes podem remover descontos.';
  end if;

  update public.orcamentos
  set desconto_tipo = null,
      desconto_valor = 0,
      desconto_motivo = null,
      desconto_cupom_codigo = null,
      desconto_aplicado_por = null,
      desconto_aplicado_em = null,
      updated_at = now()
  where id = p_orcamento;
end;
$$;

grant execute on function public.remover_desconto_orcamento(uuid) to authenticated;

-- 4. ATUALIZA RPC CONVERTER_ORCAMENTO_EM_AGENDAMENTO PARA ATRIBUIR NÚMERO DE OS
create or replace function public.converter_orcamento_em_agendamento(
  p_orcamento uuid,
  p_inicio timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_nivel_rec record;
  v_agendamento_id uuid;
  v_servico_principal uuid;
  v_os_num integer;
  v_valor_final numeric(10,2);
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select o.* into v_orcamento from public.orcamentos o where o.id = p_orcamento;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if not public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  if v_orcamento.status <> 'aprovado' then
    raise exception 'Apenas orçamentos aprovados podem ser convertidos em agendamento.';
  end if;

  if v_orcamento.nivel_aprovado is null then
    raise exception 'Nenhum nível aprovado foi registrado para este orçamento.';
  end if;

  -- Se já possuir agendamento vinculado, retorna o id existente
  if v_orcamento.agendamento_id is not null then
    return v_orcamento.agendamento_id;
  end if;

  -- Busca o nível aprovado
  select n.* into v_nivel_rec
  from public.orcamento_niveis n
  where n.orcamento_id = p_orcamento and n.nivel = v_orcamento.nivel_aprovado;

  if not found then
    raise exception 'Nível aprovado não encontrado.';
  end if;

  -- Pega o primeiro serviço do nível
  select i.servico_id into v_servico_principal
  from public.orcamento_nivel_itens i
  where i.nivel_id = v_nivel_rec.id
  order by i.ordem asc
  limit 1;

  -- Calcula o valor final aplicando o desconto (se houver)
  v_valor_final := coalesce(v_nivel_rec.valor_total, 0);
  if v_orcamento.desconto_valor > 0 and v_orcamento.desconto_tipo is not null then
    if v_orcamento.desconto_tipo = 'porcentagem' then
      v_valor_final := round(v_valor_final * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    elsif v_orcamento.desconto_tipo = 'valor_fixo' then
      v_valor_final := greatest(0.00, v_valor_final - v_orcamento.desconto_valor);
    end if;
  end if;

  -- Gera o próximo número sequencial de OS para a oficina
  v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);

  -- Cria o agendamento (Ordem de Serviço)
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    duracao_minutos,
    duracao_total,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    observacoes,
    numero_os
  ) values (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_servico_principal,
    v_orcamento.categoria_id,
    p_inicio,
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.duracao_total, 60),
    v_valor_final,
    v_valor_final,
    'agendado',
    'orcamento',
    coalesce(v_orcamento.observacoes, '') || ' (Convertido do Orçamento ORC' || lpad(v_orcamento.numero::text, 4, '0') || ' - OS ' || lpad(v_os_num::text, 4, '0') || ' - ' || v_nivel_rec.titulo || ')',
    v_os_num
  ) returning id into v_agendamento_id;

  -- Inserir itens do agendamento
  insert into public.agendamento_itens (
    tenant_id, agendamento_id, servico_id, duracao_minutos, preco_estimado, ordem
  )
  select
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.duracao_minutos,
    i.preco,
    i.ordem
  from public.orcamento_nivel_itens i
  where i.nivel_id = v_nivel_rec.id;

  -- Vincula o agendamento e o numero_os ao orçamento
  update public.orcamentos
  set agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  where id = p_orcamento;

  return v_agendamento_id;
end;
$$;

grant execute on function public.converter_orcamento_em_agendamento(uuid, timestamptz) to authenticated;

-- 5. ATUALIZA RPC AGENDAR_ORCAMENTO_PUBLICO PARA ATRIBUIR NÚMERO DE OS
create or replace function public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_antecedencia_minima smallint;
  v_agendamento_cliente_habil boolean;
  v_nivel_rec record;
  v_servico_principal uuid;
  v_modo_ocupacao text := 'slot';
  v_dias_ocupados smallint := 1;
  v_agendamento_id uuid;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
  v_min_inicio timestamptz;
  v_os_num integer;
  v_valor_final numeric(10,2);
begin
  select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if v_orcamento.status <> 'aprovado' then
    raise exception 'Apenas orçamentos aprovados podem ser agendados.';
  end if;

  if v_orcamento.agendamento_id is not null then
    return v_orcamento.agendamento_id;
  end if;

  select coalesce(t.antecedencia_minima_horas, 2), coalesce(t.orcamento_agendamento_cliente, true)
  into v_antecedencia_minima, v_agendamento_cliente_habil
  from public.tenants t where t.id = v_orcamento.tenant_id;

  if not v_agendamento_cliente_habil then
    raise exception 'O agendamento automático pelo cliente não está habilitado para esta oficina.';
  end if;

  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;
  if p_inicio < v_min_inicio then
    raise exception 'O horário escolhido deve ter antecedência mínima de % horas.', v_antecedencia_minima;
  end if;

  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;

  -- Lock por tenant e data para evitar corrida
  perform pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text), hashtext(v_data::text));

  -- Busca o nível aprovado
  select n.* into v_nivel_rec
  from public.orcamento_niveis n
  where n.orcamento_id = v_orcamento.id and n.nivel = v_orcamento.nivel_aprovado;

  if not found then
    raise exception 'Nível aprovado não encontrado.';
  end if;

  select i.servico_id into v_servico_principal
  from public.orcamento_nivel_itens i
  where i.nivel_id = v_nivel_rec.id
  order by i.ordem asc
  limit 1;

  if v_servico_principal is not null then
    select coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    into v_modo_ocupacao, v_dias_ocupados
    from public.servicos s where s.id = v_servico_principal;
  end if;

  -- Revalidação rigorosa de disponibilidade no servidor
  select disponivel into v_is_disponivel
  from public.horarios_disponiveis(
    v_orcamento.tenant_id,
    v_data,
    v_servico_principal,
    v_orcamento.categoria_id,
    null
  ) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_disponivel, false) then
    raise exception 'O horário selecionado não está mais disponível. Por favor, escolha outro horário.';
  end if;

  -- Calcula valor final com desconto
  v_valor_final := coalesce(v_nivel_rec.valor_total, 0);
  if v_orcamento.desconto_valor > 0 and v_orcamento.desconto_tipo is not null then
    if v_orcamento.desconto_tipo = 'porcentagem' then
      v_valor_final := round(v_valor_final * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    elsif v_orcamento.desconto_tipo = 'valor_fixo' then
      v_valor_final := greatest(0.00, v_valor_final - v_orcamento.desconto_valor);
    end if;
  end if;

  -- Gera o número sequencial de OS
  v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);

  -- Cria o agendamento com numero_os
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    observacoes,
    numero_os
  ) values (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_servico_principal,
    v_orcamento.categoria_id,
    p_inicio,
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_dias_ocupados, 1),
    v_valor_final,
    v_valor_final,
    'agendado',
    'online',
    coalesce(v_orcamento.observacoes, '') || ' (Agendado pelo cliente via Orçamento ORC' || lpad(v_orcamento.numero::text, 4, '0') || ' - OS ' || lpad(v_os_num::text, 4, '0') || ' - ' || v_nivel_rec.titulo || ')',
    v_os_num
  ) returning id into v_agendamento_id;

  -- Inserir itens do agendamento
  insert into public.agendamento_itens (
    tenant_id, agendamento_id, servico_id, combo_id, duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
  )
  select
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.combo_id,
    coalesce(i.duracao_minutos, 60),
    coalesce(i.preco, 0),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_dias_ocupados, 1),
    i.ordem
  from public.orcamento_nivel_itens i
  where i.nivel_id = v_nivel_rec.id;

  -- Atualiza o orçamento com agendamento_id e numero_os
  update public.orcamentos
  set agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  where id = v_orcamento.id;

  return v_agendamento_id;
end;
$$;

grant execute on function public.agendar_orcamento_publico(uuid, timestamptz) to anon, authenticated;

-- 6. ATUALIZA RPC ORCAMENTO_PUBLICO COM SUPORTE A NUMERO_OS E DESCONTO
create or replace function public.orcamento_publico(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_cliente record;
  v_veiculo record;
  v_tenant record;
  v_niveis_json jsonb;
  v_primeiro_nome text;
  v_is_expirado boolean := false;
  v_status_atual text;
  v_agendamento record;
  v_tem_agendamento boolean := false;
  v_usuario_desconto_nome text := null;
  v_desconto_json jsonb := null;
begin
  select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
  if not found then
    return jsonb_build_object('erro', 'Orçamento não encontrado');
  end if;

  v_status_atual := v_orcamento.status;

  -- Valida expiração em tempo real
  if v_status_atual in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
    if (v_orcamento.enviado_em::date + v_orcamento.validade_dias) < current_date then
      v_is_expirado := true;
      v_status_atual := 'expirado';

      update public.orcamentos
      set status = 'expirado', updated_at = now()
      where id = v_orcamento.id;
    end if;
  end if;

  -- Primeira visualização
  if v_status_atual = 'enviado' and not v_is_expirado then
    update public.orcamentos
    set status = 'visualizado',
        visualizado_em = coalesce(visualizado_em, now()),
        updated_at = now()
    where id = v_orcamento.id;
    
    v_status_atual := 'visualizado';
  end if;

  -- Informações públicas da oficina
  select t.nome, t.logo_path, t.telefone, t.cidade, t.uf, coalesce(t.orcamento_agendamento_cliente, true) as orcamento_agendamento_cliente
  into v_tenant
  from public.tenants t where t.id = v_orcamento.tenant_id;

  -- Cliente
  select c.nome into v_cliente from public.clientes c where c.id = v_orcamento.cliente_id;
  v_primeiro_nome := split_part(coalesce(v_cliente.nome, 'Cliente'), ' ', 1);

  -- Veículo
  if v_orcamento.veiculo_id is not null then
    select v.placa, v.modelo, v.marca into v_veiculo from public.veiculos v where v.id = v_orcamento.veiculo_id;
  end if;

  -- Agendamento vinculado
  if v_orcamento.agendamento_id is not null then
    select a.id, a.inicio, a.status, a.numero_os into v_agendamento
    from public.agendamentos a
    where a.id = v_orcamento.agendamento_id;
    v_tem_agendamento := found;
  end if;

  -- Nome de quem aplicou o desconto
  if v_orcamento.desconto_aplicado_por is not null then
    select p.nome into v_usuario_desconto_nome
    from public.profiles p
    where p.id = v_orcamento.desconto_aplicado_por;
  end if;

  -- JSON de Desconto
  if v_orcamento.desconto_valor > 0 and v_orcamento.desconto_tipo is not null then
    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'cupom_codigo', v_orcamento.desconto_cupom_codigo,
      'aplicado_em', v_orcamento.desconto_aplicado_em,
      'aplicado_por_nome', coalesce(split_part(v_usuario_desconto_nome, ' ', 1), 'Gestor')
    );
  end if;

  -- Níveis e serviços com calculo de desconto
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'nivel', n.nivel,
      'titulo', n.titulo,
      'descricao', n.descricao,
      'valor_original', n.valor_total,
      'valor_total', case 
        when v_orcamento.desconto_valor > 0 and v_orcamento.desconto_tipo = 'porcentagem' 
          then round(n.valor_total * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2)
        when v_orcamento.desconto_valor > 0 and v_orcamento.desconto_tipo = 'valor_fixo' 
          then greatest(0.00, n.valor_total - v_orcamento.desconto_valor)
        else n.valor_total
      end,
      'duracao_total', n.duracao_total,
      'destaque', n.destaque,
      'ordem', n.ordem,
      'itens', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'servico_nome', s.nome,
              'servico_descricao', s.descricao_publica,
              'preco', i.preco,
              'duracao_minutos', i.duracao_minutos
            ) order by i.ordem asc
          )
          from public.orcamento_nivel_itens i
          join public.servicos s on s.id = i.servico_id
          where i.nivel_id = n.id
        ), '[]'::jsonb
      )
    ) order by n.ordem asc
  ), '[]'::jsonb)
  into v_niveis_json
  from public.orcamento_niveis n
  where n.orcamento_id = v_orcamento.id;

  return jsonb_build_object(
    'numero', v_orcamento.numero,
    'numero_os', coalesce(v_orcamento.numero_os, case when v_tem_agendamento then v_agendamento.numero_os else null end),
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'validade_dias', v_orcamento.validade_dias,
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', case when v_orcamento.enviado_em is not null then (v_orcamento.enviado_em::date + v_orcamento.validade_dias) else null end,
    'alteracao_pendente', coalesce(v_orcamento.alteracao_pendente, false),
    'alteracao_historico', coalesce(v_orcamento.alteracao_historico, '[]'::jsonb),
    'desconto', v_desconto_json,
    'oficina', jsonb_build_object(
      'nome', v_tenant.nome,
      'logo_path', v_tenant.logo_path,
      'telefone', v_tenant.telefone,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'orcamento_agendamento_cliente', v_tenant.orcamento_agendamento_cliente
    ),
    'cliente_primeiro_nome', v_primeiro_nome,
    'veiculo', case when v_veiculo.placa is not null then jsonb_build_object(
      'placa', v_veiculo.placa,
      'modelo', v_veiculo.modelo,
      'marca', v_veiculo.marca
    ) else null end,
    'agendamento', case when v_tem_agendamento then jsonb_build_object(
      'id', v_agendamento.id,
      'inicio', v_agendamento.inicio,
      'status', v_agendamento.status,
      'numero_os', v_agendamento.numero_os
    ) else null end,
    'niveis', v_niveis_json
  );
end;
$$;

grant execute on function public.orcamento_publico(uuid) to anon, authenticated;
