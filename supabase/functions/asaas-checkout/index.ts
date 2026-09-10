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

    const { plano, forma_pagamento, term_version, creditCard, creditCardHolderInfo, telefone: reqTelefone, cpfCnpj: reqCpfCnpj, cupom: reqCupom } = await req.json();

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

    // Buscar valor real configurado na tabela public.plans
    const { data: planRow } = await supabase
      .from('plans')
      .select('preco_centavos, nome')
      .eq('codigo', plano)
      .maybeSingle();

    const precoCentavos = planRow?.preco_centavos ?? (plano === 'pro' ? 6700 : 14700);
    let valorReais = Number((precoCentavos / 100).toFixed(2));
    let valorCentavos = precoCentavos;
    let cupomAplicado: any = null;

    // Validar e aplicar Cupom de Desconto se fornecido
    if (reqCupom && String(reqCupom).trim()) {
      try {
        const { data: cupomRes, error: cupomErr } = await supabase.rpc('validar_cupom', {
          p_codigo: String(reqCupom).trim(),
          p_plano: plano,
        });

        if (!cupomErr && cupomRes?.valido) {
          cupomAplicado = cupomRes;
          valorReais = Number(cupomRes.valor_final);
          valorCentavos = Math.round(valorReais * 100);
          console.log(`[Checkout Asaas] Cupom ${cupomRes.codigo} aplicado. De R$ ${cupomRes.valor_original} por R$ ${valorReais}`);
        } else if (cupomRes?.mensagem) {
          console.warn('[Checkout Asaas] Cupom não aplicado:', cupomRes.mensagem);
        }
      } catch (errCupom) {
        console.warn('[Checkout Asaas] Falha ao validar cupom:', errCupom);
      }
    }

    // Buscar se a oficina já possui registro em assinaturas
    const { data: assExistente } = await supabase
      .from('assinaturas')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    let asaasCustomerId = assExistente?.asaas_customer_id;

    // 1. Validador estrito de telefone brasileiro
    const getValidPhone = (inputPhone: string): { phone?: string; mobilePhone?: string } => {
      if (!inputPhone) return {};
      const clean = String(inputPhone).replace(/\D/g, '');
      if (clean.length !== 10 && clean.length !== 11) return {};

      const ddd = parseInt(clean.substring(0, 2), 10);
      const validDdds = [
        11, 12, 13, 14, 15, 16, 17, 18, 19,
        21, 22, 24, 27, 28,
        31, 32, 33, 34, 35, 37, 38,
        41, 42, 43, 44, 45, 46, 47, 48, 49,
        51, 53, 54, 55,
        61, 62, 63, 64, 65, 66, 67, 68, 69,
        71, 73, 74, 75, 77, 79,
        81, 82, 83, 84, 85, 86, 87, 88, 89,
        91, 92, 93, 94, 95, 96, 97, 98, 99,
      ];
      if (!validDdds.includes(ddd)) return {};

      const numberPart = clean.substring(2);
      if (/^(\d)\1+$/.test(numberPart)) return {};
      if (/^(\d)\1+$/.test(clean)) return {};
      if (numberPart === '123456789' || numberPart === '987654321' || numberPart === '12345678') return {};

      if (clean.length === 11) {
        if (numberPart[0] !== '9') return {};
        if (['0', '1'].includes(numberPart[1])) return {};
        return { mobilePhone: clean };
      }

      if (clean.length === 10) {
        if (!['2', '3', '4', '5'].includes(numberPart[0])) return {};
        return { phone: clean };
      }

      return {};
    };

    const getValidCpfCnpj = (inputDoc: string): string | undefined => {
      if (!inputDoc) return undefined;
      const clean = String(inputDoc).replace(/\D/g, '');
      if (clean.length !== 11 && clean.length !== 14) return undefined;
      if (/^(\d)\1+$/.test(clean)) return undefined;
      return clean;
    };

    const candidatePhone = reqTelefone || tenant?.telefone || profile?.telefone || '';
    const candidateDoc = reqCpfCnpj || profile?.cpf || tenant?.documento || tenant?.cnpj || '';

    const phoneFields = getValidPhone(candidatePhone);
    const validDoc = getValidCpfCnpj(candidateDoc);

    // No Brasil e no Asaas, CPF ou CNPJ é estritamente obrigatório para emitir faturas de assinatura
    if (!validDoc) {
      return new Response(
        JSON.stringify({ error: 'O CPF ou CNPJ é obrigatório para emissão da cobrança no Asaas. Por favor, preencha o documento no checkout.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Salvar documento no perfil e tenant caso ainda não existisse
    if (validDoc && (!profile?.cpf || !tenant?.documento)) {
      if (!profile?.cpf) {
        await supabase.from('profiles').update({ cpf: validDoc }).eq('id', user.id);
      }
      if (!tenant?.documento) {
        await supabase.from('tenants').update({ documento: validDoc }).eq('id', tenantId);
      }
    }

    // 2. Criar ou Obter cliente no Asaas
    if (!asaasCustomerId) {
      // 2.1 Verificar se já existe cliente cadastrado no Asaas para este tenant
      try {
        const checkRes = await fetch(`${ASAAS_API_URL}/customers?externalReference=${tenantId}`, {
          headers: { 'access_token': ASAAS_API_KEY },
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData?.data && checkData.data.length > 0) {
            asaasCustomerId = checkData.data[0].id;
          }
        }
      } catch (errCheck) {
        console.warn('Aviso ao consultar cliente existente por externalReference:', errCheck);
      }
    }

    if (!asaasCustomerId && user.email) {
      // 2.2 Verificar se já existe cliente por email
      try {
        const checkEmailRes = await fetch(`${ASAAS_API_URL}/customers?email=${encodeURIComponent(user.email)}`, {
          headers: { 'access_token': ASAAS_API_KEY },
        });
        if (checkEmailRes.ok) {
          const checkEmailData = await checkEmailRes.json();
          if (checkEmailData?.data && checkEmailData.data.length > 0) {
            asaasCustomerId = checkEmailData.data[0].id;
          }
        }
      } catch (errEmail) {
        console.warn('Aviso ao consultar cliente existente por email:', errEmail);
      }
    }

    if (!asaasCustomerId) {
      const customerPayload: Record<string, any> = {
        name: tenant?.nome || profile?.nome || 'Oficina Detailer',
        email: user.email,
        cpfCnpj: validDoc,
        externalReference: tenantId,
        ...phoneFields,
      };

      let resCustomer = await fetch(`${ASAAS_API_URL}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': ASAAS_API_KEY,
        },
        body: JSON.stringify(customerPayload),
      });

      let customerData = await resCustomer.json();

      // AUTO-RECUPERAÇÃO: se o Asaas recusar telefone, tentar sem o telefone opcional
      if (!resCustomer.ok && customerData?.errors && Array.isArray(customerData.errors)) {
        const errorCodes = customerData.errors.map((e: any) => String(e.code || ''));
        const hasPhoneError = errorCodes.some((c: string) => c.includes('phone') || c.includes('telefone'));

        if (hasPhoneError) {
          console.warn('[asaas-checkout] Retentando criar cliente sem telefone rejeitado:', customerData.errors);
          delete customerPayload.mobilePhone;
          delete customerPayload.phone;

          resCustomer = await fetch(`${ASAAS_API_URL}/customers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'access_token': ASAAS_API_KEY,
            },
            body: JSON.stringify(customerPayload),
          });
          customerData = await resCustomer.json();
        }
      }

      if (!resCustomer.ok) {
        const desc = customerData?.errors?.[0]?.description || JSON.stringify(customerData);
        throw new Error(`Erro ao criar cliente no Asaas: ${desc}`);
      }

      asaasCustomerId = customerData.id;
    } else {
      // 2.3 Se o cliente já existia, garantir que o CPF/CNPJ está sincronizado no Asaas
      try {
        await fetch(`${ASAAS_API_URL}/customers/${asaasCustomerId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'access_token': ASAAS_API_KEY,
          },
          body: JSON.stringify({ cpfCnpj: validDoc }),
        });
      } catch (errSync) {
        console.warn('Aviso ao sincronizar CPF com cliente Asaas:', errSync);
      }
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
        updatePendingPayments: true,
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
        // Se a assinatura antiga não existir mais no Asaas (404 / not_found), criar uma nova
        if (resSub.status === 404 || subscriptionData?.errors?.[0]?.code === 'not_found') {
          console.warn('Assinatura anterior não encontrada no Asaas. Criando nova assinatura...');
          const subPayload: any = {
            customer: asaasCustomerId,
            billingType,
            value: valorReais,
            nextDueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            cycle: 'MONTHLY',
            description: `Plataforma Detailers - Plano ${plano.toUpperCase()} (${tenant?.nome || ''})`,
            externalReference: tenantId,
          };

          if (forma_pagamento === 'cartao' && creditCard && creditCardHolderInfo) {
            subPayload.creditCard = creditCard;
            subPayload.creditCardHolderInfo = creditCardHolderInfo;
          }

          const resSubNew = await fetch(`${ASAAS_API_URL}/subscriptions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'access_token': ASAAS_API_KEY,
            },
            body: JSON.stringify(subPayload),
          });

          subscriptionData = await resSubNew.json();
          if (!resSubNew.ok) {
            const desc = subscriptionData?.errors?.[0]?.description || JSON.stringify(subscriptionData);
            throw new Error(`Erro ao criar assinatura no Asaas: ${desc}`);
          }
        } else {
          const desc = subscriptionData?.errors?.[0]?.description || JSON.stringify(subscriptionData);
          throw new Error(`Erro ao atualizar assinatura no Asaas: ${desc}`);
        }
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
        const desc = subscriptionData?.errors?.[0]?.description || JSON.stringify(subscriptionData);
        throw new Error(`Erro ao criar assinatura no Asaas: ${desc}`);
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
    let paymentUrl = subscriptionData.bankInvoiceUrl || subscriptionData.invoiceUrl || subscriptionData.paymentLink || '';
    let pixData: { encodedImage?: string; payload?: string; expirationDate?: string } | null = null;

    // Buscar pagamentos gerados pela assinatura para resgatar URL e QR Code Pix
    if (subscriptionData?.id) {
      try {
        const resPayments = await fetch(`${ASAAS_API_URL}/subscriptions/${subscriptionData.id}/payments`, {
          headers: {
            'access_token': ASAAS_API_KEY,
          },
        });
        if (resPayments.ok) {
          const paymentsData = await resPayments.json();
          const firstPay = paymentsData?.data?.[0];
          if (firstPay) {
            if (!paymentUrl) {
              paymentUrl = firstPay.invoiceUrl || firstPay.bankInvoiceUrl || '';
            }

            // Se for PIX, buscar QR Code e Copia e Cola diretamente da cobrança gerada
            if (forma_pagamento === 'pix' || firstPay.billingType === 'PIX') {
              try {
                const resPix = await fetch(`${ASAAS_API_URL}/payments/${firstPay.id}/pixQrCode`, {
                  headers: { 'access_token': ASAAS_API_KEY },
                });
                if (resPix.ok) {
                  const pixJson = await resPix.json();
                  if (pixJson?.encodedImage || pixJson?.payload) {
                    pixData = {
                      encodedImage: pixJson.encodedImage,
                      payload: pixJson.payload,
                      expirationDate: pixJson.expirationDate,
                    };
                  }
                }
              } catch (ePix) {
                console.warn('Aviso ao consultar QR Code Pix:', ePix);
              }
            }
          }
        }
      } catch (errPay) {
        console.warn('Aviso ao consultar fatura da assinatura:', errPay);
      }
    }

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

    // 5. Registrar uso do cupom na tabela se aplicado com sucesso
    if (cupomAplicado?.id) {
      try {
        await supabase.rpc('registrar_uso_cupom', {
          p_cupom_id: cupomAplicado.id,
          p_tenant_id: tenantId,
          p_plano: plano,
          p_valor_original: cupomAplicado.valor_original,
          p_valor_desconto: cupomAplicado.valor_desconto,
          p_valor_final: valorReais,
          p_asaas_payment_id: null,
          p_asaas_subscription_id: subscriptionData.id,
        });
      } catch (errRegCupom) {
        console.warn('Aviso ao registrar uso de cupom via RPC:', errRegCupom);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        subscriptionId: subscriptionData.id,
        paymentUrl,
        status: subscriptionData.status,
        pix: pixData,
        cupomAplicado: cupomAplicado ? {
          codigo: cupomAplicado.codigo,
          desconto_valor: cupomAplicado.desconto_valor,
          desconto_tipo: cupomAplicado.desconto_tipo,
          valor_final: valorReais,
        } : null,
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
