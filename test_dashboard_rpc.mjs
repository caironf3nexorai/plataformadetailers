import { createClient } from '@supabase/supabase-js';

const url = 'https://oamwsqlszahyjkaksouh.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(url, key);

async function testRPC() {
  console.log('--- Testando RPC dashboard_dono() sem autenticação ---');
  const t0 = performance.now();
  const { data, error } = await supabase.rpc('dashboard_dono');
  const t1 = performance.now();
  
  console.log(`Tempo da RPC dashboard_dono(): ${(t1 - t0).toFixed(2)} ms`);
  if (error) {
    console.log('Resultado (esperado erro de auth):', error.message);
  } else {
    console.log('Retorno:', JSON.stringify(data, null, 2));
  }

  console.log('\n--- Testando RPC salvar_tenant_meta() sem autenticação ---');
  const { data: d2, error: e2 } = await supabase.rpc('salvar_tenant_meta', {
    p_mes: '2026-08-01',
    p_tipo: 'faturamento',
    p_valor: 50000
  });
  if (e2) {
    console.log('Resultado salvar_tenant_meta (esperado erro):', e2.message);
  } else {
    console.log('Retorno:', d2);
  }
}

testRPC().catch(console.error);
