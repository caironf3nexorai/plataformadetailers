import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Proteção de Segurança: Validação de Secret no cabeçalho HTTP Authorization / x-cron-secret
    const cronSecret = Deno.env.get('CRON_SECRET');
    const authHeader = req.headers.get('Authorization') || '';
    const cronHeader = req.headers.get('x-cron-secret') || '';

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (cronSecret && token !== cronSecret && cronHeader !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Acesso negado: Secret do CRON inválido ou ausente.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 2. Busca em lote (máx 500) das fotos de execução vencidas
    // JOIN explícito com execucoes para recuperar tenant_id
    const { data: fotosVencidas, error: fetchErr } = await supabase
      .from('execucao_fotos')
      .select('id, path, execucao_id, tentativas_expurgo, execucoes!inner(tenant_id)')
      .lt('expirado_em', new Date().toISOString())
      .eq('preservada', false)
      .lt('tentativas_expurgo', 5)
      .limit(500);

    if (fetchErr) {
      throw new Error(`Erro ao buscar fotos vencidas: ${fetchErr.message}`);
    }

    if (!fotosVencidas || fotosVencidas.length === 0) {
      return new Response(JSON.stringify({ message: 'Nenhuma foto vencida pendente de expurgo.', totalProcessado: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Agrupa o expurgo por tenant para consolidar o log
    const tenantSummary: Record<
      string,
      { quantidade: number; bytesLiberados: number; erros: Array<{ path: string; mensagem: string }> }
    > = {};

    for (const foto of fotosVencidas) {
      const tenantId = (foto.execucoes as any)?.tenant_id;
      if (!tenantId) continue;

      if (!tenantSummary[tenantId]) {
        tenantSummary[tenantId] = { quantidade: 0, bytesLiberados: 0, erros: [] };
      }

      // A. Leitura prévia do tamanho em bytes no storage.objects antes da exclusão
      let fileSize = 0;
      const pathParts = foto.path.split('/');
      const filename = pathParts.pop() || '';
      const folderPath = pathParts.join('/');

      const { data: objects } = await supabase.storage
        .from('evidencias')
        .list(folderPath, { search: filename });

      if (objects && objects.length > 0) {
        const found = objects.find((o) => o.name === filename);
        if (found && found.metadata && typeof found.metadata.size === 'number') {
          fileSize = found.metadata.size;
        }
      }

      // B. Exclusão no Storage
      const { error: removeErr } = await supabase.storage.from('evidencias').remove([foto.path]);

      const isNotFound = removeErr && (
        removeErr.message?.toLowerCase().includes('not found') ||
        removeErr.message?.includes('404') ||
        (removeErr as any).status === 404
      );

      // C. Trata 404/Arquivo inexistente como SUCESSO
      if (!removeErr || isNotFound) {
        // Exclui a linha do banco de dados
        const { error: deleteRowErr } = await supabase
          .from('execucao_fotos')
          .delete()
          .eq('id', foto.id);

        if (deleteRowErr) {
          console.error(`[Expurgo] Erro ao deletar linha ${foto.id}:`, deleteRowErr);
          tenantSummary[tenantId].erros.push({
            path: foto.path,
            mensagem: `Erro no banco: ${deleteRowErr.message}`,
          });

          await supabase
            .from('execucao_fotos')
            .update({ tentativas_expurgo: (foto.tentativas_expurgo || 0) + 1 })
            .eq('id', foto.id);
        } else {
          tenantSummary[tenantId].quantidade += 1;
          tenantSummary[tenantId].bytesLiberados += fileSize;
        }
      } else {
        // Falha real de remoção no storage -> NÃO apaga a linha e incrementa tentativas_expurgo
        console.error(`[Expurgo] Falha no storage para ${foto.path}:`, removeErr);
        tenantSummary[tenantId].erros.push({
          path: foto.path,
          mensagem: removeErr.message || 'Erro desconhecido no storage',
        });

        await supabase
          .from('execucao_fotos')
          .update({ tentativas_expurgo: (foto.tentativas_expurgo || 0) + 1 })
          .eq('id', foto.id);
      }
    }

    // D. Gravação de registros auditáveis em expurgo_log
    for (const [tenantId, summary] of Object.entries(tenantSummary)) {
      if (summary.quantidade > 0 || summary.erros.length > 0) {
        await supabase.from('expurgo_log').insert({
          tenant_id: tenantId,
          quantidade: summary.quantidade,
          bytes_liberados: summary.bytesLiberados,
          erros: summary.erros,
          executado_em: new Date().toISOString(),
        });
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Expurgo executado com sucesso.',
        totalItensProcessados: fotosVencidas.length,
        resumoTenants: tenantSummary,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[Expurgo Edge Function Error]:', err);
    return new Response(JSON.stringify({ error: err.message || 'Erro interno na Edge Function de expurgo.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
