import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oamwsqlszahyjkaksouh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkAndNormalizeAssinaturas() {
  console.log('--- ETAPA 1: VERIFICAÇÃO DE ASSINATURAS EM CHECKINS ---');

  // Buscar linhas afetadas
  const { data, error } = await supabase
    .from('checkins')
    .select('id, assinatura_path, created_at')
    .like('assinatura_path', '{%');

  if (error) {
    console.error('Erro ao consultar checkins:', error);
    return;
  }

  const afeta = data?.filter((c) => {
    try {
      const parsed = JSON.parse(c.assinatura_path);
      return parsed && typeof parsed === 'object' && 'path' in parsed;
    } catch {
      return false;
    }
  });

  console.log(`Total de linhas encontradas com JSON em assinatura_path: ${afeta?.length || 0}`);
  afeta?.forEach((item) => {
    console.log(` - Checkin ID: ${item.id} | Conteúdo atual: ${item.assinatura_path}`);
  });
}

checkAndNormalizeAssinaturas();
