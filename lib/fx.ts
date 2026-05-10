// Mid-market price oracle: returns price of `asset` denominated in `fiat`.
// Source: CoinGecko free tier (no key required, optional COINGECKO_KEY for demo tier).
// In-memory cache with 5 minute TTL — sufficient for a 30-min snapshot cadence.
//
// Future: layer Chainlink feed reads on Base via viem for USD pairs to gain
// onchain provenance. The zkp2p SDK exposes CHAINLINK_ORACLE_FEEDS / SPREAD_ORACLE_FEEDS
// we can reuse.

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const SYMBOL_TO_ID: Record<string, string> = {
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  ETH: 'ethereum',
  BTC: 'bitcoin',
  WETH: 'weth',
  WBTC: 'wrapped-bitcoin',
  SOL: 'solana',
  MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token',
  ARB: 'arbitrum',
  OP: 'optimism',
};

interface CacheEntry {
  price: number;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'PYUSD']);

export async function fxMid(asset: string, fiat: string, _ts: number): Promise<number> {
  const a = asset.toUpperCase();
  const f = fiat.toUpperCase();
  if (a === f) return 1;
  // Treat USD-pegged stables as 1 vs USD; cheap and accurate to ~5 bps
  if (STABLES.has(a) && f === 'USD') return 1;

  const key = `${a}/${f}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.price;

  const id = SYMBOL_TO_ID[a];
  if (!id) throw new Error(`fxMid: no CoinGecko id mapped for ${a}`);

  const url = `${COINGECKO_BASE}/simple/price?ids=${id}&vs_currencies=${f.toLowerCase()}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.COINGECKO_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_KEY;

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`fxMid: CoinGecko ${resp.status} for ${key}`);
  const data = (await resp.json()) as Record<string, Record<string, number>>;
  const price = data[id]?.[f.toLowerCase()];
  if (typeof price !== 'number') throw new Error(`fxMid: no price returned for ${key}`);

  cache.set(key, { price, ts: Date.now() });
  return price;
}
