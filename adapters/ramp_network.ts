import type { Adapter, Snapshot, QuoteRequest, QuoteResponse, DailyPoint } from '../lib/types.ts';
import { fxMid } from '../lib/fx.ts';
import { median } from '../lib/stats.ts';

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
const SAMPLE_ASSETS = ['USDC', 'ETH', 'BTC'];

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

  // observed_spread_bps: for each (asset, fiat) sample, compare Ramp's price
  // (the asset's price[fiat] field) to CoinGecko mid. Take median over the set.
  const spreads: number[] = [];
  for (const [fiat, assets] of assetsByFiat) {
    for (const sym of SAMPLE_ASSETS) {
      const a = assets.find((x) => x.symbol.toUpperCase() === sym && x.enabled);
      const rampPrice = a?.price?.[fiat];
      if (typeof rampPrice !== 'number') continue;
      try {
        const mid = await fxMid(sym, fiat, now);
        if (!mid) continue;
        spreads.push(((rampPrice - mid) / mid) * 10_000);
      } catch {
        // skip pairs we can't price
      }
    }
  }

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
      value: spreads.length ? median(spreads) : null,
      provenance: 'api',
      spread_aggregation: 'median',
      sample_size: spreads.length,
      period: 'sample_pairs',
      last_verified: now,
      evidence_url: `${BASE_URL}/host-api/v3/assets`,
      notes: '/assets price is reference, not user-quoted price. Real user spread requires /quote with hostApiKey.',
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
