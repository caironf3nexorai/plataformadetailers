/**
 * Motor Central de Rastreamento & Pixels (Meta, Google Ads, GA4, TikTok)
 * Seguro contra AdBlockers, sem quebras de execução e com suporte total a SPAs (React).
 */

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
    gtag?: any;
    dataLayer?: any[];
    ttq?: any;
  }
}

let metaInitialized = false;
let googleInitialized = false;
let tiktokInitialized = false;

/**
 * Inicializa dinamicamente o Meta (Facebook) Pixel
 */
export function initMetaPixel(pixelId: string | null | undefined): void {
  if (!pixelId || typeof window === 'undefined') return;
  const cleanId = pixelId.trim();
  if (!cleanId || metaInitialized) return;

  try {
    /* eslint-disable */
    (function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */

    window.fbq('init', cleanId);
    window.fbq('track', 'PageView');
    metaInitialized = true;
    console.log(`[Marketing] Meta Pixel ${cleanId} inicializado com sucesso.`);
  } catch (err) {
    console.warn('[Marketing] Falha ao inicializar Meta Pixel:', err);
  }
}

/**
 * Inicializa dinamicamente as Tags do Google (Google Ads e/ou GA4)
 */
export function initGoogleTags(googleAdsId?: string | null, ga4Id?: string | null): void {
  if (typeof window === 'undefined') return;
  const primaryId = (googleAdsId || ga4Id || '').trim();
  if (!primaryId || googleInitialized) return;

  try {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(primaryId)}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag(...args: any[]) {
      window.dataLayer?.push(args);
    }
    window.gtag = gtag;

    gtag('js', new Date());
    if (googleAdsId?.trim()) {
      gtag('config', googleAdsId.trim());
    }
    if (ga4Id?.trim()) {
      gtag('config', ga4Id.trim());
    }

    googleInitialized = true;
    console.log(`[Marketing] Google Tags inicializadas (${primaryId}).`);
  } catch (err) {
    console.warn('[Marketing] Falha ao inicializar Google Tags:', err);
  }
}

/**
 * Inicializa dinamicamente o TikTok Pixel
 */
export function initTikTokPixel(pixelId: string | null | undefined): void {
  if (!pixelId || typeof window === 'undefined') return;
  const cleanId = pixelId.trim();
  if (!cleanId || tiktokInitialized) return;

  try {
    /* eslint-disable */
    (function (w: any, _d: any, t: any) {
      w.TiktokAnalyticsObject = t;
      var ttq = (w[t] = w[t] || []);
      ttq.methods = [
        'page',
        'track',
        'identify',
        'instances',
        'debug',
        'on',
        'off',
        'once',
        'ready',
        'alias',
        'group',
        'enableCookie',
        'disableCookie',
      ];
      ttq.setAndDefer = function (t: any, e: any) {
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (t: any) {
        for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++)
          ttq.setAndDefer(e, ttq.methods[n]);
        return e;
      };
      ttq.load = function (e: any, n: any) {
        var i = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        (ttq._i = ttq._i || {})[e] = [];
        ttq._i[e]._u = i;
        ttq._t = ttq._t || {};
        ttq._t[e] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[e] = n || {};
        var o = document.createElement('script');
        o.type = 'text/javascript';
        o.async = !0;
        o.src = i + '?sdkid=' + e + '&lib=' + t;
        var a = document.getElementsByTagName('script')[0];
        a.parentNode?.insertBefore(o, a);
      };
      ttq.load(cleanId);
      ttq.page();
    })(window, document, 'ttq');
    /* eslint-enable */

    tiktokInitialized = true;
    console.log(`[Marketing] TikTok Pixel ${cleanId} inicializado com sucesso.`);
  } catch (err) {
    console.warn('[Marketing] Falha ao inicializar TikTok Pixel:', err);
  }
}

/**
 * Dispara PageView em todas as plataformas configuradas
 */
export function trackPageView(path?: string): void {
  try {
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'PageView');
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_path: path || window.location.pathname,
      });
    }
    if (typeof window.ttq?.page === 'function') {
      window.ttq.page();
    }
  } catch (e) {
    // Silencia qualquer interferência de AdBlock
  }
}

/**
 * Dispara evento de Lead (Interesse / Visita na tela de cadastro)
 */
export function trackLead(params?: Record<string, any>): void {
  try {
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Lead', params || {});
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'generate_lead', params || {});
    }
    if (typeof window.ttq?.track === 'function') {
      window.ttq.track('SubmitForm', params || {});
    }
  } catch (e) {
    // Silencia
  }
}

/**
 * O EVENTO DE OURO: Cadastro Concluído (CompleteRegistration)
 * Este evento instrui os algoritmos do Facebook e Google a buscarem usuários de altíssima conversão.
 */
export function trackCompleteRegistration(params?: Record<string, any>): void {
  try {
    const payload = {
      content_name: 'Cadastro NuvemWash',
      status: 'ativo_trial',
      ...params,
    };
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'CompleteRegistration', payload);
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'sign_up', {
        method: params?.method || 'email',
        ...payload,
      });
    }
    if (typeof window.ttq?.track === 'function') {
      window.ttq.track('CompleteRegistration', payload);
    }
    console.log('[Marketing] Evento CompleteRegistration disparado com sucesso!', payload);
  } catch (e) {
    // Silencia
  }
}

/**
 * Dispara evento de Início de Checkout / Intenção de Teste
 */
export function trackInitiateCheckout(params?: Record<string, any>): void {
  try {
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'InitiateCheckout', params || {});
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'begin_checkout', params || {});
    }
  } catch (e) {
    // Silencia
  }
}
