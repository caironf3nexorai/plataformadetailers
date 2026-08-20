-- ==============================================================================
-- MIGRATION 0016: Aceite Remoto da Vistoria de Entrada por Link Público
-- ==============================================================================

-- 1. Novas colunas na tabela public.checkins
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS token_aceite uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS aceite_tipo text CHECK (aceite_tipo IN ('presencial', 'remoto')),
  ADD COLUMN IF NOT EXISTS aceite_ip text,
  ADD COLUMN IF NOT EXISTS aceite_user_agent text,
  ADD COLUMN IF NOT EXISTS enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS tentativas_aceite integer DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS checkins_token_aceite_idx ON public.checkins(token_aceite);

-- 2. Função pública de leitura dos dados da vistoria (segura, usa apenas tabelas do projeto)
CREATE OR REPLACE FUNCTION public.vistoria_publica(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_checkin record;
  v_oficina record;
  v_cliente record;
  v_veiculo record;
  v_avarias jsonb;
  v_fotos jsonb;
  v_result jsonb;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('erro', 'Token inválido');
  END IF;

  SELECT c.* INTO v_checkin
  FROM public.checkins c
  WHERE c.token_aceite = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erro', 'Vistoria não encontrada');
  END IF;

  -- Buscar dados da oficina direto da tabela public.tenants
  SELECT
    COALESCE(t.razao_social, t.nome, 'Oficina') AS nome,
    t.logo_path AS logo_url,
    t.cidade AS cidade,
    t.telefone AS telefone
  INTO v_oficina
  FROM public.tenants t
  WHERE t.id = v_checkin.tenant_id;

  -- Buscar dados do cliente (apenas primeiro nome para privacidade)
  SELECT
    split_part(cl.nome, ' ', 1) AS primeiro_nome
  INTO v_cliente
  FROM public.agendamentos a
  JOIN public.clientes cl ON cl.id = a.cliente_id
  WHERE a.id = v_checkin.agendamento_id;

  -- Buscar dados do veículo
  SELECT
    v.modelo,
    v.placa
  INTO v_veiculo
  FROM public.veiculos v
  WHERE v.id = v_checkin.veiculo_id;

  -- Buscar avarias
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'vista', ca.vista,
      'pos_x', ca.pos_x,
      'pos_y', ca.pos_y,
      'tipo', ca.tipo,
      'descricao', ca.descricao
    )
  ), '[]'::jsonb)
  INTO v_avarias
  FROM public.checkin_avarias ca
  WHERE ca.checkin_id = v_checkin.id;

  -- Buscar fotos de vistoria
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'foto_url', cf.path,
      'descricao', cf.descricao,
      'created_at', cf.created_at
    )
  ), '[]'::jsonb)
  INTO v_fotos
  FROM public.checkin_fotos cf
  WHERE cf.checkin_id = v_checkin.id;

  v_result := jsonb_build_object(
    'oficina', jsonb_build_object(
      'nome', COALESCE(v_oficina.nome, 'Oficina'),
      'logo_url', v_oficina.logo_url,
      'cidade', v_oficina.cidade,
      'telefone', v_oficina.telefone
    ),
    'cliente', jsonb_build_object(
      'primeiro_nome', COALESCE(v_cliente.primeiro_nome, 'Cliente')
    ),
    'veiculo', jsonb_build_object(
      'modelo', COALESCE(v_veiculo.modelo, 'Veículo'),
      'placa', COALESCE(v_veiculo.placa, '---')
    ),
    'km', v_checkin.km,
    'nivel_combustivel', v_checkin.nivel_combustivel,
    'iluminacao', v_checkin.iluminacao,
    'sujidade', v_checkin.sujidade,
    'fluidos', v_checkin.fluidos,
    'luzes_painel', v_checkin.luzes_painel,
    'estepe', v_checkin.estepe,
    'observacoes', v_checkin.observacoes,
    'avarias', v_avarias,
    'fotos', v_fotos,
    'finalizado', v_checkin.finalizado,
    'finalizado_em', v_checkin.assinado_em,
    'assinatura_url', v_checkin.assinatura_path,
    'assinante_nome', v_checkin.assinatura_nome,
    'aceite_tipo', v_checkin.aceite_tipo,
    'enviado_em', v_checkin.enviado_em
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vistoria_publica(uuid) TO anon, authenticated;

-- 3. Função pública de aceite remoto de vistoria (com rate-limit e validações)
CREATE OR REPLACE FUNCTION public.aceitar_vistoria_remoto(
  p_token uuid,
  p_assinatura_base64 text,
  p_nome text,
  p_user_agent text DEFAULT NULL,
  p_ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_checkin record;
  v_tentativas integer;
  v_nome_limpo text;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Token de vistoria inválido.';
  END IF;

  SELECT * INTO v_checkin
  FROM public.checkins c
  WHERE c.token_aceite = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vistoria não encontrada.';
  END IF;

  -- 1. Rate Limit: máximo 10 tentativas de submissão por checkin
  v_tentativas := COALESCE(v_checkin.tentativas_aceite, 0) + 1;
  UPDATE public.checkins
  SET tentativas_aceite = v_tentativas
  WHERE id = v_checkin.id;

  IF v_tentativas > 10 THEN
    RAISE EXCEPTION 'Muitas tentativas. Entre em contato com a oficina.';
  END IF;

  -- 2. Validação: enviado_em não pode ser nulo
  IF v_checkin.enviado_em IS NULL THEN
    RAISE EXCEPTION 'Esta vistoria não foi enviada para aceite remoto.';
  END IF;

  -- 3. Validação: não pode estar finalizado
  IF v_checkin.finalizado THEN
    RAISE EXCEPTION 'Esta vistoria já se encontra finalizada e assinada.';
  END IF;

  -- 4. Validação do nome
  v_nome_limpo := trim(COALESCE(p_nome, ''));
  IF length(v_nome_limpo) < 3 THEN
    RAISE EXCEPTION 'O nome do assinante deve conter no mínimo 3 caracteres.';
  END IF;

  -- 5. Validação do formato e tamanho da imagem base64
  IF p_assinatura_base64 IS NULL OR (
    NOT (p_assinatura_base64 LIKE 'data:image/png;base64,%' OR p_assinatura_base64 LIKE 'data:image/jpeg;base64,%')
  ) THEN
    RAISE EXCEPTION 'Formato de imagem da assinatura inválido. Deve ser PNG ou JPEG em base64.';
  END IF;

  IF length(p_assinatura_base64) > 500000 THEN
    RAISE EXCEPTION 'Tamanho da imagem da assinatura excede o limite permitido.';
  END IF;

  -- 6. Gravar aceite remoto (respeita o trigger de imutabilidade porque OLD.finalizado ainda é false)
  UPDATE public.checkins
  SET
    finalizado = true,
    assinado_em = now(),
    aceite_tipo = 'remoto',
    assinatura_path = p_assinatura_base64,
    assinatura_nome = v_nome_limpo,
    aceite_user_agent = p_user_agent,
    aceite_ip = p_ip
  WHERE id = v_checkin.id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'mensagem', 'Vistoria assinada com sucesso.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aceitar_vistoria_remoto(uuid, text, text, text, text) TO anon, authenticated;
