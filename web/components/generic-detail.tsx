import type { ReactNode } from 'react';
import {
  fmtPct,
  fmtRelTime,
  fmtUsd,
  provenanceColor,
  provenanceLabel,
  snapshotTvlUsd,
  spreadKpiSub,
  cost1kTooltip,
} from '@/lib/format';
import type { Product, ProductYaml, Snapshot } from '@/lib/types';
import { FiatChip, KycBadges } from './chips';
import CoverageCard from './coverage-card';
import PropertiesCard from './properties-card';
import LiveRatesTable from './live-rates-table';
import MixBar from './mix-bar';
import DualBarChart from './dual-bar-chart';

/**
 * Generic product detail page — used for every product except zkp2p (which uses
 * the rich `Zkp2pDetail` layout). Pure extraction of the legacy non-zkp2p branch
 * from `web/app/products/[id]/page.tsx`; no behavioral change vs. that code path.
 *
 * Subsequent steps make this empty-state-aware, capability-gated, and home to a
 * data-driven KPI strip + info cards (see CLAUDE.md architecture decision C).
 *
 * Layout always provides the container, back-link, ProductHeader, and (when
 * capabilities exist) the tab nav — see web/app/products/[id]/layout.tsx. This
 * component just renders the body: intro paragraph, KPI strip, info grid, etc.
 */
export default function GenericDetail({ product }: { product: Product }) {
  const { yaml: y, snapshot: s } = product;
  const tvl = snapshotTvlUsd(s);
  // KPI label adapts to the liquidity-value kind so each product gets honest wording.
  // p2p_offerbook (binance_p2p) → "Available USDT" (only the escrowed-USDT side is
  // capital-committed); onchain_inventory (zkp2p) → "Available liquidity" (real TVL);
  // ramp_capacity → "Daily capacity"; otc_minimum → "Min ticket".
  const liqKind = s?.liquidity.value.kind;
  const liqLabel =
    liqKind === 'p2p_offerbook'
      ? 'Available USDT'
      : liqKind === 'ramp_capacity'
        ? 'Max single trade'
        : liqKind === 'otc_minimum'
          ? 'Min ticket'
          : 'Available liquidity';
  // Sub-line states the band and the full-book total it was filtered from, so the headline
  // never reads as "all the depth there is".
  const liqSub = (() => {
    if (liqKind !== 'p2p_offerbook' || !s) return undefined;
    const v = s.liquidity.value as Extract<typeof s.liquidity.value, { kind: 'p2p_offerbook' }>;
    if (!v.markets_observed) return undefined;
    return v.depth_bands_usd
      ? `within ±5% of mid · ${v.markets_observed} markets · ${fmtUsd(v.total_observed_usd ?? null)} full book`
      : `up to 100 ads × ${v.markets_observed} markets`;
  })();

  // Marketplace dynamics card: only meaningful when the adapter populates maker-aggregate
  // data (binance's active_makers / finish-rate / merchant share). The "spread fallback"
  // path renders mostly duplicates — Spread is already in the KPI strip, Reachable fiats
  // is in Coverage. Hide for ramp/kraken/future single-vendor venues.
  const showMarketplaceDynamics = s?.network_health?.value?.active_makers != null;

  return (
    <>
      {y.description ? (
        <section className="protocol-intro">
          <p>{y.description}</p>
        </section>
      ) : null}

      <div className="kpi-grid">
        <Kpi
          label={liqLabel}
          value={fmtUsd(tvl)}
          provenance={s?.liquidity.provenance}
          ts={s?.liquidity.last_verified}
          notes={s?.liquidity.notes}
          sub={liqSub}
        />
        <Kpi
          label="30d volume"
          value={fmtUsd(s?.volume_30d_usd.value ?? null)}
          provenance={s?.volume_30d_usd.provenance}
          ts={s?.volume_30d_usd.last_verified}
          notes={s?.volume_30d_usd.notes}
        />
        <Kpi
          label="Spread (~$1k)"
          value={fmtPct(s?.observed_spread_bps.value ?? null)}
          provenance={s?.observed_spread_bps.provenance}
          ts={s?.observed_spread_bps.last_verified}
          notes={s?.observed_spread_bps.notes}
          sub={s ? spreadKpiSub(s.observed_spread_bps) : undefined}
          tooltip={s?.cost_1k?.value ? cost1kTooltip(s.cost_1k.value) : undefined}
        />
        <Kpi
          label="KYC requirement"
          value={<KycBadges pii={y.pii_floor} />}
          provenance="manual"
          sub={y.kyc_tiers?.length ? `${y.kyc_tiers.length} tier${y.kyc_tiers.length > 1 ? 's' : ''}` : undefined}
        />
      </div>

      {/* Info cards — Properties / Coverage / Classification / Marketplace dynamics.
          The 4th card is gated: hidden for products that don't fit (single-vendor ramps,
          OTC desks) rather than rendered as a wall of "—" rows. */}
      <section className="section">
        <div className="info-grid">
          <PropertiesCard yaml={y} snapshot={s} />
          <CoverageCard yaml={y} snapshot={s} />
          <ClassificationCard yaml={y} />
          {showMarketplaceDynamics ? <NetworkHealthCard snapshot={s} /> : null}
        </div>
      </section>

      {/* Live rates table — kind-aware: column set + labels + footer copy adapt to
          the venue type (p2p_offerbook for binance, ramp_capacity for ramp). */}
      {s?.markets?.value?.length ? (
        <LiveRatesTable
          markets={s.markets.value}
          snapshot={s}
          productId={y.id}
        />
      ) : null}

      {/* Market mix — current snapshot. Two sub-cards side-by-side:
            1. By USDT locked up — sorted by escrowed depth, classic ranking
            2. Onramp vs Offramp — dual-bar surfaces direction asymmetry per fiat
          The variants share data but use different sorts + denominators. */}
      {s?.depth_composition?.value.currencies.length ? (
        <section className="section">
          <h2>
            Fiat and Payment Methods stats{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              · {s.depth_composition.value.period}
            </span>{' '}
            <span
              className="dot"
              style={{ background: provenanceColor(s.depth_composition.provenance) }}
              title={`${provenanceLabel(s.depth_composition.provenance)} · ${fmtRelTime(s.depth_composition.last_verified)}`}
            />
          </h2>
          <div className="composition-grid">
            {(() => {
              const currencies = s.depth_composition!.value.currencies;
              const hasSplit = currencies.some(
                (c) => c.buy_liquidity_usd != null && c.sell_liquidity_usd != null,
              );
              const flags = s.coverage?.value.fiat_flags;
              // Card 1: classic "by USDT locked up" — sorted by BUY-side depth desc.
              // share_pct recomputed against BUY-only total so percentages read as
              // "X% of escrowed USDT sits in this fiat market."
              const buyOnly = hasSplit
                ? currencies
                    .filter((c) => (c.buy_liquidity_usd ?? 0) > 0)
                    .sort(
                      (a, b) => (b.buy_liquidity_usd ?? 0) - (a.buy_liquidity_usd ?? 0),
                    )
                : currencies;
              const buyTotal = hasSplit
                ? buyOnly.reduce((sum, c) => sum + (c.buy_liquidity_usd ?? 0), 0)
                : currencies.reduce((sum, c) => sum + c.liquidity_usd, 0);
              return (
                <>
                  <MixBar
                    title="By USDT locked up"
                    items={buyOnly.map((c) => {
                      const amount = hasSplit ? (c.buy_liquidity_usd ?? 0) : c.liquidity_usd;
                      return {
                        key: c.key,
                        label: c.label,
                        amount_usd: amount,
                        share_pct: buyTotal > 0 ? (amount / buyTotal) * 100 : 0,
                      };
                    })}
                    renderLabel={(it) => <FiatChip code={it.label} flag={flags?.[it.label]} />}
                  />
                  {hasSplit ? (
                    <DualBarChart
                      title="Onramp liquidity vs Offramp demand — by fiat"
                      // Deliberately NOT "onramp vs offramp liquidity": the onramp side is
                      // escrowed capital, the offramp side is unbacked maker intent. They
                      // are different units and must not read as like-for-like.
                      buyLabel="Onramp liquidity"
                      sellLabel="Offramp demand"
                      buyTitle="Escrowed USDT — the venue locks the maker's asset, so this capital is committed."
                      sellTitle="Unbacked maker buy intent — advertised demand with nothing locked behind it. Not comparable to escrowed liquidity."
                      items={currencies.map((c) => ({
                        key: c.key,
                        label: c.label,
                        buy_amount_usd: c.buy_liquidity_usd ?? 0,
                        sell_amount_usd: c.sell_liquidity_usd ?? 0,
                      }))}
                      renderLabel={(it) => <FiatChip code={it.label} flag={flags?.[it.label]} />}
                    />
                  ) : null}
                </>
              );
            })()}
          </div>
        </section>
      ) : null}

      {/* Market mix — historical 30d composition (when populated). zkp2p uses its
          bespoke detail page; ramp/kraken don't surface transaction breakdowns. */}
      {s?.composition && (s.composition.value.currencies.length || s.composition.value.platforms.length) ? (
        <section className="section">
          <h2>
            Fiat and Payment Methods stats <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {s.composition.value.period}</span>{' '}
            <span
              className="dot"
              style={{ background: provenanceColor(s.composition.provenance) }}
              title={`${provenanceLabel(s.composition.provenance)} · ${fmtRelTime(s.composition.last_verified)}`}
            />
          </h2>
          <div className="composition-grid">
            <MixBar
              title="By fiat currency"
              items={s.composition.value.currencies.map((c) => ({
                key: c.key,
                label: c.label,
                amount_usd: c.volume_usd,
                share_pct: c.share_pct,
              }))}
            />
            <MixBar
              title="By payment platform"
              items={s.composition.value.platforms.map((p) => ({
                key: p.key,
                label: p.label,
                amount_usd: p.volume_usd,
                share_pct: p.share_pct,
              }))}
            />
          </div>
        </section>
      ) : null}

      {/* Integration — folded by default; native <details> for zero-JS toggle. */}
      <details className="section section-collapsible">
        <summary>Integration</summary>
        <dl className="kv">
          <dt>Integration types</dt>
          <dd>{y.integration_types?.join(', ') ?? '—'}</dd>
          <dt>SDKs</dt>
          <dd>
            {y.sdks?.length
              ? y.sdks.map((sdk) => (sdk.url ? `${sdk.platform} (${sdk.url})` : sdk.platform)).join(', ')
              : '—'}
          </dd>
          <dt>White label</dt>
          <dd>{y.white_label ?? '—'}</dd>
          <dt>KYC inheritance</dt>
          <dd>{y.kyc_inheritance ?? '—'}</dd>
          <dt>Webhooks</dt>
          <dd>{y.webhooks ? 'Yes' : 'No'}</dd>
          <dt>Sandbox</dt>
          <dd>{y.sandbox ? 'Yes' : 'No'}</dd>
          {y.docs_url ? (
            <>
              <dt>Docs</dt>
              <dd>
                <a href={y.docs_url} target="_blank" rel="noreferrer">
                  {y.docs_url}
                </a>
              </dd>
            </>
          ) : null}
          <dt>Integrator fee model</dt>
          <dd>
            {typeof y.integrator_fee_model === 'string'
              ? y.integrator_fee_model
              : y.integrator_fee_model?.type ?? '—'}
          </dd>
        </dl>
      </details>

      {/* Raw data — folded by default. */}
      <details className="section section-collapsible">
        <summary>Raw data</summary>
        <dl className="kv">
          <dt>Product YAML</dt>
          <dd className="mono">data/products/{y.id}.yaml</dd>
          <dt>Snapshot JSON</dt>
          <dd className="mono">
            data/snapshots/{y.id}.json{' '}
            {s ? <span className="muted">· {fmtRelTime(s.liquidity.last_verified)}</span> : <span className="muted">· not generated</span>}
          </dd>
          {y.contracts?.length ? (
            <>
              <dt>Contracts</dt>
              <dd className="mono">
                {y.contracts.map((c, i) => (
                  <div key={i}>
                    {c.chain}: {c.address}
                  </div>
                ))}
              </dd>
            </>
          ) : null}
        </dl>
      </details>
    </>
  );
}

interface KpiProps {
  label: string;
  // ReactNode so callers can embed badges / JSX (e.g. KycBadges) instead of plain text.
  value: ReactNode;
  provenance?: string;
  ts?: number;
  notes?: string;
  sub?: string;
  /** Hover tooltip on the value itself (multi-line ok) — e.g. the cost_1k breakdown. */
  tooltip?: string;
}

function Kpi({ label, value, provenance, ts, notes, sub, tooltip }: KpiProps) {
  // When the underlying data is structurally undisclosed by the product
  // (provenance: 'unavailable'), render a "Not disclosed" label instead of "—".
  // The reason lives in `notes` and is already surfaced via the dot tooltip.
  const isUnavailable = provenance === 'unavailable';
  // When `value` is a string we use the big-mono style. When it's a richer node
  // (badges, etc.) we use the compact rich style so the inner content can set its
  // own sizing without fighting a 20px parent.
  const isRichValue = typeof value !== 'string' && typeof value !== 'number';
  return (
    <div className="kpi">
      <div className="kpi-label">
        {provenance ? (
          <span
            className="dot"
            style={{ background: provenanceColor(provenance as never) }}
            title={`${provenanceLabel(provenance as never)}${ts ? ` · ${fmtRelTime(ts)}` : ''}${notes ? ` · ${notes}` : ''}`}
          />
        ) : null}
        {label}
      </div>
      {isUnavailable ? (
        <div className="kpi-value-na" title={notes}>Not disclosed</div>
      ) : isRichValue ? (
        <div className="kpi-value-rich" title={tooltip}>{value}</div>
      ) : (
        <div className="kpi-value mono" title={tooltip} style={tooltip ? { cursor: 'help' } : undefined}>
          {value}
        </div>
      )}
      {/* Suppress sub (e.g. "n=0 · sample") when the field is unavailable — it's noise then. */}
      {sub && !isUnavailable ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

// MixBar extracted to ./mix-bar.tsx — shared with zkp2p-detail.tsx.

function fmtUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

// --- Label helpers ----------------------------------------------------------
// `directionLabel`, `custodyLabel`, `settlementLabel` were dropped when their
// corresponding fields moved out of PropertiesCard (direction now renders as colored
// pills inline; custody and settlement now live in ClassificationCard with
// per-category descriptive text).

function kycLabel(pii: ProductYaml['pii_floor']): string {
  if (!pii || pii === 'none') return 'None';
  if (pii === 'email') return 'Email only';
  if (pii === 'id') return 'ID required';
  if (pii === 'id+poa') return 'ID + Proof of address';
  if (pii === 'enhanced') return 'Enhanced (KYC + source of funds)';
  return pii;
}

const SPREAD_NEUTRAL_BPS = 25;

function spreadColor(bps: number): string {
  if (bps < -SPREAD_NEUTRAL_BPS) return 'var(--prov-good)';
  if (bps > SPREAD_NEUTRAL_BPS) return 'var(--warn)';
  return 'var(--fg-mute)';
}

function fmtSpreadPct(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  const pct = bps / 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

// --- Info cards -------------------------------------------------------------

function ClassificationCard({ yaml: y }: { yaml: ProductYaml }) {
  // Card titles are fixed; descriptions are derived per-product so each venue gets a
  // factual statement of what's true for it (not a yes/no judgment). State (ok/warn)
  // still encodes user-friendliness so the visual signal carries.
  const isSelfCustody = y.delivery_custody === 'self';
  const isNoKyc = y.non_kyc_available === true;
  const isOnchain = y.category === 'onchain';
  const isCex = y.category === 'cex_p2p';
  const isRamp = y.category === 'ramp';

  // Custody type
  const custodyDesc = isSelfCustody
    ? "Self-custodial: assets are delivered directly to the user's wallet."
    : isCex
      ? "Custodial: purchased assets are delivered to the user's account on the exchange."
      : isRamp
        ? 'Custodial during transit: assets are forwarded to a wallet address you provide.'
        : 'Custodial: the venue holds assets on behalf of the user.';

  // KYC requirements
  const kycDesc = isNoKyc
    ? 'No identity verification required at the protocol layer.'
    : isCex
      ? 'Users are required to verify their ID to be able to trade on P2P markets.'
      : isRamp
        ? `Identity verification (${kycLabel(y.pii_floor)}) required for fiat onramps.`
        : `Identity verification required (${kycLabel(y.pii_floor)}).`;

  // Disputes settlement
  const disputesDesc = isOnchain
    ? 'Cryptographic proof of payment unlocks the escrow on-chain — no human arbitration.'
    : isCex
      ? 'In case of a dispute, the venue support steps in to settle it.'
      : isRamp
        ? 'No bilateral trade — refunds via venue support if a transaction fails.'
        : 'Bilateral resolution between parties; venue may mediate.';

  // Settlement
  const settlementChain = y.contracts?.[0]?.chain;
  const settlementDesc = isOnchain
    ? `Trades settle onchain${settlementChain ? ` on ${settlementChain}` : ''} via smart contract escrow.`
    : isCex
      ? 'Trades settle off-chain, on the venue.'
      : isRamp
        ? 'Direct fiat-to-crypto delivery to the user wallet.'
        : 'Bilateral OTC settlement.';

  // Proof of Reserves (CEX-shaped concept, adapted for each category).
  // - Onchain: funds are visible on-chain by design → ok by default.
  // - CEX with PoR published → ok, link the source.
  // - CEX without PoR → fail.
  // - Ramp / OTC: PoR less applicable; warn unless the yaml says it exists.
  const por = y.proof_of_reserves;
  let porState: 'ok' | 'warn' | 'fail';
  let porDesc: ReactNode;
  if (isOnchain) {
    porState = 'ok';
    porDesc = 'Funds are verifiable directly on-chain — no separate proof of reserves needed.';
  } else if (por?.exists) {
    porState = 'ok';
    const updated = por.last_updated ? ` (last updated ${por.last_updated})` : '';
    porDesc = por.url ? (
      <>
        CEX&apos;s reserves backing users&apos; funds are fully backed according to its PoR{' '}
        <a href={por.url} target="_blank" rel="noreferrer">
          here ↗
        </a>
        .
      </>
    ) : (
      `Self-attested reserves${updated}.`
    );
  } else if (isCex) {
    porState = 'fail';
    porDesc = 'No published proof of reserves.';
  } else {
    porState = 'warn';
    porDesc = 'No proof of reserves published — less applicable for this venue type.';
  }

  return (
    <div className="info-card">
      <div className="info-title">Classification</div>
      <div className="badge-grid">
        <Badge
          state={isSelfCustody ? 'ok' : 'warn'}
          title="Custody type"
          desc={custodyDesc}
        />
        <Badge
          state={isNoKyc ? 'ok' : 'warn'}
          title="KYC requirements"
          desc={kycDesc}
        />
        <Badge
          state={isOnchain ? 'ok' : 'warn'}
          title="Disputes settlement"
          desc={disputesDesc}
        />
        <Badge
          state={isOnchain ? 'ok' : 'warn'}
          title="Settlement"
          desc={settlementDesc}
        />
        {/* Ramps quote against their own capacity, not a pooled reserve — PoR isn't a
            meaningful signal there, so hide the badge entirely rather than warn. */}
        {isRamp ? null : <Badge state={porState} title="Proof of Reserves" desc={porDesc} />}
      </div>
    </div>
  );
}

function NetworkHealthCard({ snapshot: s }: { snapshot?: Snapshot }) {
  const nh = s?.network_health?.value;
  // CEX-P2P-flavored content: the adapter aggregated maker reputation across the live
  // ad probe. Detected by the presence of `active_makers` (binance populates it; ramp /
  // kraken don't). Keeps the existing rows as a fallback for products without it.
  const isMakerAggregateShape = nh?.active_makers != null;

  // Title-dot provenance source switches with the rendered content.
  const dotProv = isMakerAggregateShape
    ? s?.network_health?.provenance
    : s?.observed_spread_bps?.provenance;
  const dotTs = isMakerAggregateShape
    ? s?.network_health?.last_verified
    : s?.observed_spread_bps?.last_verified;

  return (
    <div className="info-card">
      <div className="info-title">
        Marketplace dynamics
        {dotTs ? (
          <span
            className="dot"
            title={`${provenanceLabel(dotProv ?? 'manual')} · ${fmtRelTime(dotTs)}`}
            style={{ background: provenanceColor(dotProv ?? 'manual'), marginLeft: 6 }}
          />
        ) : null}
      </div>
      {isMakerAggregateShape ? (
        <MakerAggregateRows nh={nh!} />
      ) : (
        <LegacyNetworkHealthRows snapshot={s} />
      )}
    </div>
  );
}

function MakerAggregateRows({ nh }: { nh: NonNullable<Snapshot['network_health']>['value'] }) {
  return (
    <dl className="info-kv">
      <dt>Active makers</dt>
      <dd className="mono">
        {nh.active_makers!.toLocaleString()}{' '}
        <span className="muted">distinct in sample</span>
      </dd>
      <dt>Active ads</dt>
      <dd className="mono">
        {nh.active_ads != null ? nh.active_ads.toLocaleString() : '—'}{' '}
        <span className="muted">across observed markets</span>
      </dd>
      <dt>Avg maker finish-rate</dt>
      <dd className="mono">
        {nh.avg_maker_month_finish_rate_pct != null
          ? `${nh.avg_maker_month_finish_rate_pct.toFixed(1)}%`
          : '—'}{' '}
        <span className="muted">last 30d</span>
      </dd>
      <dt>Avg maker monthly orders</dt>
      <dd className="mono">
        {nh.avg_maker_month_order_count != null
          ? Math.round(nh.avg_maker_month_order_count).toLocaleString()
          : '—'}
      </dd>
      <dt>Merchant share</dt>
      <dd className="mono">
        {nh.merchant_share_pct != null ? `${nh.merchant_share_pct.toFixed(1)}%` : '—'}{' '}
        <span className="muted">verified merchant accounts</span>
      </dd>
    </dl>
  );
}

function LegacyNetworkHealthRows({ snapshot: s }: { snapshot?: Snapshot }) {
  const topPair = (() => {
    if (s?.liquidity.value.kind !== 'p2p_offerbook') return null;
    const pairs = s.liquidity.value.top_pairs;
    if (!pairs.length) return null;
    return [...pairs].sort((a, b) => b.sum_offers_usd - a.sum_offers_usd)[0];
  })();
  const spread = s?.observed_spread_bps;
  const cov = s?.coverage?.value;
  return (
    <dl className="info-kv">
      <dt>Spread (~$1k)</dt>
      <dd
        className="mono"
        style={{
          color: spread?.value != null ? spreadColor(spread.value) : 'var(--fg)',
          fontWeight: 500,
        }}
      >
        {spread?.value != null ? fmtSpreadPct(spread.value) : '—'}
      </dd>
      <dt>Sample size</dt>
      <dd className="mono">
        {spread?.sample_size ? spread.sample_size.toLocaleString() : '—'}
        {spread?.sample_size ? (
          <span className="muted"> {spread.spread_aggregation} · {spread.period}</span>
        ) : null}
      </dd>
      <dt>Reachable fiat markets</dt>
      <dd className="mono">{cov?.fiats?.length ?? '—'}</dd>
      {topPair ? (
        <>
          <dt>Deepest pair</dt>
          <dd className="mono">
            {topPair.pair}{' '}
            <span className="muted">
              · {fmtUsdShort(topPair.sum_offers_usd)} · {topPair.n_makers} makers
            </span>
          </dd>
        </>
      ) : null}
    </dl>
  );
}

// --- Tiny presentational components ----------------------------------------

function Badge({
  state,
  title,
  desc,
}: {
  state: 'ok' | 'warn' | 'fail';
  title: string;
  // ReactNode so callers can embed a link (e.g. Proof of Reserves → view source).
  desc: ReactNode;
}) {
  const icon = state === 'ok' ? '✓' : state === 'warn' ? '⚠' : '✕';
  return (
    <div className={`badge badge-${state}`}>
      <div className="badge-head">
        <span className="badge-icon">{icon}</span>
        <span className="badge-title">{title}</span>
      </div>
      <div className="badge-desc">{desc}</div>
    </div>
  );
}

// KycBadges, KycKind, kycKindsFor were extracted to ./chips.tsx so zkp2p-detail
// can also import them without duplicating the badge taxonomy.

// FiatChip, AssetChip, PaymentChip were extracted to ./chips.tsx so both this
// Server Component and the Client-Component browsers (fiat-browser, payment-method-browser)
// can import them. Definitions live there now.

// --- Live rates table ------------------------------------------------------

// LiveRatesTable extracted to ./live-rates-table.tsx (client component for the
// onramp/offramp toggle state). Generic-detail just imports + renders.
