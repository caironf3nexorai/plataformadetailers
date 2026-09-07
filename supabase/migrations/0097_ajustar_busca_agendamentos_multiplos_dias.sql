-- ==============================================================================
-- MIGRATION 0097: AJUSTAR BUSCA DE AGENDAMENTOS PARA MÚLTIPLOS DIAS E PERNOITE
-- ==============================================================================
-- Permite que agendamentos de múltiplos dias (ex: 7 dias) sejam recuperados
-- pela RPC buscar_agendamentos em qualquer um dos dias de sua vigência,
-- garantindo que a visão diária, semanal e de pernoite da agenda apresente
-- o veículo durante todo o período reservado.

CREATE OR REPLACE FUNCTION public.buscar_agendamentos(
  p_tenant uuid,
  p_inicio date default null,
  p_fim date default null,
  p_status text[] default null,
  p_busca text default null,
  p_cliente_id uuid default null,
  p_veiculo_id uuid default null,
  p_limite integer default 30,
  p_offset integer default 0
) RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  cliente_id uuid,
  veiculo_id uuid,
  servico_id uuid,
  categoria_id uuid,
  inicio timestamptz,
  duracao_minutos integer,
  duracao_total integer,
  modo_ocupacao text,
  modo_ocupacao_efetivo text,
  dias_ocupados smallint,
  preco_estimado numeric,
  preco_estimado_total numeric,
  status text,
  origem text,
  observacoes text,
  numero_os integer,
  forcado boolean,
  created_at timestamptz,
  updated_at timestamptz,
  cliente jsonb,
  veiculo jsonb,
  servico jsonb,
  categoria jsonb,
  agendamento_itens jsonb,
  execucao jsonb,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_busca_limpa text;
  v_busca_num integer := null;
  v_dono_inicio date := null;
  v_dono_fim date := null;
  v_target_cliente uuid := p_cliente_id;
BEGIN
  -- Valida se o usuário logado é membro ativo do tenant ou admin da plataforma
  IF NOT (p_tenant IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Trata busca textual e extrai números para comparar com numero_os
  IF p_busca IS NOT NULL AND trim(p_busca) <> '' THEN
    v_busca_limpa := trim(p_busca);
    BEGIN
      IF regexp_replace(lower(v_busca_limpa), '[^0-9]', '', 'g') <> '' THEN
        v_busca_num := (regexp_replace(lower(v_busca_limpa), '[^0-9]', '', 'g'))::integer;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_busca_num := null;
    END;
  END IF;

  -- Se p_veiculo_id for fornecido, descobre o período de propriedade
  IF p_veiculo_id IS NOT NULL THEN
    IF v_target_cliente IS NULL THEN
      SELECT vd.cliente_id, vd.inicio, vd.fim
      INTO v_target_cliente, v_dono_inicio, v_dono_fim
      FROM public.veiculo_donos vd
      WHERE vd.veiculo_id = p_veiculo_id
      ORDER BY CASE WHEN vd.fim IS NULL THEN 0 ELSE 1 END, vd.inicio DESC
      LIMIT 1;
    ELSE
      SELECT vd.inicio, vd.fim
      INTO v_dono_inicio, v_dono_fim
      FROM public.veiculo_donos vd
      WHERE vd.veiculo_id = p_veiculo_id AND vd.cliente_id = v_target_cliente
      ORDER BY vd.inicio DESC
      LIMIT 1;
    END IF;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      a.id,
      a.tenant_id,
      a.cliente_id,
      a.veiculo_id,
      a.servico_id,
      a.categoria_id,
      a.inicio,
      a.duracao_minutos,
      coalesce(a.duracao_total, a.duracao_minutos) AS duracao_total,
      a.modo_ocupacao,
      coalesce(a.modo_ocupacao_efetivo, a.modo_ocupacao) AS modo_ocupacao_efetivo,
      a.dias_ocupados,
      a.preco_estimado,
      coalesce(a.preco_estimado_total, a.preco_estimado) AS preco_estimado_total,
      a.status,
      a.origem,
      a.observacoes,
      a.numero_os,
      coalesce(a.forcado, false) AS forcado,
      a.created_at,
      a.updated_at,
      to_jsonb(c.*) AS cliente,
      CASE WHEN v.id IS NOT NULL THEN to_jsonb(v.*) ELSE null END AS veiculo,
      CASE WHEN s.id IS NOT NULL THEN to_jsonb(s.*) ELSE null END AS servico,
      CASE WHEN cat.id IS NOT NULL THEN to_jsonb(cat.*) ELSE null END AS categoria,
      coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', ai.id,
              'agendamento_id', ai.agendamento_id,
              'servico_id', ai.servico_id,
              'duracao_minutos', ai.duracao_minutos,
              'preco_estimado', ai.preco_estimado,
              'ordem', ai.ordem,
              'servicos', to_jsonb(s_item.*)
            ) ORDER BY ai.ordem ASC
          )
          FROM public.agendamento_itens ai
          LEFT JOIN public.servicos s_item ON s_item.id = ai.servico_id
          WHERE ai.agendamento_id = a.id
        ),
        '[]'::jsonb
      ) AS agendamento_itens,
      CASE WHEN ex.id IS NOT NULL THEN to_jsonb(ex.*) ELSE null END AS execucao,
      count(*) OVER() AS total_count
    FROM public.agendamentos a
    JOIN public.clientes c ON c.id = a.cliente_id
    LEFT JOIN public.veiculos v ON v.id = a.veiculo_id
    LEFT JOIN public.servicos s ON s.id = a.servico_id
    LEFT JOIN public.categorias_veiculo cat ON cat.id = a.categoria_id
    LEFT JOIN public.execucoes ex ON ex.agendamento_id = a.id
    WHERE a.tenant_id = p_tenant
      AND (p_cliente_id IS NULL OR a.cliente_id = p_cliente_id)
      AND (p_veiculo_id IS NULL OR (
            a.veiculo_id = p_veiculo_id
            AND (v_dono_inicio IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date >= v_dono_inicio)
            AND (v_dono_fim IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= v_dono_fim)
          ))
      -- Suporta serviços de múltiplos dias e pernoite: a vigência (início + dias - 1) deve cruzar o período p_inicio/p_fim
      AND (p_inicio IS NULL OR ((a.inicio AT TIME ZONE 'America/Sao_Paulo')::date + COALESCE(a.dias_ocupados, 1) - 1) >= p_inicio)
      AND (p_fim IS NULL OR (a.inicio AT TIME ZONE 'America/Sao_Paulo')::date <= p_fim)
      AND (p_status IS NULL OR cardinality(p_status) = 0 OR a.status = ANY(p_status))
      AND (
        v_busca_limpa IS NULL
        OR (v_busca_num IS NOT NULL AND a.numero_os = v_busca_num)
        OR (v.placa ILIKE '%' || v_busca_limpa || '%')
        OR (c.nome ILIKE '%' || v_busca_limpa || '%')
        OR (c.telefone ILIKE '%' || v_busca_limpa || '%')
        OR (a.observacoes ILIKE '%' || v_busca_limpa || '%')
      )
    ORDER BY a.inicio DESC
  )
  SELECT *
  FROM base
  LIMIT p_limite
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_agendamentos(uuid, date, date, text[], text, uuid, uuid, integer, integer) TO authenticated;
