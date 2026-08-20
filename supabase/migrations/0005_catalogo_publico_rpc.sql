-- Migration 0005: RPC para Catálogo Público e Atualização Segura de Slug

-- 1. FUNÇÃO ÚNICA DE LEITURA PÚBLICA DO CATÁLOGO (security definer)
create or replace function public.catalogo_publico(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare 
  v_tenant tenants; 
  v_result jsonb;
begin
  select * into v_tenant from tenants where slug = lower(trim(p_slug));
  if not found then 
    return null; 
  end if;

  select jsonb_build_object(
    'oficina', jsonb_build_object(
      'nome', v_tenant.nome,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'telefone', v_tenant.telefone,
      'capa_path', v_tenant.capa_path
    ),
    'categorias', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'descricao', c.descricao
      ) order by c.ordem), '[]'::jsonb)
      from categorias_veiculo c
      where c.tenant_id = v_tenant.id and c.ativo
    ),
    'servicos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'nome', s.nome, 'grupo', s.grupo,
        'codigo', s.codigo, 'tom', s.tom,
        'descricao_publica', s.descricao_publica,
        'sob_consulta', s.sob_consulta,
        'foto_path', s.foto_path,
        'precos', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'categoria_id', sp.categoria_id,
            'preco_base', sp.preco_base
          )), '[]'::jsonb)
          from servico_precos sp
          where sp.servico_id = s.id and sp.ativo
        )
      ) order by s.grupo, s.ordem), '[]'::jsonb)
      from servicos s
      where s.tenant_id = v_tenant.id and s.ativo and s.publico
    ),
    'grupo_fotos', (
      select coalesce(jsonb_object_agg(g.grupo_slug, g.foto_path), '{}'::jsonb)
      from tenant_grupo_fotos g where g.tenant_id = v_tenant.id
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.catalogo_publico(text) to anon, authenticated;

-- 2. FUNÇÃO SEGUIRA PARA ATUALIZAÇÃO DE SLUG DA OFICINA
create or replace function public.atualizar_slug(p_tenant uuid, p_novo_slug text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_slug_limpo text;
  v_reservados text[] := array['entrar', 'criar-conta', 'calculadora', 'agendar', 'admin', 'api', 'app', 'configuracoes'];
  v_existe boolean;
begin
  -- Valida se o usuário pertence ao tenant especificado
  if not (p_tenant in (select meus_tenants())) then
    raise exception 'Acesso negado: oficina inválida.';
  end if;

  -- Valida se o usuário tem papel 'dono' na oficina
  if not public.tem_papel(p_tenant, array['dono']::app_role[]) then
    raise exception 'Apenas o dono da oficina pode alterar o endereço (slug).';
  end if;

  v_slug_limpo := lower(trim(p_novo_slug));

  -- Valida comprimento (3 a 40 caracteres)
  if length(v_slug_limpo) < 3 or length(v_slug_limpo) > 40 then
    raise exception 'O endereço deve ter entre 3 e 40 caracteres.';
  end if;

  -- Valida formato (apenas letras minúsculas, números e hífens, sem hífen no início ou fim)
  if not (v_slug_limpo ~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'O endereço pode conter apenas letras minúsculas, números e hífens, sem hífens no início ou fim.';
  end if;

  -- Valida lista de palavras reservadas
  if v_slug_limpo = any(v_reservados) then
    raise exception 'Este endereço é reservado pelo sistema e não pode ser utilizado.';
  end if;

  -- Valida unicidade na tabela tenants
  select exists(
    select 1 from tenants where slug = v_slug_limpo and id <> p_tenant
  ) into v_existe;

  if v_existe then
    raise exception 'Este endereço já está em uso por outra oficina.';
  end if;

  -- Atualiza o slug
  update tenants 
  set slug = v_slug_limpo, updated_at = now() 
  where id = p_tenant;

  return v_slug_limpo;
end;
$$;

grant execute on function public.atualizar_slug(uuid, text) to authenticated;
