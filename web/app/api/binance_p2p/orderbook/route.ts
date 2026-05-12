// Server-side proxy to Binance's public adv/search endpoint. Avoids client-side
// CORS issues (p2p.binance.com blocks browser-origin requests) and centralizes
// request shaping. Returns standardized rows the view can render without knowing
// Binance's response shape.
//
// Caches for 20s on the edge; adv/search is a live endpoint so polling faster
// than that adds load without value. The page polls every 30s in normal use.

const BINANCE_SEARCH_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

interface NormalizedAd {
  advNo: string;
  fiat: string;
  asset: string;
  tradeType: 'BUY' | 'SELL';
  price: number;
  surplus_amount: number;
  min_single_tx: number;
  max_single_tx: number;
  payment_methods: string[];
  maker: {
    userNo: string;
    nickname: string;
    month_orders: number | null;
    finish_rate: number | null;
  };
}

function safeNum(s: string | undefined | null): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const PAGE_SIZE = 20; // adv/search caps at 20 rows per page
const MAX_LIMIT = 200; // 10 pages × 20 ads — beyond this, latency + rate-limit risk outweigh UX value

async function fetchPage(args: {
  fiat: string;
  asset: string;
  tradeType: 'BUY' | 'SELL';
  payTypes: string[];
  page: number;
}): Promise<BinanceResp> {
  const body = {
    fiat: args.fiat,
    page: args.page,
    rows: PAGE_SIZE,
    tradeType: args.tradeType,
    asset: args.asset,
    countries: [],
    payTypes: args.payTypes,
    publisherType: null,
  };

  const resp = await fetch(BINANCE_SEARCH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': UA,
      origin: 'https://p2p.binance.com',
      referer: 'https://p2p.binance.com/',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as BinanceResp;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const fiat = (url.searchParams.get('fiat') ?? 'USD').toUpperCase();
  const asset = (url.searchParams.get('asset') ?? 'USDT').toUpperCase();
  const tradeTypeIn = (url.searchParams.get('tradeType') ?? 'BUY').toUpperCase();
  const tradeType: 'BUY' | 'SELL' = tradeTypeIn === 'SELL' ? 'SELL' : 'BUY';
  const payTypes = url.searchParams.getAll('payType').filter((s) => s.length > 0);
  const limitIn = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitIn)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitIn)))
    : 50;
  const pages = Math.ceil(limit / PAGE_SIZE);

  try {
    // Fetch pages 1..N in parallel. Binance tolerates this — their own web UI bursts similarly.
    // If we ever see rate-limit errors, switch to sequential with break-on-empty.
    const results = await Promise.all(
      Array.from({ length: pages }, (_, i) => fetchPage({ fiat, asset, tradeType, payTypes, page: i + 1 })),
    );

    // If page 1 returns a non-success code, propagate it. Later pages going empty is fine
    // (we just hit the end of the book) but a code error on page 1 means a request problem.
    const first = results[0];
    if (first.code !== '000000') {
      return Response.json(
        { error: 'upstream_error', code: first.code, detail: first.message ?? null },
        { status: 502 },
      );
    }

    const totalAvailable = first.total ?? 0;
    const allAds = results.flatMap((r) => r.data ?? []);

    const ads: NormalizedAd[] = allAds.slice(0, limit).map((a) => {
      // Binance's adv/search frequently returns the same payment method as multiple
      // tradeMethods entries (same identifier, one fully populated + N metadata-stripped
      // clones). Dedupe at the source so downstream consumers can treat the array as a
      // set — otherwise the view would render "[Postepay] [Postepay] [Postepay] +1"
      // for an ad with 4 duplicate entries. Set preserves insertion order in JS, so the
      // first (fully-populated) occurrence wins.
      const methods = Array.from(
        new Set(
          (a.adv.tradeMethods ?? [])
            .map((m) => m.identifier ?? m.tradeMethodName)
            .filter((s): s is string => typeof s === 'string' && s.length > 0),
        ),
      );
      return {
        advNo: a.adv.advNo,
        fiat: a.adv.fiatUnit,
        asset: a.adv.asset,
        tradeType: a.adv.tradeType,
        price: safeNum(a.adv.price),
        surplus_amount: safeNum(a.adv.surplusAmount),
        min_single_tx: safeNum(a.adv.minSingleTransAmount),
        max_single_tx: safeNum(a.adv.maxSingleTransAmount),
        payment_methods: methods,
        maker: {
          userNo: a.advertiser.userNo,
          nickname: a.advertiser.nickName ?? a.advertiser.userNo,
          month_orders: typeof a.advertiser.monthOrderCount === 'number' ? a.advertiser.monthOrderCount : null,
          finish_rate: typeof a.advertiser.monthFinishRate === 'number' ? a.advertiser.monthFinishRate : null,
        },
      };
    });

    // Stats computed from the slice we're returning, plus the absolute total reported by Binance.
    const total_offer_value = ads.reduce((acc, a) => acc + a.surplus_amount * a.price, 0);
    const unique_makers = new Set(ads.map((a) => a.maker.userNo)).size;

    return Response.json(
      {
        data: {
          stats: {
            fiat,
            asset,
            tradeType,
            n_ads: ads.length,
            n_makers: unique_makers,
            total_offer_value, // in fiat units; UI can fx-convert if it wants
            total_available: totalAvailable, // ads Binance has in the full book for these filters
          },
          ads,
          filters: { applied: { fiat, asset, tradeType, payTypes, limit } },
        },
      },
      {
        headers: {
          'cache-control': 's-maxage=20, stale-while-revalidate=60',
        },
      },
    );
  } catch (e) {
    return Response.json(
      { error: 'upstream_failed', detail: (e as Error).message },
      { status: 502 },
    );
  }
}
