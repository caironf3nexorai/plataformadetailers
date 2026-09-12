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
 * Detecta se uma mensagem de erro está em inglês ou contém termos técnicos de sistema/banco
 */
export function ehMensagemEmInglesOuTecnica(texto: string): boolean {
  if (!texto || typeof texto !== 'string') return false;
  const t = texto.toLowerCase();

  const termosTecnicos = [
    'column',
    'relation',
    'constraint',
    'violates',
    'foreign key',
    'unique constraint',
    'check constraint',
    'not-null constraint',
    'null value in column',
    'does not exist',
    'syntax error',
    'invalid input syntax',
    'permission denied',
    'row-level security',
    'deadlock',
    'statement timeout',
    'failed to fetch',
    'networkerror',
    'network request failed',
    'invalid login credentials',
    'user already registered',
    'email not confirmed',
    'password should be',
    'token has expired',
    'auth session missing',
    'jwt expired',
    'refresh token',
    'email rate limit',
    'user not found',
    'operator does not exist',
    'function',
    'select ',
    'insert into',
    'update ',
    'delete from',
    'pg-',
    'error:',
    'exception:',
    'cannot ',
    'could not ',
    'status code'
  ];

  return termosTecnicos.some(termo => t.includes(termo));
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
    const msgAutomatica = `[AUTO-ERR][REF: ${traduzido.codigoRef}][TELA: ${tela}][TITULO: ${traduzido.titulo}][MSG: ${traduzido.mensagem}] ${traduzido.detalheTecnico}`;
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
 * Traduz erros técnicos de Postgres, Supabase Auth, PostgREST ou Rede para mensagens claras em Português
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
  const msgLower = rawMessage.toLowerCase();

  let titulo = 'Ops! Algo deu errado';
  let mensagem = 'Ocorreu um erro ao processar sua solicitação.';
  let acao: string | undefined = undefined;
  let ehInesperado = true;

  // 1. Erros do Supabase Auth (Autenticação / Login / Cadastro)
  if (msgLower.includes('user already registered') || msgLower.includes('email already registered')) {
    titulo = 'E-mail já cadastrado';
    mensagem = 'Este endereço de e-mail já possui cadastro no sistema.';
    acao = 'Faça login com sua senha ou utilize a recuperação de senha.';
    ehInesperado = false;
  } else if (msgLower.includes('invalid login credentials') || msgLower.includes('invalid credentials')) {
    titulo = 'Credenciais incorretas';
    mensagem = 'E-mail ou senha incorretos.';
    acao = 'Verifique se digitou o e-mail e a senha corretamente.';
    ehInesperado = false;
  } else if (msgLower.includes('email not confirmed')) {
    titulo = 'E-mail não confirmado';
    mensagem = 'O endereço de e-mail desta conta ainda não foi confirmado.';
    acao = 'Verifique a caixa de entrada e spam do seu e-mail para ativar a conta.';
    ehInesperado = false;
  } else if (msgLower.includes('password should be at least') || msgLower.includes('password is too short')) {
    titulo = 'Senha muito curta';
    mensagem = 'A senha precisa ter no mínimo 6 caracteres.';
    acao = 'Escolha uma senha mais segura com pelo menos 6 caracteres.';
    ehInesperado = false;
  } else if (msgLower.includes('token has expired') || msgLower.includes('token is invalid') || msgLower.includes('otp expired')) {
    titulo = 'Link expirado';
    mensagem = 'O link ou código de confirmação expirou ou é inválido.';
    acao = 'Solicite um novo link de confirmação ou recuperação.';
    ehInesperado = false;
  } else if (msgLower.includes('auth session missing') || msgLower.includes('jwt expired') || msgLower.includes('invalid refresh token')) {
    titulo = 'Sessão expirada';
    mensagem = 'Sua sessão de acesso expirou por segurança.';
    acao = 'Faça login novamente na plataforma para continuar.';
    ehInesperado = false;
  } else if (msgLower.includes('user not found')) {
    titulo = 'Usuário não encontrado';
    mensagem = 'Nenhum usuário foi localizado com os dados informados.';
    acao = 'Confirme o e-mail digitado e tente novamente.';
    ehInesperado = false;
  } else if (msgLower.includes('rate limit') || msgLower.includes('too many requests')) {
    titulo = 'Muitas tentativas';
    mensagem = 'Muitas tentativas em pouco tempo. Aguarde alguns instantes antes de tentar novamente.';
    acao = 'Aguarde 1 a 2 minutos e tente novamente.';
    ehInesperado = false;
  } else if (msgLower.includes('only request this once every 60 seconds')) {
    titulo = 'Aguarde um momento';
    mensagem = 'Por segurança, você só pode solicitar isso uma vez a cada 60 segundos.';
    acao = 'Aguarde 60 segundos antes de enviar outra solicitação.';
    ehInesperado = false;
  } else if (msgLower.includes('signup requires a valid password')) {
    titulo = 'Senha obrigatória';
    mensagem = 'Informe uma senha válida para concluir o cadastro.';
    acao = 'Digite uma senha segura.';
    ehInesperado = false;
  }

  // 2. Conexão / Rede / HTTP
  else if (
    msgLower.includes('failed to fetch') ||
    msgLower.includes('networkerror') ||
    msgLower.includes('network request failed') ||
    msgLower.includes('the operation was aborted') ||
    msgLower.includes('load failed')
  ) {
    titulo = 'Sem conexão';
    mensagem = 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente de novo.';
    acao = 'Verifique seu Wi-Fi ou dados móveis.';
    ehInesperado = false;
  } else if (code === '504' || msgLower.includes('504') || msgLower.includes('gateway timeout')) {
    titulo = 'Tempo esgotado';
    mensagem = 'O servidor demorou mais do que o esperado para responder.';
    acao = 'Aguarde alguns segundos e tente novamente.';
    ehInesperado = true;
  } else if (code === '502' || msgLower.includes('502') || msgLower.includes('bad gateway')) {
    titulo = 'Servidor indisponível';
    mensagem = 'O serviço está temporariamente indisponível no momento.';
    acao = 'Aguarde um momento e recarregue a página.';
    ehInesperado = true;
  } else if (msgLower.includes('payload too large') || msgLower.includes('file too large')) {
    titulo = 'Arquivo muito grande';
    mensagem = 'O arquivo selecionado excede o tamanho máximo permitido.';
    acao = 'Envie um arquivo menor ou reduza a resolução da imagem.';
    ehInesperado = false;
  }

  // 3. Erros do Gateway Asaas / JSON
  else if (rawMessage.includes('"errors"') && (rawMessage.includes('"description"') || rawMessage.includes('"code"'))) {
    try {
      const jsonMatch = rawMessage.match(/\{.*"errors".*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          titulo = 'Aviso de Pagamento';
          mensagem = parsed.errors.map((e: any) => e.description || e.code).join(' • ');
          acao = 'Verifique os dados preenchidos e tente novamente.';
          ehInesperado = false;
        }
      }
    } catch (e) {
      // Ignore fallback
    }
  }

  // 4. Erros de Banco de Dados Postgres (Coluna, Tabela ou Função Inexistente)
  else if (code === '42703' || (msgLower.includes('column') && msgLower.includes('does not exist'))) {
    titulo = 'Estrutura do Banco Desatualizada';
    const colMatch = rawMessage.match(/column "([^"]+)" does not exist/i);
    if (colMatch) {
      mensagem = `A coluna "${colMatch[1]}" não foi encontrada no banco de dados.`;
      acao = 'Execute a migration correspondente no Supabase para atualizar a tabela.';
    } else {
      mensagem = 'Um campo necessário não foi encontrado no banco de dados.';
      acao = 'Verifique as migrations pendentes no Supabase.';
    }
    ehInesperado = true;
  } else if (code === '42P01' || (msgLower.includes('relation') && msgLower.includes('does not exist')) || (msgLower.includes('table') && msgLower.includes('does not exist'))) {
    titulo = 'Tabela Inexistente';
    const tabMatch = rawMessage.match(/(?:relation|table) "([^"]+)" does not exist/i);
    if (tabMatch) {
      mensagem = `A tabela "${tabMatch[1]}" não foi encontrada no banco de dados.`;
      acao = 'Execute a migration correspondente no Supabase para criar a tabela.';
    } else {
      mensagem = 'Uma tabela necessária não foi encontrada no banco de dados.';
      acao = 'Verifique as migrations pendentes no Supabase.';
    }
    ehInesperado = true;
  } else if (code === '42883' || (msgLower.includes('function') && msgLower.includes('does not exist'))) {
    titulo = 'Função de Banco Inexistente';
    const funcMatch = rawMessage.match(/function ([^\s(]+).* does not exist/i);
    if (funcMatch) {
      mensagem = `A função interna "${funcMatch[1]}" não foi encontrada no banco de dados.`;
      acao = 'Execute a migration correspondente no Supabase para criar a função RPC.';
    } else {
      mensagem = 'A função interna solicitada não existe no banco de dados.';
      acao = 'Verifique as migrations pendentes no Supabase.';
    }
    ehInesperado = true;
  }

  // 5. Duplicidade (23505 / unique constraint / duplicate key)
  else if (
    code === '23505' ||
    msgLower.includes('23505') ||
    msgLower.includes('unique constraint') ||
    msgLower.includes('duplicate key') ||
    msgLower.includes('já existe')
  ) {
    titulo = 'Item já cadastrado';
    if (msgLower.includes('servicos_tenant_id_nome_key') || msgLower.includes('servicos') || msgLower.includes('servico')) {
      titulo = 'Serviço já cadastrado';
      mensagem = 'Já existe um serviço cadastrado com este mesmo nome no catálogo da sua oficina.';
      acao = 'Escolha um nome diferente ou edite o serviço já existente no catálogo.';
    } else if (msgLower.includes('telefone') || msgLower.includes('phone')) {
      mensagem = 'Já existe um cadastro com este número de telefone.';
      acao = 'Verifique se o cliente já está cadastrado.';
    } else if (msgLower.includes('email')) {
      mensagem = 'Já existe um cadastro com este endereço de e-mail.';
      acao = 'Verifique se o cadastro já existe.';
    } else if (msgLower.includes('cpf') || msgLower.includes('cnpj')) {
      mensagem = 'Já existe um cadastro com este CPF/CNPJ.';
      acao = 'Verifique os dados cadastrados.';
    } else if (msgLower.includes('placa')) {
      mensagem = 'Já existe um veículo cadastrado com esta placa.';
      acao = 'Busque pela placa para visualizar o veículo.';
    } else if (msgLower.includes('tenants_slug_key') || msgLower.includes('slug')) {
      mensagem = 'Já existe uma oficina cadastrada com este identificador/slug.';
      acao = 'Escolha outro nome ou identificador.';
    } else {
      mensagem = 'Já existe um registro com esses mesmos dados cadastrado no sistema.';
      acao = 'Verifique se o item já está cadastrado ou utilize dados diferentes.';
    }
    ehInesperado = false;
  }

  // 6. Chave Estrangeira / Vínculo (23503 / foreign key)
  else if (code === '23503' || msgLower.includes('foreign key') || msgLower.includes('violates foreign key')) {
    titulo = 'Item em uso';
    mensagem = 'Não é possível excluir ou alterar este item pois ele está vinculado a outros registros no sistema (ex: atendimentos, orçamentos ou histórico).';
    acao = 'Remova as associações ou desative o item em vez de excluí-lo.';
    ehInesperado = false;
  }

  // 7. Not Null Constraint (23502 / null value)
  else if (code === '23502' || msgLower.includes('not-null constraint') || msgLower.includes('null value in column')) {
    titulo = 'Campo obrigatório';
    const colMatch = rawMessage.match(/column "([^"]+)"/i);
    if (colMatch) {
      mensagem = `O campo "${colMatch[1]}" é obrigatório e não pode ficar em branco.`;
    } else {
      mensagem = 'Um ou mais campos obrigatórios não foram preenchidos.';
    }
    acao = 'Preencha todos os campos obrigatórios do formulário.';
    ehInesperado = false;
  }

  // 8. Check Constraint (23514 / check constraint)
  else if (code === '23514' || msgLower.includes('check constraint') || msgLower.includes('violates check constraint')) {
    titulo = 'Valor inválido';
    mensagem = 'Um dos valores preenchidos não é permitido pelas regras do sistema.';
    acao = 'Revise os dados preenchidos no formulário e tente novamente.';
    ehInesperado = false;
  }

  // 9. Conversão de tipo / Sintaxe de Entrada (22P02)
  else if (code === '22P02' || msgLower.includes('invalid input syntax')) {
    titulo = 'Formato de dados inválido';
    if (msgLower.includes('type uuid')) {
      mensagem = 'O código identificador (UUID) fornecido é inválido.';
    } else if (msgLower.includes('type integer') || msgLower.includes('type numeric')) {
      mensagem = 'O valor numérico informado é inválido.';
    } else if (msgLower.includes('type date') || msgLower.includes('type timestamp')) {
      mensagem = 'O formato de data ou hora informado é inválido.';
    } else {
      mensagem = 'Os dados informados possuem um formato incompatível com o sistema.';
    }
    acao = 'Verifique as informações preenchidas e tente novamente.';
    ehInesperado = false;
  }

  // 10. Permissão / RLS (42501)
  else if (code === '42501' || msgLower.includes('permission denied') || msgLower.includes('row-level security') || msgLower.includes('policy')) {
    titulo = 'Acesso restrito';
    mensagem = 'Você não possui permissão para realizar esta ação no sistema.';
    acao = 'Solicite permissão de acesso ao proprietário ou administrador da oficina.';
    ehInesperado = false;
  }

  // 11. Concorrência / Timeout / Conexão
  else if (code === '40001' || msgLower.includes('could not serialize') || msgLower.includes('deadlock')) {
    titulo = 'Conflito temporário';
    mensagem = 'Houve um conflito temporário com outra operação simultânea.';
    acao = 'Tente novamente em instantes.';
    ehInesperado = false;
  } else if (code === '57014' || msgLower.includes('statement timeout') || msgLower.includes('canceling statement')) {
    titulo = 'Tempo esgotado';
    mensagem = 'A consulta demorou muito tempo e foi cancelada pelo servidor para evitar lentidão.';
    acao = 'Tente filtrar melhor os dados ou aguarde alguns instantes.';
    ehInesperado = true;
  } else if (code === '08001' || code === '08006' || msgLower.includes('connection refused')) {
    titulo = 'Servidor desconectado';
    mensagem = 'Não foi possível estabelecer conexão com o banco de dados.';
    acao = 'Aguarde alguns instantes e tente novamente.';
    ehInesperado = true;
  }

  // 12. Regras de Negócio de Despesas Fixas
  else if (
    msgLower.includes('range lower bound must be less than or equal to range upper bound') ||
    msgLower.includes('range_error')
  ) {
    titulo = 'Vigência inválida';
    mensagem = 'A nova vigência precisa começar depois do início da atual.';
    acao = 'Ajuste a data de início da vigência.';
    ehInesperado = false;
  } else if (msgLower.includes('despesa_sem_sobreposicao') || msgLower.includes('exclusion_violation')) {
    titulo = 'Vigência conflitante';
    mensagem = 'Já existe uma despesa com este nome vigente neste período.';
    acao = 'Verifique as datas da vigência ou escolha outro nome.';
    ehInesperado = false;
  }

  // 13. Exceções customizadas com RAISE EXCEPTION (P0001)
  else if (code === 'P0001') {
    titulo = 'Aviso do Sistema';
    if (!ehMensagemEmInglesOuTecnica(rawMessage)) {
      mensagem = rawMessage;
    } else {
      mensagem = 'Ação não permitida pelas regras do sistema.';
    }
    ehInesperado = false;
  }

  // 14. Fallback Geral
  else {
    const ehInglesOuTecnico = ehMensagemEmInglesOuTecnica(rawMessage);

    if (!ehInglesOuTecnico && rawMessage.length < 200) {
      titulo = 'Atenção';
      mensagem = rawMessage;
      ehInesperado = false;
    } else {
      titulo = 'Erro de Processamento';
      mensagem = `Ocorreu uma falha no sistema. Código de referência: ${codigoRef}`;
      acao = 'Por favor, tente novamente ou informe o suporte com o código de referência.';
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
