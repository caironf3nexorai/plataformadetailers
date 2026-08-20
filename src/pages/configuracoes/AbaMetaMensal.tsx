import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { Badge } from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { supabase } from '../../lib/supabase';
import { Target, Save, AlertTriangle, Check } from 'lucide-react';

export const AbaMetaMensal: React.FC = () => {
  const { tenant } = useAuth();
  const { isDono, isGerente } = usePermissao();

  const [mesAno, setMesAno] = useState<string>(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`;
  });
  const [tipoMeta, setTipoMeta] = useState<'faturamento' | 'lucro_liquido' | 'carros'>('faturamento');
  const [valorMeta, setValorMeta] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metaAtual, setMetaAtual] = useState<any | null>(null);

  const carregarMeta = async (mesStr: string) => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const primeiroDia = `${mesStr}-01`;
      const { data, error: fetchErr } = await supabase
        .from('tenant_metas')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('mes', primeiroDia)
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      if (data) {
        setMetaAtual(data);
        setTipoMeta(data.tipo);
        setValorMeta(data.valor);
      } else {
        setMetaAtual(null);
        setValorMeta(0);
      }
    } catch (err: any) {
      console.error('[AbaMetaMensal Error]:', err);
      setError(err.message || 'Erro ao carregar meta mensal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mesAno) {
      carregarMeta(mesAno);
    }
  }, [tenant?.id, mesAno]);

  const handleSalvarMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isDono && !isGerente) {
      setError('Apenas Donos ou Gerentes podem alterar as metas mensais.');
      return;
    }

    if (valorMeta < 0) {
      setError('O valor da meta deve ser maior ou igual a zero.');
      return;
    }

    setSaving(true);
    try {
      const primeiroDia = `${mesAno}-01`;
      const { error: rpcErr } = await supabase.rpc('salvar_tenant_meta', {
        p_mes: primeiroDia,
        p_tipo: tipoMeta,
        p_valor: valorMeta
      });

      if (rpcErr) throw rpcErr;

      setSuccess('Meta mensal salva com sucesso!');
      await carregarMeta(mesAno);
    } catch (err: any) {
      console.error('[Salvar Meta Error]:', err);
      setError(err.message || 'Erro ao salvar meta mensal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 bg-graphite-800 border-graphite-600 flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-500">
          <Target size={24} />
        </div>
        <div className="flex flex-col">
          <h3 className="font-display text-lg text-vapor-100 uppercase tracking-wide">
            Meta Mensal do Estabelecimento
          </h3>
          <p className="font-sans text-xs text-vapor-400">
            Defina o objetivo principal para cada mês. As metas são salvas por mês no histórico.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded-lg text-flare-400 text-xs flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3 bg-mint-500/10 border border-mint-500/30 rounded-lg text-mint-400 text-xs flex items-center gap-2">
          <Check size={16} className="shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSalvarMeta} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Mês de Referência */}
          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-xs text-vapor-300 font-semibold uppercase tracking-wider">
              Mês de Referência
            </label>
            <input
              type="month"
              value={mesAno}
              onChange={(e) => setMesAno(e.target.value)}
              className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-mono text-sm outline-none focus:border-amber-500 min-h-[44px]"
            />
          </div>

          {/* Tipo de Meta */}
          <div className="flex flex-col gap-1.5">
            <label className="font-sans text-xs text-vapor-300 font-semibold uppercase tracking-wider">
              Tipo de Meta
            </label>
            <select
              value={tipoMeta}
              onChange={(e) => setTipoMeta(e.target.value as any)}
              className="bg-graphite-950 border border-graphite-600 rounded-lg p-2.5 text-vapor-100 font-sans text-sm outline-none focus:border-amber-500 min-h-[44px]"
            >
              <option value="faturamento">Faturamento (R$)</option>
              <option value="lucro_liquido">Lucro Líquido (R$)</option>
              <option value="carros">Volume de Veículos (Unidades)</option>
            </select>
          </div>
        </div>

        {/* Valor da Meta */}
        <div className="flex flex-col gap-1.5">
          <label className="font-sans text-xs text-vapor-300 font-semibold uppercase tracking-wider">
            {tipoMeta === 'carros' ? 'Objetivo (Quantidade de Veículos)' : 'Objetivo Financeiro (R$)'}
          </label>
          <CampoNumerico
            value={valorMeta}
            onChange={(val) => setValorMeta(val || 0)}
            prefix={tipoMeta !== 'carros' ? 'R$ ' : undefined}
            placeholder={tipoMeta === 'carros' ? '50' : '50.000,00'}
            integerOnly={tipoMeta === 'carros'}
            wrapperClassName="min-h-[44px]"
          />
        </div>

        {metaAtual && (
          <div className="p-3 bg-graphite-900 rounded-lg border border-graphite-700 flex items-center justify-between">
            <span className="font-sans text-xs text-vapor-300">Meta Cadastrada para este Mês:</span>
            <Badge tone="amber" className="font-mono text-xs text-amber-400">
              {metaAtual.tipo === 'carros'
                ? `${metaAtual.valor} veículos`
                : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(metaAtual.valor)}
            </Badge>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={saving || loading || (!isDono && !isGerente)}
            className="text-xs flex items-center gap-2"
          >
            <Save size={16} />
            <span>{saving ? 'Salvando Meta...' : 'Salvar Meta do Mês'}</span>
          </Button>
        </div>
      </form>
    </Card>
  );
};
