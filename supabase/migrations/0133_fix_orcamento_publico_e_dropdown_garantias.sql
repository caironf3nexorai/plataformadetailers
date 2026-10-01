-- ==============================================================================
-- MIGRAÇÃO 0133: Correção do Erro de Consulta Pública e Suporte a Modelos de Garantia
-- 1. Garante colunas defensivas em public.tenants, public.orcamentos e public.termos_garantia
-- 2. Restaura public.orcamento_publico(p_token uuid) usando estritamente colunas reais da tabela
-- 3. Unifica obter_orcamento_publico_por_token(p_token text) como wrapper direto e seguro
-- 4. Popula modelos de garantia desduplicados da plataforma para todos os tenants
-- ==============================================================================

-- 1. ESTRUTURA DEFENSIVA COMPLETA: GARANTIR COLUNAS EM TENANTS, ORÇAMENTOS E TERMOS_GARANTIA
ALTER TABLE public.tenants 
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS razao_social text,
  ADD COLUMN IF NOT EXISTS documento text,
  ADD COLUMN IF NOT EXISTS documento_tipo text,
  ADD COLUMN IF NOT EXISTS pix_chave text,
  ADD COLUMN IF NOT EXISTS pix_nome_beneficiario text,
  ADD COLUMN IF NOT EXISTS pix_cidade text,
  ADD COLUMN IF NOT EXISTS termo_responsabilidade text,
  ADD COLUMN IF NOT EXISTS orcamento_agendamento_cliente boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS antecedencia_minima_horas smallint DEFAULT 2,
  ADD COLUMN IF NOT EXISTS pdf_cor_primaria text DEFAULT '#f59e0b',
  ADD COLUMN IF NOT EXISTS pdf_cor_fundo_cabecalho text DEFAULT '#18181b',
  ADD COLUMN IF NOT EXISTS pdf_cor_texto_cabecalho text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS pdf_cor_fundo_secoes text DEFAULT '#27272a',
  ADD COLUMN IF NOT EXISTS pdf_cor_texto_secoes text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS pdf_subtitulo_cabecalho text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pdf_texto_observacoes_orcamento text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pdf_texto_rodape text DEFAULT NULL;

ALTER TABLE public.termos_garantia
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'garantia';

ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS numero integer,
  ADD COLUMN IF NOT EXISTS numero_os integer,
  ADD COLUMN IF NOT EXISTS titulo text,
  ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS modo_orcamento text DEFAULT '3_niveis',
  ADD COLUMN IF NOT EXISTS nivel_aprovado text,
  ADD COLUMN IF NOT EXISTS categoria_id uuid,
  ADD COLUMN IF NOT EXISTS validade_dias integer DEFAULT 7,
  ADD COLUMN IF NOT EXISTS enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS visualizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS assinatura_data timestamptz,
  ADD COLUMN IF NOT EXISTS assinatura_nome text,
  ADD COLUMN IF NOT EXISTS assinatura_path text,
  ADD COLUMN IF NOT EXISTS agendamento_id uuid,
  ADD COLUMN IF NOT EXISTS desconto_tipo text,
  ADD COLUMN IF NOT EXISTS desconto_valor numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_motivo text,
  ADD COLUMN IF NOT EXISTS desconto_cupom_codigo text,
  ADD COLUMN IF NOT EXISTS desconto_aplicado_em timestamptz,
  ADD COLUMN IF NOT EXISTS desconto_aplicado_por uuid,
  ADD COLUMN IF NOT EXISTS termo_garantia_id uuid REFERENCES public.termos_garantia(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS termo_responsabilidade_id uuid REFERENCES public.termos_garantia(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS termo_responsabilidade_texto text,
  ADD COLUMN IF NOT EXISTS termo_risco_texto text,
  ADD COLUMN IF NOT EXISTS termo_risco_servico text,
  ADD COLUMN IF NOT EXISTS termo_risco_observacoes text,
  ADD COLUMN IF NOT EXISTS incluir_termos boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS incluir_termo_responsabilidade boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS incluir_termo_garantia boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS incluir_termo_risco boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS garantia_meses integer DEFAULT 3;

-- Preenche email da oficina se estiver nulo
UPDATE public.tenants t
SET email = tm.email
FROM (
  SELECT DISTINCT ON (tenant_id) tenant_id, email
  FROM public.tenant_members
  ORDER BY tenant_id, created_at ASC
) tm
WHERE t.id = tm.tenant_id AND (t.email IS NULL OR trim(t.email) = '');

-- 2. POPULAR MODELOS DE GARANTIA DA PLATAFORMA PARA CADA TENANT (SE NÃO EXISTIREM)
INSERT INTO public.termos_garantia (tenant_id, tipo, titulo, conteudo, categoria, padrao, ativo)
SELECT 
  t.id AS tenant_id,
  COALESCE(pm.tipo_servico, 'geral') AS tipo,
  pm.titulo,
  pm.conteudo_texto AS conteudo,
  COALESCE(pm.categoria, 'garantia') AS categoria,
  CASE WHEN pm.titulo LIKE '%Oficial%' OR pm.titulo LIKE '%Geral%' THEN true ELSE false END AS padrao,
  true AS ativo
FROM public.tenants t
CROSS JOIN public.plataforma_modelos_termos pm
WHERE pm.ativo = true
  AND NOT EXISTS (
    SELECT 1 FROM public.termos_garantia tg 
    WHERE tg.tenant_id = t.id AND tg.titulo = pm.titulo
  )
ON CONFLICT DO NOTHING;

-- 3. ATUALIZAR RPC CANÔNICA: public.orcamento_publico(p_token uuid)
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
  -- 1. Busca orçamento pelo token público ou ID
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token OR o.id = p_token
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

  -- 9. Níveis e Itens da Proposta (usa rigorosamente as colunas reais de orcamento_niveis, servicos e combos)
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

  -- Fallback seguro para modo simples: caso não encontre nivel 'essencial', seleciona o primeiro nivel disponível
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

  -- 11. Termo de Garantia (específico do orçamento > padrão ativo da oficina)
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

  -- 12. Termo de Responsabilidade (específico do orçamento > vinculado por ID > termo geral da oficina)
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

-- 4. UNIFICAR obter_orcamento_publico_por_token COMO WRAPPER DIRETO (SEM DUPLICAÇÃO DE CÓDIGO)
CREATE OR REPLACE FUNCTION public.obter_orcamento_publico_por_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_token IS NOT NULL AND p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN public.orcamento_publico(p_token::uuid);
  ELSE
    RETURN NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_orcamento_publico_por_token(text) TO anon, authenticated;
