import type {
  Adapter,
  Snapshot,
  QuoteRequest,
  QuoteResponse,
  DailyPoint,
  Market,
  CostLeg1k,
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
  page?: number;
}

interface SearchResult {
  ads: BinanceAd[];
  /** Total ads Binance reports in the full book for these filters (not just this page). */
  total: number;
}

async function search(params: SearchParams): Promise<SearchResult> {
  const body = {
    fiat: params.fiat,
    page: params.page ?? 1,
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
   * BUY-side only (drives the headline KPI); SELL probes carry it via effective_1k_match.
   */
  effective_spread_1k_bps: number | null;
  /**
   * The $1k single-match itself (both directions) — feeds the cost_1k decomposition.
   * spread_bps is sign-normalized like MarketProbe.spread_bps (negative = favorable
   * for the taker); `methods` lists the matched ad's deduped payment identifiers.
   */
  effective_1k_match: { price: number; spread_bps: number; methods: string[] } | null;
  /**
   * Escrowed depth priced within ±N% of the FX mid (BUY side; zero for SELL and for
   * markets with no FX mid). Full-book sums include ads 30%+ from mid that can never
   * fill — the bands are the fillable subset.
   */
  depth_bands: { pct_0_5: number; pct_2: number; pct_5: number };
}

const EFFECTIVE_SIZE_USD = 1000;

type MarketFetch = { fiat: string; ads: BinanceAd[]; total: number };

// The headline spread KPI *and* the whole cost_1k decomposition are anchored to this one
// market. When Cloudflare sheds it — 1 probe out of 134 — all three go null at once.
// Measured on 2026-07-21: 2 of 6 cron runs lost USD, which is why the deployed Spread KPI
// was intermittently blank. So it gets retried on its own after the burst finishes, when
// it's no longer competing with 133 concurrent requests for rate-limit budget. Costs at
// most KPI_ANCHOR_RETRIES extra requests, and only on runs that would otherwise be blank.
const KPI_ANCHOR_FIAT = 'USD';
const KPI_ANCHOR_RETRIES = 3;
const KPI_ANCHOR_RETRY_DELAY_MS = 1200;

// Exit-to-chain reference cost for the cost_1k decomposition. Binance P2P settles to
// the taker's internal Binance balance (the 'offchain' sentinel) — withdrawing USDT to
// a self-custodial wallet is a separate optional action whose fee depends on the network
// chosen, so it is surfaced as its own line and EXCLUDED from the headline total. We
// quote the cheapest mainstream network from Binance's published schedule; the range
// note in assumptions covers the common alternatives (TRC20 1.5 / ERC20 0.4 as checked).
// Hand-checked values (manual provenance) via the authless endpoint
// bapi/capital/v1/public/capital/getNetworkCoinAll — re-verify when touching this.
const USDT_WITHDRAWAL = {
  network: 'BNB Smart Chain (BEP20)',
  fee_usdt: 0.01,
  range_note: 'network-dependent: 0.01 (BEP20) to 1.5 (TRC20) USDT; ERC20 0.4, Solana 0.3',
  source: 'https://www.binance.com/en/fee/cryptoFee',
  checked: '2026-07-21',
};

// Flat taker fee on USDT pairs in ~97 fiat markets (incl. USD): introduced 2024-03-19
// at 0.05 USDT per trade order, ADJUSTED to 0.06–0.08 USDT from 2025-09-22 (rollout
// completed Dec 2025; per-market value inside the range is not published — we assume
// the midpoint). The widely-repeated "takers pay nothing on P2P" is stale folklore.
// Maker fees (separate, per-fiat schedule) stay embedded in the quoted price.
const TAKER_FLAT_FEE = {
  usdt: 0.07,
  range_note: '0.06–0.08 USDT depending on market (midpoint assumed)',
  source:
    'https://www.binance.com/en/support/announcement/detail/70c92ace9acb45529cd4541195248c91',
};

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
const ROWS_PER_PAGE = 20;
// Adaptive depth cap: pull up to MAX_PAGES per market (≤100 ads at 20/page), stopping
// early once `total` is covered or a short page signals end-of-book. ~80% book coverage
// vs. the old top-20 (~14%). The headline $1k spread KPI is unaffected — the cheapest
// USD ad is always on page 1.
const MAX_PAGES = 5;

// Headline markets get the ENTIRE book, not a 100-ad slice. Measured 2026-07-21:
// USD has ~1.4k BUY / ~2.3k SELL ads and EUR ~260 / ~560, and Binance paginates all the
// way to the last partial page (verified page 71 of USD BUY returns 2 ads — there is no
// depth cap). `rows` is hard-capped at 20 server-side: rows=50 and rows=100 both return
// zero ads, so more pages is the only way to go deeper.
// Cost: ~230 extra sequential pages per full cycle, ~90s of added wall time. Acceptable
// inside the cron's budget; do NOT extend this set to many fiats without re-measuring.
const DEEP_COVERAGE_FIATS = new Set(['USD', 'EUR']);
// Safety ceiling for the deep set so a runaway `total` can't page forever (4000 ads).
const MAX_PAGES_DEEP = 200;
// Brief pause between sequential page fetches *within* a market. Pages are sequential so
// peak concurrency stays at PROBE_CHUNK_SIZE (the across-fiats chunk) — same instantaneous
// burst as before, just sustained longer — keeping us under Binance's Cloudflare cliff.
const PROBE_PAGE_DELAY_MS = 150;

/**
 * Fetch a single fiat market page-by-page, adaptively. Page 1 reports `total` (the
 * full-book ad count); we then pull pages 2..min(cap, ceil(total/ROWS_PER_PAGE)), bailing
 * early if a page returns a short result (end of book). The cap is MAX_PAGES_DEEP for
 * DEEP_COVERAGE_FIATS (full book) and MAX_PAGES for everything else. Ads are concatenated
 * and deduped by `advNo` — defensive, since ad churn between sequential requests can
 * occasionally repeat one across page boundaries.
 */
async function fetchMarketPages(
  fiat: string,
  tradeType: 'BUY' | 'SELL',
): Promise<{ ads: BinanceAd[]; total: number }> {
  const first = await search({ fiat, asset: 'USDT', tradeType, rows: ROWS_PER_PAGE, page: 1 });
  const seen = new Set<string>();
  const ads: BinanceAd[] = [];
  const push = (batch: BinanceAd[]) => {
    for (const ad of batch) {
      const id = ad.adv.advNo;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      ads.push(ad);
    }
  };
  push(first.ads);

  // Deep coverage is BUY-side ONLY. tradeType=SELL returns maker BUY ads, which carry no
  // escrow — a maker can advertise "I'll buy 1,000,000 USDT" with nothing locked. Paging
  // the whole SELL book just accumulates unbacked intent (measured: $350.79M for USD vs
  // $8.05M of real escrowed BUY depth). We cap it at MAX_PAGES and label it "demand".
  const pageCap = DEEP_COVERAGE_FIATS.has(fiat) && tradeType === 'BUY' ? MAX_PAGES_DEEP : MAX_PAGES;
  const pagesNeeded = Math.min(pageCap, Math.max(1, Math.ceil(first.total / ROWS_PER_PAGE)));
  // Only keep paging if page 1 was full — a short first page means the book is exhausted.
  if (first.ads.length >= ROWS_PER_PAGE) {
    for (let page = 2; page <= pagesNeeded; page++) {
      await new Promise((r) => setTimeout(r, PROBE_PAGE_DELAY_MS));
      const next = await search({ fiat, asset: 'USDT', tradeType, rows: ROWS_PER_PAGE, page });
      push(next.ads);
      if (next.ads.length < ROWS_PER_PAGE) break; // reached end of book
    }
  }
  return { ads, total: first.total };
}

async function fetchAllMarkets(
  now: number,
  fxMids: Record<string, number>,
  tradeType: 'BUY' | 'SELL',
): Promise<{
  probes: MarketProbe[];
  total_observed_usd: number;
  markets_observed: number;
}> {
  void now; // reserved for future cache invalidation / timestamp threading

  // Reminder on adv/search semantics: the request `tradeType` is from the TAKER's
  // perspective. `BUY` returns SELL-side ads (maker selling USDT, taker pays fiat to get
  // USDT = onramp). `SELL` returns BUY-side ads (maker buying USDT, taker sends USDT to
  // get fiat = offramp). `surplusAmount` is always in USDT for both directions — it's
  // the unfilled asset-side capacity of the ad (escrow for SELL ads, target buy amount
  // for BUY ads).
  //
  // Pricing direction:
  //   tradeType=BUY:  taker buys USDT → lower price is better → best_rate = min(prices)
  //   tradeType=SELL: taker sells USDT → higher price is better → best_rate = max(prices)
  //
  // Spread convention (consistent across products): negative bps = favorable for taker.
  //   BUY:  spread = (price - mid)/mid * 10_000  (naturally negative when favorable)
  //   SELL: spread = -((price - mid)/mid) * 10_000  (sign flip — taker getting more than mid)

  // Fire requests in chunks instead of one big Promise.all to stay under Binance's
  // burst-rate cliff. Each chunk runs in parallel; chunks are sequential with a brief
  // pause between them.
  const settled: PromiseSettledResult<MarketFetch>[] = [];
  for (let i = 0; i < CANDIDATE_FIATS.length; i += PROBE_CHUNK_SIZE) {
    const chunk = CANDIDATE_FIATS.slice(i, i + PROBE_CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (fiat) => {
        const result = await fetchMarketPages(fiat, tradeType);
        return { fiat, ...result };
      }),
    );
    settled.push(...chunkResults);
    if (i + PROBE_CHUNK_SIZE < CANDIDATE_FIATS.length) {
      await new Promise((resolve) => setTimeout(resolve, PROBE_CHUNK_DELAY_MS));
    }
  }

  // Targeted retry for the KPI-anchor market (see KPI_ANCHOR_FIAT). Runs after the storm,
  // sequentially, so it isn't competing with the chunked burst that likely shed it.
  const anchorIdx = settled.findIndex(
    (r) => r.status === 'fulfilled' && r.value.fiat === KPI_ANCHOR_FIAT,
  );
  const anchorAds =
    anchorIdx >= 0 ? (settled[anchorIdx] as PromiseFulfilledResult<MarketFetch>).value.ads : [];
  if (anchorAds.length === 0) {
    for (let attempt = 1; attempt <= KPI_ANCHOR_RETRIES; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, KPI_ANCHOR_RETRY_DELAY_MS));
      try {
        const retried = await fetchMarketPages(KPI_ANCHOR_FIAT, tradeType);
        if (retried.ads.length > 0) {
          const value: MarketFetch = { fiat: KPI_ANCHOR_FIAT, ...retried };
          if (anchorIdx >= 0) settled[anchorIdx] = { status: 'fulfilled', value };
          else settled.push({ status: 'fulfilled', value });
          break;
        }
      } catch {
        // Swallow and retry — an exhausted retry budget just leaves the KPI null,
        // which is the same outcome as before this retry existed.
      }
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

    // Fillable-depth bands. BUY only: the SELL side isn't escrowed, so banding it would
    // just produce a tidier phantom. A BUY ad is fillable within the band when its price
    // is at most mid*(1+pct) — the taker pays fiat, so cheaper is better.
    const depth_bands = { pct_0_5: 0, pct_2: 0, pct_5: 0 };
    if (tradeType === 'BUY' && fx_mid !== null && Number.isFinite(fx_mid) && fx_mid > 0) {
      for (const ad of ads) {
        const price = Number(ad.adv.price);
        const surplus = Number(ad.adv.surplusAmount) || 0;
        if (!Number.isFinite(price) || price <= 0 || surplus <= 0) continue;
        if (price <= fx_mid * 1.05) depth_bands.pct_5 += surplus;
        if (price <= fx_mid * 1.02) depth_bands.pct_2 += surplus;
        if (price <= fx_mid * 1.005) depth_bands.pct_0_5 += surplus;
      }
    }

    let best_rate: number | null = null;
    let spread_bps: number | null = null;
    let effective_1k_match: MarketProbe['effective_1k_match'] = null;
    if (prices.length > 0) {
      best_rate = tradeType === 'BUY' ? Math.min(...prices) : Math.max(...prices);
      if (fx_mid !== null && Number.isFinite(fx_mid) && fx_mid > 0) {
        const rawSpread = ((best_rate - fx_mid) / fx_mid) * 10_000;
        spread_bps = tradeType === 'BUY' ? rawSpread : -rawSpread;

        // $1k single-match: the best-priced ad (cheapest for BUY, best-paying for
        // SELL) whose single-tx window accepts $1k-equivalent AND has ≥$1k of
        // USDT-side capacity. BUY drives the cross-venue headline KPI; both
        // directions feed the cost_1k decomposition.
        const targetLocal = EFFECTIVE_SIZE_USD * fx_mid;
        const sorted = [...ads].sort((a, b) =>
          tradeType === 'BUY'
            ? Number(a.adv.price) - Number(b.adv.price)
            : Number(b.adv.price) - Number(a.adv.price),
        );
        // BUY takes the single best-priced qualifying ad (escrow requirement already
        // filters bait). SELL takes the MEDIAN of the top-5 qualifying ads: the
        // best-paying SELL ads are routinely premium outliers on reversible payment
        // methods (Zelle chargeback-risk pricing) and would make the offramp leg
        // look like free money.
        const qualifying: BinanceAd[] = [];
        const wanted = tradeType === 'BUY' ? 1 : 5;
        for (const ad of sorted) {
          const price = Number(ad.adv.price);
          if (!Number.isFinite(price) || price <= 0) continue;
          const minTx = Number(ad.adv.minSingleTransAmount);
          const maxTx = Number(ad.adv.maxSingleTransAmount);
          const surplus = Number(ad.adv.surplusAmount);
          if (targetLocal < minTx || targetLocal > maxTx) continue;
          if (!Number.isFinite(surplus) || surplus < EFFECTIVE_SIZE_USD) continue;
          qualifying.push(ad);
          if (qualifying.length >= wanted) break;
        }
        // Median element (floor(n/2) of the best-first sort = the actual middle ad,
        // rounding toward the conservative side on even counts).
        const picked = qualifying[Math.floor(qualifying.length / 2)] ?? qualifying[0];
        if (picked) {
          const price = Number(picked.adv.price);
          const raw = ((price - fx_mid) / fx_mid) * 10_000;
          effective_1k_match = {
            price,
            spread_bps: tradeType === 'BUY' ? raw : -raw,
            methods: unique(
              (picked.adv.tradeMethods ?? [])
                .map((m) => m.identifier ?? m.tradeMethodName)
                .filter((m): m is string => Boolean(m)),
            ),
          };
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
      // BUY normalization is the identity, so the headline KPI value is unchanged.
      effective_spread_1k_bps:
        tradeType === 'BUY' ? (effective_1k_match?.spread_bps ?? null) : null,
      effective_1k_match,
      depth_bands,
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
  // USDT, both directions. BUY first (taker-buys = onramp) drives liquidity, headline
  // spread, max single trade, maker aggregates — the historical "Available USDT" view.
  // SELL second (taker-sells = offramp) feeds the Live Rates table's offramp toggle.
  //
  // Sequential rather than parallel because Binance's Cloudflare sheds requests when
  // we fire too many adv/search calls at once. Two passes of 134 fiats × chunked-10 =
  // ~60s total snapshot time (was ~30s with BUY-only). Cron budget allows it.
  const buyResult = await fetchAllMarkets(now, fxMids, 'BUY');
  const sellResult = await fetchAllMarkets(now, fxMids, 'SELL');
  const { probes, total_observed_usd, markets_observed } = buyResult;
  const sellProbes = sellResult.probes;

  // Headline observed_spread_bps: effective spread for a $1k single-match trade in the
  // USD market. Picked over a cross-market median because it gives an apples-to-apples
  // comparison with other venues that all settle in USD.
  const usdProbe = probes.find((p) => p.fiat === 'USD');
  const effectiveUsd1kBps = usdProbe?.effective_spread_1k_bps ?? null;

  // Fillable-depth bands summed across every BUY market with an FX mid.
  const depth_bands_usd = probes.reduce(
    (acc, p) => ({
      pct_0_5: acc.pct_0_5 + p.depth_bands.pct_0_5,
      pct_2: acc.pct_2 + p.depth_bands.pct_2,
      pct_5: acc.pct_5 + p.depth_bands.pct_5,
    }),
    { pct_0_5: 0, pct_2: 0, pct_5: 0 },
  );

  // cost_1k decomposition: itemize the $1k single-match into fiat fee / trade fee /
  // spread, per direction, with the assumptions published alongside. The fee legs are
  // NOT all zero: takers pay a flat 0.05 USDT per USDT-pair trade order (since
  // 2024-03-19; see TAKER_FLAT_FEE.source) — the point of the decomposition is making
  // exactly this kind of buried cost legible and cross-venue comparable.
  const usdSellProbe = sellProbes.find((p) => p.fiat === 'USD');
  const costLeg = (probe: MarketProbe | undefined, direction: 'buy' | 'sell'): CostLeg1k | null => {
    const m = probe?.effective_1k_match;
    if (!m || probe?.fx_mid == null) return null;
    const spread_usd = (EFFECTIVE_SIZE_USD * m.spread_bps) / 10_000;
    const trade_fee_usd = TAKER_FLAT_FEE.usdt; // USDT ≈ $1, flat per trade order
    const total_usd = trade_fee_usd + spread_usd;
    return {
      direction,
      notional_usd: EFFECTIVE_SIZE_USD,
      fiat_fee_usd: 0,
      trade_fee_usd,
      spread_usd,
      total_usd,
      total_bps: (total_usd / EFFECTIVE_SIZE_USD) * 10_000,
      transfer_out_usd: direction === 'buy' ? USDT_WITHDRAWAL.fee_usdt : null,
      assumptions: {
        market: 'USD/USDT',
        match_rule:
          direction === 'buy'
            ? `best-priced ad accepting a $${EFFECTIVE_SIZE_USD} single tx with ≥$${EFFECTIVE_SIZE_USD} USDT-side capacity`
            : `median of the top-5 best-paying qualifying ads (outlier-resistant: best SELL prices are often reversible-payment risk premiums)`,
        matched_price: m.price,
        fx_mid: probe.fx_mid,
        payment_methods: m.methods.slice(0, 4).join(', ') || null,
        fiat_fee: 'P2P payment methods carry no venue fiat fee',
        trade_fee: `flat taker fee per trade order on USDT pairs, ${TAKER_FLAT_FEE.range_note} since 2025-09-22 — we assume ${TAKER_FLAT_FEE.usdt} USDT; the per-fiat maker fee is embedded in the quoted price`,
        trade_fee_source: TAKER_FLAT_FEE.source,
        transfer_out:
          direction === 'buy'
            ? `USDT withdrawal to ${USDT_WITHDRAWAL.network} (${USDT_WITHDRAWAL.fee_usdt} USDT; ${USDT_WITHDRAWAL.range_note}; checked ${USDT_WITHDRAWAL.checked}) — optional exit to self-custody, excluded from total`
            : 'depositing USDT from chain costs network gas only; the venue charges nothing — excluded from total',
        transfer_out_source: direction === 'buy' ? USDT_WITHDRAWAL.source : null,
      },
    };
  };

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

  // Derive: per-fiat depth breakdown with BUY/SELL split → "Market mix · current snapshot"
  // dual-bar chart. Each item carries combined liquidity (both directions summed) plus
  // the per-direction values, so the UI can render onramp/offramp asymmetry per fiat.
  //
  // Total combined depth across all fiats and both directions — used as the share_pct
  // denominator so values are comparable as "% of total venue liquidity."
  const sellByFiat = new Map<string, number>();
  for (const p of sellProbes) sellByFiat.set(p.fiat, p.surplus_sum);
  const total_combined_depth =
    total_observed_usd + sellProbes.reduce((acc, p) => acc + p.surplus_sum, 0);

  // Build the union of fiats that appear in either direction with non-zero depth.
  const fiatsSeen = new Set<string>([
    ...probes.filter((p) => p.surplus_sum > 0).map((p) => p.fiat),
    ...sellProbes.filter((p) => p.surplus_sum > 0).map((p) => p.fiat),
  ]);
  const buyByFiat = new Map<string, (typeof probes)[number]>();
  for (const p of probes) buyByFiat.set(p.fiat, p);

  const depth_currencies = [...fiatsSeen]
    .map((fiat) => {
      const buy = buyByFiat.get(fiat)?.surplus_sum ?? 0;
      const sell = sellByFiat.get(fiat) ?? 0;
      const combined = buy + sell;
      return {
        key: fiat,
        label: fiat,
        liquidity_usd: combined,
        share_pct: total_combined_depth > 0 ? (combined / total_combined_depth) * 100 : 0,
        buy_liquidity_usd: buy,
        sell_liquidity_usd: sell,
        ad_count: buyByFiat.get(fiat)?.total ?? 0,
        n_makers: buyByFiat.get(fiat)?.n_makers ?? 0,
      };
    })
    .sort((a, b) => b.liquidity_usd - a.liquidity_usd);

  // Derive: top 10 markets per direction → Live rates table (kind-aware in the view
  // shows the onramp/offramp toggle when both are populated). Sorted by USDT depth
  // independently per direction; spread sign already normalized in fetchAllMarkets
  // (negative = favorable for taker regardless of direction).
  const withFxBuy = sortedByDepth.filter(
    (p) => p.fx_mid !== null && p.best_rate !== null && p.spread_bps !== null,
  );
  const marketsBuyTop10: Market[] = withFxBuy.slice(0, 10).map((p) => ({
    currency: p.fiat,
    platform: 'binance_p2p',
    direction: 'buy',
    best_rate: p.best_rate as number,
    fx_mid_rate: p.fx_mid as number,
    spread_bps: p.spread_bps as number,
    total_liquidity_usd: p.surplus_sum,
    deposit_count: p.total, // full-book ad count, not just slice
    n_makers: p.n_makers,
  }));
  const sortedSellByDepth = [...sellProbes].sort((a, b) => b.surplus_sum - a.surplus_sum);
  const withFxSell = sortedSellByDepth.filter(
    (p) => p.fx_mid !== null && p.best_rate !== null && p.spread_bps !== null,
  );
  const marketsSellTop10: Market[] = withFxSell.slice(0, 10).map((p) => ({
    currency: p.fiat,
    platform: 'binance_p2p',
    direction: 'sell',
    best_rate: p.best_rate as number,
    fx_mid_rate: p.fx_mid as number,
    spread_bps: p.spread_bps as number,
    total_liquidity_usd: p.surplus_sum,
    deposit_count: p.total,
    n_makers: p.n_makers,
  }));
  const marketsTop10: Market[] = [...marketsBuyTop10, ...marketsSellTop10];

  // Derive: fee_snapshot.sample_rows — top 5 markets that have FX, one row each.
  const sample_rows = withFxBuy.slice(0, 5).map((p) => {
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
        depth_bands_usd,
        markets_observed,
        max_single_trade_usd: max_single_trade_usd > 0 ? max_single_trade_usd : undefined,
      },
      provenance: 'api',
      last_verified: now,
      evidence_url: SEARCH_URL,
      notes:
        `Escrowed USDT across ${markets_observed} fiat markets. Headline = depth priced within ±5% of the FX mid ` +
        `($${(depth_bands_usd.pct_5 / 1e6).toFixed(2)}M); the full observed book is $${(total_observed_usd / 1e6).toFixed(2)}M ` +
        `but includes ads priced 30%+ from mid that can never fill. ` +
        `${[...DEEP_COVERAGE_FIATS].join('/')} are probed to full book depth; other markets up to 100 ads (5-page adaptive).`,
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
    cost_1k: {
      value: { onramp: costLeg(usdProbe, 'buy'), offramp: costLeg(usdSellProbe, 'sell') },
      provenance: 'api',
      last_verified: now,
      evidence_url: SEARCH_URL,
      notes:
        'Spread legs are live $1k single-match quotes vs the CoinGecko FX mid; the optional exit-to-chain line uses Binance’s published withdrawal schedule (hand-checked).',
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
    depth_composition: {
      value: {
        currencies: depth_currencies,
        period: 'current snapshot',
      },
      provenance: 'api',
      last_verified: now,
      evidence_url: SEARCH_URL,
      notes: `Per-fiat share of USDT escrow observed in the top-20 BUY ad slice across ${markets_observed} fiat markets. Snapshot, not a window — Binance doesn't publish historical volume.`,
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
