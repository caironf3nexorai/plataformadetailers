-- Migration 0104: Exclusão de Funcionalidade do Catálogo pelo Admin
-- Permite que administradores com permissão de edição excluam recursos cadastrados no catálogo

CREATE OR REPLACE FUNCTION public.admin_excluir_feature_catalogo(p_chave TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_chave_clean TEXT;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Apenas administradores da plataforma podem excluir recursos.';
  END IF;

  v_chave_clean := LOWER(TRIM(p_chave));
  IF v_chave_clean = '' THEN
    RAISE EXCEPTION 'A chave do recurso não pode ser vazia.';
  END IF;

  -- 1. Excluir da matriz de permissões dos planos
  DELETE FROM public.plan_features WHERE feature = v_chave_clean;

  -- 2. Excluir do catálogo de funcionalidades
  DELETE FROM public.feature_catalogo WHERE chave = v_chave_clean;

  -- 3. Registrar auditoria se existir a tabela platform_admin_audit
  BEGIN
    INSERT INTO public.platform_admin_audit (admin_id, acao, entidade, registro_id, dados_anteriores)
    VALUES (
      auth.uid(),
      'EXCLUIR_FEATURE',
      'feature_catalogo',
      v_chave_clean,
      jsonb_build_object('chave', v_chave_clean)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Ignora se tabela de auditoria não estiver presente
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_excluir_feature_catalogo(text) TO authenticated;
