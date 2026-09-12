-- Migration 0120: Correção de Nomes no Ranking de Equipe e Cadastro de Recursos Focus NFe

-- 1. PERMITIR QUE MEMBROS DO MESMO TENANT VEJAM O NOME DO PERFIL DOS COLEGAS
DROP POLICY IF EXISTS "Membros do mesmo tenant leem perfil" ON public.profiles;
CREATE POLICY "Membros do mesmo tenant leem perfil" ON public.profiles
FOR SELECT USING (
  id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.tenant_members tm1
    JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
    WHERE tm1.user_id = profiles.id
      AND tm2.user_id = auth.uid()
      AND tm1.status = 'ativo'
      AND tm2.status = 'ativo'
  )
);

-- 2. RPC ATUALIZADA: GAMIFICAÇÃO E RANKING COM NOMES REAIS E PARÂMETROS COM VALOR DEFAULT
CREATE OR REPLACE FUNCTION public.ranking_produtividade_equipe(
  p_tenant uuid,
  p_inicio date DEFAULT date_trunc('month', current_date)::date,
  p_fim date DEFAULT (date_trunc('month', current_date) + interval '1 month - 1 day')::date
)
RETURNS TABLE (
  member_id uuid,
  user_id uuid,
  nome text,
  email text,
  papel text,
  veiculos_concluidos bigint,
  tempo_total_minutos numeric,
  tempo_medio_minutos numeric,
  faturamento_gerado numeric,
  comissao_acumulada numeric,
  eh_usuario_atual boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_gestor boolean;
  v_current_user_id uuid;
  v_current_member_id uuid;
BEGIN
  -- Validar acesso ao tenant
  IF NOT EXISTS (SELECT 1 FROM public.meus_tenants() t WHERE t = p_tenant) THEN
    RAISE EXCEPTION 'Acesso negado ao tenant especificado';
  END IF;

  v_current_user_id := auth.uid();

  -- Identificar papel do usuário chamador
  SELECT
    tm.id,
    (tm.role IN ('dono', 'gerente'))
  INTO v_current_member_id, v_is_gestor
  FROM public.tenant_members tm
  WHERE tm.tenant_id = p_tenant
    AND tm.user_id = v_current_user_id
    AND tm.status <> 'inativo'
  LIMIT 1;

  RETURN QUERY
  WITH exec_stats AS (
    SELECT
      ee.member_id,
      count(DISTINCT e.id) AS veiculos_concluidos,
      coalesce(sum(coalesce(e.tempo_efetivo_minutos, round(e.segundos_trabalhados / 60.0))), 0)::numeric AS tempo_total_minutos,
      coalesce(sum(e.valor_total_final), 0)::numeric AS faturamento_gerado,
      coalesce(sum(ee.comissao_calculada), 0)::numeric AS comissao_acumulada
    FROM public.execucao_executores ee
    JOIN public.execucoes e ON e.id = ee.execucao_id
    WHERE e.tenant_id = p_tenant
      AND e.status = 'finalizado'
      AND (p_inicio IS NULL OR e.finalizado_em::date >= p_inicio)
      AND (p_fim IS NULL OR e.finalizado_em::date <= p_fim)
    GROUP BY ee.member_id
  )
  SELECT
    tm.id AS member_id,
    tm.user_id,
    coalesce(
      nullif(trim(p.nome), ''),
      initcap(replace(replace(split_part(tm.email, '@', 1), '.', ' '), '_', ' '))
    ) AS nome,
    tm.email,
    tm.role::text AS papel,
    coalesce(es.veiculos_concluidos, 0) AS veiculos_concluidos,
    coalesce(es.tempo_total_minutos, 0) AS tempo_total_minutos,
    CASE
      WHEN coalesce(es.veiculos_concluidos, 0) > 0
        THEN round(es.tempo_total_minutos / es.veiculos_concluidos)
      ELSE 0
    END AS tempo_medio_minutos,
    CASE
      WHEN v_is_gestor OR tm.user_id = v_current_user_id THEN coalesce(es.faturamento_gerado, 0)
      ELSE 0
    END AS faturamento_gerado,
    CASE
      WHEN v_is_gestor OR tm.user_id = v_current_user_id THEN coalesce(es.comissao_acumulada, 0)
      ELSE 0
    END AS comissao_acumulada,
    (tm.user_id = v_current_user_id) AS eh_usuario_atual
  FROM public.tenant_members tm
  LEFT JOIN public.profiles p ON p.id = tm.user_id
  LEFT JOIN exec_stats es ON es.member_id = tm.id
  WHERE tm.tenant_id = p_tenant
    AND tm.status = 'ativo'
  ORDER BY coalesce(es.veiculos_concluidos, 0) DESC, coalesce(es.faturamento_gerado, 0) DESC, tm.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ranking_produtividade_equipe(uuid, date, date) TO authenticated;

-- 3. CADASTRAR RECURSO E FEATURE DA FOCUS NFE NO CATÁLOGO DE PLANOS E PERMISSÕES
INSERT INTO public.feature_catalogo (chave, nome, descricao, grupo, ordem) VALUES
  ('emissao_nfe_focus', 'Emissão de Notas Fiscais (Focus NFe)', 'Emissão automática de NFS-e de serviços via API Focus NFe com certificado digital A1', 'Fiscal & Financeiro', 26)
ON CONFLICT (chave) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  grupo = EXCLUDED.grupo,
  ordem = EXCLUDED.ordem;

-- 4. VINCULAR FUNCIONALIDADE AOS PLANOS
INSERT INTO public.plan_features (plano, feature, habilitado) VALUES
  ('free', 'emissao_nfe_focus', false),
  ('pro', 'emissao_nfe_focus', true),
  ('studio', 'emissao_nfe_focus', true)
ON CONFLICT (plano, feature) DO UPDATE SET
  habilitado = EXCLUDED.habilitado;

-- 5. CADASTRAR LIMITE NUMÉRICO DE NOTAS FISCAIS POR MÊS NO PLAN_LIMITS
INSERT INTO public.plan_limits (plano, recurso, limite) VALUES
  ('free', 'notas_fiscais_mes', 0),
  ('pro', 'notas_fiscais_mes', 30),
  ('studio', 'notas_fiscais_mes', 150)
ON CONFLICT (plano, recurso) DO UPDATE SET
  limite = EXCLUDED.limite;
