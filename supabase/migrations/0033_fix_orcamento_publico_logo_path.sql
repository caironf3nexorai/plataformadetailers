-- Migration 0033: Corrigir t.logo_url para t.logo_path na RPC orcamento_publico

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

  -- Informações públicas da oficina (Usando logo_path e cidade/uf de public.tenants)
  select t.nome, t.logo_path, t.telefone, t.cidade, t.uf into v_tenant
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
      'nome', coalesce(v_tenant.nome, 'Oficina'),
      'logo_path', v_tenant.logo_path,
      'telefone', v_tenant.telefone,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf
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
