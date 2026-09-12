-- ==============================================================================
-- MIGRAÇÃO 0114: CRON AUTOMÁTICO DE OPORTUNIDADES DE RETORNO (DIÁRIO ÀS 08:00)
-- ==============================================================================

-- 1. FUNÇÃO EXECUTÁVEL PELO PG_CRON (SEM DEPENDÊNCIA DE AUTH.UID)
CREATE OR REPLACE FUNCTION public.cron_gerar_notificacoes_retorno()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_tenant RECORD;
  v_total_vencidas INTEGER;
  v_total_proximas INTEGER;
  v_ja_notificado BOOLEAN;
BEGIN
  -- Itera por todos os tenants cadastrados
  FOR r_tenant IN SELECT id FROM public.tenants LOOP
    -- Verifica se já gerou notificação desse tipo nas últimas 20 horas para não duplicar
    SELECT EXISTS (
      SELECT 1 FROM public.notificacoes
      WHERE tenant_id = r_tenant.id
        AND tipo = 'oportunidade_retorno'
        AND created_at >= (now() - interval '20 hours')
    ) INTO v_ja_notificado;

    IF NOT v_ja_notificado THEN
      -- Identifica os últimos atendimentos concluídos por cliente/veículo
      WITH ultimos_atendimentos AS (
        SELECT DISTINCT ON (a.cliente_id, a.veiculo_id)
          a.cliente_id,
          a.veiculo_id,
          a.servico_id,
          COALESCE(s.nome, 'Atendimento Geral') AS servico_nome,
          COALESCE(e.finalizado_em, a.inicio, a.created_at) AS data_conclusao
        FROM public.agendamentos a
        LEFT JOIN public.execucoes e ON e.agendamento_id = a.id
        LEFT JOIN public.servicos s ON s.id = a.servico_id
        WHERE a.tenant_id = r_tenant.id
          AND (a.status = 'concluido' OR e.status = 'finalizado')
          AND a.cliente_id IS NOT NULL
          AND a.veiculo_id IS NOT NULL
        ORDER BY a.cliente_id, a.veiculo_id, COALESCE(e.finalizado_em, a.inicio, a.created_at) DESC
      ),
      oportunidades AS (
        SELECT 
          CASE 
            WHEN (CURRENT_DATE - u.data_conclusao::date) >= r.dias_retorno THEN 'vencido'
            WHEN (CURRENT_DATE - u.data_conclusao::date) >= (r.dias_retorno - 7) THEN 'proximo'
            ELSE 'em_dia'
          END AS status_retorno
        FROM ultimos_atendimentos u
        JOIN public.clientes c ON c.id = u.cliente_id AND c.ativo = true
        JOIN public.veiculos v ON v.id = u.veiculo_id AND v.ativo = true
        CROSS JOIN LATERAL (
          SELECT reg.dias_retorno
          FROM public.regras_retorno_tenant reg
          WHERE reg.tenant_id = r_tenant.id AND reg.ativo = true
            AND (
              reg.servico_id = u.servico_id
              OR (reg.palavra_chave IS NOT NULL AND u.servico_nome ~* reg.palavra_chave)
            )
          ORDER BY (CASE WHEN reg.servico_id = u.servico_id THEN 1 ELSE 2 END) ASC, reg.ordem ASC
          LIMIT 1
        ) r
      )
      SELECT 
        COUNT(*) FILTER (WHERE status_retorno = 'vencido'),
        COUNT(*) FILTER (WHERE status_retorno = 'proximo')
      INTO v_total_vencidas, v_total_proximas
      FROM oportunidades;

      -- Se houver oportunidades vencidas ou a vencer, cria a notificação
      IF (COALESCE(v_total_vencidas, 0) + COALESCE(v_total_proximas, 0)) > 0 THEN
        INSERT INTO public.notificacoes (
          tenant_id,
          tipo,
          titulo,
          mensagem,
          link,
          metadata
        ) VALUES (
          r_tenant.id,
          'oportunidade_retorno',
          format('Oportunidades de Retorno: %s manutenções pendentes', (v_total_vencidas + v_total_proximas)),
          format('Você tem %s manutenções vencidas e %s previstas para os próximos 7 dias. Clique para contatar via WhatsApp.', v_total_vencidas, v_total_proximas),
          '/clientes?aba=oportunidades',
          jsonb_build_object('vencidas', v_total_vencidas, 'proximas', v_total_proximas)
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- 2. AGENDAMENTO NO PG_CRON: DIARIAMENTE ÀS 11:00 UTC (08:00 BRASÍLIA)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Desagenda se já existir
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notificacoes-retorno-diarias') THEN
      PERFORM cron.unschedule('notificacoes-retorno-diarias');
    END IF;

    -- Agenda para 11:00 UTC (08:00 da manhã no horário de Brasília)
    PERFORM cron.schedule(
      'notificacoes-retorno-diarias',
      '0 11 * * *',
      'SELECT public.cron_gerar_notificacoes_retorno();'
    );
  END IF;
END $$;
