'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Candidate {
  platform: string;
  deposit_id: string;
  depositor: string;
  rate: number;
  spread_bps: number;
  usdc_received: number;
  min_fiat: number;
  max_fiat: number;
  remaining_usd: number;
  is_oracle_backed: boolean;
}

interface QuoteResponse {
  candidates: Candidate[];
  best_per_platform: Candidate[];
  request: { fiat_amount: number; fiat_currency: string; payment_methods?: string[] };
  ts: number;
}

interface Props {
  fiats: string[];
  platforms: string[];
  fiatFlags: Record<string, string>;
}

const PLATFORM_LABEL_CASE: Record<string, string> = {
  cashapp: 'Cash App',
  paypal: 'PayPal',
  pay_pal: 'PayPal',
  n26: 'N26',
};

const PLATFORM_LOGO_SLUG: Record<string, string> = {
  venmo: 'venmo',
  paypal: 'paypal',
  pay_pal: 'paypal',
  revolut: 'revolut',
  wise: 'wise',
  monzo: 'monzo',
  cashapp: 'cashapp',
  'cash app': 'cashapp',
  zelle: 'zelle',
  chime: 'chime',
  n26: 'n26',
};

const ANY_PLATFORM = '__any__';
const PEER_BUY_URL = 'https://www.peer.xyz/swap?tab=buy';
const STALE_SECS = 60;
const FETCH_DEBOUNCE_MS = 350;
const COMPARISON_MAX = 5;

function platformLabel(p: string): string {
  const k = p.toLowerCase().replace(/\s+/g, '');
  return PLATFORM_LABEL_CASE[k] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

function platformLogoSlug(p: string): string | null {
  return (
    PLATFORM_LOGO_SLUG[p.toLowerCase()] ??
    PLATFORM_LOGO_SLUG[p.toLowerCase().replace(/\s+/g, '')] ??
    null
  );
}

function spreadColor(bps: number): string {
  if (bps < -25) return 'var(--prov-good)';
  if (bps > 25) return 'var(--warn)';
  return 'var(--fg-mute)';
}

function fmtSpreadPct(bps: number): string {
  if (!Number.isFinite(bps)) return '—';
  const pct = bps / 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function fmtNumber(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function shortAddr(a: string): string {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function QuoteView({ fiats, platforms, fiatFlags }: Props) {
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>(fiats.includes('USD') ? 'USD' : fiats[0] ?? 'USD');
  const [platform, setPlatform] = useState<string>(ANY_PLATFORM);
  const [data, setData] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // forces stale-time recalculation
  const lastReqId = useRef(0);

  const numericAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  const fetchQuote = useCallback(async () => {
    if (!numericAmount || !currency) {
      setData(null);
      return;
    }
    const reqId = ++lastReqId.current;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/zkp2p/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fiat_amount: numericAmount,
          fiat_currency: currency,
          payment_methods: platform === ANY_PLATFORM ? [] : [platform],
        }),
      });
      const body = (await resp.json()) as Partial<QuoteResponse> & { error?: string };
      if (reqId !== lastReqId.current) return;
      if (!resp.ok) {
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      setData(body as QuoteResponse);
    } catch (e) {
      if (reqId === lastReqId.current) setError((e as Error).message);
    } finally {
      if (reqId === lastReqId.current) setLoading(false);
    }
  }, [numericAmount, currency, platform]);

  // Debounced fetch on input change.
  useEffect(() => {
    const t = setTimeout(fetchQuote, FETCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  // Tick every second to refresh the "fresh / stale" badge.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSecs = data ? Math.floor((Date.now() - data.ts) / 1000) : 0;
  const isStale = ageSecs > STALE_SECS;
  const best = data?.candidates[0] ?? null;
  // Comparison rows: in "Any" mode, one per platform (best per platform). In a
  // specific-platform mode, top deposits within that platform.
  const comparisonItems = useMemo(() => {
    if (!data) return [];
    if (platform === ANY_PLATFORM) {
      return data.best_per_platform.slice(0, COMPARISON_MAX);
    }
    return data.candidates.slice(0, COMPARISON_MAX);
  }, [data, platform]);
  const showComparison = comparisonItems.length >= 1;
  void tick; // tell linter we use this for re-render

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
            <CurrencySelect
              value={currency}
              options={fiats}
              flags={fiatFlags}
              onChange={setCurrency}
            />
          </div>
        </div>

        {/* Paying using */}
        <div className="quote-row">
          <label className="quote-row-label">Paying using</label>
          <div className="quote-row-controls">
            <PlatformSelect value={platform} options={platforms} onChange={setPlatform} />
          </div>
        </div>

        {/* You receive */}
        <div className="quote-row">
          <label className="quote-row-label">You receive</label>
          <div className="quote-row-controls">
            <div className="quote-amount quote-amount-readonly mono">
              {best ? fmtNumber(best.usdc_received, 2) : loading ? '…' : '0.00'}
            </div>
            <div className="quote-asset-pill">
              <span className="quote-asset-logo" aria-hidden>$</span>
              <span>USDC</span>
            </div>
          </div>
          {best ? (
            <div className="quote-row-sub">
              <span className="mono">rate {best.rate.toFixed(4)}</span>{' '}
              <span className="mono" style={{ color: spreadColor(best.spread_bps), fontWeight: 500 }}>
                {fmtSpreadPct(best.spread_bps)}
              </span>{' '}
              <span className="muted">via {platformLabel(best.platform)}</span>
            </div>
          ) : null}
        </div>

        {/* CTA */}
        <a
          href={PEER_BUY_URL}
          target="_blank"
          rel="noreferrer"
          className={`quote-cta${best ? '' : ' quote-cta-disabled'}`}
          aria-disabled={!best}
          onClick={(e) => {
            if (!best) e.preventDefault();
          }}
        >
          {best ? 'Open in Peer ↗' : numericAmount ? 'No quote available' : 'Enter amount'}
        </a>

        {/* Stale badge */}
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
            No matching deposit for {fmtNumber(numericAmount ?? 0, 2)} {currency}
            {platform !== ANY_PLATFORM ? ` via ${platformLabel(platform)}` : ''}. Try a different
            amount or change the platform filter.
          </div>
        ) : null}
      </div>

      {/* Comparison list — top 5 quotes */}
      {showComparison ? (
        <div className="quote-comparison">
          <div className="quote-comparison-title">
            {platform === ANY_PLATFORM ? 'Top platforms' : `Top ${platformLabel(platform)} deposits`}
            {' '}for {fmtNumber(numericAmount ?? 0, 0)} {currency}
          </div>
          <div className="quote-comparison-list">
            {comparisonItems.map((c, i) => (
              <div key={c.deposit_id} className={`quote-comparison-row${i === 0 ? ' quote-comparison-best' : ''}`}>
                <div className="quote-comparison-platform">
                  {i === 0 ? <span className="quote-best-badge">Best</span> : null}
                  <PlatformChip name={c.platform} />
                </div>
                <div className="quote-comparison-rate mono">
                  {fmtNumber(c.usdc_received, 2)} USDC
                </div>
                <div
                  className="mono"
                  style={{ color: spreadColor(c.spread_bps), fontWeight: 500, fontSize: 12 }}
                >
                  {fmtSpreadPct(c.spread_bps)}
                </div>
                <a
                  href={`https://basescan.org/address/${c.depositor}`}
                  target="_blank"
                  rel="noreferrer"
                  className="muted mono"
                  style={{ fontSize: 11 }}
                  title="View depositor on BaseScan"
                >
                  {shortAddr(c.depositor)}
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CurrencySelect({
  value,
  options,
  flags,
  onChange,
}: {
  value: string;
  options: string[];
  flags: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="quote-pill-select">
      <span className="quote-pill-icon">{flags[value] ?? '💱'}</span>
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

function PlatformSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const slug = value === ANY_PLATFORM ? null : platformLogoSlug(value);
  return (
    <div className="quote-pill-select">
      {slug ? (
        <img
          src={`https://cdn.simpleicons.org/${slug}/ffffff`}
          alt=""
          width={16}
          height={16}
          className="platform-logo"
        />
      ) : (
        <span className="quote-pill-icon">⚡</span>
      )}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Payment platform">
        <option value={ANY_PLATFORM}>Any platform</option>
        {options.map((p) => (
          <option key={p} value={p}>
            {platformLabel(p)}
          </option>
        ))}
      </select>
      <span className="quote-pill-chev">▾</span>
    </div>
  );
}

function PlatformChip({ name }: { name: string }) {
  const slug = platformLogoSlug(name);
  return (
    <span className="platform-chip" title={platformLabel(name)}>
      {slug ? (
        <img
          src={`https://cdn.simpleicons.org/${slug}/ffffff`}
          alt=""
          width={14}
          height={14}
          className="platform-logo"
        />
      ) : (
        <span className="platform-fallback">{platformLabel(name).charAt(0).toUpperCase()}</span>
      )}
      <span className="platform-label">{platformLabel(name)}</span>
    </span>
  );
}
