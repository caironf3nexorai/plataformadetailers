import React, { useEffect } from 'react';
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
  // 1. Inicializa imediatamente pelo cache local se já existir (para não esperar a RPC)
  useEffect(() => {
    try {
      const cachedMeta = localStorage.getItem('app_meta_pixel_id');
      const cachedGoogle = localStorage.getItem('app_google_ads_id');
      const cachedGA4 = localStorage.getItem('app_google_analytics_id');
      const cachedTikTok = localStorage.getItem('app_tiktok_pixel_id');
      if (cachedMeta) initMetaPixel(cachedMeta);
      if (cachedGoogle || cachedGA4) initGoogleTags(cachedGoogle, cachedGA4);
      if (cachedTikTok) initTikTokPixel(cachedTikTok);
    } catch {}
  }, []);

  // 2. Carrega as configurações de pixels cadastradas no Painel Admin
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
      if (cfg.meta_pixel_id) {
        try { localStorage.setItem('app_meta_pixel_id', cfg.meta_pixel_id); } catch {}
        initMetaPixel(cfg.meta_pixel_id);
      }
      if (cfg.google_ads_id || cfg.google_analytics_id) {
        if (cfg.google_ads_id) try { localStorage.setItem('app_google_ads_id', cfg.google_ads_id); } catch {}
        if (cfg.google_analytics_id) try { localStorage.setItem('app_google_analytics_id', cfg.google_analytics_id); } catch {}
        initGoogleTags(cfg.google_ads_id, cfg.google_analytics_id);
      }
      if (cfg.tiktok_pixel_id) {
        try { localStorage.setItem('app_tiktok_pixel_id', cfg.tiktok_pixel_id); } catch {}
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
