import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Servico } from '../../types/servicos';
import type { CategoriaVeiculo } from '../../types/clientes';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { 
  ArrowLeft, 
  Save, 
  AlertTriangle,
  Info,
  Clock,
  DollarSign,
  Pencil
} from 'lucide-react';

interface CeldaMatriz {
  preco_base: string; // Mantido como string para digitação direta
  duracao_minutos: number;
  duracao_confirmada: boolean;
}

export const MatrizPrecos: React.FC = () => {
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Servico[]>([]);
  const [categories, setCategories] = useState<CategoriaVeiculo[]>([]);
  
  // Tab ativa: 'preco' | 'duracao'
  const [activeTab, setActiveTab] = useState<'preco' | 'duracao'>('preco');
  
  // Estado da matriz: [servico_id][categoria_id] -> CeldaMatriz
  const [matriz, setMatriz] = useState<Record<string, Record<string, CeldaMatriz>>>({});
  
  // Rastreia quais células foram modificadas
  const [modified, setModified] = useState<Record<string, Record<string, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchData = async () => {
    if (!tenant) return;
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // 1. Busca categorias ativas do tenant
      const { data: cats, error: cErr } = await supabase
        .from('categorias_veiculo')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (cErr) throw cErr;
      setCategories(cats as CategoriaVeiculo[]);

      // 2. Busca serviços ativos do tenant
      const { data: servs, error: sErr } = await supabase
        .from('servicos')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('ordem', { ascending: true });

      if (sErr) throw sErr;
      setServices(servs as Servico[]);

      // 3. Busca todos os preços cadastrados
      const { data: prices, error: pErr } = await supabase
        .from('servico_precos')
        .select('*');

      if (pErr) throw pErr;

      // 4. Monta a estrutura inicial da matriz
      const tempMatriz: Record<string, Record<string, CeldaMatriz>> = {};
      
      servs?.forEach((s) => {
        tempMatriz[s.id] = {};
        cats?.forEach((c) => {
          // Busca correspondência
          const pMatch = prices?.find((p) => p.servico_id === s.id && p.categoria_id === c.id);
          
          tempMatriz[s.id][c.id] = {
            preco_base: pMatch?.preco_base !== null && pMatch?.preco_base !== undefined ? String(pMatch.preco_base) : '',
            duracao_minutos: pMatch?.duracao_minutos || 60,
            duracao_confirmada: pMatch?.duracao_confirmada || false,
          };
        });
      });

      setMatriz(tempMatriz);
      setModified({});
    } catch (err: any) {
      console.error('[MatrizPrecos Load Error]:', err);
      setErrorMsg(err.message || 'Erro ao carregar dados da matriz.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenant?.id]);

  const handleCellChange = (servicoId: string, categoriaId: string, field: keyof CeldaMatriz, value: any) => {
    setMatriz((prev) => {
      const updatedServico = { ...prev[servicoId] };
      const currentCell = { ...updatedServico[categoriaId] };

      if (field === 'preco_base') {
        currentCell.preco_base = value;
      } else if (field === 'duracao_minutos') {
        currentCell.duracao_minutos = Number(value) || 0;
        // Qualquer alteração manual grava duracao_confirmada = true
        currentCell.duracao_confirmada = true;
      }

      updatedServico[categoriaId] = currentCell;
      return { ...prev, [servicoId]: updatedServico };
    });

    setModified((prev) => {
      const updatedServico = { ...prev[servicoId] };
      updatedServico[categoriaId] = true;
      return { ...prev, [servicoId]: updatedServico };
    });
  };

  // Verifica se há alguma alteração pendente
  const hasUnsavedChanges = Object.values(modified).some((s) => Object.values(s).some((val) => val));

  const handleSaveAll = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setSaving(true);

    try {
      // Loop por serviços modificados
      const promises = Object.keys(modified).map(async (servicoId) => {
        const servicoModifications = modified[servicoId];
        const hasMods = Object.values(servicoModifications).some((val) => val);
        if (!hasMods) return;

        // Prepara as linhas jsonb para esse serviço
        const pLinhas = categories.map((c) => {
          const cell = matriz[servicoId][c.id];
          return {
            categoria_id: c.id,
            preco_base: cell.preco_base === '' ? null : Number(cell.preco_base.replace(',', '.')),
            duracao_minutos: cell.duracao_minutos,
            duracao_confirmada: cell.duracao_confirmada,
          };
        });

        const { error } = await supabase.rpc('salvar_matriz_precos', {
          p_servico: servicoId,
          p_linhas: pLinhas,
        });

        if (error) throw error;
      });

      await Promise.all(promises);
      setSuccessMsg('Matriz de preços e durações salva com sucesso!');
      setModified({});
      
      // Recarrega do banco para garantir sincronia
      await fetchData();
    } catch (err: any) {
      console.error('[MatrizPrecos Save Error]:', err);
      setErrorMsg(err.message || 'Erro ao salvar alterações da matriz.');
    } finally {
      setSaving(false);
    }
  };

  // Navegação por teclado: Enter e Setas
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    servicoIdx: number,
    categoriaIdx: number
  ) => {
    const isEnter = e.key === 'Enter';
    const isDown = e.key === 'ArrowDown';
    const isUp = e.key === 'ArrowUp';
    const isRight = e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length;
    const isLeft = e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0;

    let targetRow = servicoIdx;
    let targetCol = categoriaIdx;

    if (isEnter || isDown) {
      targetRow += 1;
    } else if (isUp) {
      targetRow -= 1;
    } else if (isRight) {
      targetCol += 1;
    } else if (isLeft) {
      targetCol -= 1;
    } else {
      return; // Outra tecla
    }

    e.preventDefault();
    const nextEl = document.getElementById(`input-${activeTab}-${targetRow}-${targetCol}`);
    if (nextEl) {
      nextEl.focus();
      (nextEl as HTMLInputElement).select();
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 flex flex-col gap-6 animate-pulse">
        <div className="h-8 bg-graphite-700 w-48 rounded" />
        <div className="h-64 bg-graphite-700 rounded" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-graphite-700 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate('/servicos');
              }
            }}
            className="p-2 text-vapor-400 hover:text-vapor-100 hover:bg-graphite-700 rounded transition-colors"
            title="Voltar para a página anterior"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-display text-[22px] text-vapor-100 uppercase tracking-wide">
              Matriz de Valores e Durações
            </h1>
            <p className="font-sans text-[12px] text-amber-500 flex items-center gap-1.5 mt-0.5 font-medium">
              <Info size={14} className="shrink-0" />
              Estes são os valores de partida. O valor final é definido por você na conferência do veículo.
            </p>
          </div>
        </div>

        {hasUnsavedChanges && (
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            onClick={handleSaveAll}
            className="w-full sm:w-auto font-semibold min-h-[48px] px-8 flex items-center gap-2"
          >
            <Save size={18} />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3.5 bg-flare-400/10 border border-flare-400/30 rounded flex items-center gap-2 text-flare-400 text-[13px]">
          <AlertTriangle size={18} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 bg-mint-400/10 border border-mint-400/30 rounded flex items-center gap-2 text-mint-400 text-[13px]">
          <Info size={18} className="shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Alternância de Abas */}
      <div className="flex border-b border-graphite-700 gap-6">
        <button
          type="button"
          onClick={() => setActiveTab('preco')}
          className={`pb-3 font-display text-[13px] uppercase tracking-wider transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'preco'
              ? 'text-amber-500 border-amber-500'
              : 'text-vapor-400 border-transparent hover:text-vapor-200'
          }`}
        >
          <DollarSign size={16} />
          A partir de (R$)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('duracao')}
          className={`pb-3 font-display text-[13px] uppercase tracking-wider transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'duracao'
              ? 'text-amber-500 border-amber-500'
              : 'text-vapor-400 border-transparent hover:text-vapor-200'
          }`}
        >
          <Clock size={16} />
          Duração
        </button>
      </div>

      {/* Texto de Apoio da Tab de Duração */}
      {activeTab === 'duracao' && (
        <div className="p-4 bg-graphite-900 border border-graphite-700 rounded-md text-[13px] text-vapor-300 leading-relaxed max-w-3xl">
          💡 <strong>Como cadastrar a duração:</strong> Use o seu tempo real, do início ao fim, incluindo secagem e acabamento. É esse número que define os horários livres que o cliente vai ver na agenda.
        </div>
      )}

      {/* DESKTOP MATRIX TABLE (>= 640px) */}
      <div className="hidden sm:block overflow-x-auto border border-graphite-700 rounded bg-graphite-800">
        <table className="w-full min-w-[700px] border-collapse text-left">
          <thead>
            <tr className="bg-graphite-900 border-b border-graphite-700">
              <th className="p-4 font-display text-[11px] text-vapor-400 uppercase tracking-widest min-w-[200px]">
                Serviço / Grupo
              </th>
              {categories.map((cat) => (
                <th key={cat.id} className="p-4 font-display text-[11px] text-vapor-400 uppercase tracking-widest text-center min-w-[120px]">
                  {cat.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-graphite-700">
            {services.map((serv, servIdx) => {
              const sobConsulta = serv.sob_consulta;

              return (
                <tr key={serv.id} className="hover:bg-graphite-900/40 transition-colors">
                  <td className="p-4">
                    <div 
                      className="flex flex-col gap-0.5 cursor-pointer group/item"
                      onClick={() => navigate(`/servicos/${serv.id}`)}
                      title="Editar detalhes do serviço"
                    >
                      <span className="font-sans text-[13px] font-bold text-vapor-100 group-hover/item:text-amber-500 transition-colors flex items-center gap-1.5">
                        {serv.nome}
                        <Pencil size={11} className="opacity-0 group-hover/item:opacity-100 text-vapor-400 transition-opacity" />
                      </span>
                      <span className="font-sans text-[10px] text-vapor-400 uppercase tracking-wider">{serv.grupo}</span>
                    </div>
                  </td>
                  {categories.map((cat, catIdx) => {
                    const cell = matriz[serv.id]?.[cat.id] || { preco_base: '', duracao_minutos: 60, duracao_confirmada: false };
                    const isCellModified = modified[serv.id]?.[cat.id];

                    return (
                      <td key={cat.id} className="p-2 text-center">
                        {sobConsulta ? (
                          <span className="text-[12px] text-vapor-500 font-sans italic">Sob avaliação</span>
                        ) : activeTab === 'preco' ? (
                          <CampoNumerico
                            id={`input-preco-${servIdx}-${catIdx}`}
                            value={cell.preco_base}
                            onChange={(_, valStr) => handleCellChange(serv.id, cat.id, 'preco_base', valStr)}
                            onKeyDown={(e) => handleKeyDown(e, servIdx, catIdx)}
                            prefix="R$"
                            align="right"
                            placeholder="--"
                            wrapperClassName={`w-full max-w-[110px] mx-auto ${
                              isCellModified ? 'border-amber-500/80 bg-amber-500/5' : ''
                            }`}
                          />
                        ) : (
                          <CampoNumerico
                            id={`input-duracao-${servIdx}-${catIdx}`}
                            value={cell.duracao_minutos}
                            onChange={(val) => handleCellChange(serv.id, cat.id, 'duracao_minutos', val || 0)}
                            onKeyDown={(e) => handleKeyDown(e, servIdx, catIdx)}
                            suffix="min"
                            integerOnly
                            align="center"
                            placeholder="60"
                            wrapperClassName={`w-full max-w-[110px] mx-auto ${
                              !cell.duracao_confirmada
                                ? 'border-amber-500 bg-amber-500/5 font-semibold text-amber-500'
                                : isCellModified
                                ? 'border-amber-500/80 bg-amber-500/5'
                                : ''
                            }`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MOBILE LIST LAYOUT (< 640px / 375px) */}
      <div className="sm:hidden flex flex-col gap-4">
        {services.map((serv) => {
          const sobConsulta = serv.sob_consulta;

          return (
            <Card key={serv.id} className="p-4 bg-graphite-800 border-graphite-600 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-graphite-700 pb-2">
                <div className="flex flex-col gap-0.5">
                  <span className="font-sans text-[14px] font-bold text-vapor-100">{serv.nome}</span>
                  <span className="font-sans text-[10px] text-vapor-400 uppercase tracking-widest">{serv.grupo}</span>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/servicos/${serv.id}`)}
                  className="p-1 text-vapor-400 hover:text-amber-500 transition-colors"
                  title="Editar detalhes do serviço"
                >
                  <Pencil size={14} />
                </button>
              </div>

              {sobConsulta ? (
                <div className="p-2 text-center text-[13px] text-vapor-500 italic bg-graphite-900 rounded">
                  Serviço sob consulta (avaliado presencialmente)
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {categories.map((cat) => {
                    const cell = matriz[serv.id]?.[cat.id] || { preco_base: '', duracao_minutos: 60, duracao_confirmada: false };

                    return (
                      <div key={cat.id} className="grid grid-cols-2 gap-3 items-center justify-between py-1 border-b border-graphite-700/40 last:border-none">
                        <span className="font-sans text-[13px] text-vapor-300 font-medium">{cat.nome}</span>

                        <div className="flex gap-2">
                          {activeTab === 'preco' ? (
                            <CampoNumerico
                              value={cell.preco_base}
                              onChange={(_, valStr) => handleCellChange(serv.id, cat.id, 'preco_base', valStr)}
                              prefix="R$"
                              align="right"
                              placeholder="--"
                              wrapperClassName="flex-1"
                            />
                          ) : (
                            <CampoNumerico
                              value={cell.duracao_minutos}
                              onChange={(val) => handleCellChange(serv.id, cat.id, 'duracao_minutos', val || 0)}
                              suffix="min"
                              integerOnly
                              align="center"
                              placeholder="60"
                              wrapperClassName={`flex-1 ${
                                !cell.duracao_confirmada ? 'border-amber-500 bg-amber-500/5 font-semibold text-amber-500' : ''
                              }`}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};
