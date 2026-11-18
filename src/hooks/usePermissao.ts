import { useAuth } from '../contexts/AuthContext';
import { podeUsuarioGerenciarDespesas } from '../utils/financeiroUtils';

export const usePermissao = () => {
  const { membership } = useAuth();
  const role = membership?.role;

  const isDono = role === 'dono';
  const isGerente = role === 'gerente';
  const isOperador = role === 'operador';
  const podeGerenciarDespesas = podeUsuarioGerenciarDespesas(role, membership?.pode_gerenciar_despesas);

  return {
    role,
    isDono,
    isGerente,
    isOperador,
    podeGerenciarDespesas,

    podeVerValor: () => isDono || isGerente,
    podeVerCusto: () => isDono || isGerente,
    podeVerFinanceiro: () => isDono || isGerente,
    podeGerirEquipe: () => isDono,
    podeGerirComissao: () => isDono,
    podeGerirEstoque: () => isDono || isGerente,
    podeGerirOrcamento: () => isDono || isGerente,
    podeGerirServicos: () => isDono || isGerente,
    podeExecutarServico: () => true,
    podeRegistrarConsumo: () => true,
  };
};
