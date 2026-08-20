import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oamwsqlszahyjkaksouh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXdzcWxzemFoeWprYWtzb3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjI5MzcsImV4cCI6MjEwMTAzODkzN30.BXvF0yXsJ1nZAfpepN-slnlu0ClvodmLUyjaRAlVm_k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runConference() {
  console.log('=====================================================');
  console.log(' CONFERÊNCIA RIGOROSA DAS TABELAS E ARQUIVOS');
  console.log('=====================================================\n');

  // 1. Verificar checkins com JSON no assinatura_path (começando com '{')
  const { data: checkinsJson, error: errJson } = await supabase
    .from('checkins')
    .select('id, agendamento_id, assinatura_path, assinatura_nome, created_at')
    .like('assinatura_path', '{%');

  if (errJson) console.error('Erro ao buscar checkins json:', errJson);
  console.log(`1. Checkins com JSON em assinatura_path: ${checkinsJson?.length || 0}`);
  checkinsJson?.forEach((c) => {
    console.log(`   - Checkin ID: ${c.id}`);
    console.log(`     Assinatura Path: ${c.assinatura_path}`);
  });

  // 2. Verificar checkins com base64 em assinatura_path (começando com 'data:')
  const { data: checkinsData, error: errData } = await supabase
    .from('checkins')
    .select('id, agendamento_id, assinatura_path, assinatura_nome, created_at')
    .like('assinatura_path', 'data:%');

  if (errData) console.error('Erro ao buscar checkins data:', errData);
  console.log(`\n2. Checkins com base64 (data:) em assinatura_path: ${checkinsData?.length || 0}`);
  checkinsData?.forEach((c) => {
    console.log(`   - Checkin ID: ${c.id}`);
    console.log(`     Assinatura Path (primeiros 40 chars): ${c.assinatura_path.substring(0, 40)}...`);
  });

  // 3. Total de checkins e checkins normais (caminho relativo)
  const { count: totalCheckins } = await supabase.from('checkins').select('*', { count: 'exact', head: true });
  console.log(`\n3. Total de vistorias (checkins): ${totalCheckins}`);

  const { data: checkinsOk } = await supabase
    .from('checkins')
    .select('id, assinatura_path')
    .not('assinatura_path', 'is', null)
    .not('assinatura_path', 'like', '{%')
    .not('assinatura_path', 'like', 'data:%');
  console.log(`   - Checkins com caminho de arquivo normal: ${checkinsOk?.length || 0}`);
  checkinsOk?.forEach((c) => console.log(`     ID: ${c.id} | Path: ${c.assinatura_path}`));

  // 4. Verificar checkin_fotos e execucao_fotos
  const { data: fotosCheckin, count: totalCheckinFotos, error: errFotos } = await supabase
    .from('checkin_fotos')
    .select('*', { count: 'exact' });

  if (errFotos) console.error('Erro ao consultar checkin_fotos:', errFotos);
  console.log(`\n4. Total de linhas na tabela checkin_fotos: ${totalCheckinFotos}`);
  fotosCheckin?.forEach((f) => console.log(`   - Foto ID: ${f.id} | Checkin: ${f.checkin_id} | Path: ${f.path}`));

  const { count: totalExecFotos } = await supabase.from('execucao_fotos').select('*', { count: 'exact', head: true });
  console.log(`   Total de linhas na tabela execucao_fotos: ${totalExecFotos}`);

  // 5. Investigar Storage bucket 'evidencias'
  console.log(`\n5. INVESTIGAÇÃO DO BUCKET 'evidencias' (STORAGE):`);
  const { data: rootFolders, error: errStorage } = await supabase.storage.from('evidencias').list('');
  if (errStorage) {
    console.error('Erro ao listar bucket evidencias:', errStorage);
  } else {
    console.log('   Pastas na raiz do bucket evidencias:', rootFolders?.map((f) => f.name));

    if (rootFolders) {
      for (const tenantFolder of rootFolders) {
        const { data: tenantSub } = await supabase.storage.from('evidencias').list(tenantFolder.name);
        console.log(`   - Tenant '${tenantFolder.name}':`, tenantSub?.map((f) => f.name));

        if (tenantSub) {
          for (const sub of tenantSub) {
            const path1 = `${tenantFolder.name}/${sub.name}`;
            const { data: checkinFolders } = await supabase.storage.from('evidencias').list(path1);
            console.log(`     -> Pasta '${path1}':`, checkinFolders?.map((f) => f.name));

            if (checkinFolders) {
              for (const chkFolder of checkinFolders) {
                const path2 = `${path1}/${chkFolder.name}`;
                const { data: files } = await supabase.storage.from('evidencias').list(path2);
                console.log(`        --> Arquivos em '${path2}':`, files?.map((f) => `${f.name} (${f.metadata?.size || 'unknown'} bytes)`));
              }
            }
          }
        }
      }
    }
  }

  console.log('\n=====================================================');
}

runConference();
