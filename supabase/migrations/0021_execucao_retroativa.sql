-- Migration 0021: Finalização Retroativa de Execução e Governança de Ajustes Manuais

-- 1. Colunas em execucoes para auditoria de ajustes manuais
alter table public.execucoes
  add column if not exists ajuste_manual boolean not null default false,
  add column if not exists ajustado_por uuid references public.tenant_members(id) on delete set null;

comment on column public.execucoes.ajuste_manual is 'Indica se a execução teve o horário de término ajustado manualmente de forma retroativa.';
comment on column public.execucoes.ajustado_por is 'Membro da equipe (dono/gerente) que realizou o ajuste retroativo de horário.';


-- 2. RPC fechar_resultado_execucao (Recálculo do tempo efetivo da execução)
create or replace function public.fechar_resultado_execucao(
  p_execucao uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_tempo_efetivo_minutos integer;
begin
  select e.id, e.iniciado_em, e.finalizado_em, e.segundos_pausados into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    return;
  end if;

  if v_exec.finalizado_em is not null then
    v_tempo_efetivo_minutos := (extract(epoch from (v_exec.finalizado_em - v_exec.iniciado_em))::integer / 60) - (coalesce(v_exec.segundos_pausados, 0) / 60);
    if v_tempo_efetivo_minutos < 0 then
      v_tempo_efetivo_minutos := 0;
    end if;
  end if;
end;
$$;


-- 3. RPC finalizar_execucao_retroativo
create or replace function public.finalizar_execucao_retroativo(
  p_execucao uuid,
  p_fim timestamptz,
  p_observacoes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exec record;
  v_member_id uuid;
  v_pendentes_count integer;
  v_pendentes_lista text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select e.id, e.tenant_id, e.agendamento_id, e.status, e.iniciado_em into v_exec
  from public.execucoes e
  where e.id = p_execucao;

  if v_exec.id is null then
    raise exception 'Execução não encontrada';
  end if;

  -- 1. Validação de Papel (Apenas Dono e Gerente)
  if not public.tem_papel(v_exec.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Apenas donos e gerentes têm permissão para finalizar execução com horário retroativo.';
  end if;

  -- 2. Validação de Limites de Horário
  if p_fim is null then
    raise exception 'Informe um horário de término válido.';
  end if;

  if p_fim < v_exec.iniciado_em then
    raise exception 'O horário de término não pode ser anterior ao horário de início.';
  end if;

  if p_fim > now() then
    raise exception 'O horário de término não pode ser no futuro.';
  end if;

  -- 3. Validação de Itens Obrigatórios no Checklist
  select count(*), string_agg(ei.descricao, ', ') into v_pendentes_count, v_pendentes_lista
  from public.execucao_itens ei
  where ei.execucao_id = p_execucao
    and ei.obrigatorio = true
    and ei.concluido = false;

  if v_pendentes_count > 0 then
    raise exception 'Existem itens obrigatórios pendentes no checklist: %', v_pendentes_lista;
  end if;

  -- 4. Identifica o tenant_member logado
  select tm.id into v_member_id
  from public.tenant_members tm
  where tm.tenant_id = v_exec.tenant_id
    and tm.user_id = auth.uid()
    and tm.ativo = true
  limit 1;

  -- 5. Atualização da Execução com Ajuste Manual
  update public.execucoes e
  set finalizado_em = p_fim,
      status = 'finalizado',
      ajuste_manual = true,
      ajustado_por = v_member_id,
      observacoes_saida = coalesce(p_observacoes, e.observacoes_saida),
      pausado_em = null,
      updated_at = now()
  where e.id = p_execucao;

  -- 6. Atualização do Agendamento
  update public.agendamentos a
  set status = 'concluido',
      updated_at = now()
  where a.id = v_exec.agendamento_id;

  -- 7. Recalcula Resultado / Financeiro da Execução
  perform public.fechar_resultado_execucao(p_execucao);
end;
$$;
