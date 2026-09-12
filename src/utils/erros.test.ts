import { describe, it, expect } from 'vitest';
import { traduzirErro, ehMensagemEmInglesOuTecnica } from './erros';

describe('Sistema de Tradução de Erros (erros.ts)', () => {
  it('detecta corretamente mensagens em inglês ou termos técnicos', () => {
    expect(ehMensagemEmInglesOuTecnica('column "confirmado_por" does not exist')).toBe(true);
    expect(ehMensagemEmInglesOuTecnica('User already registered')).toBe(true);
    expect(ehMensagemEmInglesOuTecnica('Failed to fetch')).toBe(true);
    expect(ehMensagemEmInglesOuTecnica('violates foreign key constraint')).toBe(true);
    expect(ehMensagemEmInglesOuTecnica('null value in column "nome" violates not-null constraint')).toBe(true);

    // Mensagens em português comuns
    expect(ehMensagemEmInglesOuTecnica('Erro ao salvar os dados do cliente')).toBe(false);
    expect(ehMensagemEmInglesOuTecnica('Preencha os campos obrigatórios')).toBe(false);
    expect(ehMensagemEmInglesOuTecnica('A oficina foi excluída com sucesso')).toBe(false);
  });

  it('traduz erros de coluna inexistente (Postgres 42703)', () => {
    const res = traduzirErro({ code: '42703', message: 'column "confirmado_por" does not exist' });
    expect(res.titulo).toBe('Estrutura do Banco Desatualizada');
    expect(res.mensagem).toBe('A coluna "confirmado_por" não foi encontrada no banco de dados.');
    expect(res.acao).toContain('Execute a migration');
    expect(res.ehInesperado).toBe(true);
  });

  it('traduz erros de tabela inexistente (Postgres 42P01)', () => {
    const res = traduzirErro({ code: '42P01', message: 'relation "oficinas_antigas" does not exist' });
    expect(res.titulo).toBe('Tabela Inexistente');
    expect(res.mensagem).toBe('A tabela "oficinas_antigas" não foi encontrada no banco de dados.');
  });

  it('traduz duplicidade (Postgres 23505)', () => {
    const res = traduzirErro({ code: '23505', message: 'duplicate key value violates unique constraint "servicos_tenant_id_nome_key"' });
    expect(res.titulo).toBe('Serviço já cadastrado');
    expect(res.mensagem).toContain('Já existe um serviço cadastrado com este mesmo nome');
  });

  it('traduz chave estrangeira em uso (Postgres 23503)', () => {
    const res = traduzirErro({ code: '23503', message: 'update or delete on table violates foreign key constraint' });
    expect(res.titulo).toBe('Item em uso');
    expect(res.mensagem).toContain('Não é possível excluir ou alterar este item pois ele está vinculado a outros registros');
  });

  it('traduz campo obrigatório não preenchido (Postgres 23502)', () => {
    const res = traduzirErro({ code: '23502', message: 'null value in column "telefone" of relation "clientes" violates not-null constraint' });
    expect(res.titulo).toBe('Campo obrigatório');
    expect(res.mensagem).toBe('O campo "telefone" é obrigatório e não pode ficar em branco.');
  });

  it('traduz erros do Supabase Auth', () => {
    const errReg = traduzirErro({ message: 'User already registered' });
    expect(errReg.titulo).toBe('E-mail já cadastrado');
    expect(errReg.mensagem).toContain('Este endereço de e-mail já possui cadastro');

    const errLogin = traduzirErro({ message: 'Invalid login credentials' });
    expect(errLogin.titulo).toBe('Credenciais incorretas');
    expect(errLogin.mensagem).toBe('E-mail ou senha incorretos.');

    const errConfirm = traduzirErro({ message: 'Email not confirmed' });
    expect(errConfirm.titulo).toBe('E-mail não confirmado');

    const errPass = traduzirErro({ message: 'Password should be at least 6 characters' });
    expect(errPass.titulo).toBe('Senha muito curta');
  });

  it('traduz erros de conexão de rede', () => {
    const res = traduzirErro(new TypeError('Failed to fetch'));
    expect(res.titulo).toBe('Sem conexão');
    expect(res.mensagem).toContain('Não foi possível conectar ao servidor');
  });
});
