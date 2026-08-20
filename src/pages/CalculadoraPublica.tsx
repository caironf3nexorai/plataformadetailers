import React from 'react';
import { PublicLayout } from '../components/layout/PublicLayout';
import { DiluicaoCalculator } from '../features/diluicao/DiluicaoCalculator';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Layers, ShieldCheck, Zap } from 'lucide-react';

export const CalculadoraPublica: React.FC = () => {
  return (
    <PublicLayout>
      <div className="flex flex-col gap-10">
        {/* Bloco de Título */}
        <div className="text-center max-w-2xl mx-auto flex flex-col gap-3">
          <h1 className="font-display text-[28px] sm:text-[36px] text-vapor-100 uppercase tracking-wide font-bold">
            Calculadora de Diluição
          </h1>
          <p className="font-sans text-[15px] sm:text-[16px] text-vapor-400 leading-relaxed">
            Snow foam manual e de lavadora. Descubra quanto produto realmente chega na pintura.
          </p>
        </div>

        {/* A Calculadora (Elemento Principal) */}
        <DiluicaoCalculator variant="publico" />

        {/* Três Blocos Curtos de Texto Explicativo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-graphite-600">
          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-500 font-sans font-semibold text-[15px]">
              <Layers size={20} />
              <span>Diluição em Duas Etapas</span>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              Na lança de espuma, a solução do pote sofre uma segunda diluição com a água injetada pela lavadora. O calculador corrige a concentração final que realmente toca a pintura.
            </p>
          </Card>

          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-500 font-sans font-semibold text-[15px]">
              <ShieldCheck size={20} />
              <span>Por Que Calibrar?</span>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              Medir o consumo do pote e a saída no balde leva apenas 2 minutos e elimina adivinhações sobre a vazão real da sua máquina.
            </p>
          </Card>

          <Card className="p-5 bg-graphite-800 border-graphite-600 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-500 font-sans font-semibold text-[15px]">
              <Zap size={20} />
              <span>Além da Diluição</span>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              A Plataforma Detailers organiza seus orçamentos, estoque, clientes e controle financeiro em um só painel simples e rápido.
            </p>
          </Card>
        </div>

        {/* Rodapé com linha e CTA */}
        <footer className="pt-6 border-t border-graphite-600 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <p className="font-sans text-[13px] text-vapor-400">
            Plataforma Detailers &copy; 2026. A ferramenta definitiva para estética automotiva.
          </p>
          <Button
            type="button"
            variant="primary"
            onClick={() => (window.location.href = '#')}
            className="min-h-[44px] px-6 text-[13px] font-semibold"
          >
            Criar conta grátis
          </Button>
        </footer>
      </div>
    </PublicLayout>
  );
};
