-- =========================================================================================
-- MIGRATION 0100: CORREÇÃO E PERSISTÊNCIA DE TEMPO DE DURAÇÃO NOS NÍVEIS E ITENS DE ORÇAMENTO
-- =========================================================================================
-- Garante que:
-- 1. salvar_nivel_orcamento sempre busque e persista a duração correta de cada serviço (da matriz)
--    mesmo quando preços customizados ou itens sem duração explícita forem enviados.
-- 2. orcamento_niveis.duracao_total seja sempre a soma real das durações dos serviços do nível.
-- 3. Itens já existentes em orçamentos anteriores sejam recalculados com a duração correta da matriz.
-- =========================================================================================

CREATE OR REPLACE FUNCTION public.salvar_nivel_orcamento(
  p_nivel uuid,
  p_itens jsonb,
  p_titulo text default null,
  p_descricao text default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_nivel_rec record;
  v_orcamento_rec record;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_preco numeric(10,2);
  v_preco_custom numeric(10,2);
  v_duracao integer;
  v_duracao_custom integer;
  v_total_valor numeric(10,2) := 0;
  v_total_duracao integer := 0;
  v_ordem smallint := 1;
BEGIN
  SELECT n.* INTO v_nivel_rec FROM public.orcamento_niveis n WHERE n.id = p_nivel;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nível de orçamento não encontrado.';
  END IF;

  SELECT o.* INTO v_orcamento_rec FROM public.orcamentos o WHERE o.id = v_nivel_rec.orcamento_id;

  IF NOT public.tem_papel(v_orcamento_rec.tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem editar orçamentos.';
  END IF;

  -- Atualiza título e descrição do nível se informados
  UPDATE public.orcamento_niveis
  SET titulo = coalesce(p_titulo, titulo),
      descricao = coalesce(p_descricao, descricao)
  WHERE id = p_nivel;

  -- Deleta itens anteriores do nível
  DELETE FROM public.orcamento_nivel_itens WHERE nivel_id = p_nivel;

  -- Inserção dos itens com suporte a preço customizado e duração por categoria
  IF p_itens IS NOT NULL AND jsonb_array_length(p_itens) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
    LOOP
      v_servico_id := nullif(v_item->>'servico_id', '')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

      v_preco_custom := CASE 
        WHEN v_item ? 'preco' AND nullif(v_item->>'preco', '') IS NOT NULL 
        THEN (v_item->>'preco')::numeric(10,2) 
        ELSE null 
      END;

      v_duracao_custom := CASE 
        WHEN v_item ? 'duracao_minutos' AND nullif(v_item->>'duracao_minutos', '') IS NOT NULL 
        THEN (v_item->>'duracao_minutos')::integer 
        ELSE null 
      END;

      v_preco := 0;
      v_duracao := 60;

      IF v_combo_id IS NOT NULL THEN
        -- Resolve Preço do Combo
        IF v_preco_custom IS NOT NULL AND v_preco_custom >= 0 THEN
          v_preco := v_preco_custom;
        ELSE
          SELECT cp.preco_base
          INTO v_preco
          FROM public.combo_precos cp
          WHERE cp.combo_id = v_combo_id
            AND (cp.ativo IS TRUE OR cp.ativo IS NULL)
            AND cp.preco_base IS NOT NULL
          ORDER BY (CASE WHEN cp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;
        END IF;

        -- Resolve Duração do Combo
        IF v_duracao_custom IS NOT NULL AND v_duracao_custom > 0 THEN
          v_duracao := v_duracao_custom;
        ELSE
          SELECT coalesce(cp.duracao_minutos, 60)
          INTO v_duracao
          FROM public.combo_precos cp
          WHERE cp.combo_id = v_combo_id
            AND (cp.ativo IS TRUE OR cp.ativo IS NULL)
          ORDER BY (CASE WHEN cp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;
        END IF;

        v_preco := coalesce(v_preco, 0);
        v_duracao := coalesce(v_duracao, 60);

        INSERT INTO public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, preco, duracao_minutos, ordem
        ) VALUES (
          v_orcamento_rec.tenant_id, p_nivel, null, v_combo_id, v_preco, v_duracao, v_ordem
        );

        v_total_valor := v_total_valor + v_preco;
        v_total_duracao := v_total_duracao + v_duracao;
        v_ordem := v_ordem + 1;

      ELSIF v_servico_id IS NOT NULL THEN
        -- Resolve Preço do Serviço
        IF v_preco_custom IS NOT NULL AND v_preco_custom >= 0 THEN
          v_preco := v_preco_custom;
        ELSE
          -- Tenta buscar preço da categoria do orçamento
          SELECT sp.preco_base
          INTO v_preco
          FROM public.servico_precos sp
          WHERE sp.servico_id = v_servico_id
            AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
            AND sp.preco_base IS NOT NULL
            AND sp.preco_base > 0
          ORDER BY (CASE WHEN sp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;

          -- Fallback seguro: se não achou para a categoria, busca qualquer preço ativo do serviço
          IF v_preco IS NULL OR v_preco = 0 THEN
            SELECT sp.preco_base
            INTO v_preco
            FROM public.servico_precos sp
            WHERE sp.servico_id = v_servico_id
              AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
              AND sp.preco_base IS NOT NULL
            ORDER BY sp.preco_base DESC
            LIMIT 1;
          END IF;
        END IF;

        -- Resolve Duração do Serviço
        IF v_duracao_custom IS NOT NULL AND v_duracao_custom > 0 THEN
          v_duracao := v_duracao_custom;
        ELSE
          -- Tenta buscar duração da categoria do orçamento
          SELECT coalesce(sp.duracao_minutos, 60)
          INTO v_duracao
          FROM public.servico_precos sp
          WHERE sp.servico_id = v_servico_id
            AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
            AND sp.duracao_minutos IS NOT NULL
            AND sp.duracao_minutos > 0
          ORDER BY (CASE WHEN sp.categoria_id = v_orcamento_rec.categoria_id THEN 0 ELSE 1 END)
          LIMIT 1;

          -- Fallback seguro para duração de qualquer categoria do serviço
          IF v_duracao IS NULL OR v_duracao <= 0 THEN
            SELECT coalesce(sp.duracao_minutos, 60)
            INTO v_duracao
            FROM public.servico_precos sp
            WHERE sp.servico_id = v_servico_id
              AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
              AND sp.duracao_minutos IS NOT NULL
              AND sp.duracao_minutos > 0
            LIMIT 1;
          END IF;
        END IF;

        v_preco := coalesce(v_preco, 0);
        v_duracao := coalesce(v_duracao, 60);

        INSERT INTO public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, preco, duracao_minutos, ordem
        ) VALUES (
          v_orcamento_rec.tenant_id, p_nivel, v_servico_id, null, v_preco, v_duracao, v_ordem
        );

        v_total_valor := v_total_valor + v_preco;
        v_total_duracao := v_total_duracao + v_duracao;
        v_ordem := v_ordem + 1;
      END IF;
    END LOOP;
  END IF;

  -- Recalcula totais do nível
  UPDATE public.orcamento_niveis
  SET valor_total = v_total_valor,
      duracao_total = v_total_duracao
  WHERE id = p_nivel;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_nivel_orcamento(uuid, jsonb, text, text) TO authenticated;

-- =========================================================================================
-- BACKFILL: Atualiza orcamento_nivel_itens anteriores com duração dos serviços na matriz
-- =========================================================================================
DO $$
DECLARE
  r_item RECORD;
  v_cat_id UUID;
  v_dur INT;
BEGIN
  FOR r_item IN
    SELECT i.id, i.servico_id, i.nivel_id, n.orcamento_id
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    WHERE i.servico_id IS NOT NULL
  LOOP
    SELECT o.categoria_id INTO v_cat_id FROM public.orcamentos o WHERE o.id = r_item.orcamento_id;

    SELECT sp.duracao_minutos INTO v_dur
    FROM public.servico_precos sp
    WHERE sp.servico_id = r_item.servico_id
      AND (sp.ativo IS TRUE OR sp.ativo IS NULL)
      AND sp.duracao_minutos IS NOT NULL
      AND sp.duracao_minutos > 0
    ORDER BY (CASE WHEN sp.categoria_id = v_cat_id THEN 0 ELSE 1 END)
    LIMIT 1;

    IF v_dur IS NOT NULL AND v_dur > 0 THEN
      UPDATE public.orcamento_nivel_itens
      SET duracao_minutos = v_dur
      WHERE id = r_item.id;
    END IF;
  END LOOP;

  -- Recalcula duracao_total em todos os orcamento_niveis
  UPDATE public.orcamento_niveis n
  SET duracao_total = coalesce(
    (SELECT sum(coalesce(i.duracao_minutos, 60)) FROM public.orcamento_nivel_itens i WHERE i.nivel_id = n.id),
    0
  );
END $$;
