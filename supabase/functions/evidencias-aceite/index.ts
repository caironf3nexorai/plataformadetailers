import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Trata requisições de preflight CORS (OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Extração e validação do token do corpo da requisição
    const body = await req.json().catch(() => ({}));
    const tokenAceite = (body.token_aceite || '').toString().trim();

    if (!tokenAceite) {
      return new Response(
        JSON.stringify({ error: 'Token de vistoria não fornecido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes.');
    }

    // Instancia o cliente com Service Role para bypass seguro de RLS em leitura isolada
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 2. Busca o registro do checkin pelo token público de aceite
    const { data: checkin, error: checkinErr } = await supabase
      .from('checkins')
      .select('id, tenant_id, enviado_em, expirado_em, finalizado, assinado_em, assinatura_path, assinatura_nome')
      .eq('token_aceite', tokenAceite)
      .maybeSingle();

    if (checkinErr || !checkin) {
      return new Response(
        JSON.stringify({ error: 'Vistoria não encontrada ou token inválido.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Validação: enviado_em deve estar preenchido
    if (!checkin.enviado_em) {
      return new Response(
        JSON.stringify({ error: 'Esta vistoria ainda não foi enviada para aceite remoto.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Validação de expiração do link (checkins.expirado_em)
    if (checkin.expirado_em && new Date(checkin.expirado_em) < new Date()) {
      return new Response(
        JSON.stringify({
          error: 'Este link de vistoria expirou. Entre em contato com a oficina para receber um novo link.',
          expirado: true,
        }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Busca as fotos registradas para este checkin_id
    const { data: fotos, error: fotosErr } = await supabase
      .from('checkin_fotos')
      .select('id, path, descricao, created_at')
      .eq('checkin_id', checkin.id)
      .order('created_at', { ascending: true });

    if (fotosErr) {
      throw new Error(`Erro ao consultar fotos da vistoria: ${fotosErr.message}`);
    }

    // 6. Gera Signed URLs de curta duração (30 minutos / 1800 segundos) para cada foto
    const fotosComSignedUrl = [];
    if (fotos && fotos.length > 0) {
      for (const f of fotos) {
        if (!f.path) continue;
        const { data: signedData } = await supabase.storage
          .from('evidencias')
          .createSignedUrl(f.path, 1800);

        if (signedData?.signedUrl) {
          fotosComSignedUrl.push({
            foto_url: signedData.signedUrl,
            descricao: f.descricao,
            created_at: f.created_at,
          });
        }
      }
    }

    // 7. Processa a URL da assinatura se a vistoria já estiver finalizada
    let signedAssinaturaUrl = null;
    if (checkin.finalizado && checkin.assinatura_path) {
      if (checkin.assinatura_path.startsWith('data:')) {
        signedAssinaturaUrl = checkin.assinatura_path;
      } else {
        const { data: assSigned } = await supabase.storage
          .from('evidencias')
          .createSignedUrl(checkin.assinatura_path, 1800);

        if (assSigned?.signedUrl) {
          signedAssinaturaUrl = assSigned.signedUrl;
        }
      }
    }

    // 8. Resposta segura contendo apenas dados pertencentes a esta vistoria
    return new Response(
      JSON.stringify({
        sucesso: true,
        finalizado: checkin.finalizado,
        assinado_em: checkin.assinado_em,
        assinante_nome: checkin.assinatura_nome,
        assinatura_url: signedAssinaturaUrl,
        fotos: fotosComSignedUrl,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[evidencias-aceite Error]:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Erro interno ao processar evidências.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
