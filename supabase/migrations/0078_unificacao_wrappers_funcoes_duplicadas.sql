-- ==============================================================================
-- MIGRAÇÃO 0078: UNIFICAÇÃO DE ASSINATURAS E WRAPPERS FINOS DAS 5 FUNÇÕES
-- Garante que o corpo real de cada função exista em APENAS UM LUGAR, enquanto
-- todas as sobrecargas legadas tornam-se wrappers finos repassando valores padrão.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CRIAR_AGENDAMENTO
-- Canônica atual: (uuid, uuid, jsonb, uuid, timestamptz, text, boolean)
-- ------------------------------------------------------------------------------

-- Drops explícitos das sobrecargas legadas para evitar erro 42P13 de defaults existentes
DROP FUNCTION IF EXISTS public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text, boolean);
DROP FUNCTION IF EXISTS public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.criar_agendamento(uuid, uuid, jsonb, uuid, timestamptz, text);

-- Wrapper 1.1: Versão com p_servico UUID e p_forcado boolean (7 parâmetros)
-- Converte p_servico em array JSONB para eliminar qualquer ambiguidade de tipo
CREATE OR REPLACE FUNCTION public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_servico uuid,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text DEFAULT NULL,
  p_forcado boolean DEFAULT FALSE
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.criar_agendamento(
    p_cliente => p_cliente,
    p_veiculo => p_veiculo,
    p_itens => CASE 
                 WHEN p_servico IS NOT NULL THEN jsonb_build_array(jsonb_build_object('servico_id', p_servico, 'combo_id', null))
                 ELSE '[]'::jsonb 
               END,
    p_categoria => p_categoria,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_forcado => coalesce(p_forcado, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text, boolean) TO authenticated;

-- Wrapper 1.2: Versão com p_servico UUID (6 parâmetros)
CREATE OR REPLACE FUNCTION public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_servico uuid,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.criar_agendamento(
    p_cliente => p_cliente,
    p_veiculo => p_veiculo,
    p_itens => CASE 
                 WHEN p_servico IS NOT NULL THEN jsonb_build_array(jsonb_build_object('servico_id', p_servico, 'combo_id', null))
                 ELSE '[]'::jsonb 
               END,
    p_categoria => p_categoria,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_forcado => false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_agendamento(uuid, uuid, uuid, uuid, timestamptz, text) TO authenticated;

-- Wrapper 1.3: Versão com p_itens JSONB (6 parâmetros, sem p_forcado)
CREATE OR REPLACE FUNCTION public.criar_agendamento(
  p_cliente uuid,
  p_veiculo uuid,
  p_itens jsonb,
  p_categoria uuid,
  p_inicio timestamptz,
  p_observacoes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.criar_agendamento(
    p_cliente => p_cliente,
    p_veiculo => p_veiculo,
    p_itens => p_itens,
    p_categoria => p_categoria,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_forcado => false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_agendamento(uuid, uuid, jsonb, uuid, timestamptz, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 2. AGENDAR_CLIENTE_ONLINE E AGENDAR_ONLINE
-- Canônica atual: agendar_cliente_online de 12 parâmetros
-- ------------------------------------------------------------------------------

-- Drops explícitos das sobrecargas legadas
DROP FUNCTION IF EXISTS public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text);
DROP FUNCTION IF EXISTS public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text);

-- Wrapper 2.1: agendar_cliente_online de 9 parâmetros
CREATE OR REPLACE FUNCTION public.agendar_cliente_online(
  p_slug text,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_veiculo_placa text,
  p_veiculo_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_cliente_online(
    p_slug => p_slug,
    p_cliente_nome => p_cliente_nome,
    p_cliente_telefone => p_cliente_telefone,
    p_veiculo_placa => p_veiculo_placa,
    p_veiculo_modelo => p_veiculo_modelo,
    p_categoria => p_categoria,
    p_itens => p_itens,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_transbordo_aceito => false,
    p_user_agent => null,
    p_ip => null
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cliente_online(text, text, text, text, text, uuid, jsonb, timestamptz, text) TO anon, authenticated;

-- Wrapper 2.2: agendar_online de 12 parâmetros (Alias direto para agendar_cliente_online)
CREATE OR REPLACE FUNCTION public.agendar_online(
  p_slug text,
  p_nome text,
  p_telefone text,
  p_placa text,
  p_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text DEFAULT null,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_cliente_online(
    p_slug => p_slug,
    p_cliente_nome => p_nome,
    p_cliente_telefone => p_telefone,
    p_veiculo_placa => p_placa,
    p_veiculo_modelo => p_modelo,
    p_categoria => p_categoria,
    p_itens => p_itens,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_transbordo_aceito => p_transbordo_aceito,
    p_user_agent => p_user_agent,
    p_ip => p_ip
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, boolean, text, text) TO anon, authenticated;

-- Wrapper 2.3: agendar_online legado de 15 parâmetros (marca, ano, cor)
CREATE OR REPLACE FUNCTION public.agendar_online(
  p_slug text,
  p_nome text,
  p_telefone text,
  p_placa text,
  p_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text DEFAULT null,
  p_marca text DEFAULT null,
  p_ano integer DEFAULT null,
  p_cor text DEFAULT null,
  p_transbordo_aceito boolean DEFAULT false,
  p_user_agent text DEFAULT null,
  p_ip text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_cliente_online(
    p_slug => p_slug,
    p_cliente_nome => p_nome,
    p_cliente_telefone => p_telefone,
    p_veiculo_placa => p_placa,
    p_veiculo_modelo => p_modelo,
    p_categoria => p_categoria,
    p_itens => p_itens,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_transbordo_aceito => p_transbordo_aceito,
    p_user_agent => p_user_agent,
    p_ip => p_ip
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text, text, integer, text, boolean, text, text) TO anon, authenticated;

-- Wrapper 2.4: agendar_online legado de 9 parâmetros
CREATE OR REPLACE FUNCTION public.agendar_online(
  p_slug text,
  p_nome text,
  p_telefone text,
  p_placa text,
  p_modelo text,
  p_categoria uuid,
  p_itens jsonb,
  p_inicio timestamptz,
  p_observacoes text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_cliente_online(
    p_slug => p_slug,
    p_cliente_nome => p_nome,
    p_cliente_telefone => p_telefone,
    p_veiculo_placa => p_placa,
    p_veiculo_modelo => p_modelo,
    p_categoria => p_categoria,
    p_itens => p_itens,
    p_inicio => p_inicio,
    p_observacoes => p_observacoes,
    p_transbordo_aceito => false,
    p_user_agent => null,
    p_ip => null
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_online(text, text, text, text, text, uuid, jsonb, timestamptz, text) TO anon, authenticated;


-- ------------------------------------------------------------------------------
-- 3. AGENDAR_ORCAMENTO_PUBLICO
-- Canônica atual: (uuid, timestamptz, boolean, text, text)
-- ------------------------------------------------------------------------------

-- Drops explícitos das sobrecargas legadas
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz, boolean, text, text);
DROP FUNCTION IF EXISTS public.agendar_orcamento_publico(text, timestamptz);

-- Wrapper 3.1: Versão com 2 parâmetros (uuid, timestamptz)
CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token uuid,
  p_inicio timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_orcamento_publico(
    p_token => p_token,
    p_inicio => p_inicio,
    p_transbordo_aceito => false,
    p_user_agent => null,
    p_ip => null
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(uuid, timestamptz) TO anon, authenticated;

-- Wrapper 3.2: Versão aceitando p_token como TEXT com 5 parâmetros
CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token text,
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
BEGIN
  RETURN public.agendar_orcamento_publico(
    p_token => p_token::uuid,
    p_inicio => p_inicio,
    p_transbordo_aceito => p_transbordo_aceito,
    p_user_agent => p_user_agent,
    p_ip => p_ip
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(text, timestamptz, boolean, text, text) TO anon, authenticated;

-- Wrapper 3.3: Versão aceitando p_token como TEXT com 2 parâmetros
CREATE OR REPLACE FUNCTION public.agendar_orcamento_publico(
  p_token text,
  p_inicio timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.agendar_orcamento_publico(
    p_token => p_token::uuid,
    p_inicio => p_inicio,
    p_transbordo_aceito => false,
    p_user_agent => null,
    p_ip => null
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_orcamento_publico(text, timestamptz) TO anon, authenticated;


-- ------------------------------------------------------------------------------
-- 4. FINALIZAR_EXECUCAO_COM_PAGAMENTOS
-- Canônica atual: (uuid, jsonb, jsonb, jsonb, text, text, numeric, text) -> 8 parâmetros
-- ------------------------------------------------------------------------------

-- Drops explícitos das sobrecargas legadas
DROP FUNCTION IF EXISTS public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text);

-- Wrapper 4.1: Versão com 5 parâmetros (sem desconto)
CREATE OR REPLACE FUNCTION public.finalizar_execucao_com_pagamentos(
  p_execucao uuid,
  p_pagamentos jsonb,
  p_valores jsonb,
  p_consumos jsonb,
  p_observacoes text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.finalizar_execucao_com_pagamentos(
    p_execucao => p_execucao,
    p_pagamentos => p_pagamentos,
    p_valores => p_valores,
    p_consumos => p_consumos,
    p_observacoes => p_observacoes,
    p_desconto_tipo => null,
    p_desconto_valor => 0,
    p_desconto_motivo => null
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalizar_execucao_com_pagamentos(uuid, jsonb, jsonb, jsonb, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 5. HORARIOS_DISPONIVEIS
-- Canônica atual: (uuid, date, jsonb, uuid, uuid) -> Payload JSONB em p_itens
-- ------------------------------------------------------------------------------

-- Drops explícitos das sobrecargas legadas
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.horarios_disponiveis(uuid, date, jsonb, uuid);

-- Wrapper 5.1: Versão com p_servico UUID (5 parâmetros)
CREATE OR REPLACE FUNCTION public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_servico uuid,
  p_categoria uuid,
  p_ignorar_agendamento uuid DEFAULT NULL
) RETURNS TABLE (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT hd.horario, hd.disponivel, hd.motivo, hd.termino_previsto
  FROM public.horarios_disponiveis(
    p_tenant => p_tenant,
    p_data => p_data,
    p_itens => CASE 
                 WHEN p_servico IS NOT NULL THEN jsonb_build_array(jsonb_build_object('servico_id', p_servico))
                 ELSE NULL 
               END,
    p_categoria => p_categoria,
    p_ignorar_agendamento => p_ignorar_agendamento
  ) hd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.horarios_disponiveis(uuid, date, uuid, uuid, uuid) TO anon, authenticated;

-- Wrapper 5.2: Versão com p_servico UUID (4 parâmetros)
CREATE OR REPLACE FUNCTION public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_servico uuid,
  p_categoria uuid
) RETURNS TABLE (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT hd.horario, hd.disponivel, hd.motivo, hd.termino_previsto
  FROM public.horarios_disponiveis(
    p_tenant => p_tenant,
    p_data => p_data,
    p_itens => CASE 
                 WHEN p_servico IS NOT NULL THEN jsonb_build_array(jsonb_build_object('servico_id', p_servico))
                 ELSE NULL 
               END,
    p_categoria => p_categoria,
    p_ignorar_agendamento => NULL
  ) hd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.horarios_disponiveis(uuid, date, uuid, uuid) TO anon, authenticated;

-- Wrapper 5.3: Versão com p_itens JSONB (4 parâmetros)
CREATE OR REPLACE FUNCTION public.horarios_disponiveis(
  p_tenant uuid,
  p_data date,
  p_itens jsonb,
  p_categoria uuid
) RETURNS TABLE (
  horario time,
  disponivel boolean,
  motivo text,
  termino_previsto timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT hd.horario, hd.disponivel, hd.motivo, hd.termino_previsto
  FROM public.horarios_disponiveis(
    p_tenant => p_tenant,
    p_data => p_data,
    p_itens => p_itens,
    p_categoria => p_categoria,
    p_ignorar_agendamento => NULL
  ) hd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.horarios_disponiveis(uuid, date, jsonb, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
