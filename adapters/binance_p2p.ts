import type { Adapter, Snapshot, QuoteRequest, QuoteResponse, DailyPoint } from '../lib/types.ts';
import { fxMid } from '../lib/fx.ts';
import { median, sum, unique } from '../lib/stats.ts';

const PRODUCT_ID = 'binance_p2p';
const SEARCH_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

const SAMPLE_PAIRS: Array<{ fiat: string; asset: string }> = [
  { fiat: 'USD', asset: 'USDT' },
  { fiat: 'EUR', asset: 'USDT' },
  { fiat: 'GBP', asset: 'USDT' },
  { fiat: 'BRL', asset: 'USDT' },
  { fiat: 'INR', asset: 'USDT' },
  { fiat: 'USD', asset: 'BTC' },
];

async function search(params: SearchParams): Promise<BinanceAd[]> {
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
  return data.data ?? [];
}

function adInUsdValue(ad: BinanceAd, midAssetUsd: number): number {
  const remainingAsset = Number(ad.adv.surplusAmount);
  return Number.isFinite(remainingAsset) ? remainingAsset * midAssetUsd : 0;
}

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();

  // Fetch BUY ads (taker buys crypto from maker who lists SELL ads — endpoint returns SELL
  // ads when tradeType=BUY). This is the on-ramp side for our purposes.
  const settled = await Promise.allSettled(
    SAMPLE_PAIRS.map((p) => search({ ...p, tradeType: 'BUY', rows: 20 })),
  );

  const top_pairs: Array<{ pair: string; sum_offers_usd: number; n_makers: number }> = [];
  const allSpreads: number[] = [];
  const sample_rows: Array<{
    fiat: string;
    asset: string;
    payment_method: string;
    effective_rate_bps: number;
  }> = [];

  for (let i = 0; i < SAMPLE_PAIRS.length; i++) {
    const pair = SAMPLE_PAIRS[i];
    const result = settled[i];
    if (result.status !== 'fulfilled') continue;
    const ads = result.value;
    if (!ads.length) continue;

    let mid: number;
    try {
      mid = await fxMid(pair.asset, pair.fiat, now);
    } catch {
      continue;
    }
    if (!mid || !Number.isFinite(mid)) continue;

    const midAssetUsd = pair.fiat === 'USD' ? mid : await fxMid(pair.asset, 'USD', now).catch(() => 0);

    const sumUsd = sum(ads.map((a) => adInUsdValue(a, midAssetUsd)));
    const makers = unique(ads.map((a) => a.advertiser.userNo)).length;
    top_pairs.push({ pair: `${pair.asset}/${pair.fiat}`, sum_offers_usd: sumUsd, n_makers: makers });

    for (const ad of ads) {
      const price = Number(ad.adv.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      allSpreads.push(((price - mid) / mid) * 10_000);
    }

    const top = ads[0];
    if (top) {
      const method =
        top.adv.tradeMethods?.[0]?.identifier ?? top.adv.tradeMethods?.[0]?.tradeMethodName ?? 'p2p_local';
      const price = Number(top.adv.price);
      const effectiveBps = Number.isFinite(price) ? ((price - mid) / mid) * 10_000 : 0;
      sample_rows.push({
        fiat: pair.fiat,
        asset: pair.asset,
        payment_method: method,
        effective_rate_bps: Math.round(effectiveBps),
      });
    }
  }

  return {
    liquidity: {
      value: { kind: 'p2p_offerbook', top_pairs },
      provenance: 'api',
      last_verified: now,
      evidence_url: SEARCH_URL,
    },
    volume_30d_usd: {
      value: null,
      provenance: 'self_reported',
      last_verified: now,
      notes: 'Binance does not separately disclose P2P volume',
    },
    observed_spread_bps: {
      value: allSpreads.length ? median(allSpreads) : null,
      provenance: 'api',
      spread_aggregation: 'median',
      sample_size: allSpreads.length,
      period: 'top_offers',
      last_verified: now,
      evidence_url: SEARCH_URL,
    },
    fee_snapshot: { ts: now, sample_rows: sample_rows.slice(0, 5), provenance: 'api' },
  };
}

async function quote(req: QuoteRequest): Promise<QuoteResponse | null> {
  const tradeType: 'BUY' | 'SELL' = req.direction === 'buy' ? 'BUY' : 'SELL';
  let ads: BinanceAd[];
  try {
    ads = await search({
      fiat: req.fiat.toUpperCase(),
      asset: req.asset.toUpperCase(),
      tradeType,
      rows: 20,
    });
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
