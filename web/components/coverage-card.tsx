import { fmtRelTime, provenanceColor, provenanceLabel } from '@/lib/format';
import type { ProductYaml, Snapshot } from '@/lib/types';
import { AssetChip, ChainChip } from './chips';
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

  // Settlement assets/chains: separated so users see "what tokens" vs "which networks"
  // as distinct dimensions rather than as a cross-product of asset×chain combos.
  const uniqueAssetSymbols = Array.from(new Set(y.assets.map((a) => a.symbol)));
  // When the venue declares off-chain settlement (CEX-P2P like Binance), the asset
  // entries' `chain` field is just the asset's native network — NOT the settlement
  // venue. The off-chain sentinel overrides: show a single "Off-chain" pill.
  const declaredChains = y.delivery_chains ?? [];
  const isOffchainOnly =
    declaredChains.length > 0 &&
    declaredChains.every((c) => c.toLowerCase() === 'offchain');
  const chainsFromAssets = isOffchainOnly
    ? []
    : y.assets
        .map((a) => a.chain)
        .filter((c): c is string => Boolean(c) && c !== 'multiple' && c !== 'various');
  const allChains = isOffchainOnly
    ? ['offchain']
    : Array.from(new Set([...declaredChains, ...chainsFromAssets]));

  return (
    <div className="info-card">
      <div className="info-title">
        Coverage
        {s?.coverage ? (
          <span
            className="dot"
            title={`${provenanceLabel(s.coverage.provenance)} · ${fmtRelTime(s.coverage.last_verified)}`}
            style={{ background: provenanceColor(s.coverage.provenance) }}
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
          {/* Unique asset symbols only — chains live in their own row below, so showing
              USDC.eth + USDC.base + USDC.polygon as 3 chips here would just be noise. */}
          {uniqueAssetSymbols.length ? (
            <div className="asset-grid">
              {uniqueAssetSymbols.map((s) => (
                <AssetChip key={s} symbol={s} />
              ))}
            </div>
          ) : (
            '—'
          )}
        </dd>
        <dt>Settlement chains</dt>
        <dd>
          {/* Union of `delivery_chains` (the curated capability list) and chains seen on
              individual asset entries. 'multiple' / 'various' placeholders are skipped since
              they're not real chain names. */}
          {allChains.length ? (
            <div className="chain-grid">
              {allChains.map((c) => (
                <ChainChip key={c} name={c} />
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
              <div className="info-sub mb-1">
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
