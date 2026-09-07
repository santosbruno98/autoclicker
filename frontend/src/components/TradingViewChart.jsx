import React, { useEffect, useRef, memo } from 'react';

// Embeds TradingView's free "Advanced Real-Time Chart" widget for a single
// symbol. TradingView has no concept of "my portfolio" — it only knows
// symbols it tracks itself — so this always charts one instrument at a
// time, picked by the caller, never an aggregate.
function TradingViewChart({ symbol }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !symbol) return;

    // Clear any previous widget before mounting a new one for the new symbol.
    containerRef.current.innerHTML = '';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      backgroundColor: 'rgba(11, 13, 15, 1)',
      gridColor: 'rgba(42, 47, 53, 0.4)',
      support_host: 'https://www.tradingview.com',
    });

    containerRef.current.appendChild(widgetDiv);
    containerRef.current.appendChild(script);
  }, [symbol]);

  return <div className="tradingview-widget-container h-full w-full" ref={containerRef} />;
}

export default memo(TradingViewChart);