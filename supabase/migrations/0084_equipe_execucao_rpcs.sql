-- ==============================================================================
-- Migração 0084: Equipe na Execução - Listagem, Auto-Atribuição e Remoção de Executores
-- ==============================================================================

-- 1. DROP DE FUNÇÕES ANTIGAS PARA EVITAR SOBRECARGAS / PGRST203
DROP FUNCTION IF EXISTS public.listar_membros_execucao(uuid);
DROP FUNCTION IF EXISTS public.remover_executor_execucao(uuid, uuid);
DROP FUNCTION IF EXISTS public.adicionar_executor_execucao(uuid, uuid);
DROP FUNCTION IF EXISTS public.iniciar_execucao(uuid);

-- 2. RPC LISTAR MEMBROS DA EXECUÇÃO
CREATE OR REPLACE FUNCTION public.listar_membros_execucao(
  p_execucao_id uuid
)
RETURNS TABLE (
  member_id uuid,
  rotulo text,
  email text,
  papel text,
  status text,
  ja_executor boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Derivar tenant_id da execução
  SELECT e.tenant_id INTO v_tenant_id
  FROM public.execucoes e
  WHERE e.id = p_execucao_id;

  -- Validação imediata de tenant e acesso (anti-sondagem)
  IF v_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.meus_tenants() t WHERE t = v_tenant_id) THEN
    RAISE EXCEPTION 'sem acesso';
  END IF;

  RETURN QUERY
  SELECT
    tm.id AS member_id,
    tm.email AS rotulo,
    tm.email AS email,
    tm.role::text AS papel,
    tm.status::text AS status,
    EXISTS (
      SELECT 1
      FROM public.execucao_executores ee
      WHERE ee.execucao_id = p_execucao_id
        AND ee.member_id = tm.id
    ) AS ja_executor
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant_id
    AND tm.status <> 'inativo'
  ORDER BY
    CASE WHEN tm.role = 'dono' THEN 1 WHEN tm.role = 'gerente' THEN 2 ELSE 3 END,
    tm.email ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.listar_membros_execucao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.listar_membros_execucao(uuid) TO authenticated;


-- 3. RPC REMOVER EXECUTOR DA EXECUÇÃO
CREATE OR REPLACE FUNCTION public.remover_executor_execucao(
  p_execucao_id uuid,
  p_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_status text;
  v_era_principal boolean := false;
BEGIN
  -- Derivar tenant e status da execução
  SELECT e.tenant_id, e.status INTO v_tenant_id, v_status
  FROM public.execucoes e
  WHERE e.id = p_execucao_id;

  -- Validação imediata de tenant e acesso (anti-sondagem de UUIDs)
  IF v_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.meus_tenants() t WHERE t = v_tenant_id) THEN
    RAISE EXCEPTION 'sem acesso';
  END IF;

  -- Bloquear remoção se atendimento já foi finalizado
  IF v_status = 'finalizado' THEN
    RAISE EXCEPTION 'Não é possível remover executores de um atendimento já finalizado';
  END IF;

  -- Verificar se o executor a remover é o principal
  SELECT ee.principal INTO v_era_principal
  FROM public.execucao_executores ee
  WHERE ee.execucao_id = p_execucao_id
    AND ee.member_id = p_member_id;

  -- Deletar o executor
  DELETE FROM public.execucao_executores
  WHERE execucao_id = p_execucao_id
    AND member_id = p_member_id;

  -- Se era o principal e ainda restam executores, promover o mais antigo restante a principal
  IF v_era_principal IS TRUE THEN
    UPDATE public.execucao_executores
    SET principal = true
    WHERE id = (
      SELECT id
      FROM public.execucao_executores
      WHERE execucao_id = p_execucao_id
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remover_executor_execucao(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remover_executor_execucao(uuid, uuid) TO authenticated;


-- 4. RPC ADICIONAR EXECUTOR NA EXECUÇÃO
CREATE OR REPLACE FUNCTION public.adicionar_executor_execucao(
  p_execucao_id uuid,
  p_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_status text;
  v_comissao_tipo public.comissao_tipo;
  v_comissao_valor numeric(10,2);
  v_hoje_sp date;
BEGIN
  -- Derivar tenant e status da execução
  SELECT e.tenant_id, e.status INTO v_tenant_id, v_status
  FROM public.execucoes e
  WHERE e.id = p_execucao_id;

  -- Validação imediata de tenant e acesso (anti-sondagem de UUIDs)
  IF v_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.meus_tenants() t WHERE t = v_tenant_id) THEN
    RAISE EXCEPTION 'sem acesso';
  END IF;

  -- Bloquear adição se atendimento já foi finalizado
  IF v_status = 'finalizado' THEN
    RAISE EXCEPTION 'Não é possível adicionar executores a um atendimento já finalizado';
  END IF;

  -- Validar se o membro pertence ao tenant e não está inativo
  IF NOT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.id = p_member_id
      AND tm.tenant_id = v_tenant_id
      AND tm.status <> 'inativo'
  ) THEN
    RAISE EXCEPTION 'membro inválido';
  END IF;

  -- Fuso horário oficial de Brasília
  v_hoje_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- Resolver regra de comissão vigente do membro
  SELECT cr.tipo, cr.valor
  INTO v_comissao_tipo, v_comissao_valor
  FROM public.comissao_regras cr
  WHERE cr.tenant_id = v_tenant_id
    AND cr.member_id = p_member_id
    AND (cr.vigencia_inicio <= v_hoje_sp)
    AND (cr.vigencia_fim IS NULL OR cr.vigencia_fim >= v_hoje_sp)
  ORDER BY cr.vigencia_inicio DESC, cr.created_at DESC
  LIMIT 1;

  -- Inserir executor (se primeiro, vira principal)
  INSERT INTO public.execucao_executores (
    tenant_id,
    execucao_id,
    member_id,
    principal,
    comissao_tipo,
    comissao_valor,
    comissao_calculada
  ) VALUES (
    v_tenant_id,
    p_execucao_id,
    p_member_id,
    NOT EXISTS (SELECT 1 FROM public.execucao_executores WHERE execucao_id = p_execucao_id),
    COALESCE(v_comissao_tipo, 'nenhuma'::public.comissao_tipo),
    COALESCE(v_comissao_valor, 0),
    0
  )
  ON CONFLICT (execucao_id, member_id) DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adicionar_executor_execucao(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.adicionar_executor_execucao(uuid, uuid) TO authenticated;


-- 5. ATUALIZAR iniciar_execucao COM SEGURANÇA REFORÇADA, BLOQUEIO DE REABERTURA E RETOMADA LIMPA
CREATE OR REPLACE FUNCTION public.iniciar_execucao(p_agendamento uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_now timestamptz := now();
  v_hoje_sp date;
  v_exec_id uuid;
  v_exec_status text;
  v_item record;
  v_citem record;
  v_current_member_id uuid;
  v_comissao_tipo public.comissao_tipo;
  v_comissao_valor numeric(10,2);
BEGIN
  -- 1. Buscar tenant_id do agendamento
  SELECT a.tenant_id INTO v_tenant_id
  FROM public.agendamentos a
  WHERE a.id = p_agendamento;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  -- Validação de segurança de tenant antes de qualquer mutação
  IF NOT EXISTS (SELECT 1 FROM public.meus_tenants() t WHERE t = v_tenant_id) THEN
    RAISE EXCEPTION 'sem acesso';
  END IF;

  -- Fuso horário de Brasília
  v_hoje_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- 2. Localizar execução existente
  SELECT id, status INTO v_exec_id, v_exec_status
  FROM public.execucoes
  WHERE agendamento_id = p_agendamento;

  IF v_exec_id IS NOT NULL THEN
    -- D2: Bloquear reabertura indevida de serviço já finalizado
    IF v_exec_status = 'finalizado' THEN
      RAISE EXCEPTION 'Este atendimento já foi finalizado.';
    ELSIF v_exec_status = 'pausado' THEN
      -- D3: Retomar execução através da RPC canônica dedicada
      PERFORM public.retomar_execucao(v_exec_id);
    ELSE
      -- Em andamento: Apenas atualiza updated_at preservando todos os custos e descontos
      UPDATE public.execucoes
      SET status = 'em_andamento',
          updated_at = v_now
      WHERE id = v_exec_id;
    END IF;
  ELSE
    INSERT INTO public.execucoes (
      tenant_id,
      agendamento_id,
      status,
      iniciado_em,
      contando_desde,
      segundos_trabalhados,
      segundos_pausados
    ) VALUES (
      v_tenant_id,
      p_agendamento,
      'em_andamento',
      v_now,
      v_now,
      0,
      0
    ) RETURNING id INTO v_exec_id;
  END IF;

  -- 3. Atualizar status do agendamento
  UPDATE public.agendamentos
  SET status = 'em_andamento',
      updated_at = v_now
  WHERE id = p_agendamento;

  -- 4. AUTO-ATRIBUIÇÃO DO USUÁRIO LOGADO COMO EXECUTOR PRINCIPAL
  IF auth.uid() IS NOT NULL THEN
    SELECT tm.id INTO v_current_member_id
    FROM public.tenant_members tm
    WHERE tm.tenant_id = v_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status <> 'inativo'
    LIMIT 1;

    IF v_current_member_id IS NOT NULL THEN
      -- Buscar regra de comissão vigente no fuso de São Paulo
      SELECT cr.tipo, cr.valor
      INTO v_comissao_tipo, v_comissao_valor
      FROM public.comissao_regras cr
      WHERE cr.tenant_id = v_tenant_id
        AND cr.member_id = v_current_member_id
        AND (cr.vigencia_inicio <= v_hoje_sp)
        AND (cr.vigencia_fim IS NULL OR cr.vigencia_fim >= v_hoje_sp)
      ORDER BY cr.vigencia_inicio DESC, cr.created_at DESC
      LIMIT 1;

      -- Inserir executor na execução (se não existir)
      INSERT INTO public.execucao_executores (
        tenant_id,
        execucao_id,
        member_id,
        principal,
        comissao_tipo,
        comissao_valor,
        comissao_calculada
      ) VALUES (
        v_tenant_id,
        v_exec_id,
        v_current_member_id,
        NOT EXISTS (SELECT 1 FROM public.execucao_executores WHERE execucao_id = v_exec_id),
        COALESCE(v_comissao_tipo, 'nenhuma'::public.comissao_tipo),
        COALESCE(v_comissao_valor, 0),
        0
      )
      ON CONFLICT (execucao_id, member_id) DO NOTHING;
    END IF;
  END IF;

  -- 5. Copiar itens de checklist do modelo para a execução (se ainda não existirem)
  IF NOT EXISTS (SELECT 1 FROM public.execucao_itens WHERE execucao_id = v_exec_id) THEN
    FOR v_item IN (
      SELECT
        ai.id AS agendamento_item_id,
        COALESCE(s.nome, 'Serviço') AS servico_nome,
        s.checklist_modelo_id
      FROM public.agendamento_itens ai
      LEFT JOIN public.servicos s ON s.id = ai.servico_id
      WHERE ai.agendamento_id = p_agendamento
    ) LOOP
      IF v_item.checklist_modelo_id IS NOT NULL THEN
        FOR v_citem IN (
          SELECT cmi.descricao, cmi.obrigatorio, cmi.ordem, cmi.observacao
          FROM public.checklist_modelo_itens cmi
          WHERE cmi.modelo_id = v_item.checklist_modelo_id
          ORDER BY cmi.ordem, cmi.created_at
        ) LOOP
          INSERT INTO public.execucao_itens (
            tenant_id,
            execucao_id,
            agendamento_item_id,
            servico_nome,
            descricao,
            obrigatorio,
            ordem,
            origem,
            observacao
          ) VALUES (
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
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'execucao_id', v_exec_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.iniciar_execucao(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_execucao(uuid) TO authenticated;


-- 6. RPC CONCLUIR_ATENDIMENTO COM CONSOLIDAÇÃO DO CRONÔMETRO E STATUS FINALIZADO
CREATE OR REPLACE FUNCTION public.concluir_atendimento(
  p_execucao uuid,
  p_valores jsonb DEFAULT '[]'::jsonb,
  p_consumos jsonb DEFAULT '[]'::jsonb,
  p_observacoes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_exec record;
  v_pendentes_count integer;
  v_pendentes_lista text;
  v_now timestamptz := now();
  v_segundos_totais integer := 0;
  v_tempo_efetivo integer := 0;
  
  v_old_consumo record;
  v_item_c jsonb;
  v_produto_id uuid;
  v_quantidade numeric(12,2);
  v_custo_unitario numeric(12,6);
  v_custo_total numeric(12,2);

  v_val_item jsonb;
  v_total_final numeric(10,2) := 0.00;
  v_agendamento_item_id uuid;
  v_val_final numeric(10,2);
  v_motivo_item text;
  v_estimado numeric(10,2);
  v_executor record;
  v_comissao_calculada numeric(10,2);
  v_hoje_sp date;
BEGIN
  -- 1. Carrega execução e valida status
  SELECT e.id, e.tenant_id, e.agendamento_id, e.status, e.iniciado_em, e.contando_desde, e.segundos_trabalhados, e.finalizado_em
  INTO v_exec
  FROM public.execucoes e
  WHERE e.id = p_execucao;

  IF v_exec.id IS NULL THEN
    RAISE EXCEPTION 'Execução não encontrada.';
  END IF;

  IF v_exec.status = 'finalizado' THEN
    RAISE EXCEPTION 'Esta execução já se encontra finalizada.';
  END IF;

  -- 2. Consolidação estrita do cronômetro (Zera contando_desde)
  v_segundos_totais := COALESCE(v_exec.segundos_trabalhados, 0);
  IF v_exec.contando_desde IS NOT NULL THEN
    v_segundos_totais := v_segundos_totais + GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_exec.contando_desde))::integer);
  ELSIF v_segundos_totais = 0 AND v_exec.iniciado_em IS NOT NULL THEN
    v_segundos_totais := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_exec.iniciado_em))::integer);
  END IF;

  v_tempo_efetivo := CEIL(v_segundos_totais::numeric / 60.0)::integer;
  IF v_tempo_efetivo <= 0 THEN v_tempo_efetivo := 1; END IF;

  -- 3. Validação de checklist obrigatório
  SELECT count(*), string_agg(ei.descricao, ', ') INTO v_pendentes_count, v_pendentes_lista
  FROM public.execucao_itens ei
  WHERE ei.execucao_id = p_execucao
    AND ei.obrigatorio = true
    AND ei.concluido = false;

  IF v_pendentes_count > 0 THEN
    RAISE EXCEPTION 'Existem itens obrigatórios pendentes no checklist: %', v_pendentes_lista;
  END IF;

  -- 4. Grava consumos de produtos
  FOR v_old_consumo IN
    SELECT produto_id, quantidade FROM public.execucao_consumos WHERE execucao_id = p_execucao
  LOOP
    UPDATE public.produtos
    SET estoque_atual = estoque_atual + v_old_consumo.quantidade
    WHERE id = v_old_consumo.produto_id;
  END LOOP;

  DELETE FROM public.estoque_movimentos WHERE execucao_id = p_execucao AND tipo = 'consumo';
  DELETE FROM public.execucao_consumos WHERE execucao_id = p_execucao;

  IF p_consumos IS NOT NULL AND jsonb_array_length(p_consumos) > 0 THEN
    FOR v_item_c IN SELECT * FROM jsonb_array_elements(p_consumos) LOOP
      v_produto_id := (v_item_c->>'produto_id')::uuid;
      v_quantidade := (v_item_c->>'quantidade')::numeric;

      IF v_quantidade > 0 THEN
        SELECT p.custo_unitario INTO v_custo_unitario
        FROM public.produtos p
        WHERE p.id = v_produto_id AND p.tenant_id = v_exec.tenant_id;

        IF v_custo_unitario IS NULL THEN v_custo_unitario := 0; END IF;
        v_custo_total := round(v_quantidade * v_custo_unitario, 2);

        INSERT INTO public.execucao_consumos (
          tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por
        ) VALUES (
          v_exec.tenant_id, p_execucao, v_produto_id, v_quantidade, v_custo_unitario, v_custo_total, auth.uid()
        );

        INSERT INTO public.estoque_movimentos (
          tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, criado_por
        ) VALUES (
          v_exec.tenant_id, v_produto_id, 'consumo', -v_quantidade, v_custo_unitario, v_custo_total, p_execucao, auth.uid()
        );

        UPDATE public.produtos
        SET estoque_atual = estoque_atual - v_quantidade
        WHERE id = v_produto_id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.execucoes
  SET custo_produtos = (
    SELECT coalesce(sum(custo_total), 0)
    FROM public.execucao_consumos
    WHERE execucao_id = p_execucao
  )
  WHERE id = p_execucao;

  -- 5. Grava valores finais
  IF p_valores IS NOT NULL AND jsonb_array_length(p_valores) > 0 THEN
    FOR v_val_item IN SELECT * FROM jsonb_array_elements(p_valores) LOOP
      v_agendamento_item_id := (v_val_item->>'agendamento_item_id')::uuid;
      v_val_final := coalesce((v_val_item->>'valor_final')::numeric(10,2), 0.00);
      v_motivo_item := v_val_item->>'motivo';

      SELECT ai.preco_estimado INTO v_estimado
      FROM public.agendamento_itens ai
      WHERE ai.id = v_agendamento_item_id;

      INSERT INTO public.execucao_valores (
        tenant_id, execucao_id, agendamento_item_id, valor_estimado, valor_final, motivo
      ) VALUES (
        v_exec.tenant_id, p_execucao, v_agendamento_item_id, v_estimado, v_val_final, v_motivo_item
      )
      ON CONFLICT (execucao_id, agendamento_item_id) DO UPDATE
      SET valor_final = EXCLUDED.valor_final,
          valor_estimado = EXCLUDED.valor_estimado,
          motivo = EXCLUDED.motivo;

      v_total_final := v_total_final + v_val_final;
    END LOOP;
  ELSE
    SELECT coalesce(sum(preco_estimado), 0.00) INTO v_total_final
    FROM public.agendamento_itens
    WHERE agendamento_id = v_exec.agendamento_id;
  END IF;

  -- 6. Consolida status finalizado, tempo e valor na execução
  UPDATE public.execucoes
  SET status = 'finalizado',
      finalizado_em = COALESCE(finalizado_em, v_now),
      contando_desde = NULL,
      segundos_trabalhados = v_segundos_totais,
      tempo_efetivo_minutos = v_tempo_efetivo,
      valor_total_final = v_total_final,
      valor_definido_por = auth.uid(),
      valor_definido_em = v_now,
      updated_at = v_now
  WHERE id = p_execucao;

  -- 7. Recalcula comissões dos executores
  v_hoje_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  FOR v_executor IN (
    SELECT ee.id, ee.member_id, cr.tipo AS comissao_tipo, cr.valor AS comissao_valor
    FROM public.execucao_executores ee
    LEFT JOIN LATERAL (
      SELECT tipo, valor
      FROM public.comissao_regras
      WHERE tenant_id = v_exec.tenant_id
        AND member_id = ee.member_id
        AND vigencia_inicio <= v_hoje_sp
        AND (vigencia_fim IS NULL OR vigencia_fim >= v_hoje_sp)
      ORDER BY vigencia_inicio DESC, created_at DESC
      LIMIT 1
    ) cr ON true
    WHERE ee.execucao_id = p_execucao
  ) LOOP
    v_comissao_calculada := 0.00;
    IF v_executor.comissao_tipo = 'percentual' AND v_executor.comissao_valor > 0 THEN
      v_comissao_calculada := (v_total_final * v_executor.comissao_valor) / 100.00;
    ELSIF v_executor.comissao_tipo = 'valor_fixo' AND v_executor.comissao_valor > 0 THEN
      v_comissao_calculada := v_executor.comissao_valor;
    END IF;

    UPDATE public.execucao_executores
    SET comissao_tipo = COALESCE(v_executor.comissao_tipo, comissao_tipo, 'nenhuma'::public.comissao_tipo),
        comissao_valor = COALESCE(v_executor.comissao_valor, comissao_valor, 0),
        comissao_calculada = v_comissao_calculada
    WHERE id = v_executor.id;
  END LOOP;

  -- 8. Atualiza agendamento para 'concluido'
  UPDATE public.agendamentos
  SET status = 'concluido',
      preco_estimado_total = v_total_final,
      updated_at = v_now
  WHERE id = v_exec.agendamento_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.concluir_atendimento(uuid, jsonb, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.concluir_atendimento(uuid, jsonb, jsonb, text) TO authenticated;


-- 7. RPC EXPIRAR_SINAIS_PENDENTES (Canônica: p_tenant uuid)
CREATE OR REPLACE FUNCTION public.expirar_sinais_pendentes(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF NOT (p_tenant IN (SELECT meus_tenants())) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Cancela agendamentos onde o sinal é OBRIGATÓRIO, está PENDENTE e tem mais de 24 horas da criação
  UPDATE public.agendamentos a
  SET status = 'cancelado',
      sinal_status = 'dispensado',
      observacoes = COALESCE(a.observacoes, '') || ' [Cancelado automaticamente: Sinal obrigatório não pago em 24h]',
      updated_at = now()
  FROM public.tenants t
  WHERE a.tenant_id = p_tenant
    AND t.id = a.tenant_id
    AND t.sinal_obrigatorio = true
    AND a.sinal_status = 'pendente'
    AND a.status IN ('agendado', 'aguardando_confirmacao')
    AND a.created_at < (now() - interval '24 hours');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expirar_sinais_pendentes(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expirar_sinais_pendentes(uuid) TO authenticated;

