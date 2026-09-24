import { supabase } from '../lib/supabase';

export interface WhatsAppConfig {
  provider: 'evolution_api' | 'z_api' | 'meta_api';
  api_url: string;
  api_key: string;
  instance_name: string;
  instance_status: 'desconectado' | 'conectando' | 'conectado';
  numero_conectado?: string;
  lembrete_agendamento_ativo: boolean;
  lembrete_agendamento_horas: number;
  lembrete_agendamento_template: string;
  lembrete_vitrificacao_ativo: boolean;
  lembrete_vitrificacao_dias: number;
  lembrete_vitrificacao_template: string;
  lembrete_retorno_inativo_ativo: boolean;
  lembrete_retorno_inativo_dias: number;
  lembrete_retorno_inativo_template: string;
  horario_envio_padrao: string;
}

export interface FilaWhatsAppItem {
  id: string;
  tipo: 'agendamento' | 'vitrificacao_retorno' | 'cliente_inativo' | 'manual';
  destinatario_nome: string;
  destinatario_telefone: string;
  mensagem: string;
  status: 'pendente' | 'enviando' | 'enviado' | 'falha' | 'cancelado';
  agendado_para: string;
  enviado_em?: string;
  erro_mensagem?: string;
  created_at: string;
}

export interface ResumoWhatsApp {
  config: WhatsAppConfig | null;
  total_pendentes: number;
  total_enviados_hoje: number;
  total_falhas_hoje: number;
  mensagens: FilaWhatsAppItem[];
}

/**
 * Carrega a configuração e fila de mensagens da oficina
 */
export async function obterResumoWhatsApp(): Promise<ResumoWhatsApp> {
  const { data, error } = await supabase.rpc('obter_resumo_whatsapp_tenant');
  if (error) throw error;
  return data as ResumoWhatsApp;
}

/**
 * Salva as configurações de WhatsApp da oficina
 */
export async function salvarConfigWhatsApp(config: Partial<WhatsAppConfig>) {
  const { data, error } = await supabase.rpc('salvar_config_whatsapp_tenant', {
    p_config: config
  });
  if (error) throw error;
  return data;
}

/**
 * Dispara varredura automática no banco para popular a fila de mensagens
 */
export async function gerarFilaLembretes() {
  const { data, error } = await supabase.rpc('gerar_fila_lembretes_whatsapp');
  if (error) throw error;
  return data;
}

/**
 * Atualiza o status de uma mensagem na fila
 */
export async function atualizarStatusMensagem(id: string, status: string, erro?: string) {
  const { data, error } = await supabase.rpc('atualizar_status_mensagem_whatsapp', {
    p_id: id,
    p_status: status,
    p_erro: erro || null
  });
  if (error) throw error;
  return data;
}

/**
 * Conecta com a Evolution API na VPS para solicitar QR Code
 */
export async function obterQRCodeEvolution(apiUrl: string, apiKey: string, instanceName: string): Promise<{ qrcode?: string; status: string; numero?: string }> {
  const cleanUrl = apiUrl.replace(/\/+$/, '');
  
  try {
    // 1. Verifica se a instância já existe
    const resState = await fetch(`${cleanUrl}/instance/connectionState/${instanceName}`, {
      headers: {
        'apikey': apiKey
      }
    });

    if (resState.ok) {
      const dataState = await resState.json();
      if (dataState.instance?.state === 'open') {
        return { status: 'conectado', numero: dataState.instance?.ownerJid };
      }
    }

    // 2. Tenta conectar para obter QR code
    const resConnect = await fetch(`${cleanUrl}/instance/connect/${instanceName}`, {
      headers: {
        'apikey': apiKey
      }
    });

    if (resConnect.ok) {
      const connectData = await resConnect.json();
      return {
        qrcode: connectData.base64 || connectData.qrcode?.base64,
        status: 'aguardando_qr'
      };
    }

    // 3. Se a instância não existe, cria ela
    const resCreate = await fetch(`${cleanUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey
      },
      body: JSON.stringify({
        instanceName: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
      })
    });

    if (resCreate.ok) {
      const createData = await resCreate.json();
      return {
        qrcode: createData.qrcode?.base64 || createData.base64,
        status: 'aguardando_qr'
      };
    }

    throw new Error('Falha ao comunicar com a VPS. Verifique a URL e a API Key da Evolution API.');
  } catch (err: any) {
    console.error('[WhatsAppService] Erro ao obter QR Code:', err);
    throw new Error(err.message || 'Erro ao conectar à VPS do WhatsApp.');
  }
}

/**
 * Desconecta a instância da Evolution API
 */
export async function desconectarEvolution(apiUrl: string, apiKey: string, instanceName: string) {
  const cleanUrl = apiUrl.replace(/\/+$/, '');
  try {
    await fetch(`${cleanUrl}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: { 'apikey': apiKey }
    });
  } catch (err) {
    console.warn('[WhatsAppService] Falha ao efetuar logout na VPS:', err);
  }
}

/**
 * Envia uma mensagem individual através da Evolution API
 */
export async function enviarMensagemEvolution(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  destinatario: string,
  texto: string
): Promise<boolean> {
  const cleanUrl = apiUrl.replace(/\/+$/, '');
  const cleanTel = destinatario.replace(/\D/g, '');
  const formattedNumber = cleanTel.startsWith('55') ? cleanTel : `55${cleanTel}`;

  const response = await fetch(`${cleanUrl}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey
    },
    body: JSON.stringify({
      number: formattedNumber,
      options: {
        delay: 1200,
        presence: 'composing'
      },
      textMessage: {
        text: texto
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ${response.status}: ${errorText}`);
  }

  return true;
}
