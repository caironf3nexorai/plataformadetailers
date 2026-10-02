-- Migration 0144: Integrar Registro Manual de Pagamento com Comissao de Parceiro
-- Permite que administradores registrem ou testem pagamentos manuais gerando automaticamente
-- a comissao de parceiro comercial vinculada na competencia correspondente.

CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento_manual_competencia(
  p_tenant_id UUID,
  p_competencia DATE,
  p_valor_pago_centavos INTEGER DEFAULT 6700
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_valor INTEGER := COALESCE(p_valor_pago_centavos, 6700);
  v_comp DATE := date_trunc('month', p_competencia)::date;
  v_res_parceiro JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem registrar pagamentos manuais';
  END IF;

  -- 1. Registra na tabela de pagamentos de competência
  INSERT INTO public.pagamentos_competencia (tenant_id, competencia, valor_pago_centavos, confirmado_por, confirmado_em)
  VALUES (p_tenant_id, v_comp, v_valor, auth.uid(), NOW())
  ON CONFLICT (tenant_id, competencia) 
  DO UPDATE SET valor_pago_centavos = EXCLUDED.valor_pago_centavos, confirmado_em = NOW(), confirmado_por = auth.uid();

  -- 2. Atualizar status da assinatura para 'ativa' se estiver trial ou atrasada
  UPDATE public.assinaturas
  SET status = 'ativa', 
      proximo_vencimento = (v_comp + INTERVAL '1 month' - INTERVAL '1 day')::date,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id;

  -- 3. Atualizar status do tenant
  UPDATE public.tenants
  SET status = 'ativo',
      updated_at = NOW()
  WHERE id = p_tenant_id;

  -- 4. Processar conversão de indicação se houver indicação pendente entre oficinas
  PERFORM public.processar_conversao_indicacao(p_tenant_id);

  -- 5. Processar comissão de parceiro comercial se a oficina foi indicada por um parceiro
  SELECT public.processar_pagamento_asaas_parceiro(p_tenant_id, v_valor, v_comp) INTO v_res_parceiro;

  RETURN jsonb_build_object(
    'sucesso', true,
    'competencia', v_comp,
    'valor_pago_centavos', v_valor,
    'resultado_parceiro', v_res_parceiro
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_registrar_pagamento_manual_competencia(UUID, DATE, INTEGER) TO authenticated, service_role;
