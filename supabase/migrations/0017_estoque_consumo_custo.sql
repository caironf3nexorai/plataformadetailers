-- Migration 0017: Estoque, Consumo Real de Produtos e Custo por Serviço

-- 1. TABELA PRODUTOS
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  marca text,
  categoria text not null default 'Geral',
  unidade_uso text not null default 'ml' check (unidade_uso in ('ml', 'g', 'un')),
  tamanho_compra numeric(10,2) not null check (tamanho_compra > 0),
  preco_compra numeric(10,2) not null check (preco_compra >= 0),
  custo_unitario numeric(12,6) not null default 0,
  estoque_atual numeric(12,2) not null default 0,
  estoque_minimo numeric(12,2) not null default 0 check (estoque_minimo >= 0),
  rendimento_medio numeric(10,2),
  ativo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, nome, marca)
);

comment on table public.produtos is 'tamanho_compra e estoque_atual são sempre na unidade de uso (ex: galão de 5 L cadastra tamanho_compra = 5000 com unidade_uso = ml). A interface converte, o banco guarda em unidade única.';

-- Trigger para recálculo automático de custo unitário em produtos
create or replace function public.trg_produtos_custo_unitario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.custo_unitario := case 
    when coalesce(new.tamanho_compra, 0) > 0 then round(new.preco_compra / new.tamanho_compra, 6)
    else 0
  end;
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger before_produtos_custo
  before insert or update of preco_compra, tamanho_compra on public.produtos
  for each row execute function public.trg_produtos_custo_unitario();


-- 2. TABELA ESTOQUE_MOVIMENTOS
create table if not exists public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  tipo text not null check (tipo in ('entrada', 'consumo', 'ajuste', 'perda')),
  quantidade numeric(12,2) not null,
  custo_unitario numeric(12,6) not null,
  custo_total numeric(12,2) not null,
  execucao_id uuid references public.execucoes(id),
  observacao text,
  criado_por uuid not null references auth.users(id),
  created_at timestamptz default now()
);


-- 3. TABELA EXECUCAO_CONSUMOS
create table if not exists public.execucao_consumos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  execucao_id uuid not null references public.execucoes(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(12,2) not null check (quantidade > 0),
  custo_unitario numeric(12,6) not null,
  custo_total numeric(12,2) not null,
  registrado_por uuid not null references auth.users(id),
  created_at timestamptz default now(),
  unique (execucao_id, produto_id)
);


-- 4. ADICIONAR COLUNA DE CUSTO DE PRODUTOS EM EXECUCOES
alter table public.execucoes 
add column if not exists custo_produtos numeric(10,2) not null default 0;


-- 5. TRIGGERS DE INTEGRIDADE E RECÁLCULOS

-- Trigger: Atualiza custo_produtos na execução após alterações em execucao_consumos
create or replace function public.trg_execucao_custo_produtos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execucao_id uuid;
begin
  v_execucao_id := coalesce(new.execucao_id, old.execucao_id);
  
  update public.execucoes
  set custo_produtos = (
    select coalesce(sum(custo_total), 0)
    from public.execucao_consumos
    where execucao_id = v_execucao_id
  )
  where id = v_execucao_id;
  
  return null;
end;
$$;

create or replace trigger after_execucao_consumos_custo
  after insert or update or delete on public.execucao_consumos
  for each row execute function public.trg_execucao_custo_produtos();


-- Trigger: Atualiza rendimento_medio no produto (mediana das últimas 20 quantidades)
create or replace function public.trg_produto_rendimento_medio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_produto_id uuid;
  v_mediana numeric(10,2);
begin
  v_produto_id := new.produto_id;
  
  select percentile_cont(0.5) within group (order by sub.quantidade)
  into v_mediana
  from (
    select quantidade
    from public.execucao_consumos
    where produto_id = v_produto_id
    order by created_at desc
    limit 20
  ) sub;
  
  if v_mediana is not null then
    update public.produtos
    set rendimento_medio = round(v_mediana, 2)
    where id = v_produto_id;
  end if;
  
  return null;
end;
$$;

create or replace trigger after_execucao_consumo_rendimento
  after insert on public.execucao_consumos
  for each row execute function public.trg_produto_rendimento_medio();


-- 6. FUNÇÕES RPC (SECURITY DEFINER)

-- Entrada de Estoque (Apenas Dono / Gerente)
create or replace function public.registrar_entrada_estoque(
  p_produto uuid,
  p_quantidade numeric,
  p_preco_compra numeric default null,
  p_observacao text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_produto public.produtos%rowtype;
  v_custo_unitario numeric(12,6);
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_produto from public.produtos where id = p_produto;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;

  if not public.tem_papel(v_produto.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Sem permissão para registrar entrada de estoque.';
  end if;

  if p_quantidade <= 0 then
    raise exception 'Quantidade de entrada deve ser maior que zero.';
  end if;

  if p_preco_compra is not null and p_preco_compra <> v_produto.preco_compra then
    update public.produtos
    set preco_compra = p_preco_compra,
        estoque_atual = estoque_atual + p_quantidade
    where id = p_produto
    returning * into v_produto;
  else
    update public.produtos
    set estoque_atual = estoque_atual + p_quantidade
    where id = p_produto
    returning * into v_produto;
  end if;

  v_custo_unitario := v_produto.custo_unitario;

  insert into public.estoque_movimentos (
    tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, observacao, criado_por
  ) values (
    v_produto.tenant_id,
    p_produto,
    'entrada',
    p_quantidade,
    v_custo_unitario,
    round(p_quantidade * v_custo_unitario, 2),
    p_observacao,
    auth.uid()
  );
end;
$$;


-- Registro de Consumo da Execução (Membros Ativos)
create or replace function public.registrar_consumo(
  p_execucao uuid,
  p_consumos jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_execucao record;
  v_tenant_id uuid;
  v_item jsonb;
  v_produto_id uuid;
  v_quantidade numeric(12,2);
  v_custo_unitario numeric(12,6);
  v_custo_total numeric(12,2);
  v_old_consumo record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select e.id, e.tenant_id into v_execucao
  from public.execucoes e
  where e.id = p_execucao;

  if not found then
    raise exception 'Execução não encontrada.';
  end if;

  v_tenant_id := v_execucao.tenant_id;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'ativo'
  ) then
    raise exception 'Acesso negado.';
  end if;

  -- Estornar estoque dos consumos anteriores
  for v_old_consumo in
    select produto_id, quantidade from public.execucao_consumos where execucao_id = p_execucao
  loop
    update public.produtos
    set estoque_atual = estoque_atual + v_old_consumo.quantidade
    where id = v_old_consumo.produto_id;
  end loop;

  -- Deletar consumos anteriores da mesma execução
  delete from public.estoque_movimentos where execucao_id = p_execucao and tipo = 'consumo';
  delete from public.execucao_consumos where execucao_id = p_execucao;

  -- Inserir consumos recebidos
  if p_consumos is not null and jsonb_array_length(p_consumos) > 0 then
    for v_item in select * from jsonb_array_elements(p_consumos)
    loop
      v_produto_id := (v_item->>'produto_id')::uuid;
      v_quantidade := (v_item->>'quantidade')::numeric;

      if v_quantidade > 0 then
        select p.custo_unitario into v_custo_unitario
        from public.produtos p
        where p.id = v_produto_id and p.tenant_id = v_tenant_id;

        if v_custo_unitario is null then
          v_custo_unitario := 0;
        end if;

        v_custo_total := round(v_quantidade * v_custo_unitario, 2);

        insert into public.execucao_consumos (
          tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por
        ) values (
          v_tenant_id, p_execucao, v_produto_id, v_quantidade, v_custo_unitario, v_custo_total, auth.uid()
        );

        insert into public.estoque_movimentos (
          tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, criado_por
        ) values (
          v_tenant_id, v_produto_id, 'consumo', -v_quantidade, v_custo_unitario, v_custo_total, p_execucao, auth.uid()
        );

        update public.produtos
        set estoque_atual = estoque_atual - v_quantidade
        where id = v_produto_id;
      end if;
    end loop;
  end if;
end;
$$;


-- Sugestão de Consumo Baseada em Mediana e Histórico (>= 60% ocorrência)
create or replace function public.sugerir_consumo(p_execucao uuid)
returns jsonb
language plpgsql
security definer stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_agendamento_id uuid;
  v_categoria_id uuid;
  v_matching_exec_ids uuid[];
  v_exec_count integer;
  v_result jsonb;
begin
  select e.tenant_id, e.agendamento_id into v_tenant_id, v_agendamento_id
  from public.execucoes e
  where e.id = p_execucao;

  if not found then
    return '[]'::jsonb;
  end if;

  select v.categoria_id into v_categoria_id
  from public.agendamentos a
  join public.veiculos v on v.id = a.veiculo_id
  where a.id = v_agendamento_id;

  select array_agg(sub.id) into v_matching_exec_ids
  from (
    select distinct e.id, e.created_at
    from public.execucoes e
    join public.agendamentos a on a.id = e.agendamento_id
    join public.veiculos v on v.id = a.veiculo_id
    where e.tenant_id = v_tenant_id
      and e.id <> p_execucao
      and e.status = 'concluido'
      and (v_categoria_id is null or v.categoria_id = v_categoria_id)
    order by e.created_at desc
    limit 10
  ) sub;

  v_exec_count := coalesce(array_length(v_matching_exec_ids, 1), 0);

  if v_exec_count < 3 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'produto_id', res.produto_id,
      'nome', res.nome,
      'marca', res.marca,
      'unidade_uso', res.unidade_uso,
      'quantidade', res.mediana_qtd,
      'frequencia', res.vezes_usado,
      'percentual_frequencia', res.pct
    )
  ), '[]'::jsonb)
  into v_result
  from (
    select
      p.id as produto_id,
      p.nome,
      p.marca,
      p.unidade_uso,
      round(percentile_cont(0.5) within group (order by ec.quantidade)::numeric, 2) as mediana_qtd,
      count(distinct ec.execucao_id) as vezes_usado,
      round((count(distinct ec.execucao_id)::numeric / v_exec_count::numeric) * 100, 0) as pct
    from public.execucao_consumos ec
    join public.produtos p on p.id = ec.produto_id
    where ec.execucao_id = any(v_matching_exec_ids)
    group by p.id, p.nome, p.marca, p.unidade_uso
    having count(distinct ec.execucao_id)::numeric / v_exec_count::numeric >= 0.6
  ) res;

  return v_result;
end;
$$;


-- Ajuste Manual de Estoque (Inventário)
create or replace function public.ajustar_estoque(
  p_produto uuid,
  p_novo_valor numeric,
  p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_produto public.produtos%rowtype;
  v_diferenca numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_produto from public.produtos where id = p_produto;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;

  if not public.tem_papel(v_produto.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Sem permissão para ajustar estoque.';
  end if;

  v_diferenca := p_novo_valor - v_produto.estoque_atual;

  if v_diferenca <> 0 then
    insert into public.estoque_movimentos (
      tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, observacao, criado_por
    ) values (
      v_produto.tenant_id,
      p_produto,
      'ajuste',
      v_diferenca,
      v_produto.custo_unitario,
      round(abs(v_diferenca) * v_produto.custo_unitario, 2),
      p_motivo,
      auth.uid()
    );

    update public.produtos
    set estoque_atual = p_novo_valor
    where id = p_produto;
  end if;
end;
$$;


-- Produtos em Alerta de Reposição
create or replace function public.produtos_em_alerta(p_tenant uuid)
returns table (
  id uuid,
  nome text,
  marca text,
  categoria text,
  unidade_uso text,
  estoque_atual numeric,
  estoque_minimo numeric,
  custo_unitario numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select id, nome, marca, categoria, unidade_uso, estoque_atual, estoque_minimo, custo_unitario
  from public.produtos
  where tenant_id = p_tenant
    and estoque_atual <= estoque_minimo
    and ativo = true
  order by (estoque_minimo - estoque_atual) desc;
$$;


-- Produtos para Seleção de Consumo do Operador (Sem Custo/Preço/Estoque)
create or replace function public.produtos_para_consumo(p_tenant uuid)
returns table (
  id uuid,
  nome text,
  marca text,
  categoria text,
  unidade_uso text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, nome, marca, categoria, unidade_uso
  from public.produtos
  where tenant_id = p_tenant
    and ativo = true
  order by categoria, nome;
$$;


-- Histórico de Consumo por Veículo (Visível Apenas Gestão)
create or replace function public.historico_consumo_veiculo(p_veiculo uuid)
returns table (
  execucao_id uuid,
  concluido_em timestamptz,
  servicos_nomes text,
  produto_nome text,
  produto_marca text,
  quantidade numeric,
  unidade_uso text,
  custo_unitario numeric,
  custo_total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select v.tenant_id into v_tenant_id from public.veiculos v where v.id = p_veiculo;

  if not public.tem_papel(v_tenant_id, array['dono', 'gerente']::app_role[]) then
    return;
  end if;

  return query
  select
    e.id as execucao_id,
    e.finalizado_em as concluido_em,
    coalesce((
      select string_agg(s.nome, ', ')
      from public.agendamento_itens ai
      join public.servicos s on s.id = ai.servico_id
      where ai.agendamento_id = e.agendamento_id
    ), 'Serviço') as servicos_nomes,
    p.nome as produto_nome,
    p.marca as produto_marca,
    ec.quantidade,
    p.unidade_uso,
    ec.custo_unitario,
    ec.custo_total
  from public.execucoes e
  join public.agendamentos a on a.id = e.agendamento_id
  join public.execucao_consumos ec on ec.execucao_id = e.id
  join public.produtos p on p.id = ec.produto_id
  where a.veiculo_id = p_veiculo
  order by e.finalizado_em desc nulls last, ec.created_at desc;
end;
$$;


-- 7. ROW LEVEL SECURITY (RLS)

alter table public.produtos enable row level security;
alter table public.estoque_movimentos enable row level security;
alter table public.execucao_consumos enable row level security;

-- RLS Produtos: Leitura e Escrita apenas para Dono e Gerente
create policy "Dono e Gerente gerenciam produtos" on public.produtos
  for all using (
    public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[])
  ) with check (
    public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[])
  );

-- RLS Estoque Movimentos: Dono e Gerente
create policy "Dono e Gerente gerenciam estoque_movimentos" on public.estoque_movimentos
  for all using (
    public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[])
  ) with check (
    public.tem_papel(tenant_id, array['dono', 'gerente']::app_role[])
  );

-- RLS Execução Consumos: Todos os membros ativos do tenant
create policy "Membros ativos gerenciam execucao_consumos" on public.execucao_consumos
  for all using (
    tenant_id in (select public.meus_tenants())
  ) with check (
    tenant_id in (select public.meus_tenants())
  );

-- Permissões de Execução e Tabela
grant select, insert, update, delete on public.produtos to authenticated;
grant select, insert, update, delete on public.estoque_movimentos to authenticated;
grant select, insert, update, delete on public.execucao_consumos to authenticated;

grant execute on function public.registrar_entrada_estoque(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.registrar_consumo(uuid, jsonb) to authenticated;
grant execute on function public.sugerir_consumo(uuid) to authenticated;
grant execute on function public.ajustar_estoque(uuid, numeric, text) to authenticated;
grant execute on function public.produtos_em_alerta(uuid) to authenticated;
grant execute on function public.produtos_para_consumo(uuid) to authenticated;
grant execute on function public.historico_consumo_veiculo(uuid) to authenticated;
