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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    // Obter tenant_id opcional no corpo (para usuários com múltiplas oficinas)
    let tenantIdBody: string | null = null;
    try {
      const bodyText = await req.text();
      if (bodyText) {
        const parsed = JSON.parse(bodyText);
        if (parsed?.tenant_id) tenantIdBody = String(parsed.tenant_id);
      }
    } catch {
      // corpo vazio opcional
    }

    // Obter tenant_id do membro
    let memberQuery = supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('status', 'ativo')
      .in('role', ['dono', 'gerente']);

    if (tenantIdBody) {
      memberQuery = memberQuery.eq('tenant_id', tenantIdBody);
    }

    const { data: member } = await memberQuery
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Apenas Donos ou Gerentes podem cancelar assinaturas' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tenantId = member.tenant_id;

    // Buscar assinatura atual
    const { data: ass } = await supabase
      .from('assinaturas')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (!ass || !ass.asaas_subscription_id) {
      return new Response(
        JSON.stringify({
          error:
            ass?.status === 'cortesia' || ass?.is_cortesia
              ? 'Esta oficina utiliza uma cortesia administrativa sem cobrança recorrente no Asaas.'
              : ass?.status === 'trial'
                ? 'Esta oficina está em período de degustação gratuita e não possui cobrança ativa para cancelar.'
                : 'Nenhuma assinatura recorrente ativa no Asaas foi encontrada para cancelar.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // AJUSTE 1: Cancelar no Asaas PRIMEIRO antes de marcar localmente
    const resAsaas = await fetch(`${ASAAS_API_URL}/subscriptions/${ass.asaas_subscription_id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_API_KEY,
      },
    });

    const dataAsaas = await resAsaas.json();
    if (!resAsaas.ok && resAsaas.status !== 404) {
      throw new Error(`Erro ao cancelar assinatura no Asaas: ${JSON.stringify(dataAsaas)}`);
    }

    // Atualizar registro local
    const isAnual = ass.ciclo === 'anual';
    const hoje = getHojeSaoPauloIso();
    const temVigenciaFutura = Boolean(ass.proximo_vencimento && ass.proximo_vencimento >= hoje);
    const novoStatus = (isAnual && temVigenciaFutura) ? 'ativa' : 'cancelada';

    await supabase
      .from('assinaturas')
      .update(
        temVigenciaFutura
          ? {
              status: novoStatus,
              plano_pendente: null,
              asaas_subscription_id: null,
              cancelada_em: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          : {
              status: 'cancelada',
              plano: 'free',
              plano_pendente: null,
              valor_centavos: 0,
              is_cortesia: false,
              cortesia_ate: null,
              asaas_subscription_id: null,
              cancelada_em: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
      )
      .eq('tenant_id', tenantId);

    if (!temVigenciaFutura) {
      await supabase
        .from('tenants')
        .update({
          plano: 'free',
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenantId);
    }

    // Auditar cancelamento
    await supabase.from('admin_auditoria').insert({
      admin_user_id: user.id,
      acao: 'assinatura_cancelada_pelo_usuario',
      entidade: 'assinaturas',
      entidade_id: ass.id,
      valor_anterior: { status: ass.status, plano: ass.plano, ciclo: ass.ciclo },
      valor_novo: { status: novoStatus, cancelada_em: new Date().toISOString() },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: isAnual && temVigenciaFutura
          ? 'Renovação anual cancelada com sucesso. Seu acesso continuará ativo até o término do período contratado.'
          : 'Assinatura cancelada com sucesso no Asaas e no sistema',
        status: novoStatus,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Erro ao cancelar assinatura' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
