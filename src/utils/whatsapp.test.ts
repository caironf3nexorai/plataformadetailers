import { describe, it, expect } from 'vitest';
import { 
  formatarTelefoneWhatsapp, 
  montarMensagemAgendamento, 
  montarLinkWhatsapp 
} from './whatsapp';

describe('Utilitários do WhatsApp', () => {
  it('deve formatar telefone no formato brasileiro "(34) 99801-8393"', () => {
    const telefone = '(34) 99801-8393';
    const msg = montarMensagemAgendamento('Polimento Técnico', 'SUV');
    const link = montarLinkWhatsapp(telefone, msg);

    expect(link).toBe('https://wa.me/5534998018393?text=Ol%C3%A1!%20Vi%20o%20cat%C3%A1logo%20e%20quero%20agendar%20Polimento%20T%C3%A9cnico%20para%20meu%20SUV.');
  });

  it('deve retornar null para telefone nulo, vazio ou inválido', () => {
    expect(montarLinkWhatsapp(null, 'Olá')).toBeNull();
    expect(montarLinkWhatsapp('', 'Olá')).toBeNull();
    expect(montarLinkWhatsapp('   ', 'Olá')).toBeNull();
    expect(montarLinkWhatsapp('123', 'Olá')).toBeNull();
  });

  it('deve codificar corretamente acentos e espaços na mensagem', () => {
    const telefone = '34998018393';
    const msg = 'Higienização Interna & Proteção de Bancos';
    const link = montarLinkWhatsapp(telefone, msg);

    expect(link).toBe('https://wa.me/5534998018393?text=Higieniza%C3%A7%C3%A3o%20Interna%20%26%20Prote%C3%A7%C3%A3o%20de%20Bancos');
  });

  it('deve omitir o trecho "para meu {categoria}" quando nenhuma categoria estiver selecionada', () => {
    const msgComCat = montarMensagemAgendamento('Lavagem Detalhada', 'Sedan');
    const msgSemCat = montarMensagemAgendamento('Lavagem Detalhada', null);

    expect(msgComCat).toBe('Olá! Vi o catálogo e quero agendar Lavagem Detalhada para meu Sedan.');
    expect(msgSemCat).toBe('Olá! Vi o catálogo e quero agendar Lavagem Detalhada.');
  });

  it('não deve duplicar o DDI 55 se o telefone já vier com +55 ou 55', () => {
    const telComDdi = '+55 (34) 99801-8393';
    const numFormatado = formatarTelefoneWhatsapp(telComDdi);

    expect(numFormatado).toBe('5534998018393');
  });
});
