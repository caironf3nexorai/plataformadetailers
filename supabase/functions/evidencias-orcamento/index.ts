import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const tokenPublico = (body.token_publico || '').toString().trim();

    if (!tokenPublico) {
      return new Response(
        JSON.stringify({ error: 'Token do orçamento não fornecido.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes.');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: orcamento, error: orcErr } = await supabase
      .from('orcamentos')
      .select('id, tenant_id, incluir_fotos, status')
      .eq('token_publico', tokenPublico)
      .maybeSingle();

    if (orcErr || !orcamento) {
      return new Response(
        JSON.stringify({ error: 'Orçamento não encontrado ou token inválido.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Só libera URLs assinadas das fotos quando a opção incluir_fotos estiver marcada
    if (!orcamento.incluir_fotos) {
      return new Response(
        JSON.stringify({ sucesso: true, incluir_fotos: false, fotos: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let fotosDb: Array<{ id: string; path: string; descricao?: string | null; created_at?: string | null }> = [];
    const { data: rows, error: fotosErr } = await supabase
      .from('orcamento_fotos')
      .select('id, path, descricao, created_at')
      .eq('orcamento_id', orcamento.id)
      .order('created_at', { ascending: true });

    if (fotosErr) {
      throw new Error(`Erro ao consultar fotos do orçamento: ${fotosErr.message}`);
    }

    if (rows && rows.length > 0) {
      fotosDb = rows;
    } else {
      // Fallback caso fotos tenham sido salvas diretamente no bucket evidencias
      const folder = `${orcamento.tenant_id}/orcamentos/${orcamento.id}`;
      const { data: storageFiles } = await supabase.storage.from('evidencias').list(folder);
      if (storageFiles && storageFiles.length > 0) {
        fotosDb = storageFiles
          .filter((f) => f.name && !f.name.startsWith('assinatura') && !f.name.startsWith('.'))
          .map((f) => ({
            id: f.id || f.name,
            path: `${folder}/${f.name}`,
            descricao: null,
            created_at: f.created_at || null,
          }));
      }
    }

    const fotosComSignedUrl = [];
    for (const f of fotosDb) {
      if (!f.path) continue;
      const { data: signedData } = await supabase.storage
        .from('evidencias')
        .createSignedUrl(f.path, 1800);

      if (signedData?.signedUrl) {
        const tipo = f.descricao && f.descricao.includes('[DEPOIS]') ? 'depois' : 'antes';
        fotosComSignedUrl.push({
          id: f.id,
          foto_url: signedData.signedUrl,
          tipo,
          descricao: f.descricao || null,
          created_at: f.created_at || null,
        });
      }
    }

    return new Response(
      JSON.stringify({
        sucesso: true,
        incluir_fotos: true,
        fotos: fotosComSignedUrl,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[evidencias-orcamento Error]:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Erro interno ao processar fotos do orçamento.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

