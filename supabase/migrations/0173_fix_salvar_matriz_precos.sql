-- ==============================================================================
-- MIGRAÇÃO 0173: CORRIGIR RPC salvar_matriz_precos (MATRIZ DE PREÇOS E DURAÇÕES)
-- ==============================================================================
-- Problemas corrigidos em relação às migrações 0043 e 0095:
-- 1. Restaura a gravação de duracao_confirmada (omitida desde 0043), permitindo que
--    a confirmação na Matriz de Preços conclua o estado "Estimado" e o onboarding.
-- 2. Preserva preco_base = NULL quando vazio ou serviço "sob_consulta = true"
--    (antes 0043/0095 forçava 0.00).
-- 3. Tolera valores numéricos decimais ou textuais em duracao_minutos sem quebrar
--    cast ::integer (evita erro 22P02 invalid input syntax for type integer) e
--    garante intervalo seguro >= 1 min.
-- 4. Tolera p_linhas nulo/vazio, ignora categoria_id inexistente ou de outro tenant
--    e autoriza explicitamente tem_papel(dono/gerente) OR is_platform_admin().
-- ==============================================================================

-- 0. Garante de forma idempotente que a coluna unidade_duracao existe em servico_precos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'servico_precos'
      AND column_name = 'unidade_duracao'
  ) THEN
    ALTER TABLE public.servico_precos
      ADD COLUMN unidade_duracao text DEFAULT NULL
      CHECK (unidade_duracao IS NULL OR unidade_duracao IN ('min', 'horas', 'dias'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.salvar_matriz_precos(p_servico uuid, p_linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_sob_consulta boolean := false;
  v_linha jsonb;
  v_cat_id uuid;
  v_cat_text text;
  v_preco_raw text;
  v_preco numeric(10,2);
  v_duracao_raw text;
  v_duracao integer;
  v_unidade text;
  v_duracao_conf boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT s.tenant_id, COALESCE(s.sob_consulta, false)
  INTO v_tenant_id, v_sob_consulta
  FROM public.servicos s
  WHERE s.id = p_servico;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Serviço não encontrado.';
  END IF;

  IF NOT (
    public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[])
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem alterar preços.';
  END IF;

  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RETURN;
  END IF;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_cat_text := NULLIF(trim(COALESCE(v_linha->>'categoria_id', '')), '');
    IF v_cat_text IS NULL THEN
      CONTINUE;
    END IF;

    BEGIN
      v_cat_id := v_cat_text::uuid;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    -- Garante que a categoria pertence à mesma oficina antes do upsert
    IF NOT EXISTS (
      SELECT 1
      FROM public.categorias_veiculo cv
      WHERE cv.id = v_cat_id
        AND cv.tenant_id = v_tenant_id
    ) THEN
      CONTINUE;
    END IF;

    -- Trata preço base preservando NULL em células vazias ou serviços sob consulta
    v_preco_raw := NULLIF(trim(COALESCE(v_linha->>'preco_base', '')), '');
    IF v_sob_consulta
       OR v_preco_raw IS NULL
       OR lower(v_preco_raw) IN ('null', 'nan', 'undefined') THEN
      v_preco := NULL;
    ELSE
      BEGIN
        v_preco := LEAST(
          99999999.99,
          GREATEST(
            0.00,
            ROUND(
              (
                CASE
                  WHEN position(',' IN v_preco_raw) > 0 AND position('.' IN v_preco_raw) > 0 THEN
                    replace(replace(v_preco_raw, '.', ''), ',', '.')
                  WHEN position(',' IN v_preco_raw) > 0 THEN
                    replace(v_preco_raw, ',', '.')
                  ELSE
                    v_preco_raw
                END
              )::numeric,
              2
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN
        v_preco := NULL;
      END;
    END IF;

    -- Trata duração com segurança para decimais/strings sem falhar no cast ::integer
    v_duracao_raw := NULLIF(trim(COALESCE(v_linha->>'duracao_minutos', '')), '');
    IF v_duracao_raw IS NULL OR lower(v_duracao_raw) IN ('null', 'nan', 'undefined') THEN
      v_duracao := 60;
    ELSE
      BEGIN
        v_duracao := ROUND(replace(v_duracao_raw, ',', '.')::numeric)::integer;
        IF v_duracao <= 0 THEN
          v_duracao := 60;
        ELSIF v_duracao > 525600 THEN
          v_duracao := 525600;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_duracao := 60;
      END;
    END IF;

    -- Valida unidade de duração
    v_unidade := NULLIF(trim(COALESCE(v_linha->>'unidade_duracao', '')), '');
    IF v_unidade IS NOT NULL AND v_unidade NOT IN ('min', 'horas', 'dias') THEN
      v_unidade := 'min';
    END IF;

    -- Qualquer salvamento ou confirmação manual marca duracao_confirmada = true por padrão
    BEGIN
      v_duracao_conf := COALESCE((v_linha->>'duracao_confirmada')::boolean, true);
    EXCEPTION WHEN OTHERS THEN
      v_duracao_conf := true;
    END;

    INSERT INTO public.servico_precos (
      tenant_id,
      servico_id,
      categoria_id,
      preco_base,
      duracao_minutos,
      unidade_duracao,
      duracao_confirmada,
      ativo
    ) VALUES (
      v_tenant_id,
      p_servico,
      v_cat_id,
      v_preco,
      v_duracao,
      v_unidade,
      v_duracao_conf,
      true
    )
    ON CONFLICT (servico_id, categoria_id) DO UPDATE
    SET preco_base = EXCLUDED.preco_base,
        duracao_minutos = EXCLUDED.duracao_minutos,
        unidade_duracao = COALESCE(EXCLUDED.unidade_duracao, public.servico_precos.unidade_duracao),
        duracao_confirmada = EXCLUDED.duracao_confirmada,
        ativo = true,
        updated_at = now();
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_matriz_precos(uuid, jsonb) TO authenticated;

-- Saneia eventuais serviços sob_consulta que tenham recebido 0.00 por efeito de 0043/0095
UPDATE public.servico_precos sp
SET preco_base = NULL,
    updated_at = now()
FROM public.servicos s
WHERE sp.servico_id = s.id
  AND s.sob_consulta = true
  AND sp.preco_base = 0.00;

NOTIFY pgrst, 'reload schema';
