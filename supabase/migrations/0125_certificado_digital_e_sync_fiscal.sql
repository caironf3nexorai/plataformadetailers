-- ==============================================================================
-- MIGRATION: 0125_certificado_digital_e_sync_fiscal.sql
-- DESCRIÇÃO: Suporte a Certificado Digital A1 (.pfx/.p12) e sincronização
--            automática e 100% white-label para emissão de NFS-e.
-- ==============================================================================

-- 1. ADICIONAR COLUNAS DE CERTIFICADO DIGITAL NA TABELA DE CONFIG FISCAL
ALTER TABLE public.tenant_config_fiscal
  ADD COLUMN IF NOT EXISTS certificado_status TEXT DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS certificado_valido_ate TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certificado_nome_arquivo TEXT,
  ADD COLUMN IF NOT EXISTS certificado_enviado_em TIMESTAMPTZ;

-- 2. ATUALIZAR RPC: SALVAR CONFIGURAÇÃO FISCAL DO TENANT COM CERTIFICADO
CREATE OR REPLACE FUNCTION public.salvar_config_fiscal_tenant(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_clean_cnpj TEXT;
  v_cert_status TEXT;
  v_cert_valido TIMESTAMPTZ;
  v_cert_nome TEXT;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  v_clean_cnpj := regexp_replace(COALESCE(p_config->>'cnpj', ''), '[^0-9]', '', 'g');
  IF length(v_clean_cnpj) != 14 THEN
    RAISE EXCEPTION 'CNPJ inválido. Deve conter 14 dígitos.';
  END IF;

  v_cert_status := COALESCE(p_config->>'certificado_status', NULL);
  v_cert_valido := CASE 
    WHEN p_config->>'certificado_valido_ate' IS NOT NULL AND p_config->>'certificado_valido_ate' != '' 
    THEN (p_config->>'certificado_valido_ate')::timestamptz 
    ELSE NULL 
  END;
  v_cert_nome := COALESCE(p_config->>'certificado_nome_arquivo', NULL);

  INSERT INTO public.tenant_config_fiscal (
    tenant_id, cnpj, razao_social, nome_fantasia, inscricao_municipal,
    cnae, cnae_padrao, item_lista_servico, aliquota_iss, regime_tributario,
    ambiente, token_focus_nfe, certificado_status, certificado_valido_ate,
    certificado_nome_arquivo, certificado_enviado_em, updated_at
  ) VALUES (
    v_tenant,
    v_clean_cnpj,
    trim(COALESCE(p_config->>'razao_social', '')),
    trim(COALESCE(p_config->>'nome_fantasia', p_config->>'razao_social', '')),
    trim(COALESCE(p_config->>'inscricao_municipal', '')),
    trim(COALESCE(p_config->>'cnae_padrao', p_config->>'cnae', '4520-0/05')),
    trim(COALESCE(p_config->>'cnae_padrao', p_config->>'cnae', '4520-0/05')),
    trim(COALESCE(p_config->>'item_lista_servico', '14.01')),
    COALESCE((p_config->>'aliquota_iss')::numeric, 2.00),
    COALESCE(p_config->>'regime_tributario', '1'),
    COALESCE(p_config->>'ambiente', 'homologacao'),
    trim(COALESCE(p_config->>'token_focus_nfe', '')),
    COALESCE(v_cert_status, 'pendente'),
    v_cert_valido,
    v_cert_nome,
    CASE WHEN v_cert_status = 'ativo' THEN now() ELSE NULL END,
    now()
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    cnpj = EXCLUDED.cnpj,
    razao_social = EXCLUDED.razao_social,
    nome_fantasia = EXCLUDED.nome_fantasia,
    inscricao_municipal = EXCLUDED.inscricao_municipal,
    cnae = EXCLUDED.cnae,
    cnae_padrao = EXCLUDED.cnae_padrao,
    item_lista_servico = EXCLUDED.item_lista_servico,
    aliquota_iss = EXCLUDED.aliquota_iss,
    regime_tributario = EXCLUDED.regime_tributario,
    ambiente = EXCLUDED.ambiente,
    token_focus_nfe = COALESCE(NULLIF(EXCLUDED.token_focus_nfe, ''), tenant_config_fiscal.token_focus_nfe),
    certificado_status = COALESCE(v_cert_status, tenant_config_fiscal.certificado_status, 'pendente'),
    certificado_valido_ate = COALESCE(v_cert_valido, tenant_config_fiscal.certificado_valido_ate),
    certificado_nome_arquivo = COALESCE(v_cert_nome, tenant_config_fiscal.certificado_nome_arquivo),
    certificado_enviado_em = CASE 
      WHEN v_cert_status = 'ativo' THEN now() 
      ELSE tenant_config_fiscal.certificado_enviado_em 
    END,
    updated_at = now();

  RETURN jsonb_build_object(
    'sucesso', true, 
    'mensagem', 'Configuração fiscal e certificado digital salvos com sucesso!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.salvar_config_fiscal_tenant(JSONB) TO authenticated;
