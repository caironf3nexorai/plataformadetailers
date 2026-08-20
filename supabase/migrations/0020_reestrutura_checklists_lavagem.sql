-- Migration 0020: Reestruturação de Checklists (Externa/Interna), Observações Técnicas por Etapa e Catálogo Modelo

-- 1. Coluna observacao em checklist_modelo_itens e execucao_itens
alter table public.checklist_modelo_itens
  add column if not exists observacao text;

alter table public.execucao_itens
  add column if not exists observacao text;

-- 2. Atualizar iniciar_execucao para copiar a observação técnica
drop function if exists public.iniciar_execucao(uuid);
create or replace function public.iniciar_execucao(
  p_agendamento uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_member_id uuid;
  v_agendamento record;
  v_execucao_id uuid;
  v_item record;
  v_citem record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_agendamento
  from public.agendamentos
  where id = p_agendamento;

  if v_agendamento.id is null then
    raise exception 'Agendamento não encontrado';
  end if;

  v_tenant_id := v_agendamento.tenant_id;

  select id into v_member_id
  from public.tenant_members
  where tenant_id = v_tenant_id
    and user_id = auth.uid()
    and status = 'ativo'
  limit 1;

  if v_member_id is null then
    raise exception 'Acesso negado: usuário não é membro ativo desta oficina';
  end if;

  select id into v_execucao_id
  from public.execucoes
  where agendamento_id = p_agendamento;

  if v_execucao_id is not null then
    return v_execucao_id;
  end if;

  insert into public.execucoes (
    tenant_id,
    agendamento_id,
    status,
    iniciado_em
  ) values (
    v_tenant_id,
    p_agendamento,
    'em_andamento',
    now()
  )
  returning id into v_execucao_id;

  insert into public.execucao_executores (
    tenant_id,
    execucao_id,
    member_id,
    pode_modificar
  ) values (
    v_tenant_id,
    v_execucao_id,
    v_member_id,
    true
  )
  on conflict (execucao_id, member_id) do nothing;

  update public.agendamentos
  set status = 'em_andamento',
      updated_at = now()
  where id = p_agendamento;

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
          v_execucao_id,
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

  return v_execucao_id;
end;
$$;

-- 3. Atualizar Catálogo Modelo de Serviços (servicos_modelo)
insert into public.servicos_modelo (codigo, nome, grupo, modo_ocupacao, duracao_sugerida, ordem, descricao_publica)
values
  ('LV-04', 'Lavagem Detalhada Externa', 'Lavagem', 'slot', 60, 1, 'Lavagem detalhada da pintura, rodas, frestas, descontaminação e acabamentos externos.'),
  ('LV-05', 'Lavagem Detalhada Interna', 'Lavagem', 'slot', 60, 2, 'Aspiração profunda, limpeza de frestas, painéis, cintos, pedais e vidros internos.')
on conflict (codigo) do update set
  nome = excluded.nome,
  grupo = excluded.grupo,
  modo_ocupacao = excluded.modo_ocupacao,
  duracao_sugerida = excluded.duracao_sugerida,
  ordem = excluded.ordem,
  descricao_publica = excluded.descricao_publica;

-- 4. Seed de Modelos de Checklist e Atualização de Serviços nos Tenants
do $$
declare
  v_tenant record;
  v_mod_ext_id uuid;
  v_mod_int_id uuid;
  v_mod_simp_id uuid;
begin
  for v_tenant in select id from public.tenants loop

    -- A) LAVAGEM DETALHADA EXTERNA
    select id into v_mod_ext_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Lavagem Detalhada Externa';
    if v_mod_ext_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Lavagem Detalhada Externa') returning id into v_mod_ext_id;
    else
      delete from public.checklist_modelo_itens where modelo_id = v_mod_ext_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem, observacao) values
      (v_tenant.id, v_mod_ext_id, 'Inspeção inicial e registro de avarias', true, 1, 'Registrar avarias prévias no checkin de entrada'),
      (v_tenant.id, v_mod_ext_id, 'Limpeza de rodas, pneus e caixas de roda', true, 2, 'Rodas antes da lataria para não respingar nas partes limpas'),
      (v_tenant.id, v_mod_ext_id, 'Descontaminação química das rodas', false, 3, 'Usar desoxidante ferroso específico'),
      (v_tenant.id, v_mod_ext_id, 'Pré-lavagem com snow foam', false, 4, 'Aguardar ação do produto por 3 a 5 minutos'),
      (v_tenant.id, v_mod_ext_id, 'Remoção de insetos e piche', false, 5, null),
      (v_tenant.id, v_mod_ext_id, 'Lavagem manual com técnica de dois baldes', true, 6, 'Um balde com shampoo e um para enxágue da luva'),
      (v_tenant.id, v_mod_ext_id, 'Limpeza de grades, frestas e emblemas com pincel', false, 7, null),
      (v_tenant.id, v_mod_ext_id, 'Limpeza de soleiras e batentes das portas', false, 8, null),
      (v_tenant.id, v_mod_ext_id, 'Limpeza do porta-malas e vão do estepe', false, 9, null),
      (v_tenant.id, v_mod_ext_id, 'Descontaminação da pintura com clay bar', false, 10, 'Usar lubrificante apropriado'),
      (v_tenant.id, v_mod_ext_id, 'Enxágue final', true, 11, null),
      (v_tenant.id, v_mod_ext_id, 'Secagem com toalha de microfibra e soprador', true, 12, 'Soprador nas frestas para evitar escorridos'),
      (v_tenant.id, v_mod_ext_id, 'Limpeza de vidros externos e retrovisores', false, 13, null),
      (v_tenant.id, v_mod_ext_id, 'Condicionamento de plásticos e borrachas externas', false, 14, 'Usar renovador com proteção UV'),
      (v_tenant.id, v_mod_ext_id, 'Pretinho nos pneus', false, 15, 'Acabamento fosco ou acetinado'),
      (v_tenant.id, v_mod_ext_id, 'Inspeção final sob luz', false, 16, null);

    -- Garantir serviço Lavagem Detalhada Externa no tenant e associar checklist
    insert into public.servicos (tenant_id, nome, grupo, modo_ocupacao, codigo, tom)
    values (v_tenant.id, 'Lavagem Detalhada Externa', 'Lavagem', 'slot', 'LV-04', 'amber')
    on conflict (tenant_id, nome) do update set checklist_modelo_id = v_mod_ext_id;
    update public.servicos set checklist_modelo_id = v_mod_ext_id
    where tenant_id = v_tenant.id and (nome ilike '%lavagem detalhada externa%' or nome = 'Lavagem Detalhada Externa');

    -- B) LAVAGEM DETALHADA INTERNA
    select id into v_mod_int_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Lavagem Detalhada Interna';
    if v_mod_int_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Lavagem Detalhada Interna') returning id into v_mod_int_id;
    else
      delete from public.checklist_modelo_itens where modelo_id = v_mod_int_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem, observacao) values
      (v_tenant.id, v_mod_int_id, 'Retirada de tapetes e objetos do cliente', true, 1, 'Guardar pertences no saco transparente de segurança'),
      (v_tenant.id, v_mod_int_id, 'Aspiração de bancos, carpetes e porta-malas', true, 2, null),
      (v_tenant.id, v_mod_int_id, 'Aspiração sob os bancos e nos trilhos', false, 3, 'Recuar os bancos totalmente para frente e para trás'),
      (v_tenant.id, v_mod_int_id, 'Limpeza de painel e console', false, 4, 'Pano de microfibra limpo e APC neutro'),
      (v_tenant.id, v_mod_int_id, 'Limpeza de saídas de ar com pincel', false, 5, null),
      (v_tenant.id, v_mod_int_id, 'Limpeza de portas, puxadores e porta-objetos', false, 6, null),
      (v_tenant.id, v_mod_int_id, 'Limpeza de cintos de segurança', false, 7, 'Puxar cinto totalmente e higienizar ambas as faces'),
      (v_tenant.id, v_mod_int_id, 'Limpeza de pedais e descanso de pé', false, 8, null),
      (v_tenant.id, v_mod_int_id, 'Limpeza do teto (interno)', false, 9, 'Limpeza a seco sem encharcar o tecido'),
      (v_tenant.id, v_mod_int_id, 'Limpeza de plásticos com condicionador', false, 10, 'Toque seco, sem aspecto engordurado'),
      (v_tenant.id, v_mod_int_id, 'Limpeza de vidros internos', true, 11, 'Usar limpa-vidros livre de amônia'),
      (v_tenant.id, v_mod_int_id, 'Limpeza e recolocação dos tapetes', false, 12, null),
      (v_tenant.id, v_mod_int_id, 'Devolução dos objetos do cliente', true, 13, null),
      (v_tenant.id, v_mod_int_id, 'Odorizante e inspeção final', false, 14, null);

    -- Garantir serviço Lavagem Detalhada Interna no tenant e associar checklist
    insert into public.servicos (tenant_id, nome, grupo, modo_ocupacao, codigo, tom)
    values (v_tenant.id, 'Lavagem Detalhada Interna', 'Lavagem', 'slot', 'LV-05', 'amber')
    on conflict (tenant_id, nome) do update set checklist_modelo_id = v_mod_int_id;
    update public.servicos set checklist_modelo_id = v_mod_int_id
    where tenant_id = v_tenant.id and (nome ilike '%lavagem detalhada interna%' or nome = 'Lavagem Detalhada Interna');

    -- C) REVISÃO DA LAVAGEM SIMPLES
    select id into v_mod_simp_id from public.checklist_modelos where tenant_id = v_tenant.id and nome = 'Lavagem Simples';
    if v_mod_simp_id is null then
      insert into public.checklist_modelos (tenant_id, nome) values (v_tenant.id, 'Lavagem Simples') returning id into v_mod_simp_id;
    else
      delete from public.checklist_modelo_itens where modelo_id = v_mod_simp_id;
    end if;

    insert into public.checklist_modelo_itens (tenant_id, modelo_id, descricao, obrigatorio, ordem, observacao) values
      (v_tenant.id, v_mod_simp_id, 'Limpeza de rodas e pneus', true, 1, null),
      (v_tenant.id, v_mod_simp_id, 'Pré-lavagem', false, 2, null),
      (v_tenant.id, v_mod_simp_id, 'Lavagem externa com shampoo', true, 3, null),
      (v_tenant.id, v_mod_simp_id, 'Enxágue', false, 4, null),
      (v_tenant.id, v_mod_simp_id, 'Secagem', true, 5, null),
      (v_tenant.id, v_mod_simp_id, 'Aspiração interna', false, 6, null),
      (v_tenant.id, v_mod_simp_id, 'Limpeza de painel', false, 7, null),
      (v_tenant.id, v_mod_simp_id, 'Vidros internos e externos', false, 8, null),
      (v_tenant.id, v_mod_simp_id, 'Pretinho nos pneus', false, 9, null);

    update public.servicos set checklist_modelo_id = v_mod_simp_id
    where tenant_id = v_tenant.id and nome ilike '%lavagem simples%';

  end loop;
end $$;
