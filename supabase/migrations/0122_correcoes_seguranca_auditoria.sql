-- ==============================================================================
-- MIGRAÇÃO 0122: HARDENING DE SEGURANÇA, BLINDAGEM MULTI-TENANT E SANEAMENTO
-- 1. Elimina leitura aberta via SELECT direto em certificados de garantia (0115)
-- 2. Blinda tabela de rate limit de agendamentos contra adulteração externa (0041)
-- 3. Cria trava de integridade anti-fraude na coluna plano da tabela tenants (0001)
-- 4. Elimina sobrecarga duplicada em dar_baixa_recebimento (PGRST203)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: CERTIFICADOS DE GARANTIA E REVISÕES
-- Remove políticas permissivas que permitiam SELECT * anônimo irrestrito.
-- A tela pública continua 100% ativa via RPC segura public.obter_certificado_publico(p_codigo).
-- As telas internas do CRM continuam ativas pela política "Membros do tenant gerenciam certificados".
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Leitura pública de certificados por código" ON public.certificados_garantia;
DROP POLICY IF EXISTS "Leitura pública de manutenções de certificados" ON public.certificado_manutencoes;


-- ------------------------------------------------------------------------------
-- PARTE 2: TABELA DE RATE-LIMITING DE AGENDAMENTOS ONLINE
-- Remove política permissiva (FOR ALL USING true) e revoga acesso direto à tabela.
-- A RPC public.agendar_online roda como SECURITY DEFINER e mantém acesso total no servidor.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agendamentos tentativas leitura" ON public.agendamento_online_tentativas;
REVOKE ALL ON TABLE public.agendamento_online_tentativas FROM anon, authenticated, public;
ALTER TABLE public.agendamento_online_tentativas ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------------------------
-- PARTE 3: TRAVA ANTI-FRAUDE NA COLUNA PLANO DA TABELA TENANTS
-- Impede que donos de oficina alterem seu próprio plano via console DevTools / REST.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.impedir_alteracao_plano_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Se o plano não mudou, permite a edição cadastral normal (nome, logo, pix, etc.)
  IF (NEW.plano IS NOT DISTINCT FROM OLD.plano) THEN
    RETURN NEW;
  END IF;

  -- Se o plano mudou, autoriza APENAS se a chamada vier de:
  -- 1. Super-Admin autenticado da plataforma (public.is_platform_admin())
  -- 2. Webhook do Asaas ou rotinas automáticas do banco (role service_role ou postgres)
  IF public.is_platform_admin() 
     OR current_user = 'service_role' 
     OR session_user = 'service_role' 
     OR current_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'A alteração de plano só é permitida via checkout ou administração da plataforma.';
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_plano_tenant ON public.tenants;
CREATE TRIGGER trg_proteger_plano_tenant
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_alteracao_plano_tenant();


-- ------------------------------------------------------------------------------
-- PARTE 4: ELIMINAR SOBRECARGA DUPLICADA EM DAR_BAIXA_RECEBIMENTO (PGRST203)
-- A migração 0105 criou dar_baixa_recebimento(uuid, numeric) com valor pago flexível,
-- mas a versão antiga dar_baixa_recebimento(uuid) permaneceu causando ambiguidade.
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dar_baixa_recebimento(uuid);


-- ------------------------------------------------------------------------------
-- PARTE 5: NOTIFICAÇÃO DE RELOAD DE SCHEMA DO POSTGREST
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
