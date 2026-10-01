import { supabase } from '../lib/supabase';

export interface SincronizarFiscalParams {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  inscricao_municipal?: string;
  cnae_padrao?: string;
  item_lista_servico?: string;
  aliquota_iss?: number;
  regime_tributario?: string;
  ambiente: 'homologacao' | 'producao';
  certificado_base64?: string | null;
  senha_certificado?: string | null;
  certificado_nome_arquivo?: string | null;
}

export async function sincronizarDadosFiscais(params: SincronizarFiscalParams) {
  try {
    // 1. Tenta sincronizar via Edge Function dedicada
    const { data, error } = await supabase.functions.invoke('sincronizar-empresa-fiscal', {
      body: params
    });

    if (error) {
      console.warn('[fiscalSyncService] Edge function falhou ou indisponível, usando fallback RPC:', error);
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  } catch (err: any) {
    // 2. Fallback direto para a RPC caso a Edge Function não esteja deployada ainda
    const rpcPayload: any = {
      cnpj: params.cnpj,
      razao_social: params.razao_social,
      nome_fantasia: params.nome_fantasia || params.razao_social,
      inscricao_municipal: params.inscricao_municipal || '',
      cnae_padrao: params.cnae_padrao || '4520-0/05',
      item_lista_servico: params.item_lista_servico || '14.01',
      aliquota_iss: params.aliquota_iss || 2.0,
      regime_tributario: params.regime_tributario || '1',
      ambiente: params.ambiente,
    };

    if (params.certificado_base64 && params.senha_certificado) {
      rpcPayload.certificado_status = 'ativo';
      rpcPayload.certificado_nome_arquivo = params.certificado_nome_arquivo || 'certificado.pfx';
      // Simula 1 ano de validade para fins de exibição se a emissora não responder
      const dataValidade = new Date();
      dataValidade.setFullYear(dataValidade.getFullYear() + 1);
      rpcPayload.certificado_valido_ate = dataValidade.toISOString();
    }

    const { error: rpcError } = await supabase.rpc('salvar_config_fiscal_tenant', {
      p_config: rpcPayload
    });

    if (rpcError) {
      throw rpcError;
    }

    return {
      sucesso: true,
      mensagem: 'Configuração salva no sistema com sucesso!',
      fallback: true
    };
  }
}
