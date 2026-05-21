'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MultiSelectDropdown from './multi-select-dropdown';
import { fmtFiat, fmtUsd } from '@/lib/format';

interface MakerInfo {
  userNo: string;
  nickname: string;
  month_orders: number | null;
  finish_rate: number | null;
}

interface NormalizedAd {
  advNo: string;
  fiat: string;
  asset: string;
  tradeType: 'BUY' | 'SELL';
  price: number;
  surplus_amount: number;
  min_single_tx: number;
  max_single_tx: number;
  payment_methods: string[];
  maker: MakerInfo;
}

interface OrderbookData {
  stats: {
    fiat: string;
    asset: string;
    tradeType: 'BUY' | 'SELL';
    n_ads: number;
    n_makers: number;
    total_offer_value: number;
    total_available: number;
    /** CoinGecko mid for (asset, fiat). Null when no rate available. */
    fx_mid_rate: number | null;
  };
  ads: NormalizedAd[];
}

interface OrderbookEnvelope {
  data: OrderbookData;
}

interface Props {
  /** Active fiats from snapshot.coverage. */
  fiats: string[];
  /** Global unique payment-method identifiers (~733) — used as the fallback pool. */
  paymentMethods: string[];
  /**
   * Per-fiat method lists. When a fiat is selected, the chip pool is filtered to this
   * subset (matches Binance's own UI behavior — TND → 13 methods, USD → 175, etc.).
   * Empty/missing entry → fall back to the global `paymentMethods` pool.
   */
  methodsByFiat: Record<string, string[]>;
}

const POLL_MS = 30_000;
const ASSETS = ['USDT', 'BTC', 'ETH', 'USDC', 'BNB', 'FDUSD'] as const;
const LIMIT_OPTIONS = [20, 50, 100, 200] as const;
// Default to 100 ads (5 pages) to match the snapshot's multi-page probing depth, so the
// orderbook page and the venue detail page report consistent per-fiat liquidity. Users
// can still narrow to 20/50 or go deeper to 200 via the selector.
const DEFAULT_LIMIT: (typeof LIMIT_OPTIONS)[number] = 100;

type SortKey = 'price' | 'amount' | 'maker_orders' | 'finish_rate';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function fmtAmount(n: number, frac = 2): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: frac });
}

// ±10 bps neutral band — chosen so stablecoin-pegged pairs (USDT/USD, USDT/EUR) where
// most spreads sit between -20 and +5 actually trigger color. ±25 was inherited from
// zkp2p's earlier design and washed out everything to muted gray.
const SPREAD_NEUTRAL_BPS = 10;

function spreadBps(price: number, fxMid: number | null, tradeType: 'BUY' | 'SELL'): number | null {
  if (fxMid == null || !Number.isFinite(fxMid) || fxMid <= 0) return null;
  // BUY = taker buying crypto → maker SELL ad → price > mid means premium → positive (worse).
  // SELL = taker selling crypto → maker BUY ad → price < mid means discount → negative (worse).
  // Same sign convention as zkp2p: negative = favorable for taker.
  const raw = ((price - fxMid) / fxMid) * 10_000;
  return tradeType === 'BUY' ? raw : -raw;
}

function fmtSpreadPct(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  const pct = bps / 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function spreadColor(bps: number | null): string {
  if (bps == null) return 'var(--fg-mute)';
  if (bps < -SPREAD_NEUTRAL_BPS) return 'var(--prov-good)';
  if (bps > SPREAD_NEUTRAL_BPS) return 'var(--warn)';
  return 'var(--fg-mute)';
}

export default function BinanceP2pOrderbookView({ fiats, paymentMethods, methodsByFiat }: Props) {
  const [fiat, setFiat] = useState(() => (fiats.includes('USD') ? 'USD' : fiats[0] ?? 'USD'));
  const [asset, setAsset] = useState<(typeof ASSETS)[number]>('USDT');
  const [tradeType, setTradeType] = useState<'BUY' | 'SELL'>('BUY');
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('price');
  const [limit, setLimit] = useState<(typeof LIMIT_OPTIONS)[number]>(DEFAULT_LIMIT);

  const [data, setData] = useState<OrderbookData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const lastReqId = useRef(0);

  // Pool of methods to show in the chip filter, scoped to the currently-selected fiat.
  // Matches Binance's own UI behavior (TND → 13 methods, USD → 175, etc.).
  // Fall back to the global set if we don't have a per-fiat entry for this currency.
  const activeMethodPool = useMemo(() => {
    const perFiat = methodsByFiat[fiat];
    return perFiat && perFiat.length > 0 ? perFiat : paymentMethods;
  }, [fiat, methodsByFiat, paymentMethods]);

  // When the fiat changes, drop selected methods that don't apply to the new fiat.
  // Avoids the API silently returning empty because the maker can't accept that method.
  useEffect(() => {
    setSelectedMethods((cur) => cur.filter((m) => activeMethodPool.includes(m)));
  }, [activeMethodPool]);

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      const reqId = ++lastReqId.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set('fiat', fiat);
      params.set('asset', asset);
      params.set('tradeType', tradeType);
      params.set('limit', String(limit));
      for (const m of selectedMethods) params.append('payType', m);
      try {
        const resp = await fetch(`/api/binance_p2p/orderbook?${params.toString()}`, { signal });
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as { error?: string; detail?: string };
          throw new Error(body.detail ?? body.error ?? `HTTP ${resp.status}`);
        }
        const body = (await resp.json()) as OrderbookEnvelope;
        if (reqId !== lastReqId.current) return;
        setData(body.data);
        setLastFetched(Date.now());
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (reqId !== lastReqId.current) return;
        setError((e as Error).message);
      } finally {
        if (reqId === lastReqId.current) setLoading(false);
      }
    },
    [fiat, asset, tradeType, selectedMethods, limit],
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

  // USD equivalent of the local-fiat liquidity. For USDT pairs the surplus_amount is
  // in USDT (≈$1), so summing it directly gives USD. For other assets (BTC/ETH/etc)
  // we don't have an FX mid in the response — skip the USD sub-line in that case to
  // stay honest. (A future enhancement could fetch a spot mid client-side.)
  const usdLiquidity = useMemo(() => {
    if (!data?.ads?.length) return null;
    if (asset !== 'USDT') return null;
    const total = data.ads.reduce((acc, a) => acc + a.surplus_amount, 0);
    return total > 0 ? total : null;
  }, [data, asset]);

  const sortedAds = useMemo(() => {
    if (!data?.ads) return [];
    const flat = [...data.ads];
    flat.sort((a, b) => {
      if (sort === 'price') {
        // BUY: lower price is better for taker. SELL: higher price is better for taker.
        return tradeType === 'BUY' ? a.price - b.price : b.price - a.price;
      }
      if (sort === 'amount') return b.surplus_amount - a.surplus_amount;
      if (sort === 'maker_orders') return (b.maker.month_orders ?? 0) - (a.maker.month_orders ?? 0);
      if (sort === 'finish_rate') return (b.maker.finish_rate ?? 0) - (a.maker.finish_rate ?? 0);
      return 0;
    });
    return flat;
  }, [data, sort, tradeType]);

  return (
    <>
      <div className="orderbook-controls">
        <div className="orderbook-control">
          <label className="filter-label">Fiat</label>
          <select
            className="orderbook-input"
            value={fiat}
            onChange={(e) => setFiat(e.target.value)}
          >
            {fiats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="orderbook-control">
          <label className="filter-label">Asset</label>
          <select
            className="orderbook-input"
            value={asset}
            onChange={(e) => setAsset(e.target.value as (typeof ASSETS)[number])}
          >
            {ASSETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="orderbook-control">
          <label className="filter-label">Direction</label>
          <select
            className="orderbook-input"
            value={tradeType}
            onChange={(e) => setTradeType(e.target.value as 'BUY' | 'SELL')}
          >
            <option value="BUY">BUY (taker buys crypto)</option>
            <option value="SELL">SELL (taker sells crypto)</option>
          </select>
        </div>

        <div className="orderbook-control">
          <label className="filter-label">
            Payment methods{' '}
            <span className="muted">
              ({activeMethodPool.length} for {fiat})
            </span>
          </label>
          <MultiSelectDropdown
            options={activeMethodPool}
            selected={selectedMethods}
            onChange={setSelectedMethods}
            placeholder="All payment methods"
          />
        </div>

        <div className="orderbook-control">
          <label className="filter-label">Show</label>
          <select
            className="orderbook-input"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) as (typeof LIMIT_OPTIONS)[number])}
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </div>

        <div className="orderbook-control">
          <label className="filter-label">Sort by</label>
          <select
            className="orderbook-input"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="price">
              {tradeType === 'BUY' ? 'Best (lowest) price' : 'Best (highest) price'}
            </option>
            <option value="amount">Most available</option>
            <option value="maker_orders">Most active maker</option>
            <option value="finish_rate">Highest finish rate</option>
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
              {fmtFiat(data.stats.total_offer_value, data.stats.fiat)}
              <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                {' '}slice
              </span>
              {usdLiquidity != null ? (
                <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                  ≈ {fmtUsd(usdLiquidity)}
                </div>
              ) : null}
            </div>
          </div>
          <div className="orderbook-stat">
            <div className="orderbook-stat-label">Active makers</div>
            <div className="orderbook-stat-value mono">{data.stats.n_makers}</div>
          </div>
          <div className="orderbook-stat">
            <div className="orderbook-stat-label">Showing</div>
            <div className="orderbook-stat-value mono">
              {data.stats.n_ads}
              {data.stats.total_available > data.stats.n_ads ? (
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {' '}
                  of {data.stats.total_available}
                </span>
              ) : null}
              <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                {' '}ads
              </span>
            </div>
          </div>
          <div className="orderbook-stat">
            <div className="orderbook-stat-label">24h volume</div>
            <div
              className="orderbook-stat-value"
              style={{ color: 'var(--fg-mute)', fontSize: 14, fontWeight: 400 }}
              title="Binance does not separately disclose P2P volume"
            >
              Not disclosed
            </div>
          </div>
        </div>
      ) : null}

      {sortedAds.length === 0 && !loading ? (
        <div className="no-results">
          No {tradeType} ads for {asset}/{fiat}.
          {selectedMethods.length ? ' Try clearing the payment-method filters.' : ''}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Maker</th>
                <th>
                  Price ({fiat}/{asset})
                </th>
                <th>FX mid</th>
                <th>Spread</th>
                <th>Available ({asset})</th>
                <th>Limits ({fiat})</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {sortedAds.map((ad) => (
                <tr key={ad.advNo}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{ad.maker.nickname}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {ad.maker.month_orders != null ? `${ad.maker.month_orders} orders/30d` : '—'}
                      {ad.maker.finish_rate != null
                        ? ` · ${(ad.maker.finish_rate * 100).toFixed(0)}% finish`
                        : ''}
                    </div>
                  </td>
                  <td className="mono">{ad.price.toFixed(4)}</td>
                  <td className="mono muted">
                    {data?.stats.fx_mid_rate != null ? data.stats.fx_mid_rate.toFixed(4) : '—'}
                  </td>
                  <td
                    className="mono"
                    style={{
                      color: spreadColor(spreadBps(ad.price, data?.stats.fx_mid_rate ?? null, tradeType)),
                      fontWeight: 500,
                    }}
                  >
                    {fmtSpreadPct(spreadBps(ad.price, data?.stats.fx_mid_rate ?? null, tradeType))}
                  </td>
                  <td className="mono">{fmtAmount(ad.surplus_amount, 2)}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>
                    {fmtAmount(ad.min_single_tx, 0)} – {fmtAmount(ad.max_single_tx, 0)}
                  </td>
                  <td>
                    <div className="fiats-list">
                      {ad.payment_methods.slice(0, 3).map((p) => (
                        <span key={p} className="tag">
                          {p}
                        </span>
                      ))}
                      {ad.payment_methods.length > 3 ? (
                        <span className="tag muted">+{ad.payment_methods.length - 3}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="muted" style={{ fontSize: 11, margin: '12px 4px' }}>
        Source: Binance{' '}
        <span className="mono">bapi/c2c/v2/friendly/c2c/adv/search</span> · auto-refreshes every 30s
        · upstream cache 20s · server paginates {LIMIT_OPTIONS[LIMIT_OPTIONS.length - 1]} ads max (
        {Math.ceil(LIMIT_OPTIONS[LIMIT_OPTIONS.length - 1] / 20)} parallel pages)
      </div>
    </>
  );
}
