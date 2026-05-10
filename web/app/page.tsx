import { loadAllProducts, loadHistory } from '@/lib/data';
import { fmtUsd, snapshotTvlUsd } from '@/lib/format';
import ProductsView from '@/components/products-view';

export const dynamic = 'force-dynamic';

const SPARKLINE_DAYS = 14;

export default async function HomePage() {
  const products = await loadAllProducts();
  // Fetch last 14 days of liquidity-available per product for the trend sparkline.
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

  const totalProducts = products.length;
  const totalFiats = new Set(products.flatMap((p) => p.yaml.fiats)).size;
  const totalCountries = new Set(products.flatMap((p) => p.yaml.countries_supported ?? [])).size;
  const totalTvl = products.reduce((sum, p) => sum + (snapshotTvlUsd(p.snapshot) ?? 0), 0);
  const productsWithVolume = products.filter((p) => p.snapshot?.volume_30d_usd.value != null).length;

  return (
    <div className="container">
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Products tracked</div>
          <div className="stat-value">{totalProducts}</div>
          <div className="stat-sub">across 4 categories</div>
        </div>
        <div className="stat">
          <div className="stat-label">Fiats covered</div>
          <div className="stat-value">{totalFiats}</div>
          <div className="stat-sub">{totalCountries} countries explicitly listed</div>
        </div>
        <div className="stat">
          <div className="stat-label">Combined liquidity / TVL</div>
          <div className="stat-value">{fmtUsd(totalTvl)}</div>
          <div className="stat-sub">where measurable</div>
        </div>
        <div className="stat">
          <div className="stat-label">Volume disclosed</div>
          <div className="stat-value">
            {productsWithVolume}/{totalProducts}
          </div>
          <div className="stat-sub">most CEX/ramp/OTC don&apos;t publish</div>
        </div>
      </div>

      <h2 className="section-title">All products</h2>

      <ProductsView products={products} sparklines={sparklines} />
    </div>
  );
}
