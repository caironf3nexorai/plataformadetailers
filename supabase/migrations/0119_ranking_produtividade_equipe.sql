-- Migration 0119: RPC de Gamificação e Ranking de Produtividade da Equipe

CREATE OR REPLACE FUNCTION public.ranking_produtividade_equipe(
  p_tenant uuid,
  p_inicio date,
  p_fim date
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
  WITH dados_execucao AS (
    SELECT
      ee.member_id,
      tm.user_id,
      coalesce(nullif(trim(p.nome), ''), tm.email) AS nome,
      tm.email,
      tm.role::text AS papel,
      count(DISTINCT e.id) AS veiculos_concluidos,
      coalesce(sum(coalesce(e.tempo_efetivo_minutos, round(e.segundos_trabalhados / 60.0))), 0)::numeric AS tempo_total_minutos,
      coalesce(sum(e.valor_total_final), 0)::numeric AS faturamento_gerado,
      coalesce(sum(ee.comissao_calculada), 0)::numeric AS comissao_acumulada,
      (tm.user_id = v_current_user_id) AS eh_usuario_atual
    FROM public.execucao_executores ee
    JOIN public.execucoes e ON e.id = ee.execucao_id
    JOIN public.tenant_members tm ON tm.id = ee.member_id
    LEFT JOIN public.profiles p ON p.id = tm.user_id
    WHERE e.tenant_id = p_tenant
      AND e.status = 'finalizado'
      AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date >= p_inicio
      AND (e.finalizado_em AT TIME ZONE 'America/Sao_Paulo')::date <= p_fim
    GROUP BY ee.member_id, tm.user_id, p.nome, tm.email, tm.role
  )
  SELECT
    d.member_id,
    d.user_id,
    d.nome,
    d.email,
    d.papel,
    d.veiculos_concluidos,
    d.tempo_total_minutos,
    CASE 
      WHEN d.veiculos_concluidos > 0 THEN round(d.tempo_total_minutos / d.veiculos_concluidos, 1)
      ELSE 0
    END AS tempo_medio_minutos,
    d.faturamento_gerado,
    -- Regra de Privacidade Salarial: Se o usuário NÃO for gestor e NÃO for ele mesmo, mascara a comissão
    CASE
      WHEN v_is_gestor = true OR d.eh_usuario_atual = true THEN d.comissao_acumulada
      ELSE 0
    END AS comissao_acumulada,
    d.eh_usuario_atual
  FROM dados_execucao d
  ORDER BY d.veiculos_concluidos DESC, d.faturamento_gerado DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ranking_produtividade_equipe(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ranking_produtividade_equipe(uuid, date, date) TO authenticated;
