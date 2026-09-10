import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { NotificacoesProvider } from './contexts/NotificacoesContext';
import { RotaProtegida } from './components/auth/RotaProtegida';
import { AppShell } from './components/layout/AppShell';
import { lazyWithRetry } from './utils/lazyWithRetry';

// Páginas Públicas (Carregamento Assíncrono sob Demanda)
const CalculadoraPublica = lazyWithRetry(() => import('./pages/CalculadoraPublica').then(m => ({ default: m.CalculadoraPublica })));
const CatalogoPublico = lazyWithRetry(() => import('./pages/CatalogoPublico').then(m => ({ default: m.CatalogoPublico })));
const FluxoAgendamentoOnline = lazyWithRetry(() => import('./pages/FluxoAgendamentoOnline').then(m => ({ default: m.FluxoAgendamentoOnline })));
const PoliticaPrivacidade = lazyWithRetry(() => import('./pages/public/PoliticaPrivacidade').then(m => ({ default: m.PoliticaPrivacidade })));
const TermosUso = lazyWithRetry(() => import('./pages/public/TermosUso').then(m => ({ default: m.TermosUso })));
const PaginaConvite = lazyWithRetry(() => import('./pages/public/PaginaConvite').then(m => ({ default: m.PaginaConvite })));
const PaginaParceiro = lazyWithRetry(() => import('./pages/public/PaginaParceiro').then(m => ({ default: m.PaginaParceiro })));

// Páginas de Autenticação
import { Entrar } from './pages/auth/Entrar';
import { CriarConta } from './pages/auth/CriarConta';
import { NovaOficina } from './pages/auth/NovaOficina';
import { Convite } from './pages/auth/Convite';
import { RecuperarSenha } from './pages/auth/RecuperarSenha';

// Páginas Principais (Core)
import { Dashboard } from './pages/Dashboard';
import { Agenda } from './pages/Agenda';
import { Clientes } from './pages/Clientes';

// Páginas Internas Especializadas (Carregamento Tardio / Lazy)
const DetalheCliente = lazyWithRetry(() => import('./pages/clientes/DetalheCliente').then(m => ({ default: m.DetalheCliente })));
const DetalheVeiculo = lazyWithRetry(() => import('./pages/clientes/DetalheVeiculo').then(m => ({ default: m.DetalheVeiculo })));
const Orcamentos = lazyWithRetry(() => import('./pages/Orcamentos').then(m => ({ default: m.Orcamentos })));
const DetalheOrcamento = lazyWithRetry(() => import('./pages/orcamentos/DetalheOrcamento').then(m => ({ default: m.DetalheOrcamento })));
const OrcamentoPublico = lazyWithRetry(() => import('./pages/OrcamentoPublico').then(m => ({ default: m.OrcamentoPublico })));
const Estoque = lazyWithRetry(() => import('./pages/Estoque').then(m => ({ default: m.Estoque })));
const Financeiro = lazyWithRetry(() => import('./pages/Financeiro').then(m => ({ default: m.Financeiro })));
const ContasReceber = lazyWithRetry(() => import('./pages/financeiro/ContasReceber').then(m => ({ default: m.ContasReceber })));
const ConfigFormasPagamento = lazyWithRetry(() => import('./pages/financeiro/ConfigFormasPagamento').then(m => ({ default: m.ConfigFormasPagamento })));
const Configuracoes = lazyWithRetry(() => import('./pages/Configuracoes').then(m => ({ default: m.Configuracoes })));
const Treinamentos = lazyWithRetry(() => import('./pages/Treinamentos').then(m => ({ default: m.Treinamentos })));
const ArquivosDigitaisPage = lazyWithRetry(() => import('./pages/ArquivosDigitaisPage').then(m => ({ default: m.ArquivosDigitaisPage })));
const IndiqueEGanhe = lazyWithRetry(() => import('./pages/IndiqueEGanhe').then(m => ({ default: m.IndiqueEGanhe })));
const DiluicaoInterna = lazyWithRetry(() => import('./pages/DiluicaoInterna').then(m => ({ default: m.DiluicaoInterna })));
const PaginaPlanos = lazyWithRetry(() => import('./pages/planos/PaginaPlanos').then(m => ({ default: m.PaginaPlanos })));

// Páginas de Serviços & Operação (Lazy)
const Servicos = lazyWithRetry(() => import('./pages/Servicos').then(m => ({ default: m.Servicos })));
const FormularioServico = lazyWithRetry(() => import('./pages/servicos/FormularioServico').then(m => ({ default: m.FormularioServico })));
const MatrizPrecos = lazyWithRetry(() => import('./pages/servicos/MatrizPrecos').then(m => ({ default: m.MatrizPrecos })));
const Precificacao = lazyWithRetry(() => import('./pages/servicos/Precificacao').then(m => ({ default: m.Precificacao })));
const FormularioCheckin = lazyWithRetry(() => import('./pages/checkin/FormularioCheckin').then(m => ({ default: m.FormularioCheckin })));
const VisualizarCheckin = lazyWithRetry(() => import('./pages/checkin/VisualizarCheckin').then(m => ({ default: m.VisualizarCheckin })));
const ExecucaoPage = lazyWithRetry(() => import('./pages/Execucao').then(m => ({ default: m.ExecucaoPage })));
const VisualizarAtendimento = lazyWithRetry(() => import('./pages/VisualizarAtendimento').then(m => ({ default: m.VisualizarAtendimento })));
const VistoriaPublica = lazyWithRetry(() => import('./pages/VistoriaPublica').then(m => ({ default: m.VistoriaPublica })));

// Carregamento Tardio (Lazy Loading) do Módulo Admin da Plataforma
const AdminGuard = lazyWithRetry(() => import('./components/admin/AdminGuard').then(m => ({ default: m.AdminGuard })));
const AdminErrorBoundary = lazyWithRetry(() => import('./components/admin/AdminErrorBoundary').then(m => ({ default: m.AdminErrorBoundary })));
const AdminLayout = lazyWithRetry(() => import('./components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const AdminOficinas = lazyWithRetry(() => import('./pages/admin/AdminOficinas').then(m => ({ default: m.AdminOficinas })));
const AdminAssinaturas = lazyWithRetry(() => import('./pages/admin/AdminAssinaturas').then(m => ({ default: m.AdminAssinaturas })));
const AdminPlanos = lazyWithRetry(() => import('./pages/admin/AdminPlanos').then(m => ({ default: m.AdminPlanos })));
const AdminPermissoes = lazyWithRetry(() => import('./pages/admin/AdminPermissoes').then(m => ({ default: m.AdminPermissoes })));
const AdminFeedbacks = lazyWithRetry(() => import('./pages/admin/AdminFeedbacks').then(m => ({ default: m.AdminFeedbacks })));
const AdminStorage = lazyWithRetry(() => import('./pages/admin/AdminStorage').then(m => ({ default: m.AdminStorage })));
const AdminAdmins = lazyWithRetry(() => import('./pages/admin/AdminAdmins').then(m => ({ default: m.AdminAdmins })));
const AdminIndicacoes = lazyWithRetry(() => import('./pages/admin/AdminIndicacoes').then(m => ({ default: m.AdminIndicacoes })));
const AdminParceiros = lazyWithRetry(() => import('./pages/admin/AdminParceiros').then(m => ({ default: m.AdminParceiros })));
const AdminPrecificacaoReferencia = lazyWithRetry(() => import('./pages/admin/AdminPrecificacaoReferencia').then(m => ({ default: m.AdminPrecificacaoReferencia })));
const AdminTreinamentos = lazyWithRetry(() => import('./pages/admin/AdminTreinamentos').then(m => ({ default: m.AdminTreinamentos })));
const AdminComunicados = lazyWithRetry(() => import('./pages/admin/AdminComunicados').then(m => ({ default: m.AdminComunicados })));
const AdminCupons = lazyWithRetry(() => import('./pages/admin/AdminCupons').then(m => ({ default: m.AdminCupons })));
const LoginParceiro = lazyWithRetry(() => import('./pages/parceiro/LoginParceiro').then(m => ({ default: m.LoginParceiro })));
const PainelParceiro = lazyWithRetry(() => import('./pages/parceiro/PainelParceiro').then(m => ({ default: m.PainelParceiro })));


const PaginaCarregando = () => (
  <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] gap-3 text-vapor-400 py-12">
    <div className="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
    <span className="font-mono text-xs text-vapor-400 tracking-wider uppercase">Carregando...</span>
  </div>
);

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <NotificacoesProvider>
          <Suspense fallback={<PaginaCarregando />}>
            <Routes>
            {/* Rotas Públicas */}
            <Route path="/termos-de-uso" element={<TermosUso />} />
            <Route path="/termos-uso" element={<TermosUso />} />
            <Route path="/politica-de-privacidade" element={<PoliticaPrivacidade />} />
            <Route path="/politica-privacidade" element={<PoliticaPrivacidade />} />
            <Route path="/orcamento/:token" element={<OrcamentoPublico />} />
            <Route path="/vistoria/:token" element={<VistoriaPublica />} />
            <Route path="/agendar/:slug/agendamento" element={<FluxoAgendamentoOnline />} />
            <Route path="/agendar/:slug/novo" element={<FluxoAgendamentoOnline />} />
            <Route path="/agendar/:slug" element={<CatalogoPublico />} />
            <Route path="/calculadora" element={<CalculadoraPublica />} />
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/login" element={<Navigate to="/entrar" replace />} />
            <Route path="/criar-conta" element={<CriarConta />} />
            <Route path="/convite/:codigo" element={<PaginaConvite />} />
            <Route path="/parceiro/login" element={<LoginParceiro />} />
            <Route path="/parceiro/painel" element={<PainelParceiro />} />
            <Route path="/parceiro/:codigo" element={<PaginaParceiro />} />
            <Route path="/convite/:token" element={<Convite />} />
            <Route path="/recuperar-senha" element={<RecuperarSenha />} />
            <Route path="/redefinir-senha" element={<RecuperarSenha />} />
            <Route path="/nova-oficina" element={<NovaOficina />} />

            {/* Módulo Admin da Plataforma (Lazy Loaded com Guard Próprio) */}
            <Route
              path="/admin"
              element={
                <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-amber-500 font-mono text-sm">CARREGANDO PAINEL ADMIN...</div>}>
                  <AdminErrorBoundary>
                    <AdminGuard>
                      <AdminLayout />
                    </AdminGuard>
                  </AdminErrorBoundary>
                </Suspense>
              }
            >
              <Route index element={<Navigate to="/admin/oficinas" replace />} />
              <Route path="oficinas" element={<AdminOficinas />} />
              <Route path="comunicados" element={<AdminComunicados />} />
              <Route path="cupons" element={<AdminCupons />} />
              <Route path="assinaturas" element={<AdminAssinaturas />} />
              <Route path="referencias-preco" element={<AdminPrecificacaoReferencia />} />
              <Route path="indicacoes" element={<AdminIndicacoes />} />
              <Route path="parceiros" element={<AdminParceiros />} />
              <Route path="planos" element={<AdminPlanos />} />
              <Route path="planos/permissoes" element={<AdminPermissoes />} />
              <Route path="feedbacks" element={<AdminFeedbacks />} />
              <Route path="storage" element={<AdminStorage />} />
              <Route path="treinamentos" element={<AdminTreinamentos />} />
              <Route path="administradores" element={<AdminAdmins />} />
            </Route>

            {/* Rotas Protegidas das Oficinas (Dentro do AppShell) */}
            <Route element={<RotaProtegida />}>
              <Route path="/" element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="hoje" element={<Agenda abaInicial="hoje" />} />
                <Route path="agenda" element={<Agenda abaInicial="hoje" />} />
                <Route path="clientes" element={<Clientes />} />
                <Route path="clientes/:id" element={<DetalheCliente />} />
                <Route path="veiculos/:id" element={<DetalheVeiculo />} />

                {/* Rotas de Vistoria de Entrada (Check-in) */}
                <Route path="checkin/:agendamentoId" element={<FormularioCheckin />} />
                <Route path="checkin/:id/ver" element={<VisualizarCheckin />} />

                {/* Rota de Execução de Serviços */}
                <Route path="execucao/:id" element={<ExecucaoPage />} />

                {/* Rota de Visualização de Atendimento Concluído */}
                <Route path="atendimento/:id" element={<VisualizarAtendimento />} />
                {/* Rotas restritas para Dono e Gerente (Operador recebe AcessoNegado) */}
                <Route element={<RotaProtegida allowedRoles={['dono', 'gerente']} />}>
                  <Route path="planos" element={<PaginaPlanos />} />
                  <Route path="orcamentos" element={<Orcamentos />} />
                  <Route path="orcamentos/:id" element={<DetalheOrcamento />} />
                  <Route path="estoque" element={<Estoque />} />
                  <Route path="financeiro" element={<Financeiro />} />
                  <Route path="financeiro/contas-a-receber" element={<ContasReceber />} />
                  <Route path="financeiro/taxas" element={<ConfigFormasPagamento />} />
                  <Route path="servicos" element={<Servicos />} />
                  <Route path="servicos/novo" element={<FormularioServico />} />
                  <Route path="servicos/precos" element={<MatrizPrecos />} />
                  <Route path="servicos/precificacao" element={<Precificacao />} />
                  <Route path="precificacao" element={<Navigate to="/servicos/precificacao" replace />} />
                  <Route path="servicos/:id" element={<FormularioServico />} />

                  <Route path="ajustes/arquivos-digitais" element={<Navigate to="/arquivos-digitais" replace />} />
                  <Route path="configuracoes/arquivos-digitais" element={<Navigate to="/arquivos-digitais" replace />} />
                  <Route path="fotos-expirando" element={<Navigate to="/arquivos-digitais" replace />} />
                  <Route path="fotos-a-expirar" element={<Navigate to="/arquivos-digitais" replace />} />
                  <Route path="arquivos-digitais" element={<ArquivosDigitaisPage />} />
                </Route>

                <Route path="treinamentos" element={<Treinamentos />} />
                <Route path="treinamento" element={<Navigate to="/treinamentos" replace />} />
                <Route path="academia" element={<Navigate to="/treinamentos" replace />} />
                <Route path="configuracoes" element={<Configuracoes />} />
                <Route path="minha-oficina" element={<Navigate to="/configuracoes" replace />} />
                <Route path="ajustes" element={<Navigate to="/configuracoes" replace />} />
                <Route path="indique" element={<IndiqueEGanhe />} />
                <Route path="indicacoes" element={<Navigate to="/indique" replace />} />
                <Route path="diluicao" element={<DiluicaoInterna />} />
              </Route>
            </Route>
            </Routes>
          </Suspense>
        </NotificacoesProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
