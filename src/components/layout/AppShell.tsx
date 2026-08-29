import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';
import { MobileNavDrawer } from './MobileNavDrawer';
import { BotaoFeedbackFlutuante } from '../feedback/BotaoFeedbackFlutuante';
import { AtrasoBanner } from './AtrasoBanner';
import { TrialBanner } from './TrialBanner';
import { supabase } from '../../lib/supabase';

export const AppShell: React.FC = () => {
  const [assinatura, setAssinatura] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    async function carregarAssinatura() {
      try {
        const { data } = await supabase.rpc('obter_assinatura_tenant');
        if (data) setAssinatura(data);
      } catch (err) {
        console.error('Erro ao carregar assinatura:', err);
      }
    }
    carregarAssinatura();
  }, []);

  return (
    <div className="min-h-screen bg-graphite-900 text-vapor-100 flex w-full max-w-full flex-col selection:bg-amber-500 selection:text-graphite-950">
      {/* Banners Globais de Assinatura no Topo */}
      {assinatura?.status === 'atrasada' && (
        <AtrasoBanner
          diasParaRebaixamento={assinatura.dias_para_rebaixamento ?? 5}
          urlPagamentoAsaas={assinatura.url_pagamento_asaas}
        />
      )}

      {assinatura?.status === 'trial' && (
        <TrialBanner diasRestantes={assinatura.dias_trial_restantes ?? 14} />
      )}

      <div className="flex flex-1 w-full max-w-full">
        {/* Sidebar fixa no Desktop (>= 1024px) */}
        <SidebarNav />
        
        <div className="flex-1 flex flex-col min-h-screen lg:pl-[240px] w-full max-w-full">
          {/* Barra Superior Mobile (< 1024px) */}
          <TopBar 
            onOpenMenu={() => setMobileMenuOpen(true)} 
            isMenuOpen={mobileMenuOpen} 
          />
          
          {/* Conteúdo Principal com compensação de altura para barras mobile */}
          <main 
            className="flex-1 p-4 pt-[76px] pb-[88px] lg:p-8 lg:pt-8 w-full max-w-5xl mx-auto"
            style={{
              paddingBottom: 'calc(80px + max(12px, env(safe-area-inset-bottom, 0px)))',
            }}
          >
            <Outlet />
          </main>
          
          {/* Barra Inferior Mobile (< 1024px) */}
          <BottomNav 
            onOpenMenu={() => setMobileMenuOpen(true)} 
            isMenuOpen={mobileMenuOpen} 
          />

          {/* Drawer Lateral Deslizante Mobile (< 1024px) */}
          <MobileNavDrawer 
            isOpen={mobileMenuOpen} 
            onClose={() => setMobileMenuOpen(false)} 
          />

          {/* Botão Flutuante de Feedback */}
          <BotaoFeedbackFlutuante />
        </div>
      </div>
    </div>
  );
};
