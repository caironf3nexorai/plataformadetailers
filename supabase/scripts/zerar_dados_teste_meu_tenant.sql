-- ==============================================================================
-- SCRIPT: ZERAR DADOS OPERACIONAIS DE TESTE (EXCLUSIVO PARA O SEU TENANT)
-- ==============================================================================
-- Este script limpa com 100% de isolamento APENAS os dados da sua oficina,
-- sem tocar em absolutamente nada de outros tenants ou usuários.
--
-- DADOS QUE SERÃO ZERADOS (apenas da sua oficina):
--   ✔ Orçamentos (todos os níveis, itens e fotos)
--   ✔ Agendamentos e Atendimentos / Ordens de Serviço (OS)
--   ✔ Check-ins de entrada e avarias de teste
--   ✔ Execuções, cronômetros e fotos de execução
--   ✔ Recebimentos e movimentações financeiras de teste
--   ✔ Movimentações de consumo de estoque de teste (e estorna o estoque para os produtos)
--   ✔ Clientes e Veículos cadastrados durante os testes
--   ✔ Notificações de teste
--   ✔ Reinicia os contadores de OS e Orçamento de volta para o número 1 (#1)
--
-- DADOS PRESERVADOS (NÃO SÃO APAGADOS):
--   🛡️ Sua Oficina / Empresa (tenants)
--   🛡️ Seu Usuário, Login e Membros da Equipe (tenant_members / auth.users)
--   🛡️ Seu Catálogo de Serviços e Matriz de Preços (servicos, servico_precos)
--   🛡️ Categorias de Veículos (categorias_veiculo)
--   🛡️ Produtos do Estoque e Diluições (produtos, produtos_diluicao)
--   🛡️ Formas de Pagamento e Taxas configuradas
--   🛡️ Assinatura e Limites do seu Plano
-- ==============================================================================

-- 1. Desativa temporariamente os triggers de imutabilidade do Check-in para permitir exclusão
ALTER TABLE public.checkin_avarias DISABLE TRIGGER trg_checkin_avarias_imutavel;
ALTER TABLE public.checkin_fotos DISABLE TRIGGER trg_checkin_fotos_imutavel;
ALTER TABLE public.checkins DISABLE TRIGGER trg_checkin_imutavel;

DO $$
DECLARE
  -- Digite aqui o e-mail do seu usuário dono/gerente no sistema:
  v_user_email TEXT := 'caironf3@gmail.com';

  v_tenant_id UUID;
  v_tenant_nome TEXT;

  -- Contadores para relatório de limpeza
  v_count_orcamentos INT := 0;
  v_count_agendamentos INT := 0;
  v_count_execucoes INT := 0;
  v_count_clientes INT := 0;
  v_count_veiculos INT := 0;
BEGIN
  -- IDENTIFICAÇÃO RIGOROSA DO TENANT DO USUÁRIO
  SELECT tm.tenant_id, t.nome INTO v_tenant_id, v_tenant_nome
  FROM public.tenant_members tm
  JOIN auth.users u ON u.id = tm.user_id
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE lower(trim(u.email)) = lower(trim(v_user_email))
    AND tm.status = 'ativo'
  LIMIT 1;

  -- Se não encontrar por email exato, tenta pelo usuário atualmente autenticado
  IF v_tenant_id IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT tm.tenant_id, t.nome INTO v_tenant_id, v_tenant_nome
    FROM public.tenant_members tm
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = auth.uid() AND tm.status = 'ativo'
    LIMIT 1;
  END IF;

  -- Validação de segurança: se não encontrar o tenant, aborta imediatamente sem apagar nada
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina ativa foi encontrada para o e-mail informado: "%". Altere a variável v_user_email para o e-mail correto com o qual você faz login.', v_user_email;
  END IF;

  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'INICIANDO LIMPEZA DE DADOS DE TESTE';
  RAISE NOTICE 'Oficina Identificada: % (ID: %)', v_tenant_nome, v_tenant_id;
  RAISE NOTICE '======================================================================';

  -- 2. DESVINCULA REFERÊNCIAS ENTRE ORÇAMENTOS E AGENDAMENTOS
  UPDATE public.orcamentos 
  SET agendamento_id = NULL 
  WHERE tenant_id = v_tenant_id;

  -- 3. REMOVE ORÇAMENTOS E SEUS ITENS FILHOS
  DELETE FROM public.orcamento_fotos 
  WHERE orcamento_id IN (SELECT id FROM public.orcamentos WHERE tenant_id = v_tenant_id);

  DELETE FROM public.orcamento_nivel_itens 
  WHERE nivel_id IN (SELECT id FROM public.orcamento_niveis WHERE tenant_id = v_tenant_id);

  DELETE FROM public.orcamento_niveis 
  WHERE tenant_id = v_tenant_id;

  WITH del_orc AS (
    DELETE FROM public.orcamentos 
    WHERE tenant_id = v_tenant_id 
    RETURNING id
  )
  SELECT count(*) INTO v_count_orcamentos FROM del_orc;

  -- 4. REMOVE CHECK-INS E AVARIAS
  DELETE FROM public.checkin_fotos 
  WHERE checkin_id IN (SELECT id FROM public.checkins WHERE tenant_id = v_tenant_id);

  DELETE FROM public.checkin_avarias 
  WHERE checkin_id IN (SELECT id FROM public.checkins WHERE tenant_id = v_tenant_id);

  DELETE FROM public.checkins 
  WHERE tenant_id = v_tenant_id;

  -- 5. ESTORNA O ESTOQUE CONSUMIDO NOS TESTES E LIMPA MOVIMENTAÇÕES DE ESTOQUE
  -- Devolve para o estoque dos produtos as quantidades consumidas nas execuções de teste
  UPDATE public.produtos p
  SET estoque_atual = p.estoque_atual + coalesce(sub.total_consumido, 0)
  FROM (
    SELECT ec.produto_id, sum(ec.quantidade) as total_consumido
    FROM public.execucao_consumos ec
    WHERE ec.tenant_id = v_tenant_id
    GROUP BY ec.produto_id
  ) sub
  WHERE p.id = sub.produto_id AND p.tenant_id = v_tenant_id;

  -- Desvincula explicitamente qualquer execucao_id em estoque_movimentos para não violar a FK estoque_movimentos_execucao_id_fkey
  UPDATE public.estoque_movimentos 
  SET execucao_id = NULL 
  WHERE tenant_id = v_tenant_id 
     OR execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);

  -- Remove as movimentações de consumo de teste
  DELETE FROM public.estoque_movimentos 
  WHERE tenant_id = v_tenant_id AND tipo = 'consumo';

  -- 6. REMOVE RECEBIMENTOS FINANCEIROS DE TESTE (CONTAS A RECEBER)
  DELETE FROM public.recebimentos 
  WHERE tenant_id = v_tenant_id;

  -- 7. REMOVE EXECUÇÕES (ATENDIMENTOS), CRONÔMETROS E FOTOS
  DELETE FROM public.execucao_fotos 
  WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);

  DELETE FROM public.execucao_consumos 
  WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);

  DELETE FROM public.execucao_itens 
  WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);

  DELETE FROM public.execucao_valores 
  WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);

  DELETE FROM public.execucao_executores 
  WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);

  WITH del_exec AS (
    DELETE FROM public.execucoes 
    WHERE tenant_id = v_tenant_id
    RETURNING id
  )
  SELECT count(*) INTO v_count_execucoes FROM del_exec;

  -- 8. REMOVE AGENDAMENTOS E ITENS
  DELETE FROM public.agendamento_itens 
  WHERE agendamento_id IN (SELECT id FROM public.agendamentos WHERE tenant_id = v_tenant_id);

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agendamento_online_tentativas') THEN
    DELETE FROM public.agendamento_online_tentativas WHERE tenant_id = v_tenant_id;
  END IF;

  WITH del_ag AS (
    DELETE FROM public.agendamentos 
    WHERE tenant_id = v_tenant_id 
    RETURNING id
  )
  SELECT count(*) INTO v_count_agendamentos FROM del_ag;

  -- 9. REMOVE NOTIFICAÇÕES E CONSENTIMENTOS DE TESTE
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notificacoes') THEN
    DELETE FROM public.notificacoes WHERE tenant_id = v_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'consentimentos_publicos') THEN
    DELETE FROM public.consentimentos_publicos WHERE tenant_id = v_tenant_id;
  END IF;

  -- 10. REMOVE VEÍCULOS E CLIENTES DE TESTE
  DELETE FROM public.veiculo_donos 
  WHERE tenant_id = v_tenant_id;

  WITH del_veic AS (
    DELETE FROM public.veiculos 
    WHERE tenant_id = v_tenant_id 
    RETURNING id
  )
  SELECT count(*) INTO v_count_veiculos FROM del_veic;

  WITH del_cli AS (
    DELETE FROM public.clientes 
    WHERE tenant_id = v_tenant_id 
    RETURNING id
  )
  SELECT count(*) INTO v_count_clientes FROM del_cli;

  -- 11. REINICIA A NUMERAÇÃO SEQUENCIAL DE OS E ORÇAMENTOS PARA 1 (#1)
  UPDATE public.tenant_contadores
  SET proxima_os = 1,
      proximo_orcamento = 1,
      ultimo_marco_exibido = 0
  WHERE tenant_id = v_tenant_id;

  INSERT INTO public.tenant_contadores (tenant_id, proxima_os, proximo_orcamento, ultimo_marco_exibido)
  VALUES (v_tenant_id, 1, 1, 0)
  ON CONFLICT (tenant_id) DO UPDATE
  SET proxima_os = 1, proximo_orcamento = 1, ultimo_marco_exibido = 0;

  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'LIMPEZA CONCLUÍDA COM SUCESSO PARA "%"!', v_tenant_nome;
  RAISE NOTICE '  - Orçamentos de teste removidos: %', v_count_orcamentos;
  RAISE NOTICE '  - Agendamentos de teste removidos: %', v_count_agendamentos;
  RAISE NOTICE '  - Execuções/Atendimentos de teste removidos: %', v_count_execucoes;
  RAISE NOTICE '  - Veículos de teste removidos: %', v_count_veiculos;
  RAISE NOTICE '  - Clientes de teste removidos: %', v_count_clientes;
  RAISE NOTICE '  - Numeração de OS e Orçamento reiniciada para #1';
  RAISE NOTICE '  - Serviços, Categorias, Produtos e Equipe: PRESERVADOS INTACTOS';
  RAISE NOTICE '======================================================================';

END $$;

-- 12. Reativa os triggers de proteção
ALTER TABLE public.checkin_avarias ENABLE TRIGGER trg_checkin_avarias_imutavel;
ALTER TABLE public.checkin_fotos ENABLE TRIGGER trg_checkin_fotos_imutavel;
ALTER TABLE public.checkins ENABLE TRIGGER trg_checkin_imutavel;
