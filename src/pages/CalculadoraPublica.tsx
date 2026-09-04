import React from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/layout/PublicLayout';
import { DiluicaoCalculator } from '../features/diluicao/DiluicaoCalculator';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Layers,
  ShieldCheck,
  Zap,
  Sparkles,
  ArrowRight,
  Calculator,
} from 'lucide-react';

export const CalculadoraPublica: React.FC = () => {
  return (
    <PublicLayout>
      <div className="flex flex-col gap-8 max-w-5xl mx-auto">
        {/* Banner Superior Convidativo */}
        <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border border-amber-500/30 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="font-semibold text-vapor-100 text-xs sm:text-sm">
                Ferramenta Gratuita disponibilizada por <span className="text-amber-400 font-bold">NuvemWash</span>
              </p>
              <p className="text-vapor-400 text-[11px] sm:text-xs">
                Orçamentos em 3 níveis, vistorias com fotos, acervo digital e gestão para sua estética automotiva.
              </p>
            </div>
          </div>
          <Link to="/" className="shrink-0 w-full sm:w-auto">
            <Button
              variant="secondary"
              size="sm"
              className="text-xs h-8 px-3 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 w-full sm:w-auto flex items-center justify-center gap-1.5"
            >
              <span>Conhecer Plataforma</span>
              <ArrowRight size={13} />
            </Button>
          </Link>
        </div>

        {/* Bloco de Título */}
        <div className="text-center max-w-3xl mx-auto flex flex-col gap-3">
          <div className="inline-flex items-center justify-center gap-2 self-center px-3 py-1 bg-graphite-800 border border-graphite-600 rounded-full text-xs font-medium text-amber-400">
            <Calculator size={14} />
            <span>Acesso Público • Sem Necessidade de Cadastro</span>
          </div>

          <h1 className="font-display text-[26px] sm:text-[36px] text-vapor-100 uppercase tracking-wide font-bold leading-tight">
            Calculadora de Diluição Automotiva
          </h1>
          <p className="font-sans text-[14px] sm:text-[16px] text-vapor-300 leading-relaxed max-w-2xl mx-auto">
            Snow foam manual e de lavadora de alta pressão. Calcule a concentração real que chega na pintura e acabe com o desperdício de produtos caros na sua estética.
          </p>
        </div>

        {/* A Calculadora (Elemento Principal) */}
        <div className="w-full">
          <DiluicaoCalculator variant="publico" />
        </div>

        {/* Três Blocos Curtos de Texto Explicativo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-6 border-t border-graphite-700">
          <Card className="p-5 bg-graphite-800/80 border-graphite-700 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-amber-500 font-sans font-semibold text-[15px]">
              <Layers size={19} />
              <span>Diluição em Duas Etapas</span>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              Na lança de espuma acoplada à lavadora, a solução do pote sofre uma segunda diluição violenta com a água injetada pela bomba. Nossa calculadora compensa exatamente essa injeção.
            </p>
          </Card>

          <Card className="p-5 bg-graphite-800/80 border-graphite-700 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-amber-500 font-sans font-semibold text-[15px]">
              <ShieldCheck size={19} />
              <span>Proteção e Eficiência</span>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              Diluições muito fracas não limpam o veículo adequadamente; diluições muito fortes removem ceras, mancham borrachas e geram prejuízo na compra de galões químicos.
            </p>
          </Card>

          <Card className="p-5 bg-graphite-800/80 border-graphite-700 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-amber-500 font-sans font-semibold text-[15px]">
              <Zap size={19} />
              <span>Plataforma NuvemWash</span>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              Além da diluição, o NuvemWash profissionaliza seu estúdio com orçamentos digitais, vistorias com foto, assinatura digital no celular do cliente e controle financeiro.
            </p>
          </Card>
        </div>

        {/* Rodapé com CTA de Conversão */}
        <div className="p-6 bg-gradient-to-r from-graphite-900 via-graphite-800 to-graphite-900 border border-amber-500/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-5 text-center sm:text-left mt-4 shadow-xl">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-lg text-vapor-100 font-bold uppercase tracking-wide">
              Quer mais ferramentas como esta na sua estética?
            </h3>
            <p className="text-xs sm:text-sm text-vapor-400 max-w-xl">
              Crie orçamentos em 3 níveis, registre vistorias com fotos e gerencie toda sua oficina em uma única plataforma feita sob medida para detailers.
            </p>
          </div>
          <Link to="/criar-conta" className="shrink-0 w-full sm:w-auto">
            <Button
              type="button"
              variant="primary"
              className="w-full sm:w-auto min-h-[46px] px-6 text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
            >
              <span>Criar Conta Gratuita</span>
              <ArrowRight size={16} />
            </Button>
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
};
