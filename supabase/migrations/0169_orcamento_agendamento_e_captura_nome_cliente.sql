-- ==============================================================================
-- MIGRAÇÃO 0169: VÍNCULO REAL ORÇAMENTO <-> AGENDAMENTO & CAPTURA DE NOME DO CLIENTE
-- 1. Garante ON DELETE SET NULL em orcamentos.agendamento_id e limpa vínculos de
--    agendamentos cancelados/excluídos
-- 2. Backfill de cliente_nome_avulso para orçamentos sem cliente_id já assinados
-- 3. Desvincula orcamentos.agendamento_id ao cancelar/recusar um agendamento
-- 4. Atualiza orcamento_publico, converter_orcamento_em_agendamento e agendar_orcamento_publico
--    para ignorar agendamentos cancelados e aproveitar o nome preenchido pelo cliente
-- 5. Atualiza responder_orcamento e recria confirmar_alteracao_orcamento para salvar
--    o nome do assinante em cliente_nome_avulso quando ainda não houver cliente vinculado
-- ==============================================================================

-- 1. Ajusta FK orcamentos.agendamento_id para ON DELETE SET NULL e higieniza cancelados
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(c.conkey)
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'orcamentos'
    AND c.contype = 'f'
    AND att.attname = 'agendamento_id'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orcamentos DROP CONSTRAINT %I', v_conname);
  END IF;

  ALTER TABLE public.orcamentos
    ADD CONSTRAINT orcamentos_agendamento_id_fkey
    FOREIGN KEY (agendamento_id) REFERENCES public.agendamentos(id) ON DELETE SET NULL;
END;
$$;

UPDATE public.orcamentos o
SET agendamento_id = NULL,
    updated_at = now()
FROM public.agendamentos a
WHERE o.agendamento_id = a.id
  AND a.status = 'cancelado';

UPDATE public.orcamentos o
SET agendamento_id = NULL,
    updated_at = now()
WHERE o.agendamento_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.agendamentos a WHERE a.id = o.agendamento_id
  );

-- 2. Backfill de cliente_nome_avulso quando o cliente assinou no link público sem cadastro vinculado
UPDATE public.orcamentos o
SET cliente_nome_avulso = trim(o.assinatura_nome),
    updated_at = now()
WHERE o.cliente_id IS NULL
  AND nullif(trim(coalesce(o.cliente_nome_avulso, '')), '') IS NULL
  AND nullif(trim(coalesce(o.assinatura_nome, '')), '') IS NOT NULL
  AND length(trim(o.assinatura_nome)) >= 2
  AND lower(trim(o.assinatura_nome)) NOT IN ('cliente', 'não informado', 'nao informado', 'sem nome');

-- ------------------------------------------------------------------------------
-- 3. RPCs DE CANCELAMENTO / RECUSA DE AGENDAMENTO (Desvinculam o orçamento)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_agendamento(
  p_agendamento uuid,
  p_motivo text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.agendamentos WHERE id = p_agendamento;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado.'; END IF;

  IF NOT public.tem_papel(v_tenant, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas donos ou gerentes podem cancelar agendamentos.';
  END IF;

  UPDATE public.agendamentos
  SET status = 'cancelado',
      observacoes = CASE
        WHEN p_motivo IS NOT NULL AND trim(p_motivo) <> ''
        THEN coalesce(observacoes || ' | ', '') || 'Motivo cancelamento: ' || trim(p_motivo)
        ELSE observacoes
      END,
      updated_at = now()
  WHERE id = p_agendamento;

  UPDATE public.orcamentos
  SET agendamento_id = NULL,
      updated_at = now()
  WHERE agendamento_id = p_agendamento;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancelar_agendamento(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancelar_atendimento(
  p_atendimento_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento record;
  v_tenant_id uuid;
BEGIN
  SELECT * INTO v_agendamento
  FROM public.agendamentos
  WHERE id = p_atendimento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atendimento não encontrado.';
  END IF;

  v_tenant_id := v_agendamento.tenant_id;

  IF NOT (v_tenant_id IN (SELECT public.meus_tenants())) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: você não tem permissão para cancelar este atendimento.';
  END IF;

  UPDATE public.agendamentos
  SET status = 'cancelado',
      observacoes = CASE
        WHEN p_motivo IS NOT NULL AND trim(p_motivo) != ''
        THEN coalesce(observacoes || E'\n', '') || '[Cancelamento]: ' || trim(p_motivo)
        ELSE observacoes
      END,
      updated_at = now()
  WHERE id = p_atendimento_id;

  UPDATE public.execucoes
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_atendimento_id;

  UPDATE public.recebimentos
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_atendimento_id
    AND status IN ('previsto', 'pendente');

  UPDATE public.orcamentos
  SET agendamento_id = NULL,
      updated_at = now()
  WHERE agendamento_id = p_atendimento_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', p_atendimento_id,
    'status', 'cancelado',
    'mensagem', 'Atendimento cancelado com sucesso. O horário foi liberado.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancelar_atendimento(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.recusar_agendamento_online(uuid, text);
CREATE OR REPLACE FUNCTION public.recusar_agendamento_online(
  p_agendamento uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento record;
  v_motivo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_agendamento
  FROM public.agendamentos
  WHERE id = p_agendamento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_agendamento.tenant_id, ARRAY['dono', 'gerente']::public.app_role[])
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: você não tem permissão para recusar este agendamento.';
  END IF;

  v_motivo := coalesce(nullif(trim(p_motivo), ''), 'Recusado pelo estabelecimento');

  UPDATE public.agendamentos
  SET status = 'cancelado',
      sinal_status = CASE
        WHEN sinal_status = 'pendente' THEN 'dispensado'
        ELSE sinal_status
      END,
      motivo_cancelamento = v_motivo,
      cancelado_em = now(),
      cancelado_por = auth.uid(),
      observacoes = CASE
        WHEN v_motivo IS NOT NULL
        THEN coalesce(observacoes || E'\n', '') || '[Recusado]: ' || v_motivo
        ELSE observacoes
      END,
      updated_at = now()
  WHERE id = p_agendamento;

  UPDATE public.execucoes
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_agendamento;

  UPDATE public.recebimentos
  SET status = 'cancelado',
      updated_at = now()
  WHERE agendamento_id = p_agendamento
    AND status IN ('previsto', 'pendente');

  UPDATE public.orcamentos
  SET agendamento_id = NULL,
      updated_at = now()
  WHERE agendamento_id = p_agendamento;

  RETURN jsonb_build_object(
    'sucesso', true,
    'id', p_agendamento,
    'status', 'cancelado',
    'mensagem', 'Agendamento recusado com sucesso.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recusar_agendamento_online(uuid, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. RPC ATUALIZAR_CLIENTE_ORCAMENTO (Permite se agendamento vinculado foi cancelado)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atualizar_cliente_orcamento(
  p_orcamento_id uuid,
  p_cliente_id uuid,
  p_veiculo_id uuid DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orcamento record;
  v_cat_id uuid;
  v_ret jsonb;
  v_ag_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO v_orcamento FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT a.status INTO v_ag_status
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;

    IF FOUND AND v_ag_status <> 'cancelado' THEN
      RAISE EXCEPTION 'Este orçamento já foi convertido em OS/agendamento e não permite troca de cliente por aqui.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clientes
    WHERE id = p_cliente_id AND tenant_id = v_orcamento.tenant_id
  ) THEN
    RAISE EXCEPTION 'Cliente inválido ou pertencente a outra oficina.';
  END IF;

  IF p_veiculo_id IS NOT NULL THEN
    SELECT categoria_id INTO v_cat_id
    FROM public.veiculos
    WHERE id = p_veiculo_id AND tenant_id = v_orcamento.tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Veículo inválido ou pertencente a outra oficina.';
    END IF;
  END IF;

  IF p_categoria_id IS NOT NULL THEN
    v_cat_id := p_categoria_id;
  END IF;

  IF v_cat_id IS NULL THEN
    v_cat_id := v_orcamento.categoria_id;
  END IF;

  UPDATE public.orcamentos
  SET cliente_id = p_cliente_id,
      veiculo_id = p_veiculo_id,
      categoria_id = v_cat_id,
      agendamento_id = CASE
        WHEN agendamento_id IS NOT NULL AND (v_ag_status IS NULL OR v_ag_status = 'cancelado') THEN NULL
        ELSE agendamento_id
      END,
      cliente_nome_avulso = NULL,
      cliente_telefone_avulso = NULL,
      veiculo_descricao_avulsa = CASE WHEN p_veiculo_id IS NOT NULL THEN NULL ELSE veiculo_descricao_avulsa END,
      updated_at = now()
  WHERE id = p_orcamento_id;

  SELECT jsonb_build_object(
    'id', o.id,
    'cliente_id', o.cliente_id,
    'veiculo_id', o.veiculo_id,
    'categoria_id', o.categoria_id,
    'status', o.status,
    'updated_at', o.updated_at
  ) INTO v_ret
  FROM public.orcamentos o
  WHERE o.id = p_orcamento_id;

  RETURN v_ret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.atualizar_cliente_orcamento(uuid, uuid, uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. RPC ORCAMENTO_PUBLICO (Ignora agendamentos cancelados + fallback assinatura_nome)
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
  v_tem_cliente_cadastrado boolean := false;
  v_tem_veiculo boolean := false;
  v_tem_agendamento boolean := false;
  v_primeiro_nome text := null;
  v_nome_avulso_efetivo text := null;
  v_assinatura_nome_valida text := null;
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
  v_incluir_fotos boolean := false;
  v_incluir_termos boolean := false;
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
  v_incluir_termo_risco boolean := false;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  SELECT t.* INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_orcamento.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oficina não encontrada.';
  END IF;

  v_status_atual := v_orcamento.status;
  IF v_status_atual IN ('enviado', 'visualizado') AND v_orcamento.enviado_em IS NOT NULL THEN
    IF (v_orcamento.enviado_em::date + coalesce(v_orcamento.validade_dias, 7)) < current_date THEN
      v_status_atual := 'expirado';
      UPDATE public.orcamentos SET status = 'expirado', updated_at = now() WHERE id = v_orcamento.id;
    END IF;
  END IF;

  IF v_orcamento.status = 'enviado' AND v_status_atual = 'enviado' THEN
    UPDATE public.orcamentos
    SET status = 'visualizado',
        visualizado_em = now(),
        updated_at = now()
    WHERE id = v_orcamento.id;
    v_status_atual := 'visualizado';
  END IF;

  v_modo_orc := coalesce(v_orcamento.modo_orcamento, '3_niveis');
  v_alteracao_pendente := coalesce(v_orcamento.alteracao_pendente, false);
  v_alteracao_historico_json := coalesce(v_orcamento.alteracao_historico, '[]'::jsonb);

  v_incluir_fotos := coalesce(v_orcamento.incluir_fotos, false);
  v_incluir_termos := coalesce(v_orcamento.incluir_termos, false);
  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_incluir_termos, false);
  v_incluir_termo_risco := coalesce(v_orcamento.incluir_termo_risco, false) AND v_incluir_termo_resp;

  -- 5. Cliente (cadastrado ou dados parciais/avulsos ou assinatura prévia válida)
  v_tem_cliente_cadastrado := (v_orcamento.cliente_id IS NOT NULL);
  IF v_orcamento.cliente_id IS NOT NULL THEN
    SELECT
      split_part(c.nome, ' ', 1),
      c.telefone
    INTO v_primeiro_nome, v_cliente_tel
    FROM public.clientes c
    WHERE c.id = v_orcamento.cliente_id;
  END IF;

  IF nullif(trim(coalesce(v_orcamento.assinatura_nome, '')), '') IS NOT NULL
     AND length(trim(v_orcamento.assinatura_nome)) >= 2
     AND lower(trim(v_orcamento.assinatura_nome)) NOT IN ('cliente', 'não informado', 'nao informado', 'sem nome') THEN
    v_assinatura_nome_valida := trim(v_orcamento.assinatura_nome);
  END IF;

  IF nullif(trim(coalesce(v_orcamento.cliente_nome_avulso, '')), '') IS NOT NULL
     AND lower(trim(v_orcamento.cliente_nome_avulso)) NOT IN ('cliente', 'não informado', 'nao informado', 'sem nome') THEN
    v_nome_avulso_efetivo := trim(v_orcamento.cliente_nome_avulso);
  ELSIF NOT v_tem_cliente_cadastrado THEN
    v_nome_avulso_efetivo := v_assinatura_nome_valida;
  END IF;

  IF (v_primeiro_nome IS NULL OR trim(v_primeiro_nome) = '') AND v_nome_avulso_efetivo IS NOT NULL THEN
    v_primeiro_nome := split_part(v_nome_avulso_efetivo, ' ', 1);
  END IF;

  IF (v_cliente_tel IS NULL OR trim(v_cliente_tel) = '') AND nullif(trim(v_orcamento.cliente_telefone_avulso), '') IS NOT NULL THEN
    v_cliente_tel := trim(v_orcamento.cliente_telefone_avulso);
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

  -- 7. Agendamento vinculado (somente quando ativo / não cancelado)
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
    WHERE a.id = v_orcamento.agendamento_id
      AND a.status <> 'cancelado';

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

  -- 9. Níveis e Itens da Proposta (inclui Serviços Únicos via i.servico_nome)
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
                'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
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
                'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
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
          'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
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
          'servico_nome', coalesce(s.nome, c.nome, i.servico_nome, 'Serviço'),
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
  IF v_incluir_termo_gar THEN
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
  END IF;

  -- 12. Termo de Responsabilidade
  IF v_incluir_termo_resp THEN
    v_termo_resp_final := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_final IS NULL OR trim(v_termo_resp_final) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_final
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_final IS NULL OR trim(v_termo_resp_final) = '' THEN
      v_termo_resp_final := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  ELSE
    v_termo_resp_final := '';
  END IF;

  -- 13. Retorno completo
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
    'tem_cliente_cadastrado', v_tem_cliente_cadastrado,
    'cliente_primeiro_nome', v_primeiro_nome,
    'cliente_telefone', v_cliente_tel,
    'cliente_nome_avulso', v_nome_avulso_efetivo,
    'cliente_telefone_avulso', v_orcamento.cliente_telefone_avulso,
    'veiculo_descricao_avulsa', v_orcamento.veiculo_descricao_avulsa,
    'desconto', v_desconto_json,
    'incluir_fotos', v_incluir_fotos,
    'incluir_termos', v_incluir_termos,
    'incluir_termo_responsabilidade', v_incluir_termo_resp,
    'incluir_termo_garantia', v_incluir_termo_gar,
    'garantia_meses', coalesce(v_orcamento.garantia_meses, 3),
    'incluir_termo_risco', v_incluir_termo_risco,
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
      'antecedencia_minima_horas', coalesce(v_tenant.antecedencia_minima_horas, 2),
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
-- 6. RPC RESPONDER_ORCAMENTO (Aproveita p_nome_assinante em cliente_nome_avulso)
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
  v_nome_assinante_valido boolean := false;
  v_cliente_nome text;
  v_nivel_valor numeric(10,2) := 0;
  v_ag_status text;
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

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT a.status INTO v_ag_status
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;

    IF FOUND AND v_ag_status <> 'cancelado' THEN
      RAISE EXCEPTION 'Este orçamento já possui um agendamento vinculado. Entre em contato com a oficina para realizar alterações.';
    END IF;
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

    v_nome_limpo := nullif(trim(coalesce(p_nome_assinante, '')), '');
    v_nome_assinante_valido := (
      v_nome_limpo IS NOT NULL
      AND length(v_nome_limpo) >= 2
      AND lower(v_nome_limpo) NOT IN ('cliente', 'não informado', 'nao informado', 'sem nome')
    );

    UPDATE public.orcamentos
    SET status = 'aprovado',
        nivel_aprovado = p_nivel,
        numero_os = v_os_num,
        respondido_em = now(),
        assinatura_path = coalesce(p_assinatura_base64, assinatura_path),
        assinatura_nome = coalesce(v_nome_limpo, assinatura_nome),
        assinatura_data = CASE WHEN p_assinatura_base64 IS NOT NULL THEN now() ELSE assinatura_data END,
        cliente_nome_avulso = CASE
          WHEN cliente_id IS NULL AND v_nome_assinante_valido THEN
            CASE
              WHEN nullif(trim(coalesce(cliente_nome_avulso, '')), '') IS NULL
                OR lower(trim(cliente_nome_avulso)) IN ('cliente', 'não informado', 'nao informado', 'sem nome')
                THEN v_nome_limpo
              WHEN position(' ' IN trim(cliente_nome_avulso)) = 0
                AND position(' ' IN v_nome_limpo) > 0
                AND lower(v_nome_limpo) LIKE lower(trim(cliente_nome_avulso)) || ' %'
                THEN v_nome_limpo
              ELSE cliente_nome_avulso
            END
          ELSE cliente_nome_avulso
        END,
        updated_at = now()
    WHERE id = v_orcamento.id;

    IF v_orcamento.cliente_id IS NOT NULL THEN
      SELECT c.nome INTO v_cliente_nome
      FROM public.clientes c
      WHERE c.id = v_orcamento.cliente_id;
    END IF;

    IF v_cliente_nome IS NULL OR trim(v_cliente_nome) = '' THEN
      v_cliente_nome := coalesce(
        CASE WHEN v_nome_assinante_valido THEN v_nome_limpo ELSE NULL END,
        nullif(trim(v_orcamento.cliente_nome_avulso), ''),
        'Cliente'
      );
    END IF;

    PERFORM public.criar_notificacao_interna(
      v_orcamento.tenant_id,
      NULL,
      'oficina',
      'gerente',
      'orcamento_aprovado',
      '🎉 Orçamento Aprovado!',
      coalesce(CASE WHEN v_nome_assinante_valido THEN v_nome_limpo ELSE NULL END, v_cliente_nome, 'Cliente') || ' aprovou a proposta #' || lpad(v_os_num::text, 4, '0') || ' (' || upper(p_nivel) || ') no valor de R$ ' || to_char(coalesce(v_nivel_valor, 0), 'FM999G999G990D00') || '.',
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
-- 7. RPC CONFIRMAR_ALTERACAO_ORCAMENTO (Recria com suporte UUID e captura de nome)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.confirmar_alteracao_orcamento(text, text, text);
DROP FUNCTION IF EXISTS public.confirmar_alteracao_orcamento(uuid, text, text);

CREATE OR REPLACE FUNCTION public.confirmar_alteracao_orcamento(
  p_token uuid,
  p_assinatura_base64 text,
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
  v_historico jsonb;
  v_len int;
  v_elem jsonb;
  v_novo_historico jsonb := '[]'::jsonb;
  i int;
  v_nome_limpo text;
  v_nome_assinante_valido boolean := false;
BEGIN
  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.token_publico = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT coalesce(v_orcamento.alteracao_pendente, false) THEN
    RAISE EXCEPTION 'Não há nenhuma alteração pendente de assinatura para este orçamento.';
  END IF;

  v_nome_limpo := nullif(trim(coalesce(p_nome_assinante, '')), '');
  v_nome_assinante_valido := (
    v_nome_limpo IS NOT NULL
    AND length(v_nome_limpo) >= 2
    AND lower(v_nome_limpo) NOT IN ('cliente', 'não informado', 'nao informado', 'sem nome')
  );

  v_historico := coalesce(v_orcamento.alteracao_historico, '[]'::jsonb);
  v_len := jsonb_array_length(v_historico);

  IF v_len > 0 THEN
    FOR i IN 0 .. (v_len - 1) LOOP
      v_elem := v_historico->i;
      IF i = (v_len - 1) THEN
        v_elem := jsonb_set(v_elem, '{status}', '"assinado"'::jsonb);
        v_elem := jsonb_set(v_elem, '{assinado_em}', to_jsonb(now()));
        v_elem := jsonb_set(v_elem, '{assinante}', to_jsonb(coalesce(v_nome_limpo, v_orcamento.assinatura_nome, 'Cliente')));
      END IF;
      v_novo_historico := v_novo_historico || v_elem;
    END LOOP;
  END IF;

  UPDATE public.orcamentos
  SET alteracao_pendente = false,
      alteracao_historico = v_novo_historico,
      assinatura_path = coalesce(p_assinatura_base64, assinatura_path),
      assinatura_nome = coalesce(v_nome_limpo, assinatura_nome),
      assinatura_data = now(),
      cliente_nome_avulso = CASE
        WHEN cliente_id IS NULL AND v_nome_assinante_valido THEN
          CASE
            WHEN nullif(trim(coalesce(cliente_nome_avulso, '')), '') IS NULL
              OR lower(trim(cliente_nome_avulso)) IN ('cliente', 'não informado', 'nao informado', 'sem nome')
              THEN v_nome_limpo
            WHEN position(' ' IN trim(cliente_nome_avulso)) = 0
              AND position(' ' IN v_nome_limpo) > 0
              AND lower(v_nome_limpo) LIKE lower(trim(cliente_nome_avulso)) || ' %'
              THEN v_nome_limpo
            ELSE cliente_nome_avulso
          END
        ELSE cliente_nome_avulso
      END,
      updated_at = now()
  WHERE id = v_orcamento.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_alteracao_orcamento(uuid, text, text) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 8. RPC CONVERTER_ORCAMENTO_EM_AGENDAMENTO (Trata agendamento cancelado)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_agendamento(
  p_orcamento uuid,
  p_inicio timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_orcamento record;
  v_nivel_rec record;
  v_tenant record;
  v_agendamento_id uuid;
  v_ag_existente_status text;
  v_servico_principal uuid;
  v_modo_ocupacao text := 'slot';
  v_dias_ocupados integer := 1;
  v_valor_final numeric(10,2) := 0.00;
  v_os_num integer;
  v_termo_resp_texto text := '';
  v_termo_gar_texto text := '';
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT o.* INTO v_orcamento
  FROM public.orcamentos o
  WHERE o.id = p_orcamento;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.';
  END IF;

  IF NOT public.tem_papel(v_orcamento.tenant_id, ARRAY['dono', 'gerente']::public.app_role[]) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  IF v_orcamento.status NOT IN ('aprovado', 'finalizado') THEN
    RAISE EXCEPTION 'Apenas orçamentos aprovados podem ser convertidos em agendamento.';
  END IF;

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT a.status INTO v_ag_existente_status
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;

    IF FOUND AND v_ag_existente_status <> 'cancelado' THEN
      RETURN v_orcamento.agendamento_id;
    END IF;

    UPDATE public.orcamentos
    SET agendamento_id = NULL,
        updated_at = now()
    WHERE id = p_orcamento;
  END IF;

  IF v_orcamento.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Vincule ou cadastre os dados do cliente antes de converter este orçamento em OS/agendamento.';
  END IF;

  IF v_orcamento.nivel_aprovado IS NULL THEN
    RAISE EXCEPTION 'Nenhum nível aprovado foi registrado para este orçamento.';
  END IF;

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = p_orcamento AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nível aprovado não encontrado.';
  END IF;

  SELECT i.servico_id INTO v_servico_principal
  FROM public.orcamento_nivel_itens i
  WHERE i.nivel_id = v_nivel_rec.id
  ORDER BY (CASE WHEN i.servico_id IS NOT NULL THEN 0 ELSE 1 END), i.ordem ASC
  LIMIT 1;

  IF v_servico_principal IS NOT NULL THEN
    SELECT coalesce(s.modo_ocupacao, 'slot'), coalesce(s.dias_ocupados, 1)
    INTO v_modo_ocupacao, v_dias_ocupados
    FROM public.servicos s WHERE s.id = v_servico_principal;
  END IF;

  v_valor_final := coalesce(v_nivel_rec.valor_total, 0);
  IF v_orcamento.desconto_valor > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_valor_final := round(v_valor_final * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_valor_final := greatest(0.00, v_valor_final - v_orcamento.desconto_valor);
    END IF;
  END IF;

  v_os_num := v_orcamento.numero_os;
  IF v_os_num IS NULL THEN
    v_os_num := public.proximo_numero_os(v_orcamento.tenant_id);
  END IF;

  SELECT t.* INTO v_tenant FROM public.tenants t WHERE t.id = v_orcamento.tenant_id;

  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, false);

  IF v_incluir_termo_resp THEN
    v_termo_resp_texto := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_texto
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '' THEN
      v_termo_resp_texto := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  END IF;

  IF v_incluir_termo_gar AND v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  INSERT INTO public.agendamentos (
    tenant_id,
    cliente_id,
    veiculo_id,
    servico_id,
    categoria_id,
    inicio,
    duracao_minutos,
    duracao_total,
    modo_ocupacao,
    modo_ocupacao_efetivo,
    dias_ocupados,
    preco_estimado,
    preco_estimado_total,
    status,
    origem,
    observacoes,
    criado_por,
    numero_os,
    termo_garantia_id,
    termo_responsabilidade_texto,
    termo_garantia_texto
  ) VALUES (
    v_orcamento.tenant_id,
    v_orcamento.cliente_id,
    v_orcamento.veiculo_id,
    v_servico_principal,
    v_orcamento.categoria_id,
    p_inicio,
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_nivel_rec.duracao_total, 60),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_modo_ocupacao, 'slot'),
    coalesce(v_dias_ocupados, 1),
    v_valor_final,
    v_valor_final,
    'agendado',
    'orcamento',
    coalesce(v_orcamento.observacoes, '') || ' (Convertido do Orçamento ORC' || lpad(v_orcamento.numero::text, 4, '0') || ' - OS ' || lpad(v_os_num::text, 4, '0') || ' - ' || v_nivel_rec.titulo || ')',
    auth.uid(),
    v_os_num,
    CASE WHEN v_incluir_termo_gar THEN v_orcamento.termo_garantia_id ELSE NULL END,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  INSERT INTO public.agendamento_itens (
    tenant_id,
    agendamento_id,
    servico_id,
    combo_id,
    servico_nome,
    duracao_minutos,
    preco_estimado,
    modo_ocupacao,
    dias_ocupados,
    ordem
  )
  SELECT
    v_orcamento.tenant_id,
    v_agendamento_id,
    i.servico_id,
    i.combo_id,
    coalesce(s.nome, i.servico_nome),
    coalesce(i.duracao_minutos, 60),
    coalesce(i.preco, 0),
    coalesce(s.modo_ocupacao, 'slot'),
    coalesce(s.dias_ocupados, 1),
    coalesce(i.ordem, 0)
  FROM public.orcamento_nivel_itens i
  LEFT JOIN public.servicos s ON s.id = i.servico_id
  WHERE i.nivel_id = v_nivel_rec.id;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
      updated_at = now()
  WHERE id = p_orcamento;

  RETURN v_agendamento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_agendamento(uuid, timestamptz) TO authenticated;

-- ------------------------------------------------------------------------------
-- 9. RPC AGENDAR_ORCAMENTO_PUBLICO (Preserva 0168 + trata cancelado + assinatura_nome)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null,
  p_cliente_nome text DEFAULT null,
  p_cliente_telefone text DEFAULT null,
  p_veiculo_modelo text DEFAULT null,
  p_veiculo_placa text DEFAULT null
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
  v_ag_existente_status text;
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

  -- Variáveis para cadastro de cliente/veículo parciais
  v_cliente_id uuid;
  v_veiculo_id uuid;
  v_categoria_id uuid;
  v_assinatura_nome_valido text := null;
  v_nome_limpo text;
  v_tel_limpo text;
  v_tel_digitos text;
  v_tel_norm text;
  v_modelo_limpo text;
  v_placa_raw text;
  v_placa_final text;
  v_veic_obs text := null;
  v_termo_resp_texto text := '';
  v_termo_gar_texto text := '';
  v_incluir_termo_resp boolean := false;
  v_incluir_termo_gar boolean := false;
BEGIN
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

  IF v_orcamento.agendamento_id IS NOT NULL THEN
    SELECT a.status INTO v_ag_existente_status
    FROM public.agendamentos a
    WHERE a.id = v_orcamento.agendamento_id;

    IF FOUND AND v_ag_existente_status <> 'cancelado' THEN
      RAISE EXCEPTION 'Este orçamento já possui um agendamento vinculado.';
    END IF;

    UPDATE public.orcamentos
    SET agendamento_id = NULL,
        updated_at = now()
    WHERE id = v_orcamento.id;
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

  v_cliente_id := v_orcamento.cliente_id;
  v_veiculo_id := v_orcamento.veiculo_id;
  v_categoria_id := v_orcamento.categoria_id;

  IF v_categoria_id IS NULL THEN
    SELECT cv.id INTO v_categoria_id
    FROM public.categorias_veiculo cv
    WHERE cv.tenant_id = v_orcamento.tenant_id
    ORDER BY cv.ordem ASC, cv.created_at ASC
    LIMIT 1;
  END IF;

  IF v_cliente_id IS NULL THEN
    IF nullif(trim(coalesce(v_orcamento.assinatura_nome, '')), '') IS NOT NULL
       AND length(trim(v_orcamento.assinatura_nome)) >= 2
       AND lower(trim(v_orcamento.assinatura_nome)) NOT IN ('cliente', 'não informado', 'nao informado', 'sem nome') THEN
      v_assinatura_nome_valido := trim(v_orcamento.assinatura_nome);
    END IF;

    v_nome_limpo := nullif(trim(coalesce(
      nullif(trim(coalesce(p_cliente_nome, '')), ''),
      nullif(trim(coalesce(v_orcamento.cliente_nome_avulso, '')), ''),
      v_assinatura_nome_valido
    )), '');
    v_tel_limpo := nullif(trim(coalesce(p_cliente_telefone, v_orcamento.cliente_telefone_avulso)), '');
    v_tel_digitos := regexp_replace(coalesce(v_tel_limpo, ''), '\D', '', 'g');

    IF v_nome_limpo IS NULL OR length(v_nome_limpo) < 2 THEN
      RAISE EXCEPTION 'Informe seu nome completo para concluir o agendamento.';
    END IF;

    IF v_tel_limpo IS NOT NULL AND length(v_tel_digitos) < 8 THEN
      RAISE EXCEPTION 'Informe um WhatsApp ou telefone válido (com DDD) ou marque que não possui celular.';
    END IF;

    IF length(v_tel_digitos) >= 8 THEN
      v_tel_norm := public.normalizar_telefone(v_tel_limpo);

      SELECT c.id INTO v_cliente_id
      FROM public.clientes c
      WHERE c.tenant_id = v_orcamento.tenant_id
        AND COALESCE(c.ativo, true) = true
        AND (
          regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = v_tel_digitos
          OR (v_tel_norm IS NOT NULL AND public.normalizar_telefone(c.telefone) = v_tel_norm)
        )
      ORDER BY c.created_at ASC
      LIMIT 1;
    END IF;

    IF v_cliente_id IS NULL THEN
      INSERT INTO public.clientes (
        tenant_id, nome, telefone, origem, ativo
      ) VALUES (
        v_orcamento.tenant_id, v_nome_limpo, v_tel_limpo, 'online', true
      ) RETURNING id INTO v_cliente_id;
    END IF;

    IF v_veiculo_id IS NULL AND v_categoria_id IS NOT NULL THEN
      v_modelo_limpo := nullif(trim(coalesce(p_veiculo_modelo, v_orcamento.veiculo_descricao_avulsa)), '');
      v_placa_raw := upper(regexp_replace(coalesce(p_veiculo_placa, ''), '[^a-zA-Z0-9]', '', 'g'));

      IF v_modelo_limpo IS NOT NULL OR nullif(v_placa_raw, '') IS NOT NULL THEN
        IF nullif(v_placa_raw, '') IS NULL OR v_placa_raw IN ('SEMPLACA', 'SEM', 'SP', 'NAOTEM', 'TESTE') THEN
          v_placa_final := 'PROV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
        ELSE
          SELECT v.id INTO v_veiculo_id
          FROM public.veiculos v
          WHERE v.tenant_id = v_orcamento.tenant_id
            AND v.placa = v_placa_raw
            AND v.cliente_id = v_cliente_id
          LIMIT 1;

          IF v_veiculo_id IS NULL THEN
            IF EXISTS (
              SELECT 1 FROM public.veiculos v
              WHERE v.tenant_id = v_orcamento.tenant_id AND v.placa = v_placa_raw
            ) THEN
              v_placa_final := 'PROV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
              v_veic_obs := 'Placa informada no agendamento online: ' || v_placa_raw;
            ELSE
              v_placa_final := v_placa_raw;
            END IF;
          END IF;
        END IF;

        IF v_veiculo_id IS NULL THEN
          INSERT INTO public.veiculos (
            tenant_id, cliente_id, categoria_id, placa, modelo, observacoes, ativo
          ) VALUES (
            v_orcamento.tenant_id, v_cliente_id, v_categoria_id, v_placa_final, coalesce(v_modelo_limpo, 'Veículo'), v_veic_obs, true
          ) RETURNING id INTO v_veiculo_id;

          INSERT INTO public.veiculo_donos (
            tenant_id, veiculo_id, cliente_id, inicio
          ) VALUES (
            v_orcamento.tenant_id, v_veiculo_id, v_cliente_id, current_date
          );
        END IF;
      END IF;
    END IF;

    UPDATE public.orcamentos
    SET cliente_id = v_cliente_id,
        veiculo_id = coalesce(v_veiculo_id, veiculo_id),
        categoria_id = coalesce(v_categoria_id, categoria_id),
        cliente_nome_avulso = NULL,
        cliente_telefone_avulso = NULL,
        veiculo_descricao_avulsa = CASE WHEN v_veiculo_id IS NOT NULL THEN NULL ELSE veiculo_descricao_avulsa END,
        updated_at = now()
    WHERE id = v_orcamento.id;
  END IF;

  SELECT n.* INTO v_nivel_rec
  FROM public.orcamento_niveis n
  WHERE n.orcamento_id = v_orcamento.id AND n.nivel = v_orcamento.nivel_aprovado;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dados do pacote aprovado não foram encontrados.';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'servico_id', servico_id,
        'combo_id', combo_id,
        'duracao_minutos', duracao_minutos
      )
    ),
    '[]'::jsonb
  )
  INTO v_itens_json
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id;

  SELECT disponivel, termino_previsto INTO v_is_disponivel, v_termino_previsto
  FROM public.horarios_disponiveis(
    v_orcamento.tenant_id,
    v_data,
    v_itens_json,
    v_categoria_id,
    null
  )
  WHERE horario = v_hora;

  IF NOT coalesce(v_is_disponivel, false) THEN
    RAISE EXCEPTION 'O horário selecionado não está mais disponível na agenda.';
  END IF;

  SELECT servico_id INTO v_servico_id_primeiro
  FROM public.orcamento_nivel_itens
  WHERE nivel_id = v_nivel_rec.id
  ORDER BY (CASE WHEN servico_id IS NOT NULL THEN 0 ELSE 1 END), ordem ASC
  LIMIT 1;

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

  IF v_orcamento.desconto_valor > 0 AND v_orcamento.desconto_tipo IS NOT NULL THEN
    IF v_orcamento.desconto_tipo = 'porcentagem' THEN
      v_total_calculado := round(v_total_calculado * (1.0 - (v_orcamento.desconto_valor / 100.0)), 2);
    ELSIF v_orcamento.desconto_tipo = 'valor_fixo' THEN
      v_total_calculado := greatest(0.00, v_total_calculado - v_orcamento.desconto_valor);
    END IF;
  END IF;

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

  v_os_num := coalesce(v_orcamento.numero_os, public.proximo_numero_os(v_orcamento.tenant_id));

  v_obs_final := coalesce(v_orcamento.observacoes, '');
  IF v_is_transbordo THEN
    v_obs_final := trim(v_obs_final || ' [Transbordo Aceito pelo Cliente: Término previsto em ' || to_char(v_termino_previsto AT TIME ZONE coalesce(v_tenant.fuso_horario, 'America/Sao_Paulo'), 'DD/MM/YYYY às HH24:MI') || ']');
  END IF;

  v_incluir_termo_resp := coalesce(v_orcamento.incluir_termo_responsabilidade, v_orcamento.incluir_termos, false);
  v_incluir_termo_gar := coalesce(v_orcamento.incluir_termo_garantia, v_orcamento.incluir_termos, false);

  IF v_incluir_termo_resp THEN
    v_termo_resp_texto := v_orcamento.termo_responsabilidade_texto;
    IF (v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '') AND v_orcamento.termo_responsabilidade_id IS NOT NULL THEN
      SELECT tg.conteudo INTO v_termo_resp_texto
      FROM public.termos_garantia tg
      WHERE tg.id = v_orcamento.termo_responsabilidade_id;
    END IF;
    IF v_termo_resp_texto IS NULL OR trim(v_termo_resp_texto) = '' THEN
      v_termo_resp_texto := coalesce(v_tenant.termo_responsabilidade, '');
    END IF;
  END IF;

  IF v_incluir_termo_gar AND v_orcamento.termo_garantia_id IS NOT NULL THEN
    SELECT tg.conteudo INTO v_termo_gar_texto
    FROM public.termos_garantia tg
    WHERE tg.id = v_orcamento.termo_garantia_id;
  END IF;

  INSERT INTO public.agendamentos (
    tenant_id, cliente_id, veiculo_id, servico_id, categoria_id, numero_os,
    inicio, duracao_minutos, duracao_total, modo_ocupacao, modo_ocupacao_efetivo, dias_ocupados,
    preco_estimado, preco_estimado_total, status, origem,
    observacoes, sinal_valor, sinal_status, previsao_entrega,
    transbordo_aceito_em, transbordo_aceite_user_agent, transbordo_aceite_ip,
    termo_garantia_id, termo_responsabilidade_texto, termo_garantia_texto
  ) VALUES (
    v_orcamento.tenant_id, v_cliente_id, v_veiculo_id, v_servico_id_primeiro, v_categoria_id, v_os_num,
    p_inicio, v_duracao_total_calculada, v_duracao_total_calculada, coalesce(v_modo_efetivo, 'slot'), coalesce(v_modo_efetivo, 'slot'), coalesce(v_dias_item, 1),
    v_total_calculado, v_total_calculado, v_status_inicial, 'orcamento',
    nullif(v_obs_final, ''), v_sinal_valor_calc, v_sinal_status_final, v_termino_previsto,
    CASE WHEN v_is_transbordo THEN now() ELSE null END,
    CASE WHEN v_is_transbordo THEN p_user_agent ELSE null END,
    CASE WHEN v_is_transbordo THEN p_ip ELSE null END,
    CASE WHEN v_incluir_termo_gar THEN v_orcamento.termo_garantia_id ELSE null END,
    nullif(v_termo_resp_texto, ''),
    nullif(v_termo_gar_texto, '')
  ) RETURNING id INTO v_agendamento_id;

  FOR v_item IN
    SELECT i.*, s.nome AS cat_servico_nome, s.modo_ocupacao AS cat_modo, s.dias_ocupados AS cat_dias
    FROM public.orcamento_nivel_itens i
    LEFT JOIN public.servicos s ON s.id = i.servico_id
    WHERE i.nivel_id = v_nivel_rec.id
    ORDER BY i.ordem ASC
  LOOP
    INSERT INTO public.agendamento_itens (
      tenant_id, agendamento_id, servico_id, combo_id, servico_nome,
      duracao_minutos, preco_estimado, modo_ocupacao, dias_ocupados, ordem
    ) VALUES (
      v_orcamento.tenant_id, v_agendamento_id, v_item.servico_id, v_item.combo_id,
      coalesce(v_item.cat_servico_nome, v_item.servico_nome),
      coalesce(v_item.duracao_minutos, 60), coalesce(v_item.preco, 0),
      coalesce(v_item.cat_modo, v_modo_item, 'transborda'), coalesce(v_item.cat_dias, v_dias_item, 1), v_ordem
    );
    v_ordem := v_ordem + 1;
  END LOOP;

  PERFORM public.recalcular_agendamento_totais(v_agendamento_id);

  UPDATE public.orcamentos
  SET agendamento_id = v_agendamento_id,
      numero_os = v_os_num,
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

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz, boolean, text, text, text, text, text, text) TO anon, authenticated;

-- Notifica PostgREST para recarregar o schema cache
NOTIFY pgrst, 'reload schema';

