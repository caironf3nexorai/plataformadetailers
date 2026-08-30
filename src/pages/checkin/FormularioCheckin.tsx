import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Checkin, CheckinAvaria, CheckinFoto, EstadoIluminacao, NivelSujidade, EstadoFluido } from '../../types/checkin';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { DiagramaVeiculo } from '../../components/checkin/DiagramaVeiculo';
import { CanvasAssinatura } from '../../components/checkin/CanvasAssinatura';
import { uploadEvidenciaFoto } from '../../utils/evidencias';
import { montarLinkWhatsapp } from '../../utils/whatsapp';
import { ModalConfirmarSemVistoria } from '../../components/checkin/ModalConfirmarSemVistoria';
import { dispensarVistoriaAgendamento } from '../../utils/checkin';
import {
  Car,
  Fuel,
  Lightbulb,
  Sparkles,
  Droplet,
  Camera,
  FileSignature,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

export const FormularioCheckin: React.FC = () => {
  const { agendamentoId } = useParams<{ agendamentoId: string }>();
  const navigate = useNavigate();
  const { tenant, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [savingStep, setSavingStep] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showModalPularVistoria, setShowModalPularVistoria] = useState(false);
  const [pularLoading, setPularLoading] = useState(false);

  const [step, setStep] = useState<number>(1);

  // Dados do Agendamento
  const [agendamento, setAgendamento] = useState<any>(null);

  // Estado do Checkin
  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [avarias, setAvarias] = useState<CheckinAvaria[]>([]);
  const [fotos, setFotos] = useState<CheckinFoto[]>([]);

  // Estados dos Campos
  const [km, setKm] = useState<string>('');
  const [nivelCombustivel, setNivelCombustivel] = useState<number | null>(4); // Default 1/2
  const [luzesPainel, setLuzesPainel] = useState<string[]>([]);
  const [estepe, setEstepe] = useState<boolean | null>(true);

  // Inspeções
  const [iluminacao, setIluminacao] = useState<Record<string, EstadoIluminacao>>({
    farol_baixo: 'ok',
    farol_alto: 'ok',
    meia_luz: 'ok',
    pisca_dianteiro: 'ok',
    lanterna_freio: 'ok',
    pisca_traseiro: 'ok',
    luz_re: 'ok',
    neblina: 'ok',
    placa: 'ok',
  });

  const [sujidade, setSujidade] = useState<Record<string, NivelSujidade>>({
    motor: 'medio',
    chassi: 'medio',
    carroceria: 'medio',
    bancos: 'medio',
    carpete: 'medio',
    painel: 'medio',
    interior_geral: 'medio',
  });

  const [fluidos, setFluidos] = useState<Record<string, EstadoFluido>>({
    direcao: 'ok',
    motor: 'ok',
    arrefecimento: 'ok',
    freio: 'ok',
  });

  const [observacoes, setObservacoes] = useState('');
  const [assinaturaNome, setAssinaturaNome] = useState('');

  const [uploadingFotoGeral, setUploadingFotoGeral] = useState(false);
  const [modoAssinatura, setModoAssinatura] = useState<'presencial' | 'remoto'>('presencial');
  const [linkEnviado, setLinkEnviado] = useState(false);

  const handleEnviarLinkRemoto = async () => {
    if (!checkin || !agendamento) return;

    try {
      setSavingStep(true);
      const agora = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from('checkins')
        .update({
          enviado_em: agora,
          aceite_tipo: 'remoto',
        })
        .eq('id', checkin.id);

      if (updateErr) throw updateErr;

      const urlAceite = `${window.location.origin}/vistoria/${checkin.token_aceite}`;
      const nomeCliente = agendamento.cliente?.nome ? agendamento.cliente.nome.split(' ')[0] : 'Cliente';
      const modelo = agendamento.veiculo?.modelo || 'veículo';
      const placa = agendamento.veiculo?.placa ? `(${agendamento.veiculo.placa})` : '';

      const msg = `Olá ${nomeCliente}! Registramos a vistoria de entrada do seu ${modelo} ${placa}. Confira e assine pelo link: ${urlAceite}`;

      const linkWa = montarLinkWhatsapp(agendamento.cliente?.telefone, msg);

      if (linkWa) {
        window.open(linkWa, '_blank');
      } else {
        setError('Telefone do cliente não cadastrado ou inválido. Copie o link manualmente:\n' + urlAceite);
      }

      setLinkEnviado(true);
    } catch (err: any) {
      setError('Erro ao gerar link de aceite remoto: ' + err.message);
    } finally {
      setSavingStep(false);
    }
  };

  // Lista de Luzes do Painel Disponíveis
  const luzesDisponiveis = [
    'Injeção Eletrônica',
    'Óleo do Motor',
    'Bateria',
    'Freio',
    'ABS',
    'Airbag',
    'Combustível Reserva',
    'Controle de Tração',
    'Direção Elétrica',
    'Check Engine',
  ];

  useEffect(() => {
    if (agendamentoId && tenant) {
      inicializarCheckin();
    }
  }, [agendamentoId, tenant]);

  const inicializarCheckin = async () => {
    if (!agendamentoId || !tenant) return;
    try {
      setLoading(true);
      setError(null);

      // 1. Buscar dados do agendamento
      const { data: agData, error: agErr } = await supabase
        .from('agendamentos')
        .select(`
          id,
          inicio,
          status,
          cliente:clientes(id, nome, telefone),
          veiculo:veiculos(id, modelo, placa, cor, marca),
          servico:servicos(id, nome)
        `)
        .eq('id', agendamentoId)
        .single();

      if (agErr || !agData) throw new Error('Agendamento não encontrado.');
      setAgendamento(agData);
      setAssinaturaNome((agData.cliente as any)?.nome || '');

      // 2. Chamar RPC iniciar_checkin para obter ou criar o registro
      const { data: checkinId, error: rpcErr } = await supabase.rpc('iniciar_checkin', {
        p_agendamento: agendamentoId,
      });

      if (rpcErr) throw rpcErr;

      // 3. Carregar o checkin completo
      const { data: chkData, error: chkErr } = await supabase
        .from('checkins')
        .select('*')
        .eq('id', checkinId)
        .single();

      if (chkErr || !chkData) throw chkErr;

      // Se já estiver finalizado, redireciona para a visualização
      if (chkData.finalizado) {
        navigate(`/checkin/${chkData.id}/ver`, { replace: true });
        return;
      }

      setCheckin(chkData);
      setKm(chkData.km !== null ? String(chkData.km) : '');
      setNivelCombustivel(chkData.nivel_combustivel ?? 4);
      setLuzesPainel(chkData.luzes_painel || []);
      setEstepe(chkData.estepe);
      if (chkData.iluminacao && Object.keys(chkData.iluminacao).length > 0) {
        setIluminacao(chkData.iluminacao);
      }
      if (chkData.sujidade && Object.keys(chkData.sujidade).length > 0) {
        setSujidade(chkData.sujidade);
      }
      if (chkData.fluidos && Object.keys(chkData.fluidos).length > 0) {
        setFluidos(chkData.fluidos);
      }
      setObservacoes(chkData.observacoes || '');

      // 4. Carregar Avarias e Fotos
      fetchAvariasEFotos(checkinId);
    } catch (err: any) {
      console.error('[Inicializar Checkin Error]:', err);
      setError(err.message || 'Erro ao inicializar vistoria.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvariasEFotos = async (checkinId: string) => {
    const { data: avData } = await supabase
      .from('checkin_avarias')
      .select('*')
      .eq('checkin_id', checkinId)
      .order('created_at');

    setAvarias(avData || []);

    const { data: ftData } = await supabase
      .from('checkin_fotos')
      .select('*')
      .eq('checkin_id', checkinId)
      .order('created_at');

    setFotos(ftData || []);
  };

  // Salva o progresso do checkin no banco a cada troca de passo ou alteração importante
  const saveProgress = async () => {
    if (!checkin || checkin.finalizado) return;
    setSavingStep(true);
    try {
      await supabase
        .from('checkins')
        .update({
          km: km ? parseInt(km, 10) : null,
          nivel_combustivel: nivelCombustivel,
          luzes_painel: luzesPainel,
          estepe: estepe,
          iluminacao: iluminacao,
          sujidade: sujidade,
          fluidos: fluidos,
          observacoes: observacoes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', checkin.id);
    } catch (err) {
      console.error('Erro no autosave:', err);
    } finally {
      setSavingStep(false);
    }
  };

  const nextStep = async () => {
    await saveProgress();
    if (step < 8) setStep((s) => s + 1);
  };

  const prevStep = async () => {
    await saveProgress();
    if (step > 1) setStep((s) => s - 1);
  };

  // Handler para Adicionar Avaria no Diagrama
  const handleAddAvaria = async (avariaData: Omit<CheckinAvaria, 'id' | 'created_at'>) => {
    if (!checkin) return;
    const { data, error } = await supabase
      .from('checkin_avarias')
      .insert(avariaData)
      .select('*')
      .single();

    if (error) throw error;
    setAvarias((prev) => [...prev, data]);
  };

  // Handler para Remover Avaria
  const handleRemoveAvaria = async (avariaId: string) => {
    const { error } = await supabase
      .from('checkin_avarias')
      .delete()
      .eq('id', avariaId);

    if (error) throw new Error('Erro ao deletar avaria: ' + error.message);
    setAvarias((prev) => prev.filter((a) => a.id !== avariaId));
  };

  const [uploadProgressText, setUploadProgressText] = useState<string>('');

  // Upload de Foto de Avaria
  const handleAddFotoAvaria = async (avariaId: string, file: File, descricao?: string) => {
    if (!checkin || !tenant || !user) return;
    const { path, capturadaEm } = await uploadEvidenciaFoto(tenant.id, checkin.id, file, false, agendamento?.veiculo?.placa);

    const { data, error } = await supabase
      .from('checkin_fotos')
      .insert({
        tenant_id: tenant.id,
        checkin_id: checkin.id,
        avaria_id: avariaId,
        path: path,
        descricao: descricao || null,
        enviado_por: user.id,
        capturada_em: capturadaEm,
      })
      .select('*')
      .single();

    if (error) throw error;
    setFotos((prev) => [...prev, data]);
  };

  // Upload de Foto Geral de Vistoria
  const handleUploadFotoGeral = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!checkin || !tenant || !user || !e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    setUploadingFotoGeral(true);
    try {
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        setUploadProgressText(`Processando foto ${idx + 1} de ${files.length}...`);

        const { path, capturadaEm } = await uploadEvidenciaFoto(tenant.id, checkin.id, file, false, agendamento?.veiculo?.placa);
        const { data, error } = await supabase
          .from('checkin_fotos')
          .insert({
            tenant_id: tenant.id,
            checkin_id: checkin.id,
            path: path,
            descricao: 'Foto geral de entrada',
            enviado_por: user.id,
            capturada_em: capturadaEm,
          })
          .select('*')
          .single();

        if (error) throw error;
        setFotos((prev) => [...prev, data]);
      }
    } catch (err: any) {
      setError('Erro ao enviar fotos: ' + err.message);
    } finally {
      setUploadingFotoGeral(false);
      setUploadProgressText('');
    }
  };

  // Finalização do Checkin com Assinatura
  const handleFinalizarCheckin = async (signatureBlob: Blob) => {
    if (!checkin || !tenant || !assinaturaNome.trim()) {
      setError('Por favor, informe o nome de quem está assinando a vistoria.');
      return;
    }

    try {
      setSavingStep(true);
      // 1. Upload do PNG da Assinatura
      const { path: assinaturaPath } = await uploadEvidenciaFoto(tenant.id, checkin.id, signatureBlob, true);

      // 2. Chamar RPC finalizar_checkin
      const { error: rpcErr } = await supabase.rpc('finalizar_checkin', {
        p_checkin: checkin.id,
        p_assinatura_path: assinaturaPath,
        p_nome: assinaturaNome.trim(),
      });

      if (rpcErr) throw rpcErr;

      // 3. Redirecionar para a visualização legível do Checkin
      navigate(`/checkin/${checkin.id}/ver`, { replace: true });
    } catch (err: any) {
      console.error('[Finalizar Checkin Error]:', err);
      setError('Erro ao finalizar vistoria: ' + err.message);
    } finally {
      setSavingStep(false);
    }
  };

  const handleConfirmarPularVistoria = async () => {
    if (!agendamentoId || pularLoading) return;
    setPularLoading(true);
    try {
      const execId = await dispensarVistoriaAgendamento(agendamentoId);
      navigate(`/execucao/${execId}`, { replace: true });
    } catch (err: any) {
      console.error('[Pular Vistoria Error]:', err);
      setError(err?.message || 'Erro ao dispensar vistoria.');
      setShowModalPularVistoria(false);
    } finally {
      setPularLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="font-mono text-[13px] text-vapor-400">Carregando vistoria de entrada...</span>
      </div>
    );
  }

  if (error || !agendamento) {
    return (
      <div className="p-6 max-w-lg mx-auto bg-graphite-800 border border-flare-500/40 rounded-xl text-center flex flex-col gap-4">
        <AlertTriangle size={36} className="text-flare-400 mx-auto" />
        <h3 className="font-display text-[18px] text-vapor-100 uppercase">Erro na Vistoria</h3>
        <p className="font-sans text-[14px] text-vapor-400">{error}</p>
        <Button variant="secondary" onClick={() => navigate('/agenda')}>Voltar para Agenda</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto pb-12 overflow-x-hidden">
      {/* Topo Fixo Mobile */}
      <div className="sticky top-0 z-20 bg-graphite-950/95 backdrop-blur border-b border-graphite-800 p-3 rounded-lg flex items-center justify-between gap-2 shadow-md w-full">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="p-2 text-vapor-400 hover:text-vapor-100 rounded-lg hover:bg-graphite-800 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="flex flex-col">
            <span className="font-display text-[14px] sm:text-[15px] text-vapor-100 uppercase tracking-wide">
              Vistoria de Entrada
            </span>
            <span className="font-mono text-[11px] sm:text-[12px] text-amber-400 font-bold">
              Passo {step} de 8
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!tenant?.vistoria_obrigatoria && !checkin?.finalizado && (
            <button
              type="button"
              onClick={() => setShowModalPularVistoria(true)}
              className="px-2.5 py-1.5 rounded-lg bg-graphite-900 hover:bg-graphite-800 text-vapor-400 hover:text-vapor-200 border border-graphite-700 text-[11px] font-medium transition-colors min-h-[38px]"
            >
              Iniciar sem vistoria
            </button>
          )}

          <span className="hidden sm:inline font-mono text-[11px] text-vapor-500 shrink-0">
            {savingStep ? 'Salvando...' : 'Autosave ok'}
          </span>
        </div>
      </div>

      {/* Barra de Progresso em Passos */}
      <div className="w-full max-w-full grid grid-cols-8 gap-1 h-2 bg-graphite-800 rounded-full overflow-hidden">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
          <div
            key={s}
            className={`h-full transition-all ${
              s <= step ? 'bg-amber-500' : 'bg-graphite-800'
            }`}
          />
        ))}
      </div>

      {/* PASSO 1: Identificação do Veículo e Cliente */}
      {step === 1 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Car size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">1. Identificação do Veículo</h3>
              <p className="font-sans text-[12px] text-vapor-400">Confirme os dados e registre a quilometragem atual.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-graphite-900 p-4 rounded-lg border border-graphite-700">
            <div>
              <span className="text-[11px] text-vapor-400 uppercase font-mono">Cliente</span>
              <p className="font-sans text-[15px] font-bold text-vapor-100">{agendamento.cliente?.nome}</p>
              <p className="font-mono text-[12px] text-vapor-400">{agendamento.cliente?.telefone || '—'}</p>
            </div>
            <div>
              <span className="text-[11px] text-vapor-400 uppercase font-mono">Veículo & Placa</span>
              <p className="font-sans text-[15px] font-bold text-amber-400">{agendamento.veiculo?.modelo}</p>
              <p className="font-mono text-[13px] text-vapor-200">Placa: {agendamento.veiculo?.placa?.toUpperCase()}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-sans text-[14px] text-vapor-200 font-semibold">
              Quilometragem Atual (KM):
            </label>
            <CampoNumerico
              integerOnly
              suffix="km"
              value={km}
              onChange={(val) => setKm(val ? String(val) : '')}
              placeholder="Ex: 45200"
              wrapperClassName="min-h-[56px]"
            />
          </div>
        </Card>
      )}

      {/* PASSO 2: Combustível e Painel */}
      {step === 2 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Fuel size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">2. Combustível e Painel</h3>
              <p className="font-sans text-[12px] text-vapor-400">Selecione o nível no marcador e marque luzes de alerta acesas.</p>
            </div>
          </div>

          {/* Seletor Visual de Combustível em Oitavos (Botões Grandes 56px) */}
          <div className="flex flex-col gap-3">
            <label className="font-sans text-[14px] text-vapor-200 font-semibold flex justify-between">
              <span>Nível de Combustível (em oitavos):</span>
              <span className="font-mono text-amber-400 font-bold">
                {nivelCombustivel === 0 ? 'E (Vazio)' : nivelCombustivel === 8 ? 'F (Cheio)' : `${nivelCombustivel}/8`}
              </span>
            </label>

            <div className="grid grid-cols-3 sm:grid-cols-9 gap-2">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNivelCombustivel(n)}
                  className={`p-2 rounded-lg border font-mono text-[14px] font-bold transition-all min-h-[56px] flex flex-col items-center justify-center ${
                    nivelCombustivel === n
                      ? 'bg-amber-500 text-graphite-950 border-amber-400 shadow-md scale-105'
                      : 'bg-graphite-900 text-vapor-300 border-graphite-700 hover:bg-graphite-700'
                  }`}
                >
                  <span>{n === 0 ? 'E' : n === 8 ? 'F' : `${n}/8`}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Luzes do Painel */}
          <div className="flex flex-col gap-3 pt-2">
            <label className="font-sans text-[14px] text-vapor-200 font-semibold">
              Luzes do Painel Acesas (toque para alternar):
            </label>
            <div className="grid grid-cols-2 gap-2">
              {luzesDisponiveis.map((luz) => {
                const active = luzesPainel.includes(luz);
                return (
                  <button
                    key={luz}
                    type="button"
                    onClick={() => {
                      if (active) setLuzesPainel(luzesPainel.filter((l) => l !== luz));
                      else setLuzesPainel([...luzesPainel, luz]);
                    }}
                    className={`p-3 rounded-lg border font-sans text-[13px] text-left transition-colors min-h-[56px] flex items-center justify-between ${
                      active
                        ? 'bg-flare-500/20 border-flare-400 text-flare-300 font-bold'
                        : 'bg-graphite-900 border-graphite-700 text-vapor-400 hover:bg-graphite-700'
                    }`}
                  >
                    <span>{luz}</span>
                    {active && <span className="w-3 h-3 rounded-full bg-flare-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* PASSO 3: Inspeção Externa e Iluminação */}
      {step === 3 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Lightbulb size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">3. Inspeção Externa e Iluminação</h3>
              <p className="font-sans text-[12px] text-vapor-400">Verifique estepe e status das lâmpadas externas.</p>
            </div>
          </div>

          {/* Estepe */}
          <div className="flex flex-col gap-2">
            <label className="font-sans text-[14px] text-vapor-200 font-semibold">Veículo possui Estepe?</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setEstepe(true)}
                className={`p-3 rounded-lg border font-display text-[14px] uppercase tracking-wide min-h-[56px] ${
                  estepe === true ? 'bg-amber-500 text-graphite-950 font-bold border-amber-400' : 'bg-graphite-900 text-vapor-300 border-graphite-700'
                }`}
              >
                Sim (Possui)
              </button>
              <button
                type="button"
                onClick={() => setEstepe(false)}
                className={`p-3 rounded-lg border font-display text-[14px] uppercase tracking-wide min-h-[56px] ${
                  estepe === false ? 'bg-flare-500 text-white font-bold border-flare-400' : 'bg-graphite-900 text-vapor-300 border-graphite-700'
                }`}
              >
                Não / Ausente
              </button>
            </div>
          </div>

          {/* Tabela de Iluminação */}
          <div className="flex flex-col gap-3">
            <label className="font-sans text-[14px] text-vapor-200 font-semibold">Iluminação Externa:</label>
            <div className="flex flex-col gap-2.5">
              {Object.keys(iluminacao).map((itemKey) => {
                const label = itemKey.replace('_', ' ').toUpperCase();
                const curState = iluminacao[itemKey];

                return (
                  <div key={itemKey} className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-2">
                    <span className="font-sans text-[13px] text-vapor-200 uppercase font-semibold tracking-wide">{label}</span>
                    <div className="grid grid-cols-3 gap-2 w-full">
                      {(['ok', 'queimado', 'nao_testado'] as EstadoIluminacao[]).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setIluminacao({ ...iluminacao, [itemKey]: st })}
                          className={`px-2 py-2 rounded-lg text-[11px] font-mono font-bold uppercase transition-colors min-h-[48px] flex items-center justify-center text-center leading-none ${
                            curState === st
                              ? st === 'queimado'
                                ? 'bg-flare-500 text-white font-bold border border-flare-400 shadow-sm'
                                : 'bg-amber-500 text-graphite-950 font-bold border border-amber-400 shadow-sm'
                              : 'bg-graphite-950 text-vapor-400 border border-graphite-700 hover:bg-graphite-800 hover:text-vapor-200'
                          }`}
                        >
                          {st === 'ok' ? 'OK' : st === 'queimado' ? 'Queimado' : 'N/A'}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* PASSO 4: Diagrama de Avarias (O Coração do Módulo) */}
      {step === 4 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center justify-between border-b border-graphite-700 pb-3">
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">4. Diagrama de Avarias</h3>
              <p className="font-sans text-[12px] text-vapor-400">Toque nas silhuetas para registrar riscos, amassados e faltantes.</p>
            </div>
          </div>

          {checkin && (
            <DiagramaVeiculo
              checkinId={checkin.id}
              avarias={avarias}
              fotos={fotos}
              finalizado={checkin.finalizado}
              onAddAvaria={handleAddAvaria}
              onRemoveAvaria={handleRemoveAvaria}
              onAddFotoAvaria={handleAddFotoAvaria}
            />
          )}
        </Card>
      )}

      {/* PASSO 5: Nível de Sujidade */}
      {step === 5 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Sparkles size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">5. Nível de Sujidade</h3>
              <p className="font-sans text-[12px] text-vapor-400">
                O nível de sujeira embasa eventual ajuste de valor final na conferência.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {Object.keys(sujidade).map((itemKey) => {
              const label = itemKey.replace('_', ' ').toUpperCase();
              const curLevel = sujidade[itemKey];

              return (
                <div key={itemKey} className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-2">
                  <div className="flex items-center justify-between font-sans text-[13px] text-vapor-200 font-semibold">
                    <span>{label}</span>
                    <span className="font-mono text-amber-400 uppercase text-[12px]">{curLevel}</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {(['limpo', 'leve', 'medio', 'sujo', 'extremo'] as NivelSujidade[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setSujidade({ ...sujidade, [itemKey]: lvl })}
                        className={`p-2 rounded text-[11px] font-mono uppercase font-bold transition-colors min-h-[48px] ${
                          curLevel === lvl
                            ? 'bg-amber-500 text-graphite-950 shadow-sm'
                            : 'bg-graphite-950 text-vapor-500 hover:bg-graphite-800'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* PASSO 6: Fluidos (Opcional) */}
      {step === 6 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Droplet size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">6. Verificação de Fluidos</h3>
              <p className="font-sans text-[12px] text-vapor-400">Verificação preventiva de níveis (opcional).</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {Object.keys(fluidos).map((itemKey) => {
              const label = itemKey.toUpperCase();
              const curState = fluidos[itemKey];

              return (
                <div key={itemKey} className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex flex-col gap-2">
                  <span className="font-sans text-[13px] text-vapor-200 font-semibold tracking-wide">{label}</span>
                  <div className="grid grid-cols-4 gap-2 w-full">
                    {(['ok', 'baixo', 'ruim', 'nao_verificado'] as EstadoFluido[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFluidos({ ...fluidos, [itemKey]: st })}
                        className={`px-1.5 py-2 rounded-lg text-[11px] font-mono font-bold uppercase transition-colors min-h-[48px] flex items-center justify-center text-center leading-none ${
                          curState === st
                            ? st === 'baixo' || st === 'ruim'
                              ? 'bg-flare-500 text-white font-bold border border-flare-400 shadow-sm'
                              : 'bg-amber-500 text-graphite-950 font-bold border border-amber-400 shadow-sm'
                            : 'bg-graphite-950 text-vapor-400 border border-graphite-700 hover:bg-graphite-800 hover:text-vapor-200'
                        }`}
                      >
                        {st === 'ok' ? 'OK' : st === 'baixo' ? 'Baixo' : st === 'ruim' ? 'Ruim' : 'N/A'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* PASSO 7: Fotos Gerais e Observações */}
      {step === 7 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <Camera size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">7. Fotos Gerais e Observações</h3>
              <p className="font-sans text-[12px] text-vapor-400">Tire fotos gerais de entrada e anote detalhes livres.</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="font-sans text-[14px] text-vapor-200 font-semibold flex items-center justify-between">
              <span>Fotos de Entrada (Gerais):</span>
              <span className="font-mono text-amber-400 text-[12px]">{fotos.length} foto(s) no total</span>
            </label>

            <label className="p-4 border-2 border-dashed border-graphite-600 hover:border-amber-500 bg-graphite-900 rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors min-h-[80px]">
              <Camera size={28} className="text-amber-500" />
              <span className="font-sans text-[13px] text-vapor-200 font-bold">
                {uploadingFotoGeral ? (uploadProgressText || 'Enviando fotos...') : 'Tirar Fotos com a Câmera'}
              </span>
              <span className="font-sans text-[11px] text-vapor-400">
                Selecione várias fotos (compressão automática)
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handleUploadFotoGeral}
                disabled={uploadingFotoGeral}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <label className="font-sans text-[14px] text-vapor-200 font-semibold">Observações Gerais de Entrada:</label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Ex: Cliente relatou barulho na porta do motorista..."
              rows={4}
              className="appearance-none bg-graphite-700 border border-graphite-600 rounded-lg p-3 text-vapor-100 placeholder-vapor-600 font-sans text-[14px] outline-none focus:border-amber-500 min-h-[100px]"
              style={{ WebkitAppearance: 'none' }}
            />
          </div>
        </Card>
      )}

      {/* PASSO 8: Opções de Assinatura (Presencial vs. Remoto) */}
      {step === 8 && (
        <Card className="p-4 sm:p-6 bg-graphite-800 border-amber-500/30 flex flex-col gap-6 shadow-xl w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-3 border-b border-graphite-700 pb-3">
            <FileSignature size={24} className="text-amber-500 shrink-0" />
            <div>
              <h3 className="font-display text-[18px] text-vapor-100 uppercase">8. Validação e Aceite da Vistoria</h3>
              <p className="font-sans text-[12px] text-vapor-400">Escolha como o cliente irá assinar o termo de vistoria.</p>
            </div>
          </div>

          {/* Seleção do Modo de Assinatura */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setModoAssinatura('presencial')}
              className={`p-4 rounded-xl border-2 flex flex-col gap-1 text-left transition-all min-h-[56px] ${
                modoAssinatura === 'presencial'
                  ? 'bg-amber-500/10 border-amber-500 text-vapor-100'
                  : 'bg-graphite-900 border-graphite-700 text-vapor-400 hover:border-graphite-600'
              }`}
            >
              <strong className="font-sans text-[14px] font-bold flex items-center gap-2">
                📱 Cliente presente — assinar agora
              </strong>
              <span className="font-sans text-[12px] opacity-80">
                Coleta a assinatura digital na própria tela do dispositivo.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setModoAssinatura('remoto')}
              className={`p-4 rounded-xl border-2 flex flex-col gap-1 text-left transition-all min-h-[56px] ${
                modoAssinatura === 'remoto'
                  ? 'bg-amber-500/10 border-amber-500 text-vapor-100'
                  : 'bg-graphite-900 border-graphite-700 text-vapor-400 hover:border-graphite-600'
              }`}
            >
              <strong className="font-sans text-[14px] font-bold flex items-center gap-2">
                💬 Cliente ausente — enviar link para assinar
              </strong>
              <span className="font-sans text-[12px] opacity-80">
                Gera link público e envia no WhatsApp para assinatura à distância.
              </span>
            </button>
          </div>

          {/* FLUXO PRESENCIAL */}
          {modoAssinatura === 'presencial' && (
            <div className="flex flex-col gap-5 pt-2">
              <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-lg text-amber-300 font-sans text-[13px] leading-relaxed italic">
                "Declaro que as informações e avarias registradas acima refletem com precisão o estado do veículo na entrega."
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-sans text-[13px] text-vapor-300 font-medium">Nome do Signatário:</label>
                <input
                  type="text"
                  value={assinaturaNome}
                  onChange={(e) => setAssinaturaNome(e.target.value)}
                  placeholder="Nome completo de quem está assinando"
                  className="appearance-none bg-graphite-700 border border-graphite-600 rounded-lg p-3 text-vapor-100 placeholder-vapor-600 font-sans text-[14px] outline-none focus:border-amber-500 min-h-[50px]"
                  style={{ WebkitAppearance: 'none' }}
                />
              </div>

              <CanvasAssinatura onSaveSignature={handleFinalizarCheckin} disabled={savingStep} />

              <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[12px] flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                <span>
                  <strong>Aviso Importante:</strong> Após a assinatura, a vistoria torna-se imutável e não poderá mais ser alterada.
                </span>
              </div>
            </div>
          )}

          {/* FLUXO REMOTO (WHATSAPP) */}
          {modoAssinatura === 'remoto' && (
            <div className="flex flex-col gap-5 pt-2">
              <div className="p-4 bg-graphite-900 border border-graphite-700 rounded-lg flex flex-col gap-3">
                <span className="font-mono text-[12px] text-amber-400 font-bold uppercase">
                  Instruções para Envio Remoto
                </span>
                <p className="font-sans text-[13px] text-vapor-300 leading-relaxed">
                  Ao clicar abaixo, o sistema irá gerar o link exclusivo de aceite remoto e abrir a conversa no WhatsApp do cliente com a mensagem pronta. A execução do serviço <strong className="text-emerald-400">NÃO será bloqueada</strong>.
                </p>
              </div>

              {linkEnviado ? (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-lg flex flex-col gap-3 text-emerald-300">
                  <div className="flex items-center gap-2 font-bold font-sans text-[14px]">
                    <CheckCircle2 size={18} /> Link Enviado com Sucesso!
                  </div>
                  <p className="font-sans text-[13px] text-vapor-300">
                    A vistoria ficou registrada com o status <strong>"Aguardando Aceite Remoto"</strong>. Você pode prosseguir com a execução do serviço na tela inicial.
                  </p>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleEnviarLinkRemoto}
                      className="min-h-[48px] px-4 font-bold text-[13px] flex items-center gap-2"
                    >
                      <span>Reenviar no WhatsApp</span>
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => navigate('/')}
                      className="min-h-[48px] px-4 font-semibold text-[13px]"
                    >
                      Ir para Tela Inicial (Hoje)
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleEnviarLinkRemoto}
                  disabled={savingStep}
                  className="w-full min-h-[56px] font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg bg-emerald-600 hover:bg-emerald-500 border-emerald-500"
                >
                  <Sparkles size={20} />
                  <span>{savingStep ? 'Gerando Link...' : 'Enviar Link para o Cliente Assinar'}</span>
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Navegação Inferior (Botões de 56px de altura) */}
      <div className="flex items-center justify-between gap-3 pt-2">
        {step > 1 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={prevStep}
            disabled={savingStep}
            className="flex-1 min-h-[56px] font-semibold flex items-center justify-center gap-2"
          >
            <ArrowLeft size={18} />
            <span>Voltar</span>
          </Button>
        ) : (
          <div className="flex-1" />
        )}

        {step < 8 && (
          <Button
            type="button"
            variant="primary"
            onClick={nextStep}
            disabled={savingStep}
            className="flex-1 min-h-[56px] font-semibold flex items-center justify-center gap-2"
          >
            <span>Próximo Passo</span>
            <ArrowRight size={18} />
          </Button>
        )}
      </div>

      {step === 1 && !tenant?.vistoria_obrigatoria && !checkin?.finalizado && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setShowModalPularVistoria(true)}
            className="text-xs text-vapor-400 hover:text-vapor-200 underline text-center py-2 transition-colors"
          >
            Prefere pular? Iniciar atendimento sem a vistoria de entrada
          </button>
        </div>
      )}

      {/* Modal de Confirmação para Iniciar Sem Vistoria */}
      <ModalConfirmarSemVistoria
        isOpen={showModalPularVistoria}
        onClose={() => setShowModalPularVistoria(false)}
        onConfirm={handleConfirmarPularVistoria}
        loading={pularLoading}
      />
    </div>
  );
};
