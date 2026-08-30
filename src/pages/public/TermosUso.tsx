import React from 'react';
import { PublicLayout } from '../../components/layout/PublicLayout';
import { FileText, ArrowLeft, Scale, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export const TermosUso: React.FC = () => {
  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto py-4 sm:py-8 px-2 sm:px-4">
        {/* Topo / Voltar */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-vapor-400 hover:text-amber-400 transition-colors"
          >
            <ArrowLeft size={16} /> Voltar ao Início
          </Link>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <FileText size={13} /> Versão v1.0 — Vigência: 29/08/2026
          </span>
        </div>

        {/* Cabeçalho */}
        <div className="bg-graphite-800/80 border border-graphite-700/80 rounded-2xl p-6 sm:p-8 backdrop-blur-md mb-8 shadow-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Scale size={26} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-vapor-100">
                Termos de Uso e Serviço
              </h1>
              <p className="text-xs sm:text-sm text-vapor-400">
                NuvemWash — Contrato de Assinatura e Utilização do Software
              </p>
            </div>
          </div>
          <p className="text-sm text-vapor-300 leading-relaxed mt-4 border-t border-graphite-700 pt-4">
            Bem-vindo à <strong>NuvemWash</strong>. Ao criar uma conta, assinar nossos planos ou utilizar nosso software, você e sua oficina concordam integralmente com os presentes Termos de Uso.
          </p>
        </div>

        {/* Conteúdo Jurídico Estruturado */}
        <div className="space-y-6 text-sm text-vapor-200 leading-relaxed font-sans">
          
          {/* Seção 1 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-amber-400">1. Identificação da Empresa</h2>
            <p>A NuvemWash é operada por:</p>
            <ul className="list-disc list-inside space-y-1 text-vapor-300 font-mono text-xs sm:text-sm pl-1">
              <li><strong>Razão Social:</strong> [RAZÃO SOCIAL DA EMPRESA]</li>
              <li><strong>Nome Fantasia:</strong> NuvemWash</li>
              <li><strong>CNPJ:</strong> [00.000.000/0000-00 - Em emissão]</li>
              <li><strong>Endereço:</strong> [ENDEREÇO COMPLETO DA SEDE, CIDADE - UF, CEP 00000-000]</li>
              <li><strong>E-mail de Contato e Suporte:</strong> [contato@plataformadetailers.com.br]</li>
            </ul>
          </section>

          {/* Seção 2 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-amber-400">2. O que o Serviço é (e o que NÃO é)</h2>
            <p>
              A NuvemWash é uma ferramenta de software na nuvem (<em>SaaS — Software as a Service</em>) desenvolvida exclusivamente para gestão operacional, financeira, orçamentos e agendamentos de oficinas de estética automotiva.
            </p>
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs sm:text-sm space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertCircle size={16} /> Isenção de Responsabilidade Operacional
              </div>
              <p>
                A plataforma <strong>não</strong> presta serviços automotivos nem responde pela execução, qualidade, prazos ou garantias do trabalho realizado pela oficina em veículos de clientes finais.
              </p>
            </div>
          </section>

          {/* Seção 3 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-amber-400">3. Planos, Preços e Cobrança Recorrente</h2>
            <p>
              A plataforma oferece os planos <strong>Gratuito (Free)</strong>, <strong>Pro</strong> e <strong>Studio</strong>. As assinaturas dos planos pagos possuem cobrança mensal recorrente com renovação automática a cada 30 (trinta) dias via PIX, Boleto Bancário ou Cartão de Crédito através do parceiro financeiro Asaas.
            </p>
          </section>

          {/* Seção 4 e 5 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">4. Período de Teste Gratuito (Trial de 14 Dias)</h2>
              <p className="mt-1">
                Novos cadastros têm acesso a 14 (quatorze) dias de avaliação gratuita dos recursos do <strong>Plano Pro</strong> sem necessidade de cartão de crédito. Ao término do período, na ausência de assinatura paga, a conta é mantida no <strong>Plano Gratuito</strong> com todos os dados históricos preservados.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">5. Direito de Arrependimento (CDC)</h2>
              <p className="mt-1">
                Conforme o Artigo 49 do Código de Defesa do Consumidor, na primeira contratação paga à distância o assinante tem <strong>7 (sete) dias corridos</strong> a contar do pagamento para solicitar o cancelamento com reembolso integral (100%) do valor pago. Para exercer esse direito, basta enviar e-mail para <code className="text-amber-400 bg-graphite-900 px-1.5 py-0.5 rounded">[contato@plataformadetailers.com.br]</code> informando o e-mail da conta.
              </p>
            </div>
          </section>

          {/* Seção 6 e 7 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">6. Inadimplência e Tolerância</h2>
              <p className="mt-1">
                Em caso de não compensação da mensalidade no vencimento, concedemos <strong>5 (cinco) dias corridos de tolerância</strong>. Permanecendo a pendência, a oficina é automaticamente rebaixada para o plano Gratuito (Free). <strong>Nenhum dado, cliente ou histórico financeiro é apagado</strong>.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">7. Cancelamento</h2>
              <p className="mt-1">
                O cancelamento pode ser efetuado a qualquer momento em <em>Minha Oficina &gt; Assinatura</em>. Os recursos do plano pago permanecem disponíveis até o término do ciclo mensal já pago.
              </p>
            </div>
          </section>

          {/* Seção 8 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-amber-400">8. Retenção e Expurgo de Fotos e Arquivos</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                <strong>Fotos de Vistoria (Check-in/Check-out):</strong> Mantidas por prazo indeterminado como documento probatório da condição do veículo na entrega à oficina.
              </li>
              <li>
                <strong>Fotos de Execução dos Serviços:</strong> Seguem o prazo do plano ativo (<strong>30 dias</strong> no Free, <strong>90 dias</strong> no Pro e <strong>365 dias</strong> no Studio) e são apagadas automaticamente após o período.
              </li>
            </ul>
          </section>

          {/* Seção 9 e 10 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">9. Responsabilidade sobre Dados dos Clientes Finais</h2>
              <p className="mt-1">
                Os dados de clientes finais, placas, fotos e assinaturas são de responsabilidade exclusiva da oficina assinante, que declara ter obtido o consentimento ou base legal necessária perante a LGPD.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">10. Cláusula de Dados Agregados e Precificação Inteligente</h2>
              <p className="mt-1">
                A plataforma pode utilizar dados operacionais agregados e anonimizados (incluindo tempos de serviço e faixas de preços praticadas por categoria e região) para gerar estatísticas setoriais e alimentar o <strong>Módulo de Precificação Inteligente</strong>, garantindo total anonimato de qualquer oficina.
              </p>
            </div>
          </section>

          {/* Seção 11 e 12 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">11. Programa de Indicação e Parceiros</h2>
              <p className="mt-1">
                Regras de bonificação e descontos por indicação seguem os termos ativos no painel. A plataforma reserva-se o direito de anular pontuações decorrentes de fraudes ou abusos.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">12. Disponibilidade do Sistema</h2>
              <p className="mt-1">
                Empregamos esforços contínuos de estabilidade em nuvem (Supabase e Vercel), sem garantia de funcionamento ininterrupto livre de manutenções programadas ou falhas de terceiros.
              </p>
            </div>
          </section>

          {/* Seção 13 e 14 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">13. Alteração dos Termos</h2>
              <p className="mt-1">
                Atualizações serão notificadas com antecedência mínima de 15 dias no painel ou por e-mail. A continuidade do uso após a vigência constituirá o aceite dos novos termos.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">14. Foro de Eleição</h2>
              <p className="mt-1">
                Fica eleito o Foro da Comarca de <strong>[CIDADE - UF DO FORO]</strong> para dirimir quaisquer controvérsias decorrentes destes Termos de Uso.
              </p>
            </div>
          </section>

        </div>

        {/* Rodapé da Página */}
        <div className="mt-12 pt-6 border-t border-graphite-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-vapor-500 font-sans">
          <span>&copy; {new Date().getFullYear()} NuvemWash. Todos os direitos reservados.</span>
          <div className="flex items-center gap-4">
            <Link to="/politica-de-privacidade" className="text-vapor-400 hover:text-amber-400 transition-colors">
              Política de Privacidade
            </Link>
            <span>•</span>
            <Link to="/entrar" className="text-vapor-400 hover:text-amber-400 transition-colors">
              Área do Assinante
            </Link>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
};
