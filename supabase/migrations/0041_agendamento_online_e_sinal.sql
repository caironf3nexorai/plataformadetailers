-- Migration 0041: Agendamento Online e Sinal Pix Estático
-- 1. NOVAS COLUNAS NA TABELA TENANTS
alter table public.tenants
  add column if not exists agendamento_online_ativo boolean not null default true,
  add column if not exists agendamento_exige_confirmacao boolean not null default false,
  add column if not exists sinal_ativo boolean not null default false,
  add column if not exists sinal_tipo text not null default 'percentual' check (sinal_tipo in ('percentual', 'valor_fixo')),
  add column if not exists sinal_valor numeric(10,2) not null default 25.00,
  add column if not exists sinal_obrigatorio boolean not null default false,
  add column if not exists politica_cancelamento text,
  add column if not exists pix_chave text,
  add column if not exists pix_tipo text check (pix_tipo in ('cpf','cnpj','email','telefone','aleatoria')),
  add column if not exists pix_nome_beneficiario text,
  add column if not exists pix_cidade text;

-- 2. NOVAS COLUNAS E CONSTRAINT NA TABELA AGENDAMENTOS
alter table public.agendamentos
  add column if not exists sinal_valor numeric(10,2),
  add column if not exists sinal_status text not null default 'nao_aplicavel' check (sinal_status in ('nao_aplicavel', 'pendente', 'pago', 'dispensado')),
  add column if not exists sinal_pago_em timestamptz,
  add column if not exists confirmado_por uuid references auth.users(id),
  add column if not exists confirmado_em timestamptz;

-- Atualização da constraint agendamentos_status_check para incluir 'aguardando_confirmacao'
do $$
begin
  alter table public.agendamentos drop constraint if exists agendamentos_status_check;
  alter table public.agendamentos add constraint agendamentos_status_check
    check (status in ('agendado', 'aguardando_confirmacao', 'confirmado', 'em_andamento', 'concluido', 'cancelado'));
exception
  when others then null;
end;
$$;

-- 3. TABELA DE RATE-LIMITING DE AGENDAMENTOS ONLINE
create table if not exists public.agendamento_online_tentativas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  telefone text not null,
  created_at timestamptz default now()
);

alter table public.agendamento_online_tentativas enable row level security;

-- Política de RLS: apenas funções de backend/system leem ou escrevem
drop policy if exists "Agendamentos tentativas leitura" on public.agendamento_online_tentativas;
create policy "Agendamentos tentativas leitura" on public.agendamento_online_tentativas
  for all using (true) with check (true);

-- 4. FUNÇÃO PL/PGSQL PARA GERAÇÃO DO PAYLOAD PIX EMV ESTÁTICO COM CRC16-CCITT
create or replace function public.gerar_payload_pix(
  p_chave text,
  p_nome text,
  p_cidade text,
  p_valor numeric,
  p_txid text
)
returns text
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_chave text;
  v_nome text;
  v_cidade text;
  v_txid text;
  v_valor_str text;
  v_merchant_account text;
  v_additional_data text;
  v_raw_payload text;
  v_crc integer := 65535; -- 0xFFFF
  v_len integer;
  v_i integer;
  v_j integer;
  v_char_code integer;
  v_crc_hex text;
begin
  if p_chave is null or trim(p_chave) = '' then
    return null;
  end if;

  v_chave := trim(p_chave);

  -- Sanitização do Nome do Beneficiário (Caixa alta, sem acentos, máx 25 chars)
  v_nome := upper(translate(coalesce(trim(p_nome), 'OFICINA'), 
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 
    'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC'));
  v_nome := regexp_replace(v_nome, '[^A-Z0-9 ]', '', 'g');
  if length(v_nome) = 0 then v_nome := 'OFICINA'; end if;
  v_nome := substring(v_nome from 1 for 25);

  -- Sanitização da Cidade (Caixa alta, sem acentos, máx 15 chars)
  v_cidade := upper(translate(coalesce(trim(p_cidade), 'SAO PAULO'), 
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 
    'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC'));
  v_cidade := regexp_replace(v_cidade, '[^A-Z0-9 ]', '', 'g');
  if length(v_cidade) = 0 then v_cidade := 'SAO PAULO'; end if;
  v_cidade := substring(v_cidade from 1 for 15);

  -- Sanitização do TxID (máx 25 chars alfanuméricos)
  v_txid := upper(regexp_replace(coalesce(trim(p_txid), '***'), '[^A-Za-z0-9]', '', 'g'));
  if length(v_txid) = 0 then v_txid := '***'; end if;
  v_txid := substring(v_txid from 1 for 25);

  -- Formatação do Valor
  if p_valor is not null and p_valor > 0 then
    v_valor_str := trim(to_char(p_valor, 'FM9999990.00'));
  else
    v_valor_str := null;
  end if;

  -- Construção dos Blocos EMV
  -- Sub-bloco 26 (Merchant Account Info)
  v_merchant_account := '0014br.gov.bcb.pix' || '01' || lpad(length(v_chave)::text, 2, '0') || v_chave;
  
  -- Sub-bloco 62 (Additional Data Template / TxID)
  v_additional_data := '05' || lpad(length(v_txid)::text, 2, '0') || v_txid;

  -- Montagem da String EMV (até antes do CRC "6304")
  v_raw_payload := '000201' ||
    '26' || lpad(length(v_merchant_account)::text, 2, '0') || v_merchant_account ||
    '52040000' ||
    '5303986';

  if v_valor_str is not null then
    v_raw_payload := v_raw_payload || '54' || lpad(length(v_valor_str)::text, 2, '0') || v_valor_str;
  end if;

  v_raw_payload := v_raw_payload ||
    '5802BR' ||
    '59' || lpad(length(v_nome)::text, 2, '0') || v_nome ||
    '60' || lpad(length(v_cidade)::text, 2, '0') || v_cidade ||
    '62' || lpad(length(v_additional_data)::text, 2, '0') || v_additional_data ||
    '6304';

  -- Algoritmo CRC16-CCITT (Polinômio 0x1021 / Inicial 0xFFFF)
  v_len := length(v_raw_payload);
  for v_i in 1..v_len loop
    v_char_code := ascii(substring(v_raw_payload from v_i for 1));
    v_crc := v_crc # (v_char_code * 256);
    for v_j in 1..8 loop
      if (v_crc & 32768) <> 0 then -- 0x8000 = 32768
        v_crc := ((v_crc * 2) & 65535) # 4129; -- 0x1021 = 4129, 0xFFFF = 65535
      else
        v_crc := (v_crc * 2) & 65535;
      end if;
    end loop;
  end loop;

  v_crc_hex := lpad(upper(to_hex(v_crc)), 4, '0');
  return v_raw_payload || v_crc_hex;
end;
$$;

grant execute on function public.gerar_payload_pix(text, text, text, numeric, text) to anon, authenticated;


-- 5. DROPS DE SEGURANÇA DAS RPCS PÚBLICAS E ADMINISTRATIVAS DE AGENDAMENTO ONLINE
drop function if exists public.catalogo_agendamento(text);
drop function if exists public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text);
drop function if exists public.confirmar_agendamento_online(uuid);
drop function if exists public.recusar_agendamento_online(uuid, text);
drop function if exists public.registrar_sinal_pago(uuid);
drop function if exists public.expirar_sinais_pendentes(uuid);


-- 6. RPC CATALOGO_AGENDAMENTO (Pública)
create or replace function public.catalogo_agendamento(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_categorias jsonb;
  v_servicos jsonb;
  v_combos jsonb;
begin
  select t.* into v_tenant
  from public.tenants t
  where t.slug = p_slug;

  if not found then
    return jsonb_build_object('erro', 'Oficina não encontrada');
  end if;

  -- Categorias ativas
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'nome', c.nome,
      'descricao', c.descricao,
      'ordem', c.ordem
    ) order by c.ordem asc
  ), '[]'::jsonb)
  into v_categorias
  from public.categorias_veiculo c
  where c.tenant_id = v_tenant.id and c.ativo = true;

  -- Serviços ativos
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'nome', s.nome,
      'descricao_publica', s.descricao_publica,
      'modo_ocupacao', s.modo_ocupacao,
      'dias_ocupados', s.dias_ocupados,
      'precos', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'categoria_id', sp.categoria_id,
            'preco_base', sp.preco_base,
            'duracao_minutos', sp.duracao_minutos
          )
        ), '[]'::jsonb)
        from public.servico_precos sp
        where sp.servico_id = s.id and sp.ativo = true
      )
    ) order by s.nome asc
  ), '[]'::jsonb)
  into v_servicos
  from public.servicos s
  where s.tenant_id = v_tenant.id and s.ativo = true;

  -- Combos ativos
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', cb.id,
      'nome', cb.nome,
      'descricao_publica', cb.descricao_publica,
      'codigo', cb.codigo,
      'foto_path', cb.foto_path
    ) order by cb.nome asc
  ), '[]'::jsonb)
  into v_combos
  from public.combos cb
  where cb.tenant_id = v_tenant.id and cb.ativo = true;

  return jsonb_build_object(
    'oficina', jsonb_build_object(
      'id', v_tenant.id,
      'nome', v_tenant.nome,
      'slug', v_tenant.slug,
      'logo_path', v_tenant.logo_path,
      'telefone', v_tenant.telefone,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'agendamento_online_ativo', coalesce(v_tenant.agendamento_online_ativo, true),
      'agendamento_exige_confirmacao', coalesce(v_tenant.agendamento_exige_confirmacao, false),
      'antecedencia_minima_horas', coalesce(v_tenant.antecedencia_minima_horas, 2),
      'sinal_ativo', coalesce(v_tenant.sinal_ativo, false),
      'sinal_tipo', coalesce(v_tenant.sinal_tipo, 'percentual'),
      'sinal_valor', coalesce(v_tenant.sinal_valor, 25.00),
      'sinal_obrigatorio', coalesce(v_tenant.sinal_obrigatorio, false),
      'politica_cancelamento', v_tenant.politica_cancelamento,
      'pix_chave', v_tenant.pix_chave,
      'pix_tipo', v_tenant.pix_tipo,
      'pix_nome_beneficiario', v_tenant.pix_nome_beneficiario,
      'pix_cidade', v_tenant.pix_cidade
    ),
    'categorias', v_categorias,
    'servicos', v_servicos,
    'combos', v_combos
  );
end;
$$;

grant execute on function public.catalogo_agendamento(text) to anon, authenticated;


-- 7. RPC AGENDAR_ONLINE (Pública com Validação Estrita & Rate Limiting)
create or replace function public.agendar_online(
  p_slug text,
  p_nome text,
  p_telefone text,
  p_placa text,
  p_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tenant record;
  v_tel_limpo text;
  v_placa_limpa text;
  v_tentativas integer;
  v_min_inicio timestamptz;
  v_max_inicio timestamptz;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_agendamento_id uuid;
  v_servico_id_primeiro uuid;
  v_modo_item text;
  v_dias_item smallint;
  v_item jsonb;
  v_duracao_item integer;
  v_preco_item numeric(10,2);
  v_modo_item_loop text;
  v_dias_item_loop integer;
  v_ordem smallint := 1;
  v_total_calculado numeric(10,2) := 0;
  v_duracao_total_calculada integer := 0;
  v_status_inicial text;
  v_sinal_valor_calc numeric(10,2) := 0;
  v_sinal_status_final text := 'nao_aplicavel';
  v_os_num integer;
  v_pix_payload text := null;
  v_agendamento_rec record;
begin
  -- 1. Localiza o tenant pelo slug
  select t.* into v_tenant from public.tenants t where t.slug = p_slug;
  if not found then
    raise exception 'Oficina não encontrada.';
  end if;

  if not coalesce(v_tenant.agendamento_online_ativo, true) then
    raise exception 'O agendamento online está desativado para esta oficina no momento.';
  end if;

  -- 2. Sanitização e Validações das Entradas
  if length(trim(coalesce(p_nome, ''))) < 3 then
    raise exception 'Por favor, informe seu nome completo (pelo menos 3 caracteres).';
  end if;

  v_tel_limpo := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
  if length(v_tel_limpo) not in (10, 11) then
    raise exception 'Por favor, informe um número de telefone/WhatsApp válido com DDD (10 ou 11 dígitos).';
  end if;

  if p_placa is not null and trim(p_placa) <> '' then
    v_placa_limpa := upper(regexp_replace(trim(p_placa), '[^A-Za-z0-9]', '', 'g'));
    if not (v_placa_limpa ~ '^[A-Z]{3}[0-9]{4}$' or v_placa_limpa ~ '^[A-Z]{3}[0-9][A-Z][0-9]{2}$') then
      raise exception 'A placa informada é inválida. Use o formato AAA9999 ou AAA9A99.';
    end if;
  else
    v_placa_limpa := null;
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'Selecione ao menos um serviço para agendar.';
  end if;

  if jsonb_array_length(p_itens) > 10 then
    raise exception 'Não é possível agendar mais de 10 serviços simultaneamente.';
  end if;

  v_min_inicio := now() + (coalesce(v_tenant.antecedencia_minima_horas, 2) || ' hours')::interval;
  if p_inicio < v_min_inicio then
    raise exception 'O horário escolhido deve ter antecedência mínima de % horas.', coalesce(v_tenant.antecedencia_minima_horas, 2);
  end if;

  v_max_inicio := now() + interval '90 days';
  if p_inicio > v_max_inicio then
    raise exception 'Agendamentos online só podem ser realizados para os próximos 90 dias.';
  end if;

  -- 3. Rate-limiting por Telefone (Máximo 5 agendamentos por telefone em 24h)
  select count(*) into v_tentativas
  from public.agendamento_online_tentativas
  where tenant_id = v_tenant.id
    and telefone = v_tel_limpo
    and created_at >= (now() - interval '24 hours');

  if v_tentativas >= 5 then
    raise exception 'Muitos agendamentos hoje. Entre em contato com a oficina.';
  end if;

  -- 4. Cliente: busca por telefone no tenant ou cria novo
  select id into v_cliente_id
  from public.clientes
  where tenant_id = v_tenant.id and regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') = v_tel_limpo
  limit 1;

  if v_cliente_id is null then
    insert into public.clientes (
      tenant_id, nome, telefone, origem
    ) values (
      v_tenant.id, trim(p_nome), v_tel_limpo, 'online'
    ) returning id into v_cliente_id;
  end if;

  -- 5. Veículo: se placa informada, busca ou cria
  if v_placa_limpa is not null then
    select id into v_veiculo_id
    from public.veiculos
    where tenant_id = v_tenant.id and placa = v_placa_limpa
    limit 1;

    if v_veiculo_id is null then
      insert into public.veiculos (
        tenant_id, cliente_id, placa, modelo
      ) values (
        v_tenant.id, v_cliente_id, v_placa_limpa, trim(coalesce(p_modelo, 'Veículo'))
      ) returning id into v_veiculo_id;
    end if;
  end if;

  -- 6. Lock Transacional por Tenant e Data para evitar corridas
  v_data := (p_inicio at time zone 'America/Sao_Paulo')::date;
  v_hora := date_trunc('minute', (p_inicio at time zone 'America/Sao_Paulo'))::time;
  perform pg_advisory_xact_lock(hashtext(v_tenant.id::text), hashtext(v_data::text));

  -- Primeiro serviço do agendamento
  v_servico_id_primeiro := (p_itens->0->>'servico_id')::uuid;

  -- 7. Revalidação de disponibilidade estrita
  select disponivel into v_is_disponivel
  from public.horarios_disponiveis(
    v_tenant.id,
    v_data,
    v_servico_id_primeiro,
    p_categoria,
    null
  ) hd
  where hd.horario = v_hora;

  if not coalesce(v_is_disponivel, false) then
    raise exception 'O horário selecionado não está mais disponível. Por favor, escolha outro horário.';
  end if;

  -- Busca modo de ocupação do primeiro serviço
  select coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
  into v_modo_item, v_dias_item
  from public.servicos s where s.id = v_servico_id_primeiro;

  -- Status inicial baseado na configuração de confirmação
  if coalesce(v_tenant.agendamento_exige_confirmacao, false) then
    v_status_inicial := 'aguardando_confirmacao';
  else
    v_status_inicial := 'agendado';
  end if;

  -- 8. Insere o Agendamento (numero_os é atribuído via trigger trg_garantir_numero_os se não informado)
  insert into public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    categoria_id,
    servico_id,
    origem,
    status,
    inicio,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    observacoes
  ) values (
    v_tenant.id,
    v_cliente_id,
    v_veiculo_id,
    p_categoria,
    v_servico_id_primeiro,
    'online',
    v_status_inicial,
    p_inicio,
    60,
    60,
    coalesce(v_modo_item, 'slot'),
    coalesce(v_modo_item, 'slot'),
    coalesce(v_dias_item, 1),
    0.00,
    0.00,
    coalesce(trim(p_observacoes), '')
  ) returning id, numero_os into v_agendamento_id, v_os_num;

  -- 9. Insere os Itens do Agendamento
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select 
      coalesce(sp.duracao_minutos, 60),
      coalesce(sp.preco_base, 0.00),
      s.modo_ocupacao,
      coalesce(s.dias_ocupados, 1)
    into v_duracao_item, v_preco_item, v_modo_item_loop, v_dias_item_loop
    from public.servicos s
    left join public.servico_precos sp 
      on sp.servico_id = s.id 
     and sp.categoria_id = p_categoria 
     and sp.ativo = true
    where s.id = (v_item->>'servico_id')::uuid;

    insert into public.agendamento_itens (
      tenant_id,
      agendamento_id,
      servico_id,
      combo_id,
      duracao_minutos,
      preco_estimado,
      modo_ocupacao,
      dias_ocupados,
      ordem
    ) values (
      v_tenant.id,
      v_agendamento_id,
      (v_item->>'servico_id')::uuid,
      nullif(v_item->>'combo_id', '')::uuid,
      v_duracao_item,
      v_preco_item,
      coalesce(v_modo_item_loop, 'slot'),
      coalesce(v_dias_item_loop, 1),
      v_ordem
    );

    v_ordem := v_ordem + 1;
  end loop;

  -- Recalcula totais do agendamento
  perform public.recalcular_agendamento_totais(v_agendamento_id);

  -- 10. Cálculo de Sinal Pix (se ativo no tenant)
  select preco_estimado_total into v_total_calculado
  from public.agendamentos where id = v_agendamento_id;

  if coalesce(v_tenant.sinal_ativo, false) and v_total_calculado > 0 then
    if v_tenant.sinal_tipo = 'percentual' then
      v_sinal_valor_calc := round(v_total_calculado * (coalesce(v_tenant.sinal_valor, 25.00) / 100.0), 2);
    else
      v_sinal_valor_calc := least(v_total_calculado, coalesce(v_tenant.sinal_valor, 0.00));
    end if;

    v_sinal_status_final := 'pendente';

    -- Gera o Payload Pix EMV no Servidor se houver chave cadastrada
    if v_tenant.pix_chave is not null and trim(v_tenant.pix_chave) <> '' then
      v_pix_payload := public.gerar_payload_pix(
        v_tenant.pix_chave,
        v_tenant.pix_nome_beneficiario,
        v_tenant.pix_cidade,
        v_sinal_valor_calc,
        'OS' || lpad(v_os_num::text, 4, '0')
      );
    end if;

    update public.agendamentos
    set sinal_valor = v_sinal_valor_calc,
        sinal_status = v_sinal_status_final
    where id = v_agendamento_id;
  end if;

  -- Registra a tentativa para rate-limiting
  insert into public.agendamento_online_tentativas (tenant_id, telefone)
  values (v_tenant.id, v_tel_limpo);

  -- Retorna JSONB completo para a tela de confirmação
  select a.* into v_agendamento_rec from public.agendamentos a where a.id = v_agendamento_id;

  return jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_agendamento_rec.status,
    'inicio', v_agendamento_rec.inicio,
    'duracao_total', v_agendamento_rec.duracao_total,
    'preco_estimado_total', v_agendamento_rec.preco_estimado_total,
    'sinal', jsonb_build_object(
      'ativo', coalesce(v_tenant.sinal_ativo, false),
      'obrigatorio', coalesce(v_tenant.sinal_obrigatorio, false),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_chave', v_tenant.pix_chave,
      'pix_tipo', v_tenant.pix_tipo,
      'pix_nome_beneficiario', v_tenant.pix_nome_beneficiario,
      'pix_cidade', v_tenant.pix_cidade,
      'pix_payload', v_pix_payload
    ),
    'oficina', jsonb_build_object(
      'nome', v_tenant.nome,
      'telefone', v_tenant.telefone,
      'politica_cancelamento', v_tenant.politica_cancelamento
    )
  );
end;
$$;

grant execute on function public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text) to anon, authenticated;


-- 8. RPC CONFIRMAR_AGENDAMENTO_ONLINE (Gestão)
create or replace function public.confirmar_agendamento_online(p_agendamento uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select a.* into v_agendamento from public.agendamentos a where a.id = p_agendamento;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  update public.agendamentos
  set status = 'agendado',
      confirmado_por = auth.uid(),
      confirmado_em = now(),
      updated_at = now()
  where id = p_agendamento;
end;
$$;

grant execute on function public.confirmar_agendamento_online(uuid) to authenticated;


-- 9. RPC RECUSAR_AGENDAMENTO_ONLINE (Gestão)
create or replace function public.recusar_agendamento_online(p_agendamento uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select a.* into v_agendamento from public.agendamentos a where a.id = p_agendamento;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  update public.agendamentos
  set status = 'cancelado',
      observacoes = coalesce(observacoes, '') || case when p_motivo is not null then ' [Recusado: ' || trim(p_motivo) || ']' else ' [Recusado pela oficina]' end,
      updated_at = now()
  where id = p_agendamento;
end;
$$;

grant execute on function public.recusar_agendamento_online(uuid, text) to authenticated;


-- 10. RPC REGISTRAR_SINAL_PAGO (Gestão)
create or replace function public.registrar_sinal_pago(p_agendamento uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select a.* into v_agendamento from public.agendamentos a where a.id = p_agendamento;
  if not found then
    raise exception 'Agendamento não encontrado.';
  end if;

  if not public.tem_papel(v_agendamento.tenant_id, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado.';
  end if;

  update public.agendamentos
  set sinal_status = 'pago',
      sinal_pago_em = now(),
      updated_at = now()
  where id = p_agendamento;
end;
$$;

grant execute on function public.registrar_sinal_pago(uuid) to authenticated;


-- 11. RPC EXPIRAR_SINAIS_PENDENTES (Executada ao carregar a tela Hoje)
create or replace function public.expirar_sinais_pendentes(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if not (p_tenant in (select meus_tenants())) then
    raise exception 'Acesso negado.';
  end if;

  -- Cancela agendamentos onde o sinal é OBRIGATÓRIO, está PENDENTE e tem mais de 24 horas da criação
  update public.agendamentos a
  set status = 'cancelado',
      sinal_status = 'dispensado',
      observacoes = coalesce(a.observacoes, '') || ' [Cancelado automaticamente: Sinal obrigatório não pago em 24h]',
      updated_at = now()
  from public.tenants t
  where a.tenant_id = p_tenant
    and t.id = a.tenant_id
    and t.sinal_obrigatorio = true
    and a.sinal_status = 'pendente'
    and a.status in ('agendado', 'aguardando_confirmacao')
    and a.created_at < (now() - interval '24 hours');
end;
$$;

grant execute on function public.expirar_sinais_pendentes(uuid) to authenticated;


-- 12. NOTIFICA POSTGREST
notify pgrst, 'reload schema';
