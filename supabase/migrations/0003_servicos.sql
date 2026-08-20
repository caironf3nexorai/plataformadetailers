-- Migration 0003: Serviços, Preço por Categoria, Duração e Ocupação

-- 1. TABELAS

-- Serviços da Oficina
create table if not exists public.servicos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  grupo text not null default 'Geral',
  descricao_interna text,
  descricao_publica text,
  codigo text,
  tom text not null default 'vapor' check (tom in ('amber', 'glass', 'mint', 'vapor')),
  modo_ocupacao text not null default 'slot' check (modo_ocupacao in ('slot', 'dia_inteiro', 'multiplos_dias')),
  dias_ocupados integer not null default 1,
  publico boolean not null default false,
  sob_consulta boolean not null default false,
  foto_path text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, nome)
);

comment on column public.servicos.modo_ocupacao is 'modo_ocupacao define como o serviço bloqueia a agenda. slot ocupa apenas a duração; dia_inteiro bloqueia o dia; multiplos_dias bloqueia N dias. Vitrificação e correção de pintura normalmente não são slot.';

-- Matriz de Preço por Categoria de Veículo
create table if not exists public.servico_precos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  servico_id uuid not null references public.servicos(id) on delete cascade,
  categoria_id uuid not null references public.categorias_veiculo(id) on delete cascade,
  preco_base numeric(10,2),
  duracao_minutos integer not null default 60,
  duracao_confirmada boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (servico_id, categoria_id)
);

comment on column public.servico_precos.preco_base is 'preco_base é o piso mostrado como "a partir de". O valor final é definido na conferência do veículo e gravado no registro de execução, nunca aqui.';
comment on column public.servico_precos.duracao_confirmada is 'sinaliza se a duração foi confirmada pelo usuário. O semear inicia como false; edições manuais gravam true.';

-- Serviços Modelo (Catálogo pré-pronto global)
create table if not exists public.servicos_modelo (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  grupo text not null,
  descricao_publica text,
  codigo text not null unique,
  modo_ocupacao text not null default 'slot',
  duracao_sugerida integer not null default 60,
  ordem integer not null default 0
);

-- Seed de 13 Serviços Modelo
insert into public.servicos_modelo (codigo, nome, grupo, modo_ocupacao, duracao_sugerida, ordem, descricao_publica)
values
  ('LV-01', 'Lavagem Simples', 'Lavagem', 'slot', 40, 0, 'Lavagem externa detalhada e aspiração rápida.'),
  ('LV-02', 'Lavagem Detalhada', 'Lavagem', 'slot', 90, 1, 'Lavagem detalhada de pintura, caixa de rodas, motor e higienização interna primária.'),
  ('LV-03', 'Lavagem Técnica de Motor', 'Lavagem', 'slot', 60, 2, 'Limpeza técnica detalhada do motor com pincéis e proteção dos componentes eletrônicos.'),
  ('HG-01', 'Higienização Interna', 'Higienização', 'slot', 180, 3, 'Limpeza profunda de todo o interior do veículo, incluindo teto, colunas, painel e portas.'),
  ('HG-02', 'Higienização de Bancos', 'Higienização', 'slot', 120, 4, 'Extração de sujeira e manchas dos bancos de tecido ou limpeza e hidratação de bancos de couro.'),
  ('HG-03', 'Higienização de Ar-Condicionado', 'Higienização', 'slot', 45, 5, 'Higienização do sistema de ventilação com aplicação de oxi-sanitização ou spray específico.'),
  ('PL-01', 'Polimento Comercial', 'Polimento', 'slot', 240, 6, 'Eliminação de micro-riscos superficiais e devolução de brilho rápido para a pintura.'),
  ('PL-02', 'Polimento Técnico', 'Polimento', 'dia_inteiro', 480, 7, 'Polimento em múltiplas etapas para remoção de riscos médios e correção de imperfeições da pintura.'),
  ('PL-03', 'Correção de Pintura', 'Polimento', 'multiplos_dias', 960, 8, 'Correção profunda da pintura para eliminação de até 95% dos riscos e defeitos severos.'),
  ('VT-01', 'Cristalização de Vidros', 'Vidros', 'slot', 90, 9, 'Aplicação de repelente de água profissional para melhor visibilidade em dias de chuva.'),
  ('VT-09', 'Vitrificação de Pintura', 'Proteção', 'dia_inteiro', 480, 10, 'Proteção cerâmica de alta performance com durabilidade de até 3 anos contra agentes externos.'),
  ('PR-01', 'Cera de Proteção', 'Proteção', 'slot', 60, 11, 'Aplicação de cera premium de carnaúba ou sintética para brilho e proteção rápida da pintura.'),
  ('PR-02', 'Impermeabilização de Bancos', 'Proteção', 'slot', 120, 12, 'Aplicação de produto impermeabilizante de alta qualidade em bancos de tecido.')
on conflict (nome) do update set
  grupo = excluded.grupo,
  modo_ocupacao = excluded.modo_ocupacao,
  duracao_sugerida = excluded.duracao_sugerida,
  ordem = excluded.ordem,
  descricao_publica = excluded.descricao_publica;

-- 2. FUNÇÕES E PROCEDIMENTOS

-- Semear serviços a partir do catálogo modelo
drop function if exists public.semear_servicos(uuid[]);
create or replace function public.semear_servicos(p_modelo_ids uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_modelo record;
  v_servico_id uuid;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select tm.tenant_id into v_tenant_id
  from public.tenant_members tm
  where tm.user_id = auth.uid() and tm.status = 'ativo'
  limit 1;

  if v_tenant_id is null then
    raise exception 'Nenhum tenant ativo encontrado para o usuário.';
  end if;

  if not public.tem_papel(v_tenant_id, array['dono', 'gerente']::public.app_role[]) then
    raise exception 'Apenas o dono ou gerente podem gerenciar serviços.';
  end if;

  if array_length(p_modelo_ids, 1) is null or array_length(p_modelo_ids, 1) = 0 then
    return 0;
  end if;

  for v_modelo in
    select sm.nome, sm.grupo, sm.descricao_publica, sm.codigo, sm.modo_ocupacao, sm.duracao_sugerida, sm.ordem
    from public.servicos_modelo sm
    where sm.id = any(p_modelo_ids)
  loop
    -- Verifica se já existe serviço com o mesmo nome para o tenant
    select s.id into v_servico_id
    from public.servicos s
    where s.tenant_id = v_tenant_id and s.nome = v_modelo.nome;

    if v_servico_id is null then
      insert into public.servicos (
        tenant_id, nome, grupo, descricao_publica, codigo, modo_ocupacao, dias_ocupados, publico, sob_consulta, tom, ordem
      )
      values (
        v_tenant_id,
        v_modelo.nome,
        v_modelo.grupo,
        v_modelo.descricao_publica,
        v_modelo.codigo,
        v_modelo.modo_ocupacao,
        case when v_modelo.modo_ocupacao = 'multiplos_dias' then 2 else 1 end,
        false, -- publico default false
        false, -- sob_consulta default false
        'vapor',
        v_modelo.ordem
      )
      returning id into v_servico_id;

      v_count := v_count + 1;
    end if;

    -- Sincroniza os preços para esse serviço (mantém duracao_confirmada = false)
    perform public.sincronizar_precos_servico(v_servico_id);
  end loop;

  return v_count;
end;
$$;

grant execute on function public.semear_servicos(uuid[]) to authenticated;


-- Sincronizar preços do serviço
drop function if exists public.sincronizar_precos_servico(uuid);
create or replace function public.sincronizar_precos_servico(p_servico uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_categoria record;
  v_count integer := 0;
  v_duracao integer := 60;
  v_nome_servico text;
begin
  select s.tenant_id, s.nome into v_tenant_id, v_nome_servico from public.servicos s where s.id = p_servico;
  if v_tenant_id is null then
    raise exception 'Serviço não encontrado.';
  end if;

  -- Busca duração sugerida do modelo, se existir pelo nome do serviço
  select sm.duracao_sugerida into v_duracao
  from public.servicos_modelo sm
  where sm.nome = v_nome_servico
  limit 1;

  if v_duracao is null then
    v_duracao := 60;
  end if;

  -- Adiciona linhas de preço para todas as categorias ativas do tenant que não existam
  for v_categoria in
    select cv.id
    from public.categorias_veiculo cv
    where cv.tenant_id = v_tenant_id and cv.ativo = true
  loop
    insert into public.servico_precos (tenant_id, servico_id, categoria_id, preco_base, duracao_minutos, duracao_confirmada)
    values (v_tenant_id, p_servico, v_categoria.id, null, v_duracao, false)
    on conflict (servico_id, categoria_id) do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.sincronizar_precos_servico(uuid) to authenticated;


-- Salvar Matriz de Preços em lote
drop function if exists public.salvar_matriz_precos(uuid, jsonb);
create or replace function public.salvar_matriz_precos(p_servico uuid, p_linhas jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_linha jsonb;
  v_cat_id uuid;
  v_preco numeric(10,2);
  v_duracao integer;
  v_duracao_conf boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select s.tenant_id into v_tenant_id from public.servicos s where s.id = p_servico;
  if v_tenant_id is null then
    raise exception 'Serviço não encontrado.';
  end if;

  if not public.tem_papel(v_tenant_id, array['dono', 'gerente']::public.app_role[]) then
    raise exception 'Apenas o dono ou gerente podem salvar preços.';
  end if;

  for v_linha in select * from jsonb_array_elements(p_linhas) loop
    v_cat_id := (v_linha->>'categoria_id')::uuid;
    
    -- Trata preço nulo ou vazio
    if v_linha->>'preco_base' is null or trim(v_linha->>'preco_base') = '' then
      v_preco := null;
    else
      v_preco := (v_linha->>'preco_base')::numeric;
    end if;

    v_duracao := coalesce((v_linha->>'duracao_minutos')::integer, 60);
    
    -- Qualquer salvamento manual marca duracao_confirmada como true
    v_duracao_conf := coalesce((v_linha->>'duracao_confirmada')::boolean, true);

    -- Insere ou atualiza o preço para a categoria
    insert into public.servico_precos (tenant_id, servico_id, categoria_id, preco_base, duracao_minutos, duracao_confirmada)
    values (v_tenant_id, p_servico, v_cat_id, v_preco, v_duracao, v_duracao_conf)
    on conflict (servico_id, categoria_id) do update set
      preco_base = excluded.preco_base,
      duracao_minutos = excluded.duracao_minutos,
      duracao_confirmada = excluded.duracao_confirmada,
      updated_at = now();
  end loop;
end;
$$;

grant execute on function public.salvar_matriz_precos(uuid, jsonb) to authenticated;


-- 3. TRIGGER PARA NOVAS CATEGORIAS

create or replace function public.fn_sincronizar_nova_categoria()
returns trigger
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
begin
  -- Cria linhas de preços para a nova categoria em todos os serviços ativos do tenant com confirmada = false
  insert into public.servico_precos (tenant_id, servico_id, categoria_id, preco_base, duracao_minutos, duracao_confirmada)
  select s.tenant_id, s.id, new.id, null, 60, false
  from public.servicos s
  where s.tenant_id = new.tenant_id and s.ativo = true
  on conflict (servico_id, categoria_id) do nothing;
  
  return new;
end;
$$;

drop trigger if exists tg_sincronizar_nova_categoria on public.categorias_veiculo;
create trigger tg_sincronizar_nova_categoria
after insert on public.categorias_veiculo
for each row
execute function public.fn_sincronizar_nova_categoria();


-- 4. POLÍTICAS DE SEGURANÇA (RLS)

alter table public.servicos enable row level security;
alter table public.servico_precos enable row level security;
alter table public.servicos_modelo enable row level security;

-- Serviços
drop policy if exists "Serviços visíveis por membros do tenant" on public.servicos;
create policy "Serviços visíveis por membros do tenant" on public.servicos
  for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e Gerente gerenciam serviços" on public.servicos;
create policy "Dono e Gerente gerenciam serviços" on public.servicos
  for all using (tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Preços dos Serviços
drop policy if exists "Preços visíveis por membros do tenant" on public.servico_precos;
create policy "Preços visíveis por membros do tenant" on public.servico_precos
  for select using (tenant_id in (select meus_tenants()));

drop policy if exists "Dono e Gerente gerenciam preços" on public.servico_precos;
create policy "Dono e Gerente gerenciam preços" on public.servico_precos
  for all using (tem_papel(tenant_id, array['dono', 'gerente']::app_role[]));

-- Serviços Modelo
drop policy if exists "Leitura livre de modelos" on public.servicos_modelo;
create policy "Leitura livre de modelos" on public.servicos_modelo
  for select using (true);

-- Grants
grant select, insert, update on public.servicos to authenticated;
grant select, insert, update on public.servico_precos to authenticated;
grant select on public.servicos_modelo to authenticated;
