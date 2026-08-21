import { supabase } from '../lib/supabase';

export interface ErroTraduzido {
  titulo: string;
  mensagem: string;
  acao?: string;
  codigoRef: string; // Ex: ERR-7K3F
  ehInesperado: boolean;
  detalheTecnico: string;
  codigoPostgres?: string;
}

// Armazena em memória/sessionStorage quais erros técnicos já foram registrados no feedback para evitar duplicações
const ERROS_REGISTRADOS_KEY = 'plataforma_erros_registrados_v1';

function obterErrosRegistrados(): Set<string> {
  try {
    const raw = sessionStorage.getItem(ERROS_REGISTRADOS_KEY);
    if (raw) {
      return new Set(JSON.parse(raw));
    }
  } catch (e) {
    // Ignore fallback
  }
  return new Set();
}

function marcarErroComoRegistrado(chave: string) {
  try {
    const set = obterErrosRegistrados();
    set.add(chave);
    sessionStorage.setItem(ERROS_REGISTRADOS_KEY, JSON.stringify(Array.from(set)));
  } catch (e) {
    // Ignore fallback
  }
}

/**
 * Gera um código curto aleatório de referência para erro (ex: ERR-7K3F)
 */
export function gerarCodigoRef(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let hash = '';
  for (let i = 0; i < 4; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `ERR-${hash}`;
}

/**
 * Registra silenciosamente no banco (tabela de feedbacks com tipo='erro') erros inesperados
 */
async function registrarErroAutomatico(traduzido: ErroTraduzido, telaOrigem?: string) {
  if (!traduzido.ehInesperado) return;

  const tela = telaOrigem || (typeof window !== 'undefined' ? window.location.pathname : 'desconhecida');
  const chaveDeduplicacao = `${tela}::${traduzido.codigoPostgres || ''}::${traduzido.detalheTecnico.substring(0, 100)}`;

  const jaRegistrados = obterErrosRegistrados();
  if (jaRegistrados.has(chaveDeduplicacao)) {
    return; // Evita registrar repetidamente o mesmo erro na mesma sessão
  }

  marcarErroComoRegistrado(chaveDeduplicacao);

  try {
    const msgAutomatica = `[AUTO-ERR][REF: ${traduzido.codigoRef}][TELA: ${tela}] ${traduzido.detalheTecnico}`;
    await supabase.rpc('enviar_feedback', {
      p_tipo: 'erro',
      p_mensagem: msgAutomatica,
      p_tela_origem: tela,
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'desconhecido'
    });
  } catch (err) {
    // Silencioso para não interromper a experiência do usuário se a própria chamada de log falhar
    console.warn('[Auto-Feedback Error Fail]:', err);
  }
}

/**
 * Traduz erros técnicos de Postgres, PostgREST ou Rede para mensagens claras em Português
 */
export function traduzirErro(erro: any, contextoTela?: string): ErroTraduzido {
  if (!erro) {
    const codigoRef = gerarCodigoRef();
    return {
      titulo: 'Erro inesperado',
      mensagem: `Ocorreu um problema não identificado. Código de referência: ${codigoRef}`,
      codigoRef,
      ehInesperado: true,
      detalheTecnico: 'Erro nulo ou indefinido'
    };
  }

  // Se já for um erro traduzido
  if (typeof erro === 'object' && erro.codigoRef && erro.titulo && erro.mensagem) {
    return erro as ErroTraduzido;
  }

  const codigoRef = gerarCodigoRef();
  const code = String(erro?.code || erro?.status || '').trim().toUpperCase();
  const rawMessage = String(erro?.message || erro?.details || erro?.hint || (typeof erro === 'string' ? erro : JSON.stringify(erro)));
  const detalheTecnico = `${code ? `[PG-${code}] ` : ''}${rawMessage}`;

  let titulo = 'Ops! Algo deu errado';
  let mensagem = 'Ocorreu um erro ao processar sua solicitação.';
  let acao: string | undefined = undefined;
  let ehInesperado = true;

  // 1. Rede / Conexão
  const msgLower = rawMessage.toLowerCase();
  if (msgLower.includes('failed to fetch') || msgLower.includes('networkerror') || msgLower.includes('network request failed')) {
    titulo = 'Sem conexão';
    mensagem = 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente de novo.';
    acao = 'Verifique seu Wi-Fi ou dados móveis.';
    ehInesperado = false;
  }
  // 2. Erros de Banco de Dados por Código do PostgreSQL
  else if (code === '23505') {
    // Duplicidade
    titulo = 'Registro já existente';
    if (msgLower.includes('telefone') || msgLower.includes('phone')) {
      mensagem = 'Já existe um cadastro cadastrado com este número de telefone.';
    } else if (msgLower.includes('email')) {
      mensagem = 'Já existe um cadastro cadastrado com este endereço de e-mail.';
    } else if (msgLower.includes('cpf') || msgLower.includes('cnpj')) {
      mensagem = 'Já existe um cadastro cadastrado com este CPF/CNPJ.';
    } else if (msgLower.includes('placa')) {
      mensagem = 'Já existe um veículo cadastrado com esta placa.';
    } else {
      mensagem = 'Já existe um registro com esses mesmos dados no sistema.';
    }
    acao = 'Verifique se o item já está cadastrado ou utilize dados diferentes.';
    ehInesperado = false;
  } else if (code === '23503') {
    // Vínculo (Foreign Key)
    titulo = 'Item em uso';
    mensagem = 'Não é possível excluir ou alterar este item porque ele está sendo usado em outro lugar da plataforma (ex: em atendimentos ou históricos).';
    acao = 'Remova as associações deste item antes de tentar excluí-lo.';
    ehInesperado = false;
  } else if (code === '23514') {
    // Check Constraint
    titulo = 'Valor inválido';
    mensagem = 'Um dos valores preenchidos não é permitido pelas regras do sistema.';
    acao = 'Revise os campos do formulário e tente novamente.';
    ehInesperado = false;
  } else if (code === '22P02' || msgLower.includes('malformed array literal')) {
    // Conversão de tipo
    titulo = 'Erro de processamento';
    mensagem = 'Ocorreu um erro interno ao processar os dados fornecidos. Nossa equipe foi notificada automaticamente para correção.';
    acao = 'Tente novamente. Se o erro persistir, informe o suporte.';
    ehInesperado = true;
  } else if (code === '42501' || msgLower.includes('permission') || msgLower.includes('policy')) {
    // RLS / Permissão
    titulo = 'Acesso restrito';
    mensagem = 'Você não possui permissão para realizar esta ação. Fale com o dono ou gerente da oficina.';
    acao = 'Solicite permissão de acesso ao administrador do seu estabelecimento.';
    ehInesperado = false;
  } else if (code === 'P0001') {
    // Exceções nossas lançadas com RAISE EXCEPTION
    titulo = 'Aviso do Sistema';
    mensagem = rawMessage;
    ehInesperado = false;
  } else {
    // Se a mensagem original não parecer código/stacktrace técnico, exibe para o usuário
    const pareceTecnico = rawMessage.includes('SELECT') || rawMessage.includes('UPDATE') || rawMessage.includes('INSERT') || rawMessage.includes('column') || rawMessage.includes('relation') || rawMessage.includes('function');
    if (!pareceTecnico && rawMessage.length < 150) {
      titulo = 'Atenção';
      mensagem = rawMessage;
      ehInesperado = false;
    } else {
      titulo = 'Erro inesperado';
      mensagem = `Ocorreu uma falha não esperada no sistema. Referência: ${codigoRef}`;
      acao = 'Por favor, tente novamente ou avise nosso suporte se continuar acontecendo.';
      ehInesperado = true;
    }
  }

  const resultado: ErroTraduzido = {
    titulo,
    mensagem,
    acao,
    codigoRef,
    ehInesperado,
    detalheTecnico,
    codigoPostgres: code
  };

  // Dispara registro automático no banco se for um erro inesperado do sistema
  if (ehInesperado) {
    registrarErroAutomatico(resultado, contextoTela);
  }

  return resultado;
}
