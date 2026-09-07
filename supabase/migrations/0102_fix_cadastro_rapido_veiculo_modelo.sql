-- Migration 0102: Correção de cadastro_rapido para atualizar modelo, marca, cor e categoria do veículo
-- Garante que se o veículo já existir pela placa ou for provisório, os novos dados digitados (modelo, marca, categoria, cor)
-- substituam os dados antigos em vez de manter modelos legados (ex: Titan 160 ao cadastrar Camaro).

CREATE OR REPLACE FUNCTION public.cadastro_rapido(
  p_nome text,
  p_telefone text,
  p_placa text default null,
  p_categoria uuid default null,
  p_marca text default null,
  p_modelo text default null,
  p_cor text default null
)
RETURNS TABLE (out_cliente_id uuid, out_veiculo_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_placa_clean text;
  v_existente_id uuid;
  v_existente_cliente_id uuid;
  v_is_generica boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum tenant ativo encontrado para o usuário.';
  END IF;

  IF NOT public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Operadores não podem cadastrar clientes ou veículos.';
  END IF;

  IF coalesce(trim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Nome do cliente é obrigatório.';
  END IF;

  IF coalesce(trim(p_telefone), '') = '' THEN
    RAISE EXCEPTION 'Telefone do cliente é obrigatório.';
  END IF;

  -- 1. Busca ou cria o cliente pelo telefone
  SELECT c.id INTO v_cliente_id
  FROM public.clientes c
  WHERE c.tenant_id = v_tenant_id AND c.telefone = trim(p_telefone) AND c.ativo = true
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (tenant_id, nome, telefone)
    VALUES (v_tenant_id, trim(p_nome), trim(p_telefone))
    RETURNING clientes.id INTO v_cliente_id;
  END IF;

  -- 2. Se informou dados do veículo
  IF p_placa IS NOT NULL AND trim(p_placa) <> '' THEN
    v_placa_clean := upper(trim(p_placa));
    
    -- Verifica se é placa genérica provisória
    IF v_placa_clean IN ('SEMPLACA', 'SEM PLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE') OR v_placa_clean LIKE 'ORC%' THEN
      v_is_generica := true;
    END IF;

    -- Só reaproveita veículo existente se NÃO for placa genérica compartilhada ou se for do mesmo cliente
    IF NOT v_is_generica THEN
      SELECT v.id, v.cliente_id INTO v_existente_id, v_existente_cliente_id
      FROM public.veiculos v
      WHERE v.tenant_id = v_tenant_id AND v.placa = v_placa_clean
      LIMIT 1;
    ELSE
      -- Para placas genéricas, só reaproveita se já for do MESMO cliente
      SELECT v.id, v.cliente_id INTO v_existente_id, v_existente_cliente_id
      FROM public.veiculos v
      WHERE v.tenant_id = v_tenant_id AND v.cliente_id = v_cliente_id AND v.placa = v_placa_clean
      LIMIT 1;
    END IF;

    IF v_existente_id IS NOT NULL THEN
      v_veiculo_id := v_existente_id;

      IF v_existente_cliente_id IS DISTINCT FROM v_cliente_id THEN
        PERFORM public.transferir_veiculo(v_veiculo_id, v_cliente_id, current_date);
      END IF;

      -- Atualiza TODOS os dados do veículo com as novas informações fornecidas pelo usuário
      UPDATE public.veiculos
      SET 
        modelo = coalesce(nullif(trim(p_modelo), ''), modelo),
        marca = coalesce(nullif(trim(p_marca), ''), marca),
        categoria_id = coalesce(p_categoria, categoria_id),
        cor = coalesce(nullif(trim(p_cor), ''), cor)
      WHERE id = v_veiculo_id;
    ELSE
      IF p_categoria IS NULL THEN
        RAISE EXCEPTION 'Categoria do veículo é obrigatória para novo veículo.';
      END IF;

      -- Se for genérica e já existir para outro cliente, gera placa provisória única
      IF v_is_generica AND EXISTS (SELECT 1 FROM public.veiculos WHERE tenant_id = v_tenant_id AND placa = v_placa_clean) THEN
        v_placa_clean := 'PROV-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8);
      END IF;

      INSERT INTO public.veiculos (tenant_id, cliente_id, categoria_id, placa, marca, modelo, cor)
      VALUES (v_tenant_id, v_cliente_id, p_categoria, v_placa_clean, trim(p_marca), trim(p_modelo), trim(p_cor))
      RETURNING veiculos.id INTO v_veiculo_id;

      INSERT INTO public.veiculo_donos (tenant_id, veiculo_id, cliente_id, inicio, fim)
      VALUES (v_tenant_id, v_veiculo_id, v_cliente_id, current_date, null);
    END IF;
  END IF;

  out_cliente_id := v_cliente_id;
  out_veiculo_id := v_veiculo_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cadastro_rapido(text, text, text, uuid, text, text, text) TO authenticated;
