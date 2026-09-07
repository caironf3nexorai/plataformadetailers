-- ==============================================================================
-- MIGRAÇÃO 0099: REFORÇO DE ISOLAMENTO DE SERVIÇOS E EXCLUSÃO SEGURA
-- ==============================================================================
-- Esta migração:
-- 1. Atualiza semear_servicos para receber p_tenant_id e validar pertencimento.
-- 2. Cria a RPC excluir_servico com verificação de integridade referencial:
--    - Exclui permanentemente se o serviço não tiver histórico em agendamentos/orçamentos.
--    - Desativa (soft-delete) se houver histórico para não quebrar integridade.
-- 3. Atualiza atualizar_servicos_em_massa para suportar p_campo = 'excluir'.
-- 4. Garante políticas de RLS estritas em public.servicos e public.servico_precos.

-- 1. ATUALIZAR semear_servicos COM SUPORTE A p_tenant_id
DROP FUNCTION IF EXISTS public.semear_servicos(uuid[]);
DROP FUNCTION IF EXISTS public.semear_servicos(uuid[], uuid);

CREATE OR REPLACE FUNCTION public.semear_servicos(
  p_modelo_ids uuid[],
  p_tenant_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_modelo record;
  v_servico_id uuid;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  -- Se o tenant_id foi informado explicitamente, valida pertencimento
  IF p_tenant_id IS NOT NULL THEN
    IF NOT (p_tenant_id IN (SELECT public.meus_tenants())) THEN
      RAISE EXCEPTION 'Acesso negado para a oficina especificada.';
    END IF;
    v_tenant_id := p_tenant_id;
  ELSE
    -- Fallback para usuário com 1 tenant
    SELECT tm.tenant_id INTO v_tenant_id
    FROM public.tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum tenant ativo encontrado para o usuário.';
  END IF;

  IF NOT public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas o dono ou gerente podem gerenciar serviços.';
  END IF;

  IF array_length(p_modelo_ids, 1) IS NULL OR array_length(p_modelo_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_modelo IN
    SELECT sm.nome, sm.grupo, sm.descricao_publica, sm.codigo, sm.modo_ocupacao, sm.duracao_sugerida, sm.ordem
    FROM public.servicos_modelo sm
    WHERE sm.id = ANY(p_modelo_ids)
  LOOP
    -- Verifica se já existe serviço ativo com o mesmo nome para o tenant
    SELECT s.id INTO v_servico_id
    FROM public.servicos s
    WHERE s.tenant_id = v_tenant_id AND lower(trim(s.nome)) = lower(trim(v_modelo.nome))
    ORDER BY s.ativo DESC, s.created_at DESC
    LIMIT 1;

    IF v_servico_id IS NULL THEN
      INSERT INTO public.servicos (
        tenant_id, nome, grupo, descricao_publica, codigo, modo_ocupacao, dias_ocupados, publico, sob_consulta, tom, ordem, ativo
      )
      VALUES (
        v_tenant_id,
        v_modelo.nome,
        v_modelo.grupo,
        v_modelo.descricao_publica,
        v_modelo.codigo,
        v_modelo.modo_ocupacao,
        CASE WHEN v_modelo.modo_ocupacao = 'multiplos_dias' THEN 2 ELSE 1 END,
        false,
        false,
        'vapor',
        v_modelo.ordem,
        true
      )
      RETURNING id INTO v_servico_id;

      v_count := v_count + 1;
    ELSE
      -- Se já existia mas estava inativo, reativa
      UPDATE public.servicos
      SET ativo = true, updated_at = now()
      WHERE id = v_servico_id;
    END IF;

    -- Sincroniza os preços para esse serviço
    PERFORM public.sincronizar_precos_servico(v_servico_id);
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.semear_servicos(uuid[], uuid) TO authenticated;


-- 2. RPC EXCLUIR SERVIÇO COM INTEGRIDADE REFERENCIAL
CREATE OR REPLACE FUNCTION public.excluir_servico(
  p_servico_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uso_count integer := 0;
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT (p_tenant_id IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(p_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem excluir serviços.';
  END IF;

  -- Verifica se o serviço pertence a esta oficina
  SELECT s.nome INTO v_nome
  FROM public.servicos s
  WHERE s.id = p_servico_id AND s.tenant_id = p_tenant_id;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Serviço não encontrado nesta oficina.';
  END IF;

  -- Conta referências em agendamentos e orçamentos
  SELECT (
    (SELECT count(*) FROM public.agendamentos WHERE servico_id = p_servico_id) +
    (SELECT count(*) FROM public.agendamento_itens WHERE servico_id = p_servico_id) +
    (SELECT count(*) FROM public.orcamento_nivel_itens WHERE servico_id = p_servico_id)
  ) INTO v_uso_count;

  IF v_uso_count > 0 THEN
    -- Serviço possui histórico: realiza desativação segura para manter o histórico íntegro
    UPDATE public.servicos
    SET ativo = false, updated_at = now()
    WHERE id = p_servico_id AND tenant_id = p_tenant_id;

    UPDATE public.servico_precos
    SET ativo = false, updated_at = now()
    WHERE servico_id = p_servico_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object(
      'sucesso', true,
      'tipo', 'desativado',
      'mensagem', 'O serviço possui histórico em agendamentos/orçamentos e foi desativado para preservar os relatórios.'
    );
  ELSE
    -- Serviço sem histórico: exclusão permanente e limpa
    DELETE FROM public.servico_precos WHERE servico_id = p_servico_id AND tenant_id = p_tenant_id;
    DELETE FROM public.combo_servicos WHERE servico_id = p_servico_id;
    DELETE FROM public.servicos WHERE id = p_servico_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object(
      'sucesso', true,
      'tipo', 'excluido',
      'mensagem', 'Serviço excluído permanentemente com sucesso.'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_servico(uuid, uuid) TO authenticated;


-- 3. ATUALIZAR atualizar_servicos_em_massa COM SUPORTE A 'excluir'
CREATE OR REPLACE FUNCTION public.atualizar_servicos_em_massa(
  p_ids uuid[],
  p_campo text,
  p_valor boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_count integer := 0;
  v_matching_count integer;
  v_id uuid;
  v_res jsonb;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  IF p_campo NOT IN ('ativo', 'publico', 'excluir') THEN
    RAISE EXCEPTION 'Campo inválido para ação em massa. Use "ativo", "publico" ou "excluir".';
  END IF;

  -- Obter tenant do primeiro id
  SELECT tenant_id INTO v_tenant
  FROM public.servicos
  WHERE id = p_ids[1];

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhum serviço encontrado para os IDs fornecidos.';
  END IF;

  IF NOT (v_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem realizar alterações em massa.';
  END IF;

  -- Valida que TODOS os ids pertencem ao mesmo tenant
  SELECT count(*) INTO v_matching_count
  FROM public.servicos
  WHERE id = ANY(p_ids) AND tenant_id = v_tenant;

  IF v_matching_count <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'Operação cancelada: nem todos os serviços pertencem à mesma oficina.';
  END IF;

  IF p_campo = 'ativo' THEN
    UPDATE public.servicos
    SET ativo = p_valor, updated_at = now()
    WHERE id = ANY(p_ids) AND tenant_id = v_tenant;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_campo = 'publico' THEN
    UPDATE public.servicos
    SET publico = p_valor, updated_at = now()
    WHERE id = ANY(p_ids) AND tenant_id = v_tenant;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_campo = 'excluir' THEN
    FOREACH v_id IN ARRAY p_ids LOOP
      PERFORM public.excluir_servico(v_id, v_tenant);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_servicos_em_massa(uuid[], text, boolean) TO authenticated;
