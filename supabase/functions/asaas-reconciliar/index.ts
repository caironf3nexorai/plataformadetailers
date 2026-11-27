/**
 * asaas-reconciliar — Edge Function de Monitoramento, Reativação e Reconciliação Asaas
 *
 * Ações suportadas (body.action):
 *   - "status": Consulta webhooks no Asaas (GET /v3/webhooks) e retorna saúde em tempo real
 *   - "reativar": Despausa webhook interrompido via PUT /v3/webhooks/{id} { enabled: true, interrupted: false }
 *   - "reconciliar" (padrão): Reativa webhook se interrompido + busca pagamentos criados/pagos/vencidos
 *                             no período e aplica exatamente as mesmas regras do asaas-webhook
 *
 * Autenticação:
 *   1. Bearer JWT de um Platform Admin ativo (chamada pelo painel Admin)
 *   2. Cabeçalho x-cron-secret ou Authorization: Bearer <CRON_SECRET> (chamada por rotina automática/cron)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const ASAAS_API_URL = Deno.env.get('ASAAS_API_URL') || 'https://api.asaas.com/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function getDataIsoSaoPaulo(offsetDias = 0): string {
  const ref = new Date(Date.now() + offsetDias * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ref);
}

async function safeCompare(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode('asaas-reconciliar-compare-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ]);
  const arrA = new Uint8Array(sigA);
  const arrB = new Uint8Array(sigB);
  let diff = 0;
  for (let i = 0; i < arrA.length; i++) {
    diff |= arrA[i] ^ arrB[i];
  }
  return diff === 0;
}

interface AsaasWebhookInfo {
  id: string;
  name: string;
  url: string;
  email: string | null;
  enabled: boolean;
  interrupted: boolean;
  apiVersion?: number;
  sendType?: string;
  events: string[];
}

/** Busca todas as páginas de um endpoint paginado do Asaas */
async function buscarPaginadoAsaas(queryString: string): Promise<{ items: any[]; erro?: string }> {
  const todos: any[] = [];
  let offset = 0;
  const limit = 100;
  const maxPaginas = 20; // Trava de segurança contra loop infinito

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const separador = queryString.includes('?') ? '&' : '?';
    const url = `${ASAAS_API_URL}${queryString}${separador}limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { access_token: ASAAS_API_KEY, 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { items: todos, erro: `HTTP ${res.status} em ${queryString}: ${txt.slice(0, 200)}` };
    }

    const data = await res.json();
    const items: any[] = data.data || [];
    todos.push(...items);

    if (!data.hasMore || items.length === 0) break;
    offset += limit;
  }

  return { items: todos };
}

/** Lista webhooks cadastrados no Asaas */
async function listarWebhooks(): Promise<{ webhooks: AsaasWebhookInfo[]; erro?: string }> {
  if (!ASAAS_API_KEY) {
    return { webhooks: [], erro: 'Variável ASAAS_API_KEY não configurada nas Edge Functions.' };
  }
  const res = await fetch(`${ASAAS_API_URL}/webhooks`, {
    headers: { access_token: ASAAS_API_KEY, accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { webhooks: [], erro: `Falha ao listar webhooks no Asaas (HTTP ${res.status}): ${txt.slice(0, 200)}` };
  }
  const data = await res.json();
  const lista: AsaasWebhookInfo[] = (data.data || []).map((w: any) => ({
    id: String(w.id),
    name: String(w.name || 'Webhook Asaas'),
    url: String(w.url || ''),
    email: w.email || null,
    enabled: w.enabled !== false,
    interrupted: w.interrupted === true,
    apiVersion: w.apiVersion,
    sendType: w.sendType,
    events: Array.isArray(w.events) ? w.events : [],
  }));
  return { webhooks: lista };
}

/**
 * Reativa um webhook interrompido ou desabilitado no Asaas API v3.
 * Envia explicitamente { enabled: true, interrupted: false } (campo obrigatório para despausar a fila)
 * e confirma o estado atualizado na resposta.
 */
async function reativarWebhookAsaas(webhookId: string): Promise<{
  ok: boolean;
  msg: string;
  interrupted?: boolean;
  enabled?: boolean;
}> {
  const res = await fetch(`${ASAAS_API_URL}/webhooks/${webhookId}`, {
    method: 'PUT',
    headers: {
      access_token: ASAAS_API_KEY,
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      enabled: true,
      interrupted: false,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.errors?.[0]?.description || JSON.stringify(data).slice(0, 250);
    return { ok: false, msg: `Falha ao reativar webhook ${webhookId} (HTTP ${res.status}): ${errMsg}` };
  }

  const aindaInterrompido = data?.interrupted === true;
  const habilitado = data?.enabled !== false;

  if (aindaInterrompido || !habilitado) {
    return {
      ok: false,
      interrupted: aindaInterrompido,
      enabled: habilitado,
      msg: `Asaas respondeu HTTP 200, mas o webhook ${webhookId} permanece com enabled=${habilitado}, interrupted=${aindaInterrompido}.`,
    };
  }

  return {
    ok: true,
    interrupted: false,
    enabled: true,
    msg: `Webhook ${webhookId} reativado e fila despausada com sucesso (enabled=true, interrupted=false).`,
  };
}

/** Grava registro de monitoramento sem quebrar a resposta caso a tabela ainda não exista */
async function registrarMonitoramento(
  supabase: ReturnType<typeof createClient>,
  registro: {
    origem: 'admin' | 'cron';
    acao: string;
    executado_por?: string | null;
    webhook_saudavel: boolean;
    webhooks_total: number;
    webhooks_interrompidos: number;
    pagamentos_analisados: number;
    acoes_aplicadas: number;
    erros_count: number;
    resumo_mensagem: string;
    detalhes: Record<string, unknown>;
  }
) {
  try {
    await supabase.from('asaas_webhook_monitoramento').insert(registro);
  } catch (err) {
    console.warn('[asaas-reconciliar] Não foi possível gravar em asaas_webhook_monitoramento:', err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Autenticação: Platform Admin JWT OU CRON_SECRET ──────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    const cronHeader = req.headers.get('x-cron-secret') || '';
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();

    let origem: 'admin' | 'cron' = 'admin';
    let executadoPor: string | null = null;

    const isCron = CRON_SECRET
      ? ((await safeCompare(cronHeader, CRON_SECRET)) || (await safeCompare(bearerToken, CRON_SECRET)))
      : false;

    if (isCron) {
      origem = 'cron';
      executadoPor = 'cron_automatico';
    } else {
      if (!bearerToken) {
        return new Response(JSON.stringify({ error: 'Autorização requerida' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser(bearerToken);
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Sessão inválida ou expirada' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: adminRecord } = await supabase
        .from('platform_admins')
        .select('id, email')
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

      origem = 'admin';
      executadoPor = user.email || user.id;
    }

    // ── Parâmetros ───────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const action: 'status' | 'reativar' | 'reconciliar' = body.action || 'reconciliar';
    const hoje = getDataIsoSaoPaulo(0);
    const padraoInicio = origem === 'cron' ? getDataIsoSaoPaulo(-2) : getDataIsoSaoPaulo(-15);
    const dataInicio: string = body.data_inicio || padraoInicio;
    const dataFim: string = body.data_fim || hoje;
    const reativarWebhookFlag: boolean = body.reativar_webhook !== false;
    const dryRun: boolean = body.dry_run === true;
    const webhookIdAlvo: string | null = body.webhook_id ? String(body.webhook_id) : null;

    // ── AÇÃO 1: STATUS (consulta rápida de saúde do webhook) ─────────────────
    if (action === 'status') {
      const { webhooks, erro } = await listarWebhooks();
      const interrompidos = webhooks.filter((w) => w.interrupted || !w.enabled);
      const saudavel = !erro && webhooks.length > 0 && interrompidos.length === 0;

      const { data: ultimoEvento } = await supabase
        .from('assinatura_eventos')
        .select('asaas_event_id, tipo, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const resumoMsg = erro
        ? erro
        : webhooks.length === 0
          ? 'Nenhum webhook configurado na conta Asaas.'
          : interrompidos.length > 0
            ? `${interrompidos.length} webhook(s) interrompido(s) ou desativado(s) no Asaas.`
            : `${webhooks.length} webhook(s) ativo(s) e saudável(is) no Asaas.`;

      await registrarMonitoramento(supabase, {
        origem,
        acao: 'status',
        executado_por: executadoPor,
        webhook_saudavel: saudavel,
        webhooks_total: webhooks.length,
        webhooks_interrompidos: interrompidos.length,
        pagamentos_analisados: 0,
        acoes_aplicadas: 0,
        erros_count: erro ? 1 : 0,
        resumo_mensagem: resumoMsg,
        detalhes: { webhooks, erro: erro || null },
      });

      return new Response(
        JSON.stringify({
          sucesso: !erro,
          saudavel,
          ambiente_asaas: ASAAS_API_URL.includes('sandbox') ? 'sandbox' : 'producao',
          mensagem: resumoMsg,
          webhooks,
          webhooks_interrompidos: interrompidos.length,
          ultimo_evento: ultimoEvento || null,
          verificado_em: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── AÇÃO 2: REATIVAR (despausar fila interrompida com 1 clique) ──────────
    if (action === 'reativar') {
      const { webhooks, erro } = await listarWebhooks();
      if (erro) {
        return new Response(JSON.stringify({ sucesso: false, error: erro }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const alvos = webhookIdAlvo
        ? webhooks.filter((w) => w.id === webhookIdAlvo)
        : webhooks.filter((w) => w.interrupted || !w.enabled);

      if (alvos.length === 0) {
        return new Response(
          JSON.stringify({
            sucesso: true,
            reativados: 0,
            mensagem: webhooks.length === 0
              ? 'Nenhum webhook cadastrado na conta Asaas para reativar.'
              : 'Todos os webhooks já estão ativos e sem interrupção.',
            webhooks,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const resultadosReativacao = [];
      let errosCount = 0;

      for (const wh of alvos) {
        const res = await reativarWebhookAsaas(wh.id);
        if (!res.ok) errosCount++;
        resultadosReativacao.push({ id: wh.id, url: wh.url, ...res });
      }

      const { webhooks: webhooksAtualizados } = await listarWebhooks();
      const interrompidosDepois = webhooksAtualizados.filter((w) => w.interrupted || !w.enabled);
      const saudavelDepois = webhooksAtualizados.length > 0 && interrompidosDepois.length === 0;

      const msgFinal = errosCount === 0
        ? `${resultadosReativacao.length} webhook(s) reativado(s) com sucesso (interrupted=false).`
        : `${resultadosReativacao.length - errosCount} reativado(s) e ${errosCount} com erro.`;

      await registrarMonitoramento(supabase, {
        origem,
        acao: 'reativar',
        executado_por: executadoPor,
        webhook_saudavel: saudavelDepois,
        webhooks_total: webhooksAtualizados.length,
        webhooks_interrompidos: interrompidosDepois.length,
        pagamentos_analisados: 0,
        acoes_aplicadas: resultadosReativacao.filter((r) => r.ok).length,
        erros_count: errosCount,
        resumo_mensagem: msgFinal,
        detalhes: { resultados: resultadosReativacao, webhooks: webhooksAtualizados },
      });

      return new Response(
        JSON.stringify({
          sucesso: errosCount === 0,
          saudavel: saudavelDepois,
          mensagem: msgFinal,
          resultados: resultadosReativacao,
          webhooks: webhooksAtualizados,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── AÇÃO 3: RECONCILIAR (reativação + varredura de pagamentos) ───────────
    const log: string[] = [];
    const erros: string[] = [];

    log.push(`[reconciliar] Início (${origem}). Período: ${dataInicio} → ${dataFim}. dry_run=${dryRun}`);

    // Passo 1: Checar e (se necessário) reativar webhooks interrompidos
    const { webhooks, erro: errListWh } = await listarWebhooks();
    if (errListWh) {
      erros.push(errListWh);
      log.push(`[reconciliar] ERRO ao listar webhooks: ${errListWh}`);
    }

    const interrompidosAntes = webhooks.filter((w) => w.interrupted || !w.enabled);
    let webhookStatus = {
      total: webhooks.length,
      interrompidos_antes: interrompidosAntes.length,
      reativado: false,
      msg: 'Reativação de webhook não solicitada.',
    };

    if (reativarWebhookFlag && !errListWh) {
      log.push(`[reconciliar] ${webhooks.length} webhook(s) encontrado(s) no Asaas (${interrompidosAntes.length} interrompido(s)).`);

      if (interrompidosAntes.length > 0) {
        if (!dryRun) {
          let reativadosOk = 0;
          const msgs: string[] = [];
          for (const wh of interrompidosAntes) {
            const resReat = await reativarWebhookAsaas(wh.id);
            msgs.push(resReat.msg);
            if (resReat.ok) reativadosOk++;
            else erros.push(resReat.msg);
            log.push(`[reconciliar] ${resReat.msg}`);
          }
          webhookStatus = {
            total: webhooks.length,
            interrompidos_antes: interrompidosAntes.length,
            reativado: reativadosOk > 0,
            msg: msgs.join(' | '),
          };
        } else {
          webhookStatus = {
            total: webhooks.length,
            interrompidos_antes: interrompidosAntes.length,
            reativado: false,
            msg: `[DRY RUN] Reativaria ${interrompidosAntes.length} webhook(s) interrompido(s) com interrupted=false.`,
          };
          log.push(webhookStatus.msg);
        }
      } else {
        webhookStatus = {
          total: webhooks.length,
          interrompidos_antes: 0,
          reativado: false,
          msg: webhooks.length > 0
            ? `Todos os ${webhooks.length} webhook(s) já estão ativos e saudáveis.`
            : 'Nenhum webhook configurado na conta Asaas.',
        };
        log.push(`[reconciliar] ${webhookStatus.msg}`);
      }
    }

    // Passo 2: Buscar pagamentos sob 3 critérios (criados, pagos e vencidos no período)
    log.push(`[reconciliar] Consultando pagamentos (criados, pagos e vencidos) de ${dataInicio} a ${dataFim}...`);

    const [resCriados, resPagos, resOverdue] = await Promise.all([
      buscarPaginadoAsaas(`/payments?dateCreated[ge]=${dataInicio}&dateCreated[le]=${dataFim}`),
      buscarPaginadoAsaas(`/payments?paymentDate[ge]=${dataInicio}&paymentDate[le]=${dataFim}`),
      buscarPaginadoAsaas(`/payments?status=OVERDUE&dueDate[ge]=${dataInicio}&dueDate[le]=${dataFim}`),
    ]);

    if (resCriados.erro) erros.push(resCriados.erro);
    if (resPagos.erro) erros.push(resPagos.erro);
    if (resOverdue.erro) erros.push(resOverdue.erro);

    log.push(
      `[reconciliar] Encontrados: criados=${resCriados.items.length}, pagos=${resPagos.items.length}, overdue=${resOverdue.items.length}.`
    );

    // Mescla e deduplica por payment.id
    const mapaPagamentos = new Map<string, any>();
    for (const p of [...resCriados.items, ...resPagos.items, ...resOverdue.items]) {
      if (p?.id) mapaPagamentos.set(p.id, p);
    }
    const pagamentosUnicos = Array.from(mapaPagamentos.values());

    // Passo 3: Processar cada pagamento aplicando as mesmas regras do asaas-webhook
    const resultados: any[] = [];

    for (const payment of pagamentosUnicos) {
      const asaasSubId = payment.subscription;
      const paymentStatus = payment.status;
      const paymentId = payment.id;

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
        log.push(`[reconciliar] Pagamento ${paymentId} (${paymentStatus}): sem tenant vinculado no banco. Ignorado.`);
        continue;
      }

      const tipoEvento = paymentStatus === 'OVERDUE' ? 'PAYMENT_OVERDUE' : `PAYMENT_${paymentStatus}`;

      // Idempotência: verificar se já existe evento processado para esse paymentId e status
      const { data: eventoExistente } = await supabase
        .from('assinatura_eventos')
        .select('id')
        .eq('tipo', tipoEvento)
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
        ja_processado: Boolean(eventoExistente),
      };

      if (eventoExistente) {
        acao.acao_aplicada = 'ignorado_idempotencia';
        resultados.push(acao);
        continue;
      }

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

          // Automações complementares (mesmo fluxo do asaas-webhook)
          try {
            await supabase.rpc('processar_conversao_indicacao', { p_indicado_tenant_id: tenantId });
          } catch (e) {
            console.warn('[reconciliar] Aviso indicacao:', e);
          }
          try {
            await supabase.rpc('processar_pagamento_asaas_parceiro', {
              p_tenant_id: tenantId,
              p_valor_centavos: valorPagoCentavos,
            });
          } catch (e) {
            console.warn('[reconciliar] Aviso parceiro:', e);
          }
          try {
            await supabase.rpc('confirmar_uso_cupom', {
              p_tenant_id: tenantId,
              p_asaas_subscription_id: asaasSubId || assAtual?.asaas_subscription_id || null,
              p_asaas_payment_id: paymentId || null,
            });
          } catch (e) {
            console.warn('[reconciliar] Aviso cupom:', e);
          }

          await supabase.from('assinatura_eventos').insert({
            asaas_event_id: `reconciliar_${paymentId}_${paymentStatus}`,
            tipo: tipoEvento,
            tenant_id: tenantId,
            payload: { reconciliado: true, origem, payment },
          }).maybeSingle();
        }

        acao.acao_aplicada = dryRun
          ? `[SIMULACAO] ativaria_assinatura (${planoContratado})`
          : `assinatura_ativada (${planoContratado})`;
      } else if (paymentStatus === 'OVERDUE') {
        if (assAtual?.status !== 'ativa' && !dryRun) {
          await supabase.from('assinaturas').update({
            status: 'atrasada',
            atraso_desde: payment.dueDate || hoje,
            url_pagamento_asaas: paymentUrl || undefined,
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);

          await supabase.from('assinatura_eventos').insert({
            asaas_event_id: `reconciliar_${paymentId}_OVERDUE`,
            tipo: 'PAYMENT_OVERDUE',
            tenant_id: tenantId,
            payload: { reconciliado: true, origem, payment },
          }).maybeSingle();
        }

        acao.acao_aplicada = assAtual?.status === 'ativa'
          ? 'ignorado_ja_esta_ativa'
          : dryRun
            ? '[SIMULACAO] marcaria_atrasada'
            : 'assinatura_marcada_atrasada';
      } else if (['REFUNDED', 'CHARGEBACK_REQUESTED'].includes(paymentStatus)) {
        if (!dryRun) {
          await supabase.from('tenants').update({
            plano: 'free',
            updated_at: new Date().toISOString(),
          }).eq('id', tenantId);

          await supabase.from('assinaturas').update({
            status: 'cancelada',
            plano: 'free',
            plano_pendente: null,
            is_cortesia: false,
            cortesia_ate: null,
            valor_centavos: 0,
            cancelada_em: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('tenant_id', tenantId);

          await supabase
            .from('parceiro_comissoes')
            .update({
              status: 'cancelada',
              observacao: `Cancelada automaticamente por estorno na reconciliação Asaas (${tipoEvento}) em ${hoje}`,
            })
            .eq('tenant_id', tenantId)
            .in('status', ['prevista', 'aprovada']);

          await supabase.from('assinatura_eventos').insert({
            asaas_event_id: `reconciliar_${paymentId}_${paymentStatus}`,
            tipo: tipoEvento,
            tenant_id: tenantId,
            payload: { reconciliado: true, origem, payment },
          }).maybeSingle();
        }

        acao.acao_aplicada = dryRun
          ? '[SIMULACAO] cancelaria_estorno'
          : 'assinatura_cancelada_estorno';
      } else {
        acao.acao_aplicada = `status_ignorado (${paymentStatus})`;
      }

      resultados.push(acao);
      log.push(`[reconciliar] ${paymentId} → tenant ${tenantId} → ${acao.acao_aplicada}`);
    }

    const acoesAplicadas = resultados.filter(
      (r) => !r.acao_aplicada.startsWith('ignorado') && !r.acao_aplicada.startsWith('status_ignorado') && r.acao_aplicada !== 'nenhuma'
    ).length;

    const { webhooks: webhooksPos } = await listarWebhooks();
    const interrompidosDepois = webhooksPos.filter((w) => w.interrupted || !w.enabled);
    const saudavelDepois = !errListWh && webhooksPos.length > 0 && interrompidosDepois.length === 0;

    const resumoMensagem = dryRun
      ? `Simulação (${dataInicio} → ${dataFim}): ${pagamentosUnicos.length} pagamento(s) analisado(s), ${acoesAplicadas} ação(ões) prevista(s).`
      : `Reconciliação (${dataInicio} → ${dataFim}): ${pagamentosUnicos.length} pagamento(s) analisado(s), ${acoesAplicadas} ação(ões) aplicada(s), ${erros.length} erro(s).`;

    if (!dryRun) {
      await registrarMonitoramento(supabase, {
        origem,
        acao: 'reconciliar',
        executado_por: executadoPor,
        webhook_saudavel: saudavelDepois,
        webhooks_total: webhooksPos.length,
        webhooks_interrompidos: interrompidosDepois.length,
        pagamentos_analisados: pagamentosUnicos.length,
        acoes_aplicadas: acoesAplicadas,
        erros_count: erros.length,
        resumo_mensagem: resumoMensagem,
        detalhes: {
          periodo: `${dataInicio} → ${dataFim}`,
          webhook: webhookStatus,
          erros,
          resultados: resultados.slice(0, 50),
        },
      });
    }

    return new Response(
      JSON.stringify({
        sucesso: erros.length === 0,
        saudavel: saudavelDepois,
        mensagem: resumoMensagem,
        periodo: `${dataInicio} → ${dataFim}`,
        dry_run: dryRun,
        webhook: webhookStatus,
        webhooks: webhooksPos,
        pagamentos_analisados: pagamentosUnicos.length,
        acoes_aplicadas: acoesAplicadas,
        erros,
        detalhes: resultados,
        log,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[asaas-reconciliar] Erro:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Erro interno na reconciliação' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
