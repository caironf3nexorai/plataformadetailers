-- ==============================================================================
-- SCRIPT: POPULAR CONTA DEMO COM 6 MESES DE HISTÓRICO PROGRESSIVO (CRIATIVOS)
-- ==============================================================================
-- Alvo exclusivo: daniel.gottham@gmail.com
--
-- O QUE ESTE SCRIPT FAZ (100% ISOLADO AO TENANT DO E-MAIL ACIMA):
--   1. Localiza o usuário em auth.users pelo e-mail e garante a oficina ativa.
--   2. Ativa o Plano Studio em modo Cortesia Sem Prazo (valor_centavos = 0,
--      sem cobrança no Asaas e sem distorcer o MRR do Painel Admin).
--   3. Limpa apenas os dados operacionais desse tenant (idempotente — pode rodar
--      novamente sempre que quiser atualizar as datas para o mês vigente).
--   4. Configura horários, maquininha, taxas de cartão, despesas fixas retroativas
--      (6 meses), produtos de estoque (com 1 item em alerta de reposição) e
--      catálogo de 7 serviços com matriz de preços confirmada.
--   5. Gera 22 clientes e 24 veículos fictícios + 126 atendimentos concluídos
--      distribuídos ao longo dos últimos 6 meses consecutivos com faturamento
--      e ticket médio progressivos (de ~R$ 10k até ~R$ 32k no mês atual).
--   6. Gera operação ao vivo para HOJE (1 concluído hoje, 1 em execução agora
--      com cronômetro rodando, 1 aguardando entrada hoje e próximos agendamentos),
--      orçamentos (aprovados, enviados/expirando, recusados), contas a receber
--      (pagas, a vencer e 1 atrasada), metas mensais de 6 meses e certificados.
-- ==============================================================================

-- 1. Desativa temporariamente triggers que bloqueiam datas retroativas / limpeza de check-in
ALTER TABLE public.checkin_avarias DISABLE TRIGGER trg_checkin_avarias_imutavel;
ALTER TABLE public.checkin_fotos DISABLE TRIGGER trg_checkin_fotos_imutavel;
ALTER TABLE public.checkins DISABLE TRIGGER trg_checkin_imutavel;
ALTER TABLE public.despesas_fixas DISABLE TRIGGER trg_despesas_fixas_imutabilidade;
ALTER TABLE public.tenants DISABLE TRIGGER trg_proteger_plano_tenant;
ALTER TABLE public.execucoes DISABLE TRIGGER trg_proteger_valores_execucao;

DO $$
DECLARE
  v_user_email TEXT := 'daniel.gottham@gmail.com';
  v_user_id UUID;
  v_tenant_id UUID;
  v_tenant_nome TEXT;
  v_member_id UUID;
  v_slug TEXT;

  v_hoje DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_m5_inicio DATE := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '5 months')::date;
  v_assinatura_dummy TEXT := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  -- Categorias
  v_cat_hatch UUID;
  v_cat_sedan UUID;
  v_cat_suv UUID;
  v_cat_cam UUID;

  -- Formas de pagamento e maquininha
  v_fp_dinheiro UUID;
  v_fp_pix UUID;
  v_fp_debito UUID;
  v_fp_credito UUID;
  v_fp_fiado UUID;
  v_maq_id UUID;

  -- Produtos
  v_prod_shampoo UUID;
  v_prod_sintra UUID;
  v_prod_polidor UUID;
  v_prod_vitrif UUID;
  v_prod_couro UUID;
  v_prod_cera UUID;

  -- Serviços (array 1..7)
  v_serv_ids UUID[] := ARRAY[]::UUID[];
  v_serv_nomes TEXT[] := ARRAY[
    'Lavagem Detalhada',
    'Higienização Interna',
    'Lavagem Técnica de Motor',
    'Polimento Comercial',
    'Polimento Técnico',
    'Vitrificação de Pintura',
    'Cristalização de Vidros'
  ];
  v_serv_grupos TEXT[] := ARRAY[
    'Lavagem',
    'Higienização',
    'Lavagem',
    'Polimento',
    'Polimento',
    'Proteção',
    'Vidros'
  ];
  v_serv_codigos TEXT[] := ARRAY['LV-02', 'HG-01', 'LV-03', 'PL-01', 'PL-02', 'VT-09', 'VT-01'];
  v_serv_modos TEXT[] := ARRAY['slot', 'slot', 'slot', 'slot', 'dia_inteiro', 'dia_inteiro', 'slot'];
  v_serv_duracoes INT[] := ARRAY[90, 180, 60, 240, 420, 480, 60];
  v_serv_toms TEXT[] := ARRAY['glass', 'mint', 'vapor', 'amber', 'amber', 'mint', 'glass'];
  -- Preço base Hatch; multiplicadores: Hatch 1.00, Sedan 1.15, SUV 1.32, Caminhonete 1.50
  v_serv_precos_hatch NUMERIC[] := ARRAY[160.00, 380.00, 140.00, 620.00, 1050.00, 1650.00, 140.00];

  -- Arrays de clientes e veículos
  v_clientes UUID[] := ARRAY[]::UUID[];
  v_veiculos UUID[] := ARRAY[]::UUID[];
  v_veic_cats UUID[] := ARRAY[]::UUID[];
  v_veic_cli_idx INT[] := ARRAY[]::INT[];

  -- Registros auxiliares para seed
  r_cli RECORD;
  r_veic RECORD;
  v_tmp_id UUID;

  -- Variáveis de loop e geração
  i INT;
  m_offset INT;
  v_qtd_mes INT;
  v_mes_ini DATE;
  v_mes_fim DATE;
  v_span_dias INT;
  v_dia_data DATE;
  v_hora_ini INT;
  v_ts_ini TIMESTAMPTZ;
  v_ts_fim TIMESTAMPTZ;

  v_idx_cli INT;
  v_idx_veic INT;
  v_cat_id UUID;
  v_mult_cat NUMERIC;
  v_s_prim INT;
  v_s_sec INT;
  v_tem_combo BOOLEAN;
  v_srv_id UUID;
  v_dur_1 INT;
  v_dur_2 INT;
  v_dur_tot INT;
  v_preco_1 NUMERIC(10,2);
  v_preco_2 NUMERIC(10,2);
  v_preco_tot NUMERIC(10,2);

  v_os_seq INT := 1;
  v_orc_seq INT := 1;
  v_cert_seq INT := 1;

  v_ag_id UUID;
  v_ag_item_1 UUID;
  v_ag_item_2 UUID;
  v_exec_id UUID;
  v_orc_id UUID;
  v_niv_ess UUID;
  v_niv_rec UUID;
  v_niv_com UUID;

  -- Pagamentos / taxas
  v_pag_roll INT;
  v_forma_escolhida UUID;
  v_forma_tipo TEXT;
  v_bandeira TEXT;
  v_parcelas INT;
  v_p INT;
  v_taxa_perc NUMERIC(5,2);
  v_val_parcela NUMERIC(10,2);
  v_val_resto NUMERIC(10,2);
  v_val_taxa NUMERIC(10,2);
  v_val_liq NUMERIC(10,2);
  v_previsto DATE;
  v_rec_status TEXT;
  v_rec_em TIMESTAMPTZ;

  -- Consumos
  v_custo_unit NUMERIC(12,6);
  v_qtd_cons NUMERIC(12,2);

  -- Relatório final
  v_total_faturado NUMERIC := 0;
  v_fat_m0 NUMERIC := 0;
  v_fat_m1 NUMERIC := 0;
  v_fat_m2 NUMERIC := 0;
  v_fat_m3 NUMERIC := 0;
  v_fat_m4 NUMERIC := 0;
  v_fat_m5 NUMERIC := 0;
BEGIN
  ------------------------------------------------------------------------------
  -- 1. IDENTIFICAR USUÁRIO E OFICINA (OU CRIAR OFICINA DEMO SE AINDA NÃO HOUVER)
  ------------------------------------------------------------------------------
  SELECT u.id INTO v_user_id
  FROM auth.users u
  WHERE lower(trim(u.email)) = lower(trim(v_user_email))
  ORDER BY u.created_at ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário "%" não encontrado em auth.users. Confirme o e-mail cadastrado.', v_user_email;
  END IF;

  SELECT tm.tenant_id, tm.id, t.nome
  INTO v_tenant_id, v_member_id, v_tenant_nome
  FROM public.tenant_members tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = v_user_id
    AND tm.status = 'ativo'
  ORDER BY tm.created_at ASC
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    v_slug := 'gottham-auto-detail-' || substr(gen_random_uuid()::text, 1, 6);
    v_tenant_nome := 'Gottham Auto Detail';

    INSERT INTO public.tenants (
      nome, slug, cidade, uf, telefone, criado_por, plano,
      welcome_modal_seen, onboarding_widget_oculto,
      sinal_ativo, sinal_tipo, sinal_valor,
      pix_chave, pix_tipo, pix_nome_beneficiario, pix_cidade
    ) VALUES (
      v_tenant_nome, v_slug, 'São Paulo', 'SP', '(11) 99842-7100', v_user_id, 'studio',
      true, true,
      true, 'percentual', 30.00,
      v_user_email, 'email', v_tenant_nome, 'São Paulo'
    )
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.tenant_members (tenant_id, user_id, email, role, status)
    VALUES (v_tenant_id, v_user_id, v_user_email, 'dono', 'ativo')
    RETURNING id INTO v_member_id;
  ELSE
    UPDATE public.tenants
    SET plano = 'studio',
        nome = COALESCE(NULLIF(trim(nome), ''), 'Gottham Auto Detail'),
        cidade = COALESCE(NULLIF(trim(cidade), ''), 'São Paulo'),
        uf = COALESCE(NULLIF(trim(uf), ''), 'SP'),
        telefone = COALESCE(NULLIF(trim(telefone), ''), '(11) 99842-7100'),
        welcome_modal_seen = true,
        onboarding_widget_oculto = true,
        sinal_ativo = true,
        sinal_tipo = 'percentual',
        sinal_valor = 30.00,
        pix_chave = COALESCE(NULLIF(trim(pix_chave), ''), v_user_email),
        pix_tipo = COALESCE(NULLIF(trim(pix_tipo), ''), 'email'),
        pix_nome_beneficiario = COALESCE(NULLIF(trim(pix_nome_beneficiario), ''), nome, 'Gottham Auto Detail'),
        pix_cidade = COALESCE(NULLIF(trim(pix_cidade), ''), cidade, 'São Paulo'),
        updated_at = now()
    WHERE id = v_tenant_id
    RETURNING nome INTO v_tenant_nome;
  END IF;

  -- Garante assinatura Cortesia Sem Prazo no plano Studio (sem cobrança e fora do MRR)
  INSERT INTO public.assinaturas (
    tenant_id, plano, plano_pendente, status, ciclo, valor_centavos,
    is_cortesia, cortesia_ate, trial_fim, atraso_desde,
    cancelada_em, url_pagamento_asaas, forma_pagamento, proximo_vencimento, updated_at
  ) VALUES (
    v_tenant_id, 'studio', NULL, 'cortesia', 'mensal', 0,
    true, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, now()
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET plano = 'studio',
      plano_pendente = NULL,
      status = 'cortesia',
      valor_centavos = 0,
      is_cortesia = true,
      cortesia_ate = NULL,
      trial_fim = NULL,
      atraso_desde = NULL,
      cancelada_em = NULL,
      url_pagamento_asaas = NULL,
      forma_pagamento = NULL,
      proximo_vencimento = NULL,
      updated_at = now();

  ------------------------------------------------------------------------------
  -- 2. LIMPEZA IDEMPOTENTE EXCLUSIVA DESTE TENANT DE TESTE
  ------------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'certificado_manutencoes') THEN
    DELETE FROM public.certificado_manutencoes WHERE tenant_id = v_tenant_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'certificados_garantia') THEN
    DELETE FROM public.certificados_garantia WHERE tenant_id = v_tenant_id;
  END IF;

  UPDATE public.orcamentos SET agendamento_id = NULL WHERE tenant_id = v_tenant_id;
  DELETE FROM public.orcamento_fotos WHERE orcamento_id IN (SELECT id FROM public.orcamentos WHERE tenant_id = v_tenant_id);
  DELETE FROM public.orcamento_nivel_itens WHERE nivel_id IN (SELECT id FROM public.orcamento_niveis WHERE tenant_id = v_tenant_id);
  DELETE FROM public.orcamento_niveis WHERE tenant_id = v_tenant_id;
  DELETE FROM public.orcamentos WHERE tenant_id = v_tenant_id;

  DELETE FROM public.checkin_fotos WHERE checkin_id IN (SELECT id FROM public.checkins WHERE tenant_id = v_tenant_id);
  DELETE FROM public.checkin_avarias WHERE checkin_id IN (SELECT id FROM public.checkins WHERE tenant_id = v_tenant_id);
  DELETE FROM public.checkins WHERE tenant_id = v_tenant_id;

  DELETE FROM public.estoque_movimentos WHERE tenant_id = v_tenant_id;
  DELETE FROM public.recebimentos WHERE tenant_id = v_tenant_id;

  DELETE FROM public.execucao_fotos WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);
  DELETE FROM public.execucao_consumos WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);
  DELETE FROM public.execucao_itens WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);
  DELETE FROM public.execucao_valores WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);
  DELETE FROM public.execucao_executores WHERE execucao_id IN (SELECT id FROM public.execucoes WHERE tenant_id = v_tenant_id);
  DELETE FROM public.execucoes WHERE tenant_id = v_tenant_id;

  DELETE FROM public.agendamento_itens WHERE agendamento_id IN (SELECT id FROM public.agendamentos WHERE tenant_id = v_tenant_id);
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agendamento_online_tentativas') THEN
    DELETE FROM public.agendamento_online_tentativas WHERE tenant_id = v_tenant_id;
  END IF;
  DELETE FROM public.agendamentos WHERE tenant_id = v_tenant_id;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notificacoes') THEN
    DELETE FROM public.notificacoes WHERE tenant_id = v_tenant_id;
  END IF;

  DELETE FROM public.veiculo_donos WHERE tenant_id = v_tenant_id;
  DELETE FROM public.veiculos WHERE tenant_id = v_tenant_id;
  DELETE FROM public.clientes WHERE tenant_id = v_tenant_id;
  DELETE FROM public.despesas_fixas WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_metas WHERE tenant_id = v_tenant_id;

  ------------------------------------------------------------------------------
  -- 3. CONFIGURAÇÃO BASE: CATEGORIAS, HORÁRIOS, FORMAS DE PAGAMENTO, TAXAS
  ------------------------------------------------------------------------------
  INSERT INTO public.categorias_veiculo (tenant_id, nome, descricao, ordem, ativo)
  VALUES
    (v_tenant_id, 'Hatch', 'Onix, Polo, Golf, Mini Cooper', 0, true),
    (v_tenant_id, 'Sedan', 'Corolla, Civic, BMW 320i, C180', 1, true),
    (v_tenant_id, 'SUV', 'Compass, Corolla Cross, XC60, Macan', 2, true),
    (v_tenant_id, 'Caminhonete', 'Hilux, Ranger, Toro, RAM', 3, true)
  ON CONFLICT (tenant_id, nome) DO UPDATE SET ativo = true;

  SELECT id INTO v_cat_hatch FROM public.categorias_veiculo WHERE tenant_id = v_tenant_id AND lower(nome) LIKE '%hatch%' LIMIT 1;
  SELECT id INTO v_cat_sedan FROM public.categorias_veiculo WHERE tenant_id = v_tenant_id AND lower(nome) LIKE '%sedan%' LIMIT 1;
  SELECT id INTO v_cat_suv   FROM public.categorias_veiculo WHERE tenant_id = v_tenant_id AND lower(nome) LIKE '%suv%' LIMIT 1;
  SELECT id INTO v_cat_cam   FROM public.categorias_veiculo WHERE tenant_id = v_tenant_id AND (lower(nome) LIKE '%caminhonete%' OR lower(nome) LIKE '%picape%') LIMIT 1;

  v_cat_hatch := COALESCE(v_cat_hatch, (SELECT id FROM public.categorias_veiculo WHERE tenant_id = v_tenant_id ORDER BY ordem LIMIT 1));
  v_cat_sedan := COALESCE(v_cat_sedan, v_cat_hatch);
  v_cat_suv   := COALESCE(v_cat_suv, v_cat_sedan);
  v_cat_cam   := COALESCE(v_cat_cam, v_cat_suv);

  PERFORM public.seed_horarios_funcionamento_tenant(v_tenant_id);
  UPDATE public.horarios_funcionamento
  SET capacidade = 2
  WHERE tenant_id = v_tenant_id AND ativo = true;

  PERFORM public.seed_formas_pagamento_tenant(v_tenant_id);

  SELECT id INTO v_fp_dinheiro FROM public.tenant_formas_pagamento WHERE tenant_id = v_tenant_id AND tipo = 'dinheiro' LIMIT 1;
  SELECT id INTO v_fp_pix      FROM public.tenant_formas_pagamento WHERE tenant_id = v_tenant_id AND tipo = 'pix' LIMIT 1;
  SELECT id INTO v_fp_debito   FROM public.tenant_formas_pagamento WHERE tenant_id = v_tenant_id AND tipo = 'debito' LIMIT 1;
  SELECT id INTO v_fp_credito  FROM public.tenant_formas_pagamento WHERE tenant_id = v_tenant_id AND tipo = 'credito' LIMIT 1;
  SELECT id INTO v_fp_fiado    FROM public.tenant_formas_pagamento WHERE tenant_id = v_tenant_id AND tipo = 'fiado' LIMIT 1;

  SELECT id INTO v_maq_id FROM public.tenant_maquininhas WHERE tenant_id = v_tenant_id AND padrao = true LIMIT 1;
  IF v_maq_id IS NULL THEN
    INSERT INTO public.tenant_maquininhas (tenant_id, nome, ativo, padrao, ordem)
    VALUES (v_tenant_id, 'Maquininha Padrão', true, true, 1)
    RETURNING id INTO v_maq_id;
  END IF;

  -- Taxas de cartão vigentes desde 6 meses atrás
  DELETE FROM public.taxas_cartao WHERE tenant_id = v_tenant_id AND maquininha_id = v_maq_id;
  INSERT INTO public.taxas_cartao (tenant_id, maquininha_id, tipo, bandeira_codigo, parcelas, taxa_percentual, taxa_fixa, vigencia_inicio, criado_por)
  VALUES
    (v_tenant_id, v_maq_id, 'debito',  NULL, 1, 1.39, 0.00, v_m5_inicio, v_user_id),
    (v_tenant_id, v_maq_id, 'credito', NULL, 1, 3.15, 0.00, v_m5_inicio, v_user_id),
    (v_tenant_id, v_maq_id, 'credito', NULL, 2, 4.49, 0.00, v_m5_inicio, v_user_id),
    (v_tenant_id, v_maq_id, 'credito', NULL, 3, 5.39, 0.00, v_m5_inicio, v_user_id),
    (v_tenant_id, v_maq_id, 'credito', NULL, 4, 6.29, 0.00, v_m5_inicio, v_user_id),
    (v_tenant_id, v_maq_id, 'credito', NULL, 6, 7.99, 0.00, v_m5_inicio, v_user_id);

  ------------------------------------------------------------------------------
  -- 4. DESPESAS FIXAS RETROATIVAS (6 MESES) PARA CUSTO/HORA E DRE REALISTAS
  ------------------------------------------------------------------------------
  -- Total mensal: R$ 3.600,00 -> ~R$ 15,00–R$ 17,00/hora de estrutura
  INSERT INTO public.despesas_fixas (
    tenant_id, nome, categoria, tipo, valor_mensal, vigencia_inicio,
    confirmado, confirmado_em, confirmado_por, criado_por, created_at
  ) VALUES
    (v_tenant_id, 'Aluguel do Estúdio / Box',        'Instalacao', 'recorrente', 1850.00, v_m5_inicio, true, v_m5_inicio::timestamptz, v_user_id, v_user_id, v_m5_inicio::timestamptz),
    (v_tenant_id, 'Energia Elétrica e Água',         'Instalacao', 'variavel',    420.00, v_m5_inicio, true, v_m5_inicio::timestamptz, v_user_id, v_user_id, v_m5_inicio::timestamptz),
    (v_tenant_id, 'Internet, Sistema e Telefonia',   'Servicos',   'recorrente',  180.00, v_m5_inicio, true, v_m5_inicio::timestamptz, v_user_id, v_user_id, v_m5_inicio::timestamptz),
    (v_tenant_id, 'MEI / Simples e Contabilidade',   'Impostos',   'recorrente',  350.00, v_m5_inicio, true, v_m5_inicio::timestamptz, v_user_id, v_user_id, v_m5_inicio::timestamptz),
    (v_tenant_id, 'Tráfego Pago e Marketing Local',  'Servicos',   'recorrente',  550.00, v_m5_inicio, true, v_m5_inicio::timestamptz, v_user_id, v_user_id, v_m5_inicio::timestamptz),
    (v_tenant_id, 'Manutenção de Politrizes e Box',  'Outros',     'recorrente',  250.00, v_m5_inicio, true, v_m5_inicio::timestamptz, v_user_id, v_user_id, v_m5_inicio::timestamptz);

  ------------------------------------------------------------------------------
  -- 5. PRODUTOS DO ESTOQUE (COM 1 ITEM ABAIXO DO MÍNIMO PARA ALERTA NO DASHBOARD)
  ------------------------------------------------------------------------------
  INSERT INTO public.produtos (tenant_id, nome, marca, categoria, unidade_uso, tamanho_compra, preco_compra, estoque_atual, estoque_minimo, ativo)
  VALUES
    (v_tenant_id, 'V-Floc Lava Autos Neutro',       'Vonixx', 'Lavagem',      'ml', 5000,  89.90, 3400, 1000, true),
    (v_tenant_id, 'Sintra Fast Bactericida',        'Vonixx', 'Higienização', 'ml', 5000, 119.00, 2250,  800, true),
    (v_tenant_id, 'V-Paint Polish Corte/Refino',    'Vonixx', 'Polimento',    'g',  1000, 149.00,  580,  250, true),
    (v_tenant_id, 'Coating Cerâmico 9H 50ml',       'Vonixx', 'Proteção',     'ml',   50, 295.00,   16,   20, true),
    (v_tenant_id, 'Higicouro Hidratante de Couro',  'Vonixx', 'Higienização', 'ml', 1500,  76.00,  940,  300, true),
    (v_tenant_id, 'Blend Cera Carnaúba & SiO2',     'Vonixx', 'Proteção',     'ml', 3000, 134.00, 1650,  500, true)
  ON CONFLICT (tenant_id, nome, marca) DO UPDATE
  SET preco_compra = EXCLUDED.preco_compra,
      estoque_atual = EXCLUDED.estoque_atual,
      estoque_minimo = EXCLUDED.estoque_minimo,
      ativo = true;

  SELECT id INTO v_prod_shampoo FROM public.produtos WHERE tenant_id = v_tenant_id AND nome = 'V-Floc Lava Autos Neutro' LIMIT 1;
  SELECT id INTO v_prod_sintra  FROM public.produtos WHERE tenant_id = v_tenant_id AND nome = 'Sintra Fast Bactericida' LIMIT 1;
  SELECT id INTO v_prod_polidor FROM public.produtos WHERE tenant_id = v_tenant_id AND nome = 'V-Paint Polish Corte/Refino' LIMIT 1;
  SELECT id INTO v_prod_vitrif  FROM public.produtos WHERE tenant_id = v_tenant_id AND nome = 'Coating Cerâmico 9H 50ml' LIMIT 1;
  SELECT id INTO v_prod_couro   FROM public.produtos WHERE tenant_id = v_tenant_id AND nome = 'Higicouro Hidratante de Couro' LIMIT 1;
  SELECT id INTO v_prod_cera    FROM public.produtos WHERE tenant_id = v_tenant_id AND nome = 'Blend Cera Carnaúba & SiO2' LIMIT 1;

  ------------------------------------------------------------------------------
  -- 6. CATÁLOGO DE SERVIÇOS + MATRIZ DE PREÇOS CONFIRMADA
  ------------------------------------------------------------------------------
  FOR i IN 1..7 LOOP
    SELECT id INTO v_srv_id
    FROM public.servicos
    WHERE tenant_id = v_tenant_id
      AND lower(trim(nome)) = lower(trim(v_serv_nomes[i]))
      AND ativo = true
    LIMIT 1;

    IF v_srv_id IS NULL THEN
      INSERT INTO public.servicos (
        tenant_id, nome, grupo, descricao_publica, codigo,
        modo_ocupacao, dias_ocupados, unidade_duracao,
        tom, publico, sob_consulta, ordem, ativo
      ) VALUES (
        v_tenant_id, v_serv_nomes[i], v_serv_grupos[i],
        'Serviço executado com padrão de estética automotiva premium e insumos de alta performance.',
        v_serv_codigos[i], v_serv_modos[i], 1, 'min',
        v_serv_toms[i], true, false, i, true
      )
      RETURNING id INTO v_srv_id;
    ELSE
      UPDATE public.servicos
      SET grupo = v_serv_grupos[i],
          codigo = v_serv_codigos[i],
          modo_ocupacao = v_serv_modos[i],
          tom = v_serv_toms[i],
          publico = true,
          sob_consulta = false,
          ordem = i
      WHERE id = v_srv_id;
    END IF;

    v_serv_ids := array_append(v_serv_ids, v_srv_id);

    INSERT INTO public.servico_precos (tenant_id, servico_id, categoria_id, preco_base, duracao_minutos, duracao_confirmada, ativo)
    VALUES
      (v_tenant_id, v_srv_id, v_cat_hatch, round(v_serv_precos_hatch[i] * 1.00, 0), v_serv_duracoes[i], true, true),
      (v_tenant_id, v_srv_id, v_cat_sedan, round(v_serv_precos_hatch[i] * 1.15, 0), round(v_serv_duracoes[i] * 1.10)::int, true, true),
      (v_tenant_id, v_srv_id, v_cat_suv,   round(v_serv_precos_hatch[i] * 1.32, 0), round(v_serv_duracoes[i] * 1.20)::int, true, true),
      (v_tenant_id, v_srv_id, v_cat_cam,   round(v_serv_precos_hatch[i] * 1.50, 0), round(v_serv_duracoes[i] * 1.30)::int, true, true)
    ON CONFLICT (servico_id, categoria_id) DO UPDATE
    SET preco_base = EXCLUDED.preco_base,
        duracao_minutos = EXCLUDED.duracao_minutos,
        duracao_confirmada = true,
        ativo = true;
  END LOOP;

  ------------------------------------------------------------------------------
  -- 7. CLIENTES E VEÍCULOS 100% FICTÍCIOS (22 CLIENTES / 24 VEÍCULOS)
  ------------------------------------------------------------------------------
  FOR r_cli IN
    SELECT * FROM (VALUES
      ( 1, 'Lucas Mendes',       '(11) 99000-1101', 'lucas.mendes.demo@exemplo.com',       'Gosta de lavagem detalhada mensal'),
      ( 2, 'Mariana Costa',      '(11) 99000-1102', 'mariana.costa.demo@exemplo.com',      'Prefere entrega após 17h'),
      ( 3, 'Rafael Oliveira',    '(11) 99000-1103', 'rafael.oliveira.demo@exemplo.com',    'Cliente recorrente desde o início'),
      ( 4, 'Camila Ferreira',    '(11) 99000-1104', 'camila.ferreira.demo@exemplo.com',    'Veículo com vitrificação ativa'),
      ( 5, 'Bruno Almeida',      '(11) 99000-1105', 'bruno.almeida.demo@exemplo.com',      'Atendimento aos sábados'),
      ( 6, 'Juliana Rocha',      '(11) 99000-1106', 'juliana.rocha.demo@exemplo.com',      NULL),
      ( 7, 'Thiago Barbosa',     '(11) 99000-1107', 'thiago.barbosa.demo@exemplo.com',     'Indicação de cliente'),
      ( 8, 'Fernanda Lima',      '(11) 99000-1108', 'fernanda.lima.demo@exemplo.com',      'Bancos em couro claro'),
      ( 9, 'Gustavo Ribeiro',    '(11) 99000-1109', 'gustavo.ribeiro.demo@exemplo.com',    NULL),
      (10, 'Patricia Martins',   '(11) 99000-1110', 'patricia.martins.demo@exemplo.com',   'Contato preferencial WhatsApp'),
      (11, 'Eduardo Carvalho',   '(11) 99000-1111', 'eduardo.carvalho.demo@exemplo.com',   'Frota executiva'),
      (12, 'Larissa Gomes',      '(11) 99000-1112', 'larissa.gomes.demo@exemplo.com',      NULL),
      (13, 'Rodrigo Duarte',     '(11) 99000-1113', 'rodrigo.duarte.demo@exemplo.com',     'Uso em rodovia, bastante inseto frontal'),
      (14, 'Beatriz Monteiro',   '(11) 99000-1114', 'beatriz.monteiro.demo@exemplo.com',   NULL),
      (15, 'Felipe Teixeira',    '(11) 99000-1115', 'felipe.teixeira.demo@exemplo.com',    'Colecionador exigente'),
      (16, 'Aline Nogueira',     '(11) 99000-1116', 'aline.nogueira.demo@exemplo.com',     NULL),
      (17, 'Henrique Castro',    '(11) 99000-1117', 'henrique.castro.demo@exemplo.com',    'Solicita fotos antes/depois'),
      (18, 'Vanessa Azevedo',    '(11) 99000-1118', 'vanessa.azevedo.demo@exemplo.com',    NULL),
      (19, 'Marcelo Freitas',    '(11) 99000-1119', 'marcelo.freitas.demo@exemplo.com',    'Picape uso misto'),
      (20, 'Renata Pires',       '(11) 99000-1120', 'renata.pires.demo@exemplo.com',       NULL),
      (21, 'Vinícius Lopes',     '(11) 99000-1121', 'vinicius.lopes.demo@exemplo.com',     'Veio pelo Instagram'),
      (22, 'Carolina Vieira',    '(11) 99000-1122', 'carolina.vieira.demo@exemplo.com',    'Veio pelo Google Maps')
    ) AS c(idx, nome, tel, email, obs)
    ORDER BY idx
  LOOP
    INSERT INTO public.clientes (tenant_id, nome, telefone, email, observacoes, origem, ativo, created_at)
    VALUES (
      v_tenant_id, r_cli.nome, r_cli.tel, r_cli.email, r_cli.obs,
      CASE WHEN r_cli.idx % 4 = 0 THEN 'online' ELSE 'interno' END,
      true,
      (v_m5_inicio + ((r_cli.idx - 1) * 6))::timestamptz
    )
    RETURNING id INTO v_tmp_id;

    v_clientes := array_append(v_clientes, v_tmp_id);
  END LOOP;

  FOR r_veic IN
    SELECT * FROM (VALUES
      ( 1,  1, v_cat_sedan, 'FXD4E11', 'Honda',         'Civic Touring',      'Cinza Basalto',   2024),
      ( 2,  2, v_cat_suv,   'GHJ7K22', 'Jeep',          'Compass Limited',    'Preto Carbon',    2023),
      ( 3,  3, v_cat_hatch, 'KLM2N33', 'Volkswagen',    'Golf GTI',           'Branco Puro',     2022),
      ( 4,  4, v_cat_suv,   'PQR9S44', 'Toyota',        'Corolla Cross XRX',  'Prata Lua',       2024),
      ( 5,  5, v_cat_sedan, 'TUV3W55', 'BMW',           '320i M Sport',       'Azul Portimao',   2024),
      ( 6,  6, v_cat_hatch, 'BCD8F66', 'Volkswagen',    'Polo GTS',           'Cinza Platinum',  2023),
      ( 7,  7, v_cat_cam,   'EGI1H77', 'Ford',          'Ranger Limited',     'Preto Gales',     2024),
      ( 8,  8, v_cat_suv,   'JLN5M88', 'Audi',          'Q3 Sportback',       'Branco Geleira',  2023),
      ( 9,  9, v_cat_suv,   'OPQ6R99', 'Volvo',         'XC60 Recharge',      'Cinza Osmium',    2024),
      (10, 10, v_cat_hatch, 'STU4V10', 'Mini',          'Cooper S',           'Verde British',   2022),
      (11, 11, v_cat_sedan, 'VWX9Y11', 'Mercedes-Benz', 'C180 AMG Line',      'Preto Obsidian',  2023),
      (12, 12, v_cat_suv,   'YZA2B12', 'Hyundai',       'Creta Ultimate',     'Branco Atlas',    2024),
      (13, 13, v_cat_cam,   'CDE7F13', 'Fiat',          'Toro Ultra',         'Cinza Sting',     2023),
      (14, 14, v_cat_suv,   'FGH3J14', 'BYD',           'Song Plus',          'Azul Atlantis',   2025),
      (15, 15, v_cat_suv,   'IJK8L15', 'Porsche',       'Macan T',            'Cinza Vulcano',   2024),
      (16, 16, v_cat_hatch, 'LMN1P16', 'Chevrolet',     'Onix RS',            'Vermelho Carmim', 2023),
      (17, 17, v_cat_cam,   'QRS5T17', 'Toyota',        'Hilux SRX',          'Branco Pérola',   2024),
      (18, 18, v_cat_suv,   'UVW6X18', 'Honda',         'HR-V Touring',       'Cinza Grafeno',   2024),
      (19, 19, v_cat_cam,   'ZAB9C19', 'RAM',           'Rampage R/T',        'Preto Diamond',   2024),
      (20, 20, v_cat_sedan, 'DEF4G20', 'Toyota',        'Corolla Altis',      'Prata Supernova', 2023),
      (21, 21, v_cat_suv,   'HIJ2K21', 'Volkswagen',    'T-Cross Highline',   'Cinza Moonstone', 2024),
      (22, 22, v_cat_suv,   'MNO8P22', 'Peugeot',       '2008 GT',            'Cinza Selenium',  2025),
      (23,  3, v_cat_suv,   'RST3U23', 'Volkswagen',    'Nivus Highline',     'Azul Biscay',     2023),
      (24, 11, v_cat_sedan, 'XYZ6W24', 'Audi',          'A3 Sedan S-Line',    'Branco Ibis',     2024)
    ) AS v(idx, cli_idx, cat_id, placa, marca, modelo, cor, ano)
    ORDER BY idx
  LOOP
    INSERT INTO public.veiculos (tenant_id, cliente_id, categoria_id, placa, marca, modelo, cor, ano, ativo, created_at)
    VALUES (
      v_tenant_id, v_clientes[r_veic.cli_idx], r_veic.cat_id, r_veic.placa, r_veic.marca, r_veic.modelo, r_veic.cor, r_veic.ano, true,
      (v_m5_inicio + ((r_veic.idx - 1) * 5))::timestamptz
    )
    ON CONFLICT (tenant_id, placa) DO UPDATE
    SET cliente_id = EXCLUDED.cliente_id,
        categoria_id = EXCLUDED.categoria_id
    RETURNING id INTO v_tmp_id;

    v_veiculos := array_append(v_veiculos, v_tmp_id);
    v_veic_cats := array_append(v_veic_cats, r_veic.cat_id);
    v_veic_cli_idx := array_append(v_veic_cli_idx, r_veic.cli_idx);
  END LOOP;

  FOR i IN 1..24 LOOP
    INSERT INTO public.veiculo_donos (tenant_id, veiculo_id, cliente_id, inicio, fim)
    VALUES (v_tenant_id, v_veiculos[i], v_clientes[v_veic_cli_idx[i]], v_m5_inicio, NULL);
  END LOOP;

  ------------------------------------------------------------------------------
  -- 8. SÉRIE HISTÓRICA DE 6 MESES CONSECUTIVOS COM CRESCIMENTO PROGRESSIVO
  ------------------------------------------------------------------------------
  -- m_offset: 5 (5 meses atrás) -> 0 (mês atual até hoje)
  -- Volume progressivo: 14 -> 17 -> 20 -> 22 -> 25 -> 28 (Total: 126 atendimentos)
  -- Mix de serviços e combos cresce gradualmente em ticket médio (~R$ 10k -> ~R$ 32k)
  FOR m_offset IN REVERSE 5..0 LOOP
    v_mes_ini := date_trunc('month', v_hoje - (m_offset || ' months')::interval)::date;
    IF m_offset = 0 THEN
      v_mes_fim := v_hoje;
    ELSE
      v_mes_fim := (date_trunc('month', v_hoje - (m_offset || ' months')::interval) + interval '1 month - 1 day')::date;
    END IF;

    v_qtd_mes := CASE m_offset
      WHEN 5 THEN 14
      WHEN 4 THEN 17
      WHEN 3 THEN 20
      WHEN 2 THEN 22
      WHEN 1 THEN 25
      WHEN 0 THEN 28
    END;

    v_span_dias := GREATEST(0, (v_mes_fim - v_mes_ini));

    FOR i IN 1..v_qtd_mes LOOP
      -- No mês atual, garante que o último atendimento concluído caia exatamente HOJE de manhã
      IF m_offset = 0 AND i = v_qtd_mes THEN
        v_dia_data := v_hoje;
      ELSIF m_offset = 0 THEN
        v_dia_data := v_mes_ini + floor(((i - 1)::numeric / GREATEST(1, v_qtd_mes - 1)) * GREATEST(0, v_span_dias - 1))::int;
      ELSE
        v_dia_data := v_mes_ini + floor(((i - 1)::numeric / GREATEST(1, v_qtd_mes - 1)) * v_span_dias)::int;
      END IF;

      -- Evita domingo quando possível
      IF extract(dow from v_dia_data) = 0 AND v_dia_data > v_mes_ini THEN
        v_dia_data := v_dia_data - 1;
      END IF;

      v_idx_veic := ((m_offset * 7 + i * 3) % 24) + 1;
      v_idx_cli := v_veic_cli_idx[v_idx_veic];
      v_cat_id := v_veic_cats[v_idx_veic];

      v_mult_cat := CASE
        WHEN v_cat_id = v_cat_hatch THEN 1.00
        WHEN v_cat_id = v_cat_sedan THEN 1.15
        WHEN v_cat_id = v_cat_suv   THEN 1.32
        ELSE 1.50
      END;

      v_tem_combo := false;
      v_s_sec := NULL;

      IF m_offset = 5 THEN
        -- Mês 1 (~R$ 10k): foco em lavagens detalhadas, higienizações e 2 polimentos
        IF i IN (6, 13) THEN
          v_s_prim := 5; -- Polimento Técnico
        ELSIF i IN (3, 9, 12) THEN
          v_s_prim := 4; v_tem_combo := true; v_s_sec := 7; -- Polimento Comercial + Vidros
        ELSIF i % 2 = 0 THEN
          v_s_prim := 2; v_tem_combo := true; v_s_sec := 3; -- Higienização + Motor
        ELSE
          v_s_prim := 1; v_tem_combo := true; v_s_sec := 7; -- Lavagem Detalhada + Vidros
        END IF;
      ELSIF m_offset = 4 THEN
        -- Mês 2 (~R$ 15k): primeira vitrificação + mais higienizações/polimentos
        IF i = 10 THEN
          v_s_prim := 6; -- Vitrificação
        ELSIF i IN (4, 15) THEN
          v_s_prim := 5; v_tem_combo := true; v_s_sec := 7;
        ELSIF i % 3 = 0 THEN
          v_s_prim := 4; v_tem_combo := true; v_s_sec := 1;
        ELSIF i % 2 = 0 THEN
          v_s_prim := 2; v_tem_combo := true; v_s_sec := 3;
        ELSE
          v_s_prim := 1; v_tem_combo := true; v_s_sec := 2;
        END IF;
      ELSIF m_offset = 3 THEN
        -- Mês 3 (~R$ 20k): 2 vitrificações + polimentos técnicos
        IF i IN (7, 17) THEN
          v_s_prim := 6; v_tem_combo := true; v_s_sec := 7;
        ELSIF i IN (3, 11, 19) THEN
          v_s_prim := 5; v_tem_combo := true; v_s_sec := 2;
        ELSIF i % 3 = 0 THEN
          v_s_prim := 4; v_tem_combo := true; v_s_sec := 1;
        ELSIF i % 2 = 0 THEN
          v_s_prim := 2; v_tem_combo := true; v_s_sec := 3;
        ELSE
          v_s_prim := 1; v_tem_combo := true; v_s_sec := 7;
        END IF;
      ELSIF m_offset = 2 THEN
        -- Mês 4 (~R$ 23k): 2 vitrificações + 4 polimentos técnicos
        IF i IN (5, 16) THEN
          v_s_prim := 6; v_tem_combo := true; v_s_sec := 7;
        ELSIF i IN (2, 8, 13, 20) THEN
          v_s_prim := 5; v_tem_combo := true; v_s_sec := 7;
        ELSIF i % 3 = 0 THEN
          v_s_prim := 4; v_tem_combo := true; v_s_sec := 1;
        ELSE
          v_s_prim := 2; v_tem_combo := true; v_s_sec := 1;
        END IF;
      ELSIF m_offset = 1 THEN
        -- Mês 5 (~R$ 28k): mix consolidado de alto valor
        IF i IN (4, 13, 22) THEN
          v_s_prim := 6; v_tem_combo := true; v_s_sec := 7;
        ELSIF i IN (2, 8, 16, 23) THEN
          v_s_prim := 5; v_tem_combo := true; v_s_sec := 2;
        ELSIF i % 3 = 0 THEN
          v_s_prim := 4; v_tem_combo := true; v_s_sec := 1;
        ELSE
          v_s_prim := 2; v_tem_combo := true; v_s_sec := 1;
        END IF;
      ELSE
        -- Mês 6 atual (~R$ 32k até hoje): recorde mensal + crescimento positivo vs mês anterior
        IF i IN (4, 11, 18, 25) THEN
          v_s_prim := 6; v_tem_combo := true; v_s_sec := 2;
        ELSIF i IN (2, 8, 14, 20, 26) THEN
          v_s_prim := 5; v_tem_combo := true; v_s_sec := 7;
        ELSIF i % 3 = 0 THEN
          v_s_prim := 4; v_tem_combo := true; v_s_sec := 1;
        ELSE
          v_s_prim := 2; v_tem_combo := true; v_s_sec := 1;
        END IF;
      END IF;

      -- No atendimento concluído HOJE de manhã, garante serviço rápido (Lavagem Detalhada + Vidros)
      IF m_offset = 0 AND i = v_qtd_mes THEN
        v_s_prim := 1;
        v_tem_combo := true;
        v_s_sec := 7;
      END IF;

      v_preco_1 := round(v_serv_precos_hatch[v_s_prim] * v_mult_cat, 0);
      v_dur_1 := round(v_serv_duracoes[v_s_prim] * (CASE v_mult_cat WHEN 1.00 THEN 1.0 WHEN 1.15 THEN 1.10 WHEN 1.32 THEN 1.20 ELSE 1.30 END))::int;
      v_preco_2 := 0;
      v_dur_2 := 0;

      IF v_tem_combo AND v_s_sec IS NOT NULL THEN
        v_preco_2 := round(v_serv_precos_hatch[v_s_sec] * v_mult_cat, 0);
        v_dur_2 := round(v_serv_duracoes[v_s_sec] * (CASE v_mult_cat WHEN 1.00 THEN 1.0 WHEN 1.15 THEN 1.10 WHEN 1.32 THEN 1.20 ELSE 1.30 END))::int;
      END IF;

      v_preco_tot := v_preco_1 + v_preco_2;
      v_dur_tot := LEAST(540, v_dur_1 + v_dur_2);

      -- Mantém término antes das 20h BRT para consistência absoluta entre fuso BRT e UTC nos relatórios
      IF m_offset = 0 AND i = v_qtd_mes THEN
        v_hora_ini := 9;
      ELSIF v_dur_tot >= 300 THEN
        v_hora_ini := 8 + (i % 3);
      ELSE
        v_hora_ini := 8 + ((i * 2) % 7);
      END IF;

      v_ts_ini := ((v_dia_data::text || ' ' || lpad(v_hora_ini::text, 2, '0') || ':00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
      v_ts_fim := v_ts_ini + (v_dur_tot || ' minutes')::interval;
      IF m_offset = 0 AND v_ts_fim > now() THEN
        v_ts_fim := GREATEST((v_mes_ini::text || ' 08:30:00')::timestamp AT TIME ZONE 'America/Sao_Paulo', now() - interval '20 minutes');
        v_ts_ini := GREATEST((v_mes_ini::text || ' 07:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo', v_ts_fim - (v_dur_tot || ' minutes')::interval);
      END IF;

      INSERT INTO public.agendamentos (
        tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
        inicio, duracao_minutos, duracao_total,
        modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
        preco_estimado, preco_estimado_total,
        status, origem, numero_os,
        sinal_valor, sinal_status,
        criado_por, created_at, updated_at
      ) VALUES (
        v_tenant_id, v_clientes[v_idx_cli], v_veiculos[v_idx_veic], v_serv_ids[v_s_prim], v_cat_id,
        v_ts_ini, v_dur_tot, v_dur_tot,
        v_serv_modos[v_s_prim], v_serv_modos[v_s_prim], 1,
        v_preco_tot, v_preco_tot,
        'concluido', CASE WHEN i % 5 = 0 THEN 'online' ELSE 'interno' END, v_os_seq,
        NULL, 'nao_aplicavel',
        v_user_id, v_ts_ini - interval '1 day', v_ts_fim
      ) RETURNING id INTO v_ag_id;

      INSERT INTO public.agendamento_itens (
        tenant_id, agendamento_id, servico_id, servico_nome,
        duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
      ) VALUES (
        v_tenant_id, v_ag_id, v_serv_ids[v_s_prim], v_serv_nomes[v_s_prim],
        v_dur_1, v_preco_1, v_serv_modos[v_s_prim], 1, 1
      ) RETURNING id INTO v_ag_item_1;

      v_ag_item_2 := NULL;
      IF v_tem_combo AND v_s_sec IS NOT NULL THEN
        INSERT INTO public.agendamento_itens (
          tenant_id, agendamento_id, servico_id, servico_nome,
          duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
        ) VALUES (
          v_tenant_id, v_ag_id, v_serv_ids[v_s_sec], v_serv_nomes[v_s_sec],
          v_dur_2, v_preco_2, v_serv_modos[v_s_sec], 1, 2
        ) RETURNING id INTO v_ag_item_2;
      END IF;

      -- Restaura updated_at histórico após trigger trg_agendamento_itens_recalcular
      UPDATE public.agendamentos
      SET updated_at = v_ts_fim
      WHERE id = v_ag_id;

      -- Check-in assinado para atendimentos recentes
      IF m_offset <= 2 THEN
        INSERT INTO public.checkins (
          tenant_id, agendamento_id, veiculo_id, km, nivel_combustivel, estepe,
          observacoes, assinatura_path, assinado_em, assinatura_nome, finalizado,
          criado_por, created_at, updated_at
        ) VALUES (
          v_tenant_id, v_ag_id, v_veiculos[v_idx_veic],
          18500 + (v_os_seq * 430), 4 + (v_os_seq % 4), true,
          'Vistoria de entrada conferida sem intercorrências.',
          v_assinatura_dummy, v_ts_ini, 'Cliente Conferido', true,
          v_user_id, v_ts_ini, v_ts_ini
        );
      END IF;

      -- Execução finalizada
      INSERT INTO public.execucoes (
        tenant_id, agendamento_id, status,
        iniciado_em, finalizado_em, segundos_pausados,
        tempo_efetivo_minutos, segundos_trabalhados,
        valor_total_final, valor_definido_por, valor_definido_em,
        created_at, updated_at
      ) VALUES (
        v_tenant_id, v_ag_id, 'finalizado',
        v_ts_ini, v_ts_fim, 0,
        v_dur_tot, v_dur_tot * 60,
        v_preco_tot, v_user_id, v_ts_fim,
        v_ts_ini, v_ts_fim
      ) RETURNING id INTO v_exec_id;

      INSERT INTO public.execucao_valores (tenant_id, execucao_id, agendamento_item_id, valor_estimado, valor_final)
      VALUES (v_tenant_id, v_exec_id, v_ag_item_1, v_preco_1, v_preco_1);

      IF v_ag_item_2 IS NOT NULL THEN
        INSERT INTO public.execucao_valores (tenant_id, execucao_id, agendamento_item_id, valor_estimado, valor_final)
        VALUES (v_tenant_id, v_exec_id, v_ag_item_2, v_preco_2, v_preco_2);
      END IF;

      -- Somente o dono como executor (sem equipe extra)
      INSERT INTO public.execucao_executores (
        tenant_id, execucao_id, member_id, principal,
        comissao_tipo, comissao_valor, comissao_calculada
      ) VALUES (
        v_tenant_id, v_exec_id, v_member_id, true,
        NULL, 0, 0
      );

      -- Consumos de produtos coerentes com o serviço
      SELECT custo_unitario INTO v_custo_unit FROM public.produtos WHERE id = v_prod_shampoo;
      v_qtd_cons := CASE WHEN v_s_prim IN (1, 3, 4, 5, 6) THEN 80 + (v_os_seq % 40) ELSE 40 END;
      INSERT INTO public.execucao_consumos (tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por, created_at)
      VALUES (v_tenant_id, v_exec_id, v_prod_shampoo, v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_user_id, v_ts_fim);
      INSERT INTO public.estoque_movimentos (tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, observacao, criado_por, created_at)
      VALUES (v_tenant_id, v_prod_shampoo, 'consumo', v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_exec_id, 'OS #' || v_os_seq, v_user_id, v_ts_fim);

      IF v_s_prim = 2 OR v_s_sec = 2 THEN
        SELECT custo_unitario INTO v_custo_unit FROM public.produtos WHERE id = v_prod_sintra;
        v_qtd_cons := 160;
        INSERT INTO public.execucao_consumos (tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por, created_at)
        VALUES (v_tenant_id, v_exec_id, v_prod_sintra, v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_user_id, v_ts_fim);
        INSERT INTO public.estoque_movimentos (tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, observacao, criado_por, created_at)
        VALUES (v_tenant_id, v_prod_sintra, 'consumo', v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_exec_id, 'OS #' || v_os_seq, v_user_id, v_ts_fim);
      END IF;

      IF v_s_prim IN (4, 5) THEN
        SELECT custo_unitario INTO v_custo_unit FROM public.produtos WHERE id = v_prod_polidor;
        v_qtd_cons := CASE WHEN v_s_prim = 5 THEN 95 ELSE 60 END;
        INSERT INTO public.execucao_consumos (tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por, created_at)
        VALUES (v_tenant_id, v_exec_id, v_prod_polidor, v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_user_id, v_ts_fim);
        INSERT INTO public.estoque_movimentos (tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, observacao, criado_por, created_at)
        VALUES (v_tenant_id, v_prod_polidor, 'consumo', v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_exec_id, 'OS #' || v_os_seq, v_user_id, v_ts_fim);
      ELSIF v_s_prim = 6 THEN
        SELECT custo_unitario INTO v_custo_unit FROM public.produtos WHERE id = v_prod_vitrif;
        v_qtd_cons := 22;
        INSERT INTO public.execucao_consumos (tenant_id, execucao_id, produto_id, quantidade, custo_unitario, custo_total, registrado_por, created_at)
        VALUES (v_tenant_id, v_exec_id, v_prod_vitrif, v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_user_id, v_ts_fim);
        INSERT INTO public.estoque_movimentos (tenant_id, produto_id, tipo, quantidade, custo_unitario, custo_total, execucao_id, observacao, criado_por, created_at)
        VALUES (v_tenant_id, v_prod_vitrif, 'consumo', v_qtd_cons, v_custo_unit, round(v_qtd_cons * v_custo_unit, 2), v_exec_id, 'OS #' || v_os_seq, v_user_id, v_ts_fim);

        -- Emite certificado de garantia para vitrificação
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'certificados_garantia') THEN
          INSERT INTO public.certificados_garantia (
            codigo, tenant_id, agendamento_id, cliente_id, veiculo_id, servico_id,
            servico_nome, produto_aplicado, garantia_meses, intervalo_manutencao_dias,
            data_aplicacao, data_vencimento, observacoes, status, created_at, updated_at
          ) VALUES (
            'CERT-' || lpad(v_cert_seq::text, 4, '0') || '-' || upper(substr(v_tenant_id::text, 1, 4)),
            v_tenant_id, v_ag_id, v_clientes[v_idx_cli], v_veiculos[v_idx_veic], v_serv_ids[v_s_prim],
            'Vitrificação de Pintura 9H', 'Coating Cerâmico 9H Vonixx', 36, 180,
            v_dia_data, (v_dia_data + interval '36 months')::date,
            'Garantia condicionada à revisão semestral de manutenção.',
            'ativo', v_ts_fim, v_ts_fim
          );
          v_cert_seq := v_cert_seq + 1;
        END IF;
      END IF;

      -- Recebimentos com taxas reais de cartão / Pix / Fiado
      v_pag_roll := (v_os_seq % 10);
      IF v_pag_roll IN (0, 1, 2, 3) THEN
        v_forma_escolhida := v_fp_pix;
        v_forma_tipo := 'pix';
        v_bandeira := NULL;
        v_parcelas := 1;
        v_taxa_perc := 0.00;
      ELSIF v_pag_roll IN (4, 5) THEN
        v_forma_escolhida := v_fp_debito;
        v_forma_tipo := 'debito';
        v_bandeira := CASE WHEN v_os_seq % 2 = 0 THEN 'visa' ELSE 'mastercard' END;
        v_parcelas := 1;
        v_taxa_perc := 1.39;
      ELSIF v_pag_roll IN (6, 7, 8) THEN
        v_forma_escolhida := v_fp_credito;
        v_forma_tipo := 'credito';
        v_bandeira := CASE WHEN v_os_seq % 3 = 0 THEN 'elo' ELSE 'mastercard' END;
        v_parcelas := CASE WHEN v_preco_tot >= 1000 THEN 3 WHEN v_preco_tot >= 450 THEN 2 ELSE 1 END;
        v_taxa_perc := CASE v_parcelas WHEN 1 THEN 3.15 WHEN 2 THEN 4.49 ELSE 5.39 END;
      ELSE
        IF m_offset = 0 THEN
          v_forma_escolhida := v_fp_fiado;
          v_forma_tipo := 'fiado';
          v_bandeira := NULL;
          v_parcelas := 2;
          v_taxa_perc := 0.00;
        ELSE
          v_forma_escolhida := v_fp_dinheiro;
          v_forma_tipo := 'dinheiro';
          v_bandeira := NULL;
          v_parcelas := 1;
          v_taxa_perc := 0.00;
        END IF;
      END IF;

      v_val_resto := v_preco_tot;
      FOR v_p IN 1..v_parcelas LOOP
        IF v_p = v_parcelas THEN
          v_val_parcela := v_val_resto;
        ELSE
          v_val_parcela := round(v_preco_tot / v_parcelas::numeric, 2);
          v_val_resto := v_val_resto - v_val_parcela;
        END IF;

        v_val_taxa := round(v_val_parcela * (v_taxa_perc / 100.0), 2);
        v_val_liq := v_val_parcela - v_val_taxa;
        v_previsto := (v_dia_data + ((v_p - 1) * 30))::date;

        IF m_offset > 0 OR v_previsto < v_hoje - 5 OR (v_forma_tipo IN ('pix', 'debito', 'dinheiro')) THEN
          v_rec_status := 'recebido';
          v_rec_em := LEAST(now(), (v_previsto::text || ' 16:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
        ELSE
          v_rec_status := 'previsto';
          v_rec_em := NULL;
          IF v_forma_tipo = 'fiado' AND v_p = 1 AND v_previsto >= v_hoje THEN
            v_previsto := v_hoje;
          END IF;
        END IF;

        INSERT INTO public.recebimentos (
          tenant_id, execucao_id, agendamento_id, cliente_id, forma_id,
          maquininha_id, bandeira_codigo, taxa_estimada,
          numero_parcela, total_parcelas, valor_bruto,
          taxa_percentual_snapshot, taxa_fixa_snapshot, valor_taxa, valor_liquido,
          previsto_para, recebido_em, status, origem, observacao, criado_por, created_at
        ) VALUES (
          v_tenant_id, v_exec_id, v_ag_id, v_clientes[v_idx_cli], v_forma_escolhida,
          CASE WHEN v_forma_tipo IN ('debito', 'credito') THEN v_maq_id ELSE NULL END,
          v_bandeira, false,
          v_p, v_parcelas, v_val_parcela,
          v_taxa_perc, 0.00, v_val_taxa, v_val_liq,
          v_previsto, v_rec_em, v_rec_status, 'manual',
          'OS #' || v_os_seq || ' - ' || v_serv_nomes[v_s_prim],
          v_user_id, v_ts_fim
        );
      END LOOP;

      -- Calcula lucro real oficial via RPC da plataforma
      PERFORM public.fechar_resultado_execucao(v_exec_id);

      -- Orçamento aprovado vinculado às OS de maior valor (Polimento / Vitrificação)
      IF v_s_prim IN (4, 5, 6) THEN
        INSERT INTO public.orcamentos (
          tenant_id, numero, numero_os, cliente_id, veiculo_id, categoria_id,
          titulo, status, modo_orcamento, nivel_aprovado, validade_dias,
          enviado_em, visualizado_em, respondido_em, agendamento_id,
          criado_por, created_at, updated_at
        ) VALUES (
          v_tenant_id, v_orc_seq, v_os_seq, v_clientes[v_idx_cli], v_veiculos[v_idx_veic], v_cat_id,
          'Proposta ' || v_serv_nomes[v_s_prim], 'aprovado', '3_niveis', 'recomendado', 7,
          v_ts_ini - interval '3 days', v_ts_ini - interval '2 days', v_ts_ini - interval '2 days', v_ag_id,
          v_user_id, v_ts_ini - interval '3 days', v_ts_ini - interval '2 days'
        ) RETURNING id INTO v_orc_id;

        INSERT INTO public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, valor_total, duracao_total, destaque, ordem)
        VALUES
          (v_tenant_id, v_orc_id, 'essencial', 'Essencial', 'Tratamento principal', round(v_serv_precos_hatch[1] * v_mult_cat, 0), 90, false, 1)
          RETURNING id INTO v_niv_ess;

        INSERT INTO public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, valor_total, duracao_total, destaque, ordem)
        VALUES
          (v_tenant_id, v_orc_id, 'recomendado', 'Recomendado', 'Melhor custo-benefício com proteção', v_preco_tot, v_dur_tot, true, 2)
          RETURNING id INTO v_niv_rec;

        INSERT INTO public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, valor_total, duracao_total, destaque, ordem)
        VALUES
          (v_tenant_id, v_orc_id, 'completo', 'Completo / Proteção Total', 'Pacote estético completo', v_preco_tot + round(v_serv_precos_hatch[2] * v_mult_cat, 0), v_dur_tot + 120, false, 3)
          RETURNING id INTO v_niv_com;

        INSERT INTO public.orcamento_nivel_itens (tenant_id, nivel_id, servico_id, servico_nome, preco, duracao_minutos, ordem)
        VALUES
          (v_tenant_id, v_niv_ess, v_serv_ids[1], v_serv_nomes[1], round(v_serv_precos_hatch[1] * v_mult_cat, 0), 90, 1),
          (v_tenant_id, v_niv_rec, v_serv_ids[v_s_prim], v_serv_nomes[v_s_prim], v_preco_1, v_dur_1, 1),
          (v_tenant_id, v_niv_com, v_serv_ids[v_s_prim], v_serv_nomes[v_s_prim], v_preco_1, v_dur_1, 1),
          (v_tenant_id, v_niv_com, v_serv_ids[2], v_serv_nomes[2], round(v_serv_precos_hatch[2] * v_mult_cat, 0), 120, 2);

        v_orc_seq := v_orc_seq + 1;
      END IF;

      v_total_faturado := v_total_faturado + v_preco_tot;
      IF m_offset = 0 THEN v_fat_m0 := v_fat_m0 + v_preco_tot;
      ELSIF m_offset = 1 THEN v_fat_m1 := v_fat_m1 + v_preco_tot;
      ELSIF m_offset = 2 THEN v_fat_m2 := v_fat_m2 + v_preco_tot;
      ELSIF m_offset = 3 THEN v_fat_m3 := v_fat_m3 + v_preco_tot;
      ELSIF m_offset = 4 THEN v_fat_m4 := v_fat_m4 + v_preco_tot;
      ELSE v_fat_m5 := v_fat_m5 + v_preco_tot;
      END IF;

      v_os_seq := v_os_seq + 1;
    END LOOP;

    -- Meta mensal progressiva para cada um dos 6 meses
    INSERT INTO public.tenant_metas (tenant_id, mes, tipo, valor, criado_por, created_at)
    VALUES (
      v_tenant_id,
      v_mes_ini,
      'faturamento',
      CASE m_offset
        WHEN 5 THEN 11500.00
        WHEN 4 THEN 16500.00
        WHEN 3 THEN 21500.00
        WHEN 2 THEN 25000.00
        WHEN 1 THEN 30000.00
        ELSE 36000.00
      END,
      v_user_id,
      v_mes_ini::timestamptz
    );
  END LOOP;

  ------------------------------------------------------------------------------
  -- 9. OPERAÇÃO AO VIVO (HOJE E PRÓXIMOS DIAS) + ORÇAMENTOS ABERTOS
  ------------------------------------------------------------------------------
  -- 9.1 Em Execução AGORA (cronômetro rodando ao vivo + check-in pendente)
  v_ts_ini := now() - interval '68 minutes';
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem, numero_os,
    sinal_valor, sinal_status, observacoes, criado_por, created_at, updated_at
  ) VALUES (
    v_tenant_id, v_clientes[5], v_veiculos[5], v_serv_ids[5], v_cat_sedan,
    v_ts_ini, 420, 420, 'dia_inteiro', 'dia_inteiro', 1,
    1208.00, 1208.00, 'em_andamento', 'interno', v_os_seq,
    362.40, 'pago', 'Polimento técnico em etapas na BMW 320i', v_user_id, v_ts_ini - interval '2 days', v_ts_ini
  ) RETURNING id INTO v_ag_id;

  INSERT INTO public.agendamento_itens (tenant_id, agendamento_id, servico_id, servico_nome, duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem)
  VALUES (v_tenant_id, v_ag_id, v_serv_ids[5], v_serv_nomes[5], 420, 1208.00, 'dia_inteiro', 1, 1);

  UPDATE public.agendamentos SET updated_at = v_ts_ini WHERE id = v_ag_id;

  INSERT INTO public.execucoes (tenant_id, agendamento_id, status, iniciado_em, segundos_pausados, created_at, updated_at)
  VALUES (v_tenant_id, v_ag_id, 'em_andamento', v_ts_ini, 0, v_ts_ini, v_ts_ini)
  RETURNING id INTO v_exec_id;

  INSERT INTO public.execucao_executores (tenant_id, execucao_id, member_id, principal, comissao_valor, comissao_calculada)
  VALUES (v_tenant_id, v_exec_id, v_member_id, true, 0, 0);

  INSERT INTO public.checkins (tenant_id, agendamento_id, veiculo_id, km, nivel_combustivel, estepe, observacoes, finalizado, criado_por, created_at, updated_at)
  VALUES (v_tenant_id, v_ag_id, v_veiculos[5], 24800, 6, true, 'Aguardando assinatura digital do cliente', false, v_user_id, v_ts_ini, v_ts_ini);

  v_os_seq := v_os_seq + 1;

  -- 9.2 Aguardando início HOJE (confirmado)
  v_ts_ini := GREATEST(now() + interval '90 minutes', ((v_hoje::text || ' 16:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'));
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem, numero_os,
    sinal_valor, sinal_status, criado_por, created_at, updated_at
  ) VALUES (
    v_tenant_id, v_clientes[14], v_veiculos[14], v_serv_ids[1], v_cat_suv,
    v_ts_ini, 108, 108, 'slot', 'slot', 1,
    211.00, 211.00, 'confirmado', 'online', v_os_seq,
    NULL, 'nao_aplicavel', v_user_id, now() - interval '1 day', now() - interval '1 day'
  ) RETURNING id INTO v_ag_id;

  INSERT INTO public.agendamento_itens (tenant_id, agendamento_id, servico_id, servico_nome, duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem)
  VALUES (v_tenant_id, v_ag_id, v_serv_ids[1], v_serv_nomes[1], 108, 211.00, 'slot', 1, 1);

  v_os_seq := v_os_seq + 1;

  -- 9.3 Agendado AMANHÃ sem confirmação (aparece em Precisa de Ação)
  v_ts_ini := (((v_hoje + 1)::text || ' 09:30:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem, numero_os,
    sinal_valor, sinal_status, criado_por, created_at, updated_at
  ) VALUES (
    v_tenant_id, v_clientes[15], v_veiculos[15], v_serv_ids[6], v_cat_suv,
    v_ts_ini, 576, 576, 'dia_inteiro', 'dia_inteiro', 1,
    2178.00, 2178.00, 'agendado', 'interno', v_os_seq,
    NULL, 'nao_aplicavel', v_user_id, now() - interval '6 hours', now() - interval '6 hours'
  ) RETURNING id INTO v_ag_id;

  INSERT INTO public.agendamento_itens (tenant_id, agendamento_id, servico_id, servico_nome, duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem)
  VALUES (v_tenant_id, v_ag_id, v_serv_ids[6], v_serv_nomes[6], 576, 2178.00, 'dia_inteiro', 1, 1);

  v_os_seq := v_os_seq + 1;

  -- 9.4 Agendamento confirmado para daqui a 2 dias
  v_ts_ini := (((v_hoje + 2)::text || ' 10:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo');
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem, numero_os,
    sinal_valor, sinal_status, criado_por, created_at, updated_at
  ) VALUES (
    v_tenant_id, v_clientes[8], v_veiculos[8], v_serv_ids[2], v_cat_suv,
    v_ts_ini, 216, 216, 'slot', 'slot', 1,
    502.00, 502.00, 'confirmado', 'interno', v_os_seq,
    NULL, 'nao_aplicavel', v_user_id, now() - interval '12 hours', now() - interval '12 hours'
  ) RETURNING id INTO v_ag_id;

  INSERT INTO public.agendamento_itens (tenant_id, agendamento_id, servico_id, servico_nome, duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem)
  VALUES (v_tenant_id, v_ag_id, v_serv_ids[2], v_serv_nomes[2], 216, 502.00, 'slot', 1, 1);

  v_os_seq := v_os_seq + 1;

  -- 9.5 Parcela atrasada de exemplo (para mostrar Cobrança no Radar e Contas a Receber)
  INSERT INTO public.recebimentos (
    tenant_id, cliente_id, forma_id, taxa_estimada,
    numero_parcela, total_parcelas, valor_bruto,
    taxa_percentual_snapshot, taxa_fixa_snapshot, valor_taxa, valor_liquido,
    previsto_para, recebido_em, status, origem, observacao, criado_por, created_at
  ) VALUES (
    v_tenant_id, v_clientes[13], v_fp_fiado, false,
    2, 2, 480.00,
    0.00, 0.00, 0.00, 480.00,
    (v_hoje - 4), NULL, 'previsto', 'manual',
    'Parcela 2/2 - Higienização + Polimento Comercial',
    v_user_id, now() - interval '34 days'
  );

  -- 9.6 Orçamentos pendentes (expirando nos próximos dias + 2 recusados)
  FOR i IN 1..4 LOOP
    INSERT INTO public.orcamentos (
      tenant_id, numero, cliente_id, veiculo_id, categoria_id,
      titulo, status, modo_orcamento, validade_dias,
      enviado_em, visualizado_em, criado_por, created_at, updated_at
    ) VALUES (
      v_tenant_id, v_orc_seq, v_clientes[16 + i], v_veiculos[16 + i], v_veic_cats[16 + i],
      CASE i
        WHEN 1 THEN 'Vitrificação + Higienização Completa'
        WHEN 2 THEN 'Polimento Técnico em 3 Etapas'
        WHEN 3 THEN 'Revitalização Interna e Couro'
        ELSE 'Pacote Proteção 9H'
      END,
      CASE WHEN i <= 2 THEN 'enviado' ELSE 'recusado' END,
      '3_niveis', 7,
      CASE WHEN i <= 2 THEN now() - interval '5 days' ELSE now() - interval '12 days' END,
      CASE WHEN i IN (2, 3, 4) THEN now() - interval '4 days' ELSE NULL END,
      v_user_id,
      CASE WHEN i <= 2 THEN now() - interval '5 days' ELSE now() - interval '12 days' END,
      CASE WHEN i <= 2 THEN now() - interval '5 days' ELSE now() - interval '10 days' END
    ) RETURNING id INTO v_orc_id;

    INSERT INTO public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, valor_total, duracao_total, destaque, ordem)
    VALUES
      (v_tenant_id, v_orc_id, 'essencial', 'Essencial', 'Lavagem técnica completa', 211.00, 108, false, 1)
      RETURNING id INTO v_niv_ess;

    INSERT INTO public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, valor_total, duracao_total, destaque, ordem)
    VALUES
      (v_tenant_id, v_orc_id, 'recomendado', 'Recomendado', 'Polimento técnico + proteção', 1386.00, 480, true, 2)
      RETURNING id INTO v_niv_rec;

    INSERT INTO public.orcamento_niveis (tenant_id, orcamento_id, nivel, titulo, descricao, valor_total, duracao_total, destaque, ordem)
    VALUES
      (v_tenant_id, v_orc_id, 'completo', 'Completo / Proteção Total', 'Vitrificação 9H + higienização interna', 2680.00, 660, false, 3)
      RETURNING id INTO v_niv_com;

    INSERT INTO public.orcamento_nivel_itens (tenant_id, nivel_id, servico_id, servico_nome, preco, duracao_minutos, ordem)
    VALUES
      (v_tenant_id, v_niv_ess, v_serv_ids[1], v_serv_nomes[1], 211.00, 108, 1),
      (v_tenant_id, v_niv_rec, v_serv_ids[5], v_serv_nomes[5], 1386.00, 480, 1),
      (v_tenant_id, v_niv_com, v_serv_ids[6], v_serv_nomes[6], 2178.00, 576, 1),
      (v_tenant_id, v_niv_com, v_serv_ids[2], v_serv_nomes[2], 502.00, 180, 2);

    v_orc_seq := v_orc_seq + 1;
  END LOOP;

  ------------------------------------------------------------------------------
  -- 10. ATUALIZA CONTADORES DE OS E ORÇAMENTO PARA PRÓXIMOS NÚMEROS LIVRES
  ------------------------------------------------------------------------------
  INSERT INTO public.tenant_contadores (tenant_id, proxima_os, proximo_orcamento, ultimo_marco_exibido)
  VALUES (v_tenant_id, v_os_seq, v_orc_seq, 100)
  ON CONFLICT (tenant_id) DO UPDATE
  SET proxima_os = EXCLUDED.proxima_os,
      proximo_orcamento = EXCLUDED.proximo_orcamento,
      ultimo_marco_exibido = 100;

  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'CONTA DEMO POPULADA COM SUCESSO: % (Tenant ID: %)', v_tenant_nome, v_tenant_id;
  RAISE NOTICE '  - Plano: STUDIO (Cortesia Sem Prazo / R$ 0,00)';
  RAISE NOTICE '  - Faturamento Mês 1 (-5m): R$ %', round(v_fat_m5, 2);
  RAISE NOTICE '  - Faturamento Mês 2 (-4m): R$ %', round(v_fat_m4, 2);
  RAISE NOTICE '  - Faturamento Mês 3 (-3m): R$ %', round(v_fat_m3, 2);
  RAISE NOTICE '  - Faturamento Mês 4 (-2m): R$ %', round(v_fat_m2, 2);
  RAISE NOTICE '  - Faturamento Mês 5 (-1m): R$ %', round(v_fat_m1, 2);
  RAISE NOTICE '  - Faturamento Mês 6 (Atual): R$ % (Meta: R$ 36.000,00)', round(v_fat_m0, 2);
  RAISE NOTICE '  - Total acumulado 6 meses: R$ %', round(v_total_faturado, 2);
  RAISE NOTICE '======================================================================';
END $$;

-- Reativa todos os triggers de proteção
ALTER TABLE public.execucoes ENABLE TRIGGER trg_proteger_valores_execucao;
ALTER TABLE public.tenants ENABLE TRIGGER trg_proteger_plano_tenant;
ALTER TABLE public.despesas_fixas ENABLE TRIGGER trg_despesas_fixas_imutabilidade;
ALTER TABLE public.checkin_avarias ENABLE TRIGGER trg_checkin_avarias_imutavel;
ALTER TABLE public.checkin_fotos ENABLE TRIGGER trg_checkin_fotos_imutavel;
ALTER TABLE public.checkins ENABLE TRIGGER trg_checkin_imutavel;
