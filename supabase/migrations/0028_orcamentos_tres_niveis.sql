-- Migration 0028: Orçamentos em Três Níveis (Essencial, Recomendado, Completo)

-- 1. ADICIONA NÚMERO DE ORÇAMENTO EM TENANT_CONTADORES
alter table public.tenant_contadores
  add column if not exists proximo_orcamento integer not null default 1;

-- 2. TABELA ORCAMENTOS
create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  numero integer not null,
  cliente_id uuid not null references public.clientes(id),
  veiculo_id uuid references public.veiculos(id),
  categoria_id uuid not null references public.categorias_veiculo(id),
  titulo text,
  observacoes text,
  status text not null default 'rascunho' check (status in ('rascunho', 'enviado', 'visualizado', 'aprovado', 'recusado', 'expirado')),
  nivel_aprovado text check (nivel_aprovado in ('essencial', 'recomendado', 'completo')),
  validade_dias smallint not null default 7,
  enviado_em timestamptz,
  visualizado_em timestamptz,
  respondido_em timestamptz,
  token_publico uuid default gen_random_uuid(),
  agendamento_id uuid references public.agendamentos(id),
  criado_por uuid not null references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, numero)
);

create index if not exists idx_orcamentos_tenant_status on public.orcamentos(tenant_id, status);
create index if not exists idx_orcamentos_token_publico on public.orcamentos(token_publico);

-- 3. TABELA ORCAMENTO_NIVEIS
create table if not exists public.orcamento_niveis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  orcamento_id uuid not null references public.orcamentos(id) on delete cascade,
  nivel text not null check (nivel in ('essencial', 'recomendado', 'completo')),
  titulo text not null,
  descricao text,
  valor_total numeric(10,2) not null default 0,
  duracao_total integer not null default 0,
  destaque boolean not null default false,
  ordem smallint not null default 0,
  unique (orcamento_id, nivel)
);

-- 4. TABELA ORCAMENTO_NIVEL_ITENS
create table if not exists public.orcamento_nivel_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nivel_id uuid not null references public.orcamento_niveis(id) on delete cascade,
  servico_id uuid not null references public.servicos(id),
  combo_id uuid references public.combos(id),
  preco numeric(10,2) not null,
  duracao_minutos integer not null,
  incluido boolean not null default true,
  ordem smallint not null default 0
);

comment on table public.orcamento_nivel_itens is 'preço e duração são cópias do catálogo no momento da criação. Alterar o preço do serviço depois não altera orçamentos já emitidos.';


-- 5. FUNÇÃO ATÔMICA PARA GERAR PRÓXIMO NÚMERO DE ORÇAMENTO
create or replace function public.proximo_numero_orcamento(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero integer;
begin
  insert into public.tenant_contadores (tenant_id, proxima_os, proximo_orcamento)
  values (p_tenant, 1, 1)
  on conflict (tenant_id) do nothing;

  update public.tenant_contadores
  set proximo_orcamento = proximo_orcamento + 1
  where tenant_id = p_tenant
  returning proximo_orcamento - 1 into v_numero;

  return v_numero;
end;
$$;

grant execute on function public.proximo_numero_orcamento(uuid) to authenticated;


-- 6. RPC CRIAR_ORCAMENTO
create or replace function public.criar_orcamento(
  p_cliente uuid,
  p_veiculo uuid default null,
  p_categoria uuid default null,
  p_titulo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_categoria_id uuid := p_categoria;
  v_numero integer;
  v_orcamento_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select c.tenant_id into v_tenant_id from public.clientes c where c.id = p_cliente;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  if not public.tem_papel(v_tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado. Apenas dono ou gerente podem criar orçamentos.';
  end if;

  -- Se categoria não informada, tenta pegar do veículo
  if v_categoria_id is null and p_veiculo is not null then
    select v.categoria_id into v_categoria_id from public.veiculos v where v.id = p_veiculo;
  end if;

  -- Se ainda nula, pega a primeira categoria ativa do tenant
  if v_categoria_id is null then
    select id into v_categoria_id from public.categorias_veiculo where tenant_id = v_tenant_id limit 1;
  end if;

  if v_categoria_id is null then
    raise exception 'Nenhuma categoria de veículo disponível.';
  end if;

  v_numero := public.proximo_numero_orcamento(v_tenant_id);

  insert into public.orcamentos (
    tenant_id, numero, cliente_id, veiculo_id, categoria_id, titulo, criado_por
  ) values (
    v_tenant_id, v_numero, p_cliente, p_veiculo, v_categoria_id, p_titulo, auth.uid()
  ) returning id into v_orcamento_id;

  -- Cria os três níveis vazios padrão (Essencial, Recomendado [Destaque], Completo)
  insert into public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, destaque, ordem)
  values
    (v_tenant_id, v_orcamento_id, 'essencial', 'Essencial', 'Serviço principal solicitado', false, 1),
    (v_tenant_id, v_orcamento_id, 'recomendado', 'Recomendado', 'Manutenção completa recomendada para seu veículo', true, 2),
    (v_tenant_id, v_orcamento_id, 'completo', 'Completo / Proteção Total', 'O melhor resultado com proteção duradoura', false, 3);

  return v_orcamento_id;
end;
$$;

grant execute on function public.criar_orcamento(uuid, uuid, uuid, text) to authenticated;


-- 7. RPC SALVAR_NIVEL_ORCAMENTO
create or replace function public.salvar_nivel_orcamento(
  p_nivel uuid,
  p_itens jsonb,
  p_titulo text default null,
  p_descricao text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_nivel_rec record;
  v_orcamento_rec record;
  v_item jsonb;
  v_servico_id uuid;
  v_combo_id uuid;
  v_preco numeric(10,2);
  v_duracao integer;
  v_total_valor numeric(10,2) := 0;
  v_total_duracao integer := 0;
  v_ordem smallint := 1;
begin
  select n.* into v_nivel_rec from public.orcamento_niveis n where n.id = p_nivel;
  if not found then
    raise exception 'Nível de orçamento não encontrado.';
  end if;

  select o.* into v_orcamento_rec from public.orcamentos o where o.id = v_nivel_rec.orcamento_id;

  if not public.tem_papel(v_orcamento_rec.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado. Apenas dono e gerente podem editar orçamentos.';
  end if;

  -- Atualiza título e descrição do nível se informados
  update public.orcamento_niveis
  set titulo = coalesce(p_titulo, titulo),
      descricao = coalesce(p_descricao, descricao)
  where id = p_nivel;

  -- Deleta itens anteriores do nível
  delete from public.orcamento_nivel_itens where nivel_id = p_nivel;

  -- Inserção dos itens com snapshot de preço e duração
  if p_itens is not null and jsonb_array_length(p_itens) > 0 then
    for v_item in select * from jsonb_array_elements(p_itens)
    loop
      v_servico_id := (v_item->>'servico_id')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

      if v_servico_id is not null then
        -- Tenta buscar preço da matriz de preços para a categoria do orçamento
        select mp.preco into v_preco
        from public.matriz_precos mp
        where mp.servico_id = v_servico_id and mp.categoria_id = v_orcamento_rec.categoria_id;

        -- Fallback se não encontrar na matriz
        if v_preco is null then
          select s.preco_base into v_preco from public.servicos s where s.id = v_servico_id;
        end if;
        v_preco := coalesce(v_preco, 0);

        -- Tenta buscar duração da categoria do serviço
        select sc.duracao_minutos into v_duracao
        from public.servico_categorias sc
        where sc.servico_id = v_servico_id and sc.categoria_id = v_orcamento_rec.categoria_id;

        if v_duracao is null then
          select s.duracao_minutos into v_duracao from public.servicos s where s.id = v_servico_id;
        end if;
        v_duracao := coalesce(v_duracao, 60);

        insert into public.orcamento_nivel_itens (
          tenant_id, nivel_id, servico_id, combo_id, preco, duracao_minutos, ordem
        ) values (
          v_orcamento_rec.tenant_id, p_nivel, v_servico_id, v_combo_id, v_preco, v_duracao, v_ordem
        );

        v_total_valor := v_total_valor + v_preco;
        v_total_duracao := v_total_duracao + v_duracao;
        v_ordem := v_ordem + 1;
      end if;
    end loop;
  end if;

  -- Recalcula totais do nível
  update public.orcamento_niveis
  set valor_total = v_total_valor,
      duracao_total = v_total_duracao
  where id = p_nivel;

  update public.orcamentos set updated_at = now() where id = v_orcamento_rec.id;
end;
$$;

grant execute on function public.salvar_nivel_orcamento(uuid, jsonb, text, text) to authenticated;


-- 8. RPC ENVIAR_ORCAMENTO
create or replace function public.enviar_orcamento(p_orcamento uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
begin
  select o.* into v_orcamento from public.orcamentos o where o.id = p_orcamento;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if not public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  update public.orcamentos
  set status = case when status = 'rascunho' then 'enviado' else status end,
      enviado_em = coalesce(enviado_em, now()),
      updated_at = now()
  where id = p_orcamento;

  return v_orcamento.token_publico::text;
end;
$$;

grant execute on function public.enviar_orcamento(uuid) to authenticated;


-- 9. RPC ORCAMENTO_PUBLICO (CONSULTA ANÔNIMA COM VALIDAÇÃO DE EXPIRAÇÃO EM TEMPO REAL)
create or replace function public.orcamento_publico(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_cliente record;
  v_veiculo record;
  v_tenant record;
  v_niveis_json jsonb;
  v_primeiro_nome text;
  v_is_expirado boolean := false;
  v_status_atual text;
begin
  select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
  if not found then
    return jsonb_build_object('erro', 'Orçamento não encontrado');
  end if;

  v_status_atual := v_orcamento.status;

  -- Valida se está expirado no momento do acesso
  if v_status_atual in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
    if (v_orcamento.enviado_em::date + v_orcamento.validade_dias) < current_date then
      v_is_expirado := true;
      v_status_atual := 'expirado';

      update public.orcamentos
      set status = 'expirado', updated_at = now()
      where id = v_orcamento.id;
    end if;
  end if;

  -- Registra primeira visualização se ainda 'enviado' e dentro da validade
  if v_status_atual = 'enviado' and not v_is_expirado then
    update public.orcamentos
    set status = 'visualizado',
        visualizado_em = coalesce(visualizado_em, now()),
        updated_at = now()
    where id = v_orcamento.id;
    
    v_status_atual := 'visualizado';
  end if;

  -- Informações públicas da oficina (Sem expor tenant_id ou dados internos)
  select t.nome, t.logo_url, t.telefone into v_tenant
  from public.tenants t where t.id = v_orcamento.tenant_id;

  -- Cliente: apenas o primeiro nome para personalização respeitando privacidade
  select c.nome into v_cliente from public.clientes c where c.id = v_orcamento.cliente_id;
  v_primeiro_nome := split_part(coalesce(v_cliente.nome, 'Cliente'), ' ', 1);

  -- Veículo: placa e modelo
  if v_orcamento.veiculo_id is not null then
    select v.placa, v.modelo, v.marca into v_veiculo from public.veiculos v where v.id = v_orcamento.veiculo_id;
  end if;

  -- Níveis e serviços em formato limpo
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'nivel', n.nivel,
      'titulo', n.titulo,
      'descricao', n.descricao,
      'valor_total', n.valor_total,
      'duracao_total', n.duracao_total,
      'destaque', n.destaque,
      'ordem', n.ordem,
      'itens', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'servico_nome', s.nome,
              'servico_descricao', s.descricao_publica,
              'preco', i.preco,
              'duracao_minutos', i.duracao_minutos
            ) order by i.ordem asc
          )
          from public.orcamento_nivel_itens i
          join public.servicos s on s.id = i.servico_id
          where i.nivel_id = n.id
        ), '[]'::jsonb
      )
    ) order by n.ordem asc
  ), '[]'::jsonb)
  into v_niveis_json
  from public.orcamento_niveis n
  where n.orcamento_id = v_orcamento.id;

  return jsonb_build_object(
    'numero', v_orcamento.numero,
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'validade_dias', v_orcamento.validade_dias,
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', case when v_orcamento.enviado_em is not null then (v_orcamento.enviado_em::date + v_orcamento.validade_dias) else null end,
    'oficina', jsonb_build_object(
      'nome', v_tenant.nome,
      'logo_url', v_tenant.logo_url,
      'telefone', v_tenant.telefone
    ),
    'cliente_primeiro_nome', v_primeiro_nome,
    'veiculo', case when v_veiculo.placa is not null then jsonb_build_object(
      'placa', v_veiculo.placa,
      'modelo', v_veiculo.modelo,
      'marca', v_veiculo.marca
    ) else null end,
    'niveis', v_niveis_json
  );
end;
$$;

grant execute on function public.orcamento_publico(uuid) to anon, authenticated;


-- 10. RPC RESPONDER_ORCAMENTO (CLIENTE ACEITA OU RECUSA NÍVEL)
create or replace function public.responder_orcamento(
  p_token uuid,
  p_nivel text,
  p_aceite boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
begin
  select o.* into v_orcamento from public.orcamentos o where o.token_publico = p_token;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  -- Valida se expirou
  if v_orcamento.status in ('enviado', 'visualizado') and v_orcamento.enviado_em is not null then
    if (v_orcamento.enviado_em::date + v_orcamento.validade_dias) < current_date then
      update public.orcamentos set status = 'expirado', updated_at = now() where id = v_orcamento.id;
      raise exception 'Este orçamento está expirado e não aceita mais respostas.';
    end if;
  end if;

  if v_orcamento.status = 'expirado' then
    raise exception 'Este orçamento está expirado e não aceita mais respostas.';
  end if;

  if v_orcamento.status in ('aprovado', 'recusado') then
    raise exception 'Este orçamento já foi respondido anteriormente.';
  end if;

  if p_aceite then
    if p_nivel not in ('essencial', 'recomendado', 'completo') then
      raise exception 'Nível de orçamento inválido.';
    end if;

    if not exists (
      select 1 from public.orcamento_niveis
      where orcamento_id = v_orcamento.id and nivel = p_nivel
    ) then
      raise exception 'O nível escolhido não existe neste orçamento.';
    end if;

    update public.orcamentos
    set status = 'aprovado',
        nivel_aprovado = p_nivel,
        respondido_em = now(),
        updated_at = now()
    where id = v_orcamento.id;
  else
    update public.orcamentos
    set status = 'recusado',
        respondido_em = now(),
        updated_at = now()
    where id = v_orcamento.id;
  end if;
end;
$$;

grant execute on function public.responder_orcamento(uuid, text, boolean) to anon, authenticated;


-- 11. RPC CONVERTER_ORCAMENTO_EM_AGENDAMENTO
create or replace function public.converter_orcamento_em_agendamento(
  p_orcamento uuid,
  p_inicio timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_orcamento record;
  v_nivel_rec record;
  v_duracao_total integer;
  v_agendamento_id uuid;
  v_item record;
  v_servico_principal uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select o.* into v_orcamento from public.orcamentos o where o.id = p_orcamento;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;

  if not public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  if v_orcamento.status <> 'aprovado' then
    raise exception 'Apenas orçamentos aprovados podem ser convertidos em agendamento.';
  end if;

  if v_orcamento.nivel_aprovado is null then
    raise exception 'Nenhum nível aprovado foi registrado para este orçamento.';
  end if;

  -- Busca o nível aprovado
  select n.* into v_nivel_rec
  from public.orcamento_niveis n
  where n.orcamento_id = p_orcamento and n.nivel = v_orcamento.nivel_aprovado;

  if not found then
    raise exception 'Nível aprovado não encontrado.';
  end if;

  -- Pega o primeiro serviço do nível para ser o serviço principal do agendamento
  select i.servico_id into v_servico_principal
  from public.orcamento_nivel_itens i
  where i.nivel_id = v_nivel_rec.id
  order by i.ordem asc
  limit 1;

  -- Se já possuir agendamento vinculado, retorna o id existente
  if v_orcamento.agendamento_id is not null then
    return v_orcamento.agendamento_id;
  end if;

  -- Cria o agendamento
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    duracao_minutos,
    duracao_total,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    observacoes
  ) values (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_servico_principal,
    v_orcamento.categoria_id,
    p_inicio,
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.valor_total, 0),
    coalesce(v_nivel_rec.valor_total, 0),
    'agendado',
    'orcamento',
    coalesce(v_orcamento.observacoes, '') || ' (Convertido do Orçamento #' || v_orcamento.numero || ' - ' || v_nivel_rec.titulo || ')'
  ) returning id into v_agendamento_id;

  -- Inserir itens do agendamento copiando os itens do nível aprovado
  insert into public.agendamento_itens (
    tenant_id, agendamento_id, servico_id, duracao_minutos, preco_estimado, ordem
  )
  select
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.duracao_minutos,
    i.preco,
    i.ordem
  from public.orcamento_nivel_itens i
  where i.nivel_id = v_nivel_rec.id;

  -- Vincula o agendamento ao orçamento
  update public.orcamentos
  set agendamento_id = v_agendamento_id,
      updated_at = now()
  where id = p_orcamento;

  return v_agendamento_id;
end;
$$;

grant execute on function public.converter_orcamento_em_agendamento(uuid, timestamptz) to authenticated;


-- 12. RPC EXPIRAR_ORCAMENTOS (LOTE PARA LISTAGEM)
create or replace function public.expirar_orcamentos(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_count integer := 0;
begin
  if not (p_tenant in (select public.meus_tenants())) then
    raise exception 'Acesso negado.';
  end if;

  update public.orcamentos
  set status = 'expirado',
      updated_at = now()
  where tenant_id = p_tenant
    and status in ('enviado', 'visualizado')
    and enviado_em is not null
    and (enviado_em::date + validade_dias) < current_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.expirar_orcamentos(uuid) to authenticated;


-- 13. RLS POLICIES E PERMISSÕES
alter table public.orcamentos enable row level security;
alter table public.orcamento_niveis enable row level security;
alter table public.orcamento_nivel_itens enable row level security;

-- Orcamentos: Leitura por todos os membros do tenant, Escrita por Dono e Gerente
create policy "Membros leem orcamentos" on public.orcamentos
  for select using (tenant_id in (select public.meus_tenants()));

create policy "Dono e Gerente gerenciam orcamentos" on public.orcamentos
  for all using (public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Orcamento Niveis
create policy "Membros leem orcamento_niveis" on public.orcamento_niveis
  for select using (tenant_id in (select public.meus_tenants()));

create policy "Dono e Gerente gerenciam orcamento_niveis" on public.orcamento_niveis
  for all using (public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Orcamento Nivel Itens
create policy "Membros leem orcamento_nivel_itens" on public.orcamento_nivel_itens
  for select using (tenant_id in (select public.meus_tenants()));

create policy "Dono e Gerente gerenciam orcamento_nivel_itens" on public.orcamento_nivel_itens
  for all using (public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[]))
  with check (public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Grants das Tabelas
grant select, insert, update on public.orcamentos to authenticated;
grant select, insert, update on public.orcamento_niveis to authenticated;
grant select, insert, update on public.orcamento_nivel_itens to authenticated;
