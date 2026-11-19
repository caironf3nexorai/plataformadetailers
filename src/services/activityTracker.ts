import { supabase } from '../lib/supabase';

/**
 * Cache e travas em memória para baixo consumo de banco e zero flood
 */
const ROUTE_DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutos por rota por usuário
const ACTION_DEBOUNCE_MS = 5 * 1000; // 5 segundos por ação repetida por usuário
const ADMIN_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos de cache por usuário

const routeAccessCache = new Map<string, number>(); // Chave: `${userId}:${pathname}`
const actionAccessCache = new Map<string, number>(); // Chave: `${userId}:${label}_${rota}`

interface AdminCacheEntry {
  isAdmin: boolean;
  timestamp: number;
}
const adminCacheByUserId = new Map<string, AdminCacheEntry>();

/**
 * Mapeamento de rotas para rótulos legíveis e amigáveis em português
 */
interface MapeamentoRotaAtividade {
  padrao: RegExp;
  label: string;
}

const ROTAS_ATIVIDADE: MapeamentoRotaAtividade[] = [
  { padrao: /^\/$/, label: 'Visualizou Painel do Dia' },
  { padrao: /^\/hoje$/, label: 'Visualizou Painel do Dia' },
  { padrao: /^\/dashboard$/, label: 'Visualizou Dashboard' },
  { padrao: /^\/agenda$/, label: 'Abriu Agendamentos' },
  { padrao: /^\/atendimentos\/[^/]+$/, label: 'Visualizou Atendimento' },
  { padrao: /^\/execucao\/[^/]+$/, label: 'Abriu Execução de OS' },
  { padrao: /^\/checkin\/[^/]+$/, label: 'Abriu Vistoria de Entrada' },
  { padrao: /^\/checkout\/[^/]+$/, label: 'Abriu Vistoria de Saída' },
  { padrao: /^\/clientes$/, label: 'Acessou Clientes' },
  { padrao: /^\/clientes\/[^/]+$/, label: 'Visualizou Ficha do Cliente' },
  { padrao: /^\/veiculos\/[^/]+$/, label: 'Visualizou Ficha do Veículo' },
  { padrao: /^\/orcamentos$/, label: 'Acessou Orçamentos' },
  { padrao: /^\/orcamentos\/[^/]+$/, label: 'Visualizou Orçamento' },
  { padrao: /^\/servicos$/, label: 'Abriu Catálogo de Serviços' },
  { padrao: /^\/servicos\/novo$/, label: 'Criando Novo Serviço' },
  { padrao: /^\/servicos\/precificacao$/, label: 'Acessou Precificação' },
  { padrao: /^\/servicos\/matriz$/, label: 'Acessou Matriz de Preços' },
  { padrao: /^\/servicos\/[^/]+$/, label: 'Editou Serviço' },
  { padrao: /^\/financeiro$/, label: 'Abriu Painel Financeiro' },
  { padrao: /^\/financeiro\/contas-a-receber$/, label: 'Acessou Contas a Receber' },
  { padrao: /^\/financeiro\/formas-pagamento$/, label: 'Acessou Formas de Pagamento' },
  { padrao: /^\/configuracoes$/, label: 'Acessou Configurações da Oficina' },
  { padrao: /^\/minha-oficina$/, label: 'Acessou Configurações da Oficina' },
  { padrao: /^\/configuracoes\/equipe$/, label: 'Acessou Gestão da Equipe' },
  { padrao: /^\/treinamentos?$/, label: 'Acessou Academia Detailer' },
  { padrao: /^\/academia$/, label: 'Acessou Academia Detailer' },
  { padrao: /^\/arquivos-digitais$/, label: 'Acessou Arquivos Digitais' },
  { padrao: /^\/diluicao$/, label: 'Acessou Calculadora de Diluição' },
  { padrao: /^\/calculadora(?:-diluicao)?$/, label: 'Acessou Calculadora' },
  { padrao: /^\/indique$/, label: 'Acessou Indique e Ganhe' },
  { padrao: /^\/estoque$/, label: 'Acessou Controle de Estoque' },
  { padrao: /^\/vistorias$/, label: 'Acessou Histórico de Vistorias' },
  { padrao: /^\/vistorias\/expirando$/, label: 'Acessou Fotos Prestes a Expirar' },
];

/**
 * Converte rota em rótulo humanizado
 */
export function traduzirRotaParaRotulo(pathname: string): string {
  if (!pathname) return 'Acessou Início';
  const cleanPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  for (const item of ROTAS_ATIVIDADE) {
    if (item.padrao.test(cleanPath)) {
      return item.label;
    }
  }

  // Fallback baseado na raiz da URL
  const partes = cleanPath.split('/').filter(Boolean);
  if (partes.length === 0) return 'Visualizou Painel do Dia';

  const primeira = partes[0].toLowerCase();
  switch (primeira) {
    case 'clientes': return 'Acessou Clientes';
    case 'veiculos': return 'Acessou Veículos';
    case 'agenda':
    case 'agendamentos':
    case 'atendimentos': return 'Abriu Agendamentos';
    case 'orcamentos': return 'Acessou Orçamentos';
    case 'servicos': return 'Abriu Catálogo de Serviços';
    case 'financeiro': return 'Abriu Painel Financeiro';
    case 'configuracoes': return 'Acessou Configurações da Oficina';
    case 'treinamentos': return 'Acessou Academia Detailer';
    case 'estoque': return 'Acessou Controle de Estoque';
    case 'vistorias': return 'Acessou Vistorias';
    default:
      return `Navegou para ${primeira.charAt(0).toUpperCase() + primeira.slice(1)}`;
  }
}

/**
 * Checa se o usuário atual é administrador da plataforma (com cache indexado por userId)
 */
export async function verificarSeAdmin(userId?: string | null): Promise<boolean> {
  let targetUid = userId;
  if (!targetUid) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      targetUid = session?.user?.id;
    } catch {
      return false;
    }
  }

  if (!targetUid) {
    return false;
  }

  const agora = Date.now();
  const cached = adminCacheByUserId.get(targetUid);
  if (cached && (agora - cached.timestamp) < ADMIN_CACHE_TTL_MS) {
    return cached.isAdmin;
  }

  try {
    const { data, error } = await supabase.rpc('is_platform_admin');
    if (error) {
      return false;
    }
    const isAdmin = !!data;
    adminCacheByUserId.set(targetUid, { isAdmin, timestamp: agora });
    return isAdmin;
  } catch {
    return false;
  }
}

/**
 * Força atualização do status de admin por usuário (ex: no login/logout ou testes)
 */
export function setStatusAdmin(userId: string, isAdmin: boolean): void {
  adminCacheByUserId.set(userId, { isAdmin, timestamp: Date.now() });
}

/**
 * Limpa todos os caches em memória (chamado ao deslogar ou alternar de conta)
 */
export function limparCacheAtividade(): void {
  routeAccessCache.clear();
  actionAccessCache.clear();
  adminCacheByUserId.clear();
}

/**
 * Registra navegação de tela ('page_view') com debounce de 2 minutos por rota por usuário.
 * Totalmente seguro, não bloqueante e com bypass completo para administradores.
 */
export async function registrarVisualizacaoPagina(
  pathname: string,
  userId?: string | null
): Promise<void> {
  // Ignora rotas vazias, públicas, de autenticação ou administrativas
  if (
    !pathname ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/lancamento') ||
    pathname.startsWith('/parceiro') ||
    pathname.startsWith('/convite') ||
    pathname.startsWith('/entrar') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/criar-conta') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/recuperar-senha') ||
    pathname.startsWith('/redefinir-senha') ||
    pathname.startsWith('/nova-oficina') ||
    pathname.startsWith('/orcamento/') ||
    pathname.startsWith('/vistoria/') ||
    pathname.startsWith('/termo-risco/') ||
    pathname.startsWith('/garantia/') ||
    pathname.startsWith('/certificado/') ||
    pathname.startsWith('/agendar/')
  ) {
    return;
  }

  // Obtém o user_id real da sessão ativa do Supabase para garantir auth.uid() = user_id exigido pela RLS
  let uid = userId;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const sessionUid = session?.user?.id;
    if (sessionUid) {
      uid = sessionUid;
    }
  } catch {
    // mantém fallback do userId recebido
  }

  if (!uid) return;

  // Verifica se o usuário é administrador (não polui logs com suporte/testes)
  const isAdmin = await verificarSeAdmin(uid);
  if (isAdmin) {
    return;
  }

  const agora = Date.now();
  const cacheKey = `${uid}:${pathname}`;
  const ultimoAcesso = routeAccessCache.get(cacheKey);

  // Trava em memória de 2 minutos por usuário por rota
  if (ultimoAcesso && (agora - ultimoAcesso) < ROUTE_DEBOUNCE_MS) {
    return;
  }

  const label = traduzirRotaParaRotulo(pathname);

  // Gravação silenciosa (Fire & Forget)
  try {
    const { error } = await supabase
      .from('user_activity_logs')
      .insert({
        user_id: uid,
        event_type: 'page_view',
        route: pathname,
        label,
      });

    if (error) {
      if (import.meta.env.DEV) {
        console.warn('[ActivityTracker] Falha ao registrar page_view:', error.message);
      }
      return;
    }

    // Só atualiza o timestamp se o insert teve sucesso
    routeAccessCache.set(cacheKey, agora);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[ActivityTracker] Exceção ao registrar page_view:', err);
    }
  }
}

/**
 * Registra uma ação principal ('action') do usuário (ex: Criou Cliente, Salvou Precificação).
 * Trava de 5 segundos para evitar duplicação em múltiplos cliques.
 */
export async function registrarAcaoUsuario(
  label: string,
  rotaOpcional?: string,
  userId?: string | null
): Promise<void> {
  if (!label) return;

  let uid = userId;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const sessionUid = session?.user?.id;
    if (sessionUid) {
      uid = sessionUid;
    }
  } catch {
    // mantém fallback do userId recebido
  }

  if (!uid) return;

  const isAdmin = await verificarSeAdmin(uid);
  if (isAdmin) {
    return;
  }

  const agora = Date.now();
  const rota = rotaOpcional || (typeof window !== 'undefined' ? window.location.pathname : null);
  const cacheKey = `${uid}:${label}_${rota || ''}`;
  const ultimoDisparo = actionAccessCache.get(cacheKey);

  if (ultimoDisparo && (agora - ultimoDisparo) < ACTION_DEBOUNCE_MS) {
    return;
  }

  // Gravação silenciosa (Fire & Forget)
  try {
    const { error } = await supabase
      .from('user_activity_logs')
      .insert({
        user_id: uid,
        event_type: 'action',
        route: rota,
        label,
      });

    if (error) {
      if (import.meta.env.DEV) {
        console.warn('[ActivityTracker] Falha ao registrar action:', error.message);
      }
      return;
    }

    actionAccessCache.set(cacheKey, agora);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[ActivityTracker] Exceção ao registrar action:', err);
    }
  }
}
