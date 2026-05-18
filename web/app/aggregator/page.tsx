import AggregatorWidget from '@/components/aggregator-widget';
import { loadAllProducts } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Aggregator tab — cross-venue route comparison. Form (direction / amount / fiat /
 * asset / method / KYC) → fan-out to each venue's quote logic → ranked results.
 *
 * Comparison engine lives at /api/aggregator/quote; widget is the client-side form +
 * results renderer. Fiats list is the live union across venue coverage (snapshot-
 * sourced where available, YAML fallback) — picked up at request time.
 */
export default async function AggregatorPage() {
  const products = await loadAllProducts();
  const allFiats = Array.from(
    new Set(products.flatMap((p) => p.snapshot?.coverage?.value.fiats ?? p.yaml.fiats)),
  ).sort();

  return (
    <div className="container">
      <div className="page-intro">
        <h1>Aggregator</h1>
        <p className="muted">
          Aggregate the most optimal route across all supported venues. Select your route
          and we'll aggregate the best price.
        </p>
      </div>
      <AggregatorWidget allFiats={allFiats} />
    </div>
  );
}
