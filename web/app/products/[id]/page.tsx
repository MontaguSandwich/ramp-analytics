import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listProductIds, loadHistory, loadProduct } from '@/lib/data';
import {
  fmtPct,
  fmtRelTime,
  fmtUsd,
  provenanceColor,
  provenanceLabel,
  snapshotTvlUsd,
} from '@/lib/format';
import Zkp2pDetail from '@/components/zkp2p-detail';

export const dynamic = 'force-dynamic';

const CATEGORY_LABEL: Record<string, string> = {
  onchain: 'Onchain P2P',
  cex_p2p: 'CEX P2P',
  ramp: 'Ramp',
  otc: 'OTC',
};

export async function generateStaticParams() {
  const ids = await listProductIds();
  return ids.map((id) => ({ id }));
}

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ids = await listProductIds();
  if (!ids.includes(id)) notFound();

  const product = await loadProduct(id);

  // zkp2p uses the rich DefiLlama-style layout with charts + markets + composition.
  // Layout (app/products/[id]/layout.tsx) provides the container + header + tab nav.
  if (id === 'zkp2p') {
    const history = await loadHistory(id);
    return <Zkp2pDetail product={product} history={history} />;
  }

  const { yaml: y, snapshot: s } = product;
  const tvl = snapshotTvlUsd(s);
  const liqLabel = 'Available liquidity';

  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← All products
      </Link>

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

      <div className="kpi-grid">
        <Kpi
          label={liqLabel}
          value={fmtUsd(tvl)}
          provenance={s?.liquidity.provenance}
          ts={s?.liquidity.last_verified}
          notes={s?.liquidity.notes}
        />
        <Kpi
          label="30d volume"
          value={fmtUsd(s?.volume_30d_usd.value ?? null)}
          provenance={s?.volume_30d_usd.provenance}
          ts={s?.volume_30d_usd.last_verified}
          notes={s?.volume_30d_usd.notes}
        />
        <Kpi
          label="Median spread"
          value={fmtPct(s?.observed_spread_bps.value ?? null)}
          provenance={s?.observed_spread_bps.provenance}
          ts={s?.observed_spread_bps.last_verified}
          notes={s?.observed_spread_bps.notes}
          sub={s ? `n=${s.observed_spread_bps.sample_size} · ${s.observed_spread_bps.spread_aggregation}` : undefined}
        />
        <Kpi
          label="KYC requirement"
          value={y.pii_floor ?? '—'}
          provenance="manual"
          sub={y.kyc_tiers?.length ? `${y.kyc_tiers.length} tier${y.kyc_tiers.length > 1 ? 's' : ''}` : undefined}
        />
      </div>

      {/* Coverage — prefers live snapshot.coverage when present (zkp2p) */}
      <section className="section">
        <h2>
          Coverage
          {s?.coverage ? (
            <>
              {' '}
              <span
                className="dot"
                style={{ background: provenanceColor(s.coverage.provenance) }}
                title={`${provenanceLabel(s.coverage.provenance)} · ${fmtRelTime(s.coverage.last_verified)}`}
              />
            </>
          ) : null}
        </h2>
        <dl className="kv">
          <dt>Fiats</dt>
          <dd>
            {s?.coverage?.value.fiats.length
              ? `${s.coverage.value.fiats.join(', ')} (${s.coverage.value.fiats.length})`
              : y.fiats.join(', ')}
          </dd>
          <dt>Assets</dt>
          <dd>{y.assets.map((a) => `${a.symbol} (${a.chain})`).join(', ') || '—'}</dd>
          <dt>Payment platforms</dt>
          <dd>
            {s?.coverage?.value.platforms.length
              ? `${s.coverage.value.platforms.join(', ')} (${s.coverage.value.platforms.length})`
              : y.payment_methods?.join(', ') ?? '—'}
          </dd>
          <dt>Delivery chains</dt>
          <dd>{y.delivery_chains?.length ? y.delivery_chains.join(', ') : '—'}</dd>
          {s?.coverage ? (
            <>
              <dt>Active markets</dt>
              <dd>
                {s.coverage.value.active_markets ?? '—'}{' '}
                <span className="muted">
                  · {s.coverage.value.active_deposits ?? '—'} active deposits
                </span>
              </dd>
              <dt>Active makers / takers ({s.coverage.value.window})</dt>
              <dd>
                {s.coverage.value.active_makers_window ?? '—'} makers ·{' '}
                {s.coverage.value.active_takers_window ?? '—'} takers
              </dd>
            </>
          ) : null}
          <dt>Countries supported</dt>
          <dd>
            {y.countries_supported?.length ? (
              y.countries_supported.join(', ')
            ) : (
              <span className="muted">— (constrained by available payment platforms)</span>
            )}
          </dd>
        </dl>
      </section>

      {/* Composition — currency + payment platform mix */}
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

      {/* Live orderbook link — zkp2p-only for now */}
      {y.id === 'zkp2p' ? (
        <section className="section">
          <h2>Live orderbook</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Browse live deposits across currencies and payment platforms with filtering.
          </p>
          <Link href={`/products/${y.id}/orderbook`} className="cta-link">
            View live orderbook →
          </Link>
        </section>
      ) : null}

      {/* Pricing */}
      <section className="section">
        <h2>Pricing</h2>
        {s?.fee_snapshot.sample_rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fiat</th>
                  <th>Asset</th>
                  <th>Payment method</th>
                  <th>Effective rate</th>
                  <th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                {s.fee_snapshot.sample_rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.fiat}</td>
                    <td>{r.asset}</td>
                    <td className="mono">{r.payment_method}</td>
                    <td className="mono">{fmtPct(r.effective_rate_bps)}</td>
                    <td>
                      <span className="dot" style={{ background: provenanceColor(s.fee_snapshot.provenance) }} />{' '}
                      <span className="muted" style={{ fontSize: 11 }}>
                        {provenanceLabel(s.fee_snapshot.provenance)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No live sample rows. {y.pricing?.pricing_endpoint ? 'Live quotes available via the pricing endpoint.' : 'Pricing is RFQ — no public feed.'}</p>
        )}
        <dl className="kv" style={{ marginTop: 16 }}>
          <dt>Spread method</dt>
          <dd>{y.pricing?.spread_method ?? '—'}</dd>
          {y.pricing?.pricing_endpoint ? (
            <>
              <dt>Pricing endpoint</dt>
              <dd className="mono" style={{ wordBreak: 'break-all' }}>
                <a href={y.pricing.pricing_endpoint} target="_blank" rel="noreferrer">
                  {y.pricing.pricing_endpoint}
                </a>
              </dd>
            </>
          ) : null}
          {y.pricing?.min_ticket_usd ? (
            <>
              <dt>Min ticket</dt>
              <dd>{fmtUsd(y.pricing.min_ticket_usd)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {/* Trust */}
      <section className="section">
        <h2>Trust</h2>
        <dl className="kv">
          <dt>Open source</dt>
          <dd>
            {y.open_source?.is_open ? (
              y.open_source.repo_url ? (
                <a href={y.open_source.repo_url} target="_blank" rel="noreferrer">
                  {y.open_source.repo_url}
                </a>
              ) : (
                'Yes'
              )
            ) : (
              'No'
            )}
          </dd>
          <dt>Audits</dt>
          <dd>
            {y.audits?.length
              ? y.audits.map((a) => `${a.firm} (${a.date}${a.scope ? `, ${a.scope}` : ''})`).join('; ')
              : <span className="muted">— (not curated yet)</span>}
          </dd>
          <dt>Proof of reserves</dt>
          <dd>
            {y.proof_of_reserves?.exists ? (
              y.proof_of_reserves.url ? (
                <a href={y.proof_of_reserves.url} target="_blank" rel="noreferrer">
                  Yes — {y.proof_of_reserves.url}
                </a>
              ) : (
                'Yes'
              )
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
          <dt>Team transparency</dt>
          <dd>{y.team_transparency ?? '—'}</dd>
          <dt>Address linkage</dt>
          <dd className="mono">{y.address_linkage ?? '—'}</dd>
          <dt>Onchain privacy</dt>
          <dd className="mono">{y.onchain_privacy ?? '—'}</dd>
        </dl>
      </section>

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
    </div>
  );
}

interface KpiProps {
  label: string;
  value: string;
  provenance?: string;
  ts?: number;
  notes?: string;
  sub?: string;
}

function Kpi({ label, value, provenance, ts, notes, sub }: KpiProps) {
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
      <div className="kpi-value mono">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
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
