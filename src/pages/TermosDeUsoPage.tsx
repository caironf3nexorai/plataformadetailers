import React from 'react';
import { PublicLayout } from '../components/layout/PublicLayout';
import { ShieldCheck, FileText, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export const TermosDeUsoPage: React.FC = () => {
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
              <ShieldCheck size={26} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-vapor-100">
                Termos de Uso
              </h1>
              <p className="text-xs sm:text-sm text-vapor-400">
                NuvemWash — Software de Gestão e Operação para Estética Automotiva
              </p>
            </div>
          </div>
          <p className="text-sm text-vapor-300 leading-relaxed mt-4 border-t border-graphite-700 pt-4">
            Bem-vindo à NuvemWash. Ao criar uma conta, assinar nossos planos ou utilizar nosso software, você e sua oficina concordam integralmente com estes Termos de Uso.
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
              A NuvemWash é um software como serviço (<em>SaaS — Software as a Service</em>) voltado à gestão operacional, financeira, agendamentos e emissão de vistorias de estéticas automotivas.
            </p>
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs sm:text-sm">
              <strong>Isenção de Responsabilidade Operacional:</strong> A NuvemWash <strong>não</strong> presta serviços automotivos, mecânicos ou de lavagem e polimento. Toda a responsabilidade técnica, qualidade da execução, garantias e preços cobrados dos proprietários dos veículos são de responsabilidade exclusiva e direta da oficina contratante.
            </div>
          </section>

          {/* Seção 3 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-amber-400">3. Planos, Preços e Cobrança Recorrente</h2>
            <p>
              A plataforma é disponibilizada nos planos <strong>Gratuito (Free)</strong>, <strong>Pro</strong> e <strong>Studio</strong>. Os planos pagos possuem cobrança mensal recorrente e renovação automática a cada 30 dias via PIX, Boleto Bancário ou Cartão de Crédito, processados pelo parceiro homologado Asaas.
            </p>
          </section>

          {/* Seção 4 e 5 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">4. Período de Teste Gratuito (Trial de 14 Dias)</h2>
              <p className="mt-1">
                Novas oficinas têm direito a 14 dias de teste gratuito do Plano Pro, sem exigência de cartão de crédito. Ao término do período, na ausência de contratação de plano pago, a conta migrará automaticamente para o Plano Free, sem perda de dados históricos.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">5. Direito de Arrependimento (CDC)</h2>
              <p className="mt-1">
                Na primeira contratação paga à distância, o assinante tem o prazo legal de <strong>7 (sete) dias corridos</strong> a partir do pagamento para desistir com reembolso integral (Art. 49 do Código de Defesa do Consumidor). O pedido deve ser enviado por e-mail para <code className="text-amber-400 bg-graphite-900 px-1.5 py-0.5 rounded">[contato@plataformadetailers.com.br]</code>.
              </p>
            </div>
          </section>

          {/* Seção 6 e 7 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">6. Inadimplência e Tolerância</h2>
              <p className="mt-1">
                Em caso de não pagamento da fatura na data de vencimento, é concedida tolerância de <strong>5 (cinco) dias corridos</strong>. Após este período, a conta é rebaixada para o Plano Free. <strong>Seus dados e históricos jamais são excluídos</strong> por inadimplência.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">7. Cancelamento</h2>
              <p className="mt-1">
                O cancelamento pode ser efetuado a qualquer momento em <em>Minha Oficina &gt; Assinatura</em>. O plano pago continuará ativo até o encerramento do ciclo mensal já liquidado.
              </p>
            </div>
          </section>

          {/* Seção 8 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-amber-400">8. Retenção de Fotos e Documentos</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                <strong>Fotos de Vistoria (Check-in/Check-out):</strong> Armazenadas por prazo indeterminado como elemento probatório da integridade e avarias do veículo na entrega.
              </li>
              <li>
                <strong>Fotos de Execução de Serviços:</strong> Retidas conforme o plano ativo (30 dias no Free, 90 dias no Pro, 365 dias no Studio) e eliminadas automaticamente após o período.
              </li>
            </ul>
          </section>

          {/* Seção 9 e 10 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">9. Responsabilidade sobre Dados dos Clientes Finais</h2>
              <p className="mt-1">
                A oficina assinante é a legítima controladora dos dados dos seus clientes finais (nome, telefone, placas e assinaturas colhidas) e garante que possui a base legal e o consentimento adequados nos termos da LGPD.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">10. Cláusula de Dados Agregados e Precificação Inteligente</h2>
              <p className="mt-1">
                A plataforma pode utilizar dados operacionais anonimizados e agregados (como médias de tempo e faixas de preços praticadas por categoria e região) para fins estatísticos e para alimentar as estimativas do <strong>Módulo de Precificação Inteligente</strong>, garantindo total sigilo e impossibilidade de identificação de qualquer oficina ou cliente.
              </p>
            </div>
          </section>

          {/* Seção 11 e 12 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">11. Programa de Indicação e Parceiros</h2>
              <p className="mt-1">
                Bônus, comissões e descontos concedidos por indicação de novas oficinas seguem as regras ativas no painel. A plataforma reserva-se o direito de anular pontuações decorrentes de fraudes ou autocadastros.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">12. Nível de Serviço e Disponibilidade</h2>
              <p className="mt-1">
                Empregamos tecnologia de alta disponibilidade na nuvem (Supabase e Vercel) com esforços contínuos de estabilidade, sem garantia de operação 100% ininterrupta livre de manutenções programadas ou fatores externos de telecomunicação.
              </p>
            </div>
          </section>

          {/* Seção 13 e 14 */}
          <section className="bg-graphite-800/50 border border-graphite-700/50 rounded-xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-400">13. Alteração dos Termos</h2>
              <p className="mt-1">
                Alterações nestes termos serão notificadas aos assinantes com antecedência mínima de 15 dias. A continuidade no uso após o prazo configurará o aceite das novas disposições.
              </p>
            </div>
            <div className="border-t border-graphite-700/60 pt-3">
              <h2 className="text-base sm:text-lg font-bold text-amber-400">14. Foro de Eleição</h2>
              <p className="mt-1">
                Fica eleito o Foro da Comarca de <strong>[CIDADE - UF DO FORO]</strong> para dirimir quaisquer dúvidas decorrentes deste contrato.
              </p>
            </div>
          </section>

        </div>

        {/* Rodapé Interno da Página */}
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
