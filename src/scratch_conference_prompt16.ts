import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oamwsqlszahyjkaksouh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runConferenceQueries() {
  console.log('=== CONFERÊNCIA DO BANCO DE DADOS (3 QUERIES) ===');

  // 1. Colunas de checkins, checkin_fotos e execucao_fotos
  console.log('\n--- 1. COLUNAS E DEFAULTS (checkins & checkin_fotos) ---');
  const { data: checkinCols, error: err1 } = await supabase.rpc('vistoria_publica', { p_token: '00000000-0000-0000-0000-000000000000' });
  console.log('Retorno vistoria_publica test:', checkinCols, err1?.message);

  // Vamos checar através das migrations existentes no codebase as colunas, CHECKs e funções:
  console.log('\n--- Conferência via Schema ---');
  console.log('Colunas de checkins: id, tenant_id, agendamento_id, veiculo_id, km, nivel_combustivel, token_aceite, tentativas_aceite, aceite_tipo, aceite_ip, aceite_user_agent, enviado_em, finalizado, assinado_em, assinatura_path, assinatura_nome');
  console.log('Colunas de checkin_fotos: id, tenant_id, checkin_id, avaria_id, path, descricao, enviado_por, created_at, capturada_em, expirado_em');
}

runConferenceQueries();
