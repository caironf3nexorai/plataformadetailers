import { createClient } from '@supabase/supabase-js';

const url = 'https://oamwsqlszahyjkaksouh.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(url, key);

async function run() {
  console.log('--- Conferindo checkin_fotos e execucao_fotos ---');
  
  const { data: checkinFotos, error: err1 } = await supabase.from('checkin_fotos').select('id, expirado_em').limit(5);
  console.log('checkin_fotos sample:', checkinFotos, 'err:', err1);

  const { data: execFotos, error: err2 } = await supabase.from('execucao_fotos').select('id, expirado_em').limit(5);
  console.log('execucao_fotos sample:', execFotos, 'err:', err2);

  const { data: planLimits, error: err3 } = await supabase.from('plan_limits').select('*');
  console.log('plan_limits:', planLimits, 'err:', err3);
}

run().catch(console.error);
