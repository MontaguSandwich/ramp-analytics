// Server-side quote endpoint for binance_p2p. Calls Binance's public adv/search,
// filters ads that can serve the user's amount (fiat in [min_tx, max_tx] AND the
// maker has enough escrowed asset), ranks by best price (lowest fiat-per-asset =
// best for taker buying crypto), returns ranked candidates + best-per-payment-method.
//
// Avoids the orderbook route's "fetch N pages in parallel" because for quotes
// we only need the top of the book for the user's amount. Single-page (20 ads)
// is enough for typical amounts; deep depth lives in the Orderbook tab.

const BINANCE_SEARCH_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SUPPORTED_ASSETS = new Set(['USDT', 'BTC', 'ETH', 'USDC', 'BNB', 'FDUSD']);

interface QuoteRequestBody {
  fiat_amount: number;
  fiat_currency: string;
  asset?: string;
  payment_methods?: string[];
}

interface BinanceAdv {
  advNo: string;
  asset: string;
  fiatUnit: string;
  price: string;
  surplusAmount: string;
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

interface BinanceResp {
  code: string;
  data?: BinanceAd[];
  total?: number;
  message?: string | null;
}

interface QuoteCandidate {
  advNo: string;
  maker: {
    nickname: string;
    userNo: string;
    month_orders: number | null;
    finish_rate: number | null;
  };
  price: number;
  asset_received: number;
  min_fiat: number;
  max_fiat: number;
  available_asset: number;
  available_fiat_value: number;
  payment_methods: string[];
}

interface QuoteResponse {
  candidates: QuoteCandidate[];
  best_per_method: QuoteCandidate[];
  request: {
    fiat_amount: number;
    fiat_currency: string;
    asset: string;
    payment_methods?: string[];
  };
  ts: number;
}

function safeNum(s: string | undefined | null): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: Request) {
  let body: QuoteRequestBody;
  try {
    body = (await req.json()) as QuoteRequestBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (
    typeof body.fiat_amount !== 'number' ||
    body.fiat_amount <= 0 ||
    !body.fiat_currency
  ) {
    return Response.json({ error: 'missing_required_fields' }, { status: 400 });
  }

  const fiat = body.fiat_currency.toUpperCase();
  const asset = (body.asset ?? 'USDT').toUpperCase();
  if (!SUPPORTED_ASSETS.has(asset)) {
    return Response.json({ error: 'unsupported_asset', detail: asset }, { status: 400 });
  }

  const payTypes = (body.payment_methods ?? []).filter((s) => typeof s === 'string' && s.length > 0);

  const upstreamBody = {
    fiat,
    page: 1,
    rows: 20,
    tradeType: 'BUY', // taker buys crypto → endpoint returns maker SELL ads (escrowed)
    asset,
    countries: [],
    payTypes,
    publisherType: null,
  };

  let upstream: Response;
  try {
    upstream = await fetch(BINANCE_SEARCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': UA,
        origin: 'https://p2p.binance.com',
        referer: 'https://p2p.binance.com/',
      },
      body: JSON.stringify(upstreamBody),
      cache: 'no-store',
    });
  } catch (e) {
    return Response.json(
      { error: 'upstream_failed', detail: (e as Error).message },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return Response.json(
      { error: 'upstream_error', status: upstream.status },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as BinanceResp;
  if (data.code !== '000000') {
    return Response.json(
      { error: 'upstream_code', code: data.code, detail: data.message ?? null },
      { status: 502 },
    );
  }

  const ads = data.data ?? [];

  const candidates: QuoteCandidate[] = [];
  for (const ad of ads) {
    const price = safeNum(ad.adv.price);
    if (price <= 0) continue;

    const minTx = safeNum(ad.adv.minSingleTransAmount);
    const maxTx = safeNum(ad.adv.maxSingleTransAmount);
    // The amount must fit the maker's per-trade min/max window.
    if (body.fiat_amount < minTx || body.fiat_amount > maxTx) continue;

    const availableAsset = safeNum(ad.adv.surplusAmount);
    const availableFiatValue = availableAsset * price;
    // The maker must have enough crypto escrowed to cover the trade.
    if (body.fiat_amount > availableFiatValue) continue;

    // Dedupe payment methods — Binance's adv/search returns the same identifier multiple times
    // (one fully-populated row + N metadata-stripped clones). Documented in CLAUDE.md.
    const methods = Array.from(
      new Set(
        (ad.adv.tradeMethods ?? [])
          .map((m) => m.identifier ?? m.tradeMethodName)
          .filter((s): s is string => typeof s === 'string' && s.length > 0),
      ),
    );

    candidates.push({
      advNo: ad.adv.advNo,
      maker: {
        nickname: ad.advertiser.nickName ?? ad.advertiser.userNo,
        userNo: ad.advertiser.userNo,
        month_orders:
          typeof ad.advertiser.monthOrderCount === 'number' ? ad.advertiser.monthOrderCount : null,
        finish_rate:
          typeof ad.advertiser.monthFinishRate === 'number' ? ad.advertiser.monthFinishRate : null,
      },
      price,
      asset_received: body.fiat_amount / price,
      min_fiat: minTx,
      max_fiat: maxTx,
      available_asset: availableAsset,
      available_fiat_value: availableFiatValue,
      payment_methods: methods,
    });
  }

  // Sort by price ascending: lowest fiat-per-asset = most asset received for the fiat = best for taker.
  candidates.sort((a, b) => a.price - b.price);

  // Best per method — one row per unique payment method, smallest price.
  const seen = new Set<string>();
  const bestPerMethod: QuoteCandidate[] = [];
  for (const c of candidates) {
    for (const m of c.payment_methods) {
      if (seen.has(m)) continue;
      seen.add(m);
      // Only push the candidate once even if it has multiple methods.
      if (!bestPerMethod.includes(c)) bestPerMethod.push(c);
    }
  }

  const resp: QuoteResponse = {
    candidates: candidates.slice(0, 20),
    best_per_method: bestPerMethod.slice(0, 5),
    request: { fiat_amount: body.fiat_amount, fiat_currency: fiat, asset, payment_methods: payTypes },
    ts: Date.now(),
  };

  return Response.json(resp, {
    headers: {
      'cache-control': 's-maxage=15, stale-while-revalidate=45',
    },
  });
}
