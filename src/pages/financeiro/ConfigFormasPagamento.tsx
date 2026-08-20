import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import {
  CreditCard,
  Plus,
  ShieldAlert,
  Lock,
  Copy,
  ArrowDown,
  Save,
  Building2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { NavegacaoFinanceiro } from '../../components/financeiro/NavegacaoFinanceiro';

interface Maquininha {
  id: string;
  nome: string;
  padrao: boolean;
  ativo: boolean;
  ordem: number;
}

interface Bandeira {
  codigo: string;
  nome: string;
  ordem: number;
}

interface TaxaCartao {
  id: string;
  maquininha_id: string;
  tipo: 'debito' | 'credito';
  bandeira_codigo: string | null;
  parcelas: number;
  taxa_percentual: number;
  taxa_fixa: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
}

export const ConfigFormasPagamento: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const { isDono, isGerente } = usePermissao();
  const { showToast } = useToast();

  const podeGerenciar = isDono || isGerente;

  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [maquininhas, setMaquininhas] = useState<Maquininha[]>([]);
  const [bandeiras, setBandeiras] = useState<Bandeira[]>([]);
  const [activeMaquininhaId, setActiveMaquininhaId] = useState<string>('');

  // Modal para criar nova Maquininha
  const [modalMaquininhaAberto, setModalMaquininhaAberto] = useState(false);
  const [nomeNovaMaquininha, setNomeNovaMaquininha] = useState('');

  // Vigência de início para a nova tabela
  const [vigenciaInicio, setVigenciaInicio] = useState(
    new Date().toISOString().split('T')[0]
  );

  // Estado da Grade (Grid): chave `tipo_parcela_bandeira` -> valor em string (ex: '2.50')
  // bandeira = '' significa Padrão
  const [gridValues, setGridValues] = useState<Record<string, string>>({});

  // Alternância de visão mobile (Grade vs Lista por Parcela)
  const [visaoMobile, setVisaoMobile] = useState<'grade' | 'lista'>('grade');

  const fetchCatalogos = useCallback(async () => {
    if (!tenant || !podeGerenciar) return;
    setLoading(true);
    try {
      // 1. Busca Bandeiras globais
      const { data: dataBandeiras, error: errBandeiras } = await supabase
        .from('bandeiras')
        .select('*')
        .order('ordem', { ascending: true });

      if (errBandeiras) throw errBandeiras;
      setBandeiras(dataBandeiras || []);

      // 2. Busca Maquininhas do tenant
      let { data: dataMaquininhas, error: errMaquininhas } = await supabase
        .from('tenant_maquininhas')
        .select('*')
        .order('padrao', { ascending: false })
        .order('ordem', { ascending: true });

      if (errMaquininhas) throw errMaquininhas;

      // Se o tenant não possuir nenhuma maquininha cadastrada, cria a Maquininha Padrão
      if (!dataMaquininhas || dataMaquininhas.length === 0) {
        const { data: novaMaq, error: errIns } = await supabase
          .from('tenant_maquininhas')
          .insert({
            tenant_id: tenant.id,
            nome: 'Maquininha Padrão',
            padrao: true,
            ativo: true,
            ordem: 1,
          })
          .select()
          .single();

        if (!errIns && novaMaq) {
          dataMaquininhas = [novaMaq];
        }
      }

      setMaquininhas(dataMaquininhas || []);

      if (dataMaquininhas && dataMaquininhas.length > 0 && !activeMaquininhaId) {
        setActiveMaquininhaId(dataMaquininhas[0].id);
      }
    } catch (err: any) {
      console.error('Erro ao carregar catálogos:', err);
      showToast(err.message || 'Erro ao carregar maquininhas e bandeiras', 'error');
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, podeGerenciar, activeMaquininhaId, showToast]);

  const fetchTaxasMaquininha = useCallback(
    async (maqId: string) => {
      if (!maqId) return;
      try {
        const hojeStr = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('taxas_cartao')
          .select('*')
          .eq('maquininha_id', maqId)
          .or(`vigencia_fim.is.null,vigencia_fim.gte.${hojeStr}`)
          .order('vigencia_inicio', { ascending: true })
          .order('created_at', { ascending: true });

        if (error) throw error;

        const newGrid: Record<string, string> = {};
        if (data) {
          data.forEach((t: TaxaCartao) => {
            const b = t.bandeira_codigo || '';
            const key = `${t.tipo}_${t.parcelas}_${b}`;
            newGrid[key] = String(t.taxa_percentual);
          });
        }
        setGridValues(newGrid);
      } catch (err: any) {
        console.error('Erro ao carregar taxas da maquininha:', err);
      }
    },
    []
  );

  useEffect(() => {
    fetchCatalogos();
  }, [fetchCatalogos]);

  useEffect(() => {
    if (activeMaquininhaId) {
      fetchTaxasMaquininha(activeMaquininhaId);
    }
  }, [activeMaquininhaId, fetchTaxasMaquininha]);

  // Lista de colunas: 0 = Padrão, 1..N = Bandeiras
  const colunas = useMemo(() => {
    return [
      { codigo: '', nome: 'Padrão' },
      ...bandeiras.map((b) => ({ codigo: b.codigo, nome: b.nome })),
    ];
  }, [bandeiras]);

  // Manipulação de valor na célula
  const handleCellChange = (tipo: 'debito' | 'credito', parcela: number, bandeiraCodigo: string, val: string) => {
    const key = `${tipo}_${parcela}_${bandeiraCodigo}`;
    setGridValues((prev) => ({
      ...prev,
      [key]: val,
    }));
  };

  // Botão 1: Copiar Coluna Padrão para todas as bandeiras
  const handleCopiarPadraoParaTodas = () => {
    setGridValues((prev) => {
      const next = { ...prev };
      // Débito 1x
      const padraoDebito = prev['debito_1_'] || '';
      if (padraoDebito) {
        bandeiras.forEach((b) => {
          next[`debito_1_${b.codigo}`] = padraoDebito;
        });
      }

      // Crédito 1x a 12x
      for (let p = 1; p <= 12; p++) {
        const padraoCred = prev[`credito_${p}_`] || '';
        if (padraoCred) {
          bandeiras.forEach((b) => {
            next[`credito_${p}_${b.codigo}`] = padraoCred;
          });
        }
      }
      return next;
    });
    showToast('Valores da coluna Padrão copiados para todas as bandeiras!', 'success');
  };

  // Botão 2: Repetir valor desta parcela para as parcelas seguintes (Crédito)
  const handleRepetirParaSeguintes = (parcelaOrigem: number, bandeiraCodigo?: string) => {
    let taxaEncontrada = false;
    setGridValues((prev) => {
      const next = { ...prev };
      const colsToRepeat =
        bandeiraCodigo !== undefined && bandeiraCodigo !== null && bandeiraCodigo !== ''
          ? [{ codigo: bandeiraCodigo }]
          : colunas;

      colsToRepeat.forEach((col) => {
        const keyOrigem = `credito_${parcelaOrigem}_${col.codigo}`;
        let valorOrigem = prev[keyOrigem];
        if ((valorOrigem === undefined || valorOrigem === '' || valorOrigem === null) && col.codigo !== '') {
          valorOrigem = prev[`credito_${parcelaOrigem}_`];
        }

        if (valorOrigem !== undefined && valorOrigem !== '' && valorOrigem !== null) {
          taxaEncontrada = true;
          for (let p = parcelaOrigem + 1; p <= 12; p++) {
            next[`credito_${p}_${col.codigo}`] = String(valorOrigem);
          }
        }
      });

      return next;
    });

    if (!taxaEncontrada) {
      showToast(`Preencha a taxa da parcela ${parcelaOrigem}x antes de repetir para baixo.`, 'warning');
    } else {
      showToast(`Taxas de ${parcelaOrigem}x replicadas para as parcelas seguintes!`, 'success');
    }
  };



  // Navegação por teclado na Grade
  const handleKeyDownCell = (
    e: React.KeyboardEvent<HTMLInputElement>,
    row: number,
    colIndex: number
  ) => {
    let targetRow = row;
    let targetCol = colIndex;

    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      targetRow = Math.min(12, row + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      targetRow = Math.max(0, row - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      targetCol = Math.min(colunas.length - 1, colIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      targetCol = Math.max(0, colIndex - 1);
    } else {
      return;
    }

    const inputId = `grid-cell-${targetRow}-${targetCol}`;
    const el = document.getElementById(inputId) as HTMLInputElement | null;
    if (el) el.focus();
  };

  // Criar nova maquininha
  const handleCriarMaquininha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeNovaMaquininha.trim() || !tenant) return;
    try {
      const { data, error } = await supabase
        .from('tenant_maquininhas')
        .insert({
          tenant_id: tenant.id,
          nome: nomeNovaMaquininha.trim(),
          padrao: maquininhas.length === 0,
          ativo: true,
          ordem: maquininhas.length + 1,
        })
        .select()
        .single();

      if (error) throw error;
      showToast('Nova maquininha cadastrada!', 'success');
      setNomeNovaMaquininha('');
      setModalMaquininhaAberto(false);
      await fetchCatalogos();
      if (data) setActiveMaquininhaId(data.id);
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar maquininha', 'error');
    }
  };

  // Salvar Grade em Lote via RPC salvar_taxas_cartao_lote com Fallback Direto
  const handleSalvarGradeLote = async () => {
    if (!activeMaquininhaId || !vigenciaInicio) {
      showToast('Selecione a maquininha e a data de início da vigência.', 'error');
      return;
    }

    setSalvando(true);
    try {
      const payloadTaxas: Array<{
        tipo: string;
        bandeira_codigo: string | null;
        parcelas: number;
        taxa_percentual: number;
        taxa_fixa: number;
      }> = [];

      // Débito (1x)
      colunas.forEach((col) => {
        const valStr = gridValues[`debito_1_${col.codigo}`];
        if (valStr !== undefined && valStr !== '' && valStr !== null) {
          const perc = parseFloat(valStr.replace(',', '.')) || 0;
          payloadTaxas.push({
            tipo: 'debito',
            bandeira_codigo: col.codigo || null,
            parcelas: 1,
            taxa_percentual: perc,
            taxa_fixa: 0,
          });
        }
      });

      // Crédito (1x a 12x)
      for (let p = 1; p <= 12; p++) {
        colunas.forEach((col) => {
          const valStr = gridValues[`credito_${p}_${col.codigo}`];
          if (valStr !== undefined && valStr !== '' && valStr !== null) {
            const perc = parseFloat(valStr.replace(',', '.')) || 0;
            payloadTaxas.push({
              tipo: 'credito',
              bandeira_codigo: col.codigo || null,
              parcelas: p,
              taxa_percentual: perc,
              taxa_fixa: 0,
            });
          }
        });
      }

      // Tenta via RPC do banco
      const { error: errRpc } = await supabase.rpc('salvar_taxas_cartao_lote', {
        p_maquininha_id: activeMaquininhaId,
        p_vigencia_inicio: vigenciaInicio,
        p_taxas: payloadTaxas,
      });

      // Se a RPC falhar (por exemplo, migration não aplicada no banco remoto), executa a persistência via REST
      if (errRpc) {
        console.warn('RPC salvar_taxas_cartao_lote retornou erro. Aplicando persistência cliente-side...', errRpc);

        // 1. Remove taxas que iniciaram no mesmo dia ou depois (substituição do lote atual)
        await supabase
          .from('taxas_cartao')
          .delete()
          .eq('maquininha_id', activeMaquininhaId)
          .gte('vigencia_inicio', vigenciaInicio);

        // 2. Calcula o dia anterior para fechar vigências anteriores
        const dtInicio = new Date(vigenciaInicio + 'T00:00:00');
        dtInicio.setDate(dtInicio.getDate() - 1);
        const diaAnteriorStr = dtInicio.toISOString().split('T')[0];

        await supabase
          .from('taxas_cartao')
          .update({ vigencia_fim: diaAnteriorStr })
          .eq('maquininha_id', activeMaquininhaId)
          .lt('vigencia_inicio', vigenciaInicio)
          .or(`vigencia_fim.is.null,vigencia_fim.gte.${vigenciaInicio}`);

        // 3. Insere o novo lote
        if (payloadTaxas.length > 0 && tenant?.id) {
          const insertPayload = payloadTaxas.map((t) => ({
            tenant_id: tenant.id,
            maquininha_id: activeMaquininhaId,
            tipo: t.tipo,
            bandeira_codigo: t.bandeira_codigo,
            parcelas: t.parcelas,
            taxa_percentual: t.taxa_percentual,
            taxa_fixa: t.taxa_fixa,
            vigencia_inicio: vigenciaInicio,
          }));

          const { error: errIns } = await supabase.from('taxas_cartao').insert(insertPayload);
          if (errIns) throw errIns;
        }
      }

      showToast('Tabela de taxas salva com sucesso! Vigência atualizada.', 'success');
      await fetchTaxasMaquininha(activeMaquininhaId);
    } catch (err: any) {
      console.error('Erro ao salvar taxas em lote:', err);
      showToast(err.message || 'Erro ao salvar tabela de taxas', 'error');
    } finally {
      setSalvando(false);
    }
  };

  if (!podeGerenciar) {
    return (
      <div className="flex flex-col gap-6 max-w-4xl mx-auto py-12">
        <Card className="p-8 bg-graphite-900 border-graphite-800 text-center flex flex-col items-center gap-4">
          <ShieldAlert size={48} className="text-flare-400" />
          <h2 className="font-display text-xl font-bold text-vapor-100">Acesso Restrito ao Catálogo de Taxas</h2>
          <p className="text-vapor-400 text-sm max-w-md">
            A configuração de taxas de maquininha e formas de pagamento é exclusiva para Dono e Gerente.
          </p>
          <Button variant="secondary" onClick={() => navigate('/hoje')} className="mt-2 text-xs">
            Voltar para o Painel Operacional
          </Button>
        </Card>
      </div>
    );
  }

  const activeMaqObj = maquininhas.find((m) => m.id === activeMaquininhaId);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader title="Formas & Taxas da Maquininha" />
      <NavegacaoFinanceiro />

      {/* Aviso de Imutabilidade e Dica de Preenchimento */}
      <Card className="p-4 bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Lock size={22} className="text-amber-400 shrink-0" />
          <div className="flex flex-col text-xs text-amber-200">
            <span className="font-bold">Taxas por Maquininha, Bandeira e Parcela Exata (Imutável)</span>
            <span>
              Preencha a coluna <strong>Padrão</strong> para aplicar a taxa geral da maquininha. Detalhar por bandeira (Visa, Mastercard, Elo...) é opcional.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setVisaoMobile(visaoMobile === 'grade' ? 'lista' : 'grade')}
            className="sm:hidden text-xs text-amber-400 underline font-semibold"
          >
            Modo: {visaoMobile === 'grade' ? 'Visão Lista' : 'Visão Grade'}
          </button>
        </div>
      </Card>

      {loading ? (
        <Card className="p-12 text-center text-vapor-400 font-mono text-sm">Carregando maquininhas e taxas...</Card>
      ) : (
        <div className="flex flex-col gap-6">
          {/* NAVEGAÇÃO ENTRE MAQUININHAS (ABAS) */}
          <div className="flex items-center justify-between gap-3 border-b border-graphite-700 pb-2 overflow-x-auto">
            <div className="flex items-center gap-2">
              {maquininhas.map((maq) => (
                <button
                  key={maq.id}
                  type="button"
                  onClick={() => setActiveMaquininhaId(maq.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-t-lg font-display text-[13px] uppercase tracking-wide transition-colors whitespace-nowrap ${
                    activeMaquininhaId === maq.id
                      ? 'bg-graphite-800 text-amber-500 border-b-2 border-amber-500 font-bold'
                      : 'text-vapor-400 hover:text-vapor-100 hover:bg-graphite-800/40'
                  }`}
                >
                  <Building2 size={16} />
                  <span>{maq.nome}</span>
                  {maq.padrao && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-mono">
                      Padrão
                    </span>
                  )}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalMaquininhaAberto(true)}
              className="text-xs h-8 px-3 flex items-center gap-1.5 shrink-0"
            >
              <Plus size={14} />
              <span>Nova Maquininha</span>
            </Button>
          </div>

          {/* PAINEL DA MAQUININHA ATIVA */}
          {activeMaqObj && (
            <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 shadow-xl">
              {/* Barra Superior de Ações em Lote */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-graphite-700 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-vapor-300">Data de Início da Vigência</label>
                    <input
                      type="date"
                      value={vigenciaInicio}
                      onChange={(e) => setVigenciaInicio(e.target.value)}
                      className="bg-graphite-950 border border-graphite-600 rounded px-3 py-1.5 text-xs font-mono text-vapor-100 outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCopiarPadraoParaTodas}
                    className="text-xs h-9 px-3 flex items-center gap-1.5"
                    title="Copia os valores da coluna Padrão para todas as colunas de bandeira"
                  >
                    <Copy size={14} />
                    <span>Copiar Padrão para Todas</span>
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleSalvarGradeLote}
                    disabled={salvando}
                    className="text-xs h-9 px-4 font-bold flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-graphite-950"
                  >
                    <Save size={16} />
                    <span>{salvando ? 'Salvando...' : 'Salvar Tabela de Taxas'}</span>
                  </Button>
                </div>
              </div>

              {/* GRADE DE TAXAS (DESKTOP E TABLET) */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-graphite-700 text-vapor-400 font-sans text-xs uppercase tracking-wider">
                      <th className="py-2.5 px-3 font-semibold min-w-[120px]">Tipo / Parcela</th>
                      {colunas.map((col, idx) => (
                        <th key={col.codigo || 'padrao'} className="py-2.5 px-2 text-center min-w-[100px]">
                          <span className={idx === 0 ? 'text-amber-400 font-bold' : 'text-vapor-300'}>
                            {col.nome}
                          </span>
                        </th>
                      ))}
                      <th className="py-2.5 px-2 text-center min-w-[100px]">Repetir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graphite-700/60 font-sans text-xs">
                    {/* DÉBITO (1x) */}
                    <tr className="bg-graphite-900/60">
                      <td className="py-3 px-3 font-bold text-vapor-100 flex items-center gap-1.5">
                        <CreditCard size={14} className="text-mint-400" />
                        <span>Débito (1x)</span>
                      </td>
                      {colunas.map((col, colIdx) => {
                        const val = gridValues[`debito_1_${col.codigo}`] || '';
                        return (
                          <td key={col.codigo || 'padrao'} className="p-1.5 text-center">
                            <CampoNumerico
                              id={`grid-cell-0-${colIdx}`}
                              value={val}
                              onChange={(_, valStr) => handleCellChange('debito', 1, col.codigo, valStr)}
                              onKeyDown={(e) => handleKeyDownCell(e, 0, colIdx)}
                              placeholder="0,00"
                              suffix="%"
                              align="center"
                              className="py-1 text-center font-mono text-xs"
                            />
                          </td>
                        );
                      })}
                      <td className="p-1.5 text-center">
                        <span className="text-graphite-600 font-mono text-xs">-</span>
                      </td>
                    </tr>

                    {/* CRÉDITO (1x a 12x) */}
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => {
                      const rowIdx = p; // 1 a 12
                      return (
                        <tr key={`credito_${p}`} className={p % 2 === 0 ? 'bg-graphite-900/30' : ''}>
                          <td className="py-2.5 px-3 font-semibold text-vapor-200 font-mono">
                            Crédito {p}x
                          </td>
                          {colunas.map((col, colIdx) => {
                            const val = gridValues[`credito_${p}_${col.codigo}`] || '';
                            return (
                              <td key={col.codigo || 'padrao'} className="p-1.5 text-center">
                                <CampoNumerico
                                  id={`grid-cell-${rowIdx}-${colIdx}`}
                                  value={val}
                                  onChange={(_, valStr) => handleCellChange('credito', p, col.codigo, valStr)}
                                  onKeyDown={(e) => handleKeyDownCell(e, rowIdx, colIdx)}
                                  placeholder="0,00"
                                  suffix="%"
                                  align="center"
                                  className={`py-1 text-center font-mono text-xs ${
                                    colIdx === 0 ? 'text-amber-300 font-bold' : ''
                                  }`}
                                />
                              </td>
                            );
                          })}
                          <td className="p-1.5 text-center">
                            {p < 12 ? (
                              <button
                                type="button"
                                onClick={() => handleRepetirParaSeguintes(p)}
                                className="px-2 py-1 bg-graphite-950 hover:bg-graphite-900 border border-graphite-700 hover:border-amber-500/50 rounded text-vapor-300 hover:text-amber-400 font-sans text-[11px] font-medium transition-colors flex items-center gap-1 mx-auto whitespace-nowrap"
                                title={`Replicar todas as taxas da parcela ${p}x para as parcelas seguintes (${p + 1}x a 12x)`}
                              >
                                <ArrowDown size={12} className="text-amber-500" />
                                <span>Repetir ↓</span>
                              </button>
                            ) : (
                              <span className="text-graphite-600 font-mono text-xs">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* MODAL NOVA MAQUININHA */}
      {modalMaquininhaAberto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 bg-graphite-900 border-graphite-700 flex flex-col gap-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-graphite-800 pb-3">
              <h3 className="font-bold text-vapor-100 text-base">Adicionar Nova Maquininha</h3>
              <button
                type="button"
                onClick={() => setModalMaquininhaAberto(false)}
                className="text-vapor-400 hover:text-vapor-100 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCriarMaquininha} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-vapor-300">Nome da Maquininha</label>
                <input
                  type="text"
                  value={nomeNovaMaquininha}
                  onChange={(e) => setNomeNovaMaquininha(e.target.value)}
                  placeholder="Ex.: Cielo, Stone, Rede, PagSeguro, Getnet..."
                  required
                  className="w-full bg-graphite-950 border border-graphite-700 rounded px-3 py-2 text-sm font-sans text-vapor-100 outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-graphite-800">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setModalMaquininhaAberto(false)}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" className="text-xs font-bold">
                  Cadastrar Maquininha
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};
