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

    // 2. Validar autorização e obter tenant do usuário (apenas dono ou gerente ativo)
    const body = await req.json().catch(() => ({}));
    const rawRequestedTenant = typeof body?.tenant_id === 'string' ? body.tenant_id.trim() : '';
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (rawRequestedTenant && !uuidRegex.test(rawRequestedTenant)) {
      return new Response(JSON.stringify({ error: 'tenant_id inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let memberQuery = supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('status', 'ativo')
      .in('role', ['dono', 'gerente']);

    if (rawRequestedTenant) {
      memberQuery = memberQuery.eq('tenant_id', rawRequestedTenant);
    } else {
      memberQuery = memberQuery.order('created_at', { ascending: true });
    }

    const { data: member, error: memberError } = await memberQuery
      .limit(1)
      .maybeSingle();

    if (memberError || !member?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Acesso negado: apenas proprietário ou gerente ativo pode configurar dados fiscais desta oficina.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tenantId = member.tenant_id;

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

    const { data: existingConfig, error: existingErr } = await supabase
      .from('tenant_config_fiscal')
      .select('id, certificado_status, certificado_valido_ate, certificado_nome_arquivo, certificado_enviado_em')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (existingErr) {
      throw existingErr;
    }

    let certStatus = existingConfig?.certificado_status || 'pendente';
    let certValidoAte: string | null = existingConfig?.certificado_valido_ate || null;
    const hasNewCert = Boolean(certificado_base64 && senha_certificado);

    // 3. Se enviou novo certificado digital A1, transmite via API para a Focus NFe
    if (hasNewCert) {
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

    // 4. Salvar configurações no Supabase preservando token_focus_nfe e metadados existentes
    const nowIso = new Date().toISOString();
    const parsedAliquota = Number.parseFloat(String(aliquota_iss ?? '').replace(',', '.'));
    const aliquotaFinal = Number.isFinite(parsedAliquota) && parsedAliquota >= 0 ? parsedAliquota : 2.0;
    const cleanCnae = String(cnae_padrao || '4520-0/05').trim() || '4520-0/05';

    const upsertPayload: Record<string, any> = {
      tenant_id: tenantId,
      cnpj: cleanCnpj,
      razao_social: String(razao_social || '').trim(),
      nome_fantasia: String(nome_fantasia || razao_social || '').trim(),
      inscricao_municipal: String(inscricao_municipal || '').trim(),
      cnae: cleanCnae,
      cnae_padrao: cleanCnae,
      item_lista_servico: String(item_lista_servico || '14.01').trim() || '14.01',
      aliquota_iss: aliquotaFinal,
      regime_tributario: String(regime_tributario || '1'),
      ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
      updated_at: nowIso,
    };

    if (hasNewCert) {
      upsertPayload.certificado_status = certStatus;
      upsertPayload.certificado_valido_ate = certValidoAte || existingConfig?.certificado_valido_ate || null;
      upsertPayload.certificado_nome_arquivo = certificado_nome_arquivo || existingConfig?.certificado_nome_arquivo || 'certificado.pfx';
      upsertPayload.certificado_enviado_em = certStatus === 'ativo'
        ? nowIso
        : (existingConfig?.certificado_enviado_em || null);
    } else if (!existingConfig) {
      upsertPayload.certificado_status = 'pendente';
    }

    const { error: dbError } = await supabase
      .from('tenant_config_fiscal')
      .upsert(upsertPayload, { onConflict: 'tenant_id' });

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
