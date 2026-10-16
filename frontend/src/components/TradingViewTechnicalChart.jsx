
import React, { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';

export default function TradingViewTechnicalChart({
  symbol = 'NASDAQ:NVDA',
  height = 620,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    container.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';

    const script = document.createElement('script');
    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;

    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: true,
      withdateranges: true,
      details: true,
      hotlist: false,
      studies: [],
      show_popup_button: true,
      popup_width: '1200',
      popup_height: '700',
    });

    container.appendChild(widget);
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol]);

  return (
    <section className="terminal-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="font-semibold text-white">
            TradingView Technical Analysis
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Indicators · Drawing tools · Intervals · Symbol comparison
          </p>
        </div>

        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`}
          target="_blank"
          rel="noreferrer"
          className="terminal-button-secondary"
        >
          <ExternalLink size={15} />
          Open full chart
        </a>
      </div>

      <div
        className="tradingview-widget-container"
        ref={containerRef}
        style={{ height, width: '100%' }}
      />

      <div className="border-t border-white/10 px-5 py-3 text-xs text-slate-500">
        Chart powered by TradingView. Indicator and layout availability
        depends on the widget and TradingView's supported features.
        This is a public-market chart, not your private portfolio history.
      </div>
    </section>
  );
}
