import React, { useEffect, useRef } from 'react';

import { useTheme } from './ThemeSettings';

export function MarketHeatmap() {
  const { theme } = useTheme();
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';

    const script = document.createElement('script');
    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
    script.type = 'text/javascript';
    script.async = true;
    script.textContent = JSON.stringify({
      exchanges: [],
      dataSource: 'SPX500',
      grouping: 'sector',
      blockSize: 'market_cap_basic',
      blockColor: 'change',
      locale: 'en',
      symbolUrl: '',
      colorTheme: theme,
      hasTopBar: true,
      isDataSetEnabled: true,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      width: '100%',
      height: '100%',
    });

    container.replaceChildren(widget, script);

    return () => {
      container.replaceChildren();
    };
  }, [theme]);

  return (
    <div className="app-widget-surface h-[800px] w-full overflow-hidden rounded-lg border border-gray-800">
      <div
        className="tradingview-widget-container h-full w-full"
        ref={containerRef}
      />
    </div>
  );
}

export default MarketHeatmap;