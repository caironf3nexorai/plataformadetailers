import React from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { NavegacaoFinanceiro } from '../../components/financeiro/NavegacaoFinanceiro';
import { AbaDespesasFixas } from '../configuracoes/AbaDespesasFixas';
import { usePermissao } from '../../hooks/usePermissao';
import { Card } from '../../components/ui/Card';
import { ShieldAlert } from 'lucide-react';

export const DespesasFinanceiro: React.FC = () => {
  const { podeGerenciarDespesas } = usePermissao();

  if (!podeGerenciarDespesas) {
    return (
      <div className="flex flex-col gap-6 pb-12">
        <PageHeader
          title="Contas & Despesas"
        />
        <NavegacaoFinanceiro />
        <Card className="p-8 text-center bg-graphite-900 border-graphite-800 flex flex-col items-center gap-3">
          <ShieldAlert className="text-amber-500 w-12 h-12" />
          <h3 className="font-display text-lg text-vapor-100">Acesso Restrito</h3>
          <p className="text-sm text-vapor-400 max-w-md">
            O acesso às Contas a Pagar e Despesas Fixas é restrito ao proprietário ou a gerentes autorizados em <strong className="text-vapor-200">Minha Oficina &gt; Equipe</strong>.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Contas & Despesas"
      />
      <NavegacaoFinanceiro />
      <AbaDespesasFixas />
    </div>
  );
};
