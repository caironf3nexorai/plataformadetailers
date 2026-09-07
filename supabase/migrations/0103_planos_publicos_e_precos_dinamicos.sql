-- Migration 0103: Planos Públicos e Leitura Dinâmica de Preços e Limites
-- Permite que o frontend consulte os preços e limites dinâmicos configurados no Admin

-- 1. Permite leitura de plans e plan_limits para authenticated e anon
DROP POLICY IF EXISTS "Planos visíveis por autenticados" ON public.plans;
DROP POLICY IF EXISTS "Planos visíveis publicamente" ON public.plans;

CREATE POLICY "Planos visíveis publicamente" ON public.plans
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Limites de planos visíveis por autenticados" ON public.plan_limits;
DROP POLICY IF EXISTS "Limites de planos visíveis publicamente" ON public.plan_limits;

CREATE POLICY "Limites de planos visíveis publicamente" ON public.plan_limits
  FOR SELECT USING (true);

GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.plan_limits TO anon, authenticated;

-- 2. RPC pública para listar planos ativos com preços, limites e features consolidados
CREATE OR REPLACE FUNCTION public.obter_planos_publicos()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'codigo', p.codigo,
        'nome', p.nome,
        'preco_centavos', p.preco_centavos,
        'ativo', p.ativo,
        'limites', COALESCE((
          SELECT jsonb_object_agg(pl.recurso, pl.limite)
          FROM public.plan_limits pl
          WHERE pl.plano = p.codigo
        ), '{}'::jsonb),
        'features', COALESCE((
          SELECT jsonb_object_agg(pf.feature, pf.habilitado)
          FROM public.plan_features pf
          WHERE pf.plano = p.codigo
        ), '{}'::jsonb)
      )
      ORDER BY p.preco_centavos ASC, p.codigo ASC
    )
    FROM public.plans p
    WHERE p.ativo = true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_planos_publicos() TO anon, authenticated;
