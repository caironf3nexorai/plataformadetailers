import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import {
  gerarModeloCSV,
  gerarRelatorioRecusasCSV,
  analisarEPreVisualizarCSV,
  executarGravaçãoCSV,
  type PreviewImportacaoResult,
} from '../../utils/csvImporter';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Users,
  Car,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';

interface ImportarCSVModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ImportarCSVModal: React.FC<ImportarCSVModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { tenant } = useAuth();

  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewImportacaoResult | null>(null);
  const [showRecusasDetails, setShowRecusasDetails] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [resultSummary, setResultSummary] = useState<{ sucessos: number; erros: string[] } | null>(
    null
  );

  const [modalError, setModalError] = useState<string | null>(null);

  const resetState = () => {
    setStep('upload');
    setLoading(false);
    setPreviewData(null);
    setShowRecusasDetails(false);
    setSavingProgress(false);
    setResultSummary(null);
    setModalError(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = async (file: File) => {
    if (!tenant?.id) return;
    setModalError(null);
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setModalError('Por favor, selecione um arquivo válido no formato CSV.');
      return;
    }

    setLoading(true);

    try {
      const result = await analisarEPreVisualizarCSV(file, tenant.id);
      setPreviewData(result);
      if (result.sucesso) {
        setStep('preview');
      }
    } catch (err: any) {
      setModalError(err.message || 'Erro ao ler e processar o arquivo CSV.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!tenant?.id || !previewData || previewData.linhasParaProcessar.length === 0) return;

    setSavingProgress(true);
    setModalError(null);
    try {
      const { sucessosCount, erros } = await executarGravaçãoCSV(
        tenant.id,
        previewData.linhasParaProcessar
      );
      setResultSummary({ sucessos: sucessosCount, erros });
      setStep('result');
    } catch (err: any) {
      setModalError(err.message || 'Erro durante a gravação dos dados.');
    } finally {
      setSavingProgress(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Importar Clientes e Veículos (CSV)" maxWidth="2xl">
      <div className="flex flex-col gap-5 py-2">
        {modalError && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{modalError}</span>
          </div>
        )}
        {/* ETAPA 1: UPLOAD DO ARQUIVO */}
        {step === 'upload' && (
          <div className="flex flex-col gap-5">
            {/* Bloco de ajuda / Download de Modelo */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-graphite-900 border border-graphite-700 rounded-xl">
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="text-amber-500 shrink-0 mt-1" size={24} />
                <div className="flex flex-col gap-0.5">
                  <span className="font-sans text-[14px] font-bold text-vapor-100">
                    Precisa do modelo padrão?
                  </span>
                  <span className="font-sans text-[12px] text-vapor-400">
                    Baixe o arquivo de exemplo pronto com colunas preenchidas para o Excel.
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={gerarModeloCSV}
                className="shrink-0 text-xs min-h-[38px] px-3 font-semibold"
              >
                <Download size={15} />
                Baixar Modelo CSV
              </Button>
            </div>

            {/* Zona de Drop / Seleção de Arquivo */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileChange(e.dataTransfer.files[0]);
                }
              }}
              className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-graphite-600 hover:border-amber-500/60 bg-graphite-900/60 hover:bg-graphite-900 rounded-xl transition-all cursor-pointer text-center group"
              onClick={() => {
                const el = document.getElementById('csvFileInput');
                if (el) el.click();
              }}
            >
              <input
                id="csvFileInput"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />

              {loading ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="animate-spin text-amber-500" size={36} />
                  <span className="font-sans text-sm font-semibold text-vapor-200">
                    Analisando e validando arquivo...
                  </span>
                </div>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform mb-3">
                    <UploadCloud size={28} />
                  </div>
                  <span className="font-sans text-base font-bold text-vapor-100 mb-1">
                    Arraste o arquivo CSV aqui ou clique para selecionar
                  </span>
                  <span className="font-sans text-xs text-vapor-400 max-w-sm">
                    Suporta arquivos exportados pelo Excel em Português (virgula ou ponto e vírgula, até 2.000 linhas).
                  </span>
                </>
              )}
            </div>

            {/* Recomendações e regras */}
            <div className="p-3.5 bg-graphite-900/40 rounded-lg border border-graphite-800 text-[12px] text-vapor-400 flex flex-col gap-1.5 font-sans">
              <span className="font-bold text-vapor-200">Dicas para importação perfeita:</span>
              <ul className="list-disc list-inside flex flex-col gap-1 pl-1">
                <li>Linhas com o mesmo telefone serão unificadas no mesmo cliente.</li>
                <li>Os veículos informados serão cadastrados e vinculados ao cliente correspondente.</li>
                <li>As categorias dos veículos devem corresponder às cadastradas na sua oficina (Hatch, Sedan, SUV, etc).</li>
              </ul>
            </div>
          </div>
        )}

        {/* ETAPA 2: PRÉ-VISUALIZAÇÃO DE RESULTADOS E RECUSAS */}
        {step === 'preview' && previewData && (
          <div className="flex flex-col gap-5">
            {/* Mensagem grave de erro ou erro de schema */}
            {!previewData.sucesso && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-red-400">
                <XCircle size={20} className="shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="font-bold font-sans text-sm">Não foi possível processar o arquivo</span>
                  <span className="font-sans text-xs text-red-300">
                    {previewData.erroGrave || 'Verifique o formato e as colunas do seu arquivo CSV.'}
                  </span>
                </div>
              </div>
            )}

            {previewData.sucesso && (
              <>
                {/* Alerta de Limite de Plano se Houver */}
                {previewData.bloqueioLimitePlano && (
                  <div className="p-3.5 bg-red-500/15 border border-red-500/40 rounded-xl flex items-start gap-3 text-red-300 text-xs font-sans">
                    <AlertTriangle size={18} className="shrink-0 text-red-400 mt-0.5" />
                    <span>{previewData.bloqueioLimitePlano}</span>
                  </div>
                )}
                {!previewData.bloqueioLimitePlano && previewData.avisoLimitePlano && (
                  <div className="p-3.5 bg-amber-500/15 border border-amber-500/40 rounded-xl flex items-start gap-3 text-amber-300 text-xs font-sans">
                    <AlertTriangle size={18} className="shrink-0 text-amber-400 mt-0.5" />
                    <span>{previewData.avisoLimitePlano}</span>
                  </div>
                )}

                {/* Cards Resumo */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-xl flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-mint-400 text-xs font-semibold">
                      <Users size={14} />
                      <span>Novos Clientes</span>
                    </div>
                    <span className="font-mono text-xl font-bold text-vapor-100">
                      {previewData.novosClientesCount}
                    </span>
                    <span className="text-[10px] text-vapor-400">
                      {previewData.clientesExistentesCount} reaproveitados
                    </span>
                  </div>

                  <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-xl flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                      <Car size={14} />
                      <span>Novos Veículos</span>
                    </div>
                    <span className="font-mono text-xl font-bold text-vapor-100">
                      {previewData.novosVeiculosCount}
                    </span>
                    <span className="text-[10px] text-vapor-400">
                      {previewData.veiculosExistentesCount} ignorados
                    </span>
                  </div>

                  <div className="p-3 bg-graphite-900 border border-graphite-700 rounded-xl flex flex-col gap-1">
                    <span className="text-xs font-semibold text-vapor-300">Válidos p/ Gravação</span>
                    <span className="font-mono text-xl font-bold text-mint-400">
                      {previewData.linhasValidadasCount}
                    </span>
                    <span className="text-[10px] text-vapor-400">Linhas aptas</span>
                  </div>

                  <div
                    className={`p-3 bg-graphite-900 border rounded-xl flex flex-col gap-1 ${
                      previewData.recusas.length > 0
                        ? 'border-red-500/40 text-red-400'
                        : 'border-graphite-700 text-vapor-400'
                    }`}
                  >
                    <span className="text-xs font-semibold">Linhas Recusadas</span>
                    <span className="font-mono text-xl font-bold">
                      {previewData.recusas.length}
                    </span>
                    <span className="text-[10px]">Ver detalhes abaixo</span>
                  </div>
                </div>

                {/* Detalhes de Linhas Recusadas */}
                {previewData.recusas.length > 0 && (
                  <div className="p-4 bg-graphite-900 border border-red-500/30 rounded-xl flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-red-400 font-sans text-xs font-bold">
                        <XCircle size={16} />
                        <span>{previewData.recusas.length} linha(s) não serão importadas por erros:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => gerarRelatorioRecusasCSV(previewData.recusas)}
                          className="text-[11px] h-7 px-2 font-semibold"
                        >
                          <Download size={13} />
                          Baixar Relatório
                        </Button>
                        <button
                          type="button"
                          onClick={() => setShowRecusasDetails(!showRecusasDetails)}
                          className="text-vapor-400 hover:text-vapor-200 p-1"
                        >
                          {showRecusasDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {showRecusasDetails && (
                      <div className="max-h-48 overflow-y-auto border-t border-graphite-800 pt-2 flex flex-col gap-1.5 font-sans text-xs">
                        {previewData.recusas.map((r, idx) => (
                          <div
                            key={idx}
                            className="p-2 bg-graphite-950/80 rounded border border-graphite-800 flex flex-col sm:flex-row justify-between gap-1"
                          >
                            <span className="font-mono font-bold text-red-400 shrink-0">
                              Linha {r.linha}:
                            </span>
                            <span className="text-vapor-300 flex-1 truncate">
                              {r.nome} {r.placa !== '—' ? `(${r.placa})` : ''}
                            </span>
                            <span className="text-red-300 italic text-[11px] shrink-0">
                              {r.motivo}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Ações */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-graphite-800">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('upload')}
                disabled={savingProgress}
              >
                Escolher outro arquivo
              </Button>
              {previewData.sucesso && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleConfirmImport}
                  disabled={savingProgress || previewData.linhasValidadasCount === 0}
                  className="font-bold min-h-[42px] px-5"
                >
                  {savingProgress ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Gravando registros...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      Confirmar e Gravar ({previewData.linhasValidadasCount} Registros)
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ETAPA 3: RESULTADO DA IMPORTAÇÃO */}
        {step === 'result' && resultSummary && (
          <div className="flex flex-col items-center gap-5 py-4 text-center">
            <div className="w-16 h-16 rounded-full bg-mint-500/10 border border-mint-500/30 flex items-center justify-center text-mint-400 mb-1">
              <CheckCircle2 size={36} />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="font-sans text-xl font-bold text-vapor-100">
                Importação Concluída!
              </h3>
              <p className="font-sans text-xs text-vapor-400 max-w-md">
                {resultSummary.sucessos} registro(s) foram inseridos ou atualizados com sucesso no sistema.
              </p>
            </div>

            {previewData?.recusas && previewData.recusas.length > 0 && (
              <div className="p-3.5 bg-graphite-900 border border-graphite-700 rounded-xl w-full flex items-center justify-between">
                <span className="font-sans text-xs text-vapor-300">
                  {previewData.recusas.length} linha(s) recusada(s) durante a validação.
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => gerarRelatorioRecusasCSV(previewData.recusas)}
                  className="text-xs h-8 px-3 font-semibold"
                >
                  <Download size={14} />
                  Baixar Relatório de Erros
                </Button>
              </div>
            )}

            <div className="pt-4 border-t border-graphite-800 w-full flex justify-end">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  onSuccess();
                  handleClose();
                }}
                className="font-bold px-6 min-h-[42px]"
              >
                Concluir
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
