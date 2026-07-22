'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Candidate {
  advNo: string;
  maker: {
    nickname: string;
    userNo: string;
    month_orders: number | null;
    finish_rate: number | null;
  };
  price: number;
  asset_received: number;
  min_fiat: number;
  max_fiat: number;
  available_asset: number;
  available_fiat_value: number;
  payment_methods: string[];
}

interface QuoteResponse {
  candidates: Candidate[];
  best_per_method: Candidate[];
  request: { fiat_amount: number; fiat_currency: string; asset: string; payment_methods?: string[] };
  ts: number;
}

interface Props {
  fiats: string[];
  /** Global pool of payment methods (~733 for binance). */
  paymentMethods: string[];
  /** Per-fiat method scoping — when fiat changes, the dropdown narrows to that fiat's methods. */
  methodsByFiat: Record<string, string[]>;
}

const SUPPORTED_ASSETS = ['USDT', 'BTC', 'ETH', 'USDC', 'BNB', 'FDUSD'] as const;
type Asset = (typeof SUPPORTED_ASSETS)[number];

const ANY_METHOD = '__any__';
const BINANCE_P2P_URL = 'https://p2p.binance.com/';
const STALE_SECS = 60;
const FETCH_DEBOUNCE_MS = 350;
const COMPARISON_MAX = 5;

function fmtNumber(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtAssetAmount(n: number, asset: Asset): string {
  // BTC/ETH need more decimals to display meaningfully.
  if (asset === 'BTC') return fmtNumber(n, 8);
  if (asset === 'ETH' || asset === 'BNB') return fmtNumber(n, 6);
  return fmtNumber(n, 2);
}

function fmtFiat(n: number, fiat: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: fiat,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${fmtNumber(n, 0)} ${fiat}`;
  }
}

export default function BinanceP2pQuoteView({ fiats, paymentMethods, methodsByFiat }: Props) {
  const [amount, setAmount] = useState<string>('');
  const [fiat, setFiat] = useState<string>(() =>
    fiats.includes('USD') ? 'USD' : fiats[0] ?? 'USD',
  );
  const [asset, setAsset] = useState<Asset>('USDT');
  const [method, setMethod] = useState<string>(ANY_METHOD);

  const [data, setData] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // forces stale-time re-render
  const lastReqId = useRef(0);

  // Methods available for the currently-selected fiat — mirrors orderbook view behavior.
  const activeMethodPool = useMemo(() => {
    const perFiat = methodsByFiat[fiat];
    return perFiat && perFiat.length > 0 ? perFiat : paymentMethods;
  }, [fiat, methodsByFiat, paymentMethods]);

  // When fiat changes, drop the selected method if it's no longer valid for the new fiat.
  useEffect(() => {
    if (method !== ANY_METHOD && !activeMethodPool.includes(method)) {
      setMethod(ANY_METHOD);
    }
  }, [activeMethodPool, method]);

  const numericAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  const fetchQuote = useCallback(async () => {
    if (!numericAmount || !fiat) {
      setData(null);
      return;
    }
    const reqId = ++lastReqId.current;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/binance_p2p/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fiat_amount: numericAmount,
          fiat_currency: fiat,
          asset,
          payment_methods: method === ANY_METHOD ? [] : [method],
        }),
      });
      const body = (await resp.json()) as Partial<QuoteResponse> & { error?: string; detail?: string };
      if (reqId !== lastReqId.current) return;
      if (!resp.ok) {
        throw new Error(body.detail ?? body.error ?? `HTTP ${resp.status}`);
      }
      setData(body as QuoteResponse);
    } catch (e) {
      if (reqId === lastReqId.current) setError((e as Error).message);
    } finally {
      if (reqId === lastReqId.current) setLoading(false);
    }
  }, [numericAmount, fiat, asset, method]);

  // Debounced fetch on input change.
  useEffect(() => {
    const t = setTimeout(fetchQuote, FETCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  // Tick every second for the stale badge.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSecs = data ? Math.floor((Date.now() - data.ts) / 1000) : 0;
  const isStale = ageSecs > STALE_SECS;
  const best = data?.candidates[0] ?? null;
  const comparisonItems = useMemo(() => {
    if (!data) return [];
    if (method === ANY_METHOD) {
      return data.best_per_method.slice(0, COMPARISON_MAX);
    }
    return data.candidates.slice(0, COMPARISON_MAX);
  }, [data, method]);
  const showComparison = comparisonItems.length >= 1;
  void tick;

  return (
    <div className={`quote-page${showComparison ? ' quote-page-split' : ''}`}>
      <div className="quote-form">
        {/* You send */}
        <div className="quote-row">
          <label className="quote-row-label">You send</label>
          <div className="quote-row-controls">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className="quote-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              aria-label="Amount to send"
            />
            <FiatSelect value={fiat} options={fiats} onChange={setFiat} />
          </div>
        </div>

        {/* Paying using */}
        <div className="quote-row">
          <label className="quote-row-label">
            Paying using{' '}
            <span className="label-sub">
              ({activeMethodPool.length} for {fiat})
            </span>
          </label>
          <div className="quote-row-controls">
            <MethodSelect value={method} options={activeMethodPool} onChange={setMethod} />
          </div>
        </div>

        {/* You receive */}
        <div className="quote-row">
          <label className="quote-row-label">You receive</label>
          <div className="quote-row-controls">
            <div className="quote-amount quote-amount-readonly mono">
              {best ? fmtAssetAmount(best.asset_received, asset) : loading ? '…' : '0.00'}
            </div>
            <AssetSelect value={asset} onChange={setAsset} />
          </div>
          {best ? (
            <div className="quote-row-sub">
              <span className="mono">rate {best.price.toFixed(4)}</span>{' '}
              <span className="muted">
                {fiat}/{asset}
              </span>{' '}
              <span className="muted">via {best.maker.nickname}</span>
              {best.maker.month_orders != null ? (
                <span className="muted fs-xs">
                  {' '}
                  · {best.maker.month_orders} orders/30d
                  {best.maker.finish_rate != null
                    ? ` · ${(best.maker.finish_rate * 100).toFixed(0)}% finish`
                    : ''}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* CTA */}
        <a
          href={BINANCE_P2P_URL}
          target="_blank"
          rel="noreferrer"
          className={`quote-cta${best ? '' : ' quote-cta-disabled'}`}
          aria-disabled={!best}
          onClick={(e) => {
            if (!best) e.preventDefault();
          }}
        >
          {best ? 'Open in Binance ↗' : numericAmount ? 'No matching ad' : 'Enter amount'}
        </a>

        {data ? (
          <div className="quote-meta">
            <span
              className="dot"
              style={{ background: isStale ? 'var(--warn)' : 'var(--prov-good)' }}
              title={isStale ? 'Stale — refresh' : 'Fresh'}
            />{' '}
            {isStale ? `quote ${ageSecs}s old · ` : `quote ${ageSecs}s ago · `}
            <button
              type="button"
              className="link-btn"
              onClick={() => fetchQuote()}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="quote-error">
            {error === 'missing_required_fields'
              ? 'Enter an amount to get a quote.'
              : `Quote failed: ${error}`}
          </div>
        ) : null}
        {data && !best && !loading ? (
          <div className="quote-empty">
            No matching ad for {fmtFiat(numericAmount ?? 0, fiat)} → {asset}
            {method !== ANY_METHOD ? ` via ${method}` : ''}.{' '}
            Try a different amount, asset, or payment method.
          </div>
        ) : null}
      </div>

      {/* Comparison list — top 5 quotes */}
      {showComparison ? (
        <div className="quote-comparison">
          <div className="quote-comparison-title">
            {method === ANY_METHOD ? 'Top makers' : `Top ads via ${method}`}
            {' '}for {fmtFiat(numericAmount ?? 0, fiat)} → {asset}
          </div>
          <div className="quote-comparison-list">
            {comparisonItems.map((c, i) => (
              <div
                key={c.advNo}
                className={`quote-comparison-row${i === 0 ? ' quote-comparison-best' : ''}`}
              >
                <div className="quote-comparison-platform">
                  {i === 0 ? <span className="quote-best-badge">Best</span> : null}
                  <div>
                    <div className="maker-name-sm">{c.maker.nickname}</div>
                    <div className="muted fs-2xs">
                      {c.maker.month_orders != null ? `${c.maker.month_orders} orders/30d` : '—'}
                      {c.maker.finish_rate != null
                        ? ` · ${(c.maker.finish_rate * 100).toFixed(0)}%`
                        : ''}
                    </div>
                  </div>
                </div>
                <div className="quote-comparison-rate mono">
                  {fmtAssetAmount(c.asset_received, asset)} {asset}
                </div>
                <div className="mono muted fs-xs">
                  rate {c.price.toFixed(4)}
                </div>
                <div className="quote-methods">
                  {c.payment_methods.slice(0, 2).map((m) => (
                    <span key={m} className="tag tag-xs">
                      {m}
                    </span>
                  ))}
                  {c.payment_methods.length > 2 ? (
                    <span className="muted fs-2xs">+{c.payment_methods.length - 2}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Pill-style selectors matching zkp2p's quote view aesthetic -----------

function FiatSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="quote-pill-select">
      <span className="quote-pill-icon">💱</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Fiat currency">
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="quote-pill-chev">▾</span>
    </div>
  );
}

function AssetSelect({
  value,
  onChange,
}: {
  value: Asset;
  onChange: (v: Asset) => void;
}) {
  return (
    <div className="quote-asset-pill">
      <span className="quote-asset-logo" aria-hidden>
        {value === 'BTC' ? '₿' : value === 'ETH' ? 'Ξ' : '$'}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Asset)}
        aria-label="Asset to receive"
      >
        {SUPPORTED_ASSETS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );
}

function MethodSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="quote-pill-select">
      <span className="quote-pill-icon">⚡</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Payment method"
      >
        <option value={ANY_METHOD}>Any payment method</option>
        {options.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <span className="quote-pill-chev">▾</span>
    </div>
  );
}
