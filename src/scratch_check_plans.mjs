import { createClient } from '@supabase/supabase-js';

const url = 'https://oamwsqlszahyjkaksouh.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(url, key);

async function check() {
  const { data: limits } = await supabase.from('plan_limits').select('*');
  console.log('=== QUERY 1: plan_limits count:', limits?.length);
  console.log(limits);

  const { data: cat } = await supabase.from('feature_catalogo').select('*');
  console.log('=== QUERY 2: feature_catalogo count:', cat?.length);
  console.log(cat?.map(c => c.chave));

  const { data: feat } = await supabase.from('plan_features').select('*');
  console.log('=== QUERY 3: plan_features count:', feat?.length);
  console.log(feat?.filter(f => !f.habilitado));
}

check().catch(console.error);
