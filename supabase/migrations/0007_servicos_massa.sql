-- Migration 0007: Ações em Massa para Serviços

create or replace function public.atualizar_servicos_em_massa(
  p_ids uuid[],
  p_campo text,
  p_valor boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_count integer;
  v_matching_count integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null or array_length(p_ids, 1) = 0 then
    return 0;
  end if;

  if p_campo not in ('ativo', 'publico') then
    raise exception 'Campo inválido para atualização em massa. Use apenas "ativo" ou "publico".';
  end if;

  -- Obter tenant do primeiro id
  select tenant_id into v_tenant
  from public.servicos
  where id = p_ids[1];

  if v_tenant is null then
    raise exception 'Nenhum serviço encontrado para os IDs fornecidos.';
  end if;

  if not public.tem_papel(v_tenant, array['dono', 'gerente']::app_role[]) then
    raise exception 'Acesso negado. Apenas dono e gerente podem realizar alterações em massa.';
  end if;

  -- Valida que TODOS os ids pertencem ao tenant do usuário
  select count(*) into v_matching_count
  from public.servicos
  where id = any(p_ids) and tenant_id = v_tenant;

  if v_matching_count <> array_length(p_ids, 1) then
    raise exception 'Operação cancelada: nem todos os serviços pertencem ao mesmo tenant ou alguns IDs são inválidos.';
  end if;

  if p_campo = 'ativo' then
    update public.servicos
    set ativo = p_valor,
        updated_at = now()
    where id = any(p_ids) and tenant_id = v_tenant;
    get diagnostics v_count = row_count;
  elsif p_campo = 'publico' then
    update public.servicos
    set publico = p_valor,
        updated_at = now()
    where id = any(p_ids) and tenant_id = v_tenant;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

grant execute on function public.atualizar_servicos_em_massa(uuid[], text, boolean) to authenticated;
