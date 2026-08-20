import React, { useState, useEffect } from 'react';
import { 
  Calendar, CreditCard, Save, Info
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { formatValorMoeda } from '../../utils/precos';
import { CampoNumerico } from '../ui/CampoNumerico';

interface ConfigAgendamento {
  agendamento_online_ativo: boolean;
  agendamento_exige_confirmacao: boolean;
  antecedencia_minima_horas: number;
  sinal_ativo: boolean;
  sinal_tipo: 'percentual' | 'valor_fixo';
  sinal_valor: number;
  sinal_obrigatorio: boolean;
  politica_cancelamento: string;
  pix_chave: string;
  pix_tipo: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';
  pix_nome_beneficiario: string;
  pix_cidade: string;
}

export function AbaAgendamentoOnline() {
  const { tenant } = useAuth();
  const { showToast } = useToast();
  const [carregando, setCarregando] = useState<boolean>(true);
  const [salvando, setSalvando] = useState<boolean>(false);

  const [form, setForm] = useState<ConfigAgendamento>({
    agendamento_online_ativo: true,
    agendamento_exige_confirmacao: false,
    antecedencia_minima_horas: 2,
    sinal_ativo: false,
    sinal_tipo: 'percentual',
    sinal_valor: 25,
    sinal_obrigatorio: false,
    politica_cancelamento: '',
    pix_chave: '',
    pix_tipo: 'cnpj',
    pix_nome_beneficiario: '',
    pix_cidade: ''
  });

  useEffect(() => {
    async function carregarConfiguracoes() {
      if (!tenant) return;
      setCarregando(true);
      try {
        const { data: t, error } = await supabase
          .from('tenants')
          .select(`
            agendamento_online_ativo,
            agendamento_exige_confirmacao,
            antecedencia_minima_horas,
            sinal_ativo,
            sinal_tipo,
            sinal_valor,
            sinal_obrigatorio,
            politica_cancelamento,
            pix_chave,
            pix_tipo,
            pix_nome_beneficiario,
            pix_cidade
          `)
          .eq('id', tenant.id)
          .single();

        if (error) throw error;

        if (t) {
          setForm({
            agendamento_online_ativo: t.agendamento_online_ativo ?? true,
            agendamento_exige_confirmacao: t.agendamento_exige_confirmacao ?? false,
            antecedencia_minima_horas: t.antecedencia_minima_horas ?? 2,
            sinal_ativo: t.sinal_ativo ?? false,
            sinal_tipo: (t.sinal_tipo as any) || 'percentual',
            sinal_valor: t.sinal_valor ?? 25,
            sinal_obrigatorio: t.sinal_obrigatorio ?? false,
            politica_cancelamento: t.politica_cancelamento || '',
            pix_chave: t.pix_chave || '',
            pix_tipo: (t.pix_tipo as any) || 'cnpj',
            pix_nome_beneficiario: t.pix_nome_beneficiario || '',
            pix_cidade: t.pix_cidade || ''
          });
        }
      } catch (err: any) {
        showToast('Erro ao carregar configurações: ' + err.message, 'error');
      } finally {
        setCarregando(false);
      }
    }

    carregarConfiguracoes();
  }, [tenant?.id]);

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) {
      showToast('Sessão expirada ou oficina não identificada.', 'error');
      return;
    }

    // Validação da Chave Pix se sinal ativo
    if (form.sinal_ativo && !form.pix_chave.trim()) {
      showToast('Por favor, informe a Chave Pix da oficina para receber o sinal.', 'error');
      return;
    }

    setSalvando(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          agendamento_online_ativo: form.agendamento_online_ativo,
          agendamento_exige_confirmacao: form.agendamento_exige_confirmacao,
          antecedencia_minima_horas: Number(form.antecedencia_minima_horas),
          sinal_ativo: form.sinal_ativo,
          sinal_tipo: form.sinal_tipo,
          sinal_valor: Number(form.sinal_valor),
          sinal_obrigatorio: form.sinal_obrigatorio,
          politica_cancelamento: form.politica_cancelamento.trim(),
          pix_chave: form.pix_chave.trim(),
          pix_tipo: form.pix_tipo,
          pix_nome_beneficiario: form.pix_nome_beneficiario.trim(),
          pix_cidade: form.pix_cidade.trim()
        })
        .eq('id', tenant.id);

      if (error) throw error;
      showToast('Configurações de agendamento online salvas!', 'success');
    } catch (err: any) {
      showToast('Falha ao salvar: ' + err.message, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const calcularExemploSinal = () => {
    const valorServicoExemplo = 200;
    if (form.sinal_tipo === 'percentual') {
      return (valorServicoExemplo * (form.sinal_valor / 100));
    }
    return Math.min(valorServicoExemplo, form.sinal_valor);
  };

  if (carregando) {
    return (
      <div className="py-12 text-center text-slate-400">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        Carregando parâmetros...
      </div>
    );
  }

  return (
    <form onSubmit={handleSalvar} className="space-y-6 max-w-3xl">
      {/* Bloco 1: Ativação Geral e Confirmação */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" /> Agendamento Online Público
            </h3>
            <p className="text-xs text-slate-400">Permite que seus clientes agendem serviços diretamente no seu catálogo público.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.agendamento_online_ativo}
              onChange={(e) => setForm({ ...form, agendamento_online_ativo: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500" />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl space-y-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.agendamento_exige_confirmacao}
                onChange={(e) => setForm({ ...form, agendamento_exige_confirmacao: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700"
              />
              <span className="text-xs font-semibold text-white">Exigir aprovação manual da oficina</span>
            </label>
            <p className="text-[11px] text-slate-400 pl-6">
              Quando marcado, novos agendamentos entram como "Aguardando Confirmação" na tela Hoje.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 mb-1 block">Antecedência Mínima (Horas)</label>
            <CampoNumerico
              integerOnly
              suffix="h"
              value={form.antecedencia_minima_horas}
              onChange={(val) => setForm({ ...form, antecedencia_minima_horas: Number(val || 0) })}
              wrapperClassName="min-h-[42px]"
            />
          </div>
        </div>
      </div>

      {/* Bloco 2: Sinal de Agendamento e Pix */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-400" /> Sinal Pix Estático
            </h3>
            <p className="text-xs text-slate-400">Solicite um sinal em Pix direto na sua conta bancária sem taxas da plataforma.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={form.sinal_ativo}
              onChange={(e) => setForm({ ...form, sinal_ativo: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500" />
          </label>
        </div>

        {form.sinal_ativo && (
          <div className="space-y-4 pt-2">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-2 text-xs text-emerald-400">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>O valor do sinal vai <strong>diretamente para a conta da sua oficina</strong> via Pix. A plataforma não retém nem cobra nenhuma taxa sobre as transações.</p>
            </div>

            {/* Tipo e Valor do Sinal */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Tipo do Sinal</label>
                <select
                  value={form.sinal_tipo}
                  onChange={(e) => setForm({ ...form, sinal_tipo: e.target.value as any })}
                  className="w-full mt-1 p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none"
                >
                  <option value="percentual">Percentual (%)</option>
                  <option value="valor_fixo">Valor Fixo (R$)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 mb-1 block">
                  {form.sinal_tipo === 'percentual' ? 'Porcentagem (%)' : 'Valor Fixo (R$)'}
                </label>
                <CampoNumerico
                  prefix={form.sinal_tipo === 'valor_fixo' ? 'R$' : undefined}
                  suffix={form.sinal_tipo === 'percentual' ? '%' : undefined}
                  value={form.sinal_valor}
                  onChange={(val) => setForm({ ...form, sinal_valor: Number(val || 0) })}
                  wrapperClassName="min-h-[42px]"
                />
              </div>

              <div className="flex flex-col justify-end">
                <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400">
                  <span>Exemplo em R$ 200,00:</span>
                  <p className="text-emerald-400 font-bold text-sm">R$ {formatValorMoeda(calcularExemploSinal())}</p>
                </div>
              </div>
            </div>

            {/* Sinal Obrigatório */}
            <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sinal_obrigatorio}
                  onChange={(e) => setForm({ ...form, sinal_obrigatorio: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700"
                />
                <span className="text-xs font-semibold text-white">Sinal Obrigatório (Expira em 24h sem pagamento)</span>
              </label>
              <p className="text-[11px] text-slate-400 pl-6 pt-1">
                Enquanto o pagamento não for registrado no painel, o agendamento expira em 24h e libera o horário na agenda.
              </p>
            </div>

            {/* Chave Pix e Dados do Recebedor */}
            <div className="border-t border-slate-800 pt-4 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Dados da Chave Pix da Oficina</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300">Tipo de Chave Pix *</label>
                  <select
                    value={form.pix_tipo}
                    onChange={(e) => setForm({ ...form, pix_tipo: e.target.value as any })}
                    className="w-full mt-1 p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none"
                  >
                    <option value="cnpj">CNPJ</option>
                    <option value="cpf">CPF</option>
                    <option value="email">E-mail</option>
                    <option value="telefone">Telefone</option>
                    <option value="aleatoria">Chave Aleatória (EVP)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">Chave Pix *</label>
                  <input
                    type="text"
                    placeholder="Chave Pix exata da conta"
                    value={form.pix_chave}
                    onChange={(e) => setForm({ ...form, pix_chave: e.target.value })}
                    className="w-full mt-1 p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">Nome do Beneficiário / Titular da Conta</label>
                  <input
                    type="text"
                    placeholder="Ex: AUTO DETAIL LTDA"
                    value={form.pix_nome_beneficiario}
                    onChange={(e) => setForm({ ...form, pix_nome_beneficiario: e.target.value })}
                    className="w-full mt-1 p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">Cidade da Conta Bancária</label>
                  <input
                    type="text"
                    placeholder="Ex: SAO PAULO"
                    value={form.pix_cidade}
                    onChange={(e) => setForm({ ...form, pix_cidade: e.target.value })}
                    className="w-full mt-1 p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none uppercase"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bloco 3: Política de Cancelamento */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
        <h3 className="text-base font-bold text-white">Política de Cancelamento e Avisos</h3>
        <p className="text-xs text-slate-400">Texto informativo exibido ao cliente no resumo final antes da confirmação.</p>
        <textarea
          rows={3}
          placeholder="Ex: Cancelamentos com até 24h de antecedência possuem reembolso integral do sinal. Após este período, o sinal cobre a reserva da vaga."
          value={form.politica_cancelamento}
          onChange={(e) => setForm({ ...form, politica_cancelamento: e.target.value })}
          className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none"
        />
      </div>

      {/* Botão de Salvar */}
      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={salvando}
          className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl flex items-center gap-2 transition"
        >
          {salvando ? (
            <>
              <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Salvar Configurações
            </>
          )}
        </button>
      </div>
    </form>
  );
}
