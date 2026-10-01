-- ==============================================================================
-- MIGRATION 0127: Assinatura Digital do Termo de Risco Específico & Dossiê CDC
-- (Antes, Durante e Depois)
-- ==============================================================================

-- 1. Novas colunas em public.agendamentos para gestão de assinatura digital do termo de risco
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS termo_risco_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS termo_risco_assinado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS termo_risco_assinado_em timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_risco_assinante_nome text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_risco_assinatura_path text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS termo_risco_fotos_durante jsonb DEFAULT '[]'::jsonb;

-- Garantir que agendamentos existentes tenham token único
UPDATE public.agendamentos
SET termo_risco_token = gen_random_uuid()
WHERE termo_risco_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agendamentos_termo_risco_token_idx
  ON public.agendamentos(termo_risco_token);

COMMENT ON COLUMN public.agendamentos.termo_risco_token IS 'Token público exclusivo para assinatura digital remota do termo de risco/vício oculto pelo cliente.';
COMMENT ON COLUMN public.agendamentos.termo_risco_assinado IS 'Indica se o termo de risco foi assinado pelo cliente.';
COMMENT ON COLUMN public.agendamentos.termo_risco_assinado_em IS 'Data e hora da assinatura digital do termo de risco.';
COMMENT ON COLUMN public.agendamentos.termo_risco_assinante_nome IS 'Nome digitado pelo cliente no momento da assinatura digital.';
COMMENT ON COLUMN public.agendamentos.termo_risco_assinatura_path IS 'Path da imagem da assinatura no storage ou string base64.';
COMMENT ON COLUMN public.agendamentos.termo_risco_fotos_durante IS 'Lista de fotos de evidências de vícios ocultos revelados durante o serviço (pós pré-lavagem).';


-- 2. RPC para obter os dados do termo de risco público com dossiê comparativo (Antes e Durante)
CREATE OR REPLACE FUNCTION public.obter_termo_risco_publico(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_agendamento RECORD;
  v_tenant RECORD;
  v_cliente RECORD;
  v_veiculo RECORD;
  v_checkin RECORD;
  v_fotos_antes JSONB := '[]'::jsonb;
  v_fotos_durante JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('erro', 'Token inválido.');
  END IF;

  SELECT * INTO v_agendamento
  FROM public.agendamentos
  WHERE termo_risco_token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Termo de risco não encontrado.');
  END IF;

  -- 1. Oficina
  SELECT
    COALESCE(t.razao_social, t.nome, 'Oficina Detailer') AS nome,
    t.razao_social,
    t.logo_path AS logo_url,
    t.cidade,
    t.uf,
    t.telefone,
    t.documento,
    t.documento_tipo,
    t.pdf_cor_primaria,
    t.pdf_cor_fundo_cabecalho,
    t.pdf_cor_texto_cabecalho,
    t.pdf_cor_fundo_secoes,
    t.pdf_cor_texto_secoes,
    t.pdf_subtitulo_cabecalho,
    t.pdf_texto_rodape,
    t.pdf_ocultar_marca_dagua,
    t.plano
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_agendamento.tenant_id;

  -- 2. Cliente
  SELECT
    c.nome,
    split_part(c.nome, ' ', 1) AS primeiro_nome,
    COALESCE(c.documento, c.cpf_cnpj) AS documento,
    c.telefone
  INTO v_cliente
  FROM public.clientes c
  WHERE c.id = v_agendamento.cliente_id;

  -- 3. Veículo
  SELECT
    v.modelo,
    v.marca,
    v.placa,
    v.cor,
    v.ano
  INTO v_veiculo
  FROM public.veiculos v
  WHERE v.id = v_agendamento.veiculo_id;

  -- 4. Fotos do ANTES (Vistoria de Entrada baseada no CDC)
  SELECT c.id INTO v_checkin
  FROM public.checkins c
  WHERE c.agendamento_id = v_agendamento.id
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_checkin.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'path', cf.path,
        'descricao', cf.descricao,
        'tipo', cf.tipo,
        'created_at', cf.created_at
      )
    ), '[]'::jsonb)
    INTO v_fotos_antes
    FROM public.checkin_fotos cf
    WHERE cf.checkin_id = v_checkin.id;
  END IF;

  -- 5. Fotos do DURANTE (Avarias reveladas pós pré-lavagem)
  IF v_agendamento.termo_risco_fotos_durante IS NOT NULL AND jsonb_array_length(v_agendamento.termo_risco_fotos_durante) > 0 THEN
    v_fotos_durante := v_agendamento.termo_risco_fotos_durante;
  ELSE
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'path', ef.path,
        'descricao', 'Vício preexistente identificado durante o atendimento',
        'momento', ef.momento,
        'created_at', ef.capturada_em
      )
    ), '[]'::jsonb)
    INTO v_fotos_durante
    FROM public.execucoes ex
    JOIN public.execucao_fotos ef ON ef.execucao_id = ex.id
    WHERE ex.agendamento_id = v_agendamento.id
      AND ef.momento = 'durante';
  END IF;

  v_result := jsonb_build_object(
    'agendamento_id', v_agendamento.id,
    'numero_os', v_agendamento.numero_os,
    'servico_nome', COALESCE(v_agendamento.termo_risco_servico, 'Procedimento Técnico Especializado'),
    'observacoes_risco', COALESCE(v_agendamento.termo_risco_observacoes, 'Condições preexistentes verificadas.'),
    'texto_legal', v_agendamento.termo_risco_texto,
    'oficina', jsonb_build_object(
      'nome', COALESCE(v_tenant.nome, 'Oficina Detailer'),
      'razao_social', v_tenant.razao_social,
      'documento', v_tenant.documento,
      'documento_tipo', v_tenant.documento_tipo,
      'telefone', v_tenant.telefone,
      'cidade', v_tenant.cidade,
      'uf', v_tenant.uf,
      'logo_url', v_tenant.logo_url,
      'plano', v_tenant.plano,
      'pdf_cor_primaria', v_tenant.pdf_cor_primaria,
      'pdf_cor_fundo_cabecalho', v_tenant.pdf_cor_fundo_cabecalho,
      'pdf_cor_texto_cabecalho', v_tenant.pdf_cor_texto_cabecalho,
      'pdf_cor_fundo_secoes', v_tenant.pdf_cor_fundo_secoes,
      'pdf_cor_texto_secoes', v_tenant.pdf_cor_texto_secoes,
      'pdf_subtitulo_cabecalho', v_tenant.pdf_subtitulo_cabecalho,
      'pdf_texto_rodape', v_tenant.pdf_texto_rodape,
      'pdf_ocultar_marca_dagua', v_tenant.pdf_ocultar_marca_dagua
    ),
    'cliente', jsonb_build_object(
      'nome', COALESCE(v_cliente.nome, 'Cliente'),
      'primeiro_nome', COALESCE(v_cliente.primeiro_nome, 'Cliente'),
      'documento', v_cliente.documento,
      'telefone', v_cliente.telefone
    ),
    'veiculo', jsonb_build_object(
      'modelo', COALESCE(v_veiculo.modelo, 'Veículo'),
      'marca', v_veiculo.marca,
      'placa', COALESCE(v_veiculo.placa, '---'),
      'cor', v_veiculo.cor,
      'ano', v_veiculo.ano
    ),
    'fotos_antes', v_fotos_antes,
    'fotos_durante', v_fotos_durante,
    'assinado', COALESCE(v_agendamento.termo_risco_assinado, false),
    'assinado_em', v_agendamento.termo_risco_assinado_em,
    'assinante_nome', v_agendamento.termo_risco_assinante_nome,
    'assinatura_url', v_agendamento.termo_risco_assinatura_path
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obter_termo_risco_publico(uuid) TO anon, authenticated;


-- 3. RPC para registrar o aceite e assinatura digital remota do termo de risco
CREATE OR REPLACE FUNCTION public.assinar_termo_risco_publico(
  p_token uuid,
  p_assinatura_base64 text,
  p_nome text,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_agendamento RECORD;
  v_nome_limpo TEXT;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Token de termo de risco inválido.';
  END IF;

  SELECT * INTO v_agendamento
  FROM public.agendamentos
  WHERE termo_risco_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atendimento ou termo de risco não encontrado.';
  END IF;

  IF v_agendamento.termo_risco_assinado = true THEN
    RAISE EXCEPTION 'Este termo de risco já foi assinado e finalizado.';
  END IF;

  v_nome_limpo := trim(COALESCE(p_nome, ''));
  IF length(v_nome_limpo) < 3 THEN
    RAISE EXCEPTION 'O nome completo do assinante deve ter no mínimo 3 caracteres.';
  END IF;

  IF p_assinatura_base64 IS NULL OR (
    NOT (p_assinatura_base64 LIKE 'data:image/png;base64,%' OR p_assinatura_base64 LIKE 'data:image/jpeg;base64,%')
  ) THEN
    RAISE EXCEPTION 'Formato de assinatura digital inválido.';
  END IF;

  UPDATE public.agendamentos
  SET
    termo_risco_assinado = true,
    termo_risco_assinado_em = now(),
    termo_risco_assinante_nome = v_nome_limpo,
    termo_risco_assinatura_path = p_assinatura_base64
  WHERE id = v_agendamento.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Termo de risco e ciência assinado digitalmente com sucesso.',
    'assinado_em', now(),
    'assinante_nome', v_nome_limpo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assinar_termo_risco_publico(uuid, text, text, text) TO anon, authenticated;
