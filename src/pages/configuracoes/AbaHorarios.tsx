import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { formatarDataHora } from '../../utils/datas';
import { 
  Clock, 
  Plus, 
  Trash2, 
  Info, 
  CalendarX, 
  CheckCircle2,
  Lock
} from 'lucide-react';
import type { HorarioFuncionamento, BloqueioAgenda } from '../../types/agenda';
import { getNomeDiaSemana } from '../../utils/agenda';
import { ModalConfirmacao } from '../../components/ui/ModalConfirmacao';

export const AbaHorarios: React.FC = () => {
  const { tenant } = useAuth();
  const [gradeMinutos, setGradeMinutos] = useState<number>(60);
  const [antecedenciaHoras, setAntecedenciaHoras] = useState<number>(2);
  const [horarios, setHorarios] = useState<HorarioFuncionamento[]>([]);
  const [bloqueios, setBloqueios] = useState<BloqueioAgenda[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingGrade, setSavingGrade] = useState(false);
  const [savingAntecedencia, setSavingAntecedencia] = useState(false);
  const [savingHorarios, setSavingHorarios] = useState(false);

  // Modal Novo Bloqueio
  const [showNovoBloqueio, setShowNovoBloqueio] = useState(false);
  const [bloqueioInicio, setBloqueioInicio] = useState('');
  const [bloqueioFim, setBloqueioFim] = useState('');
  const [bloqueioMotivo, setBloqueioMotivo] = useState('');
  const [savingBloqueio, setSavingBloqueio] = useState(false);

  // Bloquear dia inteiro
  const [showBloquearDia, setShowBloquearDia] = useState(false);
  const [diaInteiroData, setDiaInteiroData] = useState('');
  const [diaInteiroMotivo, setDiaInteiroMotivo] = useState('Feriado / Folga');

  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Carrega dados iniciais
  const fetchData = async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      // Grade minutos e Antecedência
      const { data: tData } = await supabase
        .from('tenants')
        .select('grade_minutos, antecedencia_minima_horas')
        .eq('id', tenant.id)
        .single();
      if (tData) {
        setGradeMinutos(tData.grade_minutos || 60);
        setAntecedenciaHoras(tData.antecedencia_minima_horas ?? 2);
      }

      // Horários de funcionamento
      const { data: hData } = await supabase
        .from('horarios_funcionamento')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('dia_semana');
      setHorarios(hData || []);

      // Bloqueios futuros
      const { data: bData } = await supabase
        .from('bloqueios_agenda')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('inicio', { ascending: true });
      setBloqueios(bData || []);
    } catch (err: any) {
      console.error('[AbaHorarios] erro:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenant?.id]);

  // Atualizar Intervalo da Grade
  const handleSaveGrade = async (novaGrade: number) => {
    if (!tenant) return;
    setGradeMinutos(novaGrade);
    setSavingGrade(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ grade_minutos: novaGrade })
        .eq('id', tenant.id);
      if (error) throw error;
      setMessage({ text: 'Intervalo da grade atualizado com sucesso!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'Erro ao atualizar grade: ' + err.message, type: 'error' });
    } finally {
      setSavingGrade(false);
    }
  };

  // Atualizar Antecedência Mínima
  const handleSaveAntecedencia = async (novaAntecedencia: number) => {
    if (!tenant) return;
    setAntecedenciaHoras(novaAntecedencia);
    setSavingAntecedencia(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ antecedencia_minima_horas: novaAntecedencia })
        .eq('id', tenant.id);
      if (error) throw error;
      setMessage({ text: 'Antecedência mínima para agendamento online atualizada com sucesso!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'Erro ao atualizar antecedência: ' + err.message, type: 'error' });
    } finally {
      setSavingAntecedencia(false);
    }
  };

  // Alterar campo de um dia
  const handleHorarioChange = (index: number, field: keyof HorarioFuncionamento, value: any) => {
    const updated = [...horarios];
    updated[index] = { ...updated[index], [field]: value };
    setHorarios(updated);
  };

  // Salvar Tabela de Horários
  const handleSaveHorarios = async () => {
    if (!tenant) return;
    setSavingHorarios(true);
    setMessage(null);
    try {
      const updates = horarios.map((h) => ({
        id: h.id,
        tenant_id: tenant.id,
        dia_semana: h.dia_semana,
        abre: h.abre,
        fecha: h.fecha,
        capacidade: Number(h.capacidade) || 1,
        ativo: h.ativo
      }));

      const { error } = await supabase
        .from('horarios_funcionamento')
        .upsert(updates);

      if (error) throw error;
      setMessage({ text: 'Horários de funcionamento salvos com sucesso!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'Erro ao salvar horários: ' + err.message, type: 'error' });
    } finally {
      setSavingHorarios(false);
    }
  };

  // Criar Bloqueio
  const handleCreateBloqueio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !bloqueioInicio || !bloqueioFim || !bloqueioMotivo.trim()) return;

    setSavingBloqueio(true);
    setMessage(null);
    try {
      const inicioTs = bloqueioInicio.includes('-03:00') ? bloqueioInicio : `${bloqueioInicio}-03:00`;
      const fimTs = bloqueioFim.includes('-03:00') ? bloqueioFim : `${bloqueioFim}-03:00`;

      const { error } = await supabase
        .from('bloqueios_agenda')
        .insert({
          tenant_id: tenant.id,
          inicio: inicioTs,
          fim: fimTs,
          motivo: bloqueioMotivo.trim(),
          criado_por: (await supabase.auth.getUser()).data.user?.id
        });

      if (error) throw error;
      setShowNovoBloqueio(false);
      setBloqueioInicio('');
      setBloqueioFim('');
      setBloqueioMotivo('');
      fetchData();
      setMessage({ text: 'Bloqueio criado com sucesso!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'Erro ao criar bloqueio: ' + err.message, type: 'error' });
    } finally {
      setSavingBloqueio(false);
    }
  };

  // Bloquear Dia Inteiro
  const handleBloquearDiaInteiro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant || !diaInteiroData) return;

    const inicioTs = `${diaInteiroData}T00:00:00-03:00`;
    const fimTs = `${diaInteiroData}T23:59:59-03:00`;

    setSavingBloqueio(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from('bloqueios_agenda')
        .insert({
          tenant_id: tenant.id,
          inicio: inicioTs,
          fim: fimTs,
          motivo: diaInteiroMotivo.trim() || 'Feriado / Folga',
          criado_por: (await supabase.auth.getUser()).data.user?.id
        });

      if (error) throw error;
      setShowBloquearDia(false);
      setDiaInteiroData('');
      fetchData();
      setMessage({ text: 'Dia bloqueado com sucesso!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'Erro ao bloquear dia: ' + err.message, type: 'error' });
    } finally {
      setSavingBloqueio(false);
    }
  };

  // Remover Bloqueio
  const [deletingBloqueioId, setDeletingBloqueioId] = useState<string | null>(null);
  const [deletingBloqueio, setDeletingBloqueio] = useState(false);

  const handleConfirmDeleteBloqueio = async () => {
    if (!deletingBloqueioId) return;
    setDeletingBloqueio(true);
    try {
      const { error } = await supabase
        .from('bloqueios_agenda')
        .delete()
        .eq('id', deletingBloqueioId);

      if (error) throw error;
      setDeletingBloqueioId(null);
      fetchData();
      setMessage({ text: 'Bloqueio removido com sucesso!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: 'Erro ao remover bloqueio: ' + err.message, type: 'error' });
    } finally {
      setDeletingBloqueio(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-vapor-400 font-sans text-[13px]">
        Carregando configurações de horários...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {message && (
        <div className={`p-4 rounded-lg font-sans text-[13px] border ${
          message.type === 'success' 
            ? 'bg-mint-500/10 border-mint-500/30 text-mint-400' 
            : 'bg-flare-500/10 border-flare-500/30 text-flare-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Card 1: Intervalo da Grade & Antecedência Mínima */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-[15px] text-vapor-100 font-bold uppercase tracking-wider flex items-center gap-2">
              <Clock size={18} className="text-amber-500" />
              Intervalo da Grade de Horários
            </h3>
            <p className="font-sans text-[13px] text-vapor-400">
              Define de quantos em quantos minutos os horários disponíveis são gerados.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {[15, 30, 60].map((stepVal) => (
              <button
                key={stepVal}
                type="button"
                disabled={savingGrade}
                onClick={() => handleSaveGrade(stepVal)}
                className={`px-4 py-2.5 rounded-lg border font-mono text-[13px] font-bold transition-all min-h-[44px] ${
                  gradeMinutos === stepVal
                    ? 'bg-amber-500 text-graphite-950 border-amber-400 shadow-md'
                    : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                }`}
              >
                {stepVal} Minutos
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-[15px] text-vapor-100 font-bold uppercase tracking-wider flex items-center gap-2">
              <Clock size={18} className="text-amber-500" />
              Antecedência Mínima (Agendamento Online)
            </h3>
            <p className="font-sans text-[13px] text-vapor-400">
              Tempo mínimo de antecedência necessário para que um cliente escolha um horário.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {[1, 2, 4, 12, 24].map((hrs) => (
              <button
                key={hrs}
                type="button"
                disabled={savingAntecedencia}
                onClick={() => handleSaveAntecedencia(hrs)}
                className={`px-3.5 py-2.5 rounded-lg border font-mono text-[13px] font-bold transition-all min-h-[44px] ${
                  antecedenciaHoras === hrs
                    ? 'bg-amber-500 text-graphite-950 border-amber-400 shadow-md'
                    : 'bg-graphite-800 hover:bg-graphite-700 border-graphite-700 text-vapor-300'
                }`}
              >
                {hrs}h
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Card 2: Horários de Funcionamento & Capacidade de Boxes */}
      <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-[15px] text-vapor-100 font-bold uppercase tracking-wider flex items-center gap-2">
            <Clock size={18} className="text-amber-500" />
            Horários por Dia da Semana e Capacidade de Boxes
          </h3>
          <p className="font-sans text-[13px] text-vapor-400">
            Configure quais dias a oficina abre, o expediente de atendimento e quantos carros cabem simultaneamente.
          </p>
        </div>

        {/* Texto Explicativo Obrigatório de Apoio à UX */}
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
          <Info size={20} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="font-sans text-[12px] text-amber-300 leading-relaxed">
            <strong>O que é capacidade?</strong> Quantos veículos você atende ao mesmo tempo. Conte boxes físicos, não funcionários — duas pessoas trabalhando no mesmo carro reduzem a duração do serviço, não aumentam a capacidade da oficina.
          </p>
        </div>

        {/* Tabela dos 7 Dias */}
        <div className="flex flex-col gap-3">
          {horarios.map((h, idx) => (
            <div
              key={h.id || h.dia_semana}
              className={`p-3.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                h.ativo ? 'bg-graphite-800 border-graphite-700' : 'bg-graphite-950/60 border-graphite-800 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3 min-w-[150px]">
                <input
                  type="checkbox"
                  checked={h.ativo}
                  onChange={(e) => handleHorarioChange(idx, 'ativo', e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer min-h-[24px] min-w-[24px]"
                />
                <span className="font-sans text-[14px] font-semibold text-vapor-100">
                  {getNomeDiaSemana(h.dia_semana)}
                </span>
              </div>

              {h.ativo ? (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="font-sans text-[12px] text-vapor-400">Abre:</span>
                    <input
                      type="time"
                      value={h.abre?.substring(0, 5) || '08:00'}
                      onChange={(e) => handleHorarioChange(idx, 'abre', e.target.value)}
                      className="bg-graphite-900 border border-graphite-700 rounded px-2.5 py-1 font-mono text-[13px] text-vapor-100 outline-none focus:border-amber-500 min-h-[38px]"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="font-sans text-[12px] text-vapor-400">Fecha:</span>
                    <input
                      type="time"
                      value={h.fecha?.substring(0, 5) || '18:00'}
                      onChange={(e) => handleHorarioChange(idx, 'fecha', e.target.value)}
                      className="bg-graphite-900 border border-graphite-700 rounded px-2.5 py-1 font-mono text-[13px] text-vapor-100 outline-none focus:border-amber-500 min-h-[38px]"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="font-sans text-[12px] text-vapor-400">Boxes:</span>
                    <CampoNumerico
                      integerOnly
                      value={h.capacidade}
                      onChange={(val) => handleHorarioChange(idx, 'capacidade', val || 1)}
                      align="center"
                      placeholder="1"
                      wrapperClassName="w-16 min-h-[38px]"
                    />
                  </div>
                </div>
              ) : (
                <span className="font-sans text-[12px] text-flare-400 font-medium italic">
                  Oficina fechada
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            disabled={savingHorarios}
            onClick={handleSaveHorarios}
            className="flex items-center gap-2 font-bold bg-amber-500 text-graphite-950 hover:bg-amber-400"
          >
            <CheckCircle2 size={16} />
            <span>{savingHorarios ? 'Salvando...' : 'Salvar Horários de Funcionamento'}</span>
          </Button>
        </div>
      </Card>

      {/* Card 3: Bloqueios de Agenda (Feriados, Folgas, Manutenção) */}
      <Card className="p-6 bg-graphite-900 border-graphite-800 flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-[15px] text-vapor-100 font-bold uppercase tracking-wider flex items-center gap-2">
              <CalendarX size={18} className="text-amber-500" />
              Bloqueios de Agenda (Feriados, Almoço, Manutenção)
            </h3>
            <p className="font-sans text-[13px] text-vapor-400">
              Impeça novos agendamentos em horários ou dias específicos.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowBloquearDia(!showBloquearDia)}
              className="flex items-center gap-1.5 text-[12px]"
            >
              <Lock size={14} />
              <span>Bloquear Dia Inteiro</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowNovoBloqueio(!showNovoBloqueio)}
              className="flex items-center gap-1.5 text-[12px]"
            >
              <Plus size={14} />
              <span>Bloquear Horário</span>
            </Button>
          </div>
        </div>

        {/* Modal Inline: Bloquear Dia Inteiro */}
        {showBloquearDia && (
          <form onSubmit={handleBloquearDiaInteiro} className="p-4 bg-graphite-800 rounded-lg border border-amber-500/40 flex flex-col gap-3">
            <span className="font-display text-[13px] text-amber-400 font-bold uppercase tracking-wider">
              Bloquear Dia Inteiro (Feriado ou Folga)
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-mono text-[11px] text-vapor-400">Data *</label>
                <input
                  type="date"
                  required
                  value={diaInteiroData}
                  onChange={(e) => setDiaInteiroData(e.target.value)}
                  className="bg-graphite-900 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-mono text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono text-[11px] text-vapor-400">Motivo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Feriado Nacional, Treinamento..."
                  value={diaInteiroMotivo}
                  onChange={(e) => setDiaInteiroMotivo(e.target.value)}
                  className="bg-graphite-900 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowBloquearDia(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={savingBloqueio}>
                {savingBloqueio ? 'Salvando...' : 'Confirmar Bloqueio do Dia'}
              </Button>
            </div>
          </form>
        )}

        {/* Modal Inline: Bloquear Horário Específico */}
        {showNovoBloqueio && (
          <form onSubmit={handleCreateBloqueio} className="p-4 bg-graphite-800 rounded-lg border border-amber-500/40 flex flex-col gap-3">
            <span className="font-display text-[13px] text-amber-400 font-bold uppercase tracking-wider">
              Criar Bloqueio de Horário
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-mono text-[11px] text-vapor-400">Início *</label>
                <input
                  type="datetime-local"
                  required
                  value={bloqueioInicio}
                  onChange={(e) => setBloqueioInicio(e.target.value)}
                  className="bg-graphite-900 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-mono text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono text-[11px] text-vapor-400">Fim *</label>
                <input
                  type="datetime-local"
                  required
                  value={bloqueioFim}
                  onChange={(e) => setBloqueioFim(e.target.value)}
                  className="bg-graphite-900 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-mono text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                />
              </div>

              <div className="flex flex-col gap-1 sm:col-span-1">
                <label className="font-mono text-[11px] text-vapor-400">Motivo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Almoço da equipe"
                  value={bloqueioMotivo}
                  onChange={(e) => setBloqueioMotivo(e.target.value)}
                  className="bg-graphite-900 border border-graphite-700 rounded px-3 py-2 text-vapor-100 font-sans text-[13px] outline-none focus:border-amber-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowNovoBloqueio(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={savingBloqueio}>
                {savingBloqueio ? 'Salvando...' : 'Salvar Bloqueio'}
              </Button>
            </div>
          </form>
        )}

        {/* Lista de Bloqueios */}
        <div className="flex flex-col gap-2">
          {bloqueios.length === 0 ? (
            <span className="text-[13px] text-vapor-500 text-center py-4">
              Nenhum bloqueio de agenda cadastrado.
            </span>
          ) : (
            bloqueios.map((b) => (
              <div
                key={b.id}
                className="p-3 bg-graphite-800 rounded-lg border border-graphite-700 flex items-center justify-between gap-4"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-sans text-[13px] font-semibold text-vapor-100">
                    {b.motivo}
                  </span>
                  <span className="font-mono text-[11px] text-amber-400">
                    {formatarDataHora(b.inicio)} até {formatarDataHora(b.fim)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setDeletingBloqueioId(b.id)}
                  className="p-2 text-flare-400 hover:text-flare-300 hover:bg-flare-500/10 rounded transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Modal de Confirmação para Remover Bloqueio */}
      <ModalConfirmacao
        isOpen={!!deletingBloqueioId}
        onClose={() => setDeletingBloqueioId(null)}
        onConfirm={handleConfirmDeleteBloqueio}
        title="Remover Bloqueio de Agenda"
        mensagem="Deseja realmente remover este bloqueio de agenda? O horário voltará a ficar disponível."
        textoConfirmar="Remover Bloqueio"
        textoCancelar="Voltar"
        variant="danger"
        loading={deletingBloqueio}
      />
    </div>
  );
};
