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

    // Obter tenant_id do membro
    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .eq('status', 'ativo')
      .in('role', ['dono', 'gerente'])
      .single();

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

    if (!ass) {
      return new Response(JSON.stringify({ error: 'Nenhuma assinatura encontrada para cancelar' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // AJUSTE 1: Cancelar no Asaas PRIMEIRO antes de marcar localmente
    if (ass.asaas_subscription_id) {
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
    }

    // Atualizar registro local para cancelada
    await supabase
      .from('assinaturas')
      .update({
        status: 'cancelada',
        cancelada_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    // Auditar cancelamento
    await supabase.from('admin_auditoria').insert({
      admin_user_id: user.id,
      acao: 'assinatura_cancelada_pelo_usuario',
      entidade: 'assinaturas',
      entidade_id: ass.id,
      valor_anterior: { status: ass.status, plano: ass.plano },
      valor_novo: { status: 'cancelada' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Assinatura cancelada com sucesso no Asaas e no sistema',
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
