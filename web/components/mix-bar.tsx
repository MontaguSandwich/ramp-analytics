import type { ReactNode } from 'react';
import { fmtUsd } from '@/lib/format';

/**
 * Shared "Market mix" horizontal-bar widget. One row per item: label, fill bar, share %,
 * USD-equivalent number. Used by both zkp2p's historical composition (volume) and
 * binance's current depth breakdown (liquidity). The field is intentionally named
 * `amount_usd` rather than `volume_usd` so callers can pass either semantic.
 *
 * `renderLabel` lets the caller decide how to render each row's left column (FiatChip,
 * PaymentChip, plain text, etc.) without coupling MixBar to chip code.
 */
export interface MixItem {
  key: string;
  label: string;
  amount_usd: number;
  share_pct: number;
}

export default function MixBar({
  title,
  items,
  renderLabel,
  maxRows = 8,
}: {
  title: string;
  items: MixItem[];
  renderLabel?: (item: MixItem) => ReactNode;
  maxRows?: number;
}) {
  // Dedupe by lowercase label (Peerlytics returns multiple zelle payment-method hashes
  // pointing at the same human label; we sum them so the user sees a single Zelle row).
  const merged = new Map<string, MixItem>();
  for (const it of items) {
    const key = it.label.toLowerCase();
    const cur = merged.get(key);
    if (cur) {
      cur.amount_usd += it.amount_usd;
      cur.share_pct += it.share_pct;
    } else {
      merged.set(key, { ...it });
    }
  }
  const sorted = [...merged.values()].sort((a, b) => b.amount_usd - a.amount_usd);
  const top = sorted.slice(0, maxRows);

  return (
    <div className="mix-card">
      <div className="mix-title">{title}</div>
      <div className="mix-rows">
        {top.map((it) => (
          <div className="mix-row" key={it.key}>
            <div className="mix-label">{renderLabel ? renderLabel(it) : it.label}</div>
            <div className="mix-bar-wrap">
              <div
                className="mix-bar"
                style={{ width: `${Math.min(100, it.share_pct).toFixed(2)}%` }}
              />
            </div>
            <div className="mix-pct mono">{it.share_pct.toFixed(1)}%</div>
            <div className="mix-vol mono muted">{fmtUsd(it.amount_usd)}</div>
          </div>
        ))}
        {sorted.length > top.length ? (
          <div className="mix-row mix-row-more">
            <div className="mix-label muted">+{sorted.length - top.length} more</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
