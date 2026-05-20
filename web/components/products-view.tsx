'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import type { Product } from '@/lib/types';
import { fmtPct, fmtUsd, snapshotTvlUsd } from '@/lib/format';
import Sparkline from './sparkline';
import { FiatChip, PaymentChip } from './chips';

const CATEGORY_LABEL: Record<string, string> = {
  onchain: 'Onchain P2P',
  cex_p2p: 'CEX P2P',
  ramp: 'Licensed Ramps',
  rtpn: 'RTPNs',
};

type Category = Product['yaml']['category'];
type Custody = Product['yaml']['delivery_custody'];
type KycMax = 'any' | 'none' | 'email' | 'id' | 'id+poa';
// 'all' is still the resting state (no chip active). The Direction filter renders only
// the On-ramp / Off-ramp chips now — clicking an active chip toggles back to 'all'.
type DirectionMode = 'all' | 'on' | 'off';
// Which detail column (if any) is expanded under a given row. A row shows at most one
// expansion <tr> at a time; clicking the other column's count switches which is open.
type ExpandKind = 'fiats' | 'methods';

const KYC_ORDER = ['none', 'email', 'id', 'id+poa', 'enhanced'] as const;

function piiOrd(p: string | undefined): number {
  return p ? KYC_ORDER.indexOf(p as (typeof KYC_ORDER)[number]) : KYC_ORDER.length;
}

interface Filters {
  categories: Set<Category>;
  custodies: Set<Custody>;
  direction: DirectionMode;
  kycMax: KycMax;
  fiat: string;
}

const EMPTY_FILTERS: Filters = {
  categories: new Set(),
  custodies: new Set(),
  direction: 'all',
  kycMax: 'any',
  fiat: 'any',
};

function applyFilters(products: Product[], f: Filters): Product[] {
  return products.filter((p) => {
    if (f.categories.size && !f.categories.has(p.yaml.category)) return false;
    if (f.custodies.size && !f.custodies.has(p.yaml.delivery_custody)) return false;
    if (f.direction !== 'all') {
      const d = p.yaml.direction;
      if (d !== 'both' && d !== f.direction) return false;
    }
    if (f.kycMax !== 'any') {
      if (f.kycMax === 'none') {
        if (!p.yaml.non_kyc_available) return false;
      } else {
        const cap = KYC_ORDER.indexOf(f.kycMax);
        if (piiOrd(p.yaml.pii_floor) > cap) return false;
      }
    }
    if (f.fiat !== 'any') {
      if (!p.yaml.fiats.includes(f.fiat)) return false;
    }
    return true;
  });
}

function isFiltersActive(f: Filters): boolean {
  return (
    f.categories.size > 0 ||
    f.custodies.size > 0 ||
    f.direction !== 'all' ||
    f.kycMax !== 'any' ||
    f.fiat !== 'any'
  );
}

export default function ProductsView({
  products,
  sparklines = {},
  initialCategory,
}: {
  products: Product[];
  sparklines?: Record<string, number[]>;
  /** When provided (e.g. arriving from /categories with ?category=X), pre-select that
   *  category chip so the table opens already filtered. */
  initialCategory?: Category;
}) {
  const [filters, setFilters] = useState<Filters>(() =>
    initialCategory
      ? { ...EMPTY_FILTERS, categories: new Set([initialCategory]) }
      : EMPTY_FILTERS,
  );
  // id → which column is expanded for that row. Absent = collapsed. Clicking a count
  // either opens its kind, switches from the other kind, or closes if already open.
  const [expanded, setExpanded] = useState<Map<string, ExpandKind>>(new Map());
  const toggleExpanded = (id: string, kind: ExpandKind) =>
    setExpanded((cur) => {
      const next = new Map(cur);
      if (next.get(id) === kind) next.delete(id);
      else next.set(id, kind);
      return next;
    });

  const allFiats = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.yaml.fiats.forEach((f) => set.add(f)));
    return [...set].sort();
  }, [products]);

  const filtered = useMemo(() => applyFilters(products, filters), [products, filters]);

  const toggleSet = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <>
      <div className="filters">
        <ChipGroup label="Category">
          {(['onchain', 'cex_p2p', 'ramp', 'rtpn'] as Category[]).map((c) => (
            <Chip
              key={c}
              active={filters.categories.has(c)}
              onClick={() => setFilters({ ...filters, categories: toggleSet(filters.categories, c) })}
            >
              {CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="Direction">
          {(['on', 'off'] as const).map((d) => (
            <Chip
              key={d}
              active={filters.direction === d}
              // No "All" chip — clicking the active direction toggles back to the
              // resting 'all' state, which shows every venue.
              onClick={() =>
                setFilters({ ...filters, direction: filters.direction === d ? 'all' : d })
              }
            >
              {d === 'on' ? 'On-ramp' : 'Off-ramp'}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="Custody">
          {(['self', 'hosted'] as Custody[]).map((c) => (
            <Chip
              key={c}
              active={filters.custodies.has(c)}
              onClick={() => setFilters({ ...filters, custodies: toggleSet(filters.custodies, c) })}
            >
              {c}
            </Chip>
          ))}
        </ChipGroup>

        <div className="filter-select-group">
          <label className="filter-label">KYC requirements</label>
          <select
            className="filter-select"
            value={filters.kycMax}
            onChange={(e) => setFilters({ ...filters, kycMax: e.target.value as KycMax })}
          >
            <option value="any">Any</option>
            <option value="none">No-KYC available</option>
            <option value="email">≤ email</option>
            <option value="id">≤ ID</option>
            <option value="id+poa">≤ ID + POA</option>
          </select>
        </div>

        <div className="filter-select-group">
          <label className="filter-label">Fiat</label>
          <select
            className="filter-select"
            value={filters.fiat}
            onChange={(e) => setFilters({ ...filters, fiat: e.target.value })}
          >
            <option value="any">Any</option>
            {allFiats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-spacer" />

        <div className="filter-summary">
          <span className="muted">
            {filtered.length} / {products.length}
          </span>
          {isFiltersActive(filters) ? (
            <button className="clear-btn" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="no-results">
          No products match the current filters.{' '}
          <button className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Venues</th>
                <th>Category</th>
                <th>Direction</th>
                <th># Fiats</th>
                <th># Methods</th>
                <th>KYC floor</th>
                <th>Custody</th>
                <th>Spread (~$1k)*</th>
                <th>30d volume</th>
                <th>Available liquidity</th>
                <th>Liquidity: 14d trend</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const tvl = snapshotTvlUsd(p.snapshot);
                // For ramp-style venues the "Available liquidity" figure is actually the
                // max single trade the venue will process (see snapshotTvlUsd) — not pooled
                // depth like the order-book venues. Flag it so the two aren't conflated.
                const liqIsCapacity = p.snapshot?.liquidity.value.kind === 'ramp_capacity';
                // Active fiats / methods prefer snapshot.coverage (live, fresh from API)
                // over the YAML lists (curated, may lag). Coverage carries the optional
                // fiat_flags map for non-programmatic flag overrides (e.g. zkp2p sources
                // from Peerlytics meta/currencies).
                const cov = p.snapshot?.coverage?.value;
                const fiatList = cov?.fiats?.length ? cov.fiats : p.yaml.fiats;
                const methodList = cov?.platforms?.length
                  ? cov.platforms
                  : p.yaml.payment_methods ?? [];
                const flags = cov?.fiat_flags;
                const openKind = expanded.get(p.yaml.id);
                const fiatsOpen = openKind === 'fiats';
                const methodsOpen = openKind === 'methods';
                const showOn = p.yaml.direction === 'on' || p.yaml.direction === 'both';
                const showOff = p.yaml.direction === 'off' || p.yaml.direction === 'both';
                return (
                  // Fragment key must live on Fragment itself (the shorthand `<>` can't
                  // take a key prop) — each map iteration produces a main <tr> plus an
                  // optional expansion <tr>, so we need the outer Fragment to carry it.
                  <Fragment key={p.yaml.id}>
                    <tr>
                      <td>
                        <Link href={`/products/${p.yaml.id}`} className="pname">
                          <span className="pname-name">{p.yaml.display_name ?? p.yaml.name}</span>
                        </Link>
                      </td>
                      <td>
                        <span className={`tag cat-${p.yaml.category}`}>{CATEGORY_LABEL[p.yaml.category]}</span>
                      </td>
                      <td>
                        <div className="direction-pills">
                          {showOn ? <span className="tag tag-onramp">Onramp</span> : null}
                          {showOff ? <span className="tag tag-offramp">Offramp</span> : null}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="fiats-count-btn"
                          onClick={() => toggleExpanded(p.yaml.id, 'fiats')}
                          aria-expanded={fiatsOpen}
                          aria-label={`${fiatList.length} fiats — ${fiatsOpen ? 'hide' : 'show'} flags`}
                          disabled={fiatList.length === 0}
                        >
                          <span className="mono">{fiatList.length}</span>
                          {fiatList.length > 0 ? (
                            <span className="fiats-count-caret" aria-hidden>
                              {fiatsOpen ? '▾' : '▸'}
                            </span>
                          ) : null}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="fiats-count-btn"
                          onClick={() => toggleExpanded(p.yaml.id, 'methods')}
                          aria-expanded={methodsOpen}
                          aria-label={`${methodList.length} payment methods — ${methodsOpen ? 'hide' : 'show'} list`}
                          disabled={methodList.length === 0}
                        >
                          <span className="mono">{methodList.length}</span>
                          {methodList.length > 0 ? (
                            <span className="fiats-count-caret" aria-hidden>
                              {methodsOpen ? '▾' : '▸'}
                            </span>
                          ) : null}
                        </button>
                      </td>
                      <td className="muted">{p.yaml.pii_floor ?? '—'}</td>
                      <td className="muted">{p.yaml.delivery_custody}</td>
                      <td className="mono">{fmtPct(p.snapshot?.observed_spread_bps.value)}</td>
                      <td className="mono">{fmtUsd(p.snapshot?.volume_30d_usd.value ?? null)}</td>
                      <td className="mono">
                        {fmtUsd(tvl)}
                        {liqIsCapacity ? (
                          <sup
                            style={{ cursor: 'help', marginLeft: 1 }}
                            title="Max single trade the venue will process — not aggregate locked liquidity"
                          >
                            †
                          </sup>
                        ) : null}
                      </td>
                      <td>
                        <Sparkline
                          values={sparklines[p.yaml.id] ?? []}
                          ariaLabel={`${p.yaml.name} 14-day liquidity trend`}
                        />
                      </td>
                    </tr>
                    {fiatsOpen ? (
                      <tr className="fiats-expand-row">
                        <td colSpan={11}>
                          <div className="fiats-expand-content">
                            <span className="muted" style={{ fontSize: 11, marginRight: 8 }}>
                              All {fiatList.length} fiat{fiatList.length === 1 ? '' : 's'}:
                            </span>
                            <div className="fiat-grid">
                              {fiatList.map((f) => (
                                <FiatChip key={f} code={f} flag={flags?.[f]} />
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {methodsOpen ? (
                      <tr className="fiats-expand-row">
                        <td colSpan={11}>
                          <div className="fiats-expand-content">
                            <span className="muted" style={{ fontSize: 11, marginRight: 8 }}>
                              All {methodList.length} payment method{methodList.length === 1 ? '' : 's'}:
                            </span>
                            <div className="fiat-grid">
                              {methodList.map((m) => (
                                <PaymentChip key={m} name={m} />
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ color: 'var(--fg-mute)', fontSize: 12, margin: '12px 4px' }}>
        <div>
          * effective spread on a ~$1,000 trade in the venue&apos;s deepest USD market, measured against the
          oracle/FX mid. Methodology varies by venue type — click a row to see the live sample table.
        </div>
        <div style={{ marginTop: 4 }}>
          † for Licensed Ramps, this is the largest single transaction the venue will process (max single
          trade), not aggregate locked liquidity — ramps quote against their own capacity, not a pooled order book.
        </div>
      </div>
    </>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="chip-group">
      <span className="filter-label">{label}</span>
      <div className="chip-group-inner">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`chip${active ? ' chip-active' : ''}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}
