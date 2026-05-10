import type { Provenance, Snapshot } from './types';

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function fmtBps(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(0)} bps`;
}

export function fmtPct(bps: number | null | undefined): string {
  if (bps == null) return '—';
  return `${(bps / 100).toFixed(2)}%`;
}

export function fmtRelTime(ts: number | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function provenanceColor(p: Provenance): string {
  if (p === 'onchain' || p === 'api') return 'var(--prov-good)';
  if (p === 'self_reported') return 'var(--prov-mid)';
  return 'var(--prov-low)';
}

export function provenanceLabel(p: Provenance): string {
  switch (p) {
    case 'onchain':
      return 'Onchain';
    case 'api':
      return 'API';
    case 'self_reported':
      return 'Self-reported';
    case 'manual':
      return 'Curator';
  }
}

export function rowProvenance(snap: Snapshot | undefined): Provenance {
  if (!snap) return 'manual';
  // Worst-case provenance across the snapshot's volatile fields.
  const order: Provenance[] = ['onchain', 'api', 'self_reported', 'manual'];
  const items: Provenance[] = [
    snap.liquidity.provenance,
    snap.volume_30d_usd.provenance,
    snap.observed_spread_bps.provenance,
    snap.fee_snapshot.provenance,
  ];
  return items.reduce((worst, p) => (order.indexOf(p) > order.indexOf(worst) ? p : worst), 'onchain' as Provenance);
}

export function snapshotTvlUsd(snap: Snapshot | undefined): number | null {
  if (!snap) return null;
  const v = snap.liquidity.value;
  if (v.kind === 'onchain_inventory') return v.tvl_usd;
  if (v.kind === 'p2p_offerbook') return v.top_pairs.reduce((a, b) => a + b.sum_offers_usd, 0);
  if (v.kind === 'ramp_capacity') {
    // sum max-single-tx across fiats; rough proxy
    return Object.values(v.fiat).reduce((a, b) => a + b.single_tx_max, 0);
  }
  if (v.kind === 'otc_minimum') return v.usd;
  return null;
}

export function bestFeePctOrBps(snap: Snapshot | undefined): { label: string } {
  if (!snap || !snap.fee_snapshot.sample_rows.length) return { label: '—' };
  const min = Math.min(...snap.fee_snapshot.sample_rows.map((r) => r.effective_rate_bps));
  return { label: `${(min / 100).toFixed(2)}%` };
}
