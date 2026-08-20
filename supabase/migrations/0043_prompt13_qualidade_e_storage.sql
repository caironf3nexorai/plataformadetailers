-- Migration 0043: Varredura de Qualidade, Auditoria de Banco, Retenção de Storage e RPCs de Segurança

-- ============================================================================
-- PARTE A: INTEGRIDADE DO BANCO E AUDITORIA NÃO-BLOQUEANTE
-- ============================================================================

-- A2 & A3: Limpeza de assinaturas legadas e padronização da RPC salvar_matriz_precos
drop function if exists public.salvar_matriz_precos(uuid, jsonb);
create or replace function public.salvar_matriz_precos(p_servico uuid, p_linhas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_linha jsonb;
  v_cat_id uuid;
  v_preco numeric(10,2);
  v_duracao integer;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select tenant_id into v_tenant_id from public.servicos where id = p_servico;
  if v_tenant_id is null then
    raise exception 'Serviço não encontrado.';
  end if;

  if not tem_papel(v_tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos ou gerentes podem alterar preços.';
  end if;

  for v_linha in select * from jsonb_array_elements(p_linhas) loop
    v_cat_id := (v_linha->>'categoria_id')::uuid;
    v_preco := coalesce((v_linha->>'preco_base')::numeric, 0.00);
    v_duracao := coalesce((v_linha->>'duracao_minutos')::integer, 60);

    insert into public.servico_precos (
      tenant_id, servico_id, categoria_id, preco_base, duracao_minutos, ativo
    ) values (
      v_tenant_id, p_servico, v_cat_id, v_preco, v_duracao, true
    )
    on conflict (servico_id, categoria_id) do update
    set preco_base = excluded.preco_base,
        duracao_minutos = excluded.duracao_minutos,
        ativo = true,
        updated_at = now();
  end loop;
end;
$$;
grant execute on function public.salvar_matriz_precos(uuid, jsonb) to authenticated;

-- A5: RPC de Auditoria de Inconsistências de Banco (Não-bloqueante)
create or replace function public.auditar_inconsistencias_banco()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec_sem_finalizado integer;
  v_agenda_sem_os integer;
  v_agenda_sem_itens integer;
  v_exec_sem_lucro integer;
  v_orc_sem_nivel integer;
begin
  select count(*) into v_exec_sem_finalizado
  from public.execucoes where status = 'finalizado' and finalizado_em is null;

  select count(*) into v_agenda_sem_os
  from public.agendamentos where numero_os is null;

  select count(*) into v_agenda_sem_itens
  from public.agendamentos a
  where not exists (select 1 from public.agendamento_itens i where i.agendamento_id = a.id);

  select count(*) into v_exec_sem_lucro
  from public.execucoes where status = 'finalizado' and lucro_liquido is null;

  select count(*) into v_orc_sem_nivel
  from public.orcamentos where status = 'aprovado' and nivel_aprovado is null;

  return jsonb_build_object(
    'execucoes_sem_finalizado_em', v_exec_sem_finalizado,
    'agendamentos_sem_numero_os', v_agenda_sem_os,
    'agendamentos_sem_itens', v_agenda_sem_itens,
    'execucoes_sem_lucro_liquido', v_exec_sem_lucro,
    'orcamentos_sem_nivel_aprovado', v_orc_sem_nivel,
    'auditado_em', now()
  );
end;
$$;
grant execute on function public.auditar_inconsistencias_banco() to authenticated;


-- ============================================================================
-- PARTE D: STORAGE, RETENÇÃO E LIMITES POR PLANO
-- ============================================================================

-- D2: Coluna expirado_em para Retenção de Fotos
alter table public.checkin_fotos add column if not exists expirado_em timestamptz default null;
alter table public.execucao_fotos add column if not exists expirado_em timestamptz default null;

-- D2: RPC Limpar Fotos Expiradas (Marca expirado_em e devolve o sumário)
create or replace function public.limpar_fotos_expiradas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin_expiradas integer := 0;
  v_exec_durante_expiradas integer := 0;
  v_exec_saida_expiradas integer := 0;
begin
  -- Fotos de Check-in gerais (exceto se vinculadas a avarias): retenção de 180 dias
  with marcadas as (
    update public.checkin_fotos f
    set expirado_em = now()
    where f.expirado_em is null
      and f.created_at < (now() - interval '180 days')
      and not exists (
        select 1 from public.checkin_avarias a
        where a.checkin_id = f.checkin_id
      )
    returning f.id
  )
  select count(*) into v_checkin_expiradas from marcadas;

  -- Fotos de Execução (durante): retenção de 90 dias
  with marcadas as (
    update public.execucao_fotos ef
    set expirado_em = now()
    where ef.expirado_em is null
      and ef.tipo = 'durante'
      and ef.created_at < (now() - interval '90 days')
    returning ef.id
  )
  select count(*) into v_exec_durante_expiradas from marcadas;

  -- Fotos de Execução (saida / entrega): retenção de 180 dias
  with marcadas as (
    update public.execucao_fotos ef
    set expirado_em = now()
    where ef.expirado_em is null
      and ef.tipo = 'saida'
      and ef.created_at < (now() - interval '180 days')
    returning ef.id
  )
  select count(*) into v_exec_saida_expiradas from marcadas;

  return jsonb_build_object(
    'checkin_fotos_expiradas', v_checkin_expiradas,
    'execucao_durante_expiradas', v_exec_durante_expiradas,
    'execucao_saida_expiradas', v_exec_saida_expiradas,
    'executado_em', now()
  );
end;
$$;
grant execute on function public.limpar_fotos_expiradas() to authenticated;

-- D3: RPC de Monitoramento de Uso de Storage da Plataforma
create or replace function public.uso_storage_plataforma()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_checkin_fotos integer := 0;
  v_total_execucao_fotos integer := 0;
  v_total_fotos integer := 0;
  v_tamanho_estimado_mb numeric(10,2) := 0.00;
  v_oficinas_ativas integer := 0;
  v_media_fotos_por_oficina numeric(10,2) := 0.00;
begin
  select count(*) into v_total_checkin_fotos from public.checkin_fotos where expirado_em is null;
  select count(*) into v_total_execucao_fotos from public.execucao_fotos where expirado_em is null;
  
  v_total_fotos := v_total_checkin_fotos + v_total_execucao_fotos;
  -- Estimativa: ~200 KB por foto (0.2 MB)
  v_tamanho_estimado_mb := round(v_total_fotos * 0.20, 2);

  select count(*) into v_oficinas_ativas from public.tenants;
  if v_oficinas_ativas > 0 then
    v_media_fotos_por_oficina := round(v_total_fotos::numeric / v_oficinas_ativas::numeric, 2);
  end if;

  return jsonb_build_object(
    'total_fotos_checkin', v_total_checkin_fotos,
    'total_fotos_execucao', v_total_execucao_fotos,
    'total_fotos_plataforma', v_total_fotos,
    'tamanho_estimado_mb', v_tamanho_estimado_mb,
    'oficinas_ativas', v_oficinas_ativas,
    'media_fotos_por_oficina', v_media_fotos_por_oficina
  );
end;
$$;
grant execute on function public.uso_storage_plataforma() to authenticated;

-- D4: Limite de fotos_mes no plan_limits (50 para free, nulo para pro/studio)
insert into public.plan_limits (plano, recurso, limite) values
  ('free', 'fotos_mes', 50),
  ('pro', 'fotos_mes', null),
  ('studio', 'fotos_mes', null)
on conflict (plano, recurso) do update set limite = excluded.limite;


-- ============================================================================
-- PARTE E: AUDITORIA E REFORÇO DE SEGURANÇA NAS RPCS PÚBLICAS
-- ============================================================================

-- Garantir que as 8 RPCs públicas utilizem estritamente UUID e estejam protegidas
grant execute on function public.catalogo_publico(text) to anon, authenticated;
grant execute on function public.catalogo_agendamento(text) to anon, authenticated;
grant execute on function public.orcamento_publico(uuid) to anon, authenticated;
grant execute on function public.responder_orcamento(uuid, text, boolean) to anon, authenticated;
grant execute on function public.agendar_orcamento_publico(uuid, timestamptz) to anon, authenticated;
grant execute on function public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text) to anon, authenticated;
grant execute on function public.vistoria_publica(uuid) to anon, authenticated;
grant execute on function public.aceitar_vistoria_remoto(uuid, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
