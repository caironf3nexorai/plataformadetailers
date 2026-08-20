import { useAuth } from '../contexts/AuthContext';

export const usePermissao = () => {
  const { membership } = useAuth();
  const role = membership?.role;

  const isDono = role === 'dono';
  const isGerente = role === 'gerente';
  const isOperador = role === 'operador';

  return {
    role,
    isDono,
    isGerente,
    isOperador,

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
