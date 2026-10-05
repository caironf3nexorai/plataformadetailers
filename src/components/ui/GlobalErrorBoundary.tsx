import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[GlobalErrorBoundary] Erro capturado na aplicação:', error, errorInfo);
  }

  private handleReload = () => {
    try {
      window.sessionStorage.removeItem('chunk_reload_retry');
    } catch {}
    window.location.reload();
  };

  private handleGoHome = () => {
    try {
      window.sessionStorage.removeItem('chunk_reload_retry');
    } catch {}
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-graphite-950 text-vapor-100 flex flex-col items-center justify-center p-6 font-sans selection:bg-amber-500 selection:text-graphite-950">
          <div className="bg-graphite-900 border border-graphite-800 rounded-2xl max-w-lg w-full p-8 shadow-2xl space-y-6 text-center">
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-full flex items-center justify-center mx-auto text-amber-400">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold font-heading text-vapor-100">
                Ops! Algo inesperado aconteceu
              </h2>
              <p className="text-vapor-400 text-xs sm:text-sm">
                Uma falha temporária impediu a exibição desta tela. Clique abaixo para restabelecer o sistema com segurança.
              </p>
            </div>

            {this.state.error && (
              <div className="bg-graphite-950 border border-graphite-800 rounded-xl p-3.5 text-left font-mono text-xs text-amber-300/80 overflow-x-auto max-h-36">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-graphite-950 font-bold px-5 py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recarregar Página</span>
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="w-full sm:w-auto bg-graphite-800 hover:bg-graphite-700 text-vapor-200 font-semibold px-5 py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-2 border border-graphite-700"
              >
                <Home className="w-4 h-4" />
                <span>Ir para o Início</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
