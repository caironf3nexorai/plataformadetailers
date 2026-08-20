-- Migration 0031: Corrigir salvar_nivel_orcamento para usar public.servico_precos

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

  -- Inserção dos itens com snapshot de preço e duração lidos de servico_precos
  if p_itens is not null and jsonb_array_length(p_itens) > 0 then
    for v_item in select * from jsonb_array_elements(p_itens)
    loop
      v_servico_id := (v_item->>'servico_id')::uuid;
      v_combo_id := nullif(v_item->>'combo_id', '')::uuid;

      if v_servico_id is not null then
        v_preco := null;
        v_duracao := null;

        -- Busca preço base e duração da categoria na servico_precos
        select sp.preco_base, sp.duracao_minutos into v_preco, v_duracao
        from public.servico_precos sp
        where sp.servico_id = v_servico_id
          and sp.categoria_id = v_orcamento_rec.categoria_id
          and (sp.ativo is true or sp.ativo is null);

        -- Fallbacks se nulo
        if v_preco is null then
          select s.preco_base into v_preco from public.servicos s where s.id = v_servico_id;
        end if;
        v_preco := coalesce(v_preco, 0);

        if v_duracao is null then
          select sc.duracao_minutos into v_duracao
          from public.servico_categorias sc
          where sc.servico_id = v_servico_id and sc.categoria_id = v_orcamento_rec.categoria_id;

          if v_duracao is null then
            select s.duracao_minutos into v_duracao from public.servicos s where s.id = v_servico_id;
          end if;
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
end;
$$;

grant execute on function public.salvar_nivel_orcamento(uuid, jsonb, text, text) to authenticated;
