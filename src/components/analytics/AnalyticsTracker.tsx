import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { 
  initMetaPixel, 
  initGoogleTags, 
  initTikTokPixel, 
  trackPageView, 
  trackLead 
} from '../../utils/pixel';

export const AnalyticsTracker: React.FC = () => {
  const location = useLocation();
  const initializedRef = useRef(false);

  // 1. Carrega as configurações de pixels cadastradas no Painel Admin
  useEffect(() => {
    let active = true;

    async function carregarPixels() {
      try {
        const { data, error } = await supabase.rpc('obter_config_plataforma');
        if (error) {
          // Fallback silencioso direto na tabela caso a RPC ainda não esteja atualizada
          const { data: directData } = await supabase
            .from('plataforma_config')
            .select('meta_pixel_id, google_ads_id, google_analytics_id, tiktok_pixel_id')
            .eq('id', 1)
            .single();

          if (directData && active) {
            aplicarPixels(directData);
          }
          return;
        }

        if (data && active) {
          aplicarPixels(data);
        }
      } catch (err) {
        console.warn('[AnalyticsTracker] Erro ao carregar configurações de pixels:', err);
      }
    }

    function aplicarPixels(cfg: any) {
      if (initializedRef.current) return;
      initializedRef.current = true;

      if (cfg.meta_pixel_id) {
        initMetaPixel(cfg.meta_pixel_id);
      }
      if (cfg.google_ads_id || cfg.google_analytics_id) {
        initGoogleTags(cfg.google_ads_id, cfg.google_analytics_id);
      }
      if (cfg.tiktok_pixel_id) {
        initTikTokPixel(cfg.tiktok_pixel_id);
      }
    }

    carregarPixels();

    return () => {
      active = false;
    };
  }, []);

  // 2. Rastreia automaticamente a navegação entre rotas do React (SPA)
  useEffect(() => {
    trackPageView(location.pathname);

    // Se navegou para a página de criar conta, dispara Lead automaticamente
    if (location.pathname === '/criar-conta') {
      trackLead({ content_name: 'Acesso à Tela de Cadastro' });
    }
  }, [location.pathname]);

  return null;
};
