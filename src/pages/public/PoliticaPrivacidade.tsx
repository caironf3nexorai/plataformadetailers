import React from 'react';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { Lock, FileCheck, ArrowLeft, Users, Building } from 'lucide-react';
import { Link } from 'react-router-dom';

export const PoliticaPrivacidade: React.FC = () => {
  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto py-4 sm:py-8 px-2 sm:px-4">
        {/* Topo / Voltar */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-vapor-400 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft size={16} /> Voltar ao Início
          </Link>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <FileCheck size={13} /> Versão v1.0 — Vigência: 29/08/2026
          </span>
        </div>

        {/* Cabeçalho */}
        <div className="bg-graphite-800/80 border border-graphite-700/80 rounded-2xl p-6 sm:p-8 backdrop-blur-md mb-8 shadow-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Lock size={26} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-vapor-100">
                Política de Privacidade
              </h1>
              <p className="text-xs sm:text-sm text-vapor-400">
                Conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)
              </p>
            </div>
          </div>
          <p className="text-sm text-vapor-300 leading-relaxed mt-4 border-t border-graphite-700 pt-4">
            Esta Política de Privacidade explica com clareza como a <strong>NuvemWash</strong> trata e protege os dados pessoais da sua oficina e dos seus clientes finais, definindo os papéis legais de cada parte.
          </p>
        </div>

        {/* Conteúdo Jurídico Estruturado */}
        <div className="space-y-6 text-sm text-vapor-200 leading-relaxed font-sans">
          
          {/* Seção 1: Papéis LGPD */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <h2 className="text-base sm:text-lg font-bold text-emerald-400">
              1. Papéis na LGPD: Controladora vs. Operadora
            </h2>
            <p>A legislação brasileira estabelece papéis distintos de acordo com a titularidade do dado:</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="p-4 bg-graphite-900/80 border border-graphite-700 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <Building size={18} /> Assinantes e Equipe da Oficina
                </div>
                <p className="text-xs text-vapor-300 leading-relaxed">
                  Para os dados cadastrais da oficina, logins, faturamento e usuários do sistema, a <strong>NuvemWash atua como Controladora</strong>.
                </p>
              </div>

              <div className="p-4 bg-graphite-900/80 border border-graphite-700 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                  <Users size={18} /> Clientes Finais da Oficina
                </div>
                <p className="text-xs text-vapor-300 leading-relaxed">
                  Para os dados dos clientes da sua oficina (nome, telefone, placas, fotos de vistorias e assinaturas), a <strong>sua oficina é a Controladora</strong> e a <strong>NuvemWash atua estritamente como Operadora</strong>.
                </p>
              </div>
            </div>
          </section>

          {/* Seção 2: Dados Coletados */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-emerald-400">
              2. Dados Coletados e Bases Legais
            </h2>
            <ul className="space-y-3 list-disc list-inside">
              <li>
                <strong>Assinantes:</strong> Nome, e-mail, telefone, senha criptografada, CNPJ/CPF e histórico de pagamentos. <em>Base Legal: Execução de contrato (Art. 7º, V) e Obrigações Fiscais (Art. 7º, II).</em>
              </li>
              <li>
                <strong>Clientes Finais da Oficina:</strong> Nome, telefone, placa e modelo do veículo, fotos de vistoria (check-in/check-out), fotos de etapas de serviço e assinatura digital. <em>Base Legal: Consentimento do titular (Art. 7º, I) e Legítimo Interesse da oficina para execução do serviço (Art. 7º, IX).</em>
              </li>
            </ul>
          </section>

          {/* Seção 3: Compartilhamento */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-emerald-400">
              3. Compartilhamento com Fornecedores e Subprocessadores
            </h2>
            <p>Não vendemos nem comercializamos dados pessoais. Compartilhamos apenas com provedores de infraestrutura essencial:</p>
            <ul className="space-y-2 list-disc list-inside text-vapor-300 text-xs sm:text-sm">
              <li><strong>Supabase Inc.:</strong> Banco de dados PostgreSQL seguro, autenticação e armazenamento de fotos/arquivos.</li>
              <li><strong>Asaas Gestão Financeira S.A.:</strong> Gateway para liquidação de assinaturas e orçamentos via PIX, Cartão e Boleto.</li>
              <li><strong>Vercel Inc.:</strong> Hospedagem web de alta disponibilidade e rede de entrega de conteúdo (CDN).</li>
            </ul>
          </section>

          {/* Seção 4: Onde os dados ficam */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-emerald-400">
              4. Localização dos Servidores e Transferência Internacional
            </h2>
            <p>
              Os dados são armazenados em nuvem segura mantida pela Supabase na região <code className="text-emerald-400 bg-graphite-900 px-1.5 py-0.5 rounded">[REGIÃO DO PROJETO SUPABASE: ex. sa-east-1 (São Paulo, Brasil) ou us-east-1 (Virgínia, EUA)]</code>. Qualquer processamento internacional observa as salvaguardas contratuais e criptográficas do Artigo 33 da LGPD.
            </p>
          </section>

          {/* Seção 5: Retenção */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-emerald-400">
              5. Prazos de Retenção e Expurgo
            </h2>
            <p>
              Fotos de vistoria são mantidas por tempo indeterminado como prova documental do estado do veículo. Fotos de execução seguem o limite do plano ativo (<strong>30 dias</strong> no Free, <strong>90 dias</strong> no Pro, <strong>365 dias</strong> no Studio) e são apagadas de forma automatizada.
            </p>
          </section>

          {/* Seção 6: Direitos do Titular */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-emerald-400">
              6. Direitos do Titular de Dados
            </h2>
            <p>
              Qualquer titular pode solicitar confirmação de existência, acesso, retificação, portabilidade ou exclusão de dados através do e-mail <code className="text-emerald-400 bg-graphite-900 px-1.5 py-0.5 rounded">[privacidade@plataformadetailers.com.br]</code>, atendido no prazo legal de até <strong>15 (quinze) dias úteis</strong>.
            </p>
          </section>

          {/* Seção 7: Segurança */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-emerald-400">
              7. Medidas de Segurança da Informação
            </h2>
            <p>
              Garantimos o isolamento rígido entre oficinas através de Row Level Security (RLS) no PostgreSQL, comunicação criptografada sob HTTPS/TLS 1.3, controle de acesso restrito por papel e armazenamento de fotos em buckets privados com URLs assinadas temporárias.
            </p>
          </section>

          {/* Seção 8 e 9: LocalStorage e DPO */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-emerald-400">8. Armazenamento Local no Navegador</h2>
              <p className="mt-1">
                Utilizamos armazenamento local (<em>localStorage</em>) apenas para manter sua sessão de autenticação ativa e segura. Não rastreamos dados para publicidade externa.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-emerald-400">9. Contato do Encarregado de Dados (DPO)</h2>
              <ul className="mt-1 space-y-1 font-mono text-xs sm:text-sm text-vapor-300">
                <li><strong>Encarregado (DPO):</strong> [NOME DO ENCARREGADO / DPO]</li>
                <li><strong>E-mail:</strong> [dpo@plataformadetailers.com.br] ou [privacidade@plataformadetailers.com.br]</li>
              </ul>
            </div>
          </section>

        </div>

        {/* Rodapé da Página */}
        <div className="mt-12 pt-6 border-t border-graphite-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-vapor-500 font-sans">
          <span>&copy; {new Date().getFullYear()} NuvemWash. Todos os direitos reservados.</span>
          <div className="flex items-center gap-4">
            <Link to="/termos-de-uso" className="text-vapor-400 hover:text-emerald-400 transition-colors">
              Termos de Uso
            </Link>
            <span>•</span>
            <Link to="/entrar" className="text-vapor-400 hover:text-emerald-400 transition-colors">
              Área do Assinante
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};
