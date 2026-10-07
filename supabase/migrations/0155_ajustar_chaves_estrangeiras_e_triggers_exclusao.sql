-- ==============================================================================
-- MIGRAÇÃO 0155: ELIMINAR TRAVAS RESIDUAIS DE EXCLUSÃO DE USUÁRIOS E OFICINAS
-- 1. Permite bypass de exclusão em fn_trg_checkin_filhos_imutavel e fn_trg_checkin_imutavel
--    para administradores da plataforma (is_platform_admin)
-- 2. Converte campos de autoria/auditoria (criado_por, confirmado_por, etc.)
--    para ON DELETE SET NULL, permitindo purgar usuários sem quebrar o banco
-- ==============================================================================

-- 1. BYPASS EM TRIGGERS DE CHECK-IN FINALIZADO PARA ADMIN DA PLATAFORMA
CREATE OR REPLACE FUNCTION public.fn_trg_checkin_filhos_imutavel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_finalizado boolean;
  v_checkin_id uuid;
BEGIN
  -- Permite exclusão livre quando for admin da plataforma expurgando oficina ou dados de teste
  IF public.is_platform_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_checkin_id := OLD.checkin_id;
  ELSE
    v_checkin_id := NEW.checkin_id;
  END IF;

  SELECT finalizado INTO v_finalizado
  FROM public.checkins
  WHERE id = v_checkin_id;

  IF coalesce(v_finalizado, false) THEN
    RAISE EXCEPTION 'Check-in já assinado pelo cliente. Não pode ser alterado.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trg_checkin_imutavel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Permite alteração/exclusão pelo admin da plataforma
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.finalizado THEN
    RAISE EXCEPTION 'Check-in já assinado pelo cliente. Não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;


-- 2. FLEXIBILIZAÇÃO DAS CHAVES ESTRANGEIRAS DE AUDITORIA (ON DELETE SET NULL)
DO $$
BEGIN
  -- 2.1 TENANTS
  ALTER TABLE public.tenants ALTER COLUMN criado_por DROP NOT NULL;
  ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_criado_por_fkey;
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_criado_por_fkey 
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  -- 2.2 AGENDAMENTOS
  ALTER TABLE public.agendamentos ALTER COLUMN criado_por DROP NOT NULL;
  ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS agendamentos_criado_por_fkey;
  ALTER TABLE public.agendamentos ADD CONSTRAINT agendamentos_criado_por_fkey 
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS agendamentos_cancelado_por_fkey;
  ALTER TABLE public.agendamentos ADD CONSTRAINT agendamentos_cancelado_por_fkey 
    FOREIGN KEY (cancelado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS agendamentos_confirmado_por_fkey;
  ALTER TABLE public.agendamentos ADD CONSTRAINT agendamentos_confirmado_por_fkey 
    FOREIGN KEY (confirmado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  -- 2.3 ORÇAMENTOS
  ALTER TABLE public.orcamentos ALTER COLUMN criado_por DROP NOT NULL;
  ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_criado_por_fkey;
  ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_criado_por_fkey 
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_desconto_aplicado_por_fkey;
  ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_desconto_aplicado_por_fkey 
    FOREIGN KEY (desconto_aplicado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  -- 2.4 DESPESAS
  ALTER TABLE public.despesas_fixas ALTER COLUMN criado_por DROP NOT NULL;
  ALTER TABLE public.despesas_fixas DROP CONSTRAINT IF EXISTS despesas_fixas_criado_por_fkey;
  ALTER TABLE public.despesas_fixas ADD CONSTRAINT despesas_fixas_criado_por_fkey 
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  ALTER TABLE public.despesas_fixas DROP CONSTRAINT IF EXISTS despesas_fixas_confirmado_por_fkey;
  ALTER TABLE public.despesas_fixas ADD CONSTRAINT despesas_fixas_confirmado_por_fkey 
    FOREIGN KEY (confirmado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

  -- 2.5 RECEBIMENTOS
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recebimentos' AND column_name = 'criado_por') THEN
    ALTER TABLE public.recebimentos ALTER COLUMN criado_por DROP NOT NULL;
    ALTER TABLE public.recebimentos DROP CONSTRAINT IF EXISTS recebimentos_criado_por_fkey;
    ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_criado_por_fkey 
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- 2.6 ESTOQUE
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'estoque_movimentos') THEN
    ALTER TABLE public.estoque_movimentos ALTER COLUMN criado_por DROP NOT NULL;
    ALTER TABLE public.estoque_movimentos DROP CONSTRAINT IF EXISTS estoque_movimentos_criado_por_fkey;
    ALTER TABLE public.estoque_movimentos ADD CONSTRAINT estoque_movimentos_criado_por_fkey 
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- 2.7 EXECUÇÕES
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'execucao_consumos') THEN
    ALTER TABLE public.execucao_consumos ALTER COLUMN registrado_por DROP NOT NULL;
    ALTER TABLE public.execucao_consumos DROP CONSTRAINT IF EXISTS execucao_consumos_registrado_por_fkey;
    ALTER TABLE public.execucao_consumos ADD CONSTRAINT execucao_consumos_registrado_por_fkey 
      FOREIGN KEY (registrado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'execucao_itens') THEN
    ALTER TABLE public.execucao_itens ALTER COLUMN concluido_por DROP NOT NULL;
    ALTER TABLE public.execucao_itens DROP CONSTRAINT IF EXISTS execucao_itens_concluido_por_fkey;
    ALTER TABLE public.execucao_itens ADD CONSTRAINT execucao_itens_concluido_por_fkey 
      FOREIGN KEY (concluido_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'execucao_fotos') THEN
    ALTER TABLE public.execucao_fotos ALTER COLUMN enviado_por DROP NOT NULL;
    ALTER TABLE public.execucao_fotos DROP CONSTRAINT IF EXISTS execucao_fotos_enviado_por_fkey;
    ALTER TABLE public.execucao_fotos ADD CONSTRAINT execucao_fotos_enviado_por_fkey 
      FOREIGN KEY (enviado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'execucoes') THEN
    ALTER TABLE public.execucoes DROP CONSTRAINT IF EXISTS execucoes_valor_definido_por_fkey;
    ALTER TABLE public.execucoes ADD CONSTRAINT execucoes_valor_definido_por_fkey 
      FOREIGN KEY (valor_definido_por) REFERENCES auth.users(id) ON DELETE SET NULL;

    ALTER TABLE public.execucoes DROP CONSTRAINT IF EXISTS execucoes_desconto_aplicado_por_fkey;
    ALTER TABLE public.execucoes ADD CONSTRAINT execucoes_desconto_aplicado_por_fkey 
      FOREIGN KEY (desconto_aplicado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  -- 2.8 DEMAIS AUDITORIAS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bloqueios_agenda') THEN
    ALTER TABLE public.bloqueios_agenda ALTER COLUMN criado_por DROP NOT NULL;
    ALTER TABLE public.bloqueios_agenda DROP CONSTRAINT IF EXISTS bloqueios_agenda_criado_por_fkey;
    ALTER TABLE public.bloqueios_agenda ADD CONSTRAINT bloqueios_agenda_criado_por_fkey 
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comissao_regras') THEN
    ALTER TABLE public.comissao_regras ALTER COLUMN criado_por DROP NOT NULL;
    ALTER TABLE public.comissao_regras DROP CONSTRAINT IF EXISTS comissao_regras_criado_por_fkey;
    ALTER TABLE public.comissao_regras ADD CONSTRAINT comissao_regras_criado_por_fkey 
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_metas') THEN
    ALTER TABLE public.tenant_metas ALTER COLUMN criado_por DROP NOT NULL;
    ALTER TABLE public.tenant_metas DROP CONSTRAINT IF EXISTS tenant_metas_criado_por_fkey;
    ALTER TABLE public.tenant_metas ADD CONSTRAINT tenant_metas_criado_por_fkey 
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'taxas_cartao') THEN
    ALTER TABLE public.taxas_cartao ALTER COLUMN criado_por DROP NOT NULL;
    ALTER TABLE public.taxas_cartao DROP CONSTRAINT IF EXISTS taxas_cartao_criado_por_fkey;
    ALTER TABLE public.taxas_cartao ADD CONSTRAINT taxas_cartao_criado_por_fkey 
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_auditoria') THEN
    ALTER TABLE public.admin_auditoria ALTER COLUMN admin_user_id DROP NOT NULL;
    ALTER TABLE public.admin_auditoria DROP CONSTRAINT IF EXISTS admin_auditoria_admin_user_id_fkey;
    ALTER TABLE public.admin_auditoria ADD CONSTRAINT admin_auditoria_admin_user_id_fkey 
      FOREIGN KEY (admin_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_admins') THEN
    ALTER TABLE public.platform_admins DROP CONSTRAINT IF EXISTS platform_admins_criado_por_fkey;
    ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_criado_por_fkey 
      FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pagamentos_competencia') THEN
    ALTER TABLE public.pagamentos_competencia DROP CONSTRAINT IF EXISTS pagamentos_competencia_confirmado_por_fkey;
    ALTER TABLE public.pagamentos_competencia ADD CONSTRAINT pagamentos_competencia_confirmado_por_fkey 
      FOREIGN KEY (confirmado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notas_fiscais') THEN
    ALTER TABLE public.notas_fiscais DROP CONSTRAINT IF EXISTS notas_fiscais_emitido_por_fkey;
    ALTER TABLE public.notas_fiscais ADD CONSTRAINT notas_fiscais_emitido_por_fkey 
      FOREIGN KEY (emitido_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;
