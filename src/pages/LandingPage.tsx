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
  DollarSign,
  GraduationCap,
  Clock,
  AlertTriangle,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const [activeFaq, setActiveFaq] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const faqs = [
    {
      pergunta:
        'Trabalho sozinho na garagem/box e não tenho tempo para mexer em sistema. Serve para mim?',
      resposta:
        'Com certeza! A sua conta já entra pré-configurada com os serviços padrão da estética automotiva, preços médios sugeridos por porte de veículo (Hatch, Sedan, SUV, Esportivo e Moto) e 27 termos jurídicos prontos. Além disso, o guia inicial já traz a opção "Trabalho sozinho" e você monta um orçamento profissional pelo celular em cerca de 30 segundos.',
    },
    {
      pergunta:
        'Eu não sei calcular meus custos nem precificar direito. O sistema ajuda nisso?',
      resposta:
        'Sim! O NuvemWash calcula automaticamente o custo real da sua hora técnica, despesas fixas do box e consumo de químicos diluídos para revelar a margem de lucro limpa de cada serviço. E você ainda ganha acesso às Aulas Práticas de Gestão e Precificação dentro da plataforma, direto ao ponto para parar de cobrar barato.',
    },
    {
      pergunta:
        'Vou ter que cadastrar todos os meus serviços e preços do zero quando entrar?',
      resposta:
        'Não! Assim que você cria sua conta, a oficina já nasce pronta com o catálogo inicial carregado, tabela média de referência para testar na hora e horários padrão preenchidos. Você já consegue simular seu 1º orçamento no primeiro minuto e depois ajusta os preços da sua região com calma, passo a passo.',
    },
    {
      pergunta:
        'Como funciona a assinatura do cliente no orçamento e no termo de garantia?',
      resposta:
        'Você envia o link da proposta direto no WhatsApp do cliente (ou mostra na sua tela na oficina). Ele compara as opções dos 3 níveis (Essencial, Recomendado ou Completo), escolhe o pacote desejado e assina com o próprio dedo na tela do celular, deixando o orçamento e os termos CDC registrados.',
    },
    {
      pergunta:
        'Preciso instalar aplicativo pesado no celular ou ter computador?',
      resposta:
        'Não precisa baixar nada pesado nem depender de computador! O NuvemWash abre direto no navegador de qualquer celular (iPhone ou Android), tablet ou notebook. Se quiser mais praticidade, você fixa o ícone na tela inicial do celular em segundos e abre com um toque.',
    },
    {
      pergunta: 'Preciso cadastrar cartão de crédito para testar?',
      resposta:
        'Zero cartão de crédito para começar. Você cria sua conta grátis, simula seu 1º orçamento, confere os 27 termos prontos, testa a calculadora de diluição e enxerga o painel inteiro por dentro antes de decidir qualquer plano.',
    },
  ];

  return (
    <div className="min-h-screen bg-graphite-950 text-vapor-100 font-sans selection:bg-amber-500 selection:text-graphite-950 flex flex-col antialiased overflow-x-hidden w-full max-w-full">
      {/* ========================================================================= */}
      {/* 1. HEADER NAVEGAÇÃO FLUTUANTE                                             */}
      {/* ========================================================================= */}
      <header
        className="sticky top-0 z-50 w-full border-b border-graphite-800/80 bg-graphite-950/80 backdrop-blur-xl"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-[52px] sm:min-h-[80px] h-13 sm:h-20 flex items-center justify-between gap-2 sm:gap-4 w-full">
          <Link
            to="/"
            className="flex items-center gap-1.5 group transition-transform hover:scale-105 shrink-0"
          >
            <LogoNuvemWash size="xs" className="sm:hidden" />
            <LogoNuvemWash size="md" className="hidden sm:block" />
          </Link>

          {/* Links Centrais (Desktop) */}
          <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm font-medium text-vapor-300">
            <a href="#lucro-real" className="hover:text-amber-400 transition-colors whitespace-nowrap">
              Raio-X do Lucro
            </a>
            <a href="#comparativo" className="hover:text-amber-400 transition-colors whitespace-nowrap">
              Antes vs. Depois
            </a>
            <a href="#recursos" className="hover:text-amber-400 transition-colors whitespace-nowrap">
              O Ecossistema
            </a>
            <a href="#faq" className="hover:text-amber-400 transition-colors whitespace-nowrap">
              Dúvidas
            </a>
          </nav>

          {/* Botões de Ação */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <Link to="/entrar">
              <Button
                variant="ghost"
                className="text-xs sm:text-sm font-medium text-vapor-200 hover:text-white hover:bg-graphite-800 min-h-[32px] sm:min-h-[40px] px-2 sm:px-4"
              >
                Entrar
              </Button>
            </Link>
            <Link to="/criar-conta">
              <Button
                variant="primary"
                className="text-xs sm:text-sm font-semibold min-h-[32px] sm:min-h-[42px] px-2.5 sm:px-5 shadow-lg shadow-amber-500/20 flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0"
              >
                <span className="sm:hidden">Testar Grátis</span>
                <span className="hidden sm:inline">Testar Grátis Agora</span>
                <ArrowRight size={12} className="shrink-0" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. HERO SECTION (DOBRA 1 — LUCRO REAL E ZERO CONFIGURAÇÃO INICIAL)        */}
      {/* ========================================================================= */}
      <section className="relative pt-10 pb-16 sm:pt-14 sm:pb-20 md:pt-20 md:pb-28 overflow-hidden">
        {/* Glows de Fundo */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 flex flex-col items-center text-center">
          {/* Badge de Autoridade */}
          <div className="inline-flex items-center justify-center gap-2 px-3.5 sm:px-4 py-1.5 rounded-full bg-graphite-900 border border-amber-500/40 text-amber-400 text-[11px] sm:text-sm font-medium shadow-md mb-6 max-w-full">
            <Sparkles size={15} className="text-amber-400 shrink-0 animate-pulse" />
            <span>
              Gestão de Lucro, Blindagem Jurídica e Ensino para Estéticas Automotivas
            </span>
          </div>

          {/* Headline Principal: Opção 2 (2 linhas limpas e proporcionais) */}
          <h1 className="font-display text-2xl sm:text-4xl lg:text-[42px] font-black uppercase tracking-tight text-vapor-100 max-w-4xl leading-[1.2]">
            Pátio cheio não é lucro.{' '}
            <br className="hidden sm:inline" />
            Saiba{' '}
            <span className="bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 bg-clip-text text-transparent">
              quanto sobra no seu bolso
            </span>{' '}
            por carro.
          </h1>

          {/* Sub-headline: Opção B (Curta, Rápida e Executiva) */}
          <p className="mt-5 text-sm sm:text-base lg:text-lg text-vapor-300 max-w-2xl leading-relaxed font-normal">
            Calcule o custo real e o lucro limpo de cada lavagem ou polimento, feche orçamentos até{' '}
            <strong className="text-vapor-100">40% maiores</strong> em 3 níveis e proteja sua oficina com{' '}
            <strong className="text-vapor-100">vistoria fotográfica e 27 termos jurídicos</strong>.
          </p>

          {/* CTA Único Focado em Cadastro + Simulação Imediata */}
          <div className="mt-8 flex items-center justify-center w-full sm:w-auto">
            <Link to="/criar-conta" className="w-full sm:w-auto max-w-md sm:max-w-none">
              <Button
                variant="primary"
                className="w-full sm:w-auto min-h-[54px] px-5 sm:px-9 text-sm sm:text-base font-bold flex items-center justify-center gap-2.5 shadow-xl shadow-amber-500/25 group"
              >
                <span>Criar Conta Grátis e Simular 1º Orçamento</span>
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform shrink-0" />
              </Button>
            </Link>
          </div>

          {/* 3 Micro-benefícios abaixo do botão */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4 sm:gap-7 text-xs text-vapor-300">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>Já vem com serviços e preços médios pré-carregados</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>Sem cartão de crédito para testar</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <span>Inclui Aulas de Precificação e Gestão</span>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* PREVIEW VISUAL DO SISTEMA (MOCKUP 3 NÍVEIS COM RAIO-X DE LUCRO)           */}
          {/* ========================================================================= */}
          <div className="mt-12 sm:mt-16 w-full max-w-5xl rounded-2xl border border-graphite-700/80 bg-graphite-900/90 p-3 sm:p-5 shadow-2xl shadow-black/80 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-graphite-800 pb-3 mb-5 text-xs font-mono text-vapor-400 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-3 h-3 rounded-full bg-rose-500/80 shrink-0" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80 shrink-0" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80 shrink-0" />
                <span className="ml-1.5 text-vapor-300 font-semibold truncate">
                  nuvemwash.com.br/orcamentos
                </span>
              </div>
              <span className="hidden sm:inline text-amber-400/95 font-sans font-medium shrink-0">
                ★ Faz o cliente escolher o pacote intermediário ou completo sozinho
              </span>
            </div>

            {/* Simulação Visual dos 3 Níveis de Orçamento */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-4 text-left">
              {/* Nível 1: Essencial */}
              <div className="rounded-xl border border-graphite-700 bg-graphite-950 p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono uppercase text-vapor-400">
                    Nível Básico
                  </span>
                  <h4 className="font-display text-lg font-bold text-vapor-100 uppercase mt-0.5">
                    Essencial
                  </h4>
                  <p className="text-xs text-vapor-400 mt-1">
                    Lavagem técnica detalhada de manutenção.
                  </p>
                  <div className="my-4 text-2xl font-bold text-vapor-100 font-mono">
                    R$ 150,00
                  </div>
                  <ul className="space-y-1.5 text-xs text-vapor-300">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Pré-lavagem em snow foam pH neutro</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Detalhamento de rodas, pneus e emblemas</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      <span>Selante rápido de brilho e proteção UV</span>
                    </li>
                  </ul>
                </div>
                <div className="mt-5 pt-3 border-t border-graphite-800 text-[11px] font-semibold text-emerald-400 text-center">
                  Custo total: R$ 25 • Lucro Limpo: R$ 125 (em 2h)
                </div>
              </div>

              {/* Nível 2: Recomendado (Destaque Amber) */}
              <div className="rounded-xl border-2 border-amber-500 bg-gradient-to-b from-amber-950/20 to-graphite-950 p-4 flex flex-col justify-between relative shadow-lg shadow-amber-500/10">
                <div className="absolute -top-3 right-4 px-2.5 py-0.5 bg-amber-500 text-graphite-950 rounded-full font-sans font-bold text-[10px] tracking-wide uppercase whitespace-nowrap shadow">
                  ★ 70% dos Clientes Escolhem Este
                </div>
                <div className="pt-1">
                  <span className="text-[11px] font-mono uppercase text-amber-400 font-bold">
                    Recomendação Técnica
                  </span>
                  <h4 className="font-display text-lg font-bold text-amber-400 uppercase mt-0.5">
                    Recomendado
                  </h4>
                  <p className="text-xs text-vapor-300 mt-1">
                    Correção e proteção duradoura de pintura.
                  </p>
                  <div className="my-4 text-2xl font-extrabold text-amber-400 font-mono">
                    R$ 890,00
                  </div>
                  <ul className="space-y-1.5 text-xs text-vapor-200">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} className="text-amber-400 shrink-0" />
                      <span>Tudo do pacote Essencial</span>
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
                <div className="mt-5 pt-3 border-t border-amber-500/30 text-[11px] text-amber-300 text-center font-semibold">
                  Custo total: R$ 160 • Lucro Limpo: R$ 730
                </div>
              </div>

              {/* Nível 3: Completo */}
              <div className="rounded-xl border border-graphite-700 bg-graphite-950 p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono uppercase text-cyan-400">
                    Proteção Máxima
                  </span>
                  <h4 className="font-display text-lg font-bold text-vapor-100 uppercase mt-0.5">
                    Completo
                  </h4>
                  <p className="text-xs text-vapor-400 mt-1">
                    Restauração profunda e revestimento cerâmico 3 anos.
                  </p>
                  <div className="my-4 text-2xl font-bold text-vapor-100 font-mono">
                    R$ 1.650,00
                  </div>
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
                <div className="mt-5 pt-3 border-t border-graphite-800 text-[11px] text-vapor-300 text-center font-medium">
                  Ancora o preço para o Recomendado parecer barato
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 3. NOVA SEÇÃO: A MATEMÁTICA REAL DO BOX (RAIO-X DO LUCRO REAL)            */}
      {/* ========================================================================= */}
      <section id="lucro-real" className="py-20 bg-graphite-900/35 border-t border-graphite-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs font-mono uppercase text-amber-400 font-semibold tracking-wider">
              A Verdade que Ninguém te Conta
            </span>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-vapor-100 uppercase mt-3 leading-tight">
              Você sabe qual carro realmente coloca dinheiro no seu bolso?
            </h2>
            <p className="text-sm sm:text-base text-vapor-300 mt-3 leading-relaxed">
              A maioria dos detailers copia o preço do concorrente e acha que está lucrando só porque o pátio está cheio. O NuvemWash faz o Raio-X exato da sua operação para você parar de pagar para trabalhar:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1: DollarSign Verde */}
            <div className="bg-graphite-900 border border-emerald-500/25 rounded-2xl p-6 flex flex-col justify-between hover:border-emerald-500/50 transition-all">
              <div>
                <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mb-5">
                  <DollarSign size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase leading-snug">
                  Lavagem de R$ 150 vs. Polimento Mal Precificado
                </h3>
                <p className="text-xs sm:text-sm text-vapor-300 mt-3 leading-relaxed">
                  Já parou para pensar que numa lavagem técnica de 2 horas por R$ 150 você gasta apenas R$ 25 de custo total (água, luz, químico diluído certo) e coloca R$ 125 livres no bolso? Muitas vezes ela dá mais lucro por hora do que um polimento de 4 horas cobrado barato!
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 text-xs font-semibold text-emerald-400">
                ✓ O sistema mostra a margem exata de cada serviço
              </div>
            </div>

            {/* Card 2: Clock Amber */}
            <div className="bg-graphite-900 border border-amber-500/25 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all">
              <div>
                <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mb-5">
                  <Clock size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase leading-snug">
                  O Cliente Esquecido há 4 Meses no WhatsApp
                </h3>
                <p className="text-xs sm:text-sm text-vapor-300 mt-3 leading-relaxed">
                  Quantos clientes fizeram uma higienização ou lavagem com você há 4 ou 5 meses, gostaram do serviço, mas sumiram simplesmente porque você esqueceu de chamar na correria? Com o histórico organizado, você recupera faturamento sem gastar 1 real em anúncio.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 text-xs font-semibold text-amber-400">
                ✓ Saiba exatamente quem sumiu e precisa de manutenção
              </div>
            </div>

            {/* Card 3: AlertTriangle Rose */}
            <div className="bg-graphite-900 border border-rose-500/25 rounded-2xl p-6 flex flex-col justify-between hover:border-rose-500/50 transition-all">
              <div>
                <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-5">
                  <AlertTriangle size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase leading-snug">
                  Fim do Desperdício no Olhômetro e de Prejuízos
                </h3>
                <p className="text-xs sm:text-sm text-vapor-300 mt-3 leading-relaxed">
                  Produto químico caro jogado no copo da Snow Foam no olho e aquele cliente esperto que cisma que um risco antigo na porta foi feito na sua oficina. Um único prejuízo evitado pela vistoria fotográfica já paga anos da plataforma.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 text-xs font-semibold text-rose-400">
                ✓ Economia de até 35% em galões + Blindagem CDC
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 4. ANTES VS DEPOIS (LAVA-RÁPIDO OCUPADO VS ESTÉTICA LUCRATIVA)            */}
      {/* ========================================================================= */}
      <section id="comparativo" className="py-20 bg-graphite-900/50 border-y border-graphite-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-mono uppercase text-amber-500 font-semibold tracking-wider">
              Antes vs. Depois
            </span>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-vapor-100 uppercase mt-2">
              A diferença entre um Lava-Rápido Ocupado e uma Estética Lucrativa
            </h2>
            <p className="text-sm sm:text-base text-vapor-400 mt-3">
              Descubra por que as estéticas que realmente colocam dinheiro no bolso abandonaram o achismo e os orçamentos soltos no WhatsApp.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Antes: Sem NuvemWash */}
            <div className="bg-graphite-950/80 border border-rose-500/20 rounded-2xl p-6 sm:p-8 flex flex-col gap-5">
              <div className="flex items-center gap-3 text-rose-400">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0">
                  <XCircle size={22} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold uppercase text-vapor-100">
                    Sem o NuvemWash
                  </h3>
                  <span className="text-xs text-vapor-400">
                    Box lotado, margem cega e risco jurídico
                  </span>
                </div>
              </div>

              <ul className="space-y-4 text-xs sm:text-sm text-vapor-300">
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Cobrar no achismo pelo preço do vizinho:</strong> Você trabalha 12 horas por dia e não sabe quanto custa sua hora técnica nem quanto lucro real sobrou livre no fim do mês.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Preço seco jogado no WhatsApp:</strong> O cliente lê só um número solto, acha caro, pede desconto ou some sem responder enquanto você perde reservas fora do horário.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Boca a boca totalmente vulnerável:</strong> Sem vistoria de entrada com fotos nem termos claros, basta um cliente acusar um risco antigo para você pagar um prejuízo injusto.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Esquecer clientes e misturar tudo no olho:</strong> Químico caro jogado fora na Snow Foam e clientes antigos que não voltam porque ninguém lembrou de chamar no histórico.
                  </span>
                </li>
              </ul>
            </div>

            {/* Depois: Com NuvemWash */}
            <div className="bg-graphite-950/80 border border-amber-500/40 rounded-2xl p-6 sm:p-8 flex flex-col gap-5 shadow-xl shadow-amber-500/5">
              <div className="flex items-center gap-3 text-amber-400">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold uppercase text-amber-400">
                    Com o NuvemWash
                  </h3>
                  <span className="text-xs text-vapor-300">
                    Lucro limpo no bolso, ticket maior e box blindado
                  </span>
                </div>
              </div>

              <ul className="space-y-4 text-xs sm:text-sm text-vapor-200">
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Raio-X do Lucro Real em cada carro:</strong> Descubra seus custos fixos, valor da hora técnica e margem líquida para saber exatamente quanto dinheiro limpo entra em cada serviço.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Proposta em 3 Níveis + Vitrine Online 24h:</strong> O cliente compara os pacotes no celular, escolhe o Recomendado ou Completo, assina e agenda com sinal Pix sem taxas.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>27 Minutas Jurídicas CDC + Vistoria com Fotos:</strong> Acervo fotográfico de entrada/saída e contratos prontos por serviço que protegem sua oficina contra má-fé e falhas ocultas.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Software + Ensino Prático de Gestão:</strong> Recupere clientes sumidos pelo histórico, economize até 35% em galões e aprenda precificação na prática com nossas aulas inclusas.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 5. OS 6 PILARES DO ECOSSISTEMA NUVEMWASH                                  */}
      {/* ========================================================================= */}
      <section id="recursos" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-mono uppercase text-amber-500 font-semibold tracking-wider">
              O Ecossistema Completo
            </span>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-vapor-100 uppercase mt-2">
              Os 6 pilares para lucrar e blindar sua estética automotiva
            </h2>
            <p className="text-sm sm:text-base text-vapor-400 mt-3">
              Não é um sistema genérico de mecânica. É tecnologia prática somada a ensino de gestão, desenhada exclusivamente para lavagem técnica, polimento, higienização e vitrificação.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Card 1: Orçamentos em 3 Níveis & Vitrine */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <FileCheck size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  1. Orçamentos em 3 Níveis & Vitrine
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Envie propostas digitais com 3 pacotes (Essencial, Recomendado e Completo) e assinatura com o dedo no celular. Receba também reservas na sua Vitrine Online com sinal via Pix direto para sua conta.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-amber-400">
                <span>Ticket até 40% maior + Assinatura</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 2: Check-in com Fotos & 27 Termos CDC */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <Camera size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  2. Vistoria com Fotos & 27 Termos CDC
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Registre riscos, amassados e peças de entrada/saída no Acervo Digital e anexe automaticamente nossos 27 termos jurídicos e garantias prontos (polimento, motor, vitrificação, PPF) conforme o Código de Defesa do Consumidor.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-cyan-400">
                <ShieldCheck size={15} className="shrink-0" />
                <span>Blindagem Jurídica + Acervo Digital</span>
              </div>
            </div>

            {/* Card 3: Calculadora de Diluição Precisa */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <Calculator size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  3. Calculadora de Diluição Precisa
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Chega de adivinhar quanto produto colocar no copo da Snow Foam. Nossa calculadora compensa a vazão real da sua lavadora de alta pressão em duas etapas e entrega a dosagem exata em mililitros.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <span>Economia de até 35% em galões</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 4: Raio-X do Lucro e Custos Reais */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <TrendingUp size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  4. Raio-X do Lucro e Precificação
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Descubra o valor real da sua hora de trabalho no box, cadastre custos fixos (aluguel, energia, equipe) e saiba exatamente qual serviço deixa lucro limpo no bolso sem chute.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-purple-400">
                <span>Margem de Lucro Real por Hora</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 5: Agenda, Pátio e Reativação */}
            <div className="bg-graphite-900 border border-graphite-700/80 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-500/50 transition-all group">
              <div>
                <div className="w-12 h-12 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <Calendar size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-vapor-100 uppercase">
                  5. Agenda, Pátio e Retenção
                </h3>
                <p className="text-xs sm:text-sm text-vapor-400 mt-2 leading-relaxed">
                  Controle carros aguardando, em execução com cronômetro ou prontos para entrega. Acompanhe o histórico completo de cada placa para reativar clientes que sumiram há meses pelo WhatsApp.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-graphite-800 flex items-center gap-2 text-xs font-semibold text-amber-400">
                <span>Pátio Organizado + Recompra</span>
                <ArrowRight size={14} />
              </div>
            </div>

            {/* Card 6: DESTAQUE DOURADO — Aulas de Gestão e Precificação */}
            <div className="bg-gradient-to-b from-amber-950/25 via-graphite-900 to-graphite-900 border-2 border-amber-500/60 rounded-2xl p-6 flex flex-col justify-between hover:border-amber-400 transition-all group relative shadow-lg shadow-amber-500/10">
              <div className="absolute -top-3 right-5 px-3 py-0.5 rounded-full bg-amber-500 text-graphite-950 font-sans text-[10px] font-extrabold uppercase tracking-wider shadow">
                Bônus Exclusivo Incluso
              </div>
              <div>
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <GraduationCap size={24} />
                </div>
                <h3 className="font-display text-lg font-bold text-amber-400 uppercase">
                  6. Aulas de Gestão e Precificação
                </h3>
                <p className="text-xs sm:text-sm text-vapor-200 mt-2 leading-relaxed">
                  Não entregamos apenas o software e te deixamos sozinho. Você recebe treinamentos diretos ao ponto ensinando como precificar cada serviço, aumentar seu ticket médio e organizar o financeiro do seu box.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-amber-500/30 flex items-center gap-2 text-xs font-semibold text-amber-300">
                <span>Liberado para todos os planos na plataforma</span>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 6. ISCA: EXPERIMENTE A CALCULADORA AGORA                                  */}
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
            Sem cadastro, sem senha e sem enrolação. Abra agora no seu celular ou envie o link para seus amigos detailers testarem a calibração exata de Snow Foam.
          </p>

          <Link to="/calculadora-diluicao">
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
      {/* 7. FAQ QUEBRADOR DE OBJEÇÕES                                              */}
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
                    className="w-full p-4 sm:p-5 text-left flex items-center justify-between gap-4 font-semibold text-sm sm:text-base text-vapor-200 cursor-pointer"
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
                    <div className="px-4 pb-5 sm:px-5 text-xs sm:text-sm text-vapor-300 leading-relaxed border-t border-graphite-800/60 pt-3">
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
      {/* 8. CTA FINAL DE ALTO IMPACTO                                              */}
      {/* ========================================================================= */}
      <section className="py-20 bg-gradient-to-b from-graphite-950 via-graphite-900 to-graphite-950 border-t border-graphite-800 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-amber-500/10 rounded-full blur-[130px] pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10 flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-lg">
            <Flame size={28} />
          </div>

          <h2 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight text-vapor-100 max-w-2xl leading-tight">
            Assuma o controle do lucro e blinde sua estética hoje mesmo
          </h2>

          <p className="text-sm sm:text-base text-vapor-300 max-w-xl">
            Sua conta já entra pré-configurada em menos de 1 minuto para você simular seu 1º orçamento em 3 níveis e ver a margem real no bolso.
          </p>

          <Link to="/criar-conta" className="w-full sm:w-auto max-w-full flex justify-center">
            <Button
              variant="primary"
              className="w-full sm:w-auto min-h-[48px] sm:min-h-[52px] px-4 sm:px-8 text-sm sm:text-base font-bold shadow-xl shadow-amber-500/25 flex items-center justify-center gap-2 group max-w-full"
            >
              <span className="sm:hidden">Testar Grátis e Simular 1º Orçamento</span>
              <span className="hidden sm:inline">Criar Conta Grátis e Simular 1º Orçamento</span>
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform shrink-0"
              />
            </Button>
          </Link>

          <span className="text-xs text-vapor-400">
            Já nasce pré-configurado • Sem cartão de crédito • Inclui Aulas de Gestão
          </span>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* 9. RODAPÉ INSTITUCIONAL                                                   */}
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
            <Link to="/calculadora-diluicao" className="hover:text-amber-400 transition-colors">
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
