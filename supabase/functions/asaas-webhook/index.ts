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

        // AUTOMAÇÃO DO PARCEIRO: Se esta oficina veio de um parceiro comercial, gera e aprova a comissão automaticamente
        const valorPagoCentavos = payment?.value ? Math.round(payment.value * 100) : (planoContratado === 'studio' ? 14700 : 6700);
        await supabase.rpc('processar_pagamento_asaas_parceiro', {
          p_tenant_id: tenantId,
          p_valor_centavos: valorPagoCentavos,
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
    } else if (['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'].includes(event)) {
      if (tenantId) {
        // 1. Rebaixa a oficina imediatamente para o plano free
        await supabase
          .from('tenants')
          .update({
            plano: 'free',
            updated_at: new Date().toISOString(),
          })
          .eq('id', tenantId);

        // 2. Marca a assinatura como cancelada
        await supabase
          .from('assinaturas')
          .update({
            status: 'cancelada',
            plano: 'free',
            cancelada_em: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenantId);

        // 3. Cancela comissões de parceiro pendentes ou aprovadas (não pagas) relativas a essa oficina
        await supabase
          .from('parceiro_comissoes')
          .update({
            status: 'cancelada',
            observacao: `Cancelada automaticamente por estorno do pagamento no Asaas (${event}) em ${hoje}`,
          })
          .eq('tenant_id', tenantId)
          .in('status', ['prevista', 'aprovada']);

        // 4. Auditoria do estorno
        await supabase.from('admin_auditoria').insert({
          admin_user_id: '00000000-0000-0000-0000-000000000000',
          acao: 'estorno_pagamento_asaas',
          entidade: 'tenants',
          entidade_id: tenantId,
          valor_anterior: { evento: event, paymentId: payment?.id },
          valor_novo: { plano: 'free', status: 'cancelada', comissao_parceiro: 'cancelada' },
        });
      }
    } else if (event === 'SUBSCRIPTION_DELETED') {
      if (tenantId) {
        // Obter assinatura para verificar se ainda está dentro do período pago
        const { data: ass } = await supabase
          .from('assinaturas')
          .select('proximo_vencimento')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        const vencimento = ass?.proximo_vencimento;
        const aindaDentroDoCicloPago = vencimento && vencimento >= hoje;

        // Atualizar status da assinatura para cancelada (não renovará)
        await supabase
          .from('assinaturas')
          .update({
            status: 'cancelada',
            cancelada_em: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenantId);

        // Se NÃO estiver dentro de um ciclo já pago, rebaixa para free imediatamente
        if (!aindaDentroDoCicloPago) {
          await supabase
            .from('tenants')
            .update({
              plano: 'free',
              updated_at: new Date().toISOString(),
            })
            .eq('id', tenantId);
        }
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
