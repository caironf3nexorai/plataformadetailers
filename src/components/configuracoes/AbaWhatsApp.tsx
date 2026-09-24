import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
  MessageCircle, 
  Smartphone, 
  CheckCircle2, 
  RefreshCw, 
  Save, 
  QrCode, 
  Clock, 
  ShieldCheck, 
  Sparkles, 
  Send, 
  Server,
  Calendar,
  XCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { 
  obterResumoWhatsApp, 
  salvarConfigWhatsApp, 
  gerarFilaLembretes, 
  obterQRCodeEvolution, 
  desconectarEvolution,
  enviarMensagemEvolution,
  atualizarStatusMensagem
} from '../../services/whatsappService';
import type { WhatsAppConfig, ResumoWhatsApp } from '../../services/whatsappService';

export const AbaWhatsApp: React.FC = () => {
  const { tenant } = useAuth();
  const { showSuccess, showError, showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [varrendo, setVarrendo] = useState(false);
  const [disparando, setDisparando] = useState(false);
  const [showConfigAvancada, setShowConfigAvancada] = useState(false);

  // Estados de Configuração
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [instanceStatus, setInstanceStatus] = useState<'desconectado' | 'conectando' | 'conectado'>('desconectado');
  const [numeroConectado, setNumeroConectado] = useState('');

  // Toggles e Templates
  const [lembreteAgendamentoAtivo, setLembreteAgendamentoAtivo] = useState(true);
  const [lembreteAgendamentoTemplate, setLembreteAgendamentoTemplate] = useState('');

  const [lembreteVitrificacaoAtivo, setLembreteVitrificacaoAtivo] = useState(true);
  const [lembreteVitrificacaoDias, setLembreteVitrificacaoDias] = useState(180);
  const [lembreteVitrificacaoTemplate, setLembreteVitrificacaoTemplate] = useState('');

  const [lembreteInativoAtivo, setLembreteInativoAtivo] = useState(true);
  const [lembreteInativoDias, setLembreteInativoDias] = useState(60);
  const [lembreteInativoTemplate, setLembreteInativoTemplate] = useState('');

  const [horarioEnvio, setHorarioEnvio] = useState('08:30');

  // QR Code
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [carregandoQr, setCarregandoQr] = useState(false);

  // Fila e Métricas
  const [resumo, setResumo] = useState<ResumoWhatsApp | null>(null);

  const carregarDados = async () => {
    setLoading(true);
    try {
      const data = await obterResumoWhatsApp();
      setResumo(data);

      if (data.config) {
        setApiUrl(data.config.api_url || '');
        setApiKey(data.config.api_key || '');
        setInstanceName(data.config.instance_name || (tenant ? `oficina_${tenant.id.replace(/-/g, '').slice(0, 12)}` : ''));
        setInstanceStatus(data.config.instance_status || 'desconectado');
        setNumeroConectado(data.config.numero_conectado || '');

        setLembreteAgendamentoAtivo(data.config.lembrete_agendamento_ativo ?? true);
        setLembreteAgendamentoTemplate(data.config.lembrete_agendamento_template || '');

        setLembreteVitrificacaoAtivo(data.config.lembrete_vitrificacao_ativo ?? true);
        setLembreteVitrificacaoDias(data.config.lembrete_vitrificacao_dias || 180);
        setLembreteVitrificacaoTemplate(data.config.lembrete_vitrificacao_template || '');

        setLembreteInativoAtivo(data.config.lembrete_retorno_inativo_ativo ?? true);
        setLembreteInativoDias(data.config.lembrete_retorno_inativo_dias || 60);
        setLembreteInativoTemplate(data.config.lembrete_retorno_inativo_template || '');

        setHorarioEnvio(data.config.horario_envio_padrao ? data.config.horario_envio_padrao.slice(0, 5) : '08:30');
      } else if (tenant) {
        setInstanceName(`oficina_${tenant.id.replace(/-/g, '').slice(0, 12)}`);
      }
    } catch (err: any) {
      console.error('[AbaWhatsApp] Erro ao carregar dados:', err);
      showError(err.message || 'Erro ao carregar configurações de WhatsApp.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const handleSalvarConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSalvando(true);
    try {
      const payload: Partial<WhatsAppConfig> = {
        api_url: apiUrl.trim(),
        api_key: apiKey.trim(),
        instance_name: instanceName.trim(),
        instance_status: instanceStatus,
        numero_conectado: numeroConectado.trim(),
        lembrete_agendamento_ativo: lembreteAgendamentoAtivo,
        lembrete_agendamento_template: lembreteAgendamentoTemplate.trim(),
        lembrete_vitrificacao_ativo: lembreteVitrificacaoAtivo,
        lembrete_vitrificacao_dias: Number(lembreteVitrificacaoDias) || 180,
        lembrete_vitrificacao_template: lembreteVitrificacaoTemplate.trim(),
        lembrete_retorno_inativo_ativo: lembreteInativoAtivo,
        lembrete_retorno_inativo_dias: Number(lembreteInativoDias) || 60,
        lembrete_retorno_inativo_template: lembreteInativoTemplate.trim(),
        horario_envio_padrao: `${horarioEnvio}:00`
      };

      await salvarConfigWhatsApp(payload);
      showSuccess('Configurações de automação salvas com sucesso!');
      await carregarDados();
    } catch (err: any) {
      console.error('[AbaWhatsApp] Erro ao salvar:', err);
      showError(err.message || 'Erro ao salvar configurações.');
    } finally {
      setSalvando(false);
    }
  };

  const handleGerarQRCode = async () => {
    if (!apiUrl.trim() || !apiKey.trim()) {
      showToast('Preencha a URL da VPS e a API Key antes de conectar.', 'warning');
      setShowConfigAvancada(true);
      return;
    }

    setCarregandoQr(true);
    setQrCodeBase64(null);

    try {
      const result = await obterQRCodeEvolution(apiUrl.trim(), apiKey.trim(), instanceName.trim());
      if (result.status === 'conectado') {
        setInstanceStatus('conectado');
        setNumeroConectado(result.numero || '');
        await salvarConfigWhatsApp({
          instance_status: 'conectado',
          numero_conectado: result.numero || ''
        });
        showSuccess('WhatsApp já está conectado com sucesso!');
      } else if (result.qrcode) {
        setQrCodeBase64(result.qrcode);
        setInstanceStatus('conectando');
      } else {
        showToast('Aguardando inicialização da VPS. Tente novamente em instantes.', 'warning');
      }
    } catch (err: any) {
      showError(err.message || 'Erro ao conectar à VPS do WhatsApp.');
    } finally {
      setCarregandoQr(false);
    }
  };

  const handleDesconectar = async () => {
    if (!confirm('Deseja realmente desconectar o WhatsApp desta oficina?')) return;
    try {
      await desconectarEvolution(apiUrl, apiKey, instanceName);
      setInstanceStatus('desconectado');
      setNumeroConectado('');
      setQrCodeBase64(null);
      await salvarConfigWhatsApp({
        instance_status: 'desconectado',
        numero_conectado: ''
      });
      showSuccess('WhatsApp desconectado.');
    } catch (err: any) {
      showError('Erro ao desconectar WhatsApp.');
    }
  };

  const handleVarreduraManual = async () => {
    setVarrendo(true);
    try {
      const res: any = await gerarFilaLembretes();
      showSuccess(res.mensagem || `${res.total_enfileirados} novas mensagens preparadas na fila!`);
      await carregarDados();
    } catch (err: any) {
      console.error('[AbaWhatsApp] Erro na varredura:', err);
      showError(err.message || 'Erro ao executar varredura.');
    } finally {
      setVarrendo(false);
    }
  };

  const handleDispararFilaAgora = async () => {
    if (!resumo || resumo.total_pendentes === 0) {
      showToast('Não há mensagens pendentes na fila para enviar.', 'warning');
      return;
    }

    if (instanceStatus !== 'conectado' && (!apiUrl || !apiKey)) {
      showToast('Conecte o WhatsApp ou configure a VPS para realizar o disparo.', 'warning');
      return;
    }

    setDisparando(true);
    let enviados = 0;
    let erros = 0;

    try {
      const pendentes = resumo.mensagens.filter(m => m.status === 'pendente');

      for (const item of pendentes) {
        try {
          await atualizarStatusMensagem(item.id, 'enviando');
          await enviarMensagemEvolution(apiUrl, apiKey, instanceName, item.destinatario_telefone, item.mensagem);
          await atualizarStatusMensagem(item.id, 'enviado');
          enviados++;
        } catch (itemErr: any) {
          console.error(`Erro ao enviar para ${item.destinatario_telefone}:`, itemErr);
          await atualizarStatusMensagem(item.id, 'falha', itemErr.message || 'Falha no envio');
          erros++;
        }
      }

      showSuccess(`Disparo concluído: ${enviados} enviadas com sucesso${erros > 0 ? `, ${erros} falhas` : ''}.`);
      await carregarDados();
    } catch (err: any) {
      showError(err.message || 'Erro durante o disparo da fila.');
    } finally {
      setDisparando(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* 1. CARD PRINCIPAL: STATUS DO WHATSAPP DA OFICINA */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className={`p-3.5 rounded-2xl shrink-0 ${
              instanceStatus === 'conectado' 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
            }`}>
              <Smartphone className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-[18px] text-vapor-100 font-bold uppercase tracking-wider">
                  WhatsApp Automático da Oficina
                </h3>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                  instanceStatus === 'conectado'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-zinc-500/10 text-zinc-400 border-zinc-600'
                }`}>
                  {instanceStatus === 'conectado' ? '● Conectado' : '○ Desconectado'}
                </span>
              </div>
              <p className="text-xs text-vapor-400 font-sans max-w-xl">
                O NuvemWash envia lembretes de agendamentos e revisões de vitrificação 
                <strong> diretamente do número da sua estética</strong> sem você precisar mandar um por um.
              </p>
              {instanceStatus === 'conectado' && numeroConectado && (
                <div className="text-xs font-mono text-emerald-400 pt-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Instância ativa conectada: <strong>{numeroConectado}</strong>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {instanceStatus === 'conectado' ? (
              <Button
                variant="danger"
                onClick={handleDesconectar}
                className="text-xs px-3.5 py-2"
              >
                Desconectar Número
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleGerarQRCode}
                disabled={carregandoQr}
                className="text-xs px-4 py-2.5 bg-[#25D366] hover:bg-[#20ba59] text-black font-bold flex items-center gap-2"
              >
                {carregandoQr ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <QrCode className="w-4 h-4" />
                )}
                Conectar via QR Code
              </Button>
            )}

            <Button
              variant="secondary"
              onClick={carregarDados}
              disabled={loading}
              className="p-2.5 h-10 w-10 text-vapor-300"
              title="Atualizar dados"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* ÁREA DO QR CODE QUANDO GERADO */}
        {qrCodeBase64 && instanceStatus !== 'conectado' && (
          <div className="mt-6 p-5 bg-graphite-900 border border-emerald-500/30 rounded-2xl flex flex-col md:flex-row items-center gap-6 animate-fadeIn">
            <div className="bg-white p-3 rounded-xl shadow-2xl shrink-0">
              <img 
                src={qrCodeBase64.startsWith('data:') ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`} 
                alt="QR Code WhatsApp" 
                className="w-48 h-48 object-contain"
              />
            </div>
            <div className="space-y-2 text-xs font-sans text-vapor-300">
              <div className="font-bold text-vapor-100 text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Escaneie com o celular da sua oficina:
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-vapor-400 font-sans">
                <li>Abra o <strong>WhatsApp</strong> no aparelho da oficina.</li>
                <li>Toque em <strong>Mais opções</strong> (Android) ou <strong>Configurações</strong> (iPhone).</li>
                <li>Toque em <strong>Aparelhos conectados</strong> e depois em <strong>Conectar um aparelho</strong>.</li>
                <li>Aponte a câmera para este QR Code.</li>
              </ol>
              <div className="pt-2">
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={handleGerarQRCode} 
                  className="text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Atualizar QR Code
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 2. CARD DE RESUMO / MÉTRICAS DE DISPARO */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-graphite-800 border-graphite-600 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono uppercase text-vapor-400">Mensagens na Fila</div>
            <div className="text-2xl font-mono font-bold text-amber-400">{resumo?.total_pendentes ?? 0}</div>
            <div className="text-[10px] text-vapor-400">Aguardando envio automático</div>
          </div>
          <Clock className="w-8 h-8 text-amber-400/40" />
        </Card>

        <Card className="p-4 bg-graphite-800 border-graphite-600 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono uppercase text-vapor-400">Enviadas Hoje</div>
            <div className="text-2xl font-mono font-bold text-emerald-400">{resumo?.total_enviados_hoje ?? 0}</div>
            <div className="text-[10px] text-vapor-400">Notificações entregues</div>
          </div>
          <CheckCircle2 className="w-8 h-8 text-emerald-400/40" />
        </Card>

        <Card className="p-4 bg-graphite-800 border-graphite-600 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono uppercase text-vapor-400">Falhas no Envio</div>
            <div className="text-2xl font-mono font-bold text-red-400">{resumo?.total_falhas_hoje ?? 0}</div>
            <div className="text-[10px] text-vapor-400">Número inválido ou sem zap</div>
          </div>
          <XCircle className="w-8 h-8 text-red-400/40" />
        </Card>
      </div>

      {/* 3. REGRAS DE AUTOMAÇÃO NATIVAS (PILOTO AUTOMÁTICO) */}
      <form onSubmit={handleSalvarConfig} className="flex flex-col gap-6">
        <Card className="p-6 bg-graphite-800 border-graphite-600 shadow-lg space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-graphite-700 gap-3">
            <div>
              <h4 className="font-display text-[16px] text-vapor-100 font-bold uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Automações em Segundo Plano (Piloto Automático)
              </h4>
              <p className="text-xs text-vapor-400 font-sans mt-0.5">
                O sistema roda diariamente às <strong>{horarioEnvio}</strong> e prepara os envios automaticamente.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-vapor-400 font-sans">Horário do Robô:</label>
              <input
                type="time"
                value={horarioEnvio}
                onChange={(e) => setHorarioEnvio(e.target.value)}
                className="bg-graphite-900 border border-graphite-700 text-vapor-100 text-xs px-2.5 py-1.5 rounded-lg font-mono outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* REGRA 1: AGENDAMENTOS */}
          <div className="p-4 bg-graphite-900/80 rounded-xl border border-graphite-700 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-vapor-100 text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-400" />
                  1. Lembrete de Agendamento (Avisar 24h antes)
                </div>
                <p className="text-xs text-vapor-400">
                  Envia um aviso automático no dia anterior para o cliente confirmar o comparecimento.
                </p>
              </div>

              <input
                type="checkbox"
                checked={lembreteAgendamentoAtivo}
                onChange={(e) => setLembreteAgendamentoAtivo(e.target.checked)}
                className="w-5 h-5 accent-amber-500 rounded cursor-pointer shrink-0 mt-1"
              />
            </div>

            {lembreteAgendamentoAtivo && (
              <div className="space-y-1.5 pt-2">
                <label className="text-[11px] font-mono text-vapor-400 uppercase">
                  Modelo da Mensagem (Variáveis: <code className="text-amber-400">{'{cliente}'}</code>, <code className="text-amber-400">{'{hora}'}</code>, <code className="text-amber-400">{'{data}'}</code>, <code className="text-amber-400">{'{veiculo}'}</code>, <code className="text-amber-400">{'{servicos}'}</code>, <code className="text-amber-400">{'{oficina}'}</code>)
                </label>
                <textarea
                  rows={3}
                  value={lembreteAgendamentoTemplate}
                  onChange={(e) => setLembreteAgendamentoTemplate(e.target.value)}
                  className="w-full bg-graphite-950 border border-graphite-700 rounded-lg p-3 text-xs text-vapor-100 font-sans focus:border-amber-500 outline-none"
                />
              </div>
            )}
          </div>

          {/* REGRA 2: VITRIFICAÇÃO E RETORNOS */}
          <div className="p-4 bg-graphite-900/80 rounded-xl border border-graphite-700 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-vapor-100 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  2. Manutenção de Vitrificação / Proteção (Garantia)
                </div>
                <p className="text-xs text-vapor-400">
                  Lembra o cliente quando a vitrificação estiver completando o tempo recomendado para revisão preventiva.
                </p>
              </div>

              <input
                type="checkbox"
                checked={lembreteVitrificacaoAtivo}
                onChange={(e) => setLembreteVitrificacaoAtivo(e.target.checked)}
                className="w-5 h-5 accent-emerald-500 rounded cursor-pointer shrink-0 mt-1"
              />
            </div>

            {lembreteVitrificacaoAtivo && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-vapor-400">Dias após o serviço:</label>
                  <input
                    type="number"
                    value={lembreteVitrificacaoDias}
                    onChange={(e) => setLembreteVitrificacaoDias(Number(e.target.value))}
                    className="w-24 bg-graphite-950 border border-graphite-700 rounded-lg px-3 py-1.5 text-xs text-vapor-100 font-mono focus:border-emerald-500 outline-none"
                  />
                  <span className="text-xs text-vapor-400">(Padrão: 180 dias / 6 meses)</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-vapor-400 uppercase">
                    Modelo da Mensagem (Variáveis: <code className="text-emerald-400">{'{cliente}'}</code>, <code className="text-emerald-400">{'{dias}'}</code>, <code className="text-emerald-400">{'{servico}'}</code>, <code className="text-emerald-400">{'{veiculo}'}</code>, <code className="text-emerald-400">{'{oficina}'}</code>)
                  </label>
                  <textarea
                    rows={3}
                    value={lembreteVitrificacaoTemplate}
                    onChange={(e) => setLembreteVitrificacaoTemplate(e.target.value)}
                    className="w-full bg-graphite-950 border border-graphite-700 rounded-lg p-3 text-xs text-vapor-100 font-sans focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* REGRA 3: CLIENTES SUMIDOS / INATIVOS */}
          <div className="p-4 bg-graphite-900/80 rounded-xl border border-graphite-700 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <div className="font-bold text-vapor-100 text-sm flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-cyan-400" />
                  3. Reativação de Clientes Sumidos (Recorrentes)
                </div>
                <p className="text-xs text-vapor-400">
                  Convida clientes que não fazem nenhum serviço há mais de X dias para retornar.
                </p>
              </div>

              <input
                type="checkbox"
                checked={lembreteInativoAtivo}
                onChange={(e) => setLembreteInativoAtivo(e.target.checked)}
                className="w-5 h-5 accent-cyan-500 rounded cursor-pointer shrink-0 mt-1"
              />
            </div>

            {lembreteInativoAtivo && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-vapor-400">Dias de inatividade:</label>
                  <input
                    type="number"
                    value={lembreteInativoDias}
                    onChange={(e) => setLembreteInativoDias(Number(e.target.value))}
                    className="w-24 bg-graphite-950 border border-graphite-700 rounded-lg px-3 py-1.5 text-xs text-vapor-100 font-mono focus:border-cyan-500 outline-none"
                  />
                  <span className="text-xs text-vapor-400">(Padrão: 60 dias)</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono text-vapor-400 uppercase">
                    Modelo da Mensagem (Variáveis: <code className="text-cyan-400">{'{cliente}'}</code>, <code className="text-cyan-400">{'{veiculo}'}</code>, <code className="text-cyan-400">{'{oficina}'}</code>)
                  </label>
                  <textarea
                    rows={3}
                    value={lembreteInativoTemplate}
                    onChange={(e) => setLembreteInativoTemplate(e.target.value)}
                    className="w-full bg-graphite-950 border border-graphite-700 rounded-lg p-3 text-xs text-vapor-100 font-sans focus:border-cyan-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              variant="primary"
              disabled={salvando}
              className="px-6 py-2.5 text-xs font-bold flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {salvando ? 'Salvando...' : 'Salvar Regras de Automação'}
            </Button>
          </div>
        </Card>
      </form>

      {/* 4. CONFIGURAÇÃO AVANÇADA DA VPS / EVOLUTION API (ACORDEÃO) */}
      <Card className="p-5 bg-graphite-800 border-graphite-600 shadow-md">
        <button
          type="button"
          onClick={() => setShowConfigAvancada(!showConfigAvancada)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-vapor-400" />
            <div>
              <div className="font-display text-sm font-bold text-vapor-100 uppercase tracking-wider">
                Configurações da VPS / Gateway WhatsApp
              </div>
              <div className="text-[11px] text-vapor-400 font-sans">
                Parâmetros da Evolution API instalada na sua VPS para disparo em nuvem
              </div>
            </div>
          </div>
          {showConfigAvancada ? <ChevronUp className="w-4 h-4 text-vapor-400" /> : <ChevronDown className="w-4 h-4 text-vapor-400" />}
        </button>

        {showConfigAvancada && (
          <div className="mt-4 pt-4 border-t border-graphite-700 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-vapor-400">URL da VPS (Evolution API):</label>
              <input
                type="text"
                placeholder="Ex: http://123.45.67.89:8080 ou https://zap.meusite.com"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-xs text-vapor-100 font-mono outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-vapor-400">Global API Key da Evolution:</label>
              <input
                type="password"
                placeholder="Chave secreta configurada no docker-compose"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-xs text-vapor-100 font-mono outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-vapor-400">Nome da Instância:</label>
              <input
                type="text"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                className="w-full bg-graphite-900 border border-graphite-700 rounded-lg p-2.5 text-xs text-vapor-100 font-mono outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={handleSalvarConfig}
                disabled={salvando}
                className="w-full text-xs py-2.5"
              >
                Atualizar Credenciais da VPS
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 5. FILA DE DISPARO E HISTÓRICO DE MENSAGENS */}
      <Card className="p-6 bg-graphite-800 border-graphite-600 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-graphite-700 gap-3">
          <div>
            <h4 className="font-display text-[16px] text-vapor-100 font-bold uppercase tracking-wider flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              Fila de Disparos & Histórico Recente
            </h4>
            <p className="text-xs text-vapor-400 font-sans">
              Veja as mensagens geradas pelo sistema e o status de entrega a cada cliente.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleVarreduraManual}
              disabled={varrendo}
              className="text-xs flex items-center gap-1.5"
              title="Varre o banco agora procurando agendamentos de amanhã e manutenções"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${varrendo ? 'animate-spin' : ''}`} />
              Varredura Manual
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleDispararFilaAgora}
              disabled={disparando || !resumo || resumo.total_pendentes === 0}
              className="text-xs bg-emerald-600 hover:bg-emerald-500 font-bold flex items-center gap-1.5"
            >
              <Send className={`w-3.5 h-3.5 ${disparando ? 'animate-pulse' : ''}`} />
              Disparar Fila Agora ({resumo?.total_pendentes ?? 0})
            </Button>
          </div>
        </div>

        {/* Tabela de Mensagens */}
        {!resumo?.mensagens || resumo.mensagens.length === 0 ? (
          <div className="py-12 text-center text-vapor-400 font-sans text-xs">
            Nenhuma mensagem na fila ainda. Clique em <strong>"Varredura Manual"</strong> para testar a busca de agendamentos e retornos.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-xs">
              <thead>
                <tr className="border-b border-graphite-700 text-vapor-400 font-mono text-[11px] uppercase">
                  <th className="py-2.5 px-3">Cliente</th>
                  <th className="py-2.5 px-3">Telefone</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3">Mensagem</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite-700/60 text-vapor-200">
                {resumo.mensagens.map((item) => (
                  <tr key={item.id} className="hover:bg-graphite-700/30">
                    <td className="py-2.5 px-3 font-bold text-vapor-100 whitespace-nowrap">
                      {item.destinatario_nome}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-vapor-300 whitespace-nowrap">
                      {item.destinatario_telefone}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                        item.tipo === 'agendamento' 
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' 
                          : item.tipo === 'vitrificacao_retorno'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                      }`}>
                        {item.tipo === 'agendamento' ? 'Agendamento' : item.tipo === 'vitrificacao_retorno' ? 'Vitrificação' : 'Reativação'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 max-w-xs truncate text-vapor-300" title={item.mensagem}>
                      {item.mensagem}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        item.status === 'enviado' 
                          ? 'bg-emerald-500/20 text-emerald-300' 
                          : item.status === 'pendente'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        {item.status}
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
  );
};
