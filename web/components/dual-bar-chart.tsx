import type { ReactNode } from 'react';
import { fmtUsd } from '@/lib/format';

/**
 * Per-row dual horizontal-bar chart — used for the "Onramp vs Offramp depth" view
 * on Binance P2P (and any other bidirectional venue with split depth data).
 *
 * Bar widths are normalized to the SHARED max across both directions and all visible
 * rows, so cross-direction asymmetry is visually obvious ("USD is huge buy, tiny sell;
 * CNY is balanced"). Onramp = green, offramp = amber — matches the Direction pills in
 * Venue Properties.
 *
 * Caller supplies `renderLabel` so the chart stays presentation-only (no chip imports).
 */
export interface DualBarItem {
  key: string;
  label: string;
  buy_amount_usd: number;
  sell_amount_usd: number;
}

export default function DualBarChart({
  title,
  items,
  renderLabel,
  maxRows = 10,
  buyLabel = 'Onramp',
  sellLabel = 'Offramp',
  buyTitle,
  sellTitle,
}: {
  title: string;
  items: DualBarItem[];
  renderLabel?: (item: DualBarItem) => ReactNode;
  maxRows?: number;
  /** Legend text per series. Defaults suit escrowed-vs-escrowed comparisons. */
  buyLabel?: string;
  sellLabel?: string;
  /** Hover definitions for each series — use when the two sides aren't like-for-like. */
  buyTitle?: string;
  sellTitle?: string;
}) {
  const top = items.slice(0, maxRows);
  const maxValue = Math.max(
    ...top.flatMap((it) => [it.buy_amount_usd, it.sell_amount_usd]),
    1,
  );

  return (
    <div className="mix-card">
      <div className="mix-title">
        {title}
        <span className="dual-legend">
          <span className="dual-legend-swatch dual-legend-swatch-buy" />
          <span title={buyTitle} className={buyTitle ? 'tip' : undefined}>{buyLabel}</span>
          <span className="dual-legend-swatch dual-legend-swatch-sell" />
          <span title={sellTitle} className={sellTitle ? 'tip' : undefined}>{sellLabel}</span>
        </span>
      </div>
      <div className="mix-rows">
        {top.map((it) => (
          <div className="dual-row" key={it.key}>
            <div className="dual-row-label">{renderLabel ? renderLabel(it) : it.label}</div>
            <div className="dual-row-bars">
              <div className="dual-bar-track">
                <div
                  className="dual-bar-fill dual-bar-fill-buy"
                  style={{ width: `${Math.max(0.5, (it.buy_amount_usd / maxValue) * 100).toFixed(2)}%` }}
                />
                <span className="dual-bar-amount mono">{fmtUsd(it.buy_amount_usd)}</span>
              </div>
              <div className="dual-bar-track">
                <div
                  className="dual-bar-fill dual-bar-fill-sell"
                  style={{ width: `${Math.max(0.5, (it.sell_amount_usd / maxValue) * 100).toFixed(2)}%` }}
                />
                <span className="dual-bar-amount mono">{fmtUsd(it.sell_amount_usd)}</span>
              </div>
            </div>
          </div>
        ))}
        {items.length > top.length ? (
          <div className="mix-row mix-row-more">
            <div className="mix-label muted">+{items.length - top.length} more</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
