-- Migration 0110: Separação dos checkboxes de Termo de Responsabilidade e Termo de Garantia no Orçamento

-- 1. Adiciona as colunas na tabela public.orcamentos
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS incluir_termo_responsabilidade boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS incluir_termo_garantia boolean DEFAULT true;

-- 2. Backfill para orçamentos existentes preservando o valor anterior de incluir_termos
UPDATE public.orcamentos
SET 
  incluir_termo_responsabilidade = COALESCE(incluir_termos, true),
  incluir_termo_garantia = COALESCE(incluir_termos, true)
WHERE incluir_termo_responsabilidade IS NULL OR incluir_termo_garantia IS NULL;

-- 3. Atualiza a RPC obter_orcamento_publico_por_token para retornar os dois booleanos separados
CREATE OR REPLACE FUNCTION public.obter_orcamento_publico_por_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orcamento RECORD;
  v_tenant RECORD;
  v_veiculo_json JSONB;
  v_agendamento_json JSONB;
  v_niveis_json JSONB;
  v_status_atual TEXT;
  v_modo_orc TEXT;
  v_primeiro_nome TEXT;
  v_cliente_tel TEXT;
  v_itens_aprovados_json JSONB := '[]'::jsonb;
  v_alteracao_pendente JSONB := NULL;
  v_alteracao_historico_json JSONB := '[]'::jsonb;
  v_desconto_json JSONB := NULL;
  v_termo_garantia_json JSONB := NULL;
BEGIN
  -- Busca o orçamento pelo token público
  SELECT * INTO v_orcamento
  FROM public.orcamentos
  WHERE token_publico = p_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Busca dados da oficina
  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = v_orcamento.tenant_id;

  v_status_atual := v_orcamento.status;
  v_modo_orc := coalesce(v_orcamento.modo_orcamento, '3_niveis');

  -- Busca cliente
  IF v_orcamento.cliente_id IS NOT NULL THEN
    SELECT 
      split_part(c.nome, ' ', 1),
      c.telefone
    INTO v_primeiro_nome, v_cliente_tel
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;
  END IF;

  -- Busca veículo
  IF v_orcamento.veiculo_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'placa', v.placa,
      'modelo', v.modelo,
      'marca', v.marca,
      'cor', v.cor,
      'categoria_nome', cat.nome
    ) INTO v_veiculo_json
    FROM public.veiculos v
    LEFT JOIN public.categorias_veiculo cat ON cat.id = v_orcamento.categoria_id
    WHERE v.id = v_orcamento.veiculo_id;
  END IF;

  -- Busca agendamento vinculado (se houver)
  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', a.id,
      'data_hora', a.data_hora,
      'status', a.status
    ) INTO v_agendamento_json
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;
  END IF;

  -- Busca desconto
  IF v_orcamento.desconto_valor IS NOT NULL AND v_orcamento.desconto_valor > 0 THEN
    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'cupom_codigo', v_orcamento.desconto_cupom_codigo,
      'aplicado_em', v_orcamento.desconto_aplicado_em
    );
  END IF;

  -- Busca os níveis e itens
  IF v_modo_orc = '3_niveis' THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'nivel', n.nivel,
          'nome_customizado', n.nome_customizado,
          'subtitulo', n.subtitulo,
          'descricao', n.descricao,
          'destaque', n.destaque,
          'preco_total', n.preco_total,
          'desconto_valor', n.desconto_valor,
          'desconto_tipo', n.desconto_tipo,
          'itens', coalesce(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', i.id,
                  'servico_id', i.servico_id,
                  'combo_id', i.combo_id,
                  'servico_nome', coalesce(s.nome, c.nome, 'Serviço'),
                  'preco', i.preco,
                  'duracao_minutos', i.duracao_minutos,
                  'obrigatorio', i.obrigatorio,
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
        ) ORDER BY CASE n.nivel 
          WHEN 'essencial' THEN 1 
          WHEN 'recomendado' THEN 2 
          WHEN 'completo' THEN 3 
          ELSE 4 
        END
      ),
      '[]'::jsonb
    ) INTO v_niveis_json
    FROM public.orcamento_niveis n
    WHERE n.orcamento_id = v_orcamento.id;
  END IF;

  IF v_orcamento.status = 'aprovado' AND v_orcamento.nivel_aprovado IS NOT NULL THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
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
  ELSIF v_modo_orc = 'simples' THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
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

  -- Busca o Termo de Garantia vinculado ao orçamento (se houver)
  IF v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', tg.id,
      'tipo', tg.tipo,
      'titulo', tg.titulo,
      'conteudo', tg.conteudo
    ) INTO v_termo_garantia_json
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

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
    'termo_responsabilidade', coalesce(v_tenant.termo_responsabilidade, ''),
    'termo_garantia', v_termo_garantia_json,
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
