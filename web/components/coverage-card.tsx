import { fmtRelTime, provenanceColor, provenanceLabel } from '@/lib/format';
import type { ProductYaml, Snapshot } from '@/lib/types';
import { AssetChip } from './chips';
import FiatBrowser from './fiat-browser';
import PaymentMethodBrowser from './payment-method-browser';

/**
 * Coverage info card — what's *reachable* from this venue (fiats, settlement
 * assets, payment methods). Active counts (markets, makers, takers, deposits)
 * live separately in NetworkHealthCard.
 *
 * Shared between GenericDetail (binance / ramp / kraken) and Zkp2pDetail so
 * both layouts get the same long-list browser UX.
 */
export default function CoverageCard({ yaml: y, snapshot: s }: { yaml: ProductYaml; snapshot?: Snapshot }) {
  const cov = s?.coverage?.value;
  const activeFiats = cov?.fiats?.length ? cov.fiats : y.fiats;
  const inactive = cov?.fiats_inactive ?? [];
  const allPlatforms = cov?.platforms?.length ? cov.platforms : y.payment_methods ?? [];

  return (
    <div className="info-card">
      <div className="info-title">
        Coverage
        {s?.coverage ? (
          <span
            className="dot"
            title={`${provenanceLabel(s.coverage.provenance)} · ${fmtRelTime(s.coverage.last_verified)}`}
            style={{ background: provenanceColor(s.coverage.provenance), marginLeft: 6 }}
          />
        ) : null}
      </div>
      <dl className="info-kv">
        <dt>Fiats</dt>
        <dd>
          {activeFiats.length === 0 ? (
            '—'
          ) : (
            <FiatBrowser codes={activeFiats} flags={cov?.fiat_flags} />
          )}
        </dd>
        <dt>Settlement assets</dt>
        <dd>
          {/* Kept as an inline grid — only 5-6 entries per product, doesn't need a browser. */}
          {y.assets.length ? (
            <div className="asset-grid">
              {y.assets.map((a) => (
                <AssetChip key={`${a.symbol}-${a.chain}`} symbol={a.symbol} chain={a.chain} />
              ))}
            </div>
          ) : (
            '—'
          )}
        </dd>
        <dt>Payment methods</dt>
        <dd>
          {allPlatforms.length === 0 ? (
            '—'
          ) : (
            <PaymentMethodBrowser methods={allPlatforms} />
          )}
        </dd>
        {inactive.length ? (
          <>
            <dt>Withdrawn markets</dt>
            <dd>
              <div className="info-sub" style={{ marginBottom: 4 }}>
                Currencies the venue has withdrawn from.
              </div>
              <FiatBrowser codes={inactive} searchPlaceholder="search withdrawn currencies" />
            </dd>
          </>
        ) : null}
        {y.countries_supported?.length ? (
          <>
            <dt>Countries</dt>
            <dd>{y.countries_supported.join(', ')}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
