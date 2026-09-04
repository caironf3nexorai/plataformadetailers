import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoNuvemWash } from '../components/ui/LogoNuvemWash';
import { Button } from '../components/ui/Button';
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  XCircle,
  FileCheck,
  Camera,
  Calculator,
  TrendingUp,
  Calendar,
  ShieldCheck,
  ChevronDown,
  Flame,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const faqs = [
    {
      pergunta: 'O NuvemWash precisa ser instalado pelo Google Play ou App Store?',
      resposta:
        'Não! O NuvemWash é um PWA (Progressive Web App) moderno de última geração. Você pode acessar direto pelo navegador de qualquer celular, tablet ou computador e até adicionar o ícone na tela inicial do seu celular com um clique.',
    },
    {
      pergunta: 'Como o cliente assina o orçamento ou vistoria?',
      resposta:
        'Você pode coletar a assinatura do cliente na hora, desenhando na tela do seu celular ou tablet, ou enviar o link da proposta pelo WhatsApp. O cliente abre no próprio celular, escolhe o pacote desejado e assina na tela com o dedo!',
    },
    {
      pergunta: 'Por que a calculadora de diluição é diferente das outras?',
      resposta:
        'A maioria das tabelas de diluição considera apenas a água do copo da Snow Foam. A nossa calculadora calcula a injeção real de água da sua lavadora de alta pressão em duas etapas, mostrando a proporção exata que realmente atinge a pintura do carro.',
    },
    {
      pergunta: 'Posso editar o valor de serviços de acordo com o estado do carro?',
      resposta:
        'Sim! Além do valor padrão do seu catálogo, você pode editar o preço do serviço direto na proposta (ex: um polimento de peça com arranhão severo vs leve), sem precisar cadastrar dezenas de serviços repetidos.',
    },
    {
      pergunta: 'Posso testar gratuitamente antes de contratar?',
      resposta:
        'Sim! Você pode criar sua conta imediatamente e testar os recursos da plataforma na prática para comprovar como ela transforma a rotina do seu negócio.',
    },
  ];

  return (
    <div className="min-h-screen bg-graphite-950 text-vapor-100 font-sans selection:bg-amber-500 selection:text-graphite-950 flex flex-col antialiased">
      {/* ========================================================================= */}
      {/* 1. HEADER NAVEGAÇÃO FLUTUANTE                                             */}
      {/* ========================================================================= */}
      <header className="sticky top-0 z-50 w-full border-b border-graphite-800/80 bg-graphite-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group transition-transform hover:scale-105">
            <LogoNuvemWash size="md" />
          </Link>

          {/* Links Centrais (Desktop) */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-vapor-300">
            <a href="#recursos" className="hover:text-amber-400 transition-colors">
              Recursos
            </a>
            <a href="#comparativo" className="hover:text-amber-400 transition-colors">
              Por que usar?
            </a>
            <Link
              to="/calculadora"
              className="text-amber-400 hover:text-amber-300 flex items-center gap-1.5 transition-colors"
            >
              <Calculator size={15} />
              <span>Calculadora Grátis</span>
            </Link>
            <a href="#faq" className="hover:text-amber-400 transition-colors">
              Dúvidas
            </a>
          </nav>

          {/* Botões de Ação */}
          <div className="flex items-center gap-3">
            <Link to="/entrar">
              <Button
                variant="ghost"
                className="text-sm font-medium text-vapor-200 hover:text-white hover:bg-graphite-800 min-h-[40px] px-4"
              >
                Entrar
              </Button>
            </Link>
            <Link to="/criar-conta">
              <Button
                variant="primary"
                className="text-sm font-semibold min-h-[42px] px-5 shadow-lg shadow-amber-500/20 flex items-center gap-2"
              >
                <span>Criar Conta Grátis</span>
                <ArrowRight size={15} />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. HERO SECTION                                                           */}
      {/* ========================================================================= */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden">
        {/* Glows de Fundo */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 flex flex-col items-center text-center">
          {/* Badge de Autoridade */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-graphite-900 border border-amber-500/40 text-amber-400 text-xs sm:text-sm font-medium shadow-md mb-6 animate-pulse">
            <Sparkles size={15} className="text-amber-400" />
            <span>A Plataforma Especializada para Detailers e Estéticas Automotivas</span>
          </div>

          {/* Headline Principal */}
          <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl font-black uppercase tracking-tight text-vapor-100 max-w-4xl leading-[1.15]">
            Aumente seu faturamento, encante clientes e{' '}
            <span className="bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 bg-clip-text text-transparent">
              elimine o desperdício
            </span>{' '}
            na sua oficina.
          </h1>

          {/* Subtítulo Convincente */}
          <p className="mt-6 text-base sm:text-lg lg:text-xl text-vapor-300 max-w-3xl leading-relaxed font-normal">
            Orçamentos digitais em <strong>3 níveis</strong> com assinatura no celular do cliente, vistoria com fotos que resguarda seu negócio e a única <strong>calculadora de diluição científica</strong> para snow foam.
          </p>

          {/* CTAs do Hero */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
            <Link to="/criar-conta" className="w-full sm:w-auto">
              <Button
                variant="primary"
                className="w-full sm:w-auto min-h-[52px] px-8 text-base font-bold flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 group"
              >
                <span>Começar Gratuitamente</span>
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>

            <Link to="/calculadora" className="w-full sm:w-auto">
              <Button
                variant="secondary"
                className="w-full sm:w-auto min-h-[52px] px-6 text-base font-semibold border-graphite-700 bg-graphite-900/80 hover:bg-graphite-800 text-vapor-200 hover:text-amber-400 flex items-center justify-center gap-2"
              >
                <Calculator size={18} className="text-amber-400" />
                <span>Testar Calculadora de Diluição</span>
              </Button>
            </Link>
          </div>

          {/* Micro-benefícios abaixo do botão */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-vapor-400">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Sem necessidade de cartão para testar</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Funciona em qualquer celular ou PC</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Propostas profissionais em PDF</span>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* PREVIEW VISUAL DO SISTEMA (MOCKUP INTERATIVO)                             */}
          {/* ========================================================================= */}
          <div className="mt-12 sm:mt-16 w-full max-w-5xl rounded-2xl border border-graphite-700/80 bg-graphite-900/90 p-3 sm:p-5 shadow-2xl shadow-black/80 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-graphite-800 pb-3 mb-4 text-xs font-mono text-vapor-400">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 text-vapor-300 font-semibold">nuvemwash.com.br/orcamentos</span>
              </div>
              <span className="hidden sm:inline text-amber-400/90 font-sans">
                ★ Visão da Proposta Comercial em 3 Níveis
              </span>
            </div>

            {/* Simulação Visual dos 3 Níveis de Orçamento */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
              {/* Nível 1: Essencial */}
              <div className="rounded-xl border border-graphite-700 bg-graphite-950 p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono uppercase text-vapor-400">Nível Básico</span>
                  <h4 className="font-display text-lg font-bold text-vapor-100 uppercase mt-0.5">
                    Essencial
                  </h4>
                  <p className="text-xs text-vapor-400 mt-1">Higienização e lavagem técnica de manutenção.</p>
                  <div className="my-4 text-2xl font-bold text-vapor-100">R$ 380,00</div>
                  <ul className="space-y-1.5 text-xs text-vapor-300">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Lavagem detalhada de chassi e caixa</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Descontaminação ferrosa de rodas</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Cera protetiva SiO2 (3 meses)</span>
                    </li>
                  </ul>
                </div>
                <div className="mt-5 pt-3 border-t border-graphite-800 text-[11px] text-vapor-400 text-center">
                  Opção de entrada para fidelização
                </div>
              </div>

              {/* Nível 2: Recomendado (Destaque Dourado) */}
              <div className="rounded-xl border-2 border-amber-500 bg-gradient-to-b from-amber-950/20 to-graphite-950 p-4 flex flex-col justify-between relative shadow-lg shadow-amber-500/10">
                <div className="absolute -top-3 right-4 px-2.5 py-0.5 bg-amber-500 text-graphite-950 rounded-full font-sans font-bold text-[10px] tracking-wider uppercase">
                  ★ Mais Escolhido
                </div>
                <div>
                  <span className="text-[11px] font-mono uppercase text-amber-400 font-bold">
                    Recomendação Técnica
                  </span>
                  <h4 className="font-display text-lg font-bold text-amber-400 uppercase mt-0.5">
                    Recomendado
                  </h4>
                  <p className="text-xs text-vapor-300 mt-1">Correção e proteção duradoura de pintura.</p>
                  <div className="my-4 text-2xl font-extrabold text-amber-400">R$ 890,00</div>
                  <ul className="space-y-1.5 text-xs text-vapor-200">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-amber-400 shrink-0" />
                      <span>Tudo do plano Essencial</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-amber-400 shrink-0" />
                      <span>Polimento técnico comercial em 2 etapas</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-amber-400 shrink-0" />
                      <span>Vitrificação cerâmica de pintura 1 ano</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-amber-400 shrink-0" />
                      <span>Higienização interna completa a vapor</span>
                    </li>
                  </ul>
                </div>
                <div className="mt-5 pt-3 border-t border-amber-500/30 text-[11px] text-amber-300/90 text-center font-semibold">
                  Aumenta o ticket médio em até 40%
                </div>
              </div>

              {/* Nível 3: Completo */}
              <div className="rounded-xl border border-graphite-700 bg-graphite-950 p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono uppercase text-cyan-400">Proteção Máxima</span>
                  <h4 className="font-display text-lg font-bold text-vapor-100 uppercase mt-0.5">
                    Completo
                  </h4>
                  <p className="text-xs text-vapor-400 mt-1">Restauração profunda e revestimento cerâmico 3 anos.</p>
                  <div className="my-4 text-2xl font-bold text-vapor-100">R$ 1.650,00</div>
                  <ul className="space-y-1.5 text-xs text-vapor-300">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Tudo do Recomendado</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Vitrificação de vidros, plásticos e rodas</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Limpeza e hidratação de couro técnica</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Garantia de 36 meses com certificado</span>
                    </li>
                  </ul>
                </div>
                <div className="mt-5 pt-3 border-t border-graphite-800 text-[11px] text-vapor-400 text-center">
                  Para clientes exigentes e entusiastas
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. AS DORES REAIS DA OFICINA (ANTES vs DEPOIS)                           */}
      {/* ========================================================================= */}
      <section id="comparativo" className="py-20 bg-graphite-900/50 border-y border-graphite-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-mono uppercase text-amber-500 font-semibold tracking-wider">
              A Diferença no seu Dia a Dia
            </span>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-vapor-100 uppercase mt-2">
              Você ainda gerencia seu estúdio como no passado?
            </h2>
            <p className="text-sm sm:text-base text-vapor-400 mt-3">
              Descubra por que as estéticas mais lucrativas do Brasil abandonaram anotações soltas e orçamentos no WhatsApp.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Antes: Sem NuvemWash */}
            <div className="bg-graphite-950/80 border border-rose-500/20 rounded-2xl p-6 sm:p-8 flex flex-col gap-5">
              <div className="flex items-center gap-3 text-rose-400">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                  <XCircle size={22} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold uppercase text-vapor-100">
                    Sem o NuvemWash
                  </h3>
                  <span className="text-xs text-vapor-400">Rotina amadora e vulnerável</span>
                </div>
              </div>

              <ul className="space-y-4 text-xs sm:text-sm text-vapor-300">
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Orçamentos amadores no WhatsApp:</strong> O cliente recebe um texto corrido, pede desconto e muitas vezes nem responde mais.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Reclamações injustas de avarias:</strong> Cliente alega que um risco ou quebrado foi feito na sua oficina porque você não tinha fotos registradas.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Desperdício silencioso de produtos:</strong> Funcionários misturam químicos caros "no olho", jogando dinheiro no ralo e arriscando manchar a pintura.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Trabalhar muito e não ver o dinheiro:</strong> Não saber o custo exato da hora técnica da oficina e cobrar preço baseado no concorrente.
                  </span>
                </li>
              </ul>
            </div>

            {/* Depois: Com NuvemWash */}
            <div className="bg-graphite-950/80 border border-amber-500/40 rounded-2xl p-6 sm:p-8 flex flex-col gap-5 shadow-xl shadow-amber-500/5">
              <div className="flex items-center gap-3 text-amber-400">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold uppercase text-amber-400">
                    Com o NuvemWash
                  </h3>
                  <span className="text-xs text-vapor-300">Profissionalismo, lucro e proteção</span>
                </div>
              </div>

              <ul className="space-y-4 text-xs sm:text-sm text-vapor-200">
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Propostas em 3 Níveis com Assinatura Digital:</strong> O cliente vê opções claras e escolhe o pacote intermediário ou completo, pagando mais com satisfação.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Vistoria fotográfica com Acervo Digital:</strong> Registro completo de entrada e saída com fotos em alta resolução. Proteção jurídica total para você.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Calculadora de diluição em duas etapas:</strong> Proporção milimétrica para cada lavadora de alta pressão. Economia média comprovada de até 35% em galões.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Precificação baseada em custos reais:</strong> Calcule o valor da hora e os custos fixos para saber exatamente quanto lucra em cada polimento ou higienização.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. OS 5 PILARES DA PLATAFORMA (SHOWCASE DOS RECURSOS)                     */}
      {/* ========================================================================= */}
      <section id="recursos" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-mono uppercase text-amber-500 font-semibold tracking-wider">
              Tudo em um só lugar
            </span>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-vapor-100 uppercase mt-2">
              Funcionalidades pensadas por quem entende de detalhamento
            </h2>
            <p className="text-sm sm:text-base text-vapor-400 mt-3">
              Não é um sistema genérico de mecânica. É uma plataforma desenhada exclusivamente para estética automotiva, polimento, vitrificação e PPF.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Card 1: Orçamentos em 3 Níveis */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <FileCheck size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  Orçamentos em 3 Níveis & Simples
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Crie propostas personalizadas (Essencial, Recomendado e Completo). O cliente aprova e assina direto no celular. Edite os preços unitários conforme o estado e tamanho do veículo.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-amber-400">
                <span>Assinatura do Cliente + Oficina</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 2: Vistoria Digital com Fotos */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <Camera size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  Check-in e Vistoria com Fotos
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Mapeie riscos, amassados e estado de rodas, pneus e interior. Tire fotos em alta resolução de entrada e saída. Tudo salvo no Acervo Digital com opção de download a qualquer momento.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-cyan-400">
                <span>Acervo Digital Resguardado</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 3: Calculadora de Diluição Científica */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <Calculator size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  Calculadora de Diluição Precisa
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Chega de adivinhar quanto produto colocar no canhão de espuma. Nossa calculadora compensa a vazão da sua lavadora e indica a dosagem em mililitros sem erro.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <span>Manual e Lavadora de Pressão</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 4: Precificação Inteligente */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <TrendingUp size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  Precificação Baseada em Custos
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Descubra o valor real da hora de trabalho da sua equipe, cadastre custos fixos (aluguel, luz) e calcule preços com margem de lucro garantida.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-purple-400">
                <span>Margem de Lucro Real</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 5: Agenda e Atendimentos do Dia */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <Calendar size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  Agenda e Controle Operacional
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Visão diária e mensal com identificação visual dos veículos pela cor e placa. Controle o que está aguardando, em execução ou pronto para entrega.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-amber-400">
                <span>Fluxo de Pátio Descomplicado</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 6: Termos de Garantia Personalizados */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <ShieldCheck size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  Termos de Garantia Customizados
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Anexe termos de garantia específicos (vitrificação, lavagem de motor, polimento) automaticamente na proposta do cliente, evitando desentendimentos futuros.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-blue-400">
                <span>Segurança Contratual</span>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. ISCA: EXPERIMENTE A CALCULADORA AGORA                                  */}
      {/* ========================================================================= */}
      <section className="py-16 bg-gradient-to-r from-amber-500/10 via-graphite-900 to-amber-500/10 border-y border-amber-500/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center gap-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 text-amber-400 rounded-full text-xs font-semibold uppercase tracking-wider">
            <Calculator size={14} />
            <span>Ferramenta Aberta para a Comunidade</span>
          </div>

          <h2 className="font-display text-2xl sm:text-4xl font-bold uppercase text-vapor-100">
            Experimente a Calculadora de Diluição Agora Mesmo
          </h2>

          <p className="text-sm sm:text-base text-vapor-300 max-w-2xl">
            Sem cadastro, sem senha e sem enrolação. Abra agora no seu celular ou envie o link para seus amigos detailers testarem a calibração de snow foam.
          </p>

          <Link to="/calculadora">
            <Button
              variant="primary"
              className="min-h-[48px] px-8 text-sm sm:text-base font-bold flex items-center gap-2 shadow-lg shadow-amber-500/20"
            >
              <span>Abrir Calculadora Gratuita</span>
              <ArrowRight size={16} />
            </Button>
          </Link>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 6. FAQ (PERGUNTAS FREQUENTES)                                             */}
      {/* ========================================================================= */}
      <section id="faq" className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-xs font-mono uppercase text-amber-500 font-semibold tracking-wider">
              Tire suas Dúvidas
            </span>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-vapor-100 uppercase mt-2">
              Perguntas Frequentes
            </h2>
          </div>

          <div className="flex flex-col gap-3">
            {faqs.map((faq, idx) => {
              const isOpen = activeFaq === idx;
              return (
                <div
                  key={idx}
                  className="bg-graphite-900 border border-graphite-800 rounded-xl overflow-hidden transition-colors hover:border-graphite-700"
                >
                  <button
                    type="button"
                    onClick={() => toggleFaq(idx)}
                    className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4 font-semibold text-sm sm:text-base text-vapor-200"
                  >
                    <span>{faq.pergunta}</span>
                    <ChevronDown
                      size={18}
                      className={`shrink-0 text-vapor-400 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-amber-400' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-5 sm:px-5 text-xs sm:text-sm text-vapor-400 leading-relaxed border-t border-graphite-800/60 pt-3">
                      {faq.resposta}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 7. CTA FINAL DE ALTO IMPACTO                                              */}
      {/* ========================================================================= */}
      <section className="py-20 bg-gradient-to-b from-graphite-950 via-graphite-900 to-graphite-950 border-t border-graphite-800 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-amber-500/10 rounded-full blur-[130px] pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10 flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-lg">
            <Flame size={28} />
          </div>

          <h2 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight text-vapor-100 max-w-2xl leading-tight">
            Pronto para profissionalizar sua estética automotiva?
          </h2>

          <p className="text-sm sm:text-base text-vapor-300 max-w-xl">
            Cadastre-se em menos de 1 minuto, crie sua primeira proposta em 3 níveis e veja a reação do seu cliente.
          </p>

          <Link to="/criar-conta">
            <Button
              variant="primary"
              className="min-h-[52px] px-8 text-base font-bold shadow-xl shadow-amber-500/25 flex items-center gap-2 group"
            >
              <span>Criar Minha Conta Grátis Agora</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>

          <span className="text-xs text-vapor-400">
            Acesso imediato • Sem taxa oculta • Suporte dedicado
          </span>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 8. RODAPÉ INSTITUCIONAL                                                   */}
      {/* ========================================================================= */}
      <footer className="border-t border-graphite-800 bg-graphite-950 py-10 px-4 sm:px-8 text-xs text-vapor-400">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <LogoNuvemWash size="sm" />
            <span className="text-vapor-500">
              © {new Date().getFullYear()} NuvemWash. Todos os direitos reservados.
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 font-medium">
            <Link to="/calculadora" className="hover:text-amber-400 transition-colors">
              Calculadora Gratuita
            </Link>
            <Link to="/entrar" className="hover:text-amber-400 transition-colors">
              Acessar Sistema
            </Link>
            <Link to="/termos-de-uso" className="hover:text-amber-400 transition-colors">
              Termos de Uso
            </Link>
            <Link to="/politica-de-privacidade" className="hover:text-amber-400 transition-colors">
              Privacidade
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
