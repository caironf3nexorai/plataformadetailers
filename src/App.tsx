import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { RotaProtegida } from './components/auth/RotaProtegida';
import { AppShell } from './components/layout/AppShell';

// Páginas Públicas
import { CalculadoraPublica } from './pages/CalculadoraPublica';
import { CatalogoPublico } from './pages/CatalogoPublico';
import { FluxoAgendamentoOnline } from './pages/FluxoAgendamentoOnline';
import { Entrar } from './pages/auth/Entrar';
import { CriarConta } from './pages/auth/CriarConta';
import { NovaOficina } from './pages/auth/NovaOficina';
import { Convite } from './pages/auth/Convite';
import { RecuperarSenha } from './pages/auth/RecuperarSenha';

// Páginas Internas
import { Dashboard } from './pages/Dashboard';
import { Agenda } from './pages/Agenda';
import { Clientes } from './pages/Clientes';
import { DetalheCliente } from './pages/clientes/DetalheCliente';
import { DetalheVeiculo } from './pages/clientes/DetalheVeiculo';
import { Orcamentos } from './pages/Orcamentos';
import { DetalheOrcamento } from './pages/orcamentos/DetalheOrcamento';
import { OrcamentoPublico } from './pages/OrcamentoPublico';
import { Estoque } from './pages/Estoque';
import { Financeiro } from './pages/Financeiro';
import { ContasReceber } from './pages/financeiro/ContasReceber';
import { ConfigFormasPagamento } from './pages/financeiro/ConfigFormasPagamento';
import { Configuracoes } from './pages/Configuracoes';
import { DiluicaoInterna } from './pages/DiluicaoInterna';
import { PaginaPlanos } from './pages/planos/PaginaPlanos';

// Páginas de Serviços
import { Servicos } from './pages/Servicos';
import { FormularioServico } from './pages/servicos/FormularioServico';
import { MatrizPrecos } from './pages/servicos/MatrizPrecos';

import { FormularioCheckin } from './pages/checkin/FormularioCheckin';
import { VisualizarCheckin } from './pages/checkin/VisualizarCheckin';
import { ExecucaoPage } from './pages/Execucao';
import { VisualizarAtendimento } from './pages/VisualizarAtendimento';

import { VistoriaPublica } from './pages/VistoriaPublica';

// Carregamento Tardio (Lazy Loading) do Módulo Admin da Plataforma
const AdminGuard = lazy(() => import('./components/admin/AdminGuard').then(m => ({ default: m.AdminGuard })));
const AdminErrorBoundary = lazy(() => import('./components/admin/AdminErrorBoundary').then(m => ({ default: m.AdminErrorBoundary })));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const AdminOficinas = lazy(() => import('./pages/admin/AdminOficinas').then(m => ({ default: m.AdminOficinas })));
const AdminPlanos = lazy(() => import('./pages/admin/AdminPlanos').then(m => ({ default: m.AdminPlanos })));
const AdminPermissoes = lazy(() => import('./pages/admin/AdminPermissoes').then(m => ({ default: m.AdminPermissoes })));
const AdminFeedbacks = lazy(() => import('./pages/admin/AdminFeedbacks').then(m => ({ default: m.AdminFeedbacks })));
const AdminStorage = lazy(() => import('./pages/admin/AdminStorage').then(m => ({ default: m.AdminStorage })));
const AdminAdmins = lazy(() => import('./pages/admin/AdminAdmins').then(m => ({ default: m.AdminAdmins })));

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          {/* Rotas Públicas */}
          <Route path="/orcamento/:token" element={<OrcamentoPublico />} />
          <Route path="/vistoria/:token" element={<VistoriaPublica />} />
          <Route path="/agendar/:slug/agendamento" element={<FluxoAgendamentoOnline />} />
          <Route path="/agendar/:slug/novo" element={<FluxoAgendamentoOnline />} />
          <Route path="/agendar/:slug" element={<CatalogoPublico />} />
          <Route path="/calculadora" element={<CalculadoraPublica />} />
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/criar-conta" element={<CriarConta />} />
          <Route path="/convite/:token" element={<Convite />} />
          <Route path="/recuperar-senha" element={<RecuperarSenha />} />
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
            <Route path="planos" element={<AdminPlanos />} />
            <Route path="planos/permissoes" element={<AdminPermissoes />} />
            <Route path="feedbacks" element={<AdminFeedbacks />} />
            <Route path="storage" element={<AdminStorage />} />
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
                <Route path="servicos/:id" element={<FormularioServico />} />
                <Route path="ajustes/arquivos-digitais" element={<Configuracoes abaInicial="arquivos" />} />
                <Route path="configuracoes/arquivos-digitais" element={<Configuracoes abaInicial="arquivos" />} />
                <Route path="fotos-expirando" element={<Navigate to="/ajustes/arquivos-digitais" replace />} />
                <Route path="fotos-a-expirar" element={<Navigate to="/ajustes/arquivos-digitais" replace />} />
              </Route>

              <Route path="configuracoes" element={<Configuracoes />} />
              <Route path="ajustes" element={<Navigate to="/configuracoes" replace />} />
              <Route path="diluicao" element={<DiluicaoInterna />} />
            </Route>
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
