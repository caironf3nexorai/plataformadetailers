-- ==============================================================================
-- MIGRAÇÃO 0153: CORREÇÃO DA RPC RECUSAR AGENDAMENTO ONLINE & BLINDAGEM DE CANCELAMENTOS
-- 1. Adiciona colunas de auditoria de cancelamento em public.agendamentos se não existirem
-- 2. Atualiza a RPC recusar_agendamento_online com validação e cancelamento em cascata
-- 3. Blindagem de métricas de materiais da Academia Detailer para administradores
-- ==============================================================================

-- 1. Colunas de auditoria em public.agendamentos e public.recebimentos
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT,
  ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado_por UUID REFERENCES auth.users(id);

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Atualização definitiva da RPC recusar_agendamento_online
DROP FUNCTION IF EXISTS public.recusar_agendamento_online(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.recusar_agendamento_online(
  p_agendamento UUID,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento RECORD;
  v_motivo TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_agendamento
  FROM public.agendamentos
  WHERE id = p_agendamento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  -- Permissão: Dono, Gerente ou Administrador da Plataforma
  IF NOT public.tem_papel(v_agendamento.tenant_id, ARRAY['dono', 'gerente']::app_role[]) 
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: você não tem permissão para recusar este agendamento.';
  END IF;

  v_motivo := COALESCE(NULLIF(TRIM(p_motivo), ''), 'Recusado pelo estabelecimento');

  -- 2.1 Atualiza o agendamento para cancelado com auditoria e dispensa sinal pendente
  UPDATE public.agendamentos
  SET status = 'cancelado',
      sinal_status = CASE 
        WHEN sinal_status = 'pendente' THEN 'dispensado'
        ELSE sinal_status
      END,
      motivo_cancelamento = v_motivo,
      cancelado_em = now(),
      cancelado_por = auth.uid(),
      observacoes = CASE 
        WHEN v_motivo IS NOT NULL 
        THEN COALESCE(observacoes || E'\n', '') || '[Recusado]: ' || v_motivo
        ELSE observacoes
      END,
      updated_at = now()
  WHERE id = p_agendamento;

  -- 2.2 Cancela execução vinculada se existir
  UPDATE public.execucoes
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_agendamento;

  -- 2.3 Cancela recebimentos não liquidados (ex: sinal pendente)
  UPDATE public.recebimentos
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_agendamento
    AND status IN ('previsto', 'pendente');

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', p_agendamento,
    'status', 'cancelado',
    'mensagem', 'Agendamento recusado com sucesso.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recusar_agendamento_online(UUID, TEXT) TO authenticated;

-- 3. Blindagem de métricas de materiais da Academia Detailer
CREATE OR REPLACE FUNCTION public.registrar_acesso_material(
  p_material_id UUID,
  p_tipo TEXT DEFAULT 'visualizacao'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Se for administrador da plataforma, não computa contagem de visualização/download
  IF public.is_platform_admin() THEN
    RETURN jsonb_build_object('sucesso', true, 'ignorado_admin', true);
  END IF;

  IF p_tipo = 'download' THEN
    UPDATE public.academia_materiais
    SET downloads_count = downloads_count + 1
    WHERE id = p_material_id;
  ELSE
    UPDATE public.academia_materiais
    SET visualizacoes_count = visualizacoes_count + 1
    WHERE id = p_material_id;
  END IF;

  RETURN jsonb_build_object('sucesso', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_acesso_material(UUID, TEXT) TO authenticated;

-- 4. Limpeza retroativa de sinal em agendamentos que já foram cancelados
UPDATE public.agendamentos
SET sinal_status = 'dispensado'
WHERE status = 'cancelado' AND sinal_status = 'pendente';
