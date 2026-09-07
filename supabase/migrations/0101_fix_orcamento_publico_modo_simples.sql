-- =========================================================================================
-- MIGRATION 0101: SUPORTE COMPLETO AO MODO DE ORÇAMENTO SIMPLES NA RPC orcamento_publico
-- =========================================================================================
-- 1. Atualiza RPC orcamento_publico para incluir campo modo_orcamento.
-- 2. No modo 'simples', retorna estritamente a proposta única (nível essencial).
-- 3. Limpa itens residuais dos níveis 'recomendado' e 'completo' em orçamentos simples existentes.
-- =========================================================================================

-- Limpa itens de níveis secundários em orçamentos que já estão como 'simples'
DELETE FROM public.orcamento_nivel_itens i
USING public.orcamento_niveis n, public.orcamentos o
WHERE i.nivel_id = n.id
  AND n.orcamento_id = o.id
  AND o.modo_orcamento = 'simples'
  AND n.nivel IN ('recomendado', 'completo');

UPDATE public.orcamento_niveis n
SET duracao_total = 0, valor_total = 0
FROM public.orcamentos o
WHERE n.orcamento_id = o.id
  AND o.modo_orcamento = 'simples'
  AND n.nivel IN ('recomendado', 'completo');

-- Atualiza a RPC orcamento_publico
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
  v_niveis_json jsonb;
  v_itens_aprovados_json jsonb := '[]'::jsonb;
  v_status_atual text;
  v_veiculo_json jsonb := null;
  v_agendamento_json jsonb := null;
  v_desconto_json jsonb := null;
  v_alteracao_historico_json jsonb := '[]'::jsonb;
  v_alteracao_pendente boolean := false;
  v_cliente_tel text := null;
  v_primeiro_nome text := null;
  v_usuario_desconto_nome text := null;
  v_tem_veiculo boolean := false;
  v_tem_agendamento boolean := false;
  v_modo_orc text;
BEGIN
  -- 1. Busca orçamento pelo token público
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado ou token inválido.';
  END IF;

  v_modo_orc := coalesce(v_orcamento.modo_orcamento, '3_niveis');

  -- 2. Busca dados do tenant / oficina
  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_orcamento.tenant_id;

  -- 3. Verifica expiração automática por validade
  v_status_atual := v_orcamento.status;
  IF v_status_atual = 'enviado' AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em + (coalesce(v_orcamento.validade_dias, 7) || ' days')::interval) < now() THEN
      v_status_atual := 'expirado';
      UPDATE public.orcamentos 
      SET status = 'expirado', updated_at = now() 
      WHERE id = v_orcamento.id;
    END IF;
  END IF;

  -- 4. Marca como 'visualizado' se for o primeiro acesso pelo cliente
  IF v_status_atual = 'enviado' THEN
    v_status_atual := 'visualizado';
    UPDATE public.orcamentos 
    SET status = 'visualizado', updated_at = now() 
    WHERE id = v_orcamento.id;
  END IF;

  -- 5. Busca dados do cliente
  IF v_orcamento.cliente_id IS NOT NULL THEN
    SELECT split_part(c.nome, ' ', 1), c.telefone
    INTO v_primeiro_nome, v_cliente_tel
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;
  END IF;

  -- 6. Busca dados do veículo
  IF v_orcamento.veiculo_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', v.id,
      'placa', v.placa,
      'modelo', v.modelo,
      'marca', v.marca,
      'ano', v.ano,
      'cor', v.cor
    ) INTO v_veiculo_json
    FROM public.veiculos v 
    WHERE v.id = v_orcamento.veiculo_id;
    IF FOUND THEN
      v_tem_veiculo := true;
    END IF;
  END IF;

  -- 7. Busca agendamento vinculado
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

  -- 9. Níveis e Itens da Proposta (se 'simples', traz somente o essencial renomeado para 'Proposta de Serviços')
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
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
              'servico_id', i.servico_id,
              'servico_nome', s.nome,
              'servico_descricao', s.descricao_publica,
              'preco', i.preco,
              'duracao_minutos', i.duracao_minutos
            ) ORDER BY i.ordem ASC
          )
          FROM public.orcamento_nivel_itens i
          JOIN public.servicos s ON s.id = i.servico_id
          WHERE i.nivel_id = n.id
        ), '[]'::jsonb
      )
    ) ORDER BY n.ordem ASC
  ), '[]'::jsonb)
  INTO v_niveis_json
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id
    AND (v_modo_orc <> 'simples' OR n.nivel = 'essencial');

  -- 10. Itens aprovados
  IF v_orcamento.nivel_aprovado IS NOT NULL OR (v_modo_orc = 'simples' AND v_status_atual IN ('aprovado', 'em_andamento', 'concluido')) THEN
    SELECT coalesce(jsonb_agg(
      jsonb_build_object('servico_id', i.servico_id, 'combo_id', i.combo_id)
    ), '[]'::jsonb)
    INTO v_itens_aprovados_json
    FROM public.orcamento_nivel_itens i
    JOIN public.orcamento_niveis n ON n.id = i.nivel_id
    WHERE n.orcamento_id = v_orcamento.id 
      AND n.nivel = coalesce(v_orcamento.nivel_aprovado, 'essencial');
  END IF;

  -- 11. Retorno JSON
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
    'oficina', jsonb_build_object(
      'tenant_id', v_tenant.id,
      'nome', v_tenant.nome,
      'razao_social', v_tenant.razao_social,
      'documento', v_tenant.documento,
      'documento_tipo', v_tenant.documento_tipo,
      'telefone', v_tenant.telefone,
      'email', v_tenant.email,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'logo_path', v_tenant.logo_path,
      'logo_url', v_tenant.logo_url,
      'orcamento_agendamento_cliente', coalesce(v_tenant.orcamento_agendamento_cliente, true),
      'plano', v_tenant.plano,
      'pdf_cor_primaria', v_tenant.pdf_cor_primaria,
      'pdf_cor_fundo_cabecalho', v_tenant.pdf_cor_fundo_cabecalho,
      'pdf_cor_texto_cabecalho', v_tenant.pdf_cor_texto_cabecalho,
      'pdf_cor_fundo_secoes', v_tenant.pdf_cor_fundo_secoes,
      'pdf_cor_texto_secoes', v_tenant.pdf_cor_texto_secoes,
      'pdf_subtitulo_cabecalho', v_tenant.pdf_subtitulo_cabecalho,
      'pdf_texto_observacoes_orcamento', v_tenant.pdf_texto_observacoes_orcamento
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
