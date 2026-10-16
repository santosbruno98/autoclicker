
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud, FileText, BrainCircuit, RefreshCw,
  ArrowUpRight, CheckCircle2, AlertCircle
} from 'lucide-react';
import { processMarketDocument, fetchMarketQuotes } from '../services/api';

const MAX_PDF_SIZE = 25 * 1024 * 1024;
const REFRESH_MS = 60_000;

function errorText(error) {
  return error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message || 'Request failed.';
}

function Sentiment({ company }) {
  if (company.bullish && company.bearish) {
    return <span className="terminal-chip text-amber-300">Mixed</span>;
  }
  if (company.bullish) {
    return <span className="terminal-chip text-emerald-400">Bullish</span>;
  }
  if (company.bearish) {
    return <span className="terminal-chip text-rose-400">Bearish</span>;
  }
  return <span className="terminal-chip">Neutral</span>;
}

export default function MarketSummaryTab({ active = true, onSelectSymbol }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const busyRef = useRef(false);

  const symbols = useMemo(() => [
    ...new Set(
      (result?.companies || [])
        .map((company) => String(company.symbol || '').trim().toUpperCase())
        .filter(Boolean)
    ),
  ], [result]);

  const refresh = useCallback(async () => {
    if (!active || document.hidden || !symbols.length || busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);
    try {
      const response = await fetchMarketQuotes(symbols);
      setQuotes(response?.quotes || {});
      setUpdatedAt(response?.timestamp || new Date().toISOString());
      setQuoteError(
        Object.keys(response?.errors || {}).length
          ? 'Some symbols could not be refreshed.'
          : ''
      );
    } catch (err) {
      setQuoteError(errorText(err));
    } finally {
      busyRef.current = false;
      setRefreshing(false);
    }
  }, [active, symbols]);

  useEffect(() => {
    if (!active || !symbols.length) return undefined;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, symbols, refresh]);

  const chooseFile = (event) => {
    const selected = event.target.files?.[0] || null;
    setError('');
    if (!selected) {
      setFile(null);
      return;
    }
    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported.');
      setFile(null);
      return;
    }
    if (selected.size > MAX_PDF_SIZE) {
      setError('PDF must be 25 MiB or smaller.');
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!file || processing) return;
    setProcessing(true);
    setError('');
    try {
      const data = await processMarketDocument(file);
      setResult(data);
      setQuotes({});
      setUpdatedAt(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="terminal-card p-5">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-xl bg-violet-500/10 p-3 text-violet-400">
            <BrainCircuit size={22} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">AI Market Research</h2>
            <p className="mt-1 text-sm text-slate-400">
              Extract companies and sentiment from a market PDF using Gemini.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="terminal-label flex-1">
            PDF document (maximum 25 MiB)
            <input type="file" accept=".pdf,application/pdf"
              disabled={processing} onChange={chooseFile}
              className="terminal-input text-sm" />
          </label>
          <button className="terminal-button" disabled={!file || processing}>
            {processing ? <RefreshCw size={16} className="animate-spin" /> :
              <UploadCloud size={16} />}
            {processing ? 'Analyzing document...' : 'Process PDF'}
          </button>
        </form>

        {file && (
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <FileText size={14} /> {file.name}
          </p>
        )}
        {error && (
          <p className="mt-4 flex items-center gap-2 text-sm text-rose-400">
            <AlertCircle size={16} /> {error}
          </p>
        )}
      </section>

      {result ? (
        <>
          <section className="terminal-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <BrainCircuit size={18} className="text-violet-400" />
              <h3 className="font-semibold text-white">Gemini Analysis</h3>
              <CheckCircle2 size={16} className="ml-auto text-emerald-400" />
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-300">
              {result.ai_summary || 'No summary returned.'}
            </div>
          </section>

          <section className="terminal-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="font-semibold text-white">Mentioned Companies</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Quotes refresh every 60 seconds while this section is visible.
                </p>
              </div>
              <button className="terminal-button-secondary"
                disabled={!active || refreshing || !symbols.length}
                onClick={refresh}>
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                Refresh prices
              </button>
            </div>

            {quoteError && (
              <p className="px-5 pt-4 text-sm text-amber-400">{quoteError}</p>
            )}

            <div className="overflow-x-auto">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Company</th><th>Ticker</th><th>Sentiment</th>
                    <th>Current price</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.companies || []).map((company, index) => {
                    const symbol = String(company.symbol || '').toUpperCase();
                    const quote = quotes[symbol];
                    return (
                      <tr key={`${symbol}-${index}`}>
                        <td className="font-medium text-white">
                          {company.company_name || 'Unknown'}
                        </td>
                        <td>
                          {symbol ? (
                            <button className="font-semibold text-cyan-400"
                              onClick={() => onSelectSymbol?.(symbol)}>
                              {symbol} <ArrowUpRight size={13} className="inline" />
                            </button>
                          ) : '—'}
                        </td>
                        <td><Sentiment company={company} /></td>
                        <td className="font-semibold text-white">
                          {quote?.price != null
                            ? `${quote.currency || 'USD'} ${Number(quote.price).toFixed(2)}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {!result.companies?.length && (
                    <tr><td colSpan="4" className="text-center text-slate-500">
                      No companies detected.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {updatedAt && (
              <div className="border-t border-white/10 px-5 py-3 text-xs text-slate-500">
                Last quote update: {new Date(updatedAt).toLocaleString()}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="terminal-card p-12 text-center">
          <FileText className="mx-auto mb-3 text-slate-500" size={30} />
          <p className="font-medium text-slate-300">No document analyzed yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Upload a PDF to generate your first research summary.
          </p>
        </div>
      )}
    </div>
  );
}
