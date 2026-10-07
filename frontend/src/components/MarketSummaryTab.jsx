import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchMarketQuotes,
  processMarketDocument,
} from '../services/api';

const QUOTE_REFRESH_INTERVAL_MS = 60_000;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function formatPrice(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return '--';
  }

  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return '--';
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString();
}

function getErrorMessage(error, fallback) {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

function SentimentBadge({ active, type }) {
  if (!active) {
    return null;
  }

  const bullish = type === 'bullish';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        bullish
          ? 'bg-green-900/50 text-green-300 border border-green-700'
          : 'bg-red-900/50 text-red-300 border border-red-700'
      }`}
    >
      {bullish ? 'Bullish' : 'Bearish'}
    </span>
  );
}

const MarketSummaryTab = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [documentResult, setDocumentResult] = useState(null);

  const [quotes, setQuotes] = useState({});
  const [quotesUpdatedAt, setQuotesUpdatedAt] = useState(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshingQuotes, setIsRefreshingQuotes] = useState(false);

  const [documentError, setDocumentError] = useState('');
  const [quoteError, setQuoteError] = useState('');

  const symbols = useMemo(() => {
    if (!documentResult?.companies) {
      return [];
    }

    return [
      ...new Set(
        documentResult.companies
          .map((company) => company.symbol)
          .filter(Boolean)
          .map((symbol) => String(symbol).trim().toUpperCase())
      ),
    ];
  }, [documentResult]);

  const refreshQuotes = useCallback(async () => {
    if (symbols.length === 0) {
      return;
    }

    try {
      setIsRefreshingQuotes(true);
      setQuoteError('');

      const response = await fetchMarketQuotes(symbols);

      setQuotes(response?.quotes || {});
      setQuotesUpdatedAt(response?.timestamp || new Date().toISOString());
    } catch (error) {
      console.error('Failed to fetch market quotes:', error);

      setQuoteError(
        getErrorMessage(error, 'Failed to refresh market prices.')
      );
    } finally {
      setIsRefreshingQuotes(false);
    }
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) {
      return undefined;
    }

    refreshQuotes();

    const interval = window.setInterval(() => {
      refreshQuotes();
    }, QUOTE_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [symbols, refreshQuotes]);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] || null;

    setDocumentError('');

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.type && file.type !== 'application/pdf') {
      setSelectedFile(null);
      setDocumentError('Only PDF files are supported.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSelectedFile(null);
      setDocumentError('PDF must be 25 MiB or smaller.');
      event.target.value = '';
      return;
    }

    setSelectedFile(file);
  };

  const handleProcessDocument = async (event) => {
    event.preventDefault();

    if (!selectedFile || isProcessing) {
      return;
    }

    try {
      setIsProcessing(true);
      setDocumentError('');
      setQuoteError('');
      setQuotes({});
      setQuotesUpdatedAt(null);

      const result = await processMarketDocument(selectedFile);

      setDocumentResult(result);
    } catch (error) {
      console.error('Failed to process market document:', error);

      setDocumentResult(null);

      setDocumentError(
        getErrorMessage(error, 'Failed to process the PDF.')
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const getQuote = (symbol) => {
    if (!symbol) {
      return null;
    }

    return quotes[String(symbol).toUpperCase()] || null;
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">
            Market Document Analysis
          </h2>

          <p className="text-sm text-gray-400 mt-1">
            Upload a market PDF to extract companies, market sentiment and an
            AI-generated summary.
          </p>
        </div>

        <form
          onSubmit={handleProcessDocument}
          className="flex flex-col md:flex-row md:items-end gap-4"
        >
          <div className="flex-1">
            <label
              htmlFor="market-document"
              className="block text-xs font-semibold text-gray-400 mb-2"
            >
              Market PDF
            </label>

            <input
              id="market-document"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              disabled={isProcessing}
              className="block w-full text-sm text-gray-300
                file:mr-4 file:rounded-md file:border-0
                file:bg-gray-700 file:px-4 file:py-2
                file:text-sm file:font-semibold file:text-white
                hover:file:bg-gray-600
                disabled:opacity-50"
            />

            {selectedFile && (
              <div className="text-xs text-gray-500 mt-2">
                Selected: {selectedFile.name}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!selectedFile || isProcessing}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700
              disabled:text-gray-500 disabled:cursor-not-allowed
              text-white px-5 py-2 rounded-md text-sm font-semibold
              transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Process PDF'}
          </button>
        </form>

        {documentError && (
          <div className="mt-4 bg-red-900/40 border border-red-700 text-red-300 px-4 py-3 rounded text-sm">
            {documentError}
          </div>
        )}
      </div>

      {documentResult && (
        <>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  AI Summary
                </h2>

                {documentResult.source_file && (
                  <div className="text-xs text-gray-500 mt-1">
                    Source: {documentResult.source_file}
                  </div>
                )}
              </div>
            </div>

            {documentResult.ai_summary ? (
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {documentResult.ai_summary}
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                No AI summary was returned.
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="flex flex-wrap justify-between items-center gap-4 px-5 py-4 border-b border-gray-700">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Mentioned Companies
                </h2>

                <div className="text-xs text-gray-500 mt-1">
                  Prices refresh every 60 seconds while this tab is open.
                </div>
              </div>

              <div className="flex items-center gap-3">
                {quotesUpdatedAt && (
                  <span className="text-xs text-gray-500">
                    Updated {formatTimestamp(quotesUpdatedAt)}
                  </span>
                )}

                <button
                  type="button"
                  onClick={refreshQuotes}
                  disabled={
                    symbols.length === 0 ||
                    isRefreshingQuotes
                  }
                  className="text-xs bg-gray-700 hover:bg-gray-600
                    disabled:opacity-50 disabled:cursor-not-allowed
                    px-3 py-2 rounded text-gray-200 transition-colors"
                >
                  {isRefreshingQuotes ? 'Refreshing...' : 'Refresh Prices'}
                </button>
              </div>
            </div>

            {quoteError && (
              <div className="mx-5 mt-4 bg-red-900/40 border border-red-700 text-red-300 px-4 py-3 rounded text-sm">
                {quoteError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-gray-700 text-gray-400 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3">Company</th>
                    <th className="px-6 py-3">Symbol</th>
                    <th className="px-6 py-3">Sentiment</th>
                    <th className="px-6 py-3 text-right">Current Price</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-700">
                  {!documentResult.companies ||
                  documentResult.companies.length === 0 ? (
                    <tr>
                      <td
                        colSpan="4"
                        className="px-6 py-6 text-center text-gray-500"
                      >
                        No companies were detected in the document.
                      </td>
                    </tr>
                  ) : (
                    documentResult.companies.map((company, index) => {
                      const quote = getQuote(company.symbol);

                      const price =
                        quote?.price ??
                        quote?.current_price ??
                        quote?.last_price ??
                        null;

                      const currency =
                        quote?.currency ||
                        'USD';

                      return (
                        <tr
                          key={`${company.symbol || company.company_name}-${index}`}
                          className="hover:bg-gray-700/40"
                        >
                          <td className="px-6 py-4 font-medium text-white">
                            {company.company_name || '--'}
                          </td>

                          <td className="px-6 py-4">
                            {company.symbol ? (
                              <span className="font-mono font-semibold text-blue-400">
                                {company.symbol}
                              </span>
                            ) : (
                              <span className="text-gray-500">--</span>
                            )}
                          </td>

                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-2">
                              <SentimentBadge
                                active={company.bullish}
                                type="bullish"
                              />

                              <SentimentBadge
                                active={company.bearish}
                                type="bearish"
                              />

                              {!company.bullish && !company.bearish && (
                                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-gray-700 text-gray-300 border border-gray-600">
                                  Neutral
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-6 py-4 text-right font-semibold text-white">
                            {price !== null
                              ? `${currency} ${formatPrice(price)}`
                              : '--'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!documentResult && !isProcessing && (
        <div className="bg-gray-800/50 border border-dashed border-gray-700 rounded-lg p-10 text-center">
          <div className="text-gray-400 font-medium">
            No market document processed
          </div>

          <div className="text-sm text-gray-500 mt-1">
            Upload a PDF above to generate the market summary.
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketSummaryTab;