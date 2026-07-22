// Cross-venue quote aggregator. Fans out to each venue's quote logic in parallel,
// normalizes responses into a single ranked list.
//
// Strategy:
//   - zkp2p:        POST our own /api/zkp2p/quote (Peerlytics-backed)
//   - binance:      POST our own /api/binance_p2p/quote (adv/search-backed)
//   - ramp:         compute Approach B approximation inline (no API hop)
//   - revolut_ramp: live venue quote inline via ramp.revolut.com/ramp-api (key-less;
//                   buy-only, no stablecoins — mirrors adapters/revolut_ramp.ts, keep
//                   the partnerId in sync)
//   - revolut (in-app RTPN): excluded — no public quote surface
//
// Calling our own routes via fetch costs one HTTP hop per venue but reuses all the
// quote logic that already lives in those route files. Acceptable for MVP.

import { methodById, venueMethodIds, VENUE_LABEL } from '@/lib/payment-methods';

const RAMP_BASE = 'https://api.rampnetwork.com/api';
const REVOLUT_RAMP_BASE = 'https://ramp.revolut.com/ramp-api';
// Same public partnerId the ramp.revolut.com widget sends — required by /orders/quote.
// Mirror of adapters/revolut_ramp.ts WEBSITE_PARTNER_ID; keep in sync.
const REVOLUT_RAMP_PARTNER_ID = 'e5c8d239-5843-4e7b-a967-50f4206ec5d3';

// ─── Ramp Approach B fee table (mirror of adapters/ramp_network.ts) ─────────────
// Keep in sync with that file. Both directions populated since aggregator covers
// onramp + offramp; sell-only methods (ACH) are populated here even though the
// snapshot-time live-rates table also includes them.
const RAMP_FEE_BPS_BY_METHOD_BUY: Record<string, number> = {
  CARD_PAYMENT: 245,
  APPLE_PAY: 245,
  GOOGLE_PAY: 245,
  MANUAL_BANK_TRANSFER: 140,
  AUTO_BANK_TRANSFER: 240,
  PIX: 290,
};
const RAMP_FEE_BPS_BY_METHOD_SELL: Record<string, number> = {
  CARD_PAYMENT: 449,
  APPLE_PAY: 449,
  GOOGLE_PAY: 449,
  MANUAL_BANK_TRANSFER: 99,
  AUTO_BANK_TRANSFER: 99,
  ACH: 99,
};
const RAMP_CARD_LIKE = new Set(['CARD_PAYMENT', 'APPLE_PAY', 'GOOGLE_PAY']);
const RAMP_MAJOR_FIATS = new Set(['USD', 'EUR', 'GBP']);
const RAMP_CARD_EXOTIC_BUY = 545;
const RAMP_FEE_DEFAULT_BPS = 390;

function rampFeeBps(method: string, fiat: string, direction: 'buy' | 'sell'): number | null {
  const table = direction === 'buy' ? RAMP_FEE_BPS_BY_METHOD_BUY : RAMP_FEE_BPS_BY_METHOD_SELL;
  const base = table[method];
  if (base == null) return null;
  if (direction === 'buy' && RAMP_CARD_LIKE.has(method) && !RAMP_MAJOR_FIATS.has(fiat)) {
    return RAMP_CARD_EXOTIC_BUY;
  }
  return base;
}

// ─── Request / response shapes ──────────────────────────────────────────────────

type KycTier = 'none' | 'email' | 'id' | 'id+poa' | 'enhanced';
type KycFilter = 'any' | 'none' | 'email' | 'id' | 'id+poa';
const KYC_ORDER: KycTier[] = ['none', 'email', 'id', 'id+poa', 'enhanced'];

interface AggregatorRequest {
  direction: 'buy' | 'sell';
  fiat_amount: number;
  fiat_currency: string;
  asset?: string; // default USDC
  payment_methods?: string[];
  /** Cap on KYC the user is willing to do. 'none' means non-KYC route only. */
  kyc_max?: KycFilter;
}

interface VenueQuote {
  venue: string;            // 'zkp2p' | 'binance_p2p' | 'ramp_network'
  venue_label: string;      // user-facing
  category: string;         // for badge color
  available: boolean;       // false if no route matched
  asset?: string;           // the actual asset offered (USDC / USDT / etc.)
  rate?: number;            // fiat per asset
  /** Direction-agnostic asset side of the trade. For buy: amount user receives. For sell: amount user sends. */
  asset_amount?: number;
  spread_bps?: number;
  effective_pct?: number;   // markup vs reference / mid (display)
  source: 'live' | 'approximated' | 'unavailable';
  notes?: string;
  payment_method?: string;
  pii_floor: KycTier;       // venue's KYC minimum — surfaces in UI as badge
  non_kyc_available: boolean;
}

interface AggregatorResponse {
  request: AggregatorRequest;
  quotes: VenueQuote[];
  ts: number;
}

// Per-venue KYC profile. Mirrors data/products/*.yaml — kept inline to avoid loading
// YAMLs in the request path. Update here when the YAML pii_floor changes.
const VENUE_KYC: Record<string, { pii_floor: KycTier; non_kyc_available: boolean }> = {
  zkp2p: { pii_floor: 'none', non_kyc_available: true },
  binance_p2p: { pii_floor: 'id', non_kyc_available: false },
  ramp_network: { pii_floor: 'id', non_kyc_available: false },
  revolut_ramp: { pii_floor: 'id', non_kyc_available: false },
};

/** Returns true if the venue's KYC matches the user's tolerance. */
function venueMatchesKyc(venueId: string, filter: KycFilter): boolean {
  if (filter === 'any') return true;
  const v = VENUE_KYC[venueId];
  if (!v) return true; // unknown venue → don't filter out
  if (filter === 'none') return v.non_kyc_available;
  const venueIdx = KYC_ORDER.indexOf(v.pii_floor);
  const filterIdx = KYC_ORDER.indexOf(filter as KycTier);
  return venueIdx <= filterIdx;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

async function callJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

// ─── Per-venue quote calls ──────────────────────────────────────────────────────

interface ZkpQuoteResp {
  best_per_platform: Array<{
    platform: string;
    rate: number;
    spread_bps: number;
    usdc_received: number;
  }>;
}

async function quoteZkp2p(
  base: string,
  req: AggregatorRequest,
): Promise<VenueQuote> {
  const kyc = VENUE_KYC.zkp2p;
  // zkp2p is onramp-only (taker pays fiat, gets USDC).
  if (req.direction !== 'buy') {
    return {
      venue: 'zkp2p',
      venue_label: 'Peer',
      category: 'onchain',
      available: false,
      source: 'unavailable',
      notes: 'zkp2p is onramp-only',
      pii_floor: kyc.pii_floor,
      non_kyc_available: kyc.non_kyc_available,
    };
  }
  // Peerlytics deposits are USDC-denominated — there is no asset parameter upstream.
  // A USDC quote is comparable for dollar-stable requests, but ranking 1000 USDC
  // against 0.51 ETH by raw asset_amount would put zkp2p first on every ETH/BTC
  // request. Exclude it for non-stable assets instead.
  const requestedAsset = (req.asset ?? 'USDC').toUpperCase();
  if (requestedAsset !== 'USDC' && requestedAsset !== 'USDT') {
    return {
      venue: 'zkp2p',
      venue_label: 'Peer',
      category: 'onchain',
      available: false,
      source: 'unavailable',
      notes: `zkp2p settles in USDC only — no ${requestedAsset} route`,
      pii_floor: kyc.pii_floor,
      non_kyc_available: kyc.non_kyc_available,
    };
  }
  const zMethodId = req.payment_methods?.[0];
  const zNative = venueMethodIds('zkp2p', zMethodId);
  if (zNative === null) return methodUnsupported('zkp2p', 'onchain', zMethodId!);
  const resp = await callJson<ZkpQuoteResp>(`${base}/api/zkp2p/quote`, {
    fiat_amount: req.fiat_amount,
    fiat_currency: req.fiat_currency,
    payment_methods: zNative,
  });
  if (!resp || !resp.best_per_platform?.length) {
    return {
      venue: 'zkp2p',
      venue_label: 'Peer',
      category: 'onchain',
      available: false,
      source: 'live',
      notes: 'No matching deposits',
      pii_floor: kyc.pii_floor,
      non_kyc_available: kyc.non_kyc_available,
    };
  }
  const best = resp.best_per_platform[0];
  return {
    venue: 'zkp2p',
    venue_label: 'Peer',
    category: 'onchain',
    available: true,
    asset: 'USDC',
    rate: best.rate,
    asset_amount: best.usdc_received,
    spread_bps: best.spread_bps,
    effective_pct: best.spread_bps / 100,
    source: 'live',
    payment_method: best.platform,
    notes: requestedAsset === 'USDT' ? 'Settles in USDC (≈1:1 with USDT)' : undefined,
    pii_floor: kyc.pii_floor,
    non_kyc_available: kyc.non_kyc_available,
  };
}

interface BinanceQuoteResp {
  best_per_method: Array<{
    advNo: string;
    price: number;
    asset_received: number;
    payment_methods: string[];
  }>;
  request: { asset: string };
}

/**
 * A venue that genuinely doesn't offer the requested rail is EXCLUDED WITH A REASON,
 * never silently emptied. Before this existed, choosing "Bank transfer (SEPA)" sent
 * Ramp's identifier to Binance, matched nothing, and rendered as "No matching ads" —
 * indistinguishable from "this venue has no liquidity", which is a different claim.
 */
function methodUnsupported(
  venue: 'zkp2p' | 'binance_p2p' | 'ramp_network' | 'revolut_ramp',
  category: VenueQuote['category'],
  methodId: string,
): VenueQuote {
  const kyc = VENUE_KYC[venue];
  const label = methodById(methodId)?.label ?? methodId;
  return {
    venue,
    venue_label: VENUE_LABEL[venue],
    category,
    available: false,
    source: 'unavailable',
    notes: `${VENUE_LABEL[venue]} does not offer ${label} — try "Any payment method" to see its other rails`,
    pii_floor: kyc.pii_floor,
    non_kyc_available: kyc.non_kyc_available,
  };
}

async function quoteBinance(
  base: string,
  req: AggregatorRequest,
): Promise<VenueQuote> {
  const kyc = VENUE_KYC.binance_p2p;
  const methodId = req.payment_methods?.[0];
  const nativeMethods = venueMethodIds('binance_p2p', methodId);
  if (nativeMethods === null) return methodUnsupported('binance_p2p', 'cex_p2p', methodId!);
  const resp = await callJson<BinanceQuoteResp>(`${base}/api/binance_p2p/quote`, {
    fiat_amount: req.fiat_amount,
    fiat_currency: req.fiat_currency,
    asset: req.asset ?? 'USDT',
    payment_methods: nativeMethods,
    direction: req.direction,
  });
  if (!resp || !resp.best_per_method?.length) {
    return {
      venue: 'binance_p2p',
      venue_label: 'Binance P2P',
      category: 'cex_p2p',
      available: false,
      source: 'live',
      notes: 'No matching ads',
      pii_floor: kyc.pii_floor,
      non_kyc_available: kyc.non_kyc_available,
    };
  }
  const best = resp.best_per_method[0];
  return {
    venue: 'binance_p2p',
    venue_label: 'Binance P2P',
    category: 'cex_p2p',
    available: true,
    asset: resp.request.asset,
    rate: best.price,
    // binance route returns asset_received; for sell it's actually asset_sent. The math
    // is the same (fiat_amount / price) — we surface as asset_amount and let the UI label.
    asset_amount: best.asset_received,
    // We don't have a clean spread number from this endpoint without an FX mid call;
    // leaving spread_bps undefined. Effective rate vs ours' reference can be inferred.
    source: 'live',
    payment_method: best.payment_methods[0] ?? 'p2p_local',
    pii_floor: kyc.pii_floor,
    non_kyc_available: kyc.non_kyc_available,
  };
}

interface RampAssetInfo {
  symbol: string;
  chain: string;
  enabled: boolean;
  hidden: boolean;
  price?: Record<string, number>;
}
interface RampAssetsResp {
  assets?: RampAssetInfo[];
}

async function quoteRamp(req: AggregatorRequest): Promise<VenueQuote> {
  const kyc = VENUE_KYC.ramp_network;
  // Approach B approximation: Ramp's /assets reference price × hand-maintained fee
  // table. NOT user-quoted; flagged as 'approximated' in the response so callers can
  // surface a warning.
  // An explicitly requested method that Ramp doesn't offer is EXCLUDED, not priced at a
  // default. The old code fell through to RAMP_FEE_DEFAULT_BPS (390), so asking for
  // "Revolut" produced a confident-looking "Ramp Network · 3.90% · via revolut" row for a
  // rail Ramp has never supported — and because the same request zeroed Binance and
  // zkp2p, Ramp looked like the only venue offering it. Inventing a route is worse than
  // showing none.
  const rMethodId = req.payment_methods?.[0];
  const rampNative = venueMethodIds('ramp_network', rMethodId);
  if (rampNative === null) return methodUnsupported('ramp_network', 'ramp', rMethodId!);
  const method = rampNative[0] ?? 'CARD_PAYMENT';
  const fiat = req.fiat_currency.toUpperCase();
  // Still defensive: a mapped-but-unpriced method falls back rather than throwing.
  const feeBps = rampFeeBps(method, fiat, req.direction) ?? RAMP_FEE_DEFAULT_BPS;

  try {
    const r = await fetch(
      `${RAMP_BASE}/host-api/v3/assets?currencyCode=${fiat}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    if (!r.ok) throw new Error(`Ramp ${r.status}`);
    const data = (await r.json()) as RampAssetsResp;
    const asset = req.asset ?? 'USDC';
    const usdcEntry = (data.assets ?? []).find(
      (a) => a.symbol === asset && a.enabled && !a.hidden && a.price?.[fiat],
    );
    if (!usdcEntry?.price?.[fiat]) {
      return {
        venue: 'ramp_network',
        venue_label: 'Ramp Network',
        category: 'ramp',
        available: false,
        source: 'approximated',
        notes: `No ${asset} reference price for ${fiat} on Ramp`,
        pii_floor: kyc.pii_floor,
        non_kyc_available: kyc.non_kyc_available,
      };
    }
    const reference = usdcEntry.price[fiat];
    const effectiveRate =
      req.direction === 'buy'
        ? reference * (1 + feeBps / 10_000)
        : reference * (1 - feeBps / 10_000);
    const assetAmount = req.fiat_amount / effectiveRate;
    return {
      venue: 'ramp_network',
      venue_label: 'Ramp Network',
      category: 'ramp',
      available: true,
      asset,
      rate: effectiveRate,
      asset_amount: assetAmount,
      spread_bps: feeBps,
      effective_pct: feeBps / 100,
      source: 'approximated',
      payment_method: method,
      notes:
        'Approximated: Ramp reference price + hand-maintained fee table. Real all-in price requires partner hostApiKey.',
      pii_floor: kyc.pii_floor,
      non_kyc_available: kyc.non_kyc_available,
    };
  } catch (e) {
    return {
      venue: 'ramp_network',
      venue_label: 'Ramp Network',
      category: 'ramp',
      available: false,
      source: 'approximated',
      notes: `Ramp upstream failed: ${(e as Error).message}`,
      pii_floor: kyc.pii_floor,
      non_kyc_available: kyc.non_kyc_available,
    };
  }
}

// ─── Revolut Ramp (live inline quote) ───────────────────────────────────────────

interface RevolutRampConfig {
  fiatCurrencies: Array<{ currency: string; fractionDigits: number }>;
  cryptoCurrencies: Array<{
    currency: string;
    blockchain: string;
    fractionDigits: number;
    buyActive: boolean;
  }>;
}

interface RevolutRampQuote {
  quote?: {
    baseAmount: { amount: number };
    counterAmount: { amount: number };
    fee: { total: { amount: number } };
  };
}

async function quoteRevolutRamp(req: AggregatorRequest): Promise<VenueQuote> {
  const kyc = VENUE_KYC.revolut_ramp;
  const unavailable = (notes: string, source: VenueQuote['source'] = 'unavailable'): VenueQuote => ({
    venue: 'revolut_ramp',
    venue_label: 'Revolut Ramp',
    category: 'ramp',
    available: false,
    source,
    notes,
    pii_floor: kyc.pii_floor,
    non_kyc_available: kyc.non_kyc_available,
  });

  // /orders/quote is buy-only (verified: side/direction params are ignored).
  if (req.direction !== 'buy') return unavailable('Revolut Ramp quoting is buy-only');

  const fiat = req.fiat_currency.toUpperCase();
  const asset = (req.asset ?? 'USDC').toUpperCase();
  try {
    const cfgResp = await fetch(`${REVOLUT_RAMP_BASE}/config`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!cfgResp.ok) throw new Error(`config ${cfgResp.status}`);
    const cfg = (await cfgResp.json()) as RevolutRampConfig;
    const fiatCfg = cfg.fiatCurrencies.find((f) => f.currency === fiat);
    const cryptoCfg = cfg.cryptoCurrencies.find((c) => c.currency === asset && c.buyActive);
    if (!fiatCfg) return unavailable(`${fiat} not supported on Revolut Ramp`);
    if (!cryptoCfg) {
      // Notably: no stablecoins on the Ramp surface (USDC/USDT are in-app only).
      return unavailable(`${asset} not offered on Revolut Ramp (no stablecoins)`);
    }

    const fiatAmountMinor = Math.round(req.fiat_amount * 10 ** fiatCfg.fractionDigits);
    const qResp = await fetch(
      `${REVOLUT_RAMP_BASE}/orders/quote?fiatCurrency=${fiat}&cryptoCurrency=${asset}` +
        `&blockchain=${cryptoCfg.blockchain}&fiatAmount=${fiatAmountMinor}&partnerId=${REVOLUT_RAMP_PARTNER_ID}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    if (!qResp.ok) throw new Error(`quote ${qResp.status}`);
    const q = ((await qResp.json()) as RevolutRampQuote).quote;
    if (!q || q.counterAmount.amount <= 0) return unavailable('No quote returned', 'live');

    const received = q.counterAmount.amount / 10 ** cryptoCfg.fractionDigits;
    const feeTotal = q.fee.total.amount / 10 ** fiatCfg.fractionDigits;
    return {
      venue: 'revolut_ramp',
      venue_label: 'Revolut Ramp',
      category: 'ramp',
      available: true,
      asset,
      rate: req.fiat_amount / received,
      asset_amount: received,
      effective_pct: (feeTotal / req.fiat_amount) * 100,
      source: 'live',
      payment_method: 'revolut_pay',
      notes: 'Live venue quote (itemized fee) — requires a Revolut account at checkout.',
      pii_floor: kyc.pii_floor,
      non_kyc_available: kyc.non_kyc_available,
    };
  } catch (e) {
    return unavailable(`Revolut Ramp upstream failed: ${(e as Error).message}`, 'live');
  }
}

// ─── KYC-excluded venue placeholder ─────────────────────────────────────────────
// When a venue is excluded by the user's KYC filter, return a dummy VenueQuote tagged
// with `notes` explaining why. UI surfaces it as a dimmed row in the unavailable list.
function kycFiltered(venueId: string, label: string, category: string): VenueQuote {
  const k = VENUE_KYC[venueId] ?? { pii_floor: 'id' as KycTier, non_kyc_available: false };
  return {
    venue: venueId,
    venue_label: label,
    category,
    available: false,
    source: 'unavailable',
    notes: `Excluded by KYC filter (venue requires ${k.pii_floor})`,
    pii_floor: k.pii_floor,
    non_kyc_available: k.non_kyc_available,
  };
}

// ─── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: AggregatorRequest;
  try {
    body = (await req.json()) as AggregatorRequest;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (
    !body.fiat_currency ||
    typeof body.fiat_amount !== 'number' ||
    body.fiat_amount <= 0 ||
    (body.direction !== 'buy' && body.direction !== 'sell')
  ) {
    return Response.json({ error: 'missing_required_fields' }, { status: 400 });
  }

  // Construct base URL from the incoming request so we can call our own routes.
  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;

  const kycFilter: KycFilter = body.kyc_max ?? 'any';
  // Apply KYC filter upfront — short-circuit venues the user has excluded so we don't
  // waste HTTP calls on quotes they'll never accept.
  const [zkp2p, binance, ramp, revolutRamp] = await Promise.all([
    venueMatchesKyc('zkp2p', kycFilter)
      ? quoteZkp2p(base, body)
      : kycFiltered('zkp2p', 'Peer', 'onchain'),
    venueMatchesKyc('binance_p2p', kycFilter)
      ? quoteBinance(base, body)
      : kycFiltered('binance_p2p', 'Binance P2P', 'cex_p2p'),
    venueMatchesKyc('ramp_network', kycFilter)
      ? quoteRamp(body)
      : kycFiltered('ramp_network', 'Ramp Network', 'ramp'),
    venueMatchesKyc('revolut_ramp', kycFilter)
      ? quoteRevolutRamp(body)
      : kycFiltered('revolut_ramp', 'Revolut Ramp', 'ramp'),
  ]);

  // Rank by direction:
  //   buy  → most asset_amount (more crypto received for the fiat spent) wins.
  //   sell → least asset_amount (less crypto needed to receive the target fiat) wins.
  // Unavailable venues sink to the bottom either way.
  const sortDir = body.direction === 'buy' ? -1 : 1;
  const quotes = [zkp2p, binance, ramp, revolutRamp].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.asset_amount == null || b.asset_amount == null) return 0;
    return (a.asset_amount - b.asset_amount) * sortDir;
  });

  const resp: AggregatorResponse = { request: body, quotes, ts: Date.now() };
  return Response.json(resp, {
    headers: {
      'cache-control': 's-maxage=15, stale-while-revalidate=45',
    },
  });
}
