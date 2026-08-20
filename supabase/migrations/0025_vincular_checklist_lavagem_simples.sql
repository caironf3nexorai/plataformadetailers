-- Migration 0025: Garantia da coluna observacao, vinculação do Checklist Lavagem Simples ao serviço LV-01, atualização da RPC iniciar_execucao e Backfill de Execuções sem itens

-- 1. Garante a existência da coluna observacao em ambas as tabelas
alter table public.checklist_modelo_itens
  add column if not exists observacao text;

alter table public.execucao_itens
  add column if not exists observacao text;

-- 2. Redefinição da RPC iniciar_execucao para garantir copia de itens do checklist com a observação
drop function if exists public.iniciar_execucao(uuid);

create or replace function public.iniciar_execucao(p_agendamento uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_now timestamptz := now();
  v_exec_id uuid;
  v_item record;
  v_citem record;
begin
  select tenant_id into v_tenant_id from public.agendamentos where id = p_agendamento;
  if v_tenant_id is null then
    return jsonb_build_object('success', false, 'error', 'Agendamento não encontrado');
  end if;

  select id into v_exec_id from public.execucoes where agendamento_id = p_agendamento;

  if v_exec_id is not null then
    update public.execucoes
    set status = 'em_andamento',
        contando_desde = coalesce(contando_desde, v_now),
        iniciado_em = coalesce(iniciado_em, v_now),
        pausado_em = null,
        finalizado_em = null,
        updated_at = v_now
    where id = v_exec_id;
  else
    insert into public.execucoes (
      tenant_id, agendamento_id, status, iniciado_em, contando_desde, segundos_trabalhados, segundos_pausados
    ) values (
      v_tenant_id, p_agendamento, 'em_andamento', v_now, v_now, 0, 0
    ) returning id into v_exec_id;
  end if;

  update public.agendamentos
  set status = 'em_andamento', updated_at = v_now
  where id = p_agendamento;

  -- Copiar itens de checklist do modelo para a execução (se ainda não existirem)
  if not exists (select 1 from public.execucao_itens where execucao_id = v_exec_id) then
    for v_item in (
      select
        ai.id as agendamento_item_id,
        coalesce(s.nome, 'Serviço') as servico_nome,
        s.checklist_modelo_id
      from public.agendamento_itens ai
      left join public.servicos s on s.id = ai.servico_id
      where ai.agendamento_id = p_agendamento
    ) loop
      if v_item.checklist_modelo_id is not null then
        for v_citem in (
          select cmi.descricao, cmi.obrigatorio, cmi.ordem, cmi.observacao
          from public.checklist_modelo_itens cmi
          where cmi.modelo_id = v_item.checklist_modelo_id
          order by cmi.ordem, cmi.created_at
        ) loop
          insert into public.execucao_itens (
            tenant_id,
            execucao_id,
            agendamento_item_id,
            servico_nome,
            descricao,
            obrigatorio,
            ordem,
            origem,
            observacao
          ) values (
            v_tenant_id,
            v_exec_id,
            v_item.agendamento_item_id,
            v_item.servico_nome,
            v_citem.descricao,
            v_citem.obrigatorio,
            v_citem.ordem,
            'modelo',
            v_citem.observacao
          );
        end loop;
      end if;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'execucao_id', v_exec_id);
end;
$$;

-- 3. Bloco do/plpgsql para garantir checklist e vinculo ao servico LV-01 + Backfill de execucoes existentes
do $$
declare
  v_tenant record;
  v_mod_simp_id uuid;
  v_exec record;
  v_item record;
  v_citem record;
begin
  -- Para cada tenant, garantir o modelo "Lavagem Simples" e vinculá-lo ao serviço LV-01
  for v_tenant in select id from public.tenants loop

    select id into v_mod_simp_id 
    from public.checklist_modelos 
    where tenant_id = v_tenant.id and (nome ilike '%lavagem simples%' or nome = 'Lavagem Simples')
    limit 1;

    if v_mod_simp_id is null then
      insert into public.checklist_modelos (tenant_id, nome) 
      values (v_tenant.id, 'Lavagem Simples') 
      returning id into v_mod_simp_id;
    end if;

    -- Se o modelo não tem itens, insere os itens padrão
    if not exists (select 1 from public.checklist_modelo_itens where modelo_id = v_mod_simp_id) then
      insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem, observacao) values
        (v_tenant.id, v_mod_simp_id, 'Limpeza de rodas e pneus', true, 1, 'Usar desengraxante específico e escova para caixas de roda'),
        (v_tenant.id, v_mod_simp_id, 'Pré-lavagem', false, 2, 'Aplicar snow foam e aguardar agir por 3 minutos'),
        (v_tenant.id, v_mod_simp_id, 'Lavagem externa com shampoo', true, 3, 'Utilizar luva de microfibra e técnica de dois baldes'),
        (v_tenant.id, v_mod_simp_id, 'Enxágue', false, 4, 'Enxaguar com lavadora de alta pressão de cima para baixo'),
        (v_tenant.id, v_mod_simp_id, 'Secagem', true, 5, 'Utilizar toalha de secagem de microfibra macia'),
        (v_tenant.id, v_mod_simp_id, 'Aspiração interna', false, 6, 'Aspirar bancos, carpetes e porta-malas'),
        (v_tenant.id, v_mod_simp_id, 'Limpeza de painel', false, 7, 'Usar pincel de detalhamento e produto neutro'),
        (v_tenant.id, v_mod_simp_id, 'Vidros internos e externos', false, 8, 'Limpar com limpa-vidros específico e pano sem fiapos'),
        (v_tenant.id, v_mod_simp_id, 'Pretinho nos pneus', false, 9, 'Aplicar condicionador de pneus com acabamento fosco/acetinado');
    end if;

    -- Vincula o modelo ao serviço LV-01 / Lavagem Simples do tenant
    update public.servicos
    set checklist_modelo_id = v_mod_simp_id
    where tenant_id = v_tenant.id 
      and (nome ilike '%lavagem simples%' or codigo = 'LV-01' or codigo = 'LV-01-SIMPLE');

  end loop;

  -- Backfill: Para execuções existentes que estão sem nenhum item de checklist
  for v_exec in 
    select e.id as execucao_id, e.tenant_id, e.agendamento_id
    from public.execucoes e
    where not exists (
      select 1 from public.execucao_itens ei where ei.execucao_id = e.id
    )
  loop
    for v_item in (
      select
        ai.id as agendamento_item_id,
        coalesce(s.nome, 'Serviço') as servico_nome,
        s.checklist_modelo_id
      from public.agendamento_itens ai
      left join public.servicos s on s.id = ai.servico_id
      where ai.agendamento_id = v_exec.agendamento_id
    ) loop
      if v_item.checklist_modelo_id is not null then
        for v_citem in (
          select cmi.descricao, cmi.obrigatorio, cmi.ordem, cmi.observacao
          from public.checklist_modelo_itens cmi
          where cmi.modelo_id = v_item.checklist_modelo_id
          order by cmi.ordem, cmi.created_at
        ) loop
          insert into public.execucao_itens (
            tenant_id,
            execucao_id,
            agendamento_item_id,
            servico_nome,
            descricao,
            obrigatorio,
            ordem,
            origem,
            observacao
          ) values (
            v_exec.tenant_id,
            v_exec.execucao_id,
            v_item.agendamento_item_id,
            v_item.servico_nome,
            v_citem.descricao,
            v_citem.obrigatorio,
            v_citem.ordem,
            'modelo',
            v_citem.observacao
          );
        end loop;
      end if;
    end loop;
  end loop;

end $$;
