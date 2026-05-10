// One-time backfill of historical standing-balance liquidity for zkp2p, computed
// from the Envio indexer's per-deposit DepositDailySnapshot table.
//
// Algorithm (per the investigation in `llm-full.json` doc + live schema check):
//  - Snapshots are sparse — written only on days a deposit has activity.
//  - For each deposit, build a step function from its snapshots: at any day D,
//    the deposit's balance is the most recent snapshot at or before D.
//  - For each historical day, sum (remainingDeposits - outstandingIntentAmount)
//    across all deposits. That's the "available liquidity" definition that
//    matches Peerlytics' `active_liquidity_usd` snapshot field.
//
// Run: npx tsx scripts/backfill-zkp2p-liquidity.ts
//
// Writes to data/charts/zkp2p_active_liquidity.json (overwrites — this is a
// canonical backfill; the snapshot cron will keep extending it forward).

import { writeFileSync, readFileSync } from 'node:fs';

const ENDPOINT = 'https://indexer.zkp2p.xyz/v1/graphql';
const USDC_DECIMALS = 6;
const DAY_SECS = 86_400;
const WINDOW_DAYS = 90;
const DEPOSIT_PAGE_SIZE = 500;
const SNAPSHOT_FETCH_FLOOR = '0'; // dayTimestamp >= 0 — fetches every snapshot

interface SnapRow {
  dayTimestamp: string; // unix seconds (utc-aligned)
  remainingDeposits: string; // USDC base units (1e6)
  outstandingIntentAmount: string; // USDC base units
}

interface DepositRow {
  id: string;
  timestamp: string; // unix seconds, deposit creation
  dailySnapshots: SnapRow[];
}

const QUERY_PAGE = `query Page($cursor: String!, $sinceDay: numeric!) {
  Deposit(
    where: { id: { _gt: $cursor } }
    order_by: { id: asc }
    limit: ${DEPOSIT_PAGE_SIZE}
  ) {
    id
    timestamp
    dailySnapshots(
      where: { dayTimestamp: { _gte: $sinceDay } }
      order_by: { dayTimestamp: asc }
    ) {
      dayTimestamp
      remainingDeposits
      outstandingIntentAmount
    }
  }
}`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) {
    throw new Error(`graphql ${resp.status}: ${await resp.text().catch(() => '')}`);
  }
  const json = (await resp.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data as T;
}

async function fetchAllDeposits(): Promise<DepositRow[]> {
  const all: DepositRow[] = [];
  let cursor = '';
  let page = 0;
  while (true) {
    page++;
    const data = await gql<{ Deposit: DepositRow[] }>(QUERY_PAGE, {
      cursor,
      sinceDay: SNAPSHOT_FETCH_FLOOR,
    });
    if (!data.Deposit.length) break;
    all.push(...data.Deposit);
    cursor = data.Deposit[data.Deposit.length - 1].id;
    process.stdout.write(`  page ${page}: +${data.Deposit.length} (total ${all.length})\n`);
    if (data.Deposit.length < DEPOSIT_PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, 120)); // 100ms throttle per doc
  }
  return all;
}

function balanceAt(d: DepositRow, dayTs: number): bigint {
  if (Number(d.timestamp) > dayTs + DAY_SECS) return 0n;
  let latest: SnapRow | null = null;
  for (const s of d.dailySnapshots) {
    const sd = Number(s.dayTimestamp);
    if (sd <= dayTs) latest = s;
    else break;
  }
  if (!latest) return 0n;
  const remaining = BigInt(latest.remainingDeposits);
  const outstanding = BigInt(latest.outstandingIntentAmount);
  const free = remaining - outstanding;
  return free > 0n ? free : 0n;
}

async function main() {
  console.log(`Fetching all deposits + their snapshots from ${ENDPOINT} …`);
  const deposits = await fetchAllDeposits();
  console.log(`Fetched ${deposits.length} deposits.`);

  const snapTotal = deposits.reduce((s, d) => s + d.dailySnapshots.length, 0);
  console.log(`Total snapshot rows: ${snapTotal} (avg ${(snapTotal / Math.max(1, deposits.length)).toFixed(1)} per deposit).`);

  const todayDay = Math.floor(Date.now() / 1000 / DAY_SECS) * DAY_SECS;
  const sinceDay = todayDay - WINDOW_DAYS * DAY_SECS;

  const days: Array<{ day: string; active_liquidity_usd: number; ts: number }> = [];
  for (let dayTs = sinceDay; dayTs <= todayDay; dayTs += DAY_SECS) {
    let totalRaw = 0n;
    for (const d of deposits) {
      totalRaw += balanceAt(d, dayTs);
    }
    const usd = Number(totalRaw) / 10 ** USDC_DECIMALS;
    const dayIso = new Date(dayTs * 1000).toISOString().slice(0, 10);
    days.push({ day: dayIso, active_liquidity_usd: usd, ts: dayTs * 1000 });
  }

  console.log('\nLast 7 days:');
  for (const d of days.slice(-7)) {
    console.log(`  ${d.day}: $${d.active_liquidity_usd.toFixed(0)}`);
  }
  console.log(`\nMin: $${Math.min(...days.map((d) => d.active_liquidity_usd)).toFixed(0)}`);
  console.log(`Max: $${Math.max(...days.map((d) => d.active_liquidity_usd)).toFixed(0)}`);

  // Sanity check: today's computed should be close to active_liquidity_usd in
  // the latest snapshot (Peerlytics).
  const todayUsd = days[days.length - 1].active_liquidity_usd;
  let snapshotActive: number | null = null;
  try {
    const snap = JSON.parse(readFileSync('data/snapshots/zkp2p.json', 'utf8')) as {
      liquidity: { value: { kind: string; tvl_usd?: number } };
    };
    if (snap.liquidity.value.kind === 'onchain_inventory') {
      snapshotActive = snap.liquidity.value.tvl_usd ?? null;
    }
  } catch {
    /* ignore */
  }
  console.log(`\n[sanity] today's computed: $${todayUsd.toFixed(0)}`);
  if (snapshotActive != null) {
    const diff = ((todayUsd - snapshotActive) / snapshotActive) * 100;
    console.log(`[sanity] snapshot active_liquidity_usd: $${snapshotActive.toFixed(0)} (diff ${diff.toFixed(1)}%)`);
    if (Math.abs(diff) > 10) {
      console.error(`[sanity] WARNING: diff > 10% — formula likely wrong`);
    } else {
      console.log(`[sanity] OK — within 10% of snapshot`);
    }
  } else {
    console.log(`[sanity] no snapshot available for comparison`);
  }

  const path = 'data/charts/zkp2p_active_liquidity.json';
  writeFileSync(path, JSON.stringify(days, null, 2));
  console.log(`\nWrote ${days.length} days to ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
