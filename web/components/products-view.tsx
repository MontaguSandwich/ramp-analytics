'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import type { Product } from '@/lib/types';
import {
  bestFeePctOrBps,
  fmtRelTime,
  fmtUsd,
  provenanceColor,
  provenanceLabel,
  rowProvenance,
  snapshotTvlUsd,
} from '@/lib/format';
import Sparkline from './sparkline';
import { FiatChip } from './chips';

const CATEGORY_LABEL: Record<string, string> = {
  onchain: 'Onchain P2P',
  cex_p2p: 'CEX P2P',
  ramp: 'Ramps',
  rtpn: 'RTPNs',
};

type Category = Product['yaml']['category'];
type Custody = Product['yaml']['delivery_custody'];
type KycMax = 'any' | 'none' | 'email' | 'id' | 'id+poa';
type DirectionMode = 'all' | 'on' | 'off';

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
  openSourceOnly: boolean;
}

const EMPTY_FILTERS: Filters = {
  categories: new Set(),
  custodies: new Set(),
  direction: 'all',
  kycMax: 'any',
  fiat: 'any',
  openSourceOnly: false,
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
    if (f.openSourceOnly && !p.yaml.open_source?.is_open) return false;
    return true;
  });
}

function isFiltersActive(f: Filters): boolean {
  return (
    f.categories.size > 0 ||
    f.custodies.size > 0 ||
    f.direction !== 'all' ||
    f.kycMax !== 'any' ||
    f.fiat !== 'any' ||
    f.openSourceOnly
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
          {(['all', 'on', 'off'] as DirectionMode[]).map((d) => (
            <Chip
              key={d}
              active={filters.direction === d}
              onClick={() => setFilters({ ...filters, direction: d })}
            >
              {d === 'all' ? 'All' : d === 'on' ? 'On-ramp' : 'Off-ramp'}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="Custody">
          {(['self', 'hosted', 'either'] as Custody[]).map((c) => (
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
          <label className="filter-label">KYC tolerance</label>
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

        <Chip
          active={filters.openSourceOnly}
          onClick={() => setFilters({ ...filters, openSourceOnly: !filters.openSourceOnly })}
        >
          Open source only
        </Chip>

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
                <th>Name</th>
                <th>Category</th>
                <th>Direction</th>
                <th># Fiats</th>
                <th>KYC floor</th>
                <th>Custody</th>
                <th>Best fee*</th>
                <th>30d volume</th>
                <th>Liquidity / TVL</th>
                <th>14d trend</th>
                <th>Data freshness</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const prov = rowProvenance(p.snapshot);
                const tvl = snapshotTvlUsd(p.snapshot);
                const fees = bestFeePctOrBps(p.snapshot);
                // Active fiats prefer snapshot.coverage (live, fresh from API) over the
                // YAML list (curated, may lag). Coverage carries the optional fiat_flags
                // map for non-programmatic flag overrides (e.g. zkp2p sources from
                // Peerlytics meta/currencies).
                const cov = p.snapshot?.coverage?.value;
                const fiatList = cov?.fiats?.length ? cov.fiats : p.yaml.fiats;
                const flags = cov?.fiat_flags;
                const isOpen = expanded.has(p.yaml.id);
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
                          {p.yaml.subcategory ? <span className="pname-sub">{p.yaml.subcategory}</span> : null}
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
                          onClick={() => toggleExpanded(p.yaml.id)}
                          aria-expanded={isOpen}
                          aria-label={`${fiatList.length} fiats — ${isOpen ? 'hide' : 'show'} flags`}
                          disabled={fiatList.length === 0}
                        >
                          <span className="mono">{fiatList.length}</span>
                          {fiatList.length > 0 ? (
                            <span className="fiats-count-caret" aria-hidden>
                              {isOpen ? '▾' : '▸'}
                            </span>
                          ) : null}
                        </button>
                      </td>
                      <td className="muted">{p.yaml.pii_floor ?? '—'}</td>
                      <td className="muted">{p.yaml.delivery_custody}</td>
                      <td className="mono">{fees.label}</td>
                      <td className="mono">{fmtUsd(p.snapshot?.volume_30d_usd.value ?? null)}</td>
                      <td className="mono">{fmtUsd(tvl)}</td>
                      <td>
                        <Sparkline
                          values={sparklines[p.yaml.id] ?? []}
                          ariaLabel={`${p.yaml.name} 14-day liquidity trend`}
                        />
                      </td>
                      <td>
                        <span
                          className="dot"
                          style={{ background: provenanceColor(prov) }}
                          title={`${provenanceLabel(prov)} · ${fmtRelTime(p.snapshot?.liquidity.last_verified)}`}
                        />{' '}
                        <span className="muted" style={{ fontSize: 11 }}>
                          {fmtRelTime(p.snapshot?.liquidity.last_verified)}
                        </span>
                      </td>
                    </tr>
                    {isOpen ? (
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
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ color: 'var(--fg-mute)', fontSize: 12, margin: '12px 4px' }}>
        * representative fee from the cheapest sample row in the latest snapshot. Real per-tx fee depends on payment
        method, fiat, asset, and amount — click a row to see the live sample table.
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
