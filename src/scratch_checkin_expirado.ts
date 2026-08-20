import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oamwsqlszahyjkaksouh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkExpiradoEm() {
  const { data, error } = await supabase
    .from('checkins')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Erro:', error);
    return;
  }

  if (data && data.length > 0) {
    console.log('Colunas de checkins:', Object.keys(data[0]));
    console.log('Possui expirado_em?', 'expirado_em' in data[0]);
  } else {
    console.log('Sem dados para checar colunas.');
  }
}

checkExpiradoEm();
