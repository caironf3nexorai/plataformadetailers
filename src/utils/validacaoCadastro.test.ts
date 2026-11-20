import { describe, it, expect } from 'vitest';
import {
  validarEmailReal,
  validarWhatsAppBrasileiro,
} from './validacaoCadastro';

describe('Validação de E-mail Anti-Fake', () => {
  it('permite e-mails reais e válidos', () => {
    expect(validarEmailReal('joao.silva@gmail.com').valido).toBe(true);
    expect(validarEmailReal('contato@autodetail.com.br').valido).toBe(true);
    expect(validarEmailReal('maria123@outlook.com').valido).toBe(true);
    expect(validarEmailReal('carlos@uol.com.br').valido).toBe(true);
  });

  it('bloqueia e-mails vazios ou com formato inválido', () => {
    expect(validarEmailReal('').valido).toBe(false);
    expect(validarEmailReal('invalido').valido).toBe(false);
    expect(validarEmailReal('@gmail.com').valido).toBe(false);
  });

  it('bloqueia domínios de e-mails descartáveis ou temporários', () => {
    expect(validarEmailReal('cliente@teste.com').valido).toBe(false);
    expect(validarEmailReal('usuario@test.com').valido).toBe(false);
    expect(validarEmailReal('qualquer@example.com').valido).toBe(false);
    expect(validarEmailReal('conta@mailinator.com').valido).toBe(false);
    expect(validarEmailReal('demo@yopmail.com').valido).toBe(false);
    expect(validarEmailReal('fake@10minutemail.com').valido).toBe(false);
    expect(validarEmailReal('anon@guerrillamail.com').valido).toBe(false);
  });

  it('bloqueia prefixos óbvios de teste antes do @', () => {
    expect(validarEmailReal('teste@gmail.com').valido).toBe(false);
    expect(validarEmailReal('test@hotmail.com').valido).toBe(false);
    expect(validarEmailReal('teste1@gmail.com').valido).toBe(false);
    expect(validarEmailReal('test1234@yahoo.com').valido).toBe(false);
    expect(validarEmailReal('asdf@gmail.com').valido).toBe(false);
    expect(validarEmailReal('aaa@gmail.com').valido).toBe(false);
    expect(validarEmailReal('123@gmail.com').valido).toBe(false);
    expect(validarEmailReal('123456@gmail.com').valido).toBe(false);
    expect(validarEmailReal('fake@gmail.com').valido).toBe(false);
  });
});

describe('Validação de WhatsApp Brasileiro', () => {
  it('permite números de celular brasileiros reais com DDD válido', () => {
    expect(validarWhatsAppBrasileiro('(11) 97123-4589').valido).toBe(true);
    expect(validarWhatsAppBrasileiro('21998877665').valido).toBe(true);
    expect(validarWhatsAppBrasileiro('(47) 99123-4567').valido).toBe(true);
    expect(validarWhatsAppBrasileiro('31 9 9542-8811').valido).toBe(true);
    expect(validarWhatsAppBrasileiro('85981223344').valido).toBe(true);
  });

  it('bloqueia campo vazio', () => {
    const res = validarWhatsAppBrasileiro('');
    expect(res.valido).toBe(false);
    expect(res.erro).toContain('obrigatório');
  });

  it('bloqueia números com menos ou mais de 11 dígitos', () => {
    expect(validarWhatsAppBrasileiro('1198765432').valido).toBe(false); // 10 dígitos (fixo)
    expect(validarWhatsAppBrasileiro('119876543210').valido).toBe(false); // 12 dígitos
    expect(validarWhatsAppBrasileiro('123456').valido).toBe(false);
  });

  it('bloqueia DDDs inválidos no Brasil', () => {
    expect(validarWhatsAppBrasileiro('00987654321').valido).toBe(false);
    expect(validarWhatsAppBrasileiro('23987654321').valido).toBe(false); // 23 não existe
    expect(validarWhatsAppBrasileiro('25987654321').valido).toBe(false); // 25 não existe
    expect(validarWhatsAppBrasileiro('36987654321').valido).toBe(false); // 36 não existe
    expect(validarWhatsAppBrasileiro('52987654321').valido).toBe(false); // 52 não existe
  });

  it('bloqueia número que não inicia com 9 após o DDD', () => {
    expect(validarWhatsAppBrasileiro('1133334444').valido).toBe(false);
    expect(validarWhatsAppBrasileiro('11887654321').valido).toBe(false); // Inicia com 8
  });

  it('bloqueia sequências repetidas e fakes óbvios', () => {
    expect(validarWhatsAppBrasileiro('11999999999').valido).toBe(false);
    expect(validarWhatsAppBrasileiro('11911111111').valido).toBe(false);
    expect(validarWhatsAppBrasileiro('11900000000').valido).toBe(false);
    expect(validarWhatsAppBrasileiro('11988888888').valido).toBe(false);
    expect(validarWhatsAppBrasileiro('11912345678').valido).toBe(false);
    expect(validarWhatsAppBrasileiro('11987654321').valido).toBe(false);
  });
});
