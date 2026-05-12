// Mid-market price oracle: returns price of `asset` denominated in `fiat`.
// Source: CoinGecko free tier (no key required, optional COINGECKO_KEY for demo tier).
//
// Two-tier cache:
//   - In-memory Map (process-scoped): 5-minute "fresh" TTL
//   - Disk file at data/cache/fx.json: 24-hour "acceptable" TTL — survives across
//     snapshot script invocations. CoinGecko's free tier (~5-15 req/min) is too brittle
//     for a snapshot that needs ~20 fiat pairs in a single run; the disk cache reduces
//     us to one cold-start fetch per day.
//
// Future: layer Chainlink feed reads on Base via viem for USD pairs to gain
// onchain provenance. The zkp2p SDK exposes CHAINLINK_ORACLE_FEEDS / SPREAD_ORACLE_FEEDS
// we can reuse.

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const DISK_CACHE_PATH = join(process.cwd(), 'data/cache/fx.json');
const DISK_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'PYUSD']);

let diskLoadAttempted = false;

/** Load persisted rates from disk into the in-memory cache. Idempotent; safe to call often. */
async function loadDiskCache(): Promise<void> {
  if (diskLoadAttempted) return;
  diskLoadAttempted = true;
  try {
    const text = await fs.readFile(DISK_CACHE_PATH, 'utf8');
    const entries = JSON.parse(text) as Array<{ k: string; p: number; t: number }>;
    const now = Date.now();
    for (const e of entries) {
      if (now - e.t < DISK_TTL_MS) {
        cache.set(e.k, { price: e.p, ts: e.t });
      }
    }
  } catch {
    // file missing or corrupt — start with an empty cache
  }
}

/** Persist the current in-memory cache to disk. Best-effort; never throws. */
async function persistDiskCache(): Promise<void> {
  try {
    await fs.mkdir(dirname(DISK_CACHE_PATH), { recursive: true });
    const now = Date.now();
    const entries = [...cache.entries()]
      .filter(([, v]) => now - v.ts < DISK_TTL_MS)
      .map(([k, v]) => ({ k, p: v.price, t: v.ts }));
    await fs.writeFile(DISK_CACHE_PATH, JSON.stringify(entries));
  } catch {
    // best-effort
  }
}

export async function fxMid(asset: string, fiat: string, _ts: number): Promise<number> {
  const a = asset.toUpperCase();
  const f = fiat.toUpperCase();
  if (a === f) return 1;
  // Treat USD-pegged stables as 1 vs USD; cheap and accurate to ~5 bps
  if (STABLES.has(a) && f === 'USD') return 1;

  await loadDiskCache();

  const key = `${a}/${f}`;
  const cached = cache.get(key);
  // Accept disk-cached rates up to DISK_TTL_MS (24h) — short enough to track meaningful
  // FX moves, long enough to make CoinGecko's free-tier rate limit a non-issue.
  if (cached && Date.now() - cached.ts < DISK_TTL_MS) return cached.price;

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
  void persistDiskCache(); // best-effort, fire-and-forget
  return price;
}

/**
 * Batch fxMid for one asset against many fiats — single CoinGecko request via the
 * `vs_currencies` comma-list. Critical for callers that need rates for many fiats at
 * once (e.g. the binance_p2p live-rates probe): firing N parallel `fxMid` calls hits
 * CoinGecko's free-tier rate limit (~5–15 req/min) and most fail silently.
 *
 * Returns a Record keyed by uppercase fiat. Missing entries indicate fiats CoinGecko
 * doesn't have a price for (rare for major currencies, possible for some exotics).
 * Cache hits are returned without an HTTP call; misses populate the cache for
 * subsequent fxMid calls.
 */
export async function fxMidBatch(
  asset: string,
  fiats: string[],
  _ts: number,
): Promise<Record<string, number>> {
  await loadDiskCache();

  const a = asset.toUpperCase();
  const out: Record<string, number> = {};
  const needed: string[] = [];

  for (const fiat of fiats) {
    const f = fiat.toUpperCase();
    if (a === f) {
      out[f] = 1;
      continue;
    }
    if (STABLES.has(a) && f === 'USD') {
      out[f] = 1;
      continue;
    }
    const cached = cache.get(`${a}/${f}`);
    // 24h TTL — disk cache means we tolerate older rates rather than re-fetching.
    if (cached && Date.now() - cached.ts < DISK_TTL_MS) {
      out[f] = cached.price;
      continue;
    }
    needed.push(f);
  }

  if (needed.length === 0) return out;

  const id = SYMBOL_TO_ID[a];
  if (!id) {
    // No CoinGecko mapping for this asset — return whatever short-circuited entries we have.
    return out;
  }

  const vs = needed.map((f) => f.toLowerCase()).join(',');
  const url = `${COINGECKO_BASE}/simple/price?ids=${id}&vs_currencies=${vs}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.COINGECKO_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_KEY;

  // Never throw — fxMidBatch is best-effort. On HTTP failure (429 rate-limit, network
  // hiccup, etc.) we return the entries we already have (short-circuits + cache hits).
  // Callers can decide whether a partial result is usable; the binance_p2p adapter
  // simply omits markets without a mid.
  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return out;
    const data = (await resp.json()) as Record<string, Record<string, number>>;
    const prices = data[id] ?? {};

    for (const f of needed) {
      const price = prices[f.toLowerCase()];
      if (typeof price !== 'number') continue; // CoinGecko has no rate for this fiat
      out[f] = price;
      cache.set(`${a}/${f}`, { price, ts: Date.now() });
    }
    void persistDiskCache(); // best-effort, fire-and-forget
  } catch {
    // network error — return partial
  }

  return out;
}
