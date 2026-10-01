import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';
import { MobileNavDrawer } from './MobileNavDrawer';
import { BotaoFeedbackFlutuante } from '../feedback/BotaoFeedbackFlutuante';
import { ModalComunicadoGlobal } from '../comunicados/ModalComunicadoGlobal';
import { ModalAvisoAssinatura } from '../assinatura/ModalAvisoAssinatura';
import { ModalRadarFinanceiroDoDia } from '../financeiro/ModalRadarFinanceiroDoDia';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';

export const AppShell: React.FC = () => {
  const location = useLocation();
  const { tenant } = useAuth();
  const { isDono, isGerente } = usePermissao();
  const [assinatura, setAssinatura] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [radarAberto, setRadarAberto] = useState(false);
  const [radarDados, setRadarDados] = useState<any>(null);

  const isTelaCheiaOperacional = location.pathname.startsWith('/execucao/') || location.pathname.startsWith('/checkin/');

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

  // Escuta evento customizado para abertura manual do Radar Financeiro
  useEffect(() => {
    const handleAbrirRadar = () => setRadarAberto(true);
    window.addEventListener('abrir_radar_financeiro', handleAbrirRadar);
    return () => window.removeEventListener('abrir_radar_financeiro', handleAbrirRadar);
  }, []);

  // Disparo diário automático: ao entrar no sistema, verifica contas e cobranças do dia para Dono e Gerente (Apenas planos pagos/trial)
  useEffect(() => {
    const isTenantFree = !tenant?.plano || tenant.plano === 'free';
    if (!tenant?.id || (!isDono && !isGerente) || isTenantFree) return;

    const hojeStr = new Date().toISOString().slice(0, 10);
    const chaveVisto = `radar_financeiro_visto_${tenant.id}_${hojeStr}`;

    async function verificarRadarDiario() {
      try {
        const { data, error } = await supabase.rpc('obter_radar_financeiro_do_dia');
        if (error || !data || data.erro) return;

        setRadarDados(data);

        // Se ainda não dispensou hoje e possui cobranças pendentes ou contas a pagar
        const jaDispensouHoje = localStorage.getItem(chaveVisto);
        const temPendencias =
          (data.metricas?.qtd_cobrancas_total || 0) > 0 ||
          (data.metricas?.qtd_despesas_pendentes || 0) > 0;

        if (!jaDispensouHoje && temPendencias) {
          const timer = setTimeout(() => {
            setRadarAberto(true);
          }, 800);
          return () => clearTimeout(timer);
        }
      } catch (err) {
        console.error('[RadarFinanceiro] Falha na verificação diária:', err);
      }
    }

    verificarRadarDiario();
  }, [tenant?.id, isDono, isGerente]);

  const handleDispensarRadarHoje = () => {
    if (tenant?.id) {
      const hojeStr = new Date().toISOString().slice(0, 10);
      localStorage.setItem(`radar_financeiro_visto_${tenant.id}_${hojeStr}`, 'true');
    }
    setRadarAberto(false);
  };

  return (
    <div className="min-h-screen bg-graphite-900 text-vapor-100 flex w-full max-w-full flex-col selection:bg-amber-500 selection:text-graphite-950">
      {/* Modal Popup de Aviso de Plano Vencendo / Pagamento em Atraso */}
      <ModalAvisoAssinatura assinatura={assinatura} />

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
            className="flex-1 p-4 pb-[88px] lg:p-8 lg:pt-8 w-full max-w-5xl mx-auto"
            style={{
              paddingTop: 'calc(76px + env(safe-area-inset-top, 0px))',
              paddingBottom: 'calc(80px + max(12px, env(safe-area-inset-bottom, 0px)))',
            }}
          >
            <Outlet />
          </main>
          
          {/* Barra Inferior Mobile (< 1024px) - Oculta em telas operacionais de execução e checkin */}
          {!isTelaCheiaOperacional && (
            <BottomNav 
              onOpenMenu={() => setMobileMenuOpen(true)} 
              isMenuOpen={mobileMenuOpen} 
            />
          )}

          {/* Drawer Lateral Deslizante Mobile (< 1024px) */}
          <MobileNavDrawer 
            isOpen={mobileMenuOpen} 
            onClose={() => setMobileMenuOpen(false)} 
          />

          {/* Botão Flutuante de Feedback */}
          <BotaoFeedbackFlutuante />

          {/* Modal Global de Comunicados, Banners e Brindes */}
          <ModalComunicadoGlobal />

          {/* Modal Diário de Radar Financeiro (Contas a Pagar & Cobranças do Dia) */}
          <ModalRadarFinanceiroDoDia
            aberto={radarAberto}
            onFechar={() => setRadarAberto(false)}
            onDispensarHoje={handleDispensarRadarHoje}
            dadosIniciais={radarDados}
            onItemBaixado={() => {
              // Notificar qualquer lista aberta que um recebimento foi baixado
              window.dispatchEvent(new CustomEvent('financeiro_atualizado'));
            }}
          />
        </div>
      </div>
    </div>
  );
};
