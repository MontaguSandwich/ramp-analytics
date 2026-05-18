import Link from 'next/link';
import { loadAllProducts, loadHistory } from '@/lib/data';
import { CATEGORY_LABEL, fmtUsd, snapshotTvlUsd } from '@/lib/format';
import ProductsView from '@/components/products-view';
import type { Product, ProductYaml } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SPARKLINE_DAYS = 14;
const VALID_CATEGORIES: ProductYaml['category'][] = ['onchain', 'cex_p2p', 'ramp', 'rtpn'];

/**
 * Overview tab — the dashboard's canonical landing. Follows the DefiLlama pattern:
 * the venues table IS the home view. Above it: short editorial intro and aggregate
 * stats. Below: the same sortable/filterable ProductsView used everywhere.
 *
 * Categories cards (on /categories) deep-link here via ?category=X to pre-select a
 * filter chip.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const products = await loadAllProducts();
  const histories = await Promise.all(
    products.map(async (p) => {
      const points = await loadHistory(p.yaml.id);
      const recent = points
        .filter((pt) => typeof pt.liquidity_available_usd === 'number')
        .slice(-SPARKLINE_DAYS)
        .map((pt) => pt.liquidity_available_usd!);
      return [p.yaml.id, recent] as const;
    }),
  );
  const sparklines = Object.fromEntries(histories);

  const params = await searchParams;
  const initialCategory =
    params.category && VALID_CATEGORIES.includes(params.category as ProductYaml['category'])
      ? (params.category as ProductYaml['category'])
      : undefined;

  // ---- Hero stats ----
  // Prefer live snapshot.coverage over YAML lists — coverage reflects fresh API
  // probing (e.g. binance has 89 active fiats vs the YAML's small sample).
  const totalProducts = products.length;
  const totalFiats = new Set(
    products.flatMap((p) => p.snapshot?.coverage?.value.fiats ?? p.yaml.fiats),
  ).size;
  const totalLiquidity = products.reduce(
    (sum, p) => sum + (snapshotTvlUsd(p.snapshot) ?? 0),
    0,
  );
  const totalMethods = new Set(
    products.flatMap(
      (p) => p.snapshot?.coverage?.value.platforms ?? p.yaml.payment_methods ?? [],
    ),
  ).size;
  const categoriesCovered = new Set(products.map((p) => p.yaml.category)).size;

  // Category breakdown for the strip — group products by category, sum liquidity per
  // bucket (where measurable). Includes the empty RTPN slot so users see the full
  // taxonomy without bouncing to /categories.
  const byCategory = new Map<ProductYaml['category'], Product[]>();
  for (const p of products) {
    const arr = byCategory.get(p.yaml.category) ?? [];
    arr.push(p);
    byCategory.set(p.yaml.category, arr);
  }
  const CATEGORY_ORDER: ProductYaml['category'][] = ['onchain', 'cex_p2p', 'ramp', 'rtpn'];

  return (
    <div className="container">
      <section className="hero-intro">
        <h1>On/off-ramp dashboard</h1>
        <p>
          Analytics dashboard focused on venues facilitating crypto ↔ fiat swaps. Covers
          informational data — supported fiats, live rates, KYC requirements — as well as
          trading-focused data like live orderbooks and available liquidity.
        </p>
      </section>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Venues covered</div>
          <div className="stat-value">{totalProducts}</div>
          <div className="stat-sub">across {categoriesCovered} categories</div>
        </div>
        <div className="stat">
          <div className="stat-label">Supported Fiat currencies across venues</div>
          <div className="stat-value">{totalFiats}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Combined liquidity</div>
          <div className="stat-value">{fmtUsd(totalLiquidity)}</div>
          <div className="stat-sub">where measurable</div>
        </div>
        <div className="stat">
          <div className="stat-label">Supported payment methods across venues</div>
          <div className="stat-value">{totalMethods}</div>
        </div>
      </div>

      <section className="section">
        <h2>By category</h2>
        <div className="category-strip">
          {CATEGORY_ORDER.map((c) => {
            const venues = byCategory.get(c) ?? [];
            const subTvl = venues.reduce(
              (sum, p) => sum + (snapshotTvlUsd(p.snapshot) ?? 0),
              0,
            );
            return (
              <Link key={c} href={`/?category=${c}`} className="category-strip-item">
                <span className={`tag cat-${c}`}>{CATEGORY_LABEL[c]}</span>
                <div className="mono">{venues.length}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {subTvl > 0 ? fmtUsd(subTvl) : '—'} liquidity
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <h2 className="section-title">Venues</h2>
      <ProductsView
        products={products}
        sparklines={sparklines}
        initialCategory={initialCategory}
      />
    </div>
  );
}
