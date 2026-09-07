-- ==============================================================================
-- MIGRAÇÃO 0095: UNIDADE DE DURAÇÃO DE SERVIÇOS E CADASTRO RÁPIDO DE PRODUTOS
-- ==============================================================================

-- 1. ADICIONAR COLUNAS DE UNIDADE DE DURAÇÃO (min, horas, dias)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'servicos' 
      AND column_name = 'unidade_duracao'
  ) THEN
    ALTER TABLE public.servicos 
    ADD COLUMN unidade_duracao text NOT NULL DEFAULT 'min' 
    CHECK (unidade_duracao IN ('min', 'horas', 'dias'));
  END IF;
END $$;

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

COMMENT ON COLUMN public.servicos.unidade_duracao IS 'Unidade de medida padrão selecionada pelo usuário para a duração deste serviço (min, horas ou dias).';
COMMENT ON COLUMN public.servico_precos.unidade_duracao IS 'Unidade de medida específica desta categoria de veículo para a duração (min, horas ou dias).';


-- 2. RPC CADASTRAR_PRODUTO_RAPIDO
-- Permite que membros ativos (donos, gerentes e operadores) cadastrem um insumo diretamente no fluxo de finalização de OS
CREATE OR REPLACE FUNCTION public.cadastrar_produto_rapido(
  p_tenant_id uuid,
  p_nome text,
  p_marca text DEFAULT NULL,
  p_categoria text DEFAULT 'Geral',
  p_unidade_uso text DEFAULT 'ml',
  p_tamanho_compra numeric DEFAULT 1000,
  p_preco_compra numeric DEFAULT 0,
  p_estoque_minimo numeric DEFAULT 0,
  p_estoque_atual numeric DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid;
  v_novo_id uuid;
  v_custo_unitario numeric(12,6);
  v_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  -- Validar se o usuário pertence ao tenant com qualquer papel ativo (dono, gerente ou operador)
  IF NOT public.tem_papel(p_tenant_id, ARRAY['dono', 'gerente', 'operador']::app_role[]) THEN
    RAISE EXCEPTION 'Você não tem permissão para cadastrar produtos neste estabelecimento.';
  END IF;

  IF trim(coalesce(p_nome, '')) = '' THEN
    RAISE EXCEPTION 'O nome do produto é obrigatório.';
  END IF;

  IF p_tamanho_compra <= 0 THEN
    RAISE EXCEPTION 'O tamanho de compra deve ser maior que zero.';
  END IF;

  IF p_preco_compra < 0 THEN
    RAISE EXCEPTION 'O preço de compra não pode ser negativo.';
  END IF;

  -- Calcular custo unitário
  v_custo_unitario := CASE 
    WHEN coalesce(p_tamanho_compra, 0) > 0 THEN round(p_preco_compra / p_tamanho_compra, 6)
    ELSE 0
  END;

  -- Inserir produto
  INSERT INTO public.produtos (
    tenant_id,
    nome,
    marca,
    categoria,
    unidade_uso,
    tamanho_compra,
    preco_compra,
    custo_unitario,
    estoque_atual,
    estoque_minimo,
    ativo
  ) VALUES (
    p_tenant_id,
    trim(p_nome),
    CASE WHEN trim(coalesce(p_marca, '')) = '' THEN NULL ELSE trim(p_marca) END,
    coalesce(p_categoria, 'Geral'),
    coalesce(p_unidade_uso, 'ml'),
    p_tamanho_compra,
    p_preco_compra,
    v_custo_unitario,
    coalesce(p_estoque_atual, p_tamanho_compra),
    coalesce(p_estoque_minimo, 0),
    true
  )
  ON CONFLICT (tenant_id, nome, marca) DO UPDATE
    SET ativo = true,
        updated_at = now()
  RETURNING id INTO v_novo_id;

  -- Se houve estoque inicial informado e movimento precisa ser registrado
  IF coalesce(p_estoque_atual, 0) > 0 THEN
    INSERT INTO public.estoque_movimentos (
      tenant_id,
      produto_id,
      tipo,
      quantidade,
      custo_unitario,
      custo_total,
      observacao,
      criado_por
    ) VALUES (
      p_tenant_id,
      v_novo_id,
      'entrada',
      p_estoque_atual,
      v_custo_unitario,
      round(p_estoque_atual * v_custo_unitario, 2),
      'Cadastro rápido durante finalização de atendimento',
      v_user_id
    );
  END IF;

  -- Retornar objeto do produto criado para o frontend
  SELECT jsonb_build_object(
    'id', p.id,
    'nome', p.nome,
    'marca', p.marca,
    'categoria', p.categoria,
    'unidade_uso', p.unidade_uso,
    'tamanho_compra', p.tamanho_compra,
    'preco_compra', p.preco_compra,
    'custo_unitario', p.custo_unitario,
    'estoque_atual', p.estoque_atual,
    'estoque_minimo', p.estoque_minimo,
    'ativo', p.ativo
  ) INTO v_result
  FROM public.produtos p
  WHERE p.id = v_novo_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cadastrar_produto_rapido(
  uuid, text, text, text, text, numeric, numeric, numeric, numeric
) TO authenticated;


-- 3. ATUALIZAR SALVAR_MATRIZ_PRECOS PARA PERSISTIR UNIDADE_DURACAO
CREATE OR REPLACE FUNCTION public.salvar_matriz_precos(p_servico uuid, p_linhas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_linha jsonb;
  v_cat_id uuid;
  v_preco numeric(10,2);
  v_duracao integer;
  v_unidade text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.servicos WHERE id = p_servico;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Serviço não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem alterar preços.';
  END IF;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_cat_id := (v_linha->>'categoria_id')::uuid;
    v_preco := coalesce((v_linha->>'preco_base')::numeric, 0.00);
    v_duracao := coalesce((v_linha->>'duracao_minutos')::integer, 60);
    v_unidade := v_linha->>'unidade_duracao';

    IF v_unidade IS NOT NULL AND v_unidade NOT IN ('min', 'horas', 'dias') THEN
      v_unidade := 'min';
    END IF;

    INSERT INTO public.servico_precos (
      tenant_id, servico_id, categoria_id, preco_base, duracao_minutos, unidade_duracao, ativo
    ) VALUES (
      v_tenant_id, p_servico, v_cat_id, v_preco, v_duracao, v_unidade, true
    )
    ON CONFLICT (servico_id, categoria_id) DO UPDATE
    SET preco_base = excluded.preco_base,
        duracao_minutos = excluded.duracao_minutos,
        unidade_duracao = coalesce(excluded.unidade_duracao, servico_precos.unidade_duracao),
        ativo = true,
        updated_at = now();
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_matriz_precos(uuid, jsonb) TO authenticated;
