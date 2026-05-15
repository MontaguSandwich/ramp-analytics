'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MultiSelectDropdown from './multi-select-dropdown';
import { fmtFiat } from '@/lib/format';

interface OrderbookLevel {
  rate: number;
  total_liquidity_usd: number;
  deposit_count: number;
  platforms: string[];
  top_deposit?: { depositor: string; deposit_id: string; escrow_address: string };
  pricing_mode?: 'fixed' | 'oracle' | 'mixed';
  oracle_spread_bps_min?: number;
  oracle_spread_bps_max?: number;
  oracle_sources?: string[];
  delegated_entry_count?: number;
  // Injected by /api/zkp2p/orderbook when a currency filter is set: level-wide intent
  // range across all deposits at this rate, in USD. Absent for the unfiltered view.
  intent_min_usd?: number;
  intent_max_usd?: number;
}

interface OrderbookCurrency {
  currency: string;
  levels: OrderbookLevel[];
  total_liquidity_usd: number;
  best_rate: number;
  fx_mid_rate: number;
}

interface OrderbookData {
  stats: {
    total_liquidity_usd: number;
    active_makers: number;
    volume24h_usd: number;
    active_intents: number;
  };
  orderbooks: OrderbookCurrency[];
  activity?: Array<unknown>;
  filters: {
    applied: Record<string, unknown>;
    available: {
      currencies: string[];
      platforms: string[];
      currencies_by_platform?: Record<string, string[]>;
    };
  };
}

interface OrderbookEnvelope {
  data: OrderbookData;
}

const POLL_MS = 30_000;
const META_REFRESH_MS = 5 * 60_000;
// ±10 bps neutral band — see binance-p2p-orderbook-view.tsx for rationale. Kept in
// lockstep so the two orderbook pages render color identically.
const SPREAD_NEUTRAL_BPS = 10;

type SortKey = 'spread' | 'liquidity' | 'deposits' | 'platforms';

const SORT_LABELS: Record<SortKey, string> = {
  spread: 'Best rate',
  liquidity: 'Most liquidity',
  deposits: 'Most deposits',
  platforms: 'Most platforms',
};

function fmtUsd(n: number | undefined): string {
  if (n == null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtRate(n: number): string {
  return n.toFixed(4);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

// Peerlytics' pricing_mode tells you whether the level's rate is static or moves with an
// oracle. Surfaced as binary (Fixed / Float) per product decision; 'mixed' is rare enough
// to keep an honest third label.
function pricingModeLabel(m: 'fixed' | 'oracle' | 'mixed' | undefined): string {
  if (m === 'fixed') return 'Fixed';
  if (m === 'oracle') return 'Float';
  if (m === 'mixed') return 'Mixed';
  return '—';
}

function avgSpreadBps(level: OrderbookLevel, fxMid: number): number {
  if (
    typeof level.oracle_spread_bps_min === 'number' &&
    typeof level.oracle_spread_bps_max === 'number'
  ) {
    return (level.oracle_spread_bps_min + level.oracle_spread_bps_max) / 2;
  }
  if (fxMid > 0 && level.rate > 0) {
    return ((level.rate - fxMid) / fxMid) * 10_000;
  }
  return 0;
}

function spreadColor(bps: number): string {
  if (bps < -SPREAD_NEUTRAL_BPS) return 'var(--prov-good)';
  if (bps > SPREAD_NEUTRAL_BPS) return 'var(--warn)';
  return 'var(--fg-mute)';
}

function fmtSpreadPct(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  const pct = bps / 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export default function OrderbookView() {
  const [currency, setCurrency] = useState<string>('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [minSize, setMinSize] = useState<string>('50');
  const [sort, setSort] = useState<SortKey>('spread');

  const [meta, setMeta] = useState<OrderbookData | null>(null);
  const [data, setData] = useState<OrderbookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const lastReqId = useRef(0);

  // Fetch meta (unfiltered) on mount and every 5 min for dropdown counts + filter pools.
  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const resp = await fetch('/api/zkp2p/orderbook');
        if (!resp.ok) return;
        const body = (await resp.json()) as OrderbookEnvelope;
        setMeta(body.data);
      } catch {
        // silent — meta is informational
      }
    };
    fetchMeta();
    const t = setInterval(fetchMeta, META_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Fetch filtered view on filter change + every 30s.
  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      const reqId = ++lastReqId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (currency) params.set('currency', currency);
      for (const p of platforms) params.append('platform', p);
      if (minSize) params.set('minSize', minSize);
      try {
        const resp = await fetch(`/api/zkp2p/orderbook?${params.toString()}`, { signal });
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }
        const body = (await resp.json()) as OrderbookEnvelope;
        if (reqId !== lastReqId.current) return;
        setData(body.data);
        // If no currency filter is active, we just got an unfiltered response — refresh meta too.
        if (!currency) setMeta(body.data);
        setLastFetched(Date.now());
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (reqId !== lastReqId.current) return;
        setError((e as Error).message);
      } finally {
        if (reqId === lastReqId.current) setLoading(false);
      }
    },
    [currency, platforms, minSize],
  );

  useEffect(() => {
    const ac = new AbortController();
    fetchData(ac.signal);
    const t = setInterval(() => fetchData(), POLL_MS);
    return () => {
      ac.abort();
      clearInterval(t);
    };
  }, [fetchData]);

  // Derived: currency options with level counts (top 6 known, rest unknown).
  const currencyOptions = useMemo(() => {
    if (!meta) return [];
    const counts = new Map<string, number>();
    for (const ob of meta.orderbooks ?? []) counts.set(ob.currency, ob.levels.length);
    const all = meta.filters?.available?.currencies ?? [];
    return all.map((c) => ({ code: c, count: counts.get(c) ?? null }));
  }, [meta]);

  // The standalone "Best rates" panel was dropped — its info is already surfaced in
  // each row's Spread column (sorted ascending by default). If it ever needs to come
  // back as a sidebar or callout, restore from git history.

  // Memoized so the `?? []` fallback doesn't return a fresh array every render before
  // meta loads — otherwise it cascades into `activePlatformPool` and the platform-filter
  // effect, looping until "Maximum update depth exceeded."
  const availablePlatforms = useMemo(
    () => meta?.filters?.available?.platforms ?? [],
    [meta],
  );

  // Flat levels with currency context, sorted per user choice.
  const sortedLevels = useMemo(() => {
    if (!data) return [];
    const flat = (data.orderbooks ?? []).flatMap((ob) =>
      ob.levels.map((lvl) => ({
        ...lvl,
        currency: ob.currency,
        fx_mid_rate: ob.fx_mid_rate,
        spread_bps: avgSpreadBps(lvl, ob.fx_mid_rate),
      })),
    );
    flat.sort((a, b) => {
      if (sort === 'spread') return a.spread_bps - b.spread_bps;
      if (sort === 'liquidity') return b.total_liquidity_usd - a.total_liquidity_usd;
      if (sort === 'deposits') return b.deposit_count - a.deposit_count;
      if (sort === 'platforms') return b.platforms.length - a.platforms.length;
      return 0;
    });
    return flat.slice(0, 200);
  }, [data, sort]);

  // Per-currency platform pool — invert meta.filters.available.currencies_by_platform
  // (platform → currencies[]) into a (currency → platforms[]) map. When a currency is
  // selected, the platforms dropdown narrows to those that serve it. Matches the
  // fiat-aware picker pattern from binance-p2p-orderbook-view.
  const platformsByCurrency = useMemo(() => {
    const cbp = meta?.filters?.available?.currencies_by_platform ?? {};
    const out: Record<string, string[]> = {};
    for (const [platform, currs] of Object.entries(cbp)) {
      for (const c of currs) {
        (out[c] ||= []).push(platform);
      }
    }
    return out;
  }, [meta]);

  const activePlatformPool = useMemo(() => {
    if (currency && platformsByCurrency[currency]?.length) {
      return platformsByCurrency[currency];
    }
    return availablePlatforms;
  }, [currency, platformsByCurrency, availablePlatforms]);

  // When currency changes, drop selected platforms that don't apply anymore. Return the
  // same `cur` reference when nothing actually filters out — otherwise React treats every
  // empty-filter call as a state change and re-runs the effect (loops with activePlatformPool).
  useEffect(() => {
    setPlatforms((cur) => {
      const next = cur.filter((p) => activePlatformPool.includes(p));
      return next.length === cur.length ? cur : next;
    });
  }, [activePlatformPool]);

  // For the "Showing N of M" stat — count of levels in the current filtered view
  // (already in sortedLevels) vs total available across all currencies in meta.
  const totalLevelsInMeta = useMemo(() => {
    if (!meta) return 0;
    return (meta.orderbooks ?? []).reduce((s, ob) => s + (ob.levels?.length ?? 0), 0);
  }, [meta]);

  // Local-fiat equivalent of the filtered liquidity. Only meaningful when a single
  // currency is selected (otherwise we'd be mixing fiats). Per level:
  //   total_liquidity_usd × rate  ≈  USDC × (fiat/USDC)  ≈  fiat amount
  const localFiatLiquidity = useMemo(() => {
    if (!currency || !data) return null;
    const ob = (data.orderbooks ?? []).find((o) => o.currency === currency);
    if (!ob) return null;
    let total = 0;
    for (const l of ob.levels ?? []) {
      if (l.rate > 0 && Number.isFinite(l.rate)) total += l.total_liquidity_usd * l.rate;
    }
    return total > 0 ? total : null;
  }, [currency, data]);

  return (
    <>
      <div className="orderbook-controls">
        <div className="orderbook-control">
          <label className="filter-label">Currency</label>
          <select
            className="orderbook-input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="">All (top 6)</option>
            {currencyOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
                {c.count != null ? ` (${c.count} level${c.count === 1 ? '' : 's'})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="orderbook-control">
          <label className="filter-label">
            Payment platforms{' '}
            <span className="muted">
              ({activePlatformPool.length}
              {currency ? ` for ${currency}` : ''})
            </span>
          </label>
          <MultiSelectDropdown
            options={activePlatformPool}
            selected={platforms}
            onChange={setPlatforms}
            placeholder="All platforms"
          />
        </div>
        <div className="orderbook-control">
          <label className="filter-label">Min size (USD)</label>
          <input
            className="orderbook-input"
            type="number"
            min="0"
            value={minSize}
            onChange={(e) => setMinSize(e.target.value)}
            style={{ minWidth: 100 }}
          />
        </div>
        <div className="orderbook-control">
          <label className="filter-label">Sort by</label>
          <select
            className="orderbook-input"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="orderbook-control" style={{ alignSelf: 'flex-end' }}>
          <button
            className="clear-btn"
            type="button"
            onClick={() => fetchData()}
            disabled={loading}
            title="Force refresh"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="last-updated">
            {lastFetched ? `Updated ${fmtTime(lastFetched)}` : 'Loading…'}
          </span>
        </div>
      </div>

      {error ? (
        <div className="no-results" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {error}
        </div>
      ) : null}

      {data?.stats ? (
        <div className="orderbook-stats">
          <div className="orderbook-stat">
            <div className="orderbook-stat-label">Liquidity</div>
            <div className="orderbook-stat-value mono">
              {fmtUsd(data.stats.total_liquidity_usd)}
              {localFiatLiquidity != null ? (
                <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                  ≈ {fmtFiat(localFiatLiquidity, currency)}
                </div>
              ) : null}
            </div>
          </div>
          <div className="orderbook-stat">
            <div className="orderbook-stat-label">Active makers</div>
            <div className="orderbook-stat-value mono">{data.stats.active_makers}</div>
          </div>
          <div className="orderbook-stat">
            <div className="orderbook-stat-label">Showing</div>
            <div className="orderbook-stat-value mono">
              {sortedLevels.length}
              {totalLevelsInMeta > sortedLevels.length ? (
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {' '}
                  of {totalLevelsInMeta}
                </span>
              ) : null}
              <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                {' '}levels
              </span>
            </div>
          </div>
          <div className="orderbook-stat">
            <div className="orderbook-stat-label">24h volume</div>
            <div className="orderbook-stat-value mono">{fmtUsd(data.stats.volume24h_usd)}</div>
          </div>
        </div>
      ) : null}

      {sortedLevels.length === 0 && !loading ? (
        <div className="no-results">No matching orderbook levels for these filters.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Currency</th>
                <th>Rate</th>
                <th>FX mid</th>
                <th>Spread</th>
                <th>Liquidity</th>
                <th>Limits</th>
                <th>Deposits</th>
                <th>Platforms</th>
                <th>Pricing</th>
              </tr>
            </thead>
            <tbody>
              {sortedLevels.map((l, i) => (
                <tr key={`${l.currency}-${l.rate}-${i}`}>
                  <td>
                    <span className="tag">{l.currency}</span>
                  </td>
                  <td className="mono">{fmtRate(l.rate)}</td>
                  <td className="mono muted">{fmtRate(l.fx_mid_rate)}</td>
                  <td className="mono" style={{ color: spreadColor(l.spread_bps), fontWeight: 500 }}>
                    {fmtSpreadPct(l.spread_bps)}
                  </td>
                  <td className="mono">{fmtUsd(l.total_liquidity_usd)}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {l.intent_min_usd != null && l.intent_max_usd != null
                      ? `${fmtUsd(l.intent_min_usd)} – ${fmtUsd(l.intent_max_usd)}`
                      : '—'}
                  </td>
                  <td className="mono">{l.deposit_count}</td>
                  <td>
                    <div className="fiats-list">
                      {l.platforms.slice(0, 3).map((p) => (
                        <span key={p} className="tag">
                          {p}
                        </span>
                      ))}
                      {l.platforms.length > 3 ? (
                        <span className="tag muted">+{l.platforms.length - 3}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="mono muted" style={{ fontSize: 11 }}>
                    {pricingModeLabel(l.pricing_mode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="muted" style={{ fontSize: 11, margin: '12px 4px' }}>
        Source: Peerlytics /orderbook · auto-refreshes every 30s · upstream cache 30s · taker view (buying USDC)
      </div>
    </>
  );
}
