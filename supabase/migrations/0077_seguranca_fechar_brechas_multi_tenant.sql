-- ==============================================================================
-- MIGRAÇÃO 0077: FECHAMENTO DE BRECHAS DE SEGURANÇA MULTI-TENANT
-- 1. Elimina funções de depuração que expunham dados entre oficinas
-- 2. Revoga acesso público/autenticado a rotinas internas (não chamadas pelo frontend)
-- 3. Adiciona validação estrita de pertencimento (meus_tenants) em RPCs acessíveis
-- 4. Reforça checagem de status ativo de oficina em endpoints de catálogo público
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. APAGAR FUNÇÕES DE DEPURAÇÃO
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.listar_todos_agendamentos_debug(uuid);
DROP FUNCTION IF EXISTS public.diagnosticar_conflito_horarios(uuid, date, jsonb, uuid);


-- ------------------------------------------------------------------------------
-- 2. REVOGAR EXECUÇÃO DE FUNÇÕES INTERNAS E UTILITÁRIAS
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.recalcular_resultados_pendentes(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.atualizar_expiracao_fotos_tenant(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.seed_horarios_funcionamento_tenant(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.seed_formas_pagamento_tenant(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.proximo_numero_os(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.obter_contador_os(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.proximo_numero_orcamento(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.calcular_fim_efetivo(uuid, timestamptz, integer, text) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.dentro_do_limite(uuid, text, integer) FROM authenticated, anon, public;


-- ------------------------------------------------------------------------------
-- 3. ATUALIZAR FUNÇÕES ACESSÍVEIS COM VALIDAÇÃO ESTRITA DE TENANT
-- ------------------------------------------------------------------------------

-- 3.1 CUSTO HORA DA OPERAÇÃO (Usada no Frontend em AbaDespesasFixas e internamente em fechar_resultado_execucao)
CREATE OR REPLACE FUNCTION public.custo_hora_operacao(
  p_tenant uuid,
  p_mes date
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_horas_disp numeric := 0;
  v_total_despesas numeric := 0;
BEGIN
  -- Bloqueia leitura cruzada se chamado diretamente via REST por usuário autenticado
  IF auth.uid() IS NOT NULL AND NOT (p_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado. Você não tem permissão para visualizar dados desta oficina.';
  END IF;

  v_horas_disp := public.horas_disponiveis_mes(p_tenant, p_mes);
  IF v_horas_disp <= 0 THEN
    RETURN 0.00;
  END IF;

  SELECT coalesce(sum(df.valor_mensal), 0.00)
  INTO v_total_despesas
  FROM public.despesas_fixas df
  WHERE df.tenant_id = p_tenant
    AND df.vigencia_inicio <= v_fim_mes
    AND (df.vigencia_fim IS NULL OR df.vigencia_fim >= v_inicio_mes);

  IF v_total_despesas <= 0 THEN
    RETURN 0.00;
  END IF;

  RETURN round(v_total_despesas / v_horas_disp, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custo_hora_operacao(uuid, date) TO authenticated;


-- 3.2 HORAS DISPONÍVEIS NO MÊS (Usada no Frontend em AbaDespesasFixas)
CREATE OR REPLACE FUNCTION public.horas_disponiveis_mes(
  p_tenant uuid,
  p_mes date
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_fuso text := public.obter_fuso_tenant(p_tenant);
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_curr date;
  v_dow integer;
  v_horario record;
  v_janela_inicio timestamptz;
  v_janela_fim timestamptz;
  v_janela_segundos numeric;
  v_bloqueio_segundos numeric;
  v_liquido_segundos numeric;
  v_horas_dia numeric := 0;
  v_total_horas numeric := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  PERFORM public.obter_ou_gerar_despesas_mes(p_tenant, p_mes);
  v_curr := v_inicio_mes;
  WHILE v_curr <= v_fim_mes LOOP
    v_dow := extract(dow from v_curr)::integer;

    SELECT hf.ativo, hf.abre, hf.fecha, hf.capacidade
    INTO v_horario
    FROM public.horarios_funcionamento hf
    WHERE hf.tenant_id = p_tenant AND hf.dia_semana = v_dow;

    IF v_horario.ativo = true AND v_horario.abre IS NOT NULL AND v_horario.fecha IS NOT NULL THEN
      v_janela_inicio := (v_curr || ' ' || v_horario.abre)::timestamp AT TIME ZONE v_fuso;
      v_janela_fim := (v_curr || ' ' || v_horario.fecha)::timestamp AT TIME ZONE v_fuso;

      IF v_janela_fim > v_janela_inicio THEN
        v_janela_segundos := extract(epoch from (v_janela_fim - v_janela_inicio));

        SELECT coalesce(sum(
          extract(epoch from (
            least(ba.fim, v_janela_fim) - greatest(ba.inicio, v_janela_inicio)
          ))
        ), 0)
        INTO v_bloqueio_segundos
        FROM public.bloqueios_agenda ba
        WHERE ba.tenant_id = p_tenant
          AND ba.inicio < v_janela_fim
          AND ba.fim > v_janela_inicio;

        v_liquido_segundos := greatest(0, v_janela_segundos - v_bloqueio_segundos);
        v_horas_dia := (v_liquido_segundos / 3600.0) * coalesce(v_horario.capacidade, 1);
        v_total_horas := v_total_horas + v_horas_dia;
      END IF;
    END IF;

    v_curr := v_curr + 1;
  END LOOP;

  RETURN round(v_total_horas, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION public.horas_disponiveis_mes(uuid, date) TO authenticated;


-- 3.3 OBTER OU GERAR DESPESAS DO MÊS
CREATE OR REPLACE FUNCTION public.obter_ou_gerar_despesas_mes(
  p_tenant uuid,
  p_mes date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_inicio_mes date := date_trunc('month', p_mes)::date;
  v_fim_mes date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_inicio_mes_ant date := (date_trunc('month', p_mes) - interval '1 month')::date;
  v_fim_mes_ant date := (date_trunc('month', p_mes) - interval '1 day')::date;
  v_rec record;
  v_pai_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  FOR v_rec IN
    SELECT d.*
    FROM public.despesas_fixas d
    WHERE d.tenant_id = p_tenant
      AND d.tipo = 'variavel'
      AND d.vigencia_inicio <= v_fim_mes_ant
      AND (d.vigencia_fim IS NULL OR d.vigencia_fim >= v_inicio_mes_ant)
      AND NOT EXISTS (
        SELECT 1 FROM public.despesas_fixas d_atual
        WHERE d_atual.tenant_id = p_tenant
          AND d_atual.tipo = 'variavel'
          AND (
            d_atual.id = d.id 
            OR d_atual.despesa_pai_id = coalesce(d.despesa_pai_id, d.id)
            OR lower(trim(d_atual.nome)) = lower(trim(d.nome))
          )
          AND d_atual.vigencia_inicio <= v_fim_mes
          AND (d_atual.vigencia_fim IS NULL OR d_atual.vigencia_fim >= v_inicio_mes)
      )
  LOOP
    v_pai_id := coalesce(v_rec.despesa_pai_id, v_rec.id);
    INSERT INTO public.despesas_fixas (
      tenant_id, nome, valor_mensal, vigencia_inicio, vigencia_fim,
      tipo, despesa_pai_id, categoria_custo, confirmado, confirmado_em, confirmado_por
    ) VALUES (
      p_tenant, v_rec.nome, v_rec.valor_mensal, v_inicio_mes, v_fim_mes,
      'variavel', v_pai_id, v_rec.categoria_custo, false, null, null
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_ou_gerar_despesas_mes(uuid, date) TO authenticated;


-- 3.4 PRODUTOS EM ALERTA (Estoque)
CREATE OR REPLACE FUNCTION public.produtos_em_alerta(p_tenant uuid)
RETURNS TABLE (
  id uuid,
  nome text,
  marca text,
  categoria text,
  unidade_uso text,
  estoque_atual numeric,
  estoque_minimo numeric,
  custo_unitario numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (p_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.nome, p.marca, p.categoria, p.unidade_uso, p.estoque_atual, p.estoque_minimo, p.custo_unitario
  FROM public.produtos p
  WHERE p.tenant_id = p_tenant
    AND p.estoque_atual <= p.estoque_minimo
    AND p.ativo = true
  ORDER BY (p.estoque_minimo - p.estoque_atual) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.produtos_em_alerta(uuid) TO authenticated;


-- 3.5 PRODUTOS PARA CONSUMO (Execução)
CREATE OR REPLACE FUNCTION public.produtos_para_consumo(p_tenant uuid)
RETURNS TABLE (
  id uuid,
  nome text,
  marca text,
  categoria text,
  unidade_uso text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (p_tenant IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.nome, p.marca, p.categoria, p.unidade_uso
  FROM public.produtos p
  WHERE p.tenant_id = p_tenant
    AND p.ativo = true
  ORDER BY p.categoria, p.nome;
END;
$$;

GRANT EXECUTE ON FUNCTION public.produtos_para_consumo(uuid) TO authenticated;


-- 3.6 TENANT TEM FEATURE
CREATE OR REPLACE FUNCTION public.tenant_tem_feature(p_tenant_id UUID, p_feature TEXT)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano text;
  v_habilitado BOOLEAN;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  SELECT plano INTO v_plano FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT habilitado INTO v_habilitado
  FROM public.plan_features
  WHERE plano = v_plano AND feature = p_feature;

  RETURN COALESCE(v_habilitado, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_tem_feature(uuid, text) TO authenticated, anon;


-- 3.7 REGISTRAR ACEITE DE TERMOS
CREATE OR REPLACE FUNCTION public.registrar_aceite_termos(
  p_tenant_id UUID,
  p_versao TEXT DEFAULT 'v1.0-2026-08',
  p_tipo TEXT DEFAULT 'ambos',
  p_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_aceite_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT (p_tenant_id IN (SELECT public.meus_tenants()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Acesso negado. Usuário não pertence ao tenant informado.';
  END IF;

  INSERT INTO public.aceites_termos (
    tenant_id, user_id, versao_documento, tipo_documento, ip_address, user_agent
  ) VALUES (
    p_tenant_id, v_user_id, p_versao, p_tipo, p_ip, p_user_agent
  )
  RETURNING id INTO v_aceite_id;

  RETURN jsonb_build_object('success', true, 'id', v_aceite_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_aceite_termos(uuid, text, text, text, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. REFORÇAR VALIDAÇÃO EM PRÉ-REGISTRO E REGISTRO PÚBLICO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pre_registrar_cliente_e_veiculo_online(
  p_tenant_id uuid,
  p_nome text,
  p_telefone text,
  p_categoria_id uuid default null,
  p_placa text default null,
  p_modelo text default null,
  p_marca text default null,
  p_ano integer default null,
  p_cor text default null
)
returns table (
  cliente_id uuid,
  veiculo_id uuid,
  cliente_novo boolean,
  veiculo_novo boolean,
  aviso text,
  limite_excedido boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant record;
  v_tel_norm text;
  v_cliente record;
  v_veiculo record;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_cliente_novo boolean := false;
  v_veiculo_novo boolean := false;
  v_aviso text := null;
  v_nome_limpo text;
  v_modelo_limpo text;
  v_obs_linha text;
  v_limite_excedido boolean := false;
begin
  -- Validação reforçada: tenant precisa existir, estar ativo e com agendamento online habilitado
  select * into v_tenant from public.tenants where id = p_tenant_id and ativo;
  if not found or not coalesce(v_tenant.agendamento_online_ativo, true) then
    raise exception 'Agendamento online indisponível para esta oficina.';
  end if;

  v_nome_limpo := trim(coalesce(p_nome, ''));
  if length(v_nome_limpo) < 2 then
    raise exception 'Nome inválido. Informe pelo menos 2 caracteres.';
  end if;

  v_tel_norm := public.normalizar_telefone(p_telefone);
  if v_tel_norm is null or length(v_tel_norm) not in (10, 11) then
    raise exception 'Telefone inválido.';
  end if;

  if p_categoria_id is not null then
    if not exists (
      select 1 from public.categorias_veiculo
      where id = p_categoria_id and tenant_id = p_tenant_id and ativo
    ) then
      raise exception 'Categoria de veículo inválida para esta oficina.';
    end if;
  end if;

  select * into v_cliente
  from public.clientes
  where tenant_id = p_tenant_id
    and public.normalizar_telefone(telefone) = v_tel_norm
  order by created_at asc
  limit 1;

  if v_cliente.id is not null then
    v_cliente_id := v_cliente.id;
    v_cliente_novo := false;

    if lower(trim(v_cliente.nome)) <> lower(v_nome_limpo) then
      v_obs_linha := '[agendamento online ' || to_char(now(), 'YYYY-MM-DD') || '] Cliente informou o nome "' || v_nome_limpo || '" neste agendamento.';
      update public.clientes
      set observacoes = case
            when observacoes is null or trim(observacoes) = '' then v_obs_linha
            else observacoes || E'\n' || v_obs_linha
          end,
          telefone = coalesce(telefone, p_telefone),
          updated_at = now()
      where id = v_cliente_id;
    end if;
  else
    insert into public.clientes (
      tenant_id, nome, telefone, observacoes
    ) values (
      p_tenant_id,
      v_nome_limpo,
      p_telefone,
      '[cadastro automático via agendamento online em ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']'
    )
    returning id into v_cliente_id;

    v_cliente_novo := true;
  end if;

  if p_placa is not null and trim(p_placa) <> '' then
    select * into v_veiculo
    from public.veiculos
    where tenant_id = p_tenant_id
      and upper(replace(replace(placa, '-', ''), ' ', '')) = upper(replace(replace(p_placa, '-', ''), ' ', ''))
    limit 1;

    if v_veiculo.id is null then
      v_modelo_limpo := coalesce(nullif(trim(p_modelo), ''), 'Veículo');

      insert into public.veiculos (
        tenant_id, cliente_id, categoria_id, placa, modelo, marca, ano, cor
      ) values (
        p_tenant_id,
        v_cliente_id,
        p_categoria_id,
        upper(trim(p_placa)),
        v_modelo_limpo,
        nullif(trim(p_marca), ''),
        p_ano,
        nullif(trim(p_cor), '')
      )
      returning id into v_veiculo_id;

      v_veiculo_novo := true;

      insert into public.veiculo_donos (
        tenant_id, veiculo_id, cliente_id, inicio
      ) values (
        p_tenant_id, v_veiculo_id, v_cliente_id, current_date
      );

    elsif v_veiculo.cliente_id is null then
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;

      update public.veiculos
      set cliente_id = v_cliente_id,
          categoria_id = coalesce(p_categoria_id, categoria_id),
          marca = coalesce(marca, trim(p_marca)),
          ano = coalesce(ano, p_ano),
          cor = coalesce(cor, trim(p_cor)),
          updated_at = now()
      where id = v_veiculo_id;

      if not exists (
        select 1 from public.veiculo_donos
        where veiculo_id = v_veiculo_id and cliente_id = v_cliente_id and fim is null
      ) then
        insert into public.veiculo_donos (
          tenant_id, veiculo_id, cliente_id, inicio
        ) values (
          p_tenant_id, v_veiculo_id, v_cliente_id, current_date
        );
      end if;

    elsif v_veiculo.cliente_id = v_cliente_id then
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;

      update public.veiculos
      set marca = coalesce(marca, trim(p_marca)),
          ano = coalesce(ano, p_ano),
          cor = coalesce(cor, trim(p_cor)),
          updated_at = now()
      where id = v_veiculo_id;

    else
      v_veiculo_id := v_veiculo.id;
      v_veiculo_novo := false;
      v_aviso := 'Placa já cadastrada para outro cliente. Confirmar troca de proprietário no check-in.';
    end if;
  else
    v_veiculo_id := null;
    v_veiculo_novo := false;
  end if;

  return query select v_cliente_id, v_veiculo_id, v_cliente_novo, v_veiculo_novo, v_aviso, v_limite_excedido;
end;
$$;

grant execute on function public.pre_registrar_cliente_e_veiculo_online(uuid, text, text, uuid, text, text, text, integer, text) to anon, authenticated;
grant execute on function public.registrar_cliente_veiculo_publico(uuid, text, text, uuid, text, text, text, integer, text) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
