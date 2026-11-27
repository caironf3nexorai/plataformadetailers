/**
 * asaas-reconciliar — Edge Function de Reconciliação de Webhook
 *
 * Esta função faz duas coisas:
 *   1. Reativa o webhook interrompido no Asaas via API
 *   2. Consulta os pagamentos do período de falha e aplica as mesmas
 *      regras do webhook para corrigir o status das assinaturas no banco
 *
 * Uso (apenas Platform Admin):
 *   POST /functions/v1/asaas-reconciliar
 *   Headers: Authorization: Bearer <token>
 *   Body: {
 *     "data_inicio": "2026-11-12",   // início do período de falha
 *     "data_fim": "2026-11-27",      // fim (hoje por padrão)
 *     "reativar_webhook": true,       // tenta reativar webhook automaticamente
 *     "dry_run": false                // se true, apenas simula sem alterar dados
 *   }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') || 'https://api.asaas.com/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function getHojeSaoPauloIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Busca todas as páginas de pagamentos do Asaas no período */
async function buscarPagamentosNoPeriodo(dataInicio: string, dataFim: string): Promise<any[]> {
  const todos: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${ASAAS_API_URL}/payments?dateCreated[ge]=${dataInicio}&dateCreated[le]=${dataFim}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      console.error('[reconciliar] Erro ao buscar pagamentos:', res.status, await res.text());
      break;
    }

    const data = await res.json();
    const items: any[] = data.data || [];
    todos.push(...items);

    if (!data.hasMore || items.length === 0) break;
    offset += limit;
  }

  return todos;
}

/** Lista webhooks cadastrados no Asaas e retorna o primeiro interrompido */
async function listarWebhooks(): Promise<any[]> {
  const res = await fetch(`${ASAAS_API_URL}/webhooks`, {
    headers: { 'access_token': ASAAS_API_KEY },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

/** Reativa um webhook interrompido no Asaas */
async function reativarWebhook(webhookId: string): Promise<{ ok: boolean; msg: string }> {
  const res = await fetch(`${ASAAS_API_URL}/webhooks/${webhookId}`, {
    method: 'PUT',
    headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });

  const data = await res.json();
  return {
    ok: res.ok,
    msg: res.ok ? `Webhook ${webhookId} reativado com sucesso.` : `Erro: ${JSON.stringify(data)}`,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // — Autenticação e verificação de Platform Admin —
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Autorização requerida' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: adminRecord } = await supabase
      .from('platform_admins')
      .select('id')
      .or(`user_id.eq.${user.id},email.ilike.${user.email}`)
      .eq('ativo', true)
      .is('revogado_em', null)
      .maybeSingle();

    if (!adminRecord) {
      return new Response(JSON.stringify({ error: 'Acesso restrito a Platform Admins.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // — Parâmetros da requisição —
    const body = await req.json().catch(() => ({}));
    const dataInicio: string = body.data_inicio || '2026-11-12';
    const dataFim: string = body.data_fim || getHojeSaoPauloIso();
    const reativarWebhookFlag: boolean = body.reativar_webhook !== false;
    const dryRun: boolean = body.dry_run === true;
    const hoje = getHojeSaoPauloIso();

    const log: string[] = [];
    const erros: string[] = [];

    log.push(`[reconciliar] Início. Período: ${dataInicio} → ${dataFim}. dry_run=${dryRun}`);

    // ── PASSO 1: Reativar webhook interrompido ──────────────────────────────
    let webhookStatus = { reativado: false, msg: 'Reativação de webhook não solicitada.' };

    if (reativarWebhookFlag) {
      const webhooks = await listarWebhooks();
      log.push(`[reconciliar] ${webhooks.length} webhook(s) encontrado(s) no Asaas.`);

      const interrompido = webhooks.find((w: any) =>
        w.interrupted === true || w.enabled === false || w.status === 'INTERRUPTED'
      );

      if (interrompido) {
        log.push(`[reconciliar] Webhook interrompido encontrado: ${interrompido.id} (${interrompido.url})`);
        if (!dryRun) {
          const resultado = await reativarWebhook(interrompido.id);
          webhookStatus = { reativado: resultado.ok, msg: resultado.msg };
          log.push(`[reconciliar] ${resultado.msg}`);
        } else {
          webhookStatus = { reativado: false, msg: `[DRY RUN] Reativaria webhook ${interrompido.id}` };
          log.push(webhookStatus.msg);
        }
      } else {
        const ativo = webhooks.find((w: any) => w.enabled !== false && !w.interrupted);
        webhookStatus = {
          reativado: false,
          msg: ativo
            ? `Nenhum webhook interrompido. Webhook ${ativo.id} já está ativo.`
            : 'Nenhum webhook encontrado na conta Asaas.',
        };
        log.push(`[reconciliar] ${webhookStatus.msg}`);
      }
    }

    // ── PASSO 2: Buscar pagamentos do período de falha ──────────────────────
    log.push(`[reconciliar] Buscando pagamentos de ${dataInicio} a ${dataFim}...`);
    const pagamentos = await buscarPagamentosNoPeriodo(dataInicio, dataFim);
    log.push(`[reconciliar] ${pagamentos.length} pagamento(s) encontrado(s).`);

    // ── PASSO 3: Buscar assinaturas do período com base na data de pagamentos
    // Também busca por pagamentos OVERDUE com dueDate no período
    const overdueUrl = `${ASAAS_API_URL}/payments?status=OVERDUE&dueDate[ge]=${dataInicio}&dueDate[le]=${dataFim}&limit=100`;
    const overdueRes = await fetch(overdueUrl, {
      headers: { 'access_token': ASAAS_API_KEY },
    });
    const overdueData = overdueRes.ok ? await overdueRes.json() : { data: [] };
    const pagamentosOverdue: any[] = overdueData.data || [];
    log.push(`[reconciliar] ${pagamentosOverdue.length} pagamento(s) OVERDUE com vencimento no período.`);

    // Mescla e deduplica por ID
    const todosPagamentos = [...pagamentos, ...pagamentosOverdue];
    const pagamentosUnicos = Array.from(
      new Map(todosPagamentos.map((p: any) => [p.id, p])).values()
    );

    // ── PASSO 4: Processar cada pagamento ───────────────────────────────────
    const resultados: any[] = [];

    for (const payment of pagamentosUnicos) {
      const asaasSubId = payment.subscription;
      const paymentStatus = payment.status; // CONFIRMED, RECEIVED, OVERDUE, REFUNDED, etc.
      const paymentId = payment.id;

      // Localizar tenant via subscription
      let tenantId: string | null = null;
      if (payment.externalReference) {
        tenantId = payment.externalReference;
      } else if (asaasSubId) {
        const { data: ass } = await supabase
          .from('assinaturas')
          .select('tenant_id')
          .eq('asaas_subscription_id', asaasSubId)
          .maybeSingle();
        if (ass) tenantId = ass.tenant_id;
      }

      if (!tenantId) {
        log.push(`[reconciliar] Pagamento ${paymentId} (${paymentStatus}): tenant não encontrado. Pulando.`);
        continue;
      }

      // Verificar idempotência — já processamos esse pagamento via evento?
      const { data: eventoExistente } = await supabase
        .from('assinatura_eventos')
        .select('id')
        .eq('tipo', paymentStatus === 'OVERDUE' ? 'PAYMENT_OVERDUE' : `PAYMENT_${paymentStatus}`)
        .contains('payload', { payment: { id: paymentId } })
        .maybeSingle();

      const paymentUrl = payment.bankSlipUrl || payment.invoiceUrl || '';

      const acao: any = {
        payment_id: paymentId,
        subscription_id: asaasSubId,
        tenant_id: tenantId,
        status_asaas: paymentStatus,
        due_date: payment.dueDate,
        value: payment.value,
        acao_aplicada: 'nenhuma',
        ja_processado: !!eventoExistente,
      };

      if (eventoExistente) {
        acao.acao_aplicada = 'ignorado_idempotencia';
        resultados.push(acao);
        continue;
      }

      // Buscar estado atual da assinatura local
      const { data: assAtual } = await supabase
        .from('assinaturas')
        .select('plano, plano_pendente, ciclo, valor_centavos, status, asaas_subscription_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (['CONFIRMED', 'RECEIVED'].includes(paymentStatus)) {
        const planoContratado =
          (assAtual?.plano_pendente && assAtual.plano_pendente !== 'free' ? assAtual.plano_pendente : null) ||
          (assAtual?.plano && assAtual.plano !== 'free' ? assAtual.plano : null) ||
          'pro';

        let valorPagoCentavos = payment.value ? Math.round(Number(payment.value) * 100) : 0;
        if (!valorPagoCentavos && assAtual) {
          const { data: pRow } = await supabase
            .from('plans')
            .select('preco_centavos, preco_anual_centavos')
            .eq('codigo', planoContratado)
            .maybeSingle();
          valorPagoCentavos = assAtual.ciclo === 'anual'
            ? (pRow?.preco_anual_centavos ?? ((pRow?.preco_centavos || 0) * 10))
            : (pRow?.preco_centavos || assAtual.valor_centavos || 0);
        }

        if (!dryRun) {
          await supabase.from('assinaturas').update({
            plano: planoContratado,
            plano_pendente: null,
            status: 'ativa',
            is_cortesia: false,
            cortesia_ate: null,
            trial_fim: null,
            atraso_desde: null,
            cancelada_em: null,
            valor_centavos: valorPagoCentavos || assAtual?.valor_centavos || 0,
            url_pagamento_asaas: paymentUrl || undefined,
            proximo_vencimento: payment.dueDate || undefined,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);

          await supabase.from('tenants').update({
            plano: planoContratado,
            updated_at: new Date().toISOString(),
          }).eq('id', tenantId);

          // Registra evento para idempotência futura
          await supabase.from('assinatura_eventos').insert({
            asaas_event_id: `reconciliar_${paymentId}`,
            tipo: `PAYMENT_${paymentStatus}`,
            tenant_id: tenantId,
            payload: { reconciliado: true, payment },
          }).maybeSingle();
        }

        acao.acao_aplicada = `assinatura_ativada (plano: ${planoContratado})`;

      } else if (paymentStatus === 'OVERDUE') {
        // Só marca como atrasada se o status atual não for 'ativa' (pagamento mais recente pode já ter pago)
        if (assAtual?.status !== 'ativa' && !dryRun) {
          await supabase.from('assinaturas').update({
            status: 'atrasada',
            atraso_desde: payment.dueDate || hoje,
            url_pagamento_asaas: paymentUrl || undefined,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);

          await supabase.from('assinatura_eventos').insert({
            asaas_event_id: `reconciliar_${paymentId}`,
            tipo: 'PAYMENT_OVERDUE',
            tenant_id: tenantId,
            payload: { reconciliado: true, payment },
          }).maybeSingle();
        }

        acao.acao_aplicada = assAtual?.status === 'ativa'
          ? 'ignorado_ja_esta_ativa'
          : 'assinatura_marcada_atrasada';

      } else if (['REFUNDED', 'CHARGEBACK_REQUESTED'].includes(paymentStatus)) {
        if (!dryRun) {
          await supabase.from('tenants').update({ plano: 'free', updated_at: new Date().toISOString() }).eq('id', tenantId);
          await supabase.from('assinaturas').update({
            status: 'cancelada', plano: 'free', plano_pendente: null,
            is_cortesia: false, cortesia_ate: null, valor_centavos: 0,
            cancelada_em: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);

          await supabase.from('assinatura_eventos').insert({
            asaas_event_id: `reconciliar_${paymentId}`,
            tipo: `PAYMENT_${paymentStatus}`,
            tenant_id: tenantId,
            payload: { reconciliado: true, payment },
          }).maybeSingle();
        }
        acao.acao_aplicada = 'assinatura_cancelada_estorno';
      } else {
        acao.acao_aplicada = `status_ignorado (${paymentStatus})`;
      }

      resultados.push(acao);
      log.push(`[reconciliar] ${paymentId} → tenant ${tenantId} → ${acao.acao_aplicada}`);
    }

    // ── PASSO 5: Resumo ──────────────────────────────────────────────────────
    const resumo = {
      periodo: `${dataInicio} → ${dataFim}`,
      dry_run: dryRun,
      webhook: webhookStatus,
      pagamentos_analisados: pagamentosUnicos.length,
      acoes_aplicadas: resultados.filter((r) => !r.acao_aplicada.startsWith('ignorado') && !r.acao_aplicada.startsWith('nenhuma')).length,
      erros: erros.length,
      detalhes: resultados,
      log,
    };

    return new Response(JSON.stringify(resumo, null, 2), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[asaas-reconciliar] Erro:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Erro interno na reconciliação' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

