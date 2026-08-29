import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ASAAS_WEBHOOK_SECRET = Deno.env.get('ASAAS_WEBHOOK_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req) => {
  try {
    // 1. Validação de Token no Cabeçalho
    const tokenHeader = req.headers.get('asaas-access-token');
    if (ASAAS_WEBHOOK_SECRET && tokenHeader !== ASAAS_WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: 'Token de webhook inválido' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json();
    const { event, payment, subscription } = payload;
    const eventId = payload.id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Identificar tenant_id se disponível no externalReference ou buscar na tabela assinaturas
    const externalRef = payment?.externalReference || subscription?.externalReference;
    const asaasSubId = payment?.subscription || subscription?.id || payload?.subscription;
    const asaasCustomerId = payment?.customer || subscription?.customer || payload?.customer;

    let tenantId: string | null = null;
    if (externalRef) {
      tenantId = externalRef;
    } else if (asaasSubId) {
      const { data: ass } = await supabase
        .from('assinaturas')
        .select('tenant_id')
        .eq('asaas_subscription_id', asaasSubId)
        .maybeSingle();
      if (ass) tenantId = ass.tenant_id;
    }

    // 2. Idempotência: Gravar em assinatura_eventos (tenant_id aceita NULL)
    const { error: insertErr } = await supabase.from('assinatura_eventos').insert({
      asaas_event_id: eventId,
      tipo: event || 'UNKNOWN',
      tenant_id: tenantId,
      payload,
    });

    if (insertErr && insertErr.code === '23505') {
      // Evento já processado
      return new Response(JSON.stringify({ status: 'already_processed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Processamento dos Eventos do Asaas
    const hoje = new Date().toISOString().split('T')[0];
    const paymentUrl = payment?.bankInvoiceUrl || payment?.invoiceUrl || subscription?.bankInvoiceUrl || '';

    if (['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) {
      if (tenantId) {
        // Buscar plano cadastrado na assinatura
        const { data: ass } = await supabase
          .from('assinaturas')
          .select('plano')
          .eq('tenant_id', tenantId)
          .single();

        const planoContratado = ass?.plano || 'pro';

        // Atualizar assinatura para ativa
        await supabase
          .from('assinaturas')
          .update({
            status: 'ativa',
            atraso_desde: null,
            url_pagamento_asaas: paymentUrl || undefined,
            proximo_vencimento: payment?.dueDate || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenantId);

        // REGRA CENTRAL: Apenas o Webhook altera o plano ativo da oficina no banco de dados!
        await supabase
          .from('tenants')
          .update({
            plano: planoContratado,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);

        // AUTOMAÇÃO DA INDICAÇÃO: Se esta oficina foi indicada por outra, concede o bônus (+15d + metas) ao indicador automaticamente
        await supabase.rpc('processar_conversao_indicacao', {
          p_indicado_tenant_id: tenantId,
        });
      }
    } else if (event === 'PAYMENT_OVERDUE') {
      if (tenantId) {
        await supabase
          .from('assinaturas')
          .update({
            status: 'atrasada',
            atraso_desde: hoje,
            url_pagamento_asaas: paymentUrl || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenantId);
      }
    } else if (['SUBSCRIPTION_DELETED', 'PAYMENT_REFUNDED'].includes(event)) {
      if (tenantId) {
        await supabase
          .from('assinaturas')
          .update({
            status: 'cancelada',
            cancelada_em: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenantId);
      }
    }

    return new Response(JSON.stringify({ status: 'success' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro no processamento do webhook' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
