import {
  apiGetQuotesBestByPlatform,
  getContracts,
  type QuotesBestByPlatformRequest,
  type RuntimeEnv,
} from '@zkp2p/sdk';
import type {
  Adapter,
  Snapshot,
  QuoteRequest,
  QuoteResponse,
  DailyPoint,
  Market,
} from '../lib/types.ts';
import {
  getOverview,
  getSummary,
  getOrderbook,
  getMetaCurrencies,
} from '../lib/peerlytics.ts';
import { unique } from '../lib/stats.ts';

const PRODUCT_ID = 'zkp2p';
const CHAIN_ID = 8453;
const RUNTIME_ENV: RuntimeEnv = 'production';
const BASE_API_URL = 'https://api.zkp2p.xyz';
const USDC_DECIMALS = 6;

const { addresses } = getContracts(CHAIN_ID, RUNTIME_ENV);

const CONTRACT_ADDRS: string[] = unique(
  [addresses.escrow, addresses.escrowV2].filter((a): a is `0x${string}` => Boolean(a)),
);

function avgSpreadBpsFromLevel(
  level: { oracle_spread_bps_min?: number; oracle_spread_bps_max?: number; rate: number },
  fxMid: number,
): number {
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

function weightedMedianAbsSpread(
  levels: Array<{ spread_bps: number; weight: number }>,
): number | null {
  if (!levels.length) return null;
  const sorted = [...levels].sort((a, b) => a.spread_bps - b.spread_bps);
  const totalWeight = sorted.reduce((s, l) => s + l.weight, 0);
  if (totalWeight <= 0) return null;
  let cum = 0;
  for (const l of sorted) {
    cum += l.weight;
    if (cum >= totalWeight / 2) return Math.abs(l.spread_bps);
  }
  return Math.abs(sorted[sorted.length - 1].spread_bps);
}

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();

  const [overview, summary30, orderbook, metaCurrencies] = await Promise.all([
    getOverview(),
    getSummary({ range: 'last_30d' }),
    getOrderbook(),
    getMetaCurrencies().catch(() => ({ currencies: [] })),
  ]);

  // Build code → flag emoji map from meta/currencies.
  const fiat_flags: Record<string, string> = {};
  for (const c of metaCurrencies.currencies ?? []) {
    if (c.flag) fiat_flags[c.code] = c.flag;
  }

  const tvl_usd = overview.snapshot?.active_liquidity_usd ?? 0;
  const active_deposits = overview.snapshot?.active_deposits ?? 0;
  const active_makers_30d = summary30.summary?.unique_makers ?? 0;
  const active_takers_30d = summary30.summary?.unique_takers ?? 0;
  const volume_30d = summary30.summary?.settled_volume_usd ?? null;

  // Spread: liquidity-weighted median of orderbook levels' average oracle spread.
  const spreadLevels: Array<{ spread_bps: number; weight: number }> = [];
  for (const ob of orderbook.orderbooks ?? []) {
    for (const l of ob.levels ?? []) {
      if (
        typeof l.oracle_spread_bps_min === 'number' &&
        typeof l.oracle_spread_bps_max === 'number'
      ) {
        const avg = (l.oracle_spread_bps_min + l.oracle_spread_bps_max) / 2;
        spreadLevels.push({ spread_bps: avg, weight: l.total_liquidity_usd });
      }
    }
  }
  const median_spread = weightedMedianAbsSpread(spreadLevels);

  // Fee sample (kept for backward compatibility — used by other products' detail rendering).
  const sample_rows = (orderbook.orderbooks ?? [])
    .slice(0, 5)
    .map((ob) => {
      const top = ob.levels[0];
      if (!top || !ob.fx_mid_rate || !top.rate) return null;
      const effective_rate_bps = Math.round(((ob.fx_mid_rate / top.rate) - 1) * 10_000);
      return {
        fiat: ob.currency,
        asset: 'USDC',
        payment_method: top.platforms[0] ?? 'mixed',
        effective_rate_bps,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Markets: one (currency, platform) row per active market, computed by walking
  // every level and picking the best rate (lowest spread) per (currency, platform).
  // Sums liquidity and counts deposits across all levels for that pair.
  const marketsMap = new Map<
    string,
    { currency: string; platform: string; best_rate: number; fx_mid_rate: number; spread_bps: number; total_liquidity_usd: number; deposit_count: number }
  >();
  for (const ob of orderbook.orderbooks ?? []) {
    for (const l of ob.levels ?? []) {
      const sp = avgSpreadBpsFromLevel(l, ob.fx_mid_rate);
      // Each level can list multiple platforms; allocate the level's liquidity
      // proportionally would be more accurate, but for v1 we attribute the level
      // to each platform it lists (so liquidity may be over-counted in the
      // multi-platform case — acceptable for a market summary view; a
      // pure-platform attribution would need per-platform deposits which the
      // orderbook doesn't expose).
      const platforms = l.platforms.length ? l.platforms : ['mixed'];
      for (const platform of platforms) {
        const key = `${ob.currency}|${platform}`;
        const cur = marketsMap.get(key);
        if (!cur) {
          marketsMap.set(key, {
            currency: ob.currency,
            platform,
            best_rate: l.rate,
            fx_mid_rate: ob.fx_mid_rate,
            spread_bps: sp,
            total_liquidity_usd: l.total_liquidity_usd,
            deposit_count: l.deposit_count,
          });
        } else {
          // Best rate is min spread (most negative for taker).
          if (sp < cur.spread_bps) {
            cur.spread_bps = sp;
            cur.best_rate = l.rate;
          }
          cur.total_liquidity_usd += l.total_liquidity_usd;
          cur.deposit_count += l.deposit_count;
        }
      }
    }
  }
  const markets: Market[] = [...marketsMap.values()].sort(
    (a, b) => b.total_liquidity_usd - a.total_liquidity_usd,
  );

  // Coverage from orderbook filters + summary metrics + meta/currencies flags.
  const coverage = {
    fiats: orderbook.filters?.available?.currencies ?? [],
    fiat_flags,
    platforms: orderbook.filters?.available?.platforms ?? [],
    currencies_by_platform: orderbook.filters?.available?.currencies_by_platform,
    active_markets: marketsMap.size,
    active_makers_window: active_makers_30d,
    active_takers_window: active_takers_30d,
    active_deposits,
    window: 'last_30d',
  };

  // Composition.
  const composition = {
    platforms: (summary30.composition?.platforms ?? []).map((p) => ({
      key: p.key,
      label: p.label,
      volume_usd: p.volume_usd,
      share_pct: p.share_pct,
      fulfilled_intents: p.fulfilled_intents,
    })),
    currencies: (summary30.composition?.currencies ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      volume_usd: c.volume_usd,
      share_pct: c.share_pct,
      fulfilled_intents: c.fulfilled_intents,
    })),
    period: 'last_30d',
  };

  // Network health from overview snapshot + composition labels.
  const topPlatformLabel =
    summary30.composition?.platforms?.[0]?.label ?? composition.platforms[0]?.label;
  const topCurrencyLabel =
    summary30.composition?.currencies?.[0]?.label ?? composition.currencies[0]?.label;

  const network_health = {
    median_fill_seconds: overview.snapshot?.median_fill_seconds,
    avg_fill_seconds: overview.snapshot?.avg_fill_seconds,
    success_rate_pct: summary30.summary?.success_rate_pct,
    top_maker_share_pct: overview.snapshot?.top_maker_liquidity_share_pct,
    top_platform_share_pct: overview.snapshot?.top_platform_share_pct,
    top_platform_label: topPlatformLabel,
    top_currency_share_pct: overview.snapshot?.top_currency_share_pct,
    top_currency_label: topCurrencyLabel,
  };

  return {
    liquidity: {
      value: {
        kind: 'onchain_inventory',
        tvl_usd,
        active_makers_30d,
        contract_addrs: CONTRACT_ADDRS,
      },
      provenance: 'api',
      last_verified: now,
      evidence_url: 'https://peerlytics.xyz/api/v1/analytics/overview',
    },
    volume_30d_usd: {
      value: volume_30d,
      provenance: 'api',
      last_verified: now,
      evidence_url: 'https://peerlytics.xyz/api/v1/analytics/summary?range=last_30d',
    },
    observed_spread_bps: {
      value: median_spread,
      provenance: 'api',
      spread_aggregation: 'median',
      sample_size: spreadLevels.length,
      period: 'orderbook_levels',
      last_verified: now,
      evidence_url: 'https://peerlytics.xyz/api/v1/orderbook',
      notes: 'liquidity-weighted median of |oracle spread| across orderbook levels',
    },
    fee_snapshot: { ts: now, sample_rows, provenance: 'api' },
    capabilities: { orderbook: true, quote: true },
    coverage: {
      value: coverage,
      provenance: 'api',
      last_verified: now,
      evidence_url: 'https://peerlytics.xyz/api/v1/orderbook',
    },
    composition: {
      value: composition,
      provenance: 'api',
      last_verified: now,
      evidence_url: 'https://peerlytics.xyz/api/v1/analytics/summary?range=last_30d',
    },
    markets: {
      value: markets,
      provenance: 'api',
      last_verified: now,
      evidence_url: 'https://peerlytics.xyz/api/v1/orderbook',
    },
    network_health: {
      value: network_health,
      provenance: 'api',
      last_verified: now,
      evidence_url: 'https://peerlytics.xyz/api/v1/analytics/overview',
    },
  };
}

async function quote(req: QuoteRequest): Promise<QuoteResponse | null> {
  if (req.chain !== 'base' || req.asset !== 'USDC' || !addresses.usdc) return null;

  const apiReq: QuotesBestByPlatformRequest = {
    fiatCurrency: req.fiat,
    user: '0x0000000000000000000000000000000000000000',
    recipient: '0x0000000000000000000000000000000000000000',
    destinationChainId: CHAIN_ID,
    destinationToken: addresses.usdc,
    amount: BigInt(Math.floor(req.amount * 10 ** USDC_DECIMALS)).toString(),
    isExactFiat: req.direction === 'buy',
  };

  try {
    const resp = await apiGetQuotesBestByPlatform(apiReq, BASE_API_URL);
    const platformQuotes = resp?.responseObject?.platformQuotes ?? [];
    const match = platformQuotes.find(
      (p) => p.platform === req.payment_method && p.available && p.bestQuote,
    );
    if (!match?.bestQuote) return null;

    const tokenOut = Number(match.bestQuote.tokenAmountFormatted);
    const fiatIn = Number(match.bestQuote.fiatAmountFormatted);
    const conversionRate = Number(match.bestQuote.conversionRate);
    return {
      product_id: PRODUCT_ID,
      effective_rate_bps: 0,
      fee_pct: 0,
      estimated_received: tokenOut,
      ttl_sec: 60,
      source: 'live',
      evidence: { kind: 'quote_endpoint', ref: 'apiGetQuotesBestByPlatform' },
      notes: `fiat=${fiatIn} rate=${conversionRate}`,
    };
  } catch {
    return null;
  }
}

async function history(days: number): Promise<DailyPoint[]> {
  // We pull volume + intent counts from overview.timeseries.activity (back to
  // genesis). The standing-balance "available liquidity" series is NOT in
  // Peerlytics — it's accumulated locally by the snapshot cron and merged in
  // by the frontend's data loader. So this function intentionally does not
  // populate liquidity_available_usd; it stays in the daily volume/trade
  // domain only.
  const overview = await getOverview();
  const activity = overview.timeseries?.activity ?? [];

  const since = Date.now() - days * 86_400_000;
  const points = activity
    .filter((p) => new Date(p.date).getTime() >= since)
    .map((p) => ({
      day: p.date,
      volume_usd: p.settled_volume_usd,
      median_spread_bps: 0,
      n_trades: p.trades,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return points;
}

const adapter: Adapter = { id: PRODUCT_ID, snapshot, quote, history };
export default adapter;
