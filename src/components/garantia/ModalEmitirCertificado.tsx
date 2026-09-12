import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { supabase } from '../../lib/supabase';
import { ShieldCheck, Sparkles, Calendar, Clock, MessageSquare, Printer, Check, Copy, AlertCircle } from 'lucide-react';
import { montarLinkWhatsapp } from '../../utils/whatsapp';
import { AdesivoParabrisaModal } from './AdesivoParabrisaModal';

interface ModalEmitirCertificadoProps {
  isOpen: boolean;
  onClose: () => void;
  atendimento: {
    agendamento_id?: string | null;
    cliente_id: string;
    cliente_nome: string;
    cliente_telefone?: string | null;
    veiculo_id: string;
    veiculo_modelo: string;
    veiculo_placa: string;
    veiculo_cor?: string | null;
    servico_id?: string | null;
    servico_nome?: string;
    produto_padrao?: string | null;
    garantia_meses?: number | null;
    intervalo_manutencao_dias?: number | null;
    cuidados_padrao?: string | null;
    data_servico?: string;
    tenant_nome?: string;
    tenant_logo?: string | null;
  };
  onSucesso?: (codigoCertificado: string) => void;
}

const PRODUTOS_SUGERIDOS = [
  'Vonixx V-Paint 3 Anos',
  'Vonixx V-Plastic',
  'Nasiol ZR53 9H',
  'Nasiol NL272',
  'Kisho Si-701',
  'Kisho Si-901',
  'Gyeon Quartz EVO',
  'Soft99 Fusso Coat',
  'Ceramic Pro 9H'
];

export const ModalEmitirCertificado: React.FC<ModalEmitirCertificadoProps> = ({
  isOpen,
  onClose,
  atendimento,
  onSucesso
}) => {
  const [servicoNome, setServicoNome] = useState(atendimento.servico_nome || 'Vitrificação de Pintura');
  const [produtoAplicado, setProdutoAplicado] = useState(atendimento.produto_padrao || 'Vonixx V-Paint 3 Anos');
  const [mesesGarantia, setMesesGarantia] = useState<number>(atendimento.garantia_meses || 36);
  const [intervaloDias, setIntervaloDias] = useState<number>(atendimento.intervalo_manutencao_dias || 60);
  const [dataAplicacao, setDataAplicacao] = useState(
    atendimento.data_servico ? atendimento.data_servico.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [observacoes, setObservacoes] = useState(
    atendimento.cuidados_padrao ||
    'Tempo de cura inicial: 48 horas sem contato com água. Cura total em 7 dias. Lavar sempre com shampoo neutro. Manutenções preventivas a cada 60 dias são obrigatórias para manter a garantia ativa.'
  );

  React.useEffect(() => {
    if (isOpen) {
      if (atendimento.servico_nome) setServicoNome(atendimento.servico_nome);
      if (atendimento.produto_padrao) setProdutoAplicado(atendimento.produto_padrao);
      if (atendimento.garantia_meses) setMesesGarantia(atendimento.garantia_meses);
      if (atendimento.intervalo_manutencao_dias) setIntervaloDias(atendimento.intervalo_manutencao_dias);
      if (atendimento.cuidados_padrao) setObservacoes(atendimento.cuidados_padrao);
      if (atendimento.data_servico) setDataAplicacao(atendimento.data_servico.slice(0, 10));
    }
  }, [isOpen, atendimento]);

  const [emitindo, setEmitindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [certificadoGerado, setCertificadoGerado] = useState<{
    codigo: string;
    data_vencimento: string;
  } | null>(null);

  const [copiado, setCopiado] = useState(false);
  const [showAdesivoModal, setShowAdesivoModal] = useState(false);

  const handleEmitir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!servicoNome.trim()) {
      setErro('Informe o nome do serviço de proteção.');
      return;
    }

    setEmitindo(true);
    setErro(null);

    try {
      const { data, error } = await supabase.rpc('emitir_certificado_garantia', {
        p_dados: {
          agendamento_id: atendimento.agendamento_id || null,
          cliente_id: atendimento.cliente_id,
          veiculo_id: atendimento.veiculo_id,
          servico_id: atendimento.servico_id || null,
          servico_nome: servicoNome.trim(),
          produto_aplicado: produtoAplicado.trim() || null,
          garantia_meses: mesesGarantia,
          intervalo_manutencao_dias: intervaloDias,
          data_aplicacao: dataAplicacao,
          observacoes: observacoes.trim() || null
        }
      });

      if (error) throw error;

      if (data?.sucesso) {
        setCertificadoGerado({
          codigo: data.codigo,
          data_vencimento: data.data_vencimento
        });
        if (onSucesso) onSucesso(data.codigo);
      } else {
        throw new Error(data?.motivo || 'Falha ao gerar certificado');
      }
    } catch (err: any) {
      console.error('Erro ao emitir certificado:', err);
      setErro(err.message || 'Erro ao emitir certificado.');
    } finally {
      setEmitindo(false);
    }
  };

  const urlCertificado = certificadoGerado
    ? `${window.location.origin}/garantia/${certificadoGerado.codigo}`
    : '';

  const handleEnviarWhatsApp = () => {
    if (!atendimento.cliente_telefone || !certificadoGerado) return;
    const primeiroNome = atendimento.cliente_nome.split(' ')[0] || 'Cliente';
    const msg = `Olá, ${primeiroNome}! Seu Certificado Digital de Garantia (${servicoNome}) para o ${atendimento.veiculo_modelo} já está disponível online: ${urlCertificado} . Você pode consultar as especificações da proteção e o cronograma de revisões sempre que desejar!`;
    const link = montarLinkWhatsapp(atendimento.cliente_telefone, msg);
    if (link) {
      window.open(link, '_blank');
    }
  };

  const handleCopiarLink = async () => {
    if (!urlCertificado) return;
    try {
      await navigator.clipboard.writeText(urlCertificado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // fallback
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={certificadoGerado ? 'Certificado Emitido com Sucesso!' : 'Emitir Certificado Digital de Garantia'}
        maxWidth="lg"
      >
        {certificadoGerado ? (
          /* SUCESSO: EXIBIÇÃO DO CERTIFICADO GERADO */
          <div className="flex flex-col gap-5 py-2">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <Check size={22} className="stroke-[3]" />
              </div>
              <div className="space-y-0.5">
                <h4 className="font-bold text-emerald-300 text-sm">
                  Certificado {certificadoGerado.codigo} gerado e autenticado!
                </h4>
                <p className="text-xs text-vapor-400">
                  O certificado digital já está acessível publicamente via link e QR Code para o cliente.
                </p>
              </div>
            </div>

            {/* CARD RESUMO */}
            <div className="bg-graphite-950 p-4 rounded-xl border border-graphite-800 space-y-3">
              <div className="flex justify-between items-center border-b border-graphite-800 pb-2.5">
                <span className="text-xs text-vapor-400">Código de Autenticação:</span>
                <span className="font-mono font-black text-amber-400 text-base">{certificadoGerado.codigo}</span>
              </div>
              <div className="flex justify-between items-center border-b border-graphite-800 pb-2.5 text-xs">
                <span className="text-vapor-400">Veículo:</span>
                <span className="font-bold text-white">
                  {atendimento.veiculo_modelo} ({atendimento.veiculo_placa})
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-graphite-800 pb-2.5 text-xs">
                <span className="text-vapor-400">Serviço / Produto:</span>
                <span className="font-bold text-vapor-200">
                  {servicoNome} · <span className="text-amber-300">{produtoAplicado}</span>
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-vapor-400">Cobertura:</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {mesesGarantia} meses (Revisões a cada {intervaloDias} dias)
                </span>
              </div>
            </div>

            {/* AÇÕES PÓS-EMISSÃO */}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => setShowAdesivoModal(true)}
                className="flex-1 py-2.5 flex items-center justify-center gap-2 font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 text-xs"
              >
                <Printer size={16} />
                <span>Imprimir Adesivo com QR Code</span>
              </Button>

              {atendimento.cliente_telefone && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleEnviarWhatsApp}
                  className="py-2.5 px-4 flex items-center justify-center gap-2 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  <MessageSquare size={16} />
                  <span>Enviar no WhatsApp</span>
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                onClick={handleCopiarLink}
                className="py-2.5 px-4 flex items-center justify-center gap-2 text-xs"
              >
                {copiado ? <Check size={16} className="text-mint-400" /> : <Copy size={16} />}
                <span>{copiado ? 'Copiado!' : 'Copiar Link'}</span>
              </Button>
            </div>
          </div>
        ) : (
          /* FORMULÁRIO DE EMISSÃO */
          <form onSubmit={handleEmitir} className="flex flex-col gap-4">
            {/* Header com dados do veículo */}
            <div className="p-3 bg-graphite-900 rounded-xl border border-graphite-700 flex items-center justify-between text-xs">
              <div>
                <span className="text-vapor-400 block text-[10px] uppercase font-bold">Cliente & Veículo</span>
                <strong className="text-white text-sm">{atendimento.cliente_nome}</strong>
                <span className="text-vapor-400 block font-mono">
                  {atendimento.veiculo_modelo} · <span className="text-amber-300 font-bold">{atendimento.veiculo_placa}</span>
                </span>
              </div>
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
                <ShieldCheck size={20} />
              </div>
            </div>

            {/* Nome do Serviço */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-vapor-200">Tipo de Proteção / Serviço:</label>
              <Input
                value={servicoNome}
                onChange={(e) => setServicoNome(e.target.value)}
                placeholder="Ex: Vitrificação Cerâmica 9H"
                required
              />
            </div>

            {/* Produto Aplicado com Tags Rápidas */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-vapor-200">Produto / Coating Utilizado:</label>
              <Input
                value={produtoAplicado}
                onChange={(e) => setProdutoAplicado(e.target.value)}
                placeholder="Ex: Vonixx V-Paint 3 Anos"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PRODUTOS_SUGERIDOS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProdutoAplicado(p)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                      produtoAplicado === p
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                        : 'bg-graphite-900 text-vapor-400 border-graphite-700 hover:text-vapor-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Validade da Garantia e Periodicidade */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-vapor-200 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-amber-400" />
                  Validade da Cobertura:
                </label>
                <div className="grid grid-cols-5 gap-1">
                  {[6, 12, 24, 36, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMesesGarantia(m)}
                      className={`py-2 text-[11px] font-bold rounded-lg border transition text-center ${
                        mesesGarantia === m
                          ? 'bg-amber-500 text-graphite-950 border-amber-400 font-extrabold shadow-sm'
                          : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:border-graphite-500'
                      }`}
                    >
                      {m < 12 ? `${m}m` : `${m / 12}a`}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-vapor-400 block text-right">
                  {mesesGarantia < 12 ? `${mesesGarantia} meses` : `${mesesGarantia / 12} ano(s) de garantia`}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-vapor-200 flex items-center gap-1.5">
                  <Clock size={14} className="text-amber-400" />
                  Revisões Periódicas:
                </label>
                <div className="grid grid-cols-4 gap-1">
                  {[30, 45, 60, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setIntervaloDias(d)}
                      className={`py-2 text-[11px] font-bold rounded-lg border transition text-center ${
                        intervaloDias === d
                          ? 'bg-amber-500 text-graphite-950 border-amber-400 font-extrabold shadow-sm'
                          : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:border-graphite-500'
                      }`}
                    >
                      {d} dias
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-amber-400/90 block text-right">
                  Manutenção a cada {intervaloDias} dias
                </span>
              </div>
            </div>

            {/* Data de Aplicação */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-vapor-200 flex items-center gap-1.5">
                <Calendar size={14} className="text-amber-400" />
                Data de Aplicação:
              </label>
              <Input
                type="date"
                value={dataAplicacao}
                onChange={(e) => setDataAplicacao(e.target.value)}
                required
              />
            </div>

            {/* Observações / Cuidados de Cura */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-vapor-200">
                Instruções de Cura & Cuidados Recomendados:
              </label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-graphite-900 border border-graphite-700 rounded-lg text-xs text-vapor-100 placeholder:text-vapor-500 focus:outline-none focus:border-amber-500 leading-relaxed"
                placeholder="Ex: Tempo de cura 48 horas..."
              />
            </div>

            {erro && (
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{erro}</span>
              </div>
            )}

            {/* Botões */}
            <div className="flex justify-end gap-2.5 pt-2 border-t border-graphite-700">
              <Button type="button" variant="secondary" onClick={onClose} disabled={emitindo} className="text-xs">
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={emitindo}
                className="text-xs font-bold bg-amber-500 hover:bg-amber-400 text-graphite-950 flex items-center gap-1.5"
              >
                <Sparkles size={15} />
                <span>{emitindo ? 'Emitindo Certificado...' : 'Emitir Certificado Oficial'}</span>
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL DE ADESIVO DE PARA-BRISA */}
      {showAdesivoModal && certificadoGerado && (
        <AdesivoParabrisaModal
          isOpen={showAdesivoModal}
          onClose={() => setShowAdesivoModal(false)}
          certificado={{
            codigo: certificadoGerado.codigo,
            servico_nome: servicoNome,
            produto_aplicado: produtoAplicado,
            data_aplicacao: dataAplicacao,
            data_vencimento: certificadoGerado.data_vencimento,
            proxima_revisao_data: new Date(
              new Date(dataAplicacao).getTime() + intervaloDias * 24 * 60 * 60 * 1000
            ).toISOString()
          }}
          oficina={{
            nome: atendimento.tenant_nome || 'NuvemWash Detailer',
            logo_path: atendimento.tenant_logo,
            telefone: null
          }}
          veiculo={{
            modelo: atendimento.veiculo_modelo,
            placa: atendimento.veiculo_placa,
            cor: atendimento.veiculo_cor
          }}
        />
      )}
    </>
  );
};
