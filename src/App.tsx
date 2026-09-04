import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { NotificacoesProvider } from './contexts/NotificacoesContext';
import { RotaProtegida } from './components/auth/RotaProtegida';
import { AppShell } from './components/layout/AppShell';

// Páginas Públicas (Carregamento Assíncrono sob Demanda)
const CalculadoraPublica = lazy(() => import('./pages/CalculadoraPublica').then(m => ({ default: m.CalculadoraPublica })));
const CatalogoPublico = lazy(() => import('./pages/CatalogoPublico').then(m => ({ default: m.CatalogoPublico })));
const FluxoAgendamentoOnline = lazy(() => import('./pages/FluxoAgendamentoOnline').then(m => ({ default: m.FluxoAgendamentoOnline })));
const PoliticaPrivacidade = lazy(() => import('./pages/public/PoliticaPrivacidade').then(m => ({ default: m.PoliticaPrivacidade })));
const TermosUso = lazy(() => import('./pages/public/TermosUso').then(m => ({ default: m.TermosUso })));
const PaginaConvite = lazy(() => import('./pages/public/PaginaConvite').then(m => ({ default: m.PaginaConvite })));
const PaginaParceiro = lazy(() => import('./pages/public/PaginaParceiro').then(m => ({ default: m.PaginaParceiro })));

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
const DetalheCliente = lazy(() => import('./pages/clientes/DetalheCliente').then(m => ({ default: m.DetalheCliente })));
const DetalheVeiculo = lazy(() => import('./pages/clientes/DetalheVeiculo').then(m => ({ default: m.DetalheVeiculo })));
const Orcamentos = lazy(() => import('./pages/Orcamentos').then(m => ({ default: m.Orcamentos })));
const DetalheOrcamento = lazy(() => import('./pages/orcamentos/DetalheOrcamento').then(m => ({ default: m.DetalheOrcamento })));
const OrcamentoPublico = lazy(() => import('./pages/OrcamentoPublico').then(m => ({ default: m.OrcamentoPublico })));
const Estoque = lazy(() => import('./pages/Estoque').then(m => ({ default: m.Estoque })));
const Financeiro = lazy(() => import('./pages/Financeiro').then(m => ({ default: m.Financeiro })));
const ContasReceber = lazy(() => import('./pages/financeiro/ContasReceber').then(m => ({ default: m.ContasReceber })));
const ConfigFormasPagamento = lazy(() => import('./pages/financeiro/ConfigFormasPagamento').then(m => ({ default: m.ConfigFormasPagamento })));
const Configuracoes = lazy(() => import('./pages/Configuracoes').then(m => ({ default: m.Configuracoes })));
const Treinamentos = lazy(() => import('./pages/Treinamentos').then(m => ({ default: m.Treinamentos })));
const ArquivosDigitaisPage = lazy(() => import('./pages/ArquivosDigitaisPage').then(m => ({ default: m.ArquivosDigitaisPage })));
const IndiqueEGanhe = lazy(() => import('./pages/IndiqueEGanhe').then(m => ({ default: m.IndiqueEGanhe })));
const DiluicaoInterna = lazy(() => import('./pages/DiluicaoInterna').then(m => ({ default: m.DiluicaoInterna })));
const PaginaPlanos = lazy(() => import('./pages/planos/PaginaPlanos').then(m => ({ default: m.PaginaPlanos })));

// Páginas de Serviços & Operação (Lazy)
const Servicos = lazy(() => import('./pages/Servicos').then(m => ({ default: m.Servicos })));
const FormularioServico = lazy(() => import('./pages/servicos/FormularioServico').then(m => ({ default: m.FormularioServico })));
const MatrizPrecos = lazy(() => import('./pages/servicos/MatrizPrecos').then(m => ({ default: m.MatrizPrecos })));
const Precificacao = lazy(() => import('./pages/servicos/Precificacao').then(m => ({ default: m.Precificacao })));
const FormularioCheckin = lazy(() => import('./pages/checkin/FormularioCheckin').then(m => ({ default: m.FormularioCheckin })));
const VisualizarCheckin = lazy(() => import('./pages/checkin/VisualizarCheckin').then(m => ({ default: m.VisualizarCheckin })));
const ExecucaoPage = lazy(() => import('./pages/Execucao').then(m => ({ default: m.ExecucaoPage })));
const VisualizarAtendimento = lazy(() => import('./pages/VisualizarAtendimento').then(m => ({ default: m.VisualizarAtendimento })));
const VistoriaPublica = lazy(() => import('./pages/VistoriaPublica').then(m => ({ default: m.VistoriaPublica })));

// Carregamento Tardio (Lazy Loading) do Módulo Admin da Plataforma
const AdminGuard = lazy(() => import('./components/admin/AdminGuard').then(m => ({ default: m.AdminGuard })));
const AdminErrorBoundary = lazy(() => import('./components/admin/AdminErrorBoundary').then(m => ({ default: m.AdminErrorBoundary })));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const AdminOficinas = lazy(() => import('./pages/admin/AdminOficinas').then(m => ({ default: m.AdminOficinas })));
const AdminAssinaturas = lazy(() => import('./pages/admin/AdminAssinaturas').then(m => ({ default: m.AdminAssinaturas })));
const AdminPlanos = lazy(() => import('./pages/admin/AdminPlanos').then(m => ({ default: m.AdminPlanos })));
const AdminPermissoes = lazy(() => import('./pages/admin/AdminPermissoes').then(m => ({ default: m.AdminPermissoes })));
const AdminFeedbacks = lazy(() => import('./pages/admin/AdminFeedbacks').then(m => ({ default: m.AdminFeedbacks })));
const AdminStorage = lazy(() => import('./pages/admin/AdminStorage').then(m => ({ default: m.AdminStorage })));
const AdminAdmins = lazy(() => import('./pages/admin/AdminAdmins').then(m => ({ default: m.AdminAdmins })));
const AdminIndicacoes = lazy(() => import('./pages/admin/AdminIndicacoes').then(m => ({ default: m.AdminIndicacoes })));
const AdminParceiros = lazy(() => import('./pages/admin/AdminParceiros').then(m => ({ default: m.AdminParceiros })));
const AdminPrecificacaoReferencia = lazy(() => import('./pages/admin/AdminPrecificacaoReferencia').then(m => ({ default: m.AdminPrecificacaoReferencia })));
const AdminTreinamentos = lazy(() => import('./pages/admin/AdminTreinamentos').then(m => ({ default: m.AdminTreinamentos })));


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
            <Route path="/criar-conta" element={<CriarConta />} />
            <Route path="/convite/:codigo" element={<PaginaConvite />} />
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
