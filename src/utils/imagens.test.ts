import { describe, it, expect } from 'vitest';
import {
  slugifyGrupo,
  validateImageFile,
  fotoDoServico,
  DEFAULT_SERVICE_PLACEHOLDER,
} from './imagens';

describe('imagens.ts utilities', () => {
  describe('slugifyGrupo', () => {
    it('deve converter "Higienização" em "higienizacao"', () => {
      expect(slugifyGrupo('Higienização')).toBe('higienizacao');
    });

    it('deve converter "Polimento / Correção" em "polimento-correcao"', () => {
      expect(slugifyGrupo('Polimento / Correção')).toBe('polimento-correcao');
    });

    it('deve lidar com espaços extras e múltiplos caracteres especiais', () => {
      expect(slugifyGrupo('  Lavagem & Proteção  ')).toBe('lavagem-protecao');
    });

    it('deve retornar string vazia para entrada vazia', () => {
      expect(slugifyGrupo('')).toBe('');
    });
  });

  describe('validateImageFile', () => {
    it('deve aceitar arquivos JPG, PNG e WEBP', () => {
      const fileJpg = new File([''], 'test.jpg', { type: 'image/jpeg' });
      const filePng = new File([''], 'test.png', { type: 'image/png' });
      const fileWebp = new File([''], 'test.webp', { type: 'image/webp' });

      expect(validateImageFile(fileJpg)).toEqual({ valid: true, ext: 'jpg' });
      expect(validateImageFile(filePng)).toEqual({ valid: true, ext: 'png' });
      expect(validateImageFile(fileWebp)).toEqual({ valid: true, ext: 'webp' });
    });

    it('deve rejeitar arquivos PDF e GIF com mensagem em português', () => {
      const filePdf = new File([''], 'doc.pdf', { type: 'application/pdf' });
      const fileGif = new File([''], 'anim.gif', { type: 'image/gif' });

      const resPdf = validateImageFile(filePdf);
      expect(resPdf.valid).toBe(false);
      expect(resPdf.error).toBe('Formato inválido. Envie apenas imagens JPG, PNG ou WEBP.');

      const resGif = validateImageFile(fileGif);
      expect(resGif.valid).toBe(false);
      expect(resGif.error).toBe('Formato inválido. Envie apenas imagens JPG, PNG ou WEBP.');
    });
  });

  describe('fotoDoServico - Resolução em Cascata', () => {
    const grupoFotos = {
      higienizacao: 'tenant123/grupos/higienizacao.png',
    };
    const tenantCapaPath = 'tenant123/oficina/capa.jpg';

    it('deve priorizar a foto própria do serviço', () => {
      const servico = {
        foto_path: 'tenant123/servicos/serv1/capa.jpg',
        grupo: 'Higienização',
      };
      const url = fotoDoServico(servico, grupoFotos, tenantCapaPath);
      expect(url).toContain('tenant123/servicos/serv1/capa.jpg');
    });

    it('deve herdar a foto do grupo se o serviço não tiver foto própria', () => {
      const servico = {
        foto_path: null,
        grupo: 'Higienização',
      };
      const url = fotoDoServico(servico, grupoFotos, tenantCapaPath);
      expect(url).toContain('tenant123/grupos/higienizacao.png');
    });

    it('deve herdar a capa da oficina se o serviço e o grupo não tiverem foto própria', () => {
      const servico = {
        foto_path: null,
        grupo: 'Polimento', // grupo sem foto cadastrada
      };
      const url = fotoDoServico(servico, grupoFotos, tenantCapaPath);
      expect(url).toContain('tenant123/oficina/capa.jpg');
    });

    it('deve retornar o placeholder padrão se não houver foto em nenhum nível', () => {
      const servico = {
        foto_path: null,
        grupo: 'Polimento',
      };
      const url = fotoDoServico(servico, {}, null);
      expect(url).toBe(DEFAULT_SERVICE_PLACEHOLDER);
    });
  });
});
