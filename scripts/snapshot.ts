import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from '../adapters/index.ts';
import type { Snapshot } from '../lib/types.ts';

const OUT_DIR = 'data/snapshots';
const CHARTS_DIR = 'data/charts';
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CHARTS_DIR, { recursive: true });

interface LiquidityLogEntry {
  day: string; // YYYY-MM-DD UTC
  active_liquidity_usd: number;
  ts: number; // unix ms of the latest reading on that day
}

function appendLiquidityLog(id: string, snap: Snapshot): void {
  const liq = snap.liquidity;
  if (liq.value.kind !== 'onchain_inventory' && liq.value.kind !== 'p2p_offerbook') return;

  const usd =
    liq.value.kind === 'onchain_inventory'
      ? liq.value.tvl_usd
      : liq.value.kind === 'p2p_offerbook'
        ? liq.value.top_pairs.reduce((s, p) => s + p.sum_offers_usd, 0)
        : null;
  if (usd == null) return;

  const ts = liq.last_verified;
  const day = new Date(ts).toISOString().slice(0, 10);
  const path = join(CHARTS_DIR, `${id}_active_liquidity.json`);

  let log: LiquidityLogEntry[] = [];
  try {
    log = JSON.parse(readFileSync(path, 'utf8')) as LiquidityLogEntry[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  const filtered = log.filter((p) => p.day !== day);
  filtered.push({ day, active_liquidity_usd: usd, ts });
  filtered.sort((a, b) => a.day.localeCompare(b.day));
  writeFileSync(path, JSON.stringify(filtered, null, 2));
}

let failed = 0;
for (const adapter of adapters) {
  try {
    const snap = await adapter.snapshot();
    writeFileSync(join(OUT_DIR, `${adapter.id}.json`), JSON.stringify(snap, null, 2));
    appendLiquidityLog(adapter.id, snap);
    console.log(`OK  ${adapter.id}`);
  } catch (e) {
    failed++;
    console.error(`ERR ${adapter.id}: ${(e as Error).message}`);
  }
}

if (failed) process.exit(1);
