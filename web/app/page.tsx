import { loadAllProducts, loadHistory } from '@/lib/data';
import { fmtUsd, snapshotTvlUsd } from '@/lib/format';
import ProductsView from '@/components/products-view';
import type { ProductYaml } from '@/lib/types';

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

      <h2 className="section-title">Venues</h2>
      <ProductsView
        products={products}
        sparklines={sparklines}
        initialCategory={initialCategory}
      />
    </div>
  );
}
