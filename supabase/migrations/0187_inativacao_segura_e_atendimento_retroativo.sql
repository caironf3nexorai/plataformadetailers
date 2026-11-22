-- ==============================================================================
-- MIGRAÇÃO 0187: INATIVAÇÃO SEGURA DE CLIENTES E LANÇAMENTO DE SERVIÇOS RETROATIVOS
-- 1. inativar_ou_excluir_cliente: Trata erros de Foreign Key com fallback automático
--    para inativação (ativo = false), trava de papel (dono/gerente) e limpeza prévia
--    de dependências fracas.
-- 2. excluir_orcamento: Desvincula agendamentos cancelados e trata FK com status 'cancelado'.
-- 3. lancar_atendimento_retroativo: RPC atômica para lançar serviços realizados
--    fora do sistema em datas retroativas com agendamento concluído, execução finalizada,
--    recebimentos financeiros (com taxas e valor líquido preservados), comissões e DRE.
-- 4. Blindagem de permissões (REVOKE PUBLIC/anon) e validação estrita anti-PGRST203.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. INATIVAÇÃO OU EXCLUSÃO SEGURA DE CLIENTES
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.inativar_ou_excluir_cliente(UUID);
CREATE OR REPLACE FUNCTION public.inativar_ou_excluir_cliente(p_cliente_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_tem_historico BOOLEAN := false;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  IF NOT (v_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Trava de papel: Apenas dono e gerente (ou admin da plataforma) podem excluir/inativar
  IF NOT public.tem_papel(v_tenant_id, ARRAY['dono', 'gerente']::app_role[]) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado. Apenas donos e gerentes podem inativar ou excluir clientes.';
  END IF;

  -- 1.1 Verifica agendamentos, orçamentos e recebimentos (tabelas core)
  SELECT EXISTS(
    SELECT 1 FROM public.agendamentos WHERE cliente_id = p_cliente_id
    UNION ALL
    SELECT 1 FROM public.orcamentos WHERE cliente_id = p_cliente_id
    UNION ALL
    SELECT 1 FROM public.recebimentos WHERE cliente_id = p_cliente_id
  ) INTO v_tem_historico;

  -- 1.2 Checa tabelas adicionais dinamicamente se existirem
  IF NOT v_tem_historico AND to_regclass('public.certificados_garantia') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.certificados_garantia WHERE cliente_id = $1)'
    INTO v_tem_historico USING p_cliente_id;
  END IF;

  IF NOT v_tem_historico AND to_regclass('public.notas_fiscais') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.notas_fiscais WHERE cliente_id = $1)'
    INTO v_tem_historico USING p_cliente_id;
  END IF;

  -- Se tiver histórico operacional, inativa e preserva registros
  IF v_tem_historico THEN
    UPDATE public.clientes
    SET ativo = false, updated_at = now()
    WHERE id = p_cliente_id;

    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'inativado',
      'mensagem', 'Cliente inativado e arquivado com sucesso (histórico de atendimentos e orçamentos preservado).'
    );
  END IF;

  -- 1.3 Se NÃO tem histórico operacional, limpa dependências fracas
  IF to_regclass('public.veiculo_donos') IS NOT NULL THEN
    DELETE FROM public.veiculo_donos WHERE cliente_id = p_cliente_id;
  END IF;

  IF to_regclass('public.historico_contatos_retorno') IS NOT NULL THEN
    DELETE FROM public.historico_contatos_retorno WHERE cliente_id = p_cliente_id;
  END IF;

  IF to_regclass('public.fila_mensagens_whatsapp') IS NOT NULL THEN
    DELETE FROM public.fila_mensagens_whatsapp WHERE cliente_id = p_cliente_id;
  END IF;

  IF to_regclass('public.veiculos') IS NOT NULL THEN
    UPDATE public.veiculos SET cliente_id = NULL WHERE cliente_id = p_cliente_id;
  END IF;

  -- 1.4 Tenta DELETE físico com fallback automático para inativação
  BEGIN
    DELETE FROM public.clientes WHERE id = p_cliente_id;
    RETURN jsonb_build_object(
      'sucesso', true,
      'acao', 'excluido',
      'mensagem', 'Cliente excluído com sucesso do banco de dados.'
    );
  EXCEPTION
    WHEN foreign_key_violation THEN
      UPDATE public.clientes
      SET ativo = false, updated_at = now()
      WHERE id = p_cliente_id;

      RETURN jsonb_build_object(
        'sucesso', true,
        'acao', 'inativado',
        'mensagem', 'Cliente arquivado com sucesso. Como possui registros vinculados, seu histórico foi preservado.'
      );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.inativar_ou_excluir_cliente(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inativar_ou_excluir_cliente(UUID) TO authenticated;


-- ------------------------------------------------------------------------------
-- 2. EXCLUSÃO RESILIENTE DE ORÇAMENTOS
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.excluir_orcamento(uuid);
CREATE OR REPLACE FUNCTION public.excluir_orcamento(p_orcamento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orcamento record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_orcamento FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, array['dono', 'gerente']::app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado. Apenas donos e gerentes podem excluir orçamentos.';
  END IF;

  -- Se tiver agendamento vinculado ativo, bloqueia
  IF v_orcamento.agendamento_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.agendamentos 
      WHERE id = v_orcamento.agendamento_id 
        AND status NOT IN ('cancelado')
    ) THEN
      RAISE EXCEPTION 'Este orçamento possui um agendamento ativo. Cancele o agendamento antes de excluir o orçamento.';
    ELSE
      UPDATE public.orcamentos SET agendamento_id = NULL WHERE id = p_orcamento_id;
    END IF;
  END IF;

  -- Exclusão segura em cascata de tabelas filhas
  IF to_regclass('public.orcamento_fotos') IS NOT NULL THEN
    DELETE FROM public.orcamento_fotos WHERE orcamento_id = p_orcamento_id;
  END IF;
  IF to_regclass('public.termos_garantia') IS NOT NULL THEN
    DELETE FROM public.termos_garantia WHERE orcamento_id = p_orcamento_id;
  END IF;
  IF to_regclass('public.orcamento_nivel_itens') IS NOT NULL THEN
    DELETE FROM public.orcamento_nivel_itens WHERE nivel_id IN (
      SELECT id FROM public.orcamento_niveis WHERE orcamento_id = p_orcamento_id
    );
  END IF;
  IF to_regclass('public.orcamento_niveis') IS NOT NULL THEN
    DELETE FROM public.orcamento_niveis WHERE orcamento_id = p_orcamento_id;
  END IF;

  BEGIN
    DELETE FROM public.orcamentos WHERE id = p_orcamento_id;
  EXCEPTION
    WHEN foreign_key_violation THEN
      UPDATE public.orcamentos
      SET status = 'cancelado', updated_at = now()
      WHERE id = p_orcamento_id;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.excluir_orcamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_orcamento(uuid) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3. LANÇAMENTO DE ATENDIMENTO RETROATIVO CONCLUÍDO
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, UUID, TEXT, INTEGER, JSONB);
DROP FUNCTION IF EXISTS public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, UUID, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, UUID, TEXT);
DROP FUNCTION IF EXISTS public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, UUID);
DROP FUNCTION IF EXISTS public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB);

CREATE OR REPLACE FUNCTION public.lancar_atendimento_retroativo(
  p_cliente_id UUID,
  p_veiculo_id UUID,
  p_data_realizacao TIMESTAMPTZ,
  p_servicos JSONB,
  p_pagamentos JSONB DEFAULT '[]'::jsonb,
  p_executor_id UUID DEFAULT NULL,
  p_observacoes TEXT DEFAULT NULL,
  p_tempo_execucao_minutos INTEGER DEFAULT NULL,
  p_consumos JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_categoria_id UUID;
  v_servico_principal_id UUID;
  v_duracao_total INTEGER := 0;
  v_valor_total NUMERIC(10,2) := 0.00;
  v_os_num INTEGER;
  v_agendamento_id UUID;
  v_execucao_id UUID;
  v_agendamento_item_id UUID;
  v_item JSONB;
  v_srv_id UUID;
  v_srv_duracao INTEGER;
  v_srv_valor NUMERIC(10,2);
  v_srv_modo TEXT;
  v_srv_dias SMALLINT;
  v_srv_ordem SMALLINT := 0;
  v_fuso TEXT;
  v_hoje DATE;
  v_data_servico DATE;
  v_pgto JSONB;
  v_forma_id UUID;
  v_forma_tipo TEXT;
  v_pgto_valor NUMERIC(10,2);
  v_pgto_parcelas INTEGER;
  v_pgto_num_parcela INTEGER;
  v_pgto_previsto DATE;
  v_pgto_status TEXT;
  v_pgto_recebido_em TIMESTAMPTZ;
  v_pgto_taxa NUMERIC(10,2) := 0.00;
  v_pgto_liquido NUMERIC(10,2) := 0.00;
  v_comissao_tipo public.comissao_tipo;
  v_comissao_val NUMERIC(10,2);
  v_comissao_calc NUMERIC(10,2) := 0.00;
  v_item_c JSONB;
  v_prod_id UUID;
  v_prod_qtd NUMERIC(12,2);
  v_prod_custo NUMERIC(12,6);
  v_prod_custo_total NUMERIC(12,2);
  v_now TIMESTAMPTZ := now();
  v_fim TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Informe o cliente para lançar o atendimento.';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.clientes WHERE id = p_cliente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  IF NOT (v_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado. Usuário não pertence a esta oficina.';
  END IF;

  IF p_servicos IS NULL OR jsonb_array_length(p_servicos) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um serviço realizado.';
  END IF;

  IF p_data_realizacao IS NULL THEN
    RAISE EXCEPTION 'Informe a data de realização do serviço.';
  END IF;

  -- Determina categoria do veículo ou primeira cadastrada na oficina com validações de integridade
  IF p_veiculo_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.veiculos WHERE id = p_veiculo_id AND tenant_id = v_tenant_id) THEN
      p_veiculo_id := NULL;
    ELSE
      SELECT categoria_id INTO v_categoria_id FROM public.veiculos WHERE id = p_veiculo_id;
    END IF;
  END IF;

  IF v_categoria_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.categorias_veiculo WHERE id = v_categoria_id AND tenant_id = v_tenant_id) THEN
      v_categoria_id := NULL;
    END IF;
  END IF;

  IF v_categoria_id IS NULL THEN
    SELECT id INTO v_categoria_id FROM public.categorias_veiculo WHERE tenant_id = v_tenant_id ORDER BY ordem ASC LIMIT 1;
  END IF;

  IF v_categoria_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma categoria de veículo cadastrada para esta oficina.';
  END IF;

  v_fuso := public.obter_fuso_tenant(v_tenant_id);
  v_hoje := (v_now AT TIME ZONE v_fuso)::date;
  v_data_servico := (p_data_realizacao AT TIME ZONE v_fuso)::date;

  -- Calcula totais dos serviços informados com validação de pertencimento à oficina
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_servicos) LOOP
    v_srv_id := (v_item->>'servico_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.servicos WHERE id = v_srv_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'O serviço informado não pertence a esta oficina ou foi desativado.';
    END IF;
    v_srv_duracao := COALESCE((v_item->>'duracao_minutos')::integer, (v_item->>'duracao')::integer, 60);
    v_srv_valor := COALESCE((v_item->>'valor')::numeric, (v_item->>'preco')::numeric, 0.00);
    v_duracao_total := v_duracao_total + v_srv_duracao;
    v_valor_total := v_valor_total + v_srv_valor;
    IF v_servico_principal_id IS NULL THEN
      v_servico_principal_id := v_srv_id;
    END IF;
  END LOOP;

  -- Se foi informado tempo de execução explícito (em minutos), utiliza ele para o cálculo do DRE e término
  IF p_tempo_execucao_minutos IS NOT NULL AND p_tempo_execucao_minutos > 0 THEN
    v_duracao_total := p_tempo_execucao_minutos;
  END IF;

  IF v_duracao_total <= 0 THEN v_duracao_total := 60; END IF;
  v_fim := p_data_realizacao + (v_duracao_total || ' minutes')::interval;

  -- Gera número de OS sequencial para a oficina
  v_os_num := public.proximo_numero_os(v_tenant_id);

  -- 1. Cria Agendamento Concluído
  INSERT INTO public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    numero_os,
    observacoes,
    criado_por,
    created_at,
    updated_at
  ) VALUES (
    v_tenant_id,
    p_cliente_id,
    p_veiculo_id,
    v_servico_principal_id,
    v_categoria_id,
    p_data_realizacao,
    v_duracao_total,
    v_duracao_total,
    'slot',
    'slot',
    1,
    v_valor_total,
    v_valor_total,
    'concluido',
    'interno',
    v_os_num,
    p_observacoes,
    auth.uid(),
    p_data_realizacao,
    p_data_realizacao
  ) RETURNING id INTO v_agendamento_id;

  -- 2. Cria Execução Finalizada
  INSERT INTO public.execucoes (
    tenant_id,
    agendamento_id,
    status,
    iniciado_em,
    finalizado_em,
    segundos_trabalhados,
    tempo_efetivo_minutos,
    valor_total_final,
    valor_definido_por,
    valor_definido_em,
    observacoes_saida,
    created_at,
    updated_at
  ) VALUES (
    v_tenant_id,
    v_agendamento_id,
    'finalizado',
    p_data_realizacao,
    v_fim,
    v_duracao_total * 60,
    v_duracao_total,
    v_valor_total,
    auth.uid(),
    p_data_realizacao,
    p_observacoes,
    p_data_realizacao,
    p_data_realizacao
  ) RETURNING id INTO v_execucao_id;

  -- 3. Insere Itens do Agendamento e Valores Consolidados
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_servicos) LOOP
    v_srv_id := (v_item->>'servico_id')::uuid;
    v_srv_duracao := COALESCE((v_item->>'duracao_minutos')::integer, (v_item->>'duracao')::integer, 60);
    v_srv_valor := COALESCE((v_item->>'valor')::numeric, (v_item->>'preco')::numeric, 0.00);

    SELECT modo_ocupacao, dias_ocupados INTO v_srv_modo, v_srv_dias
    FROM public.servicos WHERE id = v_srv_id;

    INSERT INTO public.agendamento_itens (
      tenant_id,
      agendamento_id,
      servico_id,
      duracao_minutos,
      preco_estimado,
      modo_ocupacao,
      dias_ocupados,
      ordem,
      created_at
    ) VALUES (
      v_tenant_id,
      v_agendamento_id,
      v_srv_id,
      v_srv_duracao,
      v_srv_valor,
      COALESCE(v_srv_modo, 'slot'),
      COALESCE(v_srv_dias, 1),
      v_srv_ordem,
      p_data_realizacao
    ) RETURNING id INTO v_agendamento_item_id;

    INSERT INTO public.execucao_valores (
      tenant_id,
      execucao_id,
      agendamento_item_id,
      valor_estimado,
      valor_final,
      motivo
    ) VALUES (
      v_tenant_id,
      v_execucao_id,
      v_agendamento_item_id,
      v_srv_valor,
      v_srv_valor,
      'Lançamento retroativo'
    );

    v_srv_ordem := v_srv_ordem + 1;
  END LOOP;

  -- 4. Executor da Equipe e Comissão Automática (se informado)
  IF p_executor_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE id = p_executor_id AND tenant_id = v_tenant_id) THEN
      p_executor_id := NULL;
    ELSE
      SELECT tipo, valor INTO v_comissao_tipo, v_comissao_val
      FROM public.comissao_regras
      WHERE tenant_id = v_tenant_id
        AND member_id = p_executor_id
        AND vigencia_inicio <= v_data_servico
        AND (vigencia_fim IS NULL OR vigencia_fim >= v_data_servico)
      ORDER BY vigencia_inicio DESC, created_at DESC
      LIMIT 1;

      IF v_comissao_tipo = 'percentual' AND v_comissao_val > 0 THEN
        v_comissao_calc := round((v_valor_total * v_comissao_val / 100.0), 2);
      ELSIF v_comissao_tipo = 'valor_fixo' AND v_comissao_val > 0 THEN
        v_comissao_calc := v_comissao_val;
      END IF;

      INSERT INTO public.execucao_executores (
        tenant_id,
        execucao_id,
        member_id,
        comissao_tipo,
        comissao_valor,
        comissao_calculada
      ) VALUES (
        v_tenant_id,
        v_execucao_id,
        p_executor_id,
        COALESCE(v_comissao_tipo, 'nenhuma'::public.comissao_tipo),
        COALESCE(v_comissao_val, 0),
        v_comissao_calc
      );
    END IF;
  END IF;

  -- 5. Consumos de Produtos / Insumos do Estoque (se informados)
  IF p_consumos IS NOT NULL AND jsonb_array_length(p_consumos) > 0 THEN
    FOR v_item_c IN SELECT * FROM jsonb_array_elements(p_consumos) LOOP
      v_prod_id := (v_item_c->>'produto_id')::uuid;
      v_prod_qtd := (v_item_c->>'quantidade')::numeric;

      IF v_prod_id IS NOT NULL AND v_prod_qtd > 0 THEN
        SELECT custo_unitario INTO v_prod_custo
        FROM public.produtos
        WHERE id = v_prod_id AND tenant_id = v_tenant_id;

        IF NOT FOUND THEN
          CONTINUE;
        END IF;

        v_prod_custo := COALESCE(v_prod_custo, 0.00);
        v_prod_custo_total := round(v_prod_qtd * v_prod_custo, 2);

        INSERT INTO public.execucao_consumos (
          tenant_id,
          execucao_id,
          produto_id,
          quantidade,
          custo_unitario,
          custo_total,
          registrado_por,
          created_at
        ) VALUES (
          v_tenant_id,
          v_execucao_id,
          v_prod_id,
          v_prod_qtd,
          v_prod_custo,
          v_prod_custo_total,
          auth.uid(),
          p_data_realizacao
        )
        ON CONFLICT (execucao_id, produto_id) DO UPDATE
        SET quantidade = public.execucao_consumos.quantidade + EXCLUDED.quantidade,
            custo_total = round((public.execucao_consumos.quantidade + EXCLUDED.quantidade) * EXCLUDED.custo_unitario, 2);

        INSERT INTO public.estoque_movimentos (
          tenant_id,
          produto_id,
          tipo,
          quantidade,
          custo_unitario,
          custo_total,
          execucao_id,
          criado_por,
          created_at
        ) VALUES (
          v_tenant_id,
          v_prod_id,
          'consumo',
          -v_prod_qtd,
          v_prod_custo,
          v_prod_custo_total,
          v_execucao_id,
          auth.uid(),
          p_data_realizacao
        );

        UPDATE public.produtos
        SET estoque_atual = estoque_atual - v_prod_qtd,
            updated_at = now()
        WHERE id = v_prod_id;
      END IF;
    END LOOP;

    UPDATE public.execucoes
    SET custo_produtos = (
      SELECT coalesce(sum(custo_total), 0)
      FROM public.execucao_consumos
      WHERE execucao_id = v_execucao_id
    )
    WHERE id = v_execucao_id;
  END IF;

  -- 6. Lançamentos Financeiros em Contas a Receber (se houver)
  IF p_pagamentos IS NOT NULL AND jsonb_array_length(p_pagamentos) > 0 THEN
    FOR v_pgto IN SELECT * FROM jsonb_array_elements(p_pagamentos) LOOP
      v_forma_id := (v_pgto->>'forma_id')::uuid;
      v_pgto_valor := (v_pgto->>'valor_bruto')::numeric;
      IF v_pgto_valor IS NULL OR v_pgto_valor <= 0 THEN
        v_pgto_valor := (v_pgto->>'valor')::numeric;
      END IF;
      v_pgto_parcelas := COALESCE((v_pgto->>'total_parcelas')::integer, 1);
      v_pgto_num_parcela := COALESCE((v_pgto->>'numero_parcela')::integer, 1);
      v_pgto_previsto := COALESCE((v_pgto->>'previsto_para')::date, v_data_servico);

      -- Leitura segura das taxas informadas no JSON com fallbacks para o DRE
      v_pgto_taxa := COALESCE(
        (v_pgto->>'valor_taxa')::numeric,
        (v_pgto->>'taxa_valor')::numeric,
        0.00
      );
      v_pgto_liquido := COALESCE(
        (v_pgto->>'valor_liquido')::numeric,
        GREATEST(0.00, v_pgto_valor - v_pgto_taxa)
      );

      IF v_forma_id IS NOT NULL AND v_pgto_valor > 0 THEN
        SELECT tipo INTO v_forma_tipo FROM public.tenant_formas_pagamento WHERE id = v_forma_id AND tenant_id = v_tenant_id;
        IF NOT FOUND THEN
          SELECT id, tipo INTO v_forma_id, v_forma_tipo 
          FROM public.tenant_formas_pagamento 
          WHERE tenant_id = v_tenant_id AND ativo = true 
          LIMIT 1;
        END IF;

        IF v_forma_tipo IN ('dinheiro', 'pix') OR v_pgto_previsto <= v_hoje THEN
          v_pgto_status := 'recebido';
          v_pgto_recebido_em := p_data_realizacao;
        ELSE
          v_pgto_status := 'previsto';
          v_pgto_recebido_em := NULL;
        END IF;

        INSERT INTO public.recebimentos (
          tenant_id,
          execucao_id,
          agendamento_id,
          cliente_id,
          forma_id,
          valor_bruto,
          valor_liquido,
          valor_taxa,
          total_parcelas,
          numero_parcela,
          status,
          origem,
          previsto_para,
          recebido_em,
          observacao,
          criado_por,
          created_at
        ) VALUES (
          v_tenant_id,
          v_execucao_id,
          v_agendamento_id,
          p_cliente_id,
          v_forma_id,
          v_pgto_valor,
          v_pgto_liquido,
          v_pgto_taxa,
          v_pgto_parcelas,
          v_pgto_num_parcela,
          v_pgto_status,
          'manual',
          v_pgto_previsto,
          v_pgto_recebido_em,
          p_observacoes,
          auth.uid(),
          p_data_realizacao
        );
      END IF;
    END LOOP;
  END IF;

  -- 7. Consolidação Financeira (DRE / Fechamento de Resultado)
  PERFORM public.fechar_resultado_execucao(v_execucao_id);

  RETURN jsonb_build_object(
    'sucesso', true,
    'agendamento_id', v_agendamento_id,
    'execucao_id', v_execucao_id,
    'numero_os', v_os_num,
    'mensagem', format('Atendimento OS #%s lançado com sucesso!', v_os_num)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, UUID, TEXT, INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lancar_atendimento_retroativo(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, UUID, TEXT, INTEGER, JSONB) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. VERIFICAÇÃO ESTREITA ANTI-PGRST203 NO CATÁLOGO PG_PROC
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.proname, count(*) as total
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'inativar_ou_excluir_cliente',
        'excluir_orcamento',
        'lancar_atendimento_retroativo'
      )
    GROUP BY p.proname
    HAVING count(*) > 1
  ) LOOP
    RAISE EXCEPTION 'ALERTA CRÍTICO ANTI-PGRST203: Função pública % possui % assinaturas ativas!', r.proname, r.total;
  END LOOP;
END $$;

-- 5. RECARREGAR O SCHEMA CACHE DO POSTGREST
NOTIFY pgrst, 'reload schema';

COMMIT;
