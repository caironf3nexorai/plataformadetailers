import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  traduzirRotaParaRotulo,
  verificarSeAdmin,
  setStatusAdmin,
  limparCacheAtividade,
  registrarVisualizacaoPagina,
} from './activityTracker';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({
          data: {
            session: {
              user: { id: 'user-comum-1' },
            },
          },
        })
      ),
    },
  },
}));

describe('activityTracker Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limparCacheAtividade();
  });

  describe('traduzirRotaParaRotulo', () => {
    it('traduz rota raiz e hoje para Painel do Dia', () => {
      expect(traduzirRotaParaRotulo('/')).toBe('Visualizou Painel do Dia');
      expect(traduzirRotaParaRotulo('/hoje')).toBe('Visualizou Painel do Dia');
    });

    it('traduz rotas de agenda e atendimento', () => {
      expect(traduzirRotaParaRotulo('/agenda')).toBe('Abriu Agendamentos');
      expect(traduzirRotaParaRotulo('/atendimentos/123-abc')).toBe('Visualizou Atendimento');
      expect(traduzirRotaParaRotulo('/execucao/456-def')).toBe('Abriu Execução de OS');
    });

    it('traduz vistorias checkin e checkout', () => {
      expect(traduzirRotaParaRotulo('/checkin/789')).toBe('Abriu Vistoria de Entrada');
      expect(traduzirRotaParaRotulo('/checkout/789')).toBe('Abriu Vistoria de Saída');
    });

    it('traduz servicos e precificacao', () => {
      expect(traduzirRotaParaRotulo('/servicos')).toBe('Abriu Catálogo de Serviços');
      expect(traduzirRotaParaRotulo('/servicos/precificacao')).toBe('Acessou Precificação');
    });

    it('traduz financeiro e contas a receber', () => {
      expect(traduzirRotaParaRotulo('/financeiro')).toBe('Abriu Painel Financeiro');
      expect(traduzirRotaParaRotulo('/financeiro/contas-a-receber')).toBe('Acessou Contas a Receber');
    });

    it('faz fallback para rota desconhecida', () => {
      expect(traduzirRotaParaRotulo('/relatorios/vendas')).toBe('Navegou para Relatorios');
    });
  });

  describe('Bypass de Administrador Isolado por Usuário', () => {
    it('diferencia status de admin entre diferentes usuários sem vazamento', async () => {
      setStatusAdmin('admin-user-999', true);
      setStatusAdmin('comum-user-111', false);

      expect(await verificarSeAdmin('admin-user-999')).toBe(true);
      expect(await verificarSeAdmin('comum-user-111')).toBe(false);
    });

    it('limparCacheAtividade reseta os caches em memória', async () => {
      setStatusAdmin('admin-user-999', true);
      expect(await verificarSeAdmin('admin-user-999')).toBe(true);

      limparCacheAtividade();

      // Sem cache, chama a RPC mockada
      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: false, error: null } as any);
      expect(await verificarSeAdmin('admin-user-999')).toBe(false);
    });
  });

  describe('Registro de Page Views', () => {
    it('não registra se a rota for administrativa ou pública', async () => {
      await registrarVisualizacaoPagina('/admin/oficinas', 'user-comum-1');
      await registrarVisualizacaoPagina('/entrar', 'user-comum-1');
      await registrarVisualizacaoPagina('/lancamento/codigo123', 'user-comum-1');

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('registra rota comum para usuário regular', async () => {
      setStatusAdmin('user-comum-1', false);

      await registrarVisualizacaoPagina('/agenda', 'user-comum-1');

      expect(supabase.from).toHaveBeenCalledWith('user_activity_logs');
    });
  });
});
