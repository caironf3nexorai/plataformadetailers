-- ==============================================================================
-- MIGRAÇÃO 0163: BLINDAGEM DE SEGURANÇA, AUTORIZAÇÃO E TENANCY (100% RETROCOMPATÍVEL)
-- 1. Garante que token_publico seja único e não-nulo em public.orcamentos
-- 2. Restringe orcamento_publico, agendar_orcamento_publico e responder_orcamento
--    ao token_publico seguro (elimina bypass por ID interno vazado)
-- 3. Protege tenant_config_whatsapp contra mutação por perfis não-gerenciais
-- 4. Protege tenant_config_fiscal contra mutação não autorizada, preservando
--    leitura para membros emitirem/visualizarem DANFSe sem quebra de telas
-- 5. Revoga execução anônima de notificar_admin (combate a spam/DoS)
-- 6. Corrige tabela inexistente em admin_salvar_config_pixels (usa is_platform_admin)
-- 7. Adiciona guarda regex contra falhas de coerção UUID em storage.objects
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: BACKFILL E GARANTIA DE INTEGRIDADE EM token_publico
-- ------------------------------------------------------------------------------
UPDATE public.orcamentos 
SET token_publico = gen_random_uuid() 
WHERE token_publico IS NULL;

ALTER TABLE public.orcamentos 
  ALTER COLUMN token_publico SET DEFAULT gen_random_uuid();


-- ------------------------------------------------------------------------------
-- PARTE 2: ORÇAMENTO PÚBLICO E PROPOSTAS COM TOKEN UNGUESSABLE (SEC-002)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.orcamento_publico(uuid);
DROP FUNCTION IF EXISTS public.orcamento_publico(text);

CREATE OR REPLACE FUNCTION public.orcamento_publico(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_tenant record;
  v_niveis_json jsonb := '[]'::jsonb;
  v_veiculo_json jsonb := null;
  v_agendamento_json jsonb := null;
  v_tem_veiculo boolean := false;
  v_tem_agendamento boolean := false;
  v_primeiro_nome text := null;
  v_cliente_tel text := null;
  v_status_atual text;
  v_modo_orc text;
  v_alteracao_pendente boolean := false;
  v_alteracao_historico_json jsonb := '[]'::jsonb;
  v_desconto_json jsonb := null;
  v_usuario_desconto_nome text := null;
  v_itens_aprovados_json jsonb := '[]'::jsonb;
  v_termo_garantia_json jsonb := null;
  v_termo_resp_final text := '';
BEGIN
  -- 1. Busca orçamento estritamente pelo token público unguessable
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  -- 2. Busca dados da oficina
  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_orcamento.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  -- 3. Verifica expiração automática por validade
  v_status_atual := v_orcamento.status;
  IF v_status_atual IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      v_status_atual := 'expirado';
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
    END IF;
  END IF;

  -- 4. Marca como 'visualizado' no primeiro acesso
  IF v_orcamento.status = 'enviado' AND v_status_atual = 'enviado' THEN
    UPDATE public.orcamentos
    SET status = 'visualizado',
        visualizado_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
    v_status_atual := 'visualizado';
  END IF;

  v_modo_orc := coalesce(v_orcamento.modo_orcamento, '3_niveis');

  -- 5. Cliente
  IF v_orcamento.cliente_id IS NOT NULL THEN
    SELECT 
      split_part(c.nome, ' ', 1),
      c.telefone
    INTO v_primeiro_nome, v_cliente_tel
    FROM public.clientes c 
    WHERE c.id = v_orcamento.cliente_id;
  END IF;

  -- 6. Veículo
  IF v_orcamento.veiculo_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', v.id,
      'modelo', v.modelo,
      'marca', v.marca,
      'placa', v.placa,
      'ano', v.ano,
      'cor', v.cor
    ) INTO v_veiculo_json
    FROM public.veiculos v 
    WHERE v.id = v_orcamento.veiculo_id;
    IF FOUND THEN
      v_tem_veiculo := true;
    END IF;
  END IF;

  -- 7. Agendamento vinculado
  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', a.id,
      'inicio', a.inicio,
      'status', a.status,
      'numero_os', a.numero_os,
      'duracao_total', coalesce(a.duracao_total, a.duracao_minutos, 60),
      'preco_estimado_total', coalesce(a.preco_estimado_total, a.preco_estimado, 0),
      'previsao_entrega', a.previsao_entrega,
      'sinal', CASE 
        WHEN coalesce(a.sinal_valor, 0) > 0 THEN jsonb_build_object(
          'ativo', true,
          'valor', a.sinal_valor,
          'status', coalesce(a.sinal_status, 'pendente'),
          'pix_chave', v_tenant.pix_chave,
          'pix_payload', CASE 
            WHEN a.sinal_status = 'pendente' AND v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
              public.gerar_payload_pix(
                v_tenant.pix_chave,
                coalesce(v_tenant.pix_nome_beneficiario, v_tenant.nome),
                coalesce(v_tenant.pix_cidade, 'SAO PAULO'),
                a.sinal_valor,
                'OS' || lpad(a.numero_os::text, 4, '0')
              )
            ELSE null 
          END
        ) 
        ELSE jsonb_build_object('ativo', false, 'valor', 0) 
      END
    ) INTO v_agendamento_json
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;
    
    IF FOUND THEN
      v_tem_agendamento := true;
    END IF;
  END IF;

  -- 8. Desconto concedido
  IF coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_aplicado_por IS NOT NULL THEN
      SELECT u.nome INTO v_usuario_desconto_nome 
      FROM public.usuarios u 
      WHERE u.id = v_orcamento.desconto_aplicado_por;
    END IF;

    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'cupom_codigo', v_orcamento.desconto_cupom_codigo,
      'aplicado_em', v_orcamento.desconto_aplicado_em,
      'aplicado_por_nome', coalesce(split_part(v_usuario_desconto_nome, ' ', 1), 'Gestor')
    );
  END IF;

  -- 9. Níveis e Itens da Proposta
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'nivel', n.nivel,
        'titulo', CASE 
          WHEN v_modo_orc = 'simples' AND (n.titulo ILIKE 'essencial' OR n.titulo IS NULL OR trim(n.titulo) = '') 
          THEN 'Proposta de Serviços' 
          ELSE n.titulo 
        END,
        'descricao', n.descricao,
        'valor_original', n.valor_total,
        'valor_total', CASE 
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'porcentagem' 
            THEN round(n.valor_total * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2)
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'valor_fixo' 
            THEN greatest(0.00, n.valor_total - v_orcamento.desconto_valor)
          ELSE n.valor_total
        END,
        'duracao_total', n.duracao_total,
        'destaque', CASE WHEN v_modo_orc = 'simples' THEN false ELSE n.destaque END,
        'ordem', n.ordem,
        'itens', coalesce(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'servico_id', i.servico_id,
                'combo_id', i.combo_id,
                'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
                'servico_descricao', coalesce(s.descricao_publica, c.descricao_publica, s.descricao_interna, ''),
                'preco', i.preco,
                'duracao_minutos', i.duracao_minutos,
                'ordem', i.ordem
              ) ORDER BY i.ordem ASC
            )
            FROM public.orcamento_nivel_itens i
            LEFT JOIN public.servicos s ON s.id = i.servico_id
            LEFT JOIN public.combos c ON c.id = i.combo_id
            WHERE i.nivel_id = n.id
          ),
          '[]'::jsonb
        )
      ) ORDER BY n.ordem ASC
    ),
    '[]'::jsonb
  ) INTO v_niveis_json
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id
    AND (v_modo_orc <> 'simples' OR n.nivel = 'essencial');

  -- Fallback para modo simples caso o nível não se chame 'essencial'
  IF v_modo_orc = 'simples' AND (v_niveis_json IS NULL OR jsonb_array_length(v_niveis_json) = 0) THEN
    SELECT coalesce(
      jsonb_agg(sub.nivel_obj),
      '[]'::jsonb
    ) INTO v_niveis_json
    FROM (
      SELECT jsonb_build_object(
        'id', n.id,
        'nivel', n.nivel,
        'titulo', coalesce(nullif(trim(n.titulo), ''), 'Proposta de Serviços'),
        'descricao', n.descricao,
        'valor_original', n.valor_total,
        'valor_total', CASE 
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'porcentagem' 
            THEN round(n.valor_total * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2)
          WHEN coalesce(v_orcamento.desconto_valor, 0) > 0 AND v_orcamento.desconto_tipo = 'valor_fixo' 
            THEN greatest(0.00, n.valor_total - v_orcamento.desconto_valor)
          ELSE n.valor_total
        END,
        'duracao_total', n.duracao_total,
        'destaque', false,
        'ordem', n.ordem,
        'itens', coalesce(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'servico_id', i.servico_id,
                'combo_id', i.combo_id,
                'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
                'servico_descricao', coalesce(s.descricao_publica, c.descricao_publica, s.descricao_interna, ''),
                'preco', i.preco,
                'duracao_minutos', i.duracao_minutos,
                'ordem', i.ordem
              ) ORDER BY i.ordem ASC
            )
            FROM public.orcamento_nivel_itens i
            LEFT JOIN public.servicos s ON s.id = i.servico_id
            LEFT JOIN public.combos c ON c.id = i.combo_id
            WHERE i.nivel_id = n.id
          ),
          '[]'::jsonb
        )
      ) AS nivel_obj
      FROM public.orcamento_niveis n
      WHERE n.orcamento_id = v_orcamento.id
      ORDER BY n.ordem ASC
      LIMIT 1
    ) sub;
  END IF;

  -- 10. Itens aprovados
  IF v_orcamento.status = 'aprovado' AND v_orcamento.nivel_aprovado IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_id', i.servico_id,
          'combo_id', i.combo_id,
          'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
          'preco', i.preco,
          'duracao_minutos', i.duracao_minutos
        ) ORDER BY i.ordem ASC
      ),
      '[]'::jsonb
    ) INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    LEFT JOIN public.combos c ON c.id = i.combo_id
    WHERE n.orcamento_id = v_orcamento.id 
      AND n.nivel = v_orcamento.nivel_aprovado;
  ELSIF v_modo_orc = 'simples' AND v_status_atual IN ('aprovado', 'em_andamento', 'concluido') THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'servico_id', i.servico_id,
          'combo_id', i.combo_id,
          'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
          'preco', i.preco,
          'duracao_minutos', i.duracao_minutos
        ) ORDER BY i.ordem ASC
      ),
      '[]'::jsonb
    ) INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    LEFT JOIN public.combos c ON c.id = i.combo_id
    WHERE n.orcamento_id = v_orcamento.id 
      AND n.nivel = coalesce(v_orcamento.nivel_aprovado, 'essencial');
  END IF;

  -- 11. Termo de Garantia
  IF v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', tg.id, 'tipo', tg.tipo, 'titulo', tg.titulo, 'conteudo', tg.conteudo)
    INTO v_termo_garantia_json
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  IF v_termo_garantia_json IS NULL THEN
    SELECT jsonb_build_object('id', tg.id, 'tipo', tg.tipo, 'titulo', tg.titulo, 'conteudo', tg.conteudo)
    INTO v_termo_garantia_json
    FROM public.termos_garantia tg
    WHERE tg.tenant_id = v_orcamento.tenant_id AND tg.padrao = true AND tg.ativo = true
    ORDER BY tg.created_at ASC
    LIMIT 1;
  END IF;

  -- 12. Termo de Responsabilidade
  v_termo_resp_final := v_orcamento.termo_responsabilidade_texto;
  IF (v_termo_resp_final IS NULL OR trim(v_termo_resp_final) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_resp_final
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_responsabilidade_id;
  END IF;
  IF v_termo_resp_final IS NULL OR trim(v_termo_resp_final) = '' THEN
    v_termo_resp_final := coalesce(v_tenant.termo_responsabilidade, '');
  END IF;

  -- 13. Retorno do Objeto JSON completo
  RETURN jsonb_build_object(
    'numero', v_orcamento.numero,
    'numero_os', v_orcamento.numero_os,
    'titulo', v_orcamento.titulo,
    'observacoes', v_orcamento.observacoes,
    'status', v_status_atual,
    'modo_orcamento', v_modo_orc,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'categoria_id', v_orcamento.categoria_id,
    'itens_aprovados', v_itens_aprovados_json,
    'validade_dias', coalesce(v_orcamento.validade_dias, 7),
    'enviado_em', v_orcamento.enviado_em,
    'data_validade_limite', CASE 
      WHEN v_orcamento.enviado_em IS NOT NULL THEN (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7))
      ELSE NULL 
    END,
    'assinatura_data', v_orcamento.assinatura_data,
    'assinatura_nome', v_orcamento.assinatura_nome,
    'assinatura_url', v_orcamento.assinatura_path,
    'cliente_primeiro_nome', v_primeiro_nome,
    'cliente_telefone', v_cliente_tel,
    'desconto', v_desconto_json,
    'incluir_termos', coalesce(v_orcamento.incluir_termos, true),
    'incluir_termo_responsabilidade', coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, true),
    'incluir_termo_garantia', coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, true),
    'garantia_meses', coalesce(v_orcamento.garantia_meses, 3),
    'incluir_termo_risco', coalesce(v_orcamento.incluir_termo_risco, false),
    'termo_risco_servico', v_orcamento.termo_risco_servico,
    'termo_risco_observacoes', v_orcamento.termo_risco_observacoes,
    'termo_risco_texto', v_orcamento.termo_risco_texto,
    'termo_responsabilidade', v_termo_resp_final,
    'termo_garantia', v_termo_garantia_json,
    'oficina', jsonb_build_object(
      'tenant_id', v_tenant.id,
      'nome', v_tenant.nome,
      'razao_social', v_tenant.razao_social,
      'documento', v_tenant.documento,
      'documento_tipo', v_tenant.documento_tipo,
      'telefone', v_tenant.telefone,
      'email', coalesce(v_tenant.email, (SELECT tm.email FROM public.tenant_members tm WHERE tm.tenant_id = v_tenant.id ORDER BY tm.created_at ASC LIMIT 1), ''),
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'logo_path', v_tenant.logo_path,
      'logo_url', coalesce(v_tenant.logo_url, v_tenant.logo_path),
      'orcamento_agendamento_cliente', coalesce(v_tenant.orcamento_agendamento_cliente, true),
      'plano', v_tenant.plano,
      'pdf_cor_primaria', v_tenant.pdf_cor_primaria,
      'pdf_cor_fundo_cabecalho', v_tenant.pdf_cor_fundo_cabecalho,
      'pdf_cor_texto_cabecalho', v_tenant.pdf_cor_texto_cabecalho,
      'pdf_cor_fundo_secoes', v_tenant.pdf_cor_fundo_secoes,
      'pdf_cor_texto_secoes', v_tenant.pdf_cor_texto_secoes,
      'pdf_subtitulo_cabecalho', v_tenant.pdf_subtitulo_cabecalho,
      'pdf_texto_observacoes_orcamento', v_tenant.pdf_texto_observacoes_orcamento,
      'pdf_texto_rodape', v_tenant.pdf_texto_rodape
    ),
    'veiculo', v_veiculo_json,
    'agendamento', v_agendamento_json,
    'niveis', v_niveis_json,
    'alteracao_pendente', v_alteracao_pendente,
    'alteracao_historico', v_alteracao_historico_json
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.orcamento_publico(uuid) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. AGENDAR_ORCAMENTO_PUBLICO (Canônica: 5 parâmetros, filtrando estritamente por token_publico)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz);

CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_tenant record;
  v_nivel_rec record;
  v_antecedencia_minima integer;
  v_agendamento_cliente_habil boolean;
  v_min_inicio timestamptz;
  v_data date;
  v_hora time;
  v_is_disponivel boolean := false;
  v_termino_previsto timestamptz;
  v_agendamento_id uuid;
  v_itens_json jsonb := '[]'::jsonb;
  v_item record;
  v_servico_id_primeiro uuid;
  v_modo_item text;
  v_dias_item smallint;
  v_ordem smallint := 0;
  v_os_num integer;
  v_modo_efetivo text := 'slot';
  v_duracao_total_calculada integer := 0;
  v_total_calculado numeric(10,2) := 0;
  v_is_transbordo boolean := false;
  v_inicio_sp date;
  v_termino_sp date;
  v_obs_final text;
  v_sinal_valor_calc numeric(10,2) := 0;
  v_sinal_status_final text := 'nao_aplicavel';
  v_status_inicial text := 'agendado';
  v_pix_payload text := null;
BEGIN
  -- 1. Busca Orçamento ESTRITAMENTE pelo Token Público (Eliminando bypass IDOR)
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status = 'expirado' THEN
    RAISE EXCEPTION 'Este orçamento está expirado e não pode ser agendado.';
  END IF;

  IF v_orcamento.status <> 'aprovado' OR v_orcamento.nivel_aprovado IS NULL THEN
    RAISE EXCEPTION 'O orçamento precisa ser aprovado antes do agendamento.';
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_orcamento.tenant_id;

  v_agendamento_cliente_habil := coalesce(v_tenant.orcamento_agendamento_cliente, true);
  v_antecedencia_minima := coalesce(v_tenant.antecedencia_minima_horas, 2);

  IF NOT v_agendamento_cliente_habil THEN
    RAISE EXCEPTION 'O agendamento online de orçamentos não está ativado nesta oficina.';
  END IF;

  v_min_inicio := now() + (v_antecedencia_minima || ' hours')::interval;
  IF p_inicio < v_min_inicio THEN
    RAISE EXCEPTION 'Agendamento deve ser feito com antecedência mínima de % horas.', v_antecedencia_minima;
  END IF;

  v_data := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_hora := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::time;

  PERFORM pg_advisory_xact_lock(hashtext(v_orcamento.tenant_id::text || ':' || v_data::text));

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dados do pacote aprovado não foram encontrados.';
  END IF;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('servico_id', servico_id, 'combo_id', combo_id)),
    '[]'::jsonb
  )
  INTO v_itens_json
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id;

  -- Consulta disponibilidade via RPC horarios_disponiveis
  SELECT disponivel, termino_previsto INTO v_is_disponivel, v_termino_previsto
  FROM public.horarios_disponiveis(
    v_orcamento.tenant_id,
    v_data,
    v_itens_json,
    v_orcamento.categoria_id,
    null
  )
  WHERE horario = v_hora;

  IF NOT coalesce(v_is_disponivel, false) THEN
    RAISE EXCEPTION 'O horário selecionado não está mais disponível na agenda.';
  END IF;

  SELECT servico_id INTO v_servico_id_primeiro
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id
  ORDER BY ordem ASC LIMIT 1;

  IF v_servico_id_primeiro IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_item, v_dias_item
    FROM public.servicos s
    WHERE s.id = v_servico_id_primeiro AND s.tenant_id = v_orcamento.tenant_id;
  END IF;

  v_modo_item := coalesce(v_modo_item, 'slot');
  v_dias_item := coalesce(v_dias_item, 1);

  IF v_modo_item IN ('transborda', 'multiplos_dias') OR v_dias_item > 1 THEN
    v_modo_efetivo := v_modo_item;
  END IF;

  FOR v_item IN SELECT * FROM public.orcamento_nivel_itens WHERE nivel_id = v_nivel_rec.id LOOP
    v_duracao_total_calculada := v_duracao_total_calculada + coalesce(v_item.duracao_minutos, 60);
    v_total_calculado := v_total_calculado + coalesce(v_item.preco, 0);
  END LOOP;

  IF v_termino_previsto IS NULL THEN
    v_termino_previsto := public.calcular_fim_efetivo(v_orcamento.tenant_id, p_inicio, v_duracao_total_calculada, v_modo_efetivo);
  END IF;

  v_inicio_sp := (p_inicio AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;
  v_termino_sp := (v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'))::date;

  IF v_termino_sp > v_inicio_sp THEN
    v_is_transbordo := true;
  END IF;

  IF v_is_transbordo AND NOT coalesce(p_transbordo_aceito, false) THEN
    RAISE EXCEPTION 'Para agendar um serviço com pernoite, é obrigatório aceitar os termos de permanência do veículo na oficina.';
  END IF;

  IF coalesce(v_tenant.sinal_ativo, false) AND coalesce(v_tenant.sinal_valor, 0) > 0 AND v_total_calculado > 0 THEN
    IF v_tenant.sinal_tipo = 'percentual' THEN
      v_sinal_valor_calc := round((v_total_calculado * v_tenant.sinal_valor / 100.0), 2);
    ELSE
      v_sinal_valor_calc := least(v_tenant.sinal_valor, v_total_calculado);
    END IF;

    IF v_sinal_valor_calc > 0 THEN
      v_sinal_status_final := 'pendente';
      v_status_inicial := 'aguardando_confirmacao';
    END IF;
  END IF;

  v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);

  v_obs_final := coalesce(v_orcamento.observacoes, '');
  IF v_is_transbordo THEN
    v_obs_final := trim(v_obs_final || ' [Transbordo Aceito pelo Cliente: Término previsto em ' || to_char(v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'), 'DD/MM/YYYY às HH24:MI') || ']');
  END IF;

  -- Cria o Agendamento
  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, categoria_id, numero_os,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem,
    observacoes, sinal_valor, sinal_status, previsao_entrega,
    transbordo_aceito_em, transbordo_aceite_user_agent, transbordo_aceite_ip
  ) VALUES (
    v_orcamento.tenant_id, v_orcamento.cliente_id, v_orcamento.veiculo_id, v_orcamento.categoria_id, v_os_num,
    p_inicio, v_duracao_total_calculada, v_duracao_total_calculada, coalesce(v_modo_efetivo, 'slot'), coalesce(v_modo_efetivo, 'slot'), coalesce(v_dias_item, 1),
    v_total_calculado, v_total_calculado, v_status_inicial, 'orcamento',
    nullif(v_obs_final, ''), v_sinal_valor_calc, v_sinal_status_final, v_termino_previsto,
    CASE WHEN v_is_transbordo THEN now() ELSE null END,
    CASE WHEN v_is_transbordo THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo THEN p_ip ELSE null END
  ) RETURNING id INTO v_agendamento_id;

  FOR v_item IN SELECT * FROM public.orcamento_nivel_itens WHERE nivel_id = v_nivel_rec.id LOOP
    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_orcamento.tenant_id, v_agendamento_id, v_item.servico_id, v_item.combo_id,
      coalesce(v_item.duracao_minutos, 60), coalesce(v_item.preco, 0), coalesce(v_modo_item, 'transborda'), coalesce(v_dias_item, 1), v_ordem
    );
    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      updated_at = now()
  WHERE id = v_orcamento.id;

  IF v_sinal_status_final = 'pendente' AND v_sinal_valor_calc > 0 AND v_tenant.pix_chave IS NOT NULL AND trim(v_tenant.pix_chave) <> '' THEN
    v_pix_payload := public.gerar_payload_pix(
      v_tenant.pix_chave,
      v_tenant.pix_nome_beneficiario,
      v_tenant.pix_cidade,
      v_sinal_valor_calc,
      'AG' || v_os_num::text
    );
  END IF;

  RETURN jsonb_build_object(
    'agendamento_id', v_agendamento_id,
    'numero_os', v_os_num,
    'status', v_status_inicial,
    'valor_total', v_total_calculado,
    'duracao_minutos', v_duracao_total_calculada,
    'termino_previsto', v_termino_previsto,
    'is_transbordo', v_is_transbordo,
    'sinal', jsonb_build_object(
      'exigido', (v_sinal_status_final = 'pendente'),
      'valor', v_sinal_valor_calc,
      'status', v_sinal_status_final,
      'pix_payload', v_pix_payload
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. RESPONDER_ORCAMENTO (Canônica: 5 parâmetros, filtrando estritamente por token_publico)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.responder_orcamento(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.responder_orcamento(
  p_token uuid,
  p_nivel text,
  p_aceite boolean,
  p_assinatura_base64 text DEFAULT NULL,
  p_nome_assinante text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_os_num integer;
  v_nome_limpo text;
  v_cliente_nome text;
  v_nivel_valor numeric(10,2) := 0;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF v_orcamento.status IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
      RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
    END IF;
  END IF;

  IF v_orcamento.status = 'expirado' THEN
    RAISE EXCEPTION 'Este orçamento está expirado e não aceita mais respostas.';
  END IF;

  IF p_aceite THEN
    IF p_nivel IS NULL OR p_nivel NOT IN ('essencial', 'recomendado', 'completo') THEN
      RAISE EXCEPTION 'Nível de orçamento inválido.';
    END IF;

    SELECT coalesce(valor_total, 0) INTO v_nivel_valor
    FROM public.orcamento_niveis
    WHERE orcamento_id = v_orcamento.id AND nivel = p_nivel;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'O nível escolhido não existe neste orçamento.';
    END IF;

    v_os_num := v_orcamento.numero_os;
    IF v_os_num IS NULL THEN
      v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
    END IF;

    v_nome_limpo := trim(coalesce(p_nome_assinante, ''));

    UPDATE public.orcamentos
    SET status = 'aprovado',
        nivel_aprovado = p_nivel,
        numero_os = v_os_num,
        respondido_em = now(),
        assinatura_path = coalesce(p_assinatura_base64, assinatura_path),
        assinatura_nome = coalesce(nullif(v_nome_limpo, ''), assinatura_nome),
        assinatura_data = CASE WHEN p_assinatura_base64 IS NOT NULL THEN now() ELSE assinatura_data END,
        updated_at = now()
    WHERE id = v_orcamento.id;

    -- Obter nome do cliente para a notificação
    SELECT COALESCE(c.nome, 'Cliente') INTO v_cliente_nome
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;

    -- Disparar Notificação Pontual para a Oficina (papel mínimo: gerente)
    PERFORM public.criar_notificacao_interna(
      v_orcamento.tenant_id,
      NULL,
      'oficina',
      'gerente',
      'orcamento_aprovado',
      '🎉 Orçamento Aprovado!',
      COALESCE(v_nome_limpo, v_cliente_nome, 'Cliente') || ' aprovou a proposta #' || LPAD(v_os_num::text, 4, '0') || ' (' || upper(p_nivel) || ') no valor de R$ ' || to_char(COALESCE(v_nivel_valor, 0), 'FM999G999G990D00') || '.',
      '/orcamentos',
      jsonb_build_object('orcamento_id', v_orcamento.id, 'numero_os', v_os_num, 'nivel', p_nivel)
    );
  ELSE
    UPDATE public.orcamentos
    SET status = 'recusado',
        nivel_aprovado = null,
        respondido_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.responder_orcamento(uuid, text, boolean, text, text) TO anon, authenticated;


-- ------------------------------------------------------------------------------
-- PARTE 3: BLINDAGEM DE RLS EM CONFIGURAÇÕES DE WHATSAPP (SEC-003)
-- Membros continuam lendo filas/dados normais, mas gravação de credenciais sensíveis
-- exige perfil administrativo da oficina ('dono' ou 'gerente').
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Usuários gerenciam config de whatsapp do seu tenant" ON public.tenant_config_whatsapp;
DROP POLICY IF EXISTS "Donos e Gerentes gerenciam config de whatsapp do seu tenant" ON public.tenant_config_whatsapp;
DROP POLICY IF EXISTS "Membros visualizam config whatsapp do seu tenant" ON public.tenant_config_whatsapp;

-- Leitura: Membros ativos do tenant
CREATE POLICY "Membros visualizam config whatsapp do seu tenant" ON public.tenant_config_whatsapp
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT public.meus_tenants()));

-- Modificação (INSERT/UPDATE/DELETE): Donos, Gerentes ou Admin Plataforma
CREATE POLICY "Donos e Gerentes gerenciam config de whatsapp do seu tenant" ON public.tenant_config_whatsapp
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (SELECT public.meus_tenants()) 
    AND (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) OR public.is_platform_admin())
  )
  WITH CHECK (
    tenant_id IN (SELECT public.meus_tenants()) 
    AND (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) OR public.is_platform_admin())
  );

-- Reforçar autorização na RPC salvar_config_whatsapp_tenant
CREATE OR REPLACE FUNCTION public.salvar_config_whatsapp_tenant(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  IF NOT (public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::public.app_role[]) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Apenas Donos ou Gerentes podem alterar as configurações de WhatsApp da oficina.';
  END IF;

  INSERT INTO public.tenant_config_whatsapp (
    tenant_id,
    provider,
    api_url,
    api_key,
    instance_name,
    instance_status,
    numero_conectado,
    lembrete_agendamento_ativo,
    lembrete_agendamento_horas,
    lembrete_agendamento_template,
    lembrete_vitrificacao_ativo,
    lembrete_vitrificacao_dias,
    lembrete_vitrificacao_template,
    lembrete_retorno_inativo_ativo,
    lembrete_retorno_inativo_dias,
    lembrete_retorno_inativo_template,
    horario_envio_padrao,
    updated_at
  ) VALUES (
    v_tenant,
    COALESCE(p_config->>'provider', 'evolution_api'),
    trim(COALESCE(p_config->>'api_url', '')),
    trim(COALESCE(p_config->>'api_key', '')),
    COALESCE(NULLIF(trim(p_config->>'instance_name'), ''), 'oficina_' || replace(v_tenant::text, '-', '')),
    COALESCE(p_config->>'instance_status', 'desconectado'),
    trim(COALESCE(p_config->>'numero_conectado', '')),
    COALESCE((p_config->>'lembrete_agendamento_ativo')::boolean, true),
    COALESCE((p_config->>'lembrete_agendamento_horas')::integer, 24),
    COALESCE(p_config->>'lembrete_agendamento_template', 'Olá {cliente}! Lembrete do seu agendamento amanhã às {hora} na {oficina} para o veículo {veiculo} ({servicos}). Podemos confirmar sua presença?'),
    COALESCE((p_config->>'lembrete_vitrificacao_ativo')::boolean, true),
    COALESCE((p_config->>'lembrete_vitrificacao_dias')::integer, 180),
    COALESCE(p_config->>'lembrete_vitrificacao_template', 'Olá {cliente}! Passaram-se {dias} dias desde a aplicação de {servico} no seu {veiculo}. Para manter a garantia e a proteção hidrofóbica em dia, está na hora da manutenção preventiva! Vamos agendar sua revisão?'),
    COALESCE((p_config->>'lembrete_retorno_inativo_ativo')::boolean, true),
    COALESCE((p_config->>'lembrete_retorno_inativo_dias')::integer, 60),
    COALESCE(p_config->>'lembrete_retorno_inativo_template', 'Olá {cliente}! Sentimos sua falta aqui na {oficina}. Seu {veiculo} já está precisando daquele trato especial? Responda aqui para reservarmos seu horário com prioridade!'),
    COALESCE((p_config->>'horario_envio_padrao')::time, '08:30:00'::time),
    now()
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    api_url = COALESCE(NULLIF(EXCLUDED.api_url, ''), tenant_config_whatsapp.api_url),
    api_key = COALESCE(NULLIF(EXCLUDED.api_key, ''), tenant_config_whatsapp.api_key),
    instance_name = COALESCE(NULLIF(EXCLUDED.instance_name, ''), tenant_config_whatsapp.instance_name),
    instance_status = COALESCE(EXCLUDED.instance_status, tenant_config_whatsapp.instance_status),
    numero_conectado = COALESCE(NULLIF(EXCLUDED.numero_conectado, ''), tenant_config_whatsapp.numero_conectado),
    lembrete_agendamento_ativo = EXCLUDED.lembrete_agendamento_ativo,
    lembrete_agendamento_horas = EXCLUDED.lembrete_agendamento_horas,
    lembrete_agendamento_template = EXCLUDED.lembrete_agendamento_template,
    lembrete_vitrificacao_ativo = EXCLUDED.lembrete_vitrificacao_ativo,
    lembrete_vitrificacao_dias = EXCLUDED.lembrete_vitrificacao_dias,
    lembrete_vitrificacao_template = EXCLUDED.lembrete_vitrificacao_template,
    lembrete_retorno_inativo_ativo = EXCLUDED.lembrete_retorno_inativo_ativo,
    lembrete_retorno_inativo_dias = EXCLUDED.lembrete_retorno_inativo_dias,
    lembrete_retorno_inativo_template = EXCLUDED.lembrete_retorno_inativo_template,
    horario_envio_padrao = EXCLUDED.horario_envio_padrao,
    updated_at = now();

  RETURN jsonb_build_object('sucesso', true, 'mensagem', 'Configurações de WhatsApp salvas com sucesso!');
END;
$$;


-- ------------------------------------------------------------------------------
-- PARTE 4: BLINDAGEM DE RLS EM CONFIGURAÇÕES FISCAIS (SEC-003)
-- Leitura garantida para qualquer membro do tenant (necessário para emissão e
-- geração do DANFSe PDF em VisualizarAtendimento sem quebra de telas).
-- Inserção/atualização/exclusão estritamente restrita a Donos e Gerentes.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Membros gerenciam config fiscal de seu tenant" ON public.tenant_config_fiscal;
DROP POLICY IF EXISTS "Donos e Gerentes gerenciam config fiscal de seu tenant" ON public.tenant_config_fiscal;
DROP POLICY IF EXISTS "Membros visualizam config fiscal de seu tenant" ON public.tenant_config_fiscal;
DROP POLICY IF EXISTS "Admins da plataforma gerenciam config fiscal" ON public.tenant_config_fiscal;

-- Leitura: Membros ativos do tenant
CREATE POLICY "Membros visualizam config fiscal de seu tenant" ON public.tenant_config_fiscal
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT public.meus_tenants()));

-- Modificação (INSERT/UPDATE/DELETE): Donos, Gerentes ou Admin Plataforma
CREATE POLICY "Donos e Gerentes gerenciam config fiscal de seu tenant" ON public.tenant_config_fiscal
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (SELECT public.meus_tenants()) 
    AND (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) OR public.is_platform_admin())
  )
  WITH CHECK (
    tenant_id IN (SELECT public.meus_tenants()) 
    AND (public.tem_papel(tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) OR public.is_platform_admin())
  );

-- Admins da plataforma continuam com acesso total
CREATE POLICY "Admins da plataforma gerenciam config fiscal" ON public.tenant_config_fiscal
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Reforçar autorização na RPC salvar_config_fiscal_tenant
CREATE OR REPLACE FUNCTION public.salvar_config_fiscal_tenant(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_clean_cnpj TEXT;
  v_cert_status TEXT;
  v_cert_valido TIMESTAMPTZ;
  v_cert_nome TEXT;
BEGIN
  v_tenant := (SELECT public.meus_tenants() LIMIT 1);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Nenhuma oficina associada';
  END IF;

  IF NOT (public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::public.app_role[]) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Apenas Donos ou Gerentes podem alterar as configurações fiscais da oficina.';
  END IF;

  v_clean_cnpj := regexp_replace(COALESCE(p_config->>'cnpj', ''), '[^0-9]', '', 'g');
  IF length(v_clean_cnpj) != 14 THEN
    RAISE EXCEPTION 'CNPJ inválido. Deve conter 14 dígitos.';
  END IF;

  v_cert_status := COALESCE(p_config->>'certificado_status', NULL);
  v_cert_valido := CASE 
    WHEN p_config->>'certificado_valido_ate' IS NOT NULL AND p_config->>'certificado_valido_ate' != '' 
    THEN (p_config->>'certificado_valido_ate')::timestamptz 
    ELSE NULL 
  END;
  v_cert_nome := COALESCE(p_config->>'certificado_nome_arquivo', NULL);

  INSERT INTO public.tenant_config_fiscal (
    tenant_id, cnpj, razao_social, nome_fantasia, inscricao_municipal,
    cnae, cnae_padrao, item_lista_servico, aliquota_iss, regime_tributario,
    ambiente, token_focus_nfe, certificado_status, certificado_valido_ate,
    certificado_nome_arquivo, certificado_enviado_em, updated_at
  ) VALUES (
    v_tenant,
    v_clean_cnpj,
    trim(COALESCE(p_config->>'razao_social', '')),
    trim(COALESCE(p_config->>'nome_fantasia', p_config->>'razao_social', '')),
    trim(COALESCE(p_config->>'inscricao_municipal', '')),
    trim(COALESCE(p_config->>'cnae_padrao', p_config->>'cnae', '4520-0/05')),
    trim(COALESCE(p_config->>'cnae_padrao', p_config->>'cnae', '4520-0/05')),
    trim(COALESCE(p_config->>'item_lista_servico', '14.01')),
    COALESCE((p_config->>'aliquota_iss')::numeric, 2.00),
    COALESCE(p_config->>'regime_tributario', '1'),
    COALESCE(p_config->>'ambiente', 'homologacao'),
    trim(COALESCE(p_config->>'token_focus_nfe', '')),
    COALESCE(v_cert_status, 'pendente'),
    v_cert_valido,
    v_cert_nome,
    CASE WHEN v_cert_status = 'ativo' THEN now() ELSE NULL END,
    now()
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    cnpj = EXCLUDED.cnpj,
    razao_social = EXCLUDED.razao_social,
    nome_fantasia = EXCLUDED.nome_fantasia,
    inscricao_municipal = EXCLUDED.inscricao_municipal,
    cnae = EXCLUDED.cnae,
    cnae_padrao = EXCLUDED.cnae_padrao,
    item_lista_servico = EXCLUDED.item_lista_servico,
    aliquota_iss = EXCLUDED.aliquota_iss,
    regime_tributario = EXCLUDED.regime_tributario,
    ambiente = EXCLUDED.ambiente,
    token_focus_nfe = COALESCE(NULLIF(EXCLUDED.token_focus_nfe, ''), tenant_config_fiscal.token_focus_nfe),
    certificado_status = COALESCE(v_cert_status, tenant_config_fiscal.certificado_status, 'pendente'),
    certificado_valido_ate = COALESCE(v_cert_valido, tenant_config_fiscal.certificado_valido_ate),
    certificado_nome_arquivo = COALESCE(v_cert_nome, tenant_config_fiscal.certificado_nome_arquivo),
    certificado_enviado_em = CASE 
      WHEN v_cert_status = 'ativo' THEN now() 
      ELSE tenant_config_fiscal.certificado_enviado_em 
    END,
    updated_at = now();

  RETURN jsonb_build_object(
    'sucesso', true, 
    'mensagem', 'Configuração fiscal e certificado digital salvos com sucesso!'
  );
END;
$$;


-- ------------------------------------------------------------------------------
-- PARTE 5: REVOGAÇÃO DE PERMISSÃO ANÔNIMA EM notificar_admin (SEC-004)
-- A criação de oficinas em criar_oficina continua funcionando normalmente por ser
-- uma rotina SECURITY DEFINER (executada com os privilégios do proprietário).
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.notificar_admin(TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.notificar_admin(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- PARTE 6: CORREÇÃO DE SCHEMA EM admin_salvar_config_pixels (SEC-005)
-- Substitui a referência à tabela inexistente admin_users pela função oficial is_platform_admin.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_salvar_config_pixels(
  p_meta_pixel_id TEXT DEFAULT NULL,
  p_google_ads_id TEXT DEFAULT NULL,
  p_google_analytics_id TEXT DEFAULT NULL,
  p_tiktok_pixel_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores da plataforma podem alterar pixels de marketing.';
  END IF;

  UPDATE public.plataforma_config
  SET 
    meta_pixel_id = NULLIF(TRIM(p_meta_pixel_id), ''),
    google_ads_id = NULLIF(TRIM(p_google_ads_id), ''),
    google_analytics_id = NULLIF(TRIM(p_google_analytics_id), ''),
    tiktok_pixel_id = NULLIF(TRIM(p_tiktok_pixel_id), ''),
    updated_at = NOW()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Configurações de pixels atualizadas com sucesso.',
    'meta_pixel_id', p_meta_pixel_id,
    'google_ads_id', p_google_ads_id,
    'google_analytics_id', p_google_analytics_id,
    'tiktok_pixel_id', p_tiktok_pixel_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_salvar_config_pixels(TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ------------------------------------------------------------------------------
-- PARTE 7: BLINDAGEM DE STORAGE BUCKET CONTRA ERROS DE COERÇÃO UUID (SEC-008)
-- Valida que a pasta é um UUID antes de tentar o cast ::uuid no PostgreSQL.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Membros autenticados podem ver evidencias do tenant" ON storage.objects;
CREATE POLICY "Membros autenticados podem ver evidencias do tenant"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'evidencias'
    AND array_length(storage.foldername(name), 1) >= 2
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.meus_tenants())
  );

DROP POLICY IF EXISTS "Membros autenticados podem enviar evidencias do tenant" ON storage.objects;
CREATE POLICY "Membros autenticados podem enviar evidencias do tenant"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'evidencias'
    AND array_length(storage.foldername(name), 1) >= 2
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.meus_tenants())
  );

DROP POLICY IF EXISTS "Membros autenticados podem atualizar evidencias do tenant" ON storage.objects;
CREATE POLICY "Membros autenticados podem atualizar evidencias do tenant"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'evidencias'
    AND array_length(storage.foldername(name), 1) >= 2
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.meus_tenants())
  );

DROP POLICY IF EXISTS "Membros autenticados podem deletar evidencias do tenant" ON storage.objects;
CREATE POLICY "Membros autenticados podem deletar evidencias do tenant"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'evidencias'
    AND array_length(storage.foldername(name), 1) >= 2
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.meus_tenants())
  );


-- ------------------------------------------------------------------------------
-- PARTE 8: NOTIFICAÇÃO DE RELOAD DO SCHEMA DO POSTGREST
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
