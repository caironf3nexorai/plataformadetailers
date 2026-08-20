import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oamwsqlszahyjkaksouh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runConference() {
  console.log('=== CONFERÊNCIA DE COLUNAS DA BASE DE DADOS ===');

  // Inspect execucoes
  const { data: execSample, error: errExec } = await supabase.from('execucoes').select('*').limit(1);
  console.log('\n--- execucoes colunas ---');
  if (execSample && execSample.length > 0) {
    console.log(Object.keys(execSample[0]));
  } else {
    console.log('Sem dados em execucoes ou erro:', errExec?.message);
  }

  // Inspect agendamentos
  const { data: agendSample, error: errAgend } = await supabase.from('agendamentos').select('*').limit(1);
  console.log('\n--- agendamentos colunas ---');
  if (agendSample && agendSample.length > 0) {
    console.log(Object.keys(agendSample[0]));
  } else {
    console.log('Sem dados em agendamentos ou erro:', errAgend?.message);
  }

  // Inspect despesas_fixas
  const { data: despSample, error: errDesp } = await supabase.from('despesas_fixas').select('*').limit(1);
  console.log('\n--- despesas_fixas colunas ---');
  if (despSample && despSample.length > 0) {
    console.log(Object.keys(despSample[0]));
  } else {
    console.log('Sem dados em despesas_fixas ou erro:', errDesp?.message);
  }

  // Let's check tables list if available or query RPCs
  console.log('\n--- Fim da Conferencia ---');
}

runConference();
