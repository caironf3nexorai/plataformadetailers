import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FOCUS_NFE_TOKEN = Deno.env.get('FOCUS_NFE_TOKEN') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Autenticação via Bearer Token
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
      return new Response(JSON.stringify({ error: 'Sessão inválida ou expirada' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Obter tenant do usuário
    const { data: member, error: memberError } = await supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (memberError || !member?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Oficina não encontrada para este usuário' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tenantId = member.tenant_id;
    const body = await req.json();

    const {
      cnpj,
      razao_social,
      nome_fantasia,
      inscricao_municipal,
      cnae_padrao,
      item_lista_servico,
      aliquota_iss,
      regime_tributario,
      ambiente,
      certificado_base64,
      senha_certificado,
      certificado_nome_arquivo
    } = body;

    const cleanCnpj = (cnpj || '').replace(/\D/g, '');
    if (cleanCnpj.length !== 14) {
      return new Response(JSON.stringify({ error: 'CNPJ inválido (deve conter 14 dígitos)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let certStatus = 'pendente';
    let certValidoAte: string | null = null;

    // 3. Se enviou novo certificado digital A1, transmite via API para a Focus NFe
    if (certificado_base64 && senha_certificado) {
      if (!FOCUS_NFE_TOKEN) {
        console.warn('[sincronizar-empresa-fiscal] FOCUS_NFE_TOKEN não configurado nas variáveis do ambiente.');
      } else {
        const baseUrl = ambiente === 'producao'
          ? 'https://api.focusnfe.com.br/v2'
          : 'https://homologacao.focusnfe.com.br/v2';

        const basicAuth = btoa(`${FOCUS_NFE_TOKEN}:`);

        const focusPayload = {
          nome: razao_social,
          nome_fantasia: nome_fantasia || razao_social,
          cnpj: cleanCnpj,
          inscricao_municipal: inscricao_municipal,
          regime_tributario: parseInt(regime_tributario || '1', 10),
          arquivo_certificado_base64: certificado_base64,
          senha_certificado: senha_certificado,
          habilita_nfse: true
        };

        // Envia para Focus NFe (cadastra ou atualiza)
        const focusRes = await fetch(`${baseUrl}/empresas`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(focusPayload)
        });

        const focusData = await focusRes.json().catch(() => ({}));

        if (!focusRes.ok) {
          // Se já existir, tenta atualizar via PUT /v2/empresas/{cnpj}
          if (focusRes.status === 422 || focusRes.status === 409 || focusData.codigo === 'empresa_ja_cadastrada') {
            const updateRes = await fetch(`${baseUrl}/empresas/${cleanCnpj}`, {
              method: 'PUT',
              headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(focusPayload)
            });

            const updateData = await updateRes.json().catch(() => ({}));
            if (!updateRes.ok) {
              const msgErro = updateData.mensagem || updateData.erros?.[0]?.mensagem || 'Erro ao atualizar certificado na emissora fiscal';
              return new Response(JSON.stringify({ error: msgErro }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
            certStatus = 'ativo';
            certValidoAte = updateData.certificado_valido_ate || updateData.data_validade_certificado || null;
          } else {
            const msgErro = focusData.mensagem || focusData.erros?.[0]?.mensagem || 'Falha ao validar certificado digital. Verifique a senha informada.';
            return new Response(JSON.stringify({ error: msgErro }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          certStatus = 'ativo';
          certValidoAte = focusData.certificado_valido_ate || focusData.data_validade_certificado || null;
        }
      }
    }

    // 4. Salvar configurações no Supabase
    const dbPayload: any = {
      cnpj: cleanCnpj,
      razao_social: razao_social,
      nome_fantasia: nome_fantasia || razao_social,
      inscricao_municipal: inscricao_municipal || '',
      cnae_padrao: cnae_padrao || '4520-0/05',
      item_lista_servico: item_lista_servico || '14.01',
      aliquota_iss: parseFloat(aliquota_iss) || 2.0,
      regime_tributario: regime_tributario || '1',
      ambiente: ambiente || 'homologacao',
    };

    if (certificado_base64 && senha_certificado) {
      dbPayload.certificado_status = certStatus;
      dbPayload.certificado_valido_ate = certValidoAte;
      dbPayload.certificado_nome_arquivo = certificado_nome_arquivo || 'certificado.pfx';
    }

    const { error: dbError } = await supabase.rpc('salvar_config_fiscal_tenant', {
      p_config: dbPayload
    });

    if (dbError) {
      throw dbError;
    }

    return new Response(JSON.stringify({
      sucesso: true,
      mensagem: 'Dados fiscais e certificado digital salvos e sincronizados com sucesso!',
      certificado_status: certStatus,
      certificado_valido_ate: certValidoAte
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[sincronizar-empresa-fiscal] Erro:', err);
    return new Response(JSON.stringify({ error: err.message || 'Erro interno ao sincronizar dados fiscais' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
