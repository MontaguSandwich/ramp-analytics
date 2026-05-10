import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Product, ProductYaml, Snapshot } from './types';

const DATA_ROOT = path.join(process.cwd(), '..', 'data');

async function readYaml<T>(filePath: string): Promise<T> {
  const txt = await fs.readFile(filePath, 'utf8');
  return parseYaml(txt) as T;
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    return JSON.parse(txt) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function listProductIds(): Promise<string[]> {
  const dir = path.join(DATA_ROOT, 'products');
  const entries = await fs.readdir(dir);
  return entries
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort();
}

export async function loadProduct(id: string): Promise<Product> {
  const yaml = await readYaml<ProductYaml>(path.join(DATA_ROOT, 'products', `${id}.yaml`));
  const snapshot = await readJsonOrNull<Snapshot>(path.join(DATA_ROOT, 'snapshots', `${id}.json`));
  return { yaml, snapshot: snapshot ?? undefined };
}

export async function loadAllProducts(): Promise<Product[]> {
  const ids = await listProductIds();
  return Promise.all(ids.map((id) => loadProduct(id)));
}

export interface DailyPoint {
  day: string;
  volume_usd: number;
  median_spread_bps: number;
  n_trades: number;
  liquidity_available_usd?: number;
}

interface LiquidityLogEntry {
  day: string;
  active_liquidity_usd: number;
  ts: number;
}

export async function loadHistory(id: string): Promise<DailyPoint[]> {
  const main =
    (await readJsonOrNull<DailyPoint[]>(path.join(DATA_ROOT, 'charts', `${id}.json`))) ?? [];
  const liqLog =
    (await readJsonOrNull<LiquidityLogEntry[]>(
      path.join(DATA_ROOT, 'charts', `${id}_active_liquidity.json`),
    )) ?? [];
  const liqByDay = new Map(liqLog.map((p) => [p.day, p.active_liquidity_usd]));

  const byDay = new Map<string, DailyPoint>();
  for (const p of main) byDay.set(p.day, { ...p });
  for (const p of liqLog) {
    const cur = byDay.get(p.day);
    if (cur) cur.liquidity_available_usd = p.active_liquidity_usd;
    else
      byDay.set(p.day, {
        day: p.day,
        volume_usd: 0,
        median_spread_bps: 0,
        n_trades: 0,
        liquidity_available_usd: p.active_liquidity_usd,
      });
  }
  // Ensure liquidity is attached for any day in main that has a log entry.
  for (const p of byDay.values()) {
    if (p.liquidity_available_usd == null) {
      const v = liqByDay.get(p.day);
      if (v != null) p.liquidity_available_usd = v;
    }
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
