-- ==============================================================================
-- MIGRAÇÃO 0083: VISTORIA OPCIONAL E ATALHO DIRETO PARA EXECUÇÃO
-- ------------------------------------------------------------------------------
-- 1. Acrescenta campos de dispensa de vistoria em agendamentos
-- 2. Acrescenta configuração de obrigatoriedade de vistoria em tenants
-- 3. Cria RPC dispensar_vistoria para registro auditável e início imediato
-- ==============================================================================

-- 1. Campos de dispensa em agendamentos
ALTER TABLE public.agendamentos
ADD COLUMN IF NOT EXISTS vistoria_dispensada boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS vistoria_dispensada_em timestamptz,
ADD COLUMN IF NOT EXISTS vistoria_dispensada_por uuid REFERENCES public.tenant_members(id);

-- 2. Configuração de obrigatoriedade em tenants
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS vistoria_obrigatoria boolean NOT NULL DEFAULT false;

-- 3. RPC canônica dispensar_vistoria
DROP FUNCTION IF EXISTS public.dispensar_vistoria(uuid);
CREATE OR REPLACE FUNCTION public.dispensar_vistoria(
  p_agendamento uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ag record;
  v_tenant record;
  v_member_id uuid;
  v_user_id uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT a.* INTO v_ag FROM public.agendamentos a WHERE a.id = p_agendamento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_ag.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  IF COALESCE(v_tenant.vistoria_obrigatoria, false) THEN
    RAISE EXCEPTION 'Esta oficina exige a realização obrigatória da vistoria de entrada.';
  END IF;

  -- Se já existir checkin finalizado/assinado, não permite dispensar
  IF EXISTS (SELECT 1 FROM public.checkins WHERE agendamento_id = p_agendamento AND finalizado = true) THEN
    RAISE EXCEPTION 'Não é possível dispensar uma vistoria que já foi realizada e finalizada.';
  END IF;

  SELECT id INTO v_member_id
  FROM public.tenant_members
  WHERE tenant_id = v_ag.tenant_id AND user_id = v_user_id AND status = 'ativo'
  LIMIT 1;

  UPDATE public.agendamentos
  SET vistoria_dispensada = true,
      vistoria_dispensada_em = now(),
      vistoria_dispensada_por = v_member_id,
      updated_at = now()
  WHERE id = p_agendamento;

  -- Inicia a execução diretamente
  v_res := public.iniciar_execucao(p_agendamento);
  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispensar_vistoria(uuid) TO authenticated;

-- 4. Atualização de iniciar_checkin para reverter dispensa caso o usuário decida fazer a vistoria
CREATE OR REPLACE FUNCTION public.iniciar_checkin(
  p_agendamento uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_veiculo uuid;
  v_user uuid;
  v_checkin uuid;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT ag.tenant_id, ag.veiculo_id INTO v_tenant, v_veiculo
  FROM public.agendamentos ag
  WHERE ag.id = p_agendamento;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente', 'operador']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Usuário não é membro ativo desta oficina.';
  END IF;

  -- Reverte vistoria_dispensada para false preservando registro de quem dispensou
  UPDATE public.agendamentos
  SET vistoria_dispensada = false,
      updated_at = now()
  WHERE id = p_agendamento AND vistoria_dispensada = true;

  INSERT INTO public.checkins (
    tenant_id,
    agendamento_id,
    veiculo_id,
    criado_por
  ) VALUES (
    v_tenant,
    p_agendamento,
    v_veiculo,
    v_user
  )
  ON CONFLICT (agendamento_id) DO NOTHING
  RETURNING id INTO v_checkin;

  IF v_checkin IS NULL THEN
    SELECT c.id INTO v_checkin
    FROM public.checkins c
    WHERE c.agendamento_id = p_agendamento;
  END IF;

  RETURN v_checkin;
END;
$$;

GRANT EXECUTE ON FUNCTION public.iniciar_checkin(uuid) TO authenticated;

-- Recarregar PostgREST schema
NOTIFY pgrst, 'reload schema';
