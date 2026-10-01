import React from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { NavegacaoFinanceiro } from '../../components/financeiro/NavegacaoFinanceiro';
import { AbaDespesasFixas } from '../configuracoes/AbaDespesasFixas';
import { usePermissao } from '../../hooks/usePermissao';
import { Card } from '../../components/ui/Card';
import { ShieldAlert } from 'lucide-react';

export const DespesasFinanceiro: React.FC = () => {
  const { isDono, isGerente } = usePermissao();
  const podeAcessar = isDono || isGerente;

  if (!podeAcessar) {
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
            Apenas proprietários e administradores têm acesso ao gerenciamento de custos, contas a pagar e despesas da oficina.
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
