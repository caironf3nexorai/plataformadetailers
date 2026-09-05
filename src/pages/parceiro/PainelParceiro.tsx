import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { LogoNuvemWash } from '../../components/ui/LogoNuvemWash';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  Award,
  LogOut,
  Copy,
  Check,
  DollarSign,
  Users,
  CheckCircle2,
  Clock,
  Building2,
  QrCode,
  Share2,
} from 'lucide-react';
import { formatarMoeda } from '../../utils/formatters';

interface ParceiroData {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  codigo: string;
  pix_chave?: string;
  pix_tipo?: string;
  comissao_tipo: 'percentual' | 'valor_fixo';
  comissao_valor: number;
  recorrente: boolean;
  ativo: boolean;
}

interface ResumoData {
  total_indicacoes: number;
  total_ativas: number;
  comissoes_previstas: number;
  comissoes_aprovadas: number;
  comissoes_pagas: number;
}

interface IndicacaoItem {
  tenant_id: string;
  oficina_nome: string;
  cidade?: string;
  uf?: string;
  plano: string;
  status_assinatura: string;
  vinculado_em: string;
  proximo_vencimento?: string;
}

interface ComissaoItem {
  id: string;
  competencia: string;
  oficina_nome: string;
  valor_base: number;
  valor_comissao: number;
  status: 'prevista' | 'aprovada' | 'paga' | 'cancelada';
  pago_em?: string;
  comprovante_path?: string;
  created_at: string;
}

export const PainelParceiro: React.FC = () => {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [salvandoPix, setSalvandoPix] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const [parceiro, setParceiro] = useState<ParceiroData | null>(null);
  const [resumo, setResumo] = useState<ResumoData | null>(null);
  const [indicacoes, setIndicacoes] = useState<IndicacaoItem[]>([]);
  const [comissoes, setComissoes] = useState<ComissaoItem[]>([]);

  const [pixChave, setPixChave] = useState('');
  const [pixTipo, setPixTipo] = useState('cpf');

  const carregarDados = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/entrar');
        return;
      }

      const { data, error } = await supabase.rpc('parceiro_obter_dados_painel');
      if (error || !data || !data.is_parceiro) {
        const { data: isAdmin } = await supabase.rpc('is_platform_admin');
        if (isAdmin) {
          showError('Você é Administrador da plataforma, mas seu login ainda não foi associado a um registro de parceiro comercial. Vincule seu usuário na tela de Parceiros do Admin.');
          navigate('/admin/parceiros');
          return;
        }

        showError('Acesso restrito: sua conta ainda não possui cadastro de parceiro aprovado.');
        navigate('/');
        return;
      }

      setParceiro(data.parceiro);
      setResumo(data.resumo);
      setIndicacoes(data.indicacoes || []);
      setComissoes(data.comissoes || []);

      if (data.parceiro?.pix_chave) setPixChave(data.parceiro.pix_chave);
      if (data.parceiro?.pix_tipo) setPixTipo(data.parceiro.pix_tipo);
    } catch (err: any) {
      console.error('[Painel Parceiro Error]:', err);
      showError('Erro ao carregar dados do painel do parceiro.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const linkParceiro = parceiro
    ? `${window.location.origin}/parceiro/${parceiro.codigo}`
    : '';

  const handleCopiarLink = () => {
    if (!linkParceiro) return;
    navigator.clipboard.writeText(linkParceiro);
    setCopiado(true);
    showSuccess('Link de parceiro copiado para a área de transferência!');
    setTimeout(() => setCopiado(false), 2500);
  };

  const handleSalvarPix = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pixChave.trim()) {
      showError('Por favor, informe uma chave PIX válida.');
      return;
    }

    try {
      setSalvandoPix(true);
      const { error } = await supabase.rpc('parceiro_atualizar_pix', {
        p_pix_chave: pixChave.trim(),
        p_pix_tipo: pixTipo,
      });

      if (error) throw error;
      showSuccess('Dados bancários e Chave PIX atualizados com sucesso!');
      if (parceiro) {
        setParceiro({ ...parceiro, pix_chave: pixChave.trim(), pix_tipo: pixTipo });
      }
    } catch (err: any) {
      console.error('[Atualizar PIX Error]:', err);
      showError(err.message || 'Erro ao salvar chave PIX.');
    } finally {
      setSalvandoPix(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/parceiro/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-amber-500 font-mono text-sm">
        CARREGANDO PAINEL DO PARCEIRO...
      </div>
    );
  }

  if (!parceiro) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Top Header */}
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <LogoNuvemWash size="md" />
          <div className="h-6 w-px bg-slate-800 hidden sm:block" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                Parceiro Oficial
              </span>
              <span className="font-mono text-xs text-slate-400 font-bold">
                Cód: {parceiro.codigo}
              </span>
            </div>
            <h1 className="text-lg md:text-xl font-bold text-white mt-0.5">
              Olá, {parceiro.nome}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            onClick={() => navigate('/')}
            className="h-10 text-xs text-slate-300 hover:text-white border-slate-700 bg-slate-900 flex items-center gap-1.5"
            title="Voltar para a plataforma principal"
          >
            <Building2 size={15} className="text-amber-400" />
            <span className="hidden sm:inline">Acessar Oficina</span>
          </Button>

          <Button
            variant="secondary"
            onClick={handleLogout}
            className="h-10 text-xs text-slate-300 hover:text-white border-slate-700 bg-slate-900"
          >
            <LogOut size={15} />
            <span>Sair</span>
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto mt-6 flex flex-col gap-6">
        {/* Banner do Link de Indicação */}
        <Card className="p-5 md:p-6 bg-gradient-to-r from-amber-500/10 via-slate-900 to-blue-500/10 border-amber-500/30 rounded-2xl shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Share2 size={15} />
                Seu Link Exclusivo de Indicação
              </span>
              <p className="text-slate-300 text-sm mt-1 max-w-xl">
                Divulgue seu link para oficinas mecânicas e centros de estética. Clientes que se cadastrarem pelo seu link ficam automaticamente vinculados ao seu código para comissionamento.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="bg-slate-950/80 border border-slate-700 px-3.5 py-2 rounded-xl text-xs font-mono text-slate-200 truncate max-w-xs flex-1">
                {linkParceiro}
              </div>
              <Button
                onClick={handleCopiarLink}
                className="h-10 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 rounded-xl flex items-center gap-1.5"
              >
                {copiado ? <Check size={16} /> : <Copy size={16} />}
                <span>{copiado ? 'Copiado!' : 'Copiar Link'}</span>
              </Button>
            </div>
          </div>
        </Card>

        {/* 5 Cards de Indicadores (KPIs) */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* Total Indicados */}
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <Users size={14} className="text-blue-400" />
              Total Indicados
            </span>
            <span className="text-2xl font-black text-white mt-2 font-mono">
              {resumo?.total_indicacoes || 0}
            </span>
            <span className="text-[11px] text-slate-500 mt-1">cadastros realizados</span>
          </div>

          {/* Ativas */}
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-emerald-400" />
              Oficinas Ativas
            </span>
            <span className="text-2xl font-black text-emerald-400 mt-2 font-mono">
              {resumo?.total_ativas || 0}
            </span>
            <span className="text-[11px] text-emerald-500/80 mt-1">assinaturas vigentes</span>
          </div>

          {/* Saldo Aprovado (A Receber) */}
          <div className="bg-slate-900/80 border border-amber-500/30 bg-amber-500/5 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-amber-400 font-bold flex items-center gap-1.5">
              <DollarSign size={14} className="text-amber-400" />
              A Receber (Aprovado)
            </span>
            <span className="text-2xl font-black text-amber-400 mt-2 font-mono">
              {formatarMoeda(resumo?.comissoes_aprovadas || 0)}
            </span>
            <span className="text-[11px] text-amber-500/80 mt-1">próximo repasse PIX</span>
          </div>

          {/* Comissões Pagas (Histórico) */}
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <Check size={14} className="text-indigo-400" />
              Total Já Recebido
            </span>
            <span className="text-2xl font-black text-indigo-300 mt-2 font-mono">
              {formatarMoeda(resumo?.comissoes_pagas || 0)}
            </span>
            <span className="text-[11px] text-slate-500 mt-1">repassado com sucesso</span>
          </div>

          {/* Comissões Previstas */}
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl flex flex-col justify-between col-span-2 lg:col-span-1">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <Clock size={14} className="text-slate-400" />
              Previstas (Trial)
            </span>
            <span className="text-2xl font-black text-slate-300 mt-2 font-mono">
              {formatarMoeda(resumo?.comissoes_previstas || 0)}
            </span>
            <span className="text-[11px] text-slate-500 mt-1">aguardando conversão</span>
          </div>
        </div>

        {/* Linha Principal: Dados Bancários / PIX + Regra de Comissão */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Card de Gestão da Chave PIX */}
          <Card className="p-5 md:p-6 bg-slate-900/90 border-slate-800 rounded-2xl flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm mb-2">
                <QrCode size={18} />
                <span>Dados de Recebimento (PIX)</span>
              </div>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Mantenha sua chave PIX atualizada. Nosso financeiro consulta essa chave diretamente para realizar a transferência dos seus repasses.
              </p>

              <form onSubmit={handleSalvarPix} className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">
                    Tipo de Chave
                  </label>
                  <select
                    value={pixTipo}
                    onChange={(e) => setPixTipo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-xl px-3 h-10 text-xs outline-none focus:border-amber-500"
                  >
                    <option value="cpf">CPF</option>
                    <option value="cnpj">CNPJ</option>
                    <option value="email">E-mail</option>
                    <option value="telefone">Telefone (Celular)</option>
                    <option value="aleatoria">Chave Aleatória (EVP)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-300 font-semibold block mb-1">
                    Chave PIX
                  </label>
                  <Input
                    type="text"
                    placeholder="Informe sua chave PIX"
                    value={pixChave}
                    onChange={(e) => setPixChave(e.target.value)}
                    required
                    className="bg-slate-950 border-slate-700 h-10 text-xs rounded-xl"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={salvandoPix}
                  className="w-full h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs mt-2"
                >
                  {salvandoPix ? 'Salvando...' : 'Salvar Chave PIX'}
                </Button>
              </form>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              <span>Sincronizado automaticamente com o painel administrativo.</span>
            </div>
          </Card>

          {/* Card de Regra de Comissão */}
          <Card className="p-5 md:p-6 bg-slate-900/90 border-slate-800 rounded-2xl flex flex-col justify-between lg:col-span-2">
            <div>
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Award size={16} />
                Regra Comercial de Comissionamento
              </span>
              <h3 className="text-lg font-bold text-white mt-1">
                Sua Condição: {parceiro.comissao_tipo === 'percentual' ? `${parceiro.comissao_valor}% da mensalidade` : `${formatarMoeda(parceiro.comissao_valor)} por mensalidade`}
              </h3>
              <p className="text-slate-300 text-xs mt-1 leading-relaxed">
                {parceiro.recorrente
                  ? 'Você recebe comissão recorrente todos os meses enquanto as oficinas indicadas mantiverem a assinatura ativa.'
                  : 'Sua comissão incide sobre o primeiro pagamento das oficinas indicadas.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-800">
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Recorrência</span>
                <span className="text-sm font-bold text-white font-mono mt-0.5 block">
                  {parceiro.recorrente ? 'Sim (Mensal)' : 'Apenas 1º Mês'}
                </span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 block font-medium">Status do Parceiro</span>
                <span className={`text-sm font-bold font-mono mt-0.5 block ${parceiro.ativo ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {parceiro.ativo ? 'Ativo e Habilitado' : 'Inativo'}
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Tabela de Oficinas Indicadas */}
        <Card className="p-5 md:p-6 bg-slate-900/90 border-slate-800 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Building2 size={16} className="text-amber-400" />
              <span>Oficinas Vinculadas à Sua Indicação ({indicacoes.length})</span>
            </h3>
          </div>

          {indicacoes.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              Nenhuma oficina se cadastrou com seu link ainda. Comece compartilhando seu link de parceiro!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="pb-3">Oficina</th>
                    <th className="pb-3">Localização</th>
                    <th className="pb-3">Data de Entrada</th>
                    <th className="pb-3">Plano</th>
                    <th className="pb-3 text-right">Status Assinatura</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {indicacoes.map((ind) => (
                    <tr key={ind.tenant_id} className="hover:bg-slate-800/30">
                      <td className="py-3 font-semibold text-white">
                        {ind.oficina_nome}
                      </td>
                      <td className="py-3 text-slate-400">
                        {ind.cidade && ind.uf ? `${ind.cidade}/${ind.uf}` : 'Brasil'}
                      </td>
                      <td className="py-3 font-mono text-slate-400">
                        {new Date(ind.vinculado_em).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="py-3">
                        <span className="uppercase font-mono text-[11px] font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                          {ind.plano}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase font-mono ${
                            ind.status_assinatura === 'ativa'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : ind.status_assinatura === 'trial'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {ind.status_assinatura}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Tabela de Histórico de Comissões */}
        <Card className="p-5 md:p-6 bg-slate-900/90 border-slate-800 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <DollarSign size={16} className="text-amber-400" />
              <span>Extrato de Comissões ({comissoes.length})</span>
            </h3>
          </div>

          {comissoes.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              Nenhuma comissão gerada até o momento. As comissões são lançadas automaticamente após o pagamento de mensalidade das oficinas indicadas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="pb-3">Competência</th>
                    <th className="pb-3">Oficina</th>
                    <th className="pb-3">Mensalidade</th>
                    <th className="pb-3">Sua Comissão</th>
                    <th className="pb-3">Data Repasse</th>
                    <th className="pb-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {comissoes.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-800/30">
                      <td className="py-3 font-mono font-bold text-slate-300">
                        {c.competencia.substring(0, 7)}
                      </td>
                      <td className="py-3 font-medium text-white">
                        {c.oficina_nome}
                      </td>
                      <td className="py-3 font-mono text-slate-400">
                        {formatarMoeda(c.valor_base)}
                      </td>
                      <td className="py-3 font-mono font-bold text-amber-400">
                        {formatarMoeda(c.valor_comissao)}
                      </td>
                      <td className="py-3 font-mono text-slate-400">
                        {c.pago_em ? new Date(c.pago_em).toLocaleDateString('pt-BR') : 'Aguardando repasse'}
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase font-mono ${
                            c.status === 'paga'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : c.status === 'aprovada'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
