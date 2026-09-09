'use client';
// GRAPHIQUE TRADINGVIEW (10/09/2026, décision Mathieu : « on peut pas juste mettre l'intégration TradingView ? »).
// Uniquement sur l'écran Desk. Pourquoi lui plutôt que notre graphique maison ici : toutes les unités de temps
// marchent (nos séries M15 et H1 ne sont plus alimentées, elles s'arrêtent au 7 septembre), l'outil est familier
// à n'importe qui, et il ne dépend pas de la santé de notre flux.
// Ce qu'on NE change pas : le runner continue d'écrire nos bougies. Elles portent les prix affichés en haut de
// l'écran, le prix de référence de chaque appel du desk et le suivi à 1, 3 et 7 jours — TradingView est un
// affichage, on ne peut pas l'interroger.
// La mention de copyright fait partie des conditions d'utilisation du widget gratuit : on la garde.
import { useEffect, useRef } from 'react';

// Le symbole du broker → la source publique la plus proche (du spot, pas de la future : notre or est du spot).
const TV_SYMBOL: Record<string, string> = {
  XAUUSD: 'OANDA:XAUUSD',
  BTCUSD: 'BITSTAMP:BTCUSD',
};

export function TradingViewChart({ symbol, interval = '60' }: { symbol: string; interval?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = '';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = 'calc(100% - 26px)';
    const credit = document.createElement('div');
    credit.className = 'tradingview-widget-copyright';
    credit.style.cssText = 'height:26px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px';
    credit.innerHTML =
      '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank" ' +
      'style="font-size:9px;letter-spacing:1px;color:#6f7f9c;text-decoration:none">CHART BY TRADINGVIEW</a>';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: TV_SYMBOL[symbol] ?? symbol,
      interval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: '#070f1d',
      gridColor: 'rgba(130,152,190,.12)',
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      allow_symbol_change: false,
      save_image: false,
      withdateranges: false,
      details: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });
    el.append(widget, credit, script);
    return () => { el.innerHTML = ''; };
  }, [symbol, interval]);

  return <div ref={host} className="tradingview-widget-container" style={{ height: '100%', width: '100%' }} />;
}
