-- ==============================================================================
-- MIGRAÇÃO 0079: POLÍTICA DE PRIVACIDADE, CONSENTIMENTOS E REVOGAÇÃO ANON
-- 1. Revoga execute de tenant_tem_feature de public/anon (mantém só authenticated)
-- 2. Cria tabela imutável public.consentimentos_publicos com RLS por tenant
-- 3. Integra registro automático de consentimento em agendar_cliente_online
-- 4. Integra registro automático de consentimento em aceitar_vistoria_remoto
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVOGAR ACESSO ANÔNIMO A tenant_tem_feature
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.tenant_tem_feature(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.tenant_tem_feature(uuid, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 2. TABELA DE CONSENTIMENTOS PÚBLICOS (LGPD)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consentimentos_publicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('agendamento_online', 'aceite_vistoria')),
  identificador TEXT NOT NULL, -- Telefone normalizado ou token da vistoria
  documento_versao TEXT NOT NULL DEFAULT 'v1.0-2026-08',
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_consentimentos_publicos_tenant ON public.consentimentos_publicos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consentimentos_publicos_identificador ON public.consentimentos_publicos(identificador);

-- RLS: Cada oficina só visualiza os próprios consentimentos; ninguém edita ou apaga
ALTER TABLE public.consentimentos_publicos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consentimentos_publicos_select_policy ON public.consentimentos_publicos;
CREATE POLICY consentimentos_publicos_select_policy ON public.consentimentos_publicos
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin());

-- Sem políticas de UPDATE ou DELETE -> Registro imutável de conformidade legal


-- ------------------------------------------------------------------------------
-- 3. ATUALIZAR agendar_cliente_online COM REGISTRO DE CONSENTIMENTO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_cliente_online(
  p_slug text,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_veiculo_placa text,
  p_veiculo_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text default null,
  p_transbordo_aceito boolean default false,
  p_user_agent text default null,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant record;
  v_antecedencia_minima integer;
  v_min_inicio timestamptz;
  v_duracao_total integer := 0;
  v_valor_total numeric := 0;
  v_fim timestamptz;
  v_fim_efetivo timestamptz;
  v_data date;
  v_hora time;
  v_tel_norm text;
  v_reg record;
  v_agendamento_id uuid;
  v_item jsonb;
  v_servico record;
  v_sp record;
  v_preco_item numeric;
  v_duracao_item integer;
  v_disp record;
  v_max_dias integer := 1;
  v_modo_efetivo text := 'slot';
  v_is_transbordo boolean := false;
  v_inicio_sp date;
  v_termino_sp date;
  v_obs_final text;
begin
  -- 1. Busca Tenant pelo Slug
  select t.* into v_tenant
  from public.tenants t
  where t.slug = p_slug and t.ativo
  limit 1;

  if not found then
    raise exception 'Oficina não encontrada ou inativa.';
  end if;

  if not coalesce(v_tenant.agendamento_online_ativo, true) then
    raise exception 'O agendamento online não está ativado nesta oficina.';
  end if;

  v_antecedencia_minima := coalesce(v_tenant.antecedencia_minima_horas, 2);
  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;

  if p_inicio < v_min_inicio then
    raise exception 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  end if;

  v_data := (p_inicio at time zone coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_hora := (p_inicio at time zone coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::time;

  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text || ':' || v_data::text));

  -- 2. Valida disponibilidade do slot
  select * into v_disp
  from public.horarios_disponiveis(
    p_tenant => v_tenant.id,
    p_data => v_data,
    p_itens => p_itens,
    p_categoria => p_categoria
  ) hd
  where hd.horario = v_hora;

  if not found or not v_disp.disponivel then
    raise exception 'Horário indisponível: %', coalesce(v_disp.motivo, 'fora_do_expediente');
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Nenhum serviço selecionado.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_servico
    from public.servicos s
    where s.id = (v_item->>'servico_id')::uuid and s.tenant_id = v_tenant.id and s.ativo;

    if not found then
      raise exception 'Serviço % não encontrado ou inativo.', (v_item->>'servico_id');
    end if;

    select * into v_sp
    from public.servico_precos sp
    where sp.servico_id = v_servico.id and sp.categoria_id = p_categoria;

    v_preco_item := coalesce(v_sp.preco, v_servico.preco_padrao, 0);
    v_duracao_item := coalesce(v_sp.duracao_minutos, v_servico.duracao_estimada_minutos, 60);

    v_duracao_total := v_duracao_total + v_duracao_item;
    v_valor_total := v_valor_total + v_preco_item;

    if coalesce(v_item->>'modo_ocupacao', v_servico.modo_ocupacao, 'transborda') = 'dia_todo' then
      v_modo_efetivo := 'dia_todo';
      v_max_dias := greatest(v_max_dias, coalesce(v_servico.dias_ocupados, 1));
    end if;
  end loop;

  v_fim := p_inicio + (v_duracao_total || ' minutes')::interval;
  v_fim_efetivo := public.calcular_fim_efetivo(v_tenant.id, p_inicio, v_duracao_total, v_modo_efetivo);

  v_inicio_sp := (p_inicio at time zone coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_termino_sp := (v_fim_efetivo at time zone coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  if v_termino_sp > v_inicio_sp then
    v_is_transbordo := true;
  end if;

  if v_is_transbordo and not coalesce(p_transbordo_aceito, false) then
    raise exception 'Este agendamento ultrapassa o horário de expediente e requer aceite explícito de transbordo.';
  end if;

  -- 3. Registra Cliente e Veículo
  select * into v_reg
  from public.pre_registrar_cliente_e_veiculo_online(
    p_tenant_id => v_tenant.id,
    p_nome => p_cliente_nome,
    p_telefone => p_cliente_telefone,
    p_categoria_id => p_categoria,
    p_placa => p_veiculo_placa,
    p_modelo => p_veiculo_modelo,
    p_marca => null,
    p_ano => null,
    p_cor => null
  );

  v_tel_norm := public.normalizar_telefone(p_cliente_telefone);

  -- 4. Grava Consentimento Legal (LGPD) na mesma transação
  insert into public.consentimentos_publicos (
    tenant_id,
    tipo,
    identificador,
    documento_versao,
    aceito_em,
    ip,
    user_agent
  ) values (
    v_tenant.id,
    'agendamento_online',
    coalesce(v_tel_norm, p_cliente_telefone),
    'v1.0-2026-08',
    now(),
    p_ip,
    p_user_agent
  );

  -- 5. Cria Agendamento
  v_obs_final := coalesce(trim(p_observacoes), '');
  if v_is_transbordo then
    v_obs_final := case when v_obs_final = '' then '' else v_obs_final || E'\n' end
                   || '[Transbordo Aceito pelo Cliente: Veículo pernoitará na oficina até ' || to_char(v_fim_efetivo, 'DD/MM/YYYY HH24:MI') || ']';
  end if;

  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    categoria_id,
    inicio,
    fim,
    fim_efetivo,
    status,
    origem,
    observacoes,
    duracao_minutos,
    duracao_total,
    valor_total,
    transbordo_aceito,
    transbordo_aceito_em,
    transbordo_user_agent,
    transbordo_ip
  ) values (
    v_tenant.id,
    v_reg.cliente_id,
    v_reg.veiculo_id,
    p_categoria,
    p_inicio,
    v_fim,
    v_fim_efetivo,
    'agendado',
    'online',
    nullif(v_obs_final, ''),
    v_duracao_total,
    v_duracao_total,
    v_valor_total,
    v_is_transbordo,
    case when v_is_transbordo then now() else null end,
    case when v_is_transbordo then p_user_agent else null end,
    case when v_is_transbordo then p_ip else null end
  )
  returning id into v_agendamento_id;

  -- 6. Insere Itens do Agendamento
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_servico
    from public.servicos s
    where s.id = (v_item->>'servico_id')::uuid;

    select * into v_sp
    from public.servico_precos sp
    where sp.servico_id = v_servico.id and sp.categoria_id = p_categoria;

    v_preco_item := coalesce(v_sp.preco, v_servico.preco_padrao, 0);
    v_duracao_item := coalesce(v_sp.duracao_minutos, v_servico.duracao_estimada_minutos, 60);

    insert into public.agendamento_itens (
      agendamento_id,
      servico_id,
      combo_id,
      preco_cobrado,
      duracao_minutos
    ) values (
      v_agendamento_id,
      v_servico.id,
      null,
      v_preco_item,
      v_duracao_item
    );
  end loop;

  return jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'cliente_id', v_reg.cliente_id,
    'veiculo_id', v_reg.veiculo_id,
    'inicio', p_inicio,
    'fim_efetivo', v_fim_efetivo,
    'valor_total', v_valor_total,
    'transbordo', v_is_transbordo,
    'aviso', v_reg.aviso
  );
end;
$$;

grant execute on function public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, boolean, text, text) to anon, authenticated;


-- ------------------------------------------------------------------------------
-- 4. ATUALIZAR aceitar_vistoria_remoto COM REGISTRO DE CONSENTIMENTO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aceitar_vistoria_remoto(
  p_token uuid,
  p_assinatura_base64 text,
  p_nome text,
  p_user_agent text default null,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_checkin record;
  v_tentativas integer;
  v_nome_limpo text;
begin
  if p_token is null then
    raise exception 'Token de vistoria inválido.';
  end if;

  select * into v_checkin
  from public.checkins c
  where c.token_aceite = p_token
  for update;

  if not found then
    raise exception 'Vistoria não encontrada.';
  end if;

  v_tentativas := coalesce(v_checkin.tentativas_aceite, 0) + 1;
  update public.checkins
  set tentativas_aceite = v_tentativas
  where id = v_checkin.id;

  if v_tentativas > 10 then
    raise exception 'Muitas tentativas. Entre em contato com a oficina.';
  end if;

  if v_checkin.enviado_em is null then
    raise exception 'Esta vistoria não foi enviada para aceite remoto.';
  end if;

  if v_checkin.finalizado then
    raise exception 'Esta vistoria já se encontra finalizada e assinada.';
  end if;

  v_nome_limpo := trim(coalesce(p_nome, ''));
  if length(v_nome_limpo) < 3 then
    raise exception 'O nome do assinante deve conter no mínimo 3 caracteres.';
  end if;

  if p_assinatura_base64 is null or (
    not (p_assinatura_base64 like 'data:image/png;base64,%' or p_assinatura_base64 like 'data:image/jpeg;base64,%')
  ) then
    raise exception 'Formato de imagem da assinatura inválido. Deve ser PNG ou JPEG em base64.';
  end if;

  if length(p_assinatura_base64) > 500000 then
    raise exception 'Tamanho da imagem da assinatura excede o limite permitido.';
  end if;

  -- 1. Atualiza o status da vistoria
  update public.checkins
  set
    finalizado = true,
    assinado_em = now(),
    aceite_tipo = 'remoto',
    assinatura_path = p_assinatura_base64,
    assinatura_nome = v_nome_limpo,
    aceite_user_agent = p_user_agent,
    aceite_ip = p_ip
  where id = v_checkin.id;

  -- 2. Grava Consentimento Legal (LGPD) na mesma transação
  insert into public.consentimentos_publicos (
    tenant_id,
    tipo,
    identificador,
    documento_versao,
    aceito_em,
    ip,
    user_agent
  ) values (
    v_checkin.tenant_id,
    'aceite_vistoria',
    p_token::text,
    'v1.0-2026-08',
    now(),
    p_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Vistoria assinada com sucesso.'
  );
end;
$$;

grant execute on function public.aceitar_vistoria_remoto(uuid, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
