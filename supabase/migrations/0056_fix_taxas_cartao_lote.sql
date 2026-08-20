-- Migration 0056: Correção na RPC salvar_taxas_cartao_lote e eliminação de conflito de vigência sobreposta

-- 1. Limpa registros corrompidos/sobrepostos anteriores resultantes de tentativas de salvamento no mesmo dia
DELETE FROM public.taxas_cartao
WHERE vigencia_fim IS NOT NULL AND vigencia_fim <= vigencia_inicio;

-- 2. Redefinição da RPC salvar_taxas_cartao_lote com substituição limpa para mesma data de início
CREATE OR REPLACE FUNCTION public.salvar_taxas_cartao_lote(
  p_maquininha_id uuid,
  p_vigencia_inicio date,
  p_taxas jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_item jsonb;
  v_tipo text;
  v_bandeira text;
  v_parcelas integer;
  v_perc numeric(5,2);
  v_fixa numeric(10,2);
BEGIN
  -- 1. Validação de autorização e tenant
  SELECT tenant_id INTO v_tenant FROM public.tenant_maquininhas WHERE id = p_maquininha_id;
  IF v_tenant IS NULL OR NOT (v_tenant IN (SELECT public.meus_tenants())) OR NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas dono e gerente podem configurar taxas de cartão.';
  END IF;

  IF p_vigencia_inicio IS NULL THEN
    RAISE EXCEPTION 'A data de início da vigência é obrigatória.';
  END IF;

  -- 2. Exclui taxas da mesma maquininha que foram criadas para iniciar no MESMO dia ou em data futura (substituição do lote ativo/rascunho)
  DELETE FROM public.taxas_cartao
  WHERE maquininha_id = p_maquininha_id
    AND vigencia_inicio >= p_vigencia_inicio;

  -- 3. Encerra vigência de taxas passadas (que iniciaram estritamente ANTES de p_vigencia_inicio) no dia anterior
  UPDATE public.taxas_cartao
  SET vigencia_fim = (p_vigencia_inicio - interval '1 day')::date
  WHERE maquininha_id = p_maquininha_id
    AND vigencia_inicio < p_vigencia_inicio
    AND (vigencia_fim IS NULL OR vigencia_fim >= p_vigencia_inicio);

  -- 4. Insere as novas taxas do lote
  IF p_taxas IS NOT NULL AND jsonb_array_length(p_taxas) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_taxas) LOOP
      v_tipo := v_item->>'tipo';
      v_bandeira := nullif(trim(v_item->>'bandeira_codigo'), '');
      v_parcelas := (v_item->>'parcelas')::integer;
      v_perc := (v_item->>'taxa_percentual')::numeric(5,2);
      v_fixa := COALESCE((v_item->>'taxa_fixa')::numeric(10,2), 0.00);

      IF v_perc IS NOT NULL AND v_perc >= 0 THEN
        INSERT INTO public.taxas_cartao (
          tenant_id, maquininha_id, tipo, bandeira_codigo, parcelas,
          taxa_percentual, taxa_fixa, vigencia_inicio, criado_por
        ) VALUES (
          v_tenant, p_maquininha_id, v_tipo, v_bandeira, v_parcelas,
          v_perc, v_fixa, p_vigencia_inicio, auth.uid()
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_taxas_cartao_lote(uuid, date, jsonb) TO authenticated;
