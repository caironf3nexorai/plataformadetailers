-- Migration 0126: Termos de Garantia com Prazo Selecionável e Termo de Ciência de Risco Específico

-- 1. COLUNAS DE RISCO ESPECÍFICO EM SERVIÇOS
ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS tem_risco_especifico boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS riscos_especificos_padrao text DEFAULT NULL;

COMMENT ON COLUMN public.servicos.tem_risco_especifico IS 'Indica se este serviço possui riscos técnicos inerentes que exigem termo de ciência assinado pelo cliente.';
COMMENT ON COLUMN public.servicos.riscos_especificos_padrao IS 'Texto padrão com os riscos inerentes deste serviço (ex: chicotes ressecados em lavagem de motor, verniz fino em polimento).';

-- 2. COLUNAS DE GARANTIA E TERMO DE RISCO EM ORÇAMENTOS
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS garantia_meses integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS incluir_termo_risco boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS termo_risco_servico text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_risco_observacoes text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_risco_texto text DEFAULT NULL;

COMMENT ON COLUMN public.orcamentos.garantia_meses IS 'Prazo de garantia acordado para a proposta (ex: 1, 3, 6 ou 12 meses).';
COMMENT ON COLUMN public.orcamentos.incluir_termo_risco IS 'Indica se deve anexar em folha separada o Termo de Ciência e Autorização com Risco Específico.';
COMMENT ON COLUMN public.orcamentos.termo_risco_servico IS 'Nome do serviço sujeito a risco específico.';
COMMENT ON COLUMN public.orcamentos.termo_risco_observacoes IS 'Riscos e detalhes preexistentes específicos informados ao cliente.';
COMMENT ON COLUMN public.orcamentos.termo_risco_texto IS 'Texto completo do termo de risco gerado com todas as variáveis preenchidas.';

-- 3. COLUNAS DE GARANTIA E TERMO DE RISCO EM AGENDAMENTOS (ORDEM DE SERVIÇO)
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS garantia_meses integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS incluir_termo_risco boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS termo_risco_servico text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_risco_observacoes text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_risco_texto text DEFAULT NULL;

COMMENT ON COLUMN public.agendamentos.garantia_meses IS 'Prazo de garantia acordado para a OS (ex: 1, 3, 6 ou 12 meses).';
COMMENT ON COLUMN public.agendamentos.incluir_termo_risco IS 'Indica se a OS possui Termo de Ciência e Autorização com Risco Específico em folha separada.';
COMMENT ON COLUMN public.agendamentos.termo_risco_servico IS 'Nome do serviço sujeito a risco específico.';
COMMENT ON COLUMN public.agendamentos.termo_risco_observacoes IS 'Riscos e detalhes preexistentes específicos informados ao cliente.';
COMMENT ON COLUMN public.agendamentos.termo_risco_texto IS 'Snapshot do termo de risco no momento da OS.';

-- 4. ATUALIZAR RPC obter_orcamento_publico_por_token PARA RETORNAR OS CAMPOS DE RISCO E GARANTIA
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

  -- Busca agendamento vinculado se houver
  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', a.id,
      'data', a.data,
      'horario', a.horario,
      'status', a.status
    ) INTO v_agendamento_json
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;
  END IF;

  -- Busca os níveis do orçamento com itens e fotos
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'nivel', n.nivel,
      'titulo', n.titulo,
      'descricao', n.descricao,
      'destaque', n.destaque,
      'ordem', n.ordem,
      'valor_total', n.valor_total,
      'itens', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'servico_id', i.servico_id,
            'nome', coalesce(s.nome, i.nome_personalizado),
            'descricao', s.descricao,
            'preco', i.preco,
            'tipo', i.tipo,
            'obrigatorio', i.obrigatorio,
            'duracao_minutos', coalesce(i.duracao_minutos, s.duracao_minutos, 60),
            'garantia_meses', s.garantia_meses,
            'tem_risco_especifico', coalesce(s.tem_risco_especifico, false),
            'riscos_especificos_padrao', s.riscos_especificos_padrao
          )
        ), '[]'::jsonb)
        FROM public.orcamento_itens i
        LEFT JOIN public.servicos s ON s.id = i.servico_id
        WHERE i.nivel_id = n.id
      ),
      'fotos', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'id', f.id,
            'foto_url', f.foto_url,
            'thumbnail_url', f.thumbnail_url,
            'tipo', f.tipo,
            'legenda', f.legenda,
            'ordem', f.ordem
          ) ORDER BY f.ordem, f.created_at
        ), '[]'::jsonb)
        FROM public.orcamento_fotos f
        WHERE f.nivel_id = n.id
      )
    ) ORDER BY n.ordem
  ), '[]'::jsonb) INTO v_niveis_json
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id;

  -- Busca itens aprovados se houver
  IF v_orcamento.itens_aprovados IS NOT NULL THEN
    v_itens_aprovados_json := v_orcamento.itens_aprovados;
  END IF;

  -- Busca alteração pendente se houver
  IF v_orcamento.alteracao_pendente IS NOT NULL THEN
    v_alteracao_pendente := v_orcamento.alteracao_pendente;
  END IF;

  -- Busca histórico de alterações se houver
  IF v_orcamento.alteracao_historico IS NOT NULL THEN
    v_alteracao_historico_json := v_orcamento.alteracao_historico;
  END IF;

  -- Busca desconto se houver
  IF v_orcamento.desconto_valor IS NOT NULL OR v_orcamento.desconto_percentual IS NOT NULL THEN
    v_desconto_json := jsonb_build_object(
      'tipo', v_orcamento.desconto_tipo,
      'valor', v_orcamento.desconto_valor,
      'percentual', v_orcamento.desconto_percentual,
      'motivo', v_orcamento.desconto_motivo
    );
  END IF;

  -- Busca termo de garantia customizado se houver
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

  -- Monta o resultado final consolidado
  RETURN jsonb_build_object(
    'id', v_orcamento.id,
    'numero_orcamento', v_orcamento.numero_orcamento,
    'numero_os', v_orcamento.numero_os,
    'status', v_status_atual,
    'modo_orcamento', v_modo_orc,
    'nivel_aprovado', v_orcamento.nivel_aprovado,
    'itens_aprovados', v_itens_aprovados_json,
    'alteracao_pendente', v_alteracao_pendente,
    'alteracao_historico', v_alteracao_historico_json,
    'validade_dias', coalesce(v_orcamento.validade_dias, 7),
    'validade_data', CASE 
      WHEN v_orcamento.validade_data IS NOT NULL THEN v_orcamento.validade_data
      WHEN v_orcamento.enviado_em IS NOT NULL THEN (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7))
      ELSE NULL 
    END,
    'assinatura_data', v_orcamento.assinatura_data,
    'assinatura_nome', v_orcamento.assinatura_nome,
    'assinatura_url', v_orcamento.assinatura_path,
    'cliente_primeiro_nome', v_primeiro_nome,
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
    'niveis', v_niveis_json
  );
END;
$$;
