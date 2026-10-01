-- ==============================================================================
-- MIGRATION 0128: Termo de Responsabilidade Dinâmico no Orçamento
-- Cláusulas inteligentes por tipo de serviço e persistência de personalização
-- ==============================================================================

-- 1. Coluna de texto do termo de responsabilidade em orçamentos
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS termo_responsabilidade_texto text DEFAULT NULL;

COMMENT ON COLUMN public.orcamentos.termo_responsabilidade_texto IS 'Texto completo do termo de responsabilidade com cláusulas dinâmicas e variáveis preenchidas para esta proposta.';

-- 2. Atualizar obter_orcamento_publico_por_token para retornar o termo dinâmico salvo no orçamento
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
  v_cliente_doc TEXT;
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
      c.telefone,
      c.cpf_cnpj
    INTO v_primeiro_nome, v_cliente_tel, v_cliente_doc
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;
  END IF;

  -- Busca veículo
  IF v_orcamento.veiculo_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', v.id,
      'marca', v.marca,
      'modelo', v.modelo,
      'placa', v.placa,
      'cor', v.cor,
      'ano', v.ano,
      'categoria', v.categoria_veiculo
    ) INTO v_veiculo_json
    FROM public.veiculos v
    WHERE v.id = v_orcamento.veiculo_id;
  END IF;

  -- Busca desconto se existir
  IF v_orcamento.desconto_valor IS NOT NULL AND v_orcamento.desconto_tipo IS NOT NULL THEN
    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'motivo', v_orcamento.desconto_motivo,
      'cupom_codigo', v_orcamento.desconto_cupom_codigo
    );
  END IF;

  -- Busca termo de garantia personalizado se vinculado
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

  -- Busca níveis com itens e dados do serviço
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'nivel', n.nivel,
      'titulo_customizado', n.titulo_customizado,
      'descricao_customizada', n.descricao_customizada,
      'valor_total', n.valor_total,
      'duracao_total_minutos', n.duracao_total_minutos,
      'itens', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', ni.id,
              'servico_id', ni.servico_id,
              'combo_id', ni.combo_id,
              'servico_nome', coalesce(s.nome, ni.servico_nome),
              'servico_descricao', s.descricao,
              'preco_calculado', ni.preco_calculado,
              'duracao_minutos', ni.duracao_minutos,
              'ordem', ni.ordem,
              'opcional', ni.opcional,
              'selecionado', ni.selecionado,
              'grupo', s.grupo,
              'tem_risco_especifico', s.tem_risco_especifico,
              'riscos_especificos_padrao', s.riscos_especificos_padrao
            ) ORDER BY ni.ordem ASC
          )
          FROM public.orcamento_nivel_itens ni
          LEFT JOIN public.servicos s ON s.id = ni.servico_id
          WHERE ni.nivel_id = n.id
        ),
        '[]'::jsonb
      )
    ) ORDER BY
      CASE n.nivel
        WHEN 'essencial' THEN 1
        WHEN 'recomendado' THEN 2
        WHEN 'completo' THEN 3
        ELSE 4
      END
  ) INTO v_niveis_json
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id;

  -- Retorna JSON consolidado da proposta com termo de responsabilidade dinâmico
  RETURN jsonb_build_object(
    'id', v_orcamento.id,
    'token_publico', v_orcamento.token_publico,
    'numero_orcamento', v_orcamento.numero_orcamento,
    'status', v_status_atual,
    'modo_orcamento', v_modo_orc,
    'nivel_selecionado', v_orcamento.nivel_selecionado,
    'data_criacao', v_orcamento.created_at,
    'validade_dias', coalesce(v_orcamento.validade_dias, 7),
    'observacoes', v_orcamento.observacoes,
    'cliente_nome', v_primeiro_nome,
    'cliente_telefone', v_cliente_tel,
    'cliente_cpf_cnpj', v_cliente_doc,
    'desconto', v_desconto_json,
    'garantia_meses', coalesce(v_orcamento.garantia_meses, 3),
    'incluir_termos', coalesce(v_orcamento.incluir_termos, true),
    'incluir_termo_responsabilidade', coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, true),
    'incluir_termo_garantia', coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, true),
    'incluir_termo_risco', coalesce(v_orcamento.incluir_termo_risco, false),
    'termo_risco_servico', v_orcamento.termo_risco_servico,
    'termo_risco_observacoes', v_orcamento.termo_risco_observacoes,
    'termo_risco_texto', v_orcamento.termo_risco_texto,
    'termo_responsabilidade', coalesce(v_orcamento.termo_responsabilidade_texto, v_tenant.termo_responsabilidade, ''),
    'termo_garantia', v_termo_garantia_json,
    'oficina', jsonb_build_object(
      'tenant_id', v_tenant.id,
      'nome', v_tenant.nome,
      'razao_social', v_tenant.razao_social,
      'documento', v_tenant.documento,
      'documento_tipo', v_tenant.documento_tipo,
      'telefone', v_tenant.telefone,
      'email', v_tenant.email,
      'logo_url', v_tenant.logo_url,
      'logo_path', v_tenant.logo_path,
      'endereco', v_tenant.endereco,
      'cidade', v_tenant.cidade,
      'estado', v_tenant.estado,
      'cep', v_tenant.cep,
      'pdf_cor_primaria', v_tenant.pdf_cor_primaria,
      'pdf_cor_fundo_cabecalho', v_tenant.pdf_cor_fundo_cabecalho,
      'pdf_cor_texto_cabecalho', v_tenant.pdf_cor_texto_cabecalho,
      'pdf_cor_fundo_secoes', v_tenant.pdf_cor_fundo_secoes,
      'pdf_subtitulo_cabecalho', v_tenant.pdf_subtitulo_cabecalho,
      'pdf_texto_observacoes_orcamento', v_tenant.pdf_texto_observacoes_orcamento,
      'pdf_texto_rodape', v_tenant.pdf_texto_rodape,
      'pdf_ocultar_marca_dagua', v_tenant.pdf_ocultar_marca_dagua
    ),
    'veiculo', v_veiculo_json,
    'niveis', coalesce(v_niveis_json, '[]'::jsonb)
  );
END;
$$;
