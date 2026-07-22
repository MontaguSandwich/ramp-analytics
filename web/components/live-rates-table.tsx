'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Market, Snapshot } from '@/lib/types';
import { fmtRelTime, provenanceColor, provenanceLabel } from '@/lib/format';
import { FiatChip } from './chips';

/**
 * Kind-aware live rates table with onramp/offramp toggle.
 *
 * Layout adapts to the venue type (p2p_offerbook vs ramp_capacity): different column set,
 * subtitle, and footer copy. Toggle renders only when the snapshot contains markets in
 * BOTH directions; otherwise the table just shows whatever it has.
 *
 * KPI strip in GenericDetail stays onramp-anchored regardless of the toggle — the toggle
 * is a drilldown affordance, not a stateful page-wide switch.
 */
export default function LiveRatesTable({
  markets,
  snapshot,
  productId,
}: {
  markets: Market[];
  snapshot: Snapshot;
  productId: string;
}) {
  const provenance = snapshot.markets!.provenance;
  const lastVerified = snapshot.markets!.last_verified;
  const kind = snapshot.liquidity.value.kind;
  const hasOrderbookTab = snapshot.capabilities?.orderbook === true;

  const isP2p = kind === 'p2p_offerbook';
  const isRamp = kind === 'ramp_capacity';

  const { hasBuy, hasSell } = useMemo(() => {
    let hasBuy = false;
    let hasSell = false;
    for (const m of markets) {
      if (m.direction === 'buy') hasBuy = true;
      else if (m.direction === 'sell') hasSell = true;
      else hasBuy = true; // legacy rows without direction = treat as buy
    }
    return { hasBuy, hasSell };
  }, [markets]);
  const showToggle = hasBuy && hasSell;

  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');

  const filtered = useMemo(() => {
    if (!showToggle) return [...markets].sort((a, b) => a.spread_bps - b.spread_bps);
    const subset = markets.filter((m) => {
      if (direction === 'buy') return m.direction === 'buy' || m.direction == null;
      return m.direction === 'sell';
    });
    return subset.sort((a, b) => a.spread_bps - b.spread_bps);
  }, [markets, direction, showToggle]);

  // Per-kind labels. Subtitle gets a direction qualifier when the toggle is visible.
  const asset = isRamp ? 'USDC' : 'USDT';
  const dirSubtitle = showToggle ? (direction === 'buy' ? 'onramp' : 'offramp') : null;
  const baseSubtitle = isP2p
    ? `top ${filtered.length} deepest ${asset} markets`
    : isRamp
      ? `${filtered.length} fiats · ${asset} reference`
      : `${filtered.length} markets`;
  const subtitle = dirSubtitle ? `${baseSubtitle} · ${dirSubtitle}` : baseSubtitle;
  const liquidityLabel = isP2p ? 'Liquidity (top 100)' : 'Max trade';
  const footerText = isP2p
    ? 'One row per currency · ranked top-10 by USD offer value · sorted by best spread.'
    : isRamp
      ? 'One row per fiat · best (cheapest) payment method per fiat · sorted by spread. Rates approximated from Ramp reference price + hand-maintained fee table — NOT user-quoted.'
      : 'Sorted by best spread.';

  return (
    <section className="section">
      <h2>
        Live rates{' '}
        <span className="h2-sub">
          · {subtitle}
        </span>{' '}
        <span
          className="dot"
          style={{ background: provenanceColor(provenance) }}
          title={`${provenanceLabel(provenance)} · ${fmtRelTime(lastVerified)}`}
        />
        {showToggle ? (
          <span className="direction-toggle" role="group" aria-label="Direction">
            <button
              type="button"
              className={`direction-toggle-btn${direction === 'buy' ? ' is-active' : ''}`}
              onClick={() => setDirection('buy')}
              aria-pressed={direction === 'buy'}
            >
              Onramp
            </button>
            <button
              type="button"
              className={`direction-toggle-btn${direction === 'sell' ? ' is-active' : ''}`}
              onClick={() => setDirection('sell')}
              aria-pressed={direction === 'sell'}
            >
              Offramp
            </button>
          </span>
        ) : null}
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Currency</th>
              {isRamp ? <th>Method</th> : null}
              <th className="col-num">Best rate</th>
              <th className="col-num">Spread</th>
              <th className="col-num">{liquidityLabel}</th>
              {isP2p ? <th className="col-num">Ads</th> : null}
              {isP2p ? <th className="col-num">Makers</th> : null}
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={`${m.currency}-${m.direction ?? 'buy'}`}>
                <td>
                  <FiatChip code={m.currency} />
                </td>
                {isRamp ? <td className="mono">{m.platform}</td> : null}
                <td className="col-num mono">{m.best_rate.toFixed(4)}</td>
                <td
                  className="col-num mono spread-val"
                  style={{ '--spread-color': spreadColor(m.spread_bps) } as React.CSSProperties}
                >
                  {fmtSpreadPct(m.spread_bps)}
                </td>
                <td className="col-num mono">{fmtUsdShort(m.total_liquidity_usd)}</td>
                {isP2p ? <td className="col-num mono">{m.deposit_count.toLocaleString()}</td> : null}
                {isP2p ? (
                  <td className="col-num mono">{m.n_makers ?? <span className="na">—</span>}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        {footerText}
        {hasOrderbookTab ? (
          <Link
            href={`/products/${productId}/orderbook`}
            className="cta-link cta-link-sm table-footer-cta"
          >
            Open orderbook →
          </Link>
        ) : null}
      </div>
    </section>
  );
}

const SPREAD_NEUTRAL_BPS = 25;

function spreadColor(bps: number): string {
  if (bps < -SPREAD_NEUTRAL_BPS) return 'var(--prov-good)';
  if (bps > SPREAD_NEUTRAL_BPS) return 'var(--warn)';
  return 'var(--fg-mute)';
}

function fmtSpreadPct(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  const pct = bps / 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
