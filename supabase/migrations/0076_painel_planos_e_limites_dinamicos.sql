-- Migration 0076: Painel de Planos e Limites Dinâmicos Unificados
-- Permite configurar Preço, Ativo, Habilitação de Features e Limites Numéricos por Recurso em cada plano em uma única transação auditada.

-- 1. Função para listar planos com todas as features e limites unificados
DROP FUNCTION IF EXISTS public.admin_listar_planos_completos();

CREATE OR REPLACE FUNCTION public.admin_listar_planos_completos()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT jsonb_build_object(
    'catalogo', (
      SELECT jsonb_agg(to_jsonb(fc) ORDER BY fc.ordem ASC, fc.nome ASC)
      FROM public.feature_catalogo fc
    ),
    'planos', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'codigo', p.codigo,
          'nome', p.nome,
          'preco_centavos', p.preco_centavos,
          'ativo', p.ativo,
          'features', COALESCE((
            SELECT jsonb_object_agg(pf.feature, pf.habilitado)
            FROM public.plan_features pf
            WHERE pf.plano = p.codigo
          ), '{}'::jsonb),
          'limites', COALESCE((
            SELECT jsonb_object_agg(pl.recurso, pl.limite)
            FROM public.plan_limits pl
            WHERE pl.plano = p.codigo
          ), '{}'::jsonb)
        )
        ORDER BY p.preco_centavos ASC, p.codigo ASC
      )
      FROM public.plans p
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_planos_completos() TO authenticated;


-- 2. Função para salvar plano completo (Preço, Ativo, Features Habilitadas e Limites Numéricos)
DROP FUNCTION IF EXISTS public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB);

CREATE OR REPLACE FUNCTION public.admin_salvar_plano_completo(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER,
  p_ativo BOOLEAN,
  p_features JSONB, -- Ex: {"personalizacao_pdf": true, "arquivos_digitais": false}
  p_limites JSONB  -- Ex: {"clientes": 50, "agendamentos": null, "personalizacao_pdf": 10}
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_val JSONB;
  v_limite_num INTEGER;
  v_hab BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores editores podem alterar planos.';
  END IF;

  -- Actualiza plano básico
  UPDATE public.plans
  SET 
    nome = TRIM(p_nome),
    preco_centavos = p_preco_centavos,
    ativo = p_ativo,
    updated_at = NOW()
  WHERE codigo = LOWER(TRIM(p_codigo));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano % não encontrado.', p_codigo;
  END IF;

  -- Atualiza features (habilitado/desabilitado)
  IF p_features IS NOT NULL AND jsonb_typeof(p_features) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_features)
    LOOP
      v_hab := (v_val::text = 'true');
      INSERT INTO public.plan_features (plano, feature, habilitado, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_hab, NOW())
      ON CONFLICT (plano, feature) DO UPDATE
      SET habilitado = EXCLUDED.habilitado, updated_at = NOW();
    END LOOP;
  END IF;

  -- Atualiza limites numéricos
  IF p_limites IS NOT NULL AND jsonb_typeof(p_limites) = 'object' THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_limites)
    LOOP
      IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' OR v_val::text = 'null' THEN
        v_limite_num := NULL;
      ELSE
        v_limite_num := (v_val::text)::INTEGER;
      END IF;

      INSERT INTO public.plan_limits (plano, recurso, limite, updated_at)
      VALUES (LOWER(TRIM(p_codigo)), v_key, v_limite_num, NOW())
      ON CONFLICT (plano, recurso) DO UPDATE
      SET limite = EXCLUDED.limite, updated_at = NOW();
    END LOOP;
  END IF;

  -- Registrar na auditoria
  INSERT INTO public.audit_logs (usuario_id, email, acao, entidade, registro_id, detalhes)
  VALUES (
    auth.uid(),
    public.current_admin_email(),
    'ATUALIZAR_PLANO_COMPLETO',
    'plans',
    p_codigo,
    jsonb_build_object(
      'nome', p_nome,
      'preco_centavos', p_preco_centavos,
      'ativo', p_ativo,
      'features', p_features,
      'limites', p_limites
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_plano_completo(TEXT, TEXT, INTEGER, BOOLEAN, JSONB, JSONB) TO authenticated;
