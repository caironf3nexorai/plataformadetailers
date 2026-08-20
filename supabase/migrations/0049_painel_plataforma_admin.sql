-- ==============================================================================
-- MIGRAÇÃO 0049: PAINEL ADMIN DA PLATAFORMA & SEGURANÇA MULTI-TENANT
-- ==============================================================================

-- 0. CORREÇÃO DE DEFAULT DE CLIENTES.ORIGEM (PARTE 0)
ALTER TABLE public.clientes ALTER COLUMN origem SET DEFAULT 'interno';

-- 1. ESTRUTURA DE IDENTIDADE DO ADMINISTRADOR DA PLATAFORMA (PARTE 1)
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'admin' CHECK (nivel IN ('admin', 'suporte')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  observacao TEXT NULL,
  criado_por UUID NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revogado_em TIMESTAMPTZ NULL
);

-- FUNÇÕES DE VERIFICAÇÃO DE PERMISSÃO ADMIN (SECURITY DEFINER PARA EVITAR RECURSÃO RLS)
DROP FUNCTION IF EXISTS public.is_platform_admin();
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() AND ativo = true AND revogado_em IS NULL
  );
$$;

DROP FUNCTION IF EXISTS public.is_platform_admin_editor();
CREATE OR REPLACE FUNCTION public.is_platform_admin_editor()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() AND ativo = true AND revogado_em IS NULL AND nivel = 'admin'
  );
$$;

-- RLS DE PLATFORM_ADMINS
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins select" ON public.platform_admins;
CREATE POLICY "Platform admins select" ON public.platform_admins
  FOR SELECT USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admin editors insert" ON public.platform_admins;
CREATE POLICY "Platform admin editors insert" ON public.platform_admins
  FOR INSERT WITH CHECK (public.is_platform_admin_editor());

DROP POLICY IF EXISTS "Platform admin editors update" ON public.platform_admins;
CREATE POLICY "Platform admin editors update" ON public.platform_admins
  FOR UPDATE USING (public.is_platform_admin_editor());

DROP POLICY IF EXISTS "Platform admin editors delete" ON public.platform_admins;
CREATE POLICY "Platform admin editors delete" ON public.platform_admins
  FOR DELETE USING (public.is_platform_admin_editor());

-- BOOTSTRAP: rodar uma vez, manualmente, trocando o e-mail.
-- insert into public.platform_admins (user_id, email, nivel, criado_por)
-- select id, email, 'admin', id from auth.users where email = 'SEU_EMAIL_AQUI'
-- on conflict (user_id) do nothing;

-- TABELA DE AUDITORIA DE AÇÕES ADMINISTRATIVAS
CREATE TABLE IF NOT EXISTS public.admin_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT NULL,
  valor_anterior JSONB NULL,
  valor_novo JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin auditoria select" ON public.admin_auditoria;
CREATE POLICY "Admin auditoria select" ON public.admin_auditoria
  FOR SELECT USING (public.is_platform_admin());

-- Sem políticas de INSERT/UPDATE/DELETE para os usuários comuns (apenas via RPC security definer)

-- ==============================================================================
-- 2. LEITURA DE TENANTS E METADADOS (PARTES 2 E 3)
-- ==============================================================================

DROP FUNCTION IF EXISTS public.admin_listar_tenants(text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.admin_listar_tenants(
  p_busca TEXT DEFAULT NULL,
  p_plano TEXT DEFAULT NULL,
  p_limite INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  nome TEXT,
  slug TEXT,
  plano plan_code,
  cidade TEXT,
  uf TEXT,
  created_at TIMESTAMPTZ,
  total_membros BIGINT,
  total_clientes BIGINT,
  total_veiculos BIGINT,
  total_agendamentos BIGINT,
  total_execucoes BIGINT,
  ultimo_acesso TIMESTAMPTZ,
  agendamento_online_ativo BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    t.id,
    t.nome,
    t.slug,
    t.plano,
    t.cidade,
    t.uf,
    t.created_at,
    COALESCE(tm.cnt, 0)::BIGINT AS total_membros,
    COALESCE(tc.cnt, 0)::BIGINT AS total_clientes,
    COALESCE(tv.cnt, 0)::BIGINT AS total_veiculos,
    COALESCE(ta.cnt, 0)::BIGINT AS total_agendamentos,
    COALESCE(te.cnt, 0)::BIGINT AS total_execucoes,
    tm_last.max_sign_in AS ultimo_acesso,
    t.agendamento_online_ativo
  FROM public.tenants t
  LEFT JOIN (
    SELECT tenant_id, COUNT(*) AS cnt 
    FROM public.tenant_members 
    WHERE status = 'ativo' 
    GROUP BY tenant_id
  ) tm ON tm.tenant_id = t.id
  LEFT JOIN (
    SELECT m.tenant_id, MAX(u.last_sign_in_at) AS max_sign_in
    FROM public.tenant_members m
    JOIN auth.users u ON u.id = m.user_id
    GROUP BY m.tenant_id
  ) tm_last ON tm_last.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.clientes GROUP BY tenant_id) tc ON tc.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.veiculos GROUP BY tenant_id) tv ON tv.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.agendamentos GROUP BY tenant_id) ta ON ta.tenant_id = t.id
  LEFT JOIN (SELECT tenant_id, COUNT(*) AS cnt FROM public.execucoes GROUP BY tenant_id) te ON te.tenant_id = t.id
  WHERE (p_busca IS NULL OR p_busca = '' OR 
         t.nome ILIKE '%' || p_busca || '%' OR 
         t.slug ILIKE '%' || p_busca || '%' OR 
         t.cidade ILIKE '%' || p_busca || '%')
    AND (p_plano IS NULL OR p_plano = '' OR t.plano::TEXT = p_plano)
  ORDER BY t.created_at DESC
  LIMIT p_limite OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_tenants(text, text, integer, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_detalhe_tenant(uuid);
CREATE OR REPLACE FUNCTION public.admin_detalhe_tenant(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant RECORD;
  v_membros JSONB;
  v_historico_12m JSONB;
  v_storage JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada';
  END IF;

  -- Lista de membros (sem dados de clientes finais)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tm.id,
    'user_id', tm.user_id,
    'email', tm.email,
    'nome', COALESCE(p.nome, tm.email),
    'role', tm.role,
    'status', tm.status,
    'ultimo_acesso', u.last_sign_in_at
  )), '[]'::jsonb)
  INTO v_membros
  FROM public.tenant_members tm
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  LEFT JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant_id;

  -- Histórico dos últimos 12 meses (contadores agregados)
  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now() - interval '11 months'),
      date_trunc('month', now()),
      interval '1 month'
    )::date AS mes
  ),
  ag AS (
    SELECT date_trunc('month', created_at)::date AS mes, COUNT(*) AS cnt
    FROM public.agendamentos
    WHERE tenant_id = p_tenant_id AND created_at >= (now() - interval '12 months')
    GROUP BY 1
  ),
  ex AS (
    SELECT date_trunc('month', iniciado_em)::date AS mes, COUNT(*) AS cnt
    FROM public.execucoes
    WHERE tenant_id = p_tenant_id AND status = 'finalizado' AND iniciado_em >= (now() - interval '12 months')
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'mes', to_char(m.mes, 'YYYY-MM'),
    'agendamentos_criados', COALESCE(ag.cnt, 0),
    'execucoes_finalizadas', COALESCE(ex.cnt, 0)
  ) ORDER BY m.mes ASC), '[]'::jsonb)
  INTO v_historico_12m
  FROM meses m
  LEFT JOIN ag ON ag.mes = m.mes
  LEFT JOIN ex ON ex.mes = m.mes;

  -- Storage usage mais recente
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket', bucket,
    'total_arquivos', total_arquivos,
    'total_bytes', total_bytes,
    'calculado_em', calculado_em
  )), '[]'::jsonb)
  INTO v_storage
  FROM public.storage_uso_snapshot
  WHERE tenant_id = p_tenant_id
    AND calculado_em = (SELECT MAX(calculado_em) FROM public.storage_uso_snapshot WHERE tenant_id = p_tenant_id);

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'nome', v_tenant.nome,
      'slug', v_tenant.slug,
      'plano', v_tenant.plano,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'created_at', v_tenant.created_at,
      'agendamento_online_ativo', v_tenant.agendamento_online_ativo
    ),
    'membros', v_membros,
    'historico_12m', v_historico_12m,
    'storage', v_storage
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_detalhe_tenant(uuid) TO authenticated;

-- ==============================================================================
-- 3. PLANOS E LIMITES (PARTE 4)
-- ==============================================================================

DROP FUNCTION IF EXISTS public.admin_listar_planos();
CREATE OR REPLACE FUNCTION public.admin_listar_planos()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'codigo', p.codigo,
    'nome', p.nome,
    'preco_centavos', p.preco_centavos,
    'ativo', p.ativo,
    'limites', COALESCE((
      SELECT jsonb_object_agg(pl.recurso, pl.limite)
      FROM public.plan_limits pl
      WHERE pl.plano = p.codigo
    ), '{}'::jsonb)
  )) INTO v_res
  FROM public.plans p;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_planos() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_atualizar_plano(text, text, integer, boolean);
CREATE OR REPLACE FUNCTION public.admin_atualizar_plano(
  p_codigo TEXT,
  p_nome TEXT,
  p_preco_centavos INTEGER,
  p_ativo BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_codigo_enum plan_code;
  v_antigo RECORD;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  BEGIN
    v_codigo_enum := p_codigo::plan_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Plano inválido: %', p_codigo;
  END;

  SELECT * INTO v_antigo FROM public.plans WHERE codigo = v_codigo_enum;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano não encontrado';
  END IF;

  UPDATE public.plans
  SET nome = p_nome,
      preco_centavos = p_preco_centavos,
      ativo = p_ativo
  WHERE codigo = v_codigo_enum;

  -- Gravar auditoria
  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'plano_atualizado',
    'plans',
    p_codigo,
    to_jsonb(v_antigo),
    jsonb_build_object('codigo', p_codigo, 'nome', p_nome, 'preco_centavos', p_preco_centavos, 'ativo', p_ativo)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_atualizar_plano(text, text, integer, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_definir_limite(text, text, integer);
CREATE OR REPLACE FUNCTION public.admin_definir_limite(
  p_plano TEXT,
  p_recurso TEXT,
  p_limite INTEGER
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plano_enum plan_code;
  v_limite_antigo INTEGER;
  v_exists BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  BEGIN
    v_plano_enum := p_plano::plan_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Plano inválido: %', p_plano;
  END;

  SELECT EXISTS(SELECT 1 FROM public.plans WHERE codigo = v_plano_enum) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Plano % não existe em plans', p_plano;
  END IF;

  SELECT limite INTO v_limite_antigo
  FROM public.plan_limits
  WHERE plano = v_plano_enum AND recurso = p_recurso;

  IF FOUND THEN
    UPDATE public.plan_limits
    SET limite = p_limite
    WHERE plano = v_plano_enum AND recurso = p_recurso;
  ELSE
    INSERT INTO public.plan_limits (plano, recurso, limite)
    VALUES (v_plano_enum, p_recurso, p_limite);
  END IF;

  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'limite_atualizado',
    'plan_limits',
    p_plano || ':' || p_recurso,
    jsonb_build_object('limite', v_limite_antigo),
    jsonb_build_object('limite', p_limite)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_definir_limite(text, text, integer) TO authenticated;

-- ==============================================================================
-- 4. CATÁLOGO DE FEATURES E PERMISSÕES POR PLANO (PARTE 5)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.feature_catalogo (
  chave TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NULL,
  grupo TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem) VALUES
('calculadora_diluicao', 'Calculadora de Diluição', 'Cálculo de dosagem de produtos químicos', 'Operacional', 1),
('clientes_veiculos', 'Clientes & Veículos', 'Cadastro de clientes e frota de veículos', 'Operacional', 2),
('servicos_catalogo', 'Catálogo de Serviços', 'Cadastro de serviços e tabela de preços por categoria', 'Operacional', 3),
('agenda', 'Agenda & Calendário', 'Visão de agendamentos e transbordo', 'Operacional', 4),
('vistoria_entrada', 'Vistoria de Entrada (Check-in)', 'Check-in com nivel de combustível, avarias e assinatura', 'Operacional', 5),
('vistoria_aceite_remoto', 'Aceite Remoto de Vistoria', 'Link público para cliente aceitar vistoria via WhatsApp', 'Operacional', 6),
('combos', 'Combos de Serviços', 'Agrupamento de múltiplos serviços com desconto', 'Operacional', 7),
('execucao_checklist', 'Checklist de Execução', 'Etapas de inspeção e tarefas por serviço', 'Execução', 8),
('execucao_fotos', 'Fotos da Execução', 'Registro de fotos antes, durante e depois', 'Execução', 9),
('execucao_multiplos_executores', 'Múltiplos Executores', 'Atribuição de equipe por serviço/ordem', 'Execução', 10),
('estoque', 'Controle de Estoque', 'Movimentação e baixa automática por consumo', 'Gestão', 11),
('financeiro_custo_hora', 'Rateio de Custo/Hora', 'Cálculo de lucratividade por valor hora da oficina', 'Financeiro', 12),
('financeiro_comissoes', 'Gestão de Comissões', 'Cálculo de comissão por operador/gerente', 'Financeiro', 13),
('orcamentos_tres_niveis', 'Orçamentos de 3 Níveis', 'Apresentação Essencial, Recomendado e Premium', 'Vendas', 14),
('agendamento_online', 'Agendamento Online Público', 'Página pública de agendamento do cliente', 'Vendas', 15),
('sinal_pix', 'Cobrança de Sinal via PIX', 'Geração de copia e cola PIX no agendamento online', 'Vendas', 16),
('numeracao_os', 'Numeração Sequencial de OS', 'Geração sequencial de ordens de serviço', 'Operacional', 17)
ON CONFLICT (chave) DO UPDATE SET 
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  grupo = EXCLUDED.grupo,
  ordem = EXCLUDED.ordem;

CREATE TABLE IF NOT EXISTS public.plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plano plan_code NOT NULL REFERENCES public.plans(codigo) ON DELETE CASCADE,
  feature TEXT NOT NULL REFERENCES public.feature_catalogo(chave) ON DELETE CASCADE,
  habilitado BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plano, feature)
);

ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Plan features select" ON public.plan_features;
CREATE POLICY "Plan features select" ON public.plan_features
  FOR SELECT USING (true);

-- Semear todas as combinações de plano x feature habilitadas por padrão
INSERT INTO public.plan_features (plano, feature, habilitado)
SELECT p.codigo, fc.chave, true
FROM public.plans p
CROSS JOIN public.feature_catalogo fc
ON CONFLICT (plano, feature) DO NOTHING;

DROP FUNCTION IF EXISTS public.tenant_tem_feature(uuid, text);
CREATE OR REPLACE FUNCTION public.tenant_tem_feature(
  p_tenant_id UUID,
  p_feature TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plano plan_code;
  v_habilitado BOOLEAN;
BEGIN
  SELECT plano INTO v_plano FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT habilitado INTO v_habilitado
  FROM public.plan_features
  WHERE plano = v_plano AND feature = p_feature;

  RETURN COALESCE(v_habilitado, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_tem_feature(uuid, text) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.admin_listar_plan_features();
CREATE OR REPLACE FUNCTION public.admin_listar_plan_features()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT jsonb_build_object(
    'catalogo', (SELECT jsonb_agg(to_jsonb(fc) ORDER BY fc.ordem) FROM public.feature_catalogo fc),
    'features', (SELECT jsonb_agg(to_jsonb(pf)) FROM public.plan_features pf)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_plan_features() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_salvar_plan_features(jsonb);
CREATE OR REPLACE FUNCTION public.admin_salvar_plan_features(p_features JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_plano plan_code;
  v_feature TEXT;
  v_hab BOOLEAN;
BEGIN
  IF NOT public.is_platform_admin_editor() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de escrita requerida';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_features) LOOP
    v_plano := (v_item->>'plano')::plan_code;
    v_feature := v_item->>'feature';
    v_hab := (v_item->>'habilitado')::boolean;

    INSERT INTO public.plan_features (plano, feature, habilitado, updated_at)
    VALUES (v_plano, v_feature, v_hab, now())
    ON CONFLICT (plano, feature) DO UPDATE
    SET habilitado = EXCLUDED.habilitado, updated_at = now();
  END LOOP;

  INSERT INTO public.admin_auditoria (
    admin_user_id, acao, entidade, entidade_id, valor_anterior, valor_novo
  ) VALUES (
    auth.uid(),
    'feature_alterada',
    'plan_features',
    'lote',
    NULL,
    p_features
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_plan_features(jsonb) TO authenticated;

-- ==============================================================================
-- 5. MONITORAMENTO DE STORAGE (PARTE 6)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.storage_uso_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  total_arquivos INTEGER NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bucket, calculado_em)
);

ALTER TABLE public.storage_uso_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Storage usage snapshot select" ON public.storage_uso_snapshot;
CREATE POLICY "Storage usage snapshot select" ON public.storage_uso_snapshot
  FOR SELECT USING (public.is_platform_admin());

DROP FUNCTION IF EXISTS public.admin_recalcular_storage();
CREATE OR REPLACE FUNCTION public.admin_recalcular_storage()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agora TIMESTAMPTZ := now();
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Varre storage.objects extraindo o tenant_id do primeiro segmento do caminho (split_part(name, '/', 1))
  INSERT INTO public.storage_uso_snapshot (tenant_id, bucket, total_arquivos, total_bytes, calculado_em)
  SELECT 
    (split_part(o.name, '/', 1))::uuid AS tenant_id,
    o.bucket_id AS bucket,
    COUNT(*)::integer AS total_arquivos,
    SUM((o.metadata->>'size')::bigint)::bigint AS total_bytes,
    v_agora AS calculado_em
  FROM storage.objects o
  JOIN public.tenants t ON t.id::text = split_part(o.name, '/', 1)
  WHERE o.bucket_id IN ('evidencias', 'catalogo')
  GROUP BY split_part(o.name, '/', 1), o.bucket_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_recalcular_storage() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_obter_storage_snapshots();
CREATE OR REPLACE FUNCTION public.admin_obter_storage_snapshots()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  WITH ultimos AS (
    SELECT s.*, t.nome AS tenant_nome, t.slug AS tenant_slug
    FROM public.storage_uso_snapshot s
    JOIN public.tenants t ON t.id = s.tenant_id
    WHERE s.calculado_em = (
      SELECT MAX(calculado_em) FROM public.storage_uso_snapshot WHERE tenant_id = s.tenant_id AND bucket = s.bucket
    )
  )
  SELECT jsonb_agg(to_jsonb(u)) INTO v_res FROM ultimos u;

  RETURN COALESCE(v_res, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_obter_storage_snapshots() TO authenticated;
