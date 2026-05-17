import type { Adapter, Snapshot, QuoteRequest, QuoteResponse, DailyPoint, Market } from '../lib/types.ts';

const PRODUCT_ID = 'ramp_network';
const BASE_URL = 'https://api.rampnetwork.com/api';

/**
 * Approach B (per user decision 2026-05-17): hand-maintained payment-method fee table.
 * Combined with Ramp's public /assets reference price, this lets us compute approximate
 * all-in rates without a partner hostApiKey. Values are in basis points (1 bp = 0.01%).
 *
 * EDIT THIS TABLE when Ramp publishes new fees: https://ramp.network/pricing-policy
 *
 * Calibration sources (last verified 2026-05-17):
 *   - Ramp Pricing Policy (https://rampnetwork.com/pricing-policy): "up to" ceilings per method
 *   - User-observed quote: $1000 USD → 975.2 USDC.base = +245 bps all-in (likely card)
 *
 * Numbers are markups ON TOP of Ramp's /assets reference price. Real quotes vary by
 * jurisdiction/tx-size/currency (refreshed every 30s in the widget).
 *
 * Currency-tier handling: per docs, card payments charge ~3.9% for USD/EUR/GBP but jump
 * to ~5.45% for every other fiat. Apple Pay / Google Pay inherit this tiering since they
 * settle to the underlying card. See `feeBpsFor()` below for the lookup logic.
 *
 * Keys MUST match Ramp's /payment-methods `name` field exactly (uppercase, snake_case).
 * Buy-side only — ACH/SEPA/SPEI/RTP from the sell-side fee schedule are excluded since
 * they're not available for buying.
 */
// Buy-side fees (onramp) — see header comment for sources + calibration notes.
const RAMP_FEE_BPS_BY_METHOD_BUY: Record<string, number> = {
  CARD_PAYMENT: 245,         // for USD/EUR/GBP only — exotic fiats use CARD_EXOTIC_BPS_BUY
  APPLE_PAY: 245,            // "same as underlying card" per docs — tiering applies
  GOOGLE_PAY: 245,           // ditto
  MANUAL_BANK_TRANSFER: 140, // SEPA/manual (Europe, EUR/GBP); docs cap
  AUTO_BANK_TRANSFER: 240,   // "Easy bank transfer" fast rail (Europe); docs cap
  PIX: 290,                  // BRL only; docs cap
};

// Sell-side fees (offramp) — sourced directly from
// https://support.ramp.network/en/articles/8957-what-are-the-fees-for-selling-crypto
// Docs don't split sell-side cards into major/exotic tiers — single 4.49% rate.
const RAMP_FEE_BPS_BY_METHOD_SELL: Record<string, number> = {
  CARD_PAYMENT: 449,         // Payout-to-card (Mastercard / Visa) per docs
  APPLE_PAY: 449,            // inherits underlying card
  GOOGLE_PAY: 449,           // inherits underlying card
  MANUAL_BANK_TRANSFER: 99,  // SEPA / SEPA Instant per docs
  AUTO_BANK_TRANSFER: 99,    // SEPA Instant per docs
  ACH: 99,                   // sell-only per docs (no buy equivalent — buying via ACH n/a)
  // PIX is NOT in sell docs — Brazil sell-out routes aren't published; skip.
  // SPEI (Mexico) at 290 bps per docs is sell-only too but not currently in API responses.
};

/** Card-like methods that follow the major/exotic currency-tier split (buy-side only). */
const CARD_LIKE_METHODS = new Set(['CARD_PAYMENT', 'APPLE_PAY', 'GOOGLE_PAY']);
/** Fiats that get Ramp's "major currency" card pricing (~3.9% cap; 245 observed). */
const MAJOR_CARD_FIATS = new Set(['USD', 'EUR', 'GBP']);
/** Buy-side card fee for non-USD/EUR/GBP fiats per docs ("up to 5.45%"). */
const CARD_EXOTIC_BPS_BUY = 545;

const FEE_DEFAULT_BPS = 390; // Conservative fallback = card USD/EUR/GBP ceiling. Used when
                              // a method appears in /payment-methods but isn't in our table.

/**
 * Lookup the fee in bps for (method, fiat, direction). Returns null when the method is
 * NOT available for the requested direction (e.g. PIX on sell, ACH on buy) — caller
 * should skip that method for the given direction.
 *
 * Card-like methods get currency-tier treatment on buy-side only; sell-side card payout
 * is a single 4.49% rate per docs.
 */
function feeBpsFor(method: string, fiat: string, direction: 'buy' | 'sell'): number | null {
  const table = direction === 'buy' ? RAMP_FEE_BPS_BY_METHOD_BUY : RAMP_FEE_BPS_BY_METHOD_SELL;
  const baseFee = table[method];
  if (baseFee == null) return null; // method not available for this direction
  if (direction === 'buy' && CARD_LIKE_METHODS.has(method) && !MAJOR_CARD_FIATS.has(fiat)) {
    return CARD_EXOTIC_BPS_BUY;
  }
  return baseFee;
}

/** USDC is the most-common onramp target and is supported across every fiat Ramp covers. */
const DEFAULT_ASSET = 'USDC';

/** Friendly labels for the few method names whose canonical form reads poorly. */
const METHOD_LABEL: Record<string, string> = {
  CARD_PAYMENT: 'Card',
  APPLE_PAY: 'Apple Pay',
  GOOGLE_PAY: 'Google Pay',
  MANUAL_BANK_TRANSFER: 'Bank transfer',
  AUTO_BANK_TRANSFER: 'Bank transfer (auto)',
  PIX: 'PIX',
  ACH: 'ACH',
  SEPA: 'SEPA',
};
function methodLabel(name: string): string {
  return METHOD_LABEL[name] ?? name;
}

interface RampAssetInfo {
  symbol: string;
  chain: string;
  name: string;
  decimals: number;
  type: string;
  address?: string | null;
  enabled: boolean;
  hidden: boolean;
  price?: Record<string, number>;
  minPurchaseAmount?: number;
  maxPurchaseAmount?: number;
  minPurchaseCryptoAmountString?: string;
}

interface RampAssetsResp {
  assets?: RampAssetInfo[];
}

interface RampPaymentMethod {
  name: string;
  currencies?: string[];
  countries?: string[];
}

interface RampQuoteEntry {
  fiatCurrency: string;
  cryptoAmount: string;
  fiatValue: number;
  baseRampFee?: number;
  appliedFee?: number;
}

type RampQuoteResult = {
  asset?: RampAssetInfo;
} & Record<string, RampQuoteEntry | RampAssetInfo | undefined>;

const SAMPLE_FIATS = ['USD', 'EUR', 'GBP'];

interface RampCurrency {
  fiatCurrency: string;
  onrampAvailable?: boolean;
  offrampAvailable?: boolean;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { headers: { accept: 'application/json' }, ...init });
  if (!resp.ok) throw new Error(`Ramp ${resp.status} ${url}`);
  return (await resp.json()) as T;
}

async function fetchAssets(currencyCode: string): Promise<RampAssetInfo[]> {
  const url = `${BASE_URL}/host-api/v3/assets?currencyCode=${currencyCode}`;
  const data = await getJson<RampAssetsResp>(url);
  return data.assets ?? [];
}

async function fetchPaymentMethods(): Promise<RampPaymentMethod[]> {
  const url = `${BASE_URL}/host-api/v3/payment-methods`;
  return getJson<RampPaymentMethod[]>(url);
}

async function fetchOnrampFiats(): Promise<string[]> {
  // /currencies returns a flat array [{ fiatCurrency, onrampAvailable, offrampAvailable }]
  // (NOT wrapped in { data: ... } despite some Ramp endpoints using that envelope).
  const url = `${BASE_URL}/host-api/v3/currencies`;
  try {
    const data = await getJson<RampCurrency[]>(url);
    return (data ?? [])
      .filter((c) => c.onrampAvailable && c.fiatCurrency)
      .map((c) => c.fiatCurrency.toUpperCase());
  } catch {
    return SAMPLE_FIATS.slice(); // graceful fallback
  }
}

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();

  // STAGE 1: discover active fiats + payment methods in parallel.
  const [onrampFiats, methods] = await Promise.all([
    fetchOnrampFiats(),
    fetchPaymentMethods().catch(() => [] as RampPaymentMethod[]),
  ]);

  // STAGE 2: per-fiat USDC probe — one /assets call per fiat. Each returns ~30-50 assets;
  // we only need the USDC entry to get the fiat-per-USDC reference price. ~28 calls in
  // parallel, all under the public auth-free endpoint.
  const usdcRefByFiat: Record<string, number> = {};
  const maxPurchaseByFiat: Record<string, number> = {};
  await Promise.all(
    onrampFiats.map(async (fiat) => {
      const assets = await fetchAssets(fiat).catch(() => [] as RampAssetInfo[]);
      const usdc = assets.find(
        (a) => a.symbol === DEFAULT_ASSET && a.enabled && !a.hidden && typeof a.price?.[fiat] === 'number',
      );
      if (!usdc) return;
      usdcRefByFiat[fiat] = usdc.price![fiat]!;
      if (typeof usdc.maxPurchaseAmount === 'number') {
        maxPurchaseByFiat[fiat] = usdc.maxPurchaseAmount;
      }
    }),
  );

  // STAGE 3: build Live Rates rows for BOTH directions. For each (fiat, direction), find
  // the cheapest method that's available for that direction (per /payment-methods coverage
  // AND our hand-maintained fee tables), and emit one Market row tagged with direction.
  //
  // On buy: effective_rate = reference × (1 + fee_bps).  taker pays more fiat per asset.
  // On sell: effective_rate = reference × (1 − fee_bps). taker receives less fiat per asset.
  // Same maxPurchaseAmount used for both — Ramp doesn't publish a separate sell ceiling.
  const usdRef = usdcRefByFiat['USD']; // for USD-equivalent liquidity column
  const markets: Market[] = [];
  const directions: Array<'buy' | 'sell'> = ['buy', 'sell'];
  for (const direction of directions) {
    for (const [fiat, reference] of Object.entries(usdcRefByFiat)) {
      // Filter methods to those (a) Ramp's API says serve this fiat and (b) we have a
      // fee for in this direction (null skips PIX on sell, ACH on buy, etc.).
      const applicable = methods
        .filter((m) => m.currencies?.includes(fiat))
        .map((m) => ({ m, fee: feeBpsFor(m.name, fiat, direction) }))
        .filter((x): x is { m: RampPaymentMethod; fee: number } => x.fee !== null);
      if (applicable.length === 0) continue;

      let best = applicable[0];
      for (const x of applicable) if (x.fee < best.fee) best = x;
      const bestFeeBps = best.fee;
      const effectiveRate =
        direction === 'buy'
          ? reference * (1 + bestFeeBps / 10_000)
          : reference * (1 - bestFeeBps / 10_000);
      const maxFiat = maxPurchaseByFiat[fiat] ?? 0;
      const totalLiquidityUsd =
        usdRef && reference > 0 ? maxFiat * (usdRef / reference) : 0;
      markets.push({
        currency: fiat,
        platform: methodLabel(best.m.name),
        direction,
        best_rate: effectiveRate,
        fx_mid_rate: reference,
        spread_bps: bestFeeBps,
        total_liquidity_usd: totalLiquidityUsd,
        deposit_count: applicable.length,
      });
    }
  }
  markets.sort((a, b) => a.spread_bps - b.spread_bps);

  // STAGE 4: ramp_capacity for the liquidity KPI — per-fiat single-tx max + the
  // USD-equivalent for the headline KPI. Per-fiat caps normalize to roughly the same
  // USD amount (~$17k) since Ramp sizes them to a USD ceiling. We surface that single
  // USD number rather than the per-fiat dict (which can't be meaningfully summed).
  const capacityByFiat: Record<string, { single_tx_max: number; daily_max: number }> = {};
  for (const fiat of Object.keys(maxPurchaseByFiat)) {
    const m = maxPurchaseByFiat[fiat];
    capacityByFiat[fiat] = { single_tx_max: m, daily_max: m };
  }
  const max_single_trade_usd = (() => {
    // Prefer USD entry directly (no FX needed). Else convert any fiat to USD using the
    // USDC reference ratio: maxFiat × (USDC.price[USD] / USDC.price[fiat]).
    if (usdcRefByFiat['USD'] && maxPurchaseByFiat['USD']) return maxPurchaseByFiat['USD'];
    const usdRefLocal = usdcRefByFiat['USD'];
    if (!usdRefLocal) return undefined;
    let best = 0;
    for (const fiat of Object.keys(maxPurchaseByFiat)) {
      const m = maxPurchaseByFiat[fiat];
      const fiatRef = usdcRefByFiat[fiat];
      if (!fiatRef || fiatRef <= 0) continue;
      const usd = m * (usdRefLocal / fiatRef);
      if (usd > best) best = usd;
    }
    return best > 0 ? best : undefined;
  })();

  // STAGE 5: headline observed_spread_bps — the best USD BUY method's bps (cross-venue
  // comparable: all venues compare a $1k USD onramp trade). The KPI stays onramp-anchored
  // regardless of the user's toggle on the Live Rates table (per UX decision: KPIs are
  // stable cross-venue benchmarks, the toggle is a drilldown affordance).
  const usdBuyMarket = markets.find((m) => m.currency === 'USD' && m.direction === 'buy');
  const spreadValue = usdBuyMarket?.spread_bps ?? null;

  // fee_snapshot: published per-method fee, paired with a representative asset for context.
  // Uses the first applicable fiat per method + buy-side fee table.
  const sample_rows = methods.slice(0, 5).map((m) => {
    const fiat = (m.currencies?.[0] ?? '').toUpperCase();
    return {
      fiat,
      asset: DEFAULT_ASSET,
      payment_method: m.name,
      effective_rate_bps: feeBpsFor(m.name, fiat, 'buy') ?? FEE_DEFAULT_BPS,
    };
  });

  return {
    liquidity: {
      value: { kind: 'ramp_capacity', fiat: capacityByFiat, max_single_trade_usd },
      provenance: 'api',
      last_verified: now,
      evidence_url: `${BASE_URL}/host-api/v3/assets`,
    },
    volume_30d_usd: {
      value: null,
      provenance: 'unavailable',
      last_verified: now,
      notes: 'Ramp Network does not publish public volume statistics',
    },
    observed_spread_bps: {
      value: spreadValue,
      provenance: 'self_reported',
      spread_aggregation: 'effective_at_size',
      sample_size: usdBuyMarket ? 1 : 0,
      period: 'usd_$1k_quote_approximated',
      last_verified: now,
      notes:
        'Approximated: Ramp public reference price + hand-maintained payment-method fee table (adapters/ramp_network.ts RAMP_FEE_BPS_BY_METHOD_BUY/SELL). NOT a user-quoted spread — real all-in price requires partner hostApiKey and /onramp/quote/all.',
    },
    fee_snapshot: { ts: now, sample_rows, provenance: 'self_reported' },
    markets: markets.length
      ? {
          value: markets,
          provenance: 'self_reported',
          last_verified: now,
          evidence_url: `${BASE_URL}/host-api/v3/assets`,
          notes:
            'Approximated rates: Ramp reference price × (1 + hand-maintained payment-method fee in bps). NOT user-quoted; real prices require /onramp/quote/all with a partner hostApiKey.',
        }
      : undefined,
    // Ramp Network is a hosted ramp, not a P2P offer book — no orderbook concept.
    // Quote requires a hostApiKey we don't have, so no programmatic quote either.
    capabilities: { orderbook: false, quote: false },
  };
}

async function quote(req: QuoteRequest): Promise<QuoteResponse | null> {
  const apiKey = process.env.RAMP_HOST_API_KEY;
  if (!apiKey) return null;
  if (req.direction !== 'buy') return null;

  const url = `${BASE_URL}/host-api/v3/onramp/quote/all?hostApiKey=${apiKey}`;
  const body = {
    cryptoAssetSymbol: req.asset.toUpperCase(),
    fiatCurrency: req.fiat.toUpperCase(),
    fiatValue: req.amount,
    userCountryCode: req.country,
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as RampQuoteResult;

    const methodKey = req.payment_method.toUpperCase();
    const entry = data[methodKey] as RampQuoteEntry | undefined;
    if (!entry) return null;

    const cryptoAmount = Number(entry.cryptoAmount) / 10 ** 18;
    return {
      product_id: PRODUCT_ID,
      effective_rate_bps: 0,
      fee_pct: entry.appliedFee ?? 0,
      estimated_received: cryptoAmount,
      ttl_sec: 30,
      source: 'live',
      evidence: { kind: 'quote_endpoint', ref: 'POST /host-api/v3/onramp/quote/all' },
    };
  } catch {
    return null;
  }
}

async function history(_days: number): Promise<DailyPoint[]> {
  // Ramp Network does not publish historical volume / spread.
  return [];
}

const adapter: Adapter = { id: PRODUCT_ID, snapshot, quote, history };
export default adapter;
