import type {
  Adapter,
  Snapshot,
  QuoteRequest,
  QuoteResponse,
  DailyPoint,
  Market,
} from '../lib/types.ts';
import { fxMid, fxMidBatch } from '../lib/fx.ts';
import { sum, unique } from '../lib/stats.ts';

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
  /** Fraction 0–1 (NOT 0–100). Aggregated to 0–100 percent in `network_health`. */
  monthFinishRate?: number;
  /** 'user' for regular accounts; 'merchant' for verified merchants. */
  userType?: string;
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
  /**
   * Effective spread (bps) for a $1k single-match trade in this market — the spread of
   * the cheapest ad whose min/max single-tx window accepts $1k-equivalent in local fiat
   * AND has enough USDT escrowed to cover it. Null if no ad in the top-20 qualifies.
   * CEX P2P is single-match (one trade = one maker), not CLOB-walk.
   */
  effective_spread_1k_bps: number | null;
}

const EFFECTIVE_SIZE_USD = 1000;

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
 *
 * Each MarketProbe also carries `effective_spread_1k_bps` — the spread of the cheapest
 * ad in that market that can fill a $1k trade in a single match. This drives the
 * headline `observed_spread_bps` KPI (USD-market value used as the cross-venue metric).
 */
// Concurrency chunking — Binance's Cloudflare sheds requests when we fire all 134
// adv/search calls in a single Promise.all burst (we observed coverage drops from
// ~71 to ~13 markets between runs). Chunked into smaller parallel groups with a
// small inter-chunk pause, we get steady ~70+ market coverage at a small wall-time
// cost (~10s for the markets probe instead of ~3s, but the request actually completes).
const PROBE_CHUNK_SIZE = 10;
const PROBE_CHUNK_DELAY_MS = 300;

async function fetchAllMarkets(
  now: number,
  fxMids: Record<string, number>,
): Promise<{
  probes: MarketProbe[];
  total_observed_usd: number;
  markets_observed: number;
}> {
  void now; // reserved for future cache invalidation / timestamp threading

  // Fire requests in chunks instead of one big Promise.all to stay under Binance's
  // burst-rate cliff. Each chunk runs in parallel; chunks are sequential with a brief
  // pause between them.
  const settled: PromiseSettledResult<{ fiat: string; ads: BinanceAd[]; total: number }>[] = [];
  for (let i = 0; i < CANDIDATE_FIATS.length; i += PROBE_CHUNK_SIZE) {
    const chunk = CANDIDATE_FIATS.slice(i, i + PROBE_CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (fiat) => {
        const result = await search({ fiat, asset: 'USDT', tradeType: 'BUY', rows: 20 });
        return { fiat, ...result };
      }),
    );
    settled.push(...chunkResults);
    if (i + PROBE_CHUNK_SIZE < CANDIDATE_FIATS.length) {
      await new Promise((resolve) => setTimeout(resolve, PROBE_CHUNK_DELAY_MS));
    }
  }

  const probes: MarketProbe[] = [];
  let total_observed_usd = 0;
  let markets_observed = 0;

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
    let effective_spread_1k_bps: number | null = null;
    if (prices.length > 0) {
      best_rate = Math.min(...prices);
      if (fx_mid !== null && Number.isFinite(fx_mid) && fx_mid > 0) {
        spread_bps = ((best_rate - fx_mid) / fx_mid) * 10_000;

        // Effective spread for a $1k single-match trade.
        // Target in local fiat: $1000 worth of USDT ≈ 1000 USDT × fx_mid local-per-USDT.
        // Find the cheapest ad where:
        //   (a) min_single_tx ≤ target_local ≤ max_single_tx (the maker accepts this size)
        //   (b) surplus_amount ≥ 1000 (the maker has ≥1000 USDT escrowed to cover the buy)
        const targetLocal = EFFECTIVE_SIZE_USD * fx_mid;
        const sorted = [...ads].sort(
          (a, b) => Number(a.adv.price) - Number(b.adv.price),
        );
        for (const ad of sorted) {
          const price = Number(ad.adv.price);
          if (!Number.isFinite(price) || price <= 0) continue;
          const minTx = Number(ad.adv.minSingleTransAmount);
          const maxTx = Number(ad.adv.maxSingleTransAmount);
          const surplus = Number(ad.adv.surplusAmount);
          if (targetLocal < minTx || targetLocal > maxTx) continue;
          if (!Number.isFinite(surplus) || surplus < EFFECTIVE_SIZE_USD) continue;
          effective_spread_1k_bps = ((price - fx_mid) / fx_mid) * 10_000;
          break;
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
      effective_spread_1k_bps,
    });
  }

  return { probes, total_observed_usd, markets_observed };
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
  const { probes, total_observed_usd, markets_observed } =
    await fetchAllMarkets(now, fxMids);

  // Headline observed_spread_bps: effective spread for a $1k single-match trade in the
  // USD market. Picked over a cross-market median because it gives an apples-to-apples
  // comparison with other venues that all settle in USD.
  const usdProbe = probes.find((p) => p.fiat === 'USD');
  const effectiveUsd1kBps = usdProbe?.effective_spread_1k_bps ?? null;

  // Derive: max single-trade ceiling across every observed ad. For each ad it's
  // min(maxSingleTransAmount_in_USD, surplus_USDT) — the bigger of (maker cap, escrow
  // balance) bounds what a taker can fill in one go. Then take max across all probed ads.
  // Only ads in markets with FX mids contribute (we can't convert local-fiat caps without FX).
  let max_single_trade_usd = 0;
  for (const p of probes) {
    if (p.fx_mid == null || !Number.isFinite(p.fx_mid) || p.fx_mid <= 0) continue;
    for (const ad of p.ads) {
      const maxLocal = Number(ad.adv.maxSingleTransAmount);
      const surplus = Number(ad.adv.surplusAmount);
      if (!Number.isFinite(maxLocal) || maxLocal <= 0) continue;
      const maxUsd = maxLocal / p.fx_mid;
      const surplusUsd = Number.isFinite(surplus) ? surplus : 0; // USDT ≈ $1
      const cap = Math.min(maxUsd, surplusUsd);
      if (cap > max_single_trade_usd) max_single_trade_usd = cap;
    }
  }

  // Derive: maker-reputation aggregates for the Network Health card. Distinct
  // advertisers across every probed market (a maker posting in 3 fiats counts once),
  // then mean/share over that deduped set. Binance only surfaces the top-20 ads per
  // market, so this is "makers visible in our sample," not a 30d window.
  const advertisersById = new Map<string, BinanceAdvertiser>();
  let total_ad_count = 0;
  for (const p of probes) {
    total_ad_count += p.total;
    for (const ad of p.ads) {
      const a = ad.advertiser;
      if (a?.userNo && !advertisersById.has(a.userNo)) {
        advertisersById.set(a.userNo, a);
      }
    }
  }
  const advertisers = [...advertisersById.values()];
  const finishRates = advertisers
    .map((a) => a.monthFinishRate)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
  const orderCounts = advertisers
    .map((a) => a.monthOrderCount)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  const merchantCount = advertisers.filter((a) => a.userType?.toLowerCase() === 'merchant').length;
  const avg_maker_month_finish_rate_pct =
    finishRates.length > 0 ? (sum(finishRates) / finishRates.length) * 100 : undefined;
  const avg_maker_month_order_count =
    orderCounts.length > 0 ? sum(orderCounts) / orderCounts.length : undefined;
  const merchant_share_pct =
    advertisers.length > 0 ? (merchantCount / advertisers.length) * 100 : undefined;

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
        max_single_trade_usd: max_single_trade_usd > 0 ? max_single_trade_usd : undefined,
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
      value: effectiveUsd1kBps,
      provenance: 'api',
      spread_aggregation: 'effective_at_size',
      // 1 = the single ad we matched against. Cross-venue comparable.
      sample_size: effectiveUsd1kBps != null ? 1 : 0,
      period: 'usd_usdt_$1k_single_match',
      last_verified: now,
      evidence_url: SEARCH_URL,
      notes:
        effectiveUsd1kBps == null
          ? 'No USD market ad in the top-20 accepts a $1k single-match trade with enough escrowed USDT.'
          : undefined,
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
    network_health: {
      value: {
        active_makers: advertisers.length,
        active_ads: total_ad_count,
        avg_maker_month_finish_rate_pct,
        avg_maker_month_order_count,
        merchant_share_pct,
      },
      provenance: 'api',
      last_verified: now,
      evidence_url: SEARCH_URL,
      notes:
        'Maker-reputation aggregates across distinct advertisers seen in the top-20 slice of every probed market. Snapshot of currently-posting makers, not a 30d window.',
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
