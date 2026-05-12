import type {
  Adapter,
  Snapshot,
  QuoteRequest,
  QuoteResponse,
  DailyPoint,
  Market,
} from '../lib/types.ts';
import { fxMid, fxMidBatch } from '../lib/fx.ts';
import { median, sum, unique } from '../lib/stats.ts';

const PRODUCT_ID = 'binance_p2p';
const SEARCH_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
const TRADE_METHODS_URL = 'https://www.binance.com/bapi/c2c/v1/public/c2c/agent/trade-methods';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * ISO 4217 codes most likely to appear on Binance P2P. Empirically probed: ~98 return
 * payment-method enumerations, ~36 return empty (markets Binance has withdrawn from —
 * NGN, RUB, KRW, SGD, THB, etc.). Adjust freely; anything not on this list simply won't
 * appear in coverage. Binance does not expose a fiat-list endpoint we can derive from.
 */
const CANDIDATE_FIATS: readonly string[] = [
  'AED', 'AFN', 'ALL', 'AMD', 'ARS', 'AUD', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD',
  'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUP', 'CZK',
  'DJF', 'DKK', 'DOP', 'DZD',
  'EGP', 'ERN', 'ETB', 'EUR',
  'GBP', 'GEL', 'GHS', 'GMD', 'GNF', 'GTQ', 'GYD',
  'HKD', 'HNL', 'HRK', 'HTG', 'HUF',
  'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK',
  'JMD', 'JOD', 'JPY',
  'KES', 'KGS', 'KHR', 'KMF', 'KRW', 'KWD', 'KYD', 'KZT',
  'LAK', 'LBP', 'LKR', 'LRD', 'LYD',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN',
  'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD',
  'OMR',
  'PAB', 'PEN', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR',
  'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SCR', 'SDG', 'SEK', 'SGD', 'SLL', 'SOS', 'SRD', 'SSP', 'SVC', 'SYP',
  'THB', 'TJS', 'TMT', 'TND', 'TRY', 'TTD', 'TWD', 'TZS',
  'UAH', 'UGX', 'USD', 'UYU', 'UZS',
  'VES', 'VND',
  'XAF', 'XCD', 'XOF',
  'YER',
  'ZAR', 'ZMW',
];

interface BinanceAdv {
  advNo: string;
  asset: string;
  fiatUnit: string;
  price: string;
  surplusAmount: string;
  tradableQuantity?: string;
  minSingleTransAmount: string;
  maxSingleTransAmount: string;
  tradeType: 'BUY' | 'SELL';
  tradeMethods?: Array<{ identifier?: string; tradeMethodName?: string }>;
}

interface BinanceAdvertiser {
  userNo: string;
  nickName?: string;
  monthOrderCount?: number;
  monthFinishRate?: number;
}

interface BinanceAd {
  adv: BinanceAdv;
  advertiser: BinanceAdvertiser;
}

interface BinanceSearchResp {
  code: string;
  data?: BinanceAd[];
  total?: number;
  success?: boolean;
  message?: string | null;
}

interface SearchParams {
  fiat: string;
  asset: string;
  tradeType: 'BUY' | 'SELL';
  payTypes?: string[];
  rows?: number;
}

interface SearchResult {
  ads: BinanceAd[];
  /** Total ads Binance reports in the full book for these filters (not just this page). */
  total: number;
}

async function search(params: SearchParams): Promise<SearchResult> {
  const body = {
    fiat: params.fiat,
    page: 1,
    rows: params.rows ?? 20,
    tradeType: params.tradeType,
    asset: params.asset,
    countries: [],
    payTypes: params.payTypes ?? [],
    publisherType: null,
  };

  const resp = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': UA,
      origin: 'https://p2p.binance.com',
      referer: 'https://p2p.binance.com/',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Binance P2P ${resp.status}`);
  const data = (await resp.json()) as BinanceSearchResp;
  if (data.code !== '000000') throw new Error(`Binance P2P code=${data.code} msg=${data.message}`);
  return { ads: data.data ?? [], total: data.total ?? 0 };
}

interface BinanceTradeMethod {
  identifier?: string;
  tradeMethodName?: string;
  tradeMethodShortName?: string | null;
}

interface BinanceTradeMethodsResp {
  code: string;
  data?: BinanceTradeMethod[] | null;
  message?: string | null;
  success?: boolean;
}

interface TradeMethodsCoverage {
  /** Sorted ISO codes Binance P2P has live methods for (~98 in practice). */
  activeFiats: string[];
  /**
   * Sorted ISO codes Binance lists but has withdrawn liquidity from (~36). Cross-verified:
   * for every fiat in this list, `adv/search` also returns 0 ads at probe time.
   */
  inactiveFiats: string[];
  /** Sorted unique payment-method identifiers across all active fiats (~772). */
  allMethods: string[];
  /**
   * Per-fiat sorted method lists. Drives the UI's fiat-aware method picker
   * (e.g. selecting TND in the orderbook view shows only those 13 methods, not
   * the global 733). Keys are the fiats in `activeFiats`.
   */
  methodsByFiat: Record<string, string[]>;
}

/**
 * Probe the public `agent/trade-methods` endpoint across CANDIDATE_FIATS in parallel.
 * Returns active vs. inactive fiat partitions plus the unique method identifier set.
 *
 * Errors are NOT treated as inactive — they're skipped from both lists, so a transient
 * network blip won't flip a fiat's classification. Full failure (no responses) yields
 * empty lists; the calling code can detect this and fall back to the YAML curation.
 */
async function fetchTradeMethodsByFiat(): Promise<TradeMethodsCoverage> {
  const results = await Promise.all(
    CANDIDATE_FIATS.map(async (fiat) => {
      try {
        const resp = await fetch(`${TRADE_METHODS_URL}?fiat=${fiat}`, {
          headers: { accept: 'application/json', 'user-agent': UA },
        });
        if (!resp.ok) return { fiat, error: true, methods: [] as string[] };
        const data = (await resp.json()) as BinanceTradeMethodsResp;
        if (data.code !== '000000') return { fiat, error: true, methods: [] };
        const methods = (data.data ?? [])
          .map((m) => m.identifier)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        return { fiat, error: false, methods };
      } catch {
        return { fiat, error: true, methods: [] };
      }
    }),
  );

  const activeFiats: string[] = [];
  const inactiveFiats: string[] = [];
  const allMethodsSet = new Set<string>();
  const methodsByFiat: Record<string, string[]> = {};

  for (const r of results) {
    if (r.error) continue;
    if (r.methods.length > 0) {
      activeFiats.push(r.fiat);
      methodsByFiat[r.fiat] = [...r.methods].sort();
      for (const m of r.methods) allMethodsSet.add(m);
    } else {
      inactiveFiats.push(r.fiat);
    }
  }

  return {
    activeFiats: activeFiats.sort(),
    inactiveFiats: inactiveFiats.sort(),
    allMethods: [...allMethodsSet].sort(),
    methodsByFiat,
  };
}

/**
 * Per-fiat probe of the USDT offer book — the unit of work that drives the Available
 * USDT KPI, the Live rates table, the spread metric, and fee_snapshot.sample_rows.
 *
 * `surplus_sum` is the only field that always has a value: USDT ≈ $1, so it approximates
 * the dollar depth of the cheapest 20 ads in this market. The FX-derived fields
 * (`best_rate` and `spread_bps` only make sense relative to an FX mid) are populated
 * only when CoinGecko returned a rate for this fiat — which excludes some exotic
 * currencies (VES, EGP, etc.). Markets without FX still contribute to the liquidity
 * sum, just not to the spread / rates surfaces.
 */
interface MarketProbe {
  fiat: string;
  ads: BinanceAd[];
  /** Binance's reported full-book ad count for these filters. */
  total: number;
  /** Sum of surplus_amount (USDT) across the top-20 ads. USDT ≈ $1. */
  surplus_sum: number;
  best_rate: number | null;
  spread_bps: number | null;
  fx_mid: number | null;
  n_makers: number;
}

/**
 * Probe every CANDIDATE_FIAT against USDT in parallel, compute per-market metrics, and
 * aggregate cross-market statistics. Replaces the old SAMPLE_PAIRS (6 hardcoded pairs)
 * and MARKET_CANDIDATES (19 hardcoded pairs) with one unified probe over ~135 fiats —
 * about 99 of which return ads, ~36 of which return empty (Binance market exits).
 *
 * USDT-only by design: USDT is >95% of Binance P2P volume, USDT escrow is the only side
 * with capital actually locked, and USDT ≈ $1 means we can sum surplus_amount directly
 * for the "Available USDT" KPI without any FX conversion. USDC / BTC / ETH / BNB / FDUSD
 * are not probed at the Overview layer; users can drill into them via the Orderbook tab.
 *
 * Returns:
 *   - probes: per-market raw data
 *   - total_observed_usd: SUM of surplus_sum across every market with ads (the KPI value)
 *   - markets_observed: count of markets with at least one ad
 *   - all_spreads: per-ad spread samples for the median-spread metric (only from
 *     markets that had an FX mid available)
 */
async function fetchAllMarkets(
  now: number,
  fxMids: Record<string, number>,
): Promise<{
  probes: MarketProbe[];
  total_observed_usd: number;
  markets_observed: number;
  all_spreads: number[];
}> {
  void now; // reserved for future cache invalidation / timestamp threading
  const settled = await Promise.allSettled(
    CANDIDATE_FIATS.map(async (fiat) => {
      const result = await search({ fiat, asset: 'USDT', tradeType: 'BUY', rows: 20 });
      return { fiat, ...result };
    }),
  );

  const probes: MarketProbe[] = [];
  let total_observed_usd = 0;
  let markets_observed = 0;
  const all_spreads: number[] = [];

  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    const { fiat, ads, total } = r.value;
    if (!ads.length) continue;

    const surplus_sum = sum(ads.map((a) => Number(a.adv.surplusAmount) || 0));
    total_observed_usd += surplus_sum;
    markets_observed += 1;

    const prices = ads
      .map((a) => Number(a.adv.price))
      .filter((p) => Number.isFinite(p) && p > 0);

    const n_makers = unique(ads.map((a) => a.advertiser.userNo)).length;
    const fx_mid = fxMids[fiat] ?? null;

    let best_rate: number | null = null;
    let spread_bps: number | null = null;
    if (prices.length > 0) {
      best_rate = Math.min(...prices);
      if (fx_mid !== null && Number.isFinite(fx_mid) && fx_mid > 0) {
        spread_bps = ((best_rate - fx_mid) / fx_mid) * 10_000;
        // Contribute per-ad spreads to the cross-market median metric.
        for (const p of prices) {
          all_spreads.push(((p - fx_mid) / fx_mid) * 10_000);
        }
      }
    }

    probes.push({
      fiat,
      ads,
      total,
      surplus_sum,
      best_rate,
      spread_bps,
      fx_mid,
      n_makers,
    });
  }

  return { probes, total_observed_usd, markets_observed, all_spreads };
}

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();

  // STAGE 1: prime the FX cache + fetch coverage in parallel. fxMidBatch is one
  // CoinGecko request (disk-cached for 24h); coverage is 134 trade-methods probes.
  // We need fxMids before fetchAllMarkets so per-market spreads can be computed in
  // the same loop. (Set COINGECKO_KEY in .env.local for the demo tier if rate limits
  // become an issue when CANDIDATE_FIATS grows further.)
  const [fxMids, coverageData] = await Promise.all([
    fxMidBatch('USDT', [...CANDIDATE_FIATS], now),
    fetchTradeMethodsByFiat(),
  ]);

  // STAGE 2: unified market probe — one adv/search call per CANDIDATE_FIAT against
  // USDT (BUY side, so we're observing maker SELL ads = the only side with escrowed
  // capital). Drives liquidity / spread / rates / sample_rows in one pass.
  const { probes, total_observed_usd, markets_observed, all_spreads } =
    await fetchAllMarkets(now, fxMids);

  // Derive: top_pairs (top 10 by USDT depth, for KPI breakdown / drill-in).
  const sortedByDepth = [...probes].sort((a, b) => b.surplus_sum - a.surplus_sum);
  const top_pairs = sortedByDepth.slice(0, 10).map((p) => ({
    pair: `USDT/${p.fiat}`,
    sum_offers_usd: p.surplus_sum,
    n_makers: p.n_makers,
  }));

  // Derive: top 10 markets that have an FX mid → Live rates table.
  const withFx = sortedByDepth.filter(
    (p) => p.fx_mid !== null && p.best_rate !== null && p.spread_bps !== null,
  );
  const marketsTop10: Market[] = withFx.slice(0, 10).map((p) => ({
    currency: p.fiat,
    platform: 'binance_p2p',
    best_rate: p.best_rate as number,
    fx_mid_rate: p.fx_mid as number,
    spread_bps: p.spread_bps as number,
    total_liquidity_usd: p.surplus_sum,
    deposit_count: p.total, // full-book ad count, not just slice
    n_makers: p.n_makers,
  }));

  // Derive: fee_snapshot.sample_rows — top 5 markets that have FX, one row each.
  const sample_rows = withFx.slice(0, 5).map((p) => {
    const top = p.ads[0];
    const method =
      top?.adv.tradeMethods?.[0]?.identifier ??
      top?.adv.tradeMethods?.[0]?.tradeMethodName ??
      'p2p_local';
    return {
      fiat: p.fiat,
      asset: 'USDT',
      payment_method: method,
      effective_rate_bps: Math.round(p.spread_bps as number),
    };
  });

  return {
    liquidity: {
      value: {
        kind: 'p2p_offerbook',
        top_pairs,
        total_observed_usd,
        markets_observed,
      },
      provenance: 'api',
      last_verified: now,
      evidence_url: SEARCH_URL,
      notes: `USDT escrowed across ${markets_observed} fiat markets (top 20 ads per market).`,
    },
    volume_30d_usd: {
      value: null,
      provenance: 'unavailable',
      last_verified: now,
      notes: 'Binance does not separately disclose P2P volume',
    },
    observed_spread_bps: {
      value: all_spreads.length ? median(all_spreads) : null,
      provenance: 'api',
      spread_aggregation: 'median',
      sample_size: all_spreads.length,
      period: 'top_offers',
      last_verified: now,
      evidence_url: SEARCH_URL,
    },
    fee_snapshot: { ts: now, sample_rows, provenance: 'api' },
    // Both subpages backed by routes under web/app/api/binance_p2p/{orderbook,quote}/route.ts.
    capabilities: { orderbook: true, quote: true },
    coverage: {
      value: {
        fiats: coverageData.activeFiats,
        fiats_inactive: coverageData.inactiveFiats.length ? coverageData.inactiveFiats : undefined,
        platforms: coverageData.allMethods,
        payment_methods_by_fiat: Object.keys(coverageData.methodsByFiat).length
          ? coverageData.methodsByFiat
          : undefined,
      },
      provenance: 'api',
      last_verified: now,
      evidence_url: TRADE_METHODS_URL,
      notes:
        coverageData.activeFiats.length === 0
          ? 'agent/trade-methods returned no data — coverage falls back to product YAML'
          : undefined,
    },
    markets: {
      value: marketsTop10,
      provenance: 'api',
      last_verified: now,
      evidence_url: SEARCH_URL,
      notes:
        'Top 10 deepest markets (by USDT depth in top-20 ad slice), filtered to those with FX mids available.',
    },
  };
}

async function quote(req: QuoteRequest): Promise<QuoteResponse | null> {
  const tradeType: 'BUY' | 'SELL' = req.direction === 'buy' ? 'BUY' : 'SELL';
  let ads: BinanceAd[];
  try {
    const result = await search({
      fiat: req.fiat.toUpperCase(),
      asset: req.asset.toUpperCase(),
      tradeType,
      rows: 20,
    });
    ads = result.ads;
  } catch {
    return null;
  }

  const matching = ads.filter((a) => {
    const min = Number(a.adv.minSingleTransAmount);
    const max = Number(a.adv.maxSingleTransAmount);
    return req.amount >= min && req.amount <= max;
  });
  if (!matching.length) return null;

  const top = matching[0];
  const mid = await fxMid(req.asset, req.fiat, Date.now()).catch(() => 0);
  const price = Number(top.adv.price);
  const effectiveBps = mid > 0 ? Math.round(((price - mid) / mid) * 10_000) : 0;

  return {
    product_id: PRODUCT_ID,
    effective_rate_bps: effectiveBps,
    fee_pct: 0,
    estimated_received: req.direction === 'buy' ? req.amount / price : req.amount * price,
    ttl_sec: 30,
    source: 'live',
    evidence: { kind: 'quote_endpoint', ref: SEARCH_URL },
    notes: `advertiser=${top.advertiser.nickName ?? top.advertiser.userNo} price=${price}`,
  };
}

async function history(_days: number): Promise<DailyPoint[]> {
  return [];
}

const adapter: Adapter = { id: PRODUCT_ID, snapshot, quote, history };
export default adapter;
