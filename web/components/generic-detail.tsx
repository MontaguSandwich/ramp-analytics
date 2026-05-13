import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CATEGORY_LABEL,
  fmtPct,
  fmtRelTime,
  fmtUsd,
  provenanceColor,
  provenanceLabel,
  snapshotTvlUsd,
} from '@/lib/format';
import type { Market, Product, ProductYaml, Provenance, Snapshot } from '@/lib/types';
import { AssetChip, FiatChip, KycBadges } from './chips';
import FiatBrowser from './fiat-browser';
import PaymentMethodBrowser from './payment-method-browser';

/**
 * Generic product detail page — used for every product except zkp2p (which uses
 * the rich `Zkp2pDetail` layout). Pure extraction of the legacy non-zkp2p branch
 * from `web/app/products/[id]/page.tsx`; no behavioral change vs. that code path.
 *
 * Subsequent steps make this empty-state-aware, capability-gated, and home to a
 * data-driven KPI strip + info cards (see CLAUDE.md architecture decision C).
 *
 * When `wrapped` is true, the parent layout has already rendered the container and
 * back-link (because this product has capability-gated subpages and a tab nav).
 * In that case we omit both and let our sections render directly under the tabs.
 */
export default function GenericDetail({ product, wrapped }: { product: Product; wrapped?: boolean }) {
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
        ? 'Daily capacity'
        : liqKind === 'otc_minimum'
          ? 'Min ticket'
          : 'Available liquidity';
  const liqSub =
    liqKind === 'p2p_offerbook' && s?.liquidity.value.markets_observed
      ? `top 20 ads × ${s.liquidity.value.markets_observed} markets`
      : undefined;

  // When the layout wraps us (capability-enabled products like binance_p2p), ProductHeader
  // already rendered the title and link pills. Only render the intro paragraph here.
  // When unwrapped (ramp_network, kraken_otc), keep the legacy inline hero block.
  const hero = wrapped ? (
    y.description ? (
      <section className="protocol-intro">
        <p>{y.description}</p>
      </section>
    ) : null
  ) : (
    <>
      <div className="detail-hero">
        <div>
          <h1>{y.name}</h1>
          <div className="muted">{y.subcategory ?? ''}</div>
        </div>
        <div className="detail-hero-tags">
          <span className={`tag cat-${y.category}`}>{CATEGORY_LABEL[y.category]}</span>
          <span className="tag">{y.direction === 'both' ? 'on + off' : y.direction}-ramp</span>
          <span className="tag">{`custody: ${y.delivery_custody}`}</span>
          {y.non_kyc_available ? <span className="tag">no-KYC available</span> : null}
          {y.open_source?.is_open ? <span className="tag">open source</span> : null}
          <a className="tag" href={y.website} target="_blank" rel="noreferrer">
            {y.website.replace(/^https?:\/\//, '')} ↗
          </a>
        </div>
      </div>
      {y.description ? (
        <section className="protocol-intro">
          <p>{y.description}</p>
        </section>
      ) : null}
    </>
  );

  const body = (
    <>
      {hero}

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
        />
        <Kpi
          label="KYC requirement"
          value={<KycBadges pii={y.pii_floor} />}
          provenance="manual"
          sub={y.kyc_tiers?.length ? `${y.kyc_tiers.length} tier${y.kyc_tiers.length > 1 ? 's' : ''}` : undefined}
        />
      </div>

      {/* Info cards 2x2 — Properties / Coverage / Classification / Network Health.
          Folded from the legacy Coverage / Pricing / Trust sections; data sources are
          a mix of YAML (curated venue facts) and live snapshot (coverage, spread). */}
      <section className="section">
        <div className="info-grid">
          <PropertiesCard yaml={y} />
          <CoverageCard yaml={y} snapshot={s} />
          <ClassificationCard yaml={y} />
          <NetworkHealthCard snapshot={s} />
        </div>
      </section>

      {/* Live rates table — top 10 deepest markets, sorted by best spread ascending.
          Conditional on adapter populating snapshot.markets (binance_p2p does in Step C;
          ramp_network / kraken_otc don't). */}
      {s?.markets?.value?.length ? (
        <LiveRatesTable
          markets={s.markets.value}
          provenance={s.markets.provenance}
          lastVerified={s.markets.last_verified}
          productId={y.id}
        />
      ) : null}

      {/* Composition — currency + payment platform mix. Conditional on data; binance_p2p
          / ramp_network / kraken_otc don't populate this today. */}
      {s?.composition && (s.composition.value.currencies.length || s.composition.value.platforms.length) ? (
        <section className="section">
          <h2>
            Composition <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {s.composition.value.period}</span>{' '}
            <span
              className="dot"
              style={{ background: provenanceColor(s.composition.provenance) }}
              title={`${provenanceLabel(s.composition.provenance)} · ${fmtRelTime(s.composition.last_verified)}`}
            />
          </h2>
          <div className="composition-grid">
            <MixBar title="By fiat currency" items={s.composition.value.currencies} />
            <MixBar title="By payment platform" items={s.composition.value.platforms} />
          </div>
        </section>
      ) : null}

      {/* Integration */}
      <section className="section">
        <h2>Integration</h2>
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
      </section>

      {/* Raw data */}
      <section className="section">
        <h2>Raw data</h2>
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
      </section>
    </>
  );

  if (wrapped) return body;
  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← All products
      </Link>
      {body}
    </div>
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
}

function Kpi({ label, value, provenance, ts, notes, sub }: KpiProps) {
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
        <div className="kpi-value-rich">{value}</div>
      ) : (
        <div className="kpi-value mono">{value}</div>
      )}
      {/* Suppress sub (e.g. "n=0 · sample") when the field is unavailable — it's noise then. */}
      {sub && !isUnavailable ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

interface MixItem {
  key: string;
  label: string;
  volume_usd: number;
  share_pct: number;
  fulfilled_intents: number;
}

function MixBar({ title, items }: { title: string; items: MixItem[] }) {
  // Dedupe by label (peerlytics returns multiple zelle hashes; we sum them).
  const merged = new Map<string, MixItem>();
  for (const it of items) {
    const key = it.label.toLowerCase();
    const cur = merged.get(key);
    if (cur) {
      cur.volume_usd += it.volume_usd;
      cur.share_pct += it.share_pct;
      cur.fulfilled_intents += it.fulfilled_intents;
    } else {
      merged.set(key, { ...it });
    }
  }
  const sorted = [...merged.values()].sort((a, b) => b.volume_usd - a.volume_usd);
  const top = sorted.slice(0, 8);

  return (
    <div className="mix-card">
      <div className="mix-title">{title}</div>
      <div className="mix-rows">
        {top.map((it) => (
          <div className="mix-row" key={it.key}>
            <div className="mix-label">{it.label}</div>
            <div className="mix-bar-wrap">
              <div className="mix-bar" style={{ width: `${Math.min(100, it.share_pct).toFixed(2)}%` }} />
            </div>
            <div className="mix-pct mono">{it.share_pct.toFixed(1)}%</div>
            <div className="mix-vol mono muted">{fmtUsdShort(it.volume_usd)}</div>
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

/**
 * Sub-line text for the Spread KPI. Replaces the raw `n=X · aggregation` string with
 * something a user can parse: "$1k USD/USDT match" for the new effective-at-size metric,
 * generic samples-count otherwise.
 */
function spreadKpiSub(s: Snapshot['observed_spread_bps']): string {
  if (s.spread_aggregation === 'effective_at_size') {
    // period strings: "usd_usdt_$1k_single_match" (binance), "usd_usdc_$1k_clob_walk" (zkp2p),
    // "usd_$1k_quote" (ramp/otc — both unavailable). Render a brief, user-readable form.
    if (s.period.includes('usdt')) return '$1k USD/USDT · single match';
    if (s.period.includes('usdc')) return `$1k USD/USDC · ${s.sample_size} level${s.sample_size === 1 ? '' : 's'}`;
    return '$1k USD';
  }
  return `n=${s.sample_size} · ${s.spread_aggregation}`;
}

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

function PropertiesCard({ yaml: y }: { yaml: ProductYaml }) {
  // Trimmed scope post-design-pass: Custody, Settlement, Proof of reserves moved into
  // the Classification card. Team transparency, Legal entity, Licenses dropped as low
  // signal for the cross-product comparison.
  const showOnramp = y.direction === 'on' || y.direction === 'both';
  const showOfframp = y.direction === 'off' || y.direction === 'both';
  return (
    <div className="info-card">
      <div className="info-title">Venue Properties</div>
      <dl className="info-kv">
        <dt>Category</dt>
        <dd>
          <span className={`tag cat-${y.category}`}>
            {CATEGORY_LABEL[y.category] ?? y.category}
          </span>
        </dd>
        <dt>Direction</dt>
        <dd>
          <div className="direction-pills">
            {showOnramp ? <span className="tag tag-onramp">Onramp</span> : null}
            {showOfframp ? <span className="tag tag-offramp">Offramp</span> : null}
          </div>
        </dd>
        <dt>Pricing</dt>
        <dd>{y.pricing?.spread_method?.replace(/_/g, ' ') ?? '—'}</dd>
        <dt>Live since</dt>
        <dd>{y.launched ?? '—'}</dd>
        {y.audits?.length ? (
          <>
            <dt>Audits</dt>
            <dd>{y.audits.map((a) => `${a.firm} (${a.date})`).join('; ')}</dd>
          </>
        ) : null}
        {y.contracts?.length ? (
          <>
            <dt>Contract</dt>
            <dd className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>
              {y.contracts[0].address}
              {y.contracts.length > 1 ? (
                <span className="muted"> +{y.contracts.length - 1}</span>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function CoverageCard({ yaml: y, snapshot: s }: { yaml: ProductYaml; snapshot?: Snapshot }) {
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
        Reserves are cryptographically attested{updated}.{' '}
        <a href={por.url} target="_blank" rel="noreferrer">
          View ↗
        </a>
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
        <Badge state={porState} title="Proof of Reserves" desc={porDesc} />
      </div>
    </div>
  );
}

function NetworkHealthCard({ snapshot: s }: { snapshot?: Snapshot }) {
  // Pull the richest pair from liquidity.top_pairs if available (binance/p2p shape).
  const topPair = (() => {
    if (s?.liquidity.value.kind !== 'p2p_offerbook') return null;
    const pairs = s.liquidity.value.top_pairs;
    if (!pairs.length) return null;
    return [...pairs].sort((a, b) => b.sum_offers_usd - a.sum_offers_usd)[0];
  })();

  const spread = s?.observed_spread_bps;
  const cov = s?.coverage?.value;

  return (
    <div className="info-card">
      <div className="info-title">
        Network Health
        {s?.observed_spread_bps.last_verified ? (
          <span
            className="dot"
            title={`${provenanceLabel(s.observed_spread_bps.provenance)} · ${fmtRelTime(s.observed_spread_bps.last_verified)}`}
            style={{
              background: provenanceColor(s.observed_spread_bps.provenance),
              marginLeft: 6,
            }}
          />
        ) : null}
      </div>
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
    </div>
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

function LiveRatesTable({
  markets,
  provenance,
  lastVerified,
  productId,
}: {
  markets: Market[];
  provenance: Provenance;
  lastVerified: number;
  productId: string;
}) {
  // Top 10 by liquidity (adapter pre-filtered); display order is best spread ascending,
  // matching zkp2p's convention — "most favorable rate first" reads naturally to users.
  const displayed = [...markets].sort((a, b) => a.spread_bps - b.spread_bps);

  return (
    <section className="section">
      <h2>
        Live rates{' '}
        <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
          · top {displayed.length} deepest USDT markets
        </span>{' '}
        <span
          className="dot"
          style={{ background: provenanceColor(provenance) }}
          title={`${provenanceLabel(provenance)} · ${fmtRelTime(lastVerified)}`}
        />
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Currency</th>
              <th>Best rate</th>
              <th>Spread</th>
              <th>Liquidity (top 20)</th>
              <th>Ads</th>
              <th>Makers</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((m) => (
              <tr key={m.currency}>
                <td>
                  <FiatChip code={m.currency} />
                </td>
                <td className="mono">{m.best_rate.toFixed(4)}</td>
                <td
                  className="mono"
                  style={{ color: spreadColor(m.spread_bps), fontWeight: 500 }}
                >
                  {fmtSpreadPct(m.spread_bps)}
                </td>
                <td className="mono">{fmtUsdShort(m.total_liquidity_usd)}</td>
                <td className="mono">{m.deposit_count.toLocaleString()}</td>
                <td className="mono">{m.n_makers ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 11, margin: '8px 4px' }}>
        One row per currency · ranked top-10 by USD offer value · sorted by best spread.{' '}
        <Link
          href={`/products/${productId}/orderbook`}
          className="cta-link"
          style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
        >
          Open orderbook →
        </Link>
      </div>
    </section>
  );
}
