import type { Adapter, Snapshot, QuoteRequest, QuoteResponse, DailyPoint } from '../lib/types.ts';
// Note: fxMid + median were previously used to aggregate Ramp's /assets reference-price
// spread across sampled pairs, but that metric was misleading (it doesn't include the
// payment-method fee, which is the dominant component of real user-paid spread). The
// headline observed_spread_bps now reports 'unavailable' until we have a partner
// hostApiKey to call /onramp/quote/all.

const PRODUCT_ID = 'ramp_network';
const BASE_URL = 'https://api.rampnetwork.com/api';

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
// SAMPLE_ASSETS was used by the old reference-price spread compute; removed alongside
// that metric. If a future quote-endpoint integration needs an asset shortlist, restore.

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

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();

  const [assetsByFiat, methods] = await Promise.all([
    Promise.all(SAMPLE_FIATS.map(async (f) => [f, await fetchAssets(f)] as const)),
    fetchPaymentMethods().catch(() => [] as RampPaymentMethod[]),
  ]);

  // observed_spread_bps is now provenance='unavailable' (see below — needs hostApiKey
  // for real user-quoted spreads). The /assets reference-price probe was misleading
  // because it omits payment-method fees.

  // ramp_capacity: per-fiat single-tx max from a representative asset's limits.
  const capacityByFiat: Record<string, { single_tx_max: number; daily_max: number }> = {};
  for (const [fiat, assets] of assetsByFiat) {
    const sample = assets.find((x) => x.enabled && typeof x.maxPurchaseAmount === 'number');
    if (sample?.maxPurchaseAmount) {
      capacityByFiat[fiat] = {
        single_tx_max: sample.maxPurchaseAmount,
        daily_max: sample.maxPurchaseAmount,
      };
    }
  }

  // fee_snapshot: published per-method fee, paired with a representative asset for context.
  const sample_rows = methods.slice(0, 5).map((m) => ({
    fiat: (m.currencies?.[0] ?? '').toUpperCase(),
    asset: 'USDC',
    payment_method: m.name,
    effective_rate_bps: feeBpsForMethod(m.name),
  }));

  return {
    liquidity: {
      value: { kind: 'ramp_capacity', fiat: capacityByFiat },
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
      value: null,
      provenance: 'unavailable',
      spread_aggregation: 'effective_at_size',
      sample_size: 0,
      period: 'usd_$1k_quote',
      last_verified: now,
      notes:
        'Requires partner hostApiKey to compute user-facing spreads via /onramp/quote/all. The public /assets price is a reference, not a user-quoted price — using it would understate the actual spread by the payment-method fee (49 bps for bank methods, 299 bps for cards).',
    },
    fee_snapshot: { ts: now, sample_rows, provenance: 'manual' },
    // Ramp Network is a hosted ramp, not a P2P offer book — no orderbook concept.
    // Quote requires a hostApiKey we don't have, so no programmatic quote either.
    capabilities: { orderbook: false, quote: false },
  };
}

function feeBpsForMethod(name: string): number {
  // From https://rampnetwork.com/pricing — representative; live quote required for exact.
  const upper = name.toUpperCase();
  if (upper.includes('CARD') || upper === 'APPLE_PAY' || upper === 'GOOGLE_PAY') return 299;
  if (upper.includes('BANK') || upper === 'SEPA' || upper === 'ACH' || upper === 'PIX') return 49;
  return 199;
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
