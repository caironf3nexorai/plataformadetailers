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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Autenticação do Usuário via Bearer Token
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

    const { plano, forma_pagamento, term_version, creditCard, creditCardHolderInfo } = await req.json();

    if (!['pro', 'studio'].includes(plano)) {
      return new Response(JSON.stringify({ error: 'Plano inválido para checkout' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['cartao', 'pix'].includes(forma_pagamento)) {
      return new Response(JSON.stringify({ error: 'Forma de pagamento inválida' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Obter tenant_id do dono
    const { data: member, error: memberError } = await supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('status', 'ativo')
      .in('role', ['dono', 'gerente'])
      .single();

    if (memberError || !member) {
      return new Response(JSON.stringify({ error: 'Apenas Donos ou Gerentes podem realizar assinaturas' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tenantId = member.tenant_id;

    // Obter dados da oficina e perfil
    const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

    const valorReais = plano === 'pro' ? 67.0 : 147.0;
    const valorCentavos = plano === 'pro' ? 6700 : 14700;

    // Buscar se a oficina já possui registro em assinaturas
    const { data: assExistente } = await supabase
      .from('assinaturas')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    let asaasCustomerId = assExistente?.asaas_customer_id;

    // 1. Criar cliente no Asaas se não existir
    if (!asaasCustomerId) {
      const customerPayload = {
        name: tenant?.nome || profile?.nome || 'Oficina Detailer',
        email: user.email,
        phone: tenant?.telefone || profile?.telefone || '',
        cpfCnpj: profile?.cpf || tenant?.cnpj || '',
        externalReference: tenantId,
      };

      const resCustomer = await fetch(`${ASAAS_API_URL}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': ASAAS_API_KEY,
        },
        body: JSON.stringify(customerPayload),
      });

      const customerData = await resCustomer.json();
      if (!resCustomer.ok) {
        throw new Error(`Erro ao criar cliente no Asaas: ${JSON.stringify(customerData)}`);
      }

      asaasCustomerId = customerData.id;
    }

    // 2. Criar ou Atualizar Assinatura no Asaas (AJUSTE 2: Alterar existente sem duplicar)
    let subscriptionData;
    const billingType = forma_pagamento === 'cartao' ? 'CREDIT_CARD' : 'PIX';

    if (assExistente?.asaas_subscription_id) {
      // Atualizar assinatura existente no Asaas
      const updatePayload = {
        value: valorReais,
        billingType,
        description: `Plataforma Detailers - Plano ${plano.toUpperCase()} (${tenant?.nome || ''})`,
        cycle: 'MONTHLY',
      };

      const resSub = await fetch(`${ASAAS_API_URL}/subscriptions/${assExistente.asaas_subscription_id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': ASAAS_API_KEY,
        },
        body: JSON.stringify(updatePayload),
      });

      subscriptionData = await resSub.json();
      if (!resSub.ok) {
        throw new Error(`Erro ao atualizar assinatura no Asaas: ${JSON.stringify(subscriptionData)}`);
      }
    } else {
      // Criar nova assinatura no Asaas
      const subPayload: any = {
        customer: asaasCustomerId,
        billingType,
        value: valorReais,
        nextDueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Amanhã ou hoje
        cycle: 'MONTHLY',
        description: `Plataforma Detailers - Plano ${plano.toUpperCase()} (${tenant?.nome || ''})`,
        externalReference: tenantId,
      };

      if (forma_pagamento === 'cartao' && creditCard && creditCardHolderInfo) {
        subPayload.creditCard = creditCard;
        subPayload.creditCardHolderInfo = creditCardHolderInfo;
      }

      const resSub = await fetch(`${ASAAS_API_URL}/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': ASAAS_API_KEY,
        },
        body: JSON.stringify(subPayload),
      });

      subscriptionData = await resSub.json();
      if (!resSub.ok) {
        throw new Error(`Erro ao criar assinatura no Asaas: ${JSON.stringify(subscriptionData)}`);
      }
    }

    // 3. Gravar histórico em aceites_termos (AJUSTE 5)
    const ip = req.headers.get('x-forwarded-for') || '';
    const userAgent = req.headers.get('user-agent') || '';
    await supabase.from('aceites_termos').insert({
      tenant_id: tenantId,
      user_id: user.id,
      versao_documento: term_version || 'v1.0-2026-08',
      tipo_documento: 'ambos',
      ip_address: ip,
      user_agent: userAgent,
    });

    // 4. Salvar/Atualizar tabela local de assinaturas
    const paymentUrl = subscriptionData.bankInvoiceUrl || subscriptionData.invoiceUrl || '';

    await supabase.from('assinaturas').upsert({
      tenant_id: tenantId,
      asaas_customer_id: asaasCustomerId,
      asaas_subscription_id: subscriptionData.id,
      plano,
      forma_pagamento,
      valor_centavos: valorCentavos,
      url_pagamento_asaas: paymentUrl,
      updated_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        success: true,
        subscriptionId: subscriptionData.id,
        paymentUrl,
        status: subscriptionData.status,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro no processamento do checkout' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
