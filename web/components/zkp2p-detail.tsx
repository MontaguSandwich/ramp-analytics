import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Product } from '@/lib/types';
import type { DailyPoint } from '@/lib/data';
import {
  fmtPct,
  fmtRelTime,
  fmtUsd,
  provenanceColor,
  provenanceLabel,
  spreadKpiSub,
} from '@/lib/format';
import ProtocolCharts from './protocol-charts';
import { KycBadges } from './chips';
import CoverageCard from './coverage-card';
import PropertiesCard from './properties-card';
import MixBar from './mix-bar';

interface Props {
  product: Product;
  history: DailyPoint[];
}

const PLATFORM_LABEL_CASE: Record<string, string> = {
  cashapp: 'Cash App',
  paypal: 'PayPal',
  pay_pal: 'PayPal',
  n26: 'N26',
};

// simpleicons.org slug map for known platforms (CDN: cdn.simpleicons.org/{slug})
const PLATFORM_LOGO_SLUG: Record<string, string> = {
  venmo: 'venmo',
  paypal: 'paypal',
  'pay_pal': 'paypal',
  revolut: 'revolut',
  wise: 'wise',
  monzo: 'monzo',
  cashapp: 'cashapp',
  'cash app': 'cashapp',
  zelle: 'zelle',
  chime: 'chime',
  n26: 'n26',
  // luxon and mercado pago don't have simpleicons entries we can rely on; fallback to letter chip
};

function platformLabel(p: string): string {
  const k = p.toLowerCase().replace(/\s+/g, '');
  return PLATFORM_LABEL_CASE[k] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

function platformLogoSlug(p: string): string | null {
  return PLATFORM_LOGO_SLUG[p.toLowerCase()] ?? PLATFORM_LOGO_SLUG[p.toLowerCase().replace(/\s+/g, '')] ?? null;
}

function spreadColor(bps: number): string {
  if (bps < -25) return 'var(--prov-good)';
  if (bps > 25) return 'var(--warn)';
  return 'var(--fg-mute)';
}

function fmtSpreadPct(bps: number): string {
  if (!Number.isFinite(bps)) return '—';
  const pct = bps / 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function fmtSeconds(s: number | undefined): string {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export default function Zkp2pDetail({ product, history }: Props) {
  const y = product.yaml;
  const s = product.snapshot;
  const liq = s?.liquidity.value;
  const tvl = liq?.kind === 'onchain_inventory' ? liq.tvl_usd : null;
  const cov = s?.coverage?.value;
  const composition = s?.composition?.value;
  const marketsAll = s?.markets?.value ?? [];
  const health = s?.network_health?.value;

  // Group markets by currency (one row per currency).
  const marketsByCurrency = (() => {
    const grouped = new Map<
      string,
      {
        currency: string;
        best_rate: number;
        best_spread_bps: number;
        fx_mid_rate: number;
        total_liquidity_usd: number;
        deposit_count: number;
        platforms: Set<string>;
      }
    >();
    for (const m of marketsAll) {
      const cur = grouped.get(m.currency);
      if (!cur) {
        grouped.set(m.currency, {
          currency: m.currency,
          best_rate: m.best_rate,
          best_spread_bps: m.spread_bps,
          fx_mid_rate: m.fx_mid_rate,
          total_liquidity_usd: m.total_liquidity_usd,
          deposit_count: m.deposit_count,
          platforms: new Set([m.platform]),
        });
      } else {
        if (m.spread_bps < cur.best_spread_bps) {
          cur.best_spread_bps = m.spread_bps;
          cur.best_rate = m.best_rate;
        }
        cur.total_liquidity_usd += m.total_liquidity_usd;
        cur.deposit_count += m.deposit_count;
        cur.platforms.add(m.platform);
      }
    }
    return [...grouped.values()].sort((a, b) => a.best_spread_bps - b.best_spread_bps);
  })();

  const links = y.links ?? {};
  const linkBar: Array<{ key: string; href: string; label: string }> = [];
  if (links.website ?? y.website) linkBar.push({ key: 'website', href: links.website ?? y.website, label: 'Website' });
  if (links.twitter) linkBar.push({ key: 'twitter', href: links.twitter, label: 'X' });
  if (links.docs ?? y.docs_url) linkBar.push({ key: 'docs', href: links.docs ?? y.docs_url!, label: 'Docs' });
  if (links.github ?? y.open_source?.repo_url) linkBar.push({ key: 'github', href: links.github ?? y.open_source!.repo_url!, label: 'GitHub' });
  if (links.telegram) linkBar.push({ key: 'telegram', href: links.telegram, label: 'Telegram' });
  if (links.discord) linkBar.push({ key: 'discord', href: links.discord, label: 'Discord' });

  const displayName = y.display_name ?? y.name;
  const altName = y.display_name && y.display_name !== y.name ? y.name : null;

  return (
    <>
      {/* Newcomer intro */}
      <section className="protocol-intro">
        <p>
          <strong>Peer</strong> is a permissionless, privacy-focused ramp for fiat ↔ crypto swaps on Base.
          Makers lock USDC and quote rates; takers signal intent, pay the maker via preferred payment method.
          USDC is unlocked to the Taker upon successful payment proof submission.
        </p>
      </section>

      {/* KPI strip */}
      <div className="kpi-grid">
        <Kpi
          label="Available liquidity"
          value={fmtUsd(tvl)}
          provenance={s?.liquidity.provenance}
          ts={s?.liquidity.last_verified}
        />
        <Kpi
          label="30d volume"
          value={fmtUsd(s?.volume_30d_usd.value ?? null)}
          provenance={s?.volume_30d_usd.provenance}
          ts={s?.volume_30d_usd.last_verified}
        />
        <Kpi
          label="Spread (~$1k)"
          value={fmtPct(s?.observed_spread_bps.value ?? null)}
          provenance={s?.observed_spread_bps.provenance}
          ts={s?.observed_spread_bps.last_verified}
          sub={s ? spreadKpiSub(s.observed_spread_bps) : undefined}
        />
        <Kpi
          label="KYC requirement"
          value={<KycBadges pii={y.pii_floor} />}
          provenance="manual"
          sub={y.non_kyc_available ? 'Protocol-layer non-KYC' : undefined}
        />
      </div>

      {/* Charts */}
      {history.length > 0 ? (
        <section className="section">
          <ProtocolCharts points={history} />
        </section>
      ) : null}

      {/* Info cards 2x2 */}
      <section className="section">
        <div className="info-grid">
          {/* Venue Properties — shared with GenericDetail. Custody / Settlement
              live in the Classification card; the bespoke "Marketmaker quote ·
              Chainlink oracle" pricing label is now driven from yaml.pricing. */}
          <PropertiesCard yaml={y} snapshot={s} />

          {/* Coverage — fiats, settlement assets, payment methods.
              Shared with GenericDetail (binance / ramp / kraken) so both layouts
              get the same long-list browser UX (CountBrowser + ⓘ toggle + search). */}
          <CoverageCard yaml={y} snapshot={s} />

          {/* Classification */}
          <div className="info-card">
            <div className="info-title">Classification</div>
            <div className="badge-grid">
              <Badge state="ok" title="Self Custody" desc="USDC lands directly in the user's own wallet" />
              <Badge
                state={y.non_kyc_available ? 'ok' : 'warn'}
                title="No KYC"
                desc="Venue requires no PII; payment-platform KYC is out of scope"
              />
              <Badge
                state={y.open_source?.is_open ? 'ok' : 'warn'}
                title="Open Source"
                desc={y.open_source?.repo_url ?? 'Public source code'}
              />
              <Badge
                state={y.onchain_privacy === 'zk_proof' ? 'ok' : 'warn'}
                title="Settlement"
                desc="Trades settle onchain; zk proofs attests payment without manual approval from counterparty"
              />
            </div>
          </div>

          {/* Network Health — execution quality + activity counts */}
          <div className="info-card">
            <div className="info-title">
              Marketplace dynamics
              {s?.network_health ? (
                <span
                  className="dot"
                  title={`${provenanceLabel(s.network_health.provenance)} · ${fmtRelTime(s.network_health.last_verified)}`}
                  style={{
                    background: provenanceColor(s.network_health.provenance),
                    marginLeft: 6,
                  }}
                />
              ) : null}
            </div>
            <dl className="info-kv">
              <dt>Median fill time</dt>
              <dd className="mono">{fmtSeconds(health?.median_fill_seconds)}</dd>
              <dt>Avg fill time</dt>
              <dd className="mono">{fmtSeconds(health?.avg_fill_seconds)}</dd>
              <dt>Active makers (30d)</dt>
              <dd className="mono">{cov?.active_makers_window?.toLocaleString() ?? '—'}</dd>
              <dt>Active takers (30d)</dt>
              <dd className="mono">{cov?.active_takers_window?.toLocaleString() ?? '—'}</dd>
              <dt>Active deposits</dt>
              <dd className="mono">{cov?.active_deposits?.toLocaleString() ?? '—'}</dd>
            </dl>
          </div>
        </div>
      </section>

      {/* Live rates table — grouped per currency */}
      {marketsByCurrency.length > 0 ? (
        <section className="section">
          <h2>
            Live rates{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              · {marketsByCurrency.length} active currencies
            </span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Currency</th>
                  <th>Best rate</th>
                  <th>Best spread</th>
                  <th>Liquidity</th>
                  <th>Deposits</th>
                  <th>Platforms</th>
                </tr>
              </thead>
              <tbody>
                {marketsByCurrency.map((m) => (
                  <tr key={m.currency}>
                    <td>
                      <FiatChip code={m.currency} flag={cov?.fiat_flags?.[m.currency]} />
                    </td>
                    <td className="mono">{m.best_rate.toFixed(4)}</td>
                    <td
                      className="mono"
                      style={{ color: spreadColor(m.best_spread_bps), fontWeight: 500 }}
                    >
                      {fmtSpreadPct(m.best_spread_bps)}
                    </td>
                    <td className="mono">{fmtUsd(m.total_liquidity_usd)}</td>
                    <td className="mono">{m.deposit_count}</td>
                    <td>
                      <div className="platform-row">
                        {[...m.platforms].slice(0, 6).map((p) => (
                          <PlatformChip key={p} name={p} compact />
                        ))}
                        {m.platforms.size > 6 ? (
                          <span className="muted" style={{ fontSize: 11 }}>+{m.platforms.size - 6}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, margin: '8px 4px' }}>
            One row per currency · sorted by best (most-favorable) spread.{' '}
            <Link href={`/products/${y.id}/orderbook`} className="cta-link" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}>
              Live orderbook →
            </Link>
          </div>
        </section>
      ) : null}

      {/* Market mix — historical 30d volume share. Same widget as binance's depth-based
          Market mix but with volume semantics; sub-text differentiates. */}
      {composition && (composition.currencies.length || composition.platforms.length) ? (
        <section className="section">
          <h2>
            Fiat and Payment Methods stats{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {composition.period}</span>
          </h2>
          <div className="composition-grid">
            <MixBar
              title="By fiat currency"
              items={composition.currencies.map((c) => ({
                key: c.key,
                label: c.label,
                amount_usd: c.volume_usd,
                share_pct: c.share_pct,
              }))}
              renderLabel={(it) => <FiatChip code={it.label} flag={cov?.fiat_flags?.[it.label]} />}
            />
            <MixBar
              title="By payment platform"
              items={composition.platforms.map((p) => ({
                key: p.key,
                label: p.label,
                amount_usd: p.volume_usd,
                share_pct: p.share_pct,
              }))}
              renderLabel={(it) => <PlatformChip name={it.label} />}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}

interface KpiProps {
  label: string;
  // ReactNode so callers can pass badges / JSX (e.g. KycBadges) instead of plain text.
  value: ReactNode;
  provenance?: string;
  ts?: number;
  sub?: string;
}

function Kpi({ label, value, provenance, ts, sub }: KpiProps) {
  // String values → big-mono number style; rich content → compact wrapper that lets
  // the inner content set its own sizing. Matches the GenericDetail Kpi behavior.
  const isRichValue = typeof value !== 'string' && typeof value !== 'number';
  return (
    <div className="kpi">
      <div className="kpi-label">
        {provenance ? (
          <span
            className="dot"
            style={{ background: provenanceColor(provenance as never) }}
            title={`${provenanceLabel(provenance as never)}${ts ? ` · ${fmtRelTime(ts)}` : ''}`}
          />
        ) : null}
        {label}
      </div>
      {isRichValue ? (
        <div className="kpi-value-rich">{value}</div>
      ) : (
        <div className="kpi-value mono">{value}</div>
      )}
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function Badge({
  state,
  title,
  desc,
}: {
  state: 'ok' | 'warn' | 'fail';
  title: string;
  desc: string;
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

function FiatChip({ code, flag }: { code: string; flag?: string }) {
  return (
    <span className="fiat-chip" title={code}>
      {flag ? <span className="fiat-flag">{flag}</span> : null}
      <span className="fiat-code">{code}</span>
    </span>
  );
}

function PlatformChip({ name, compact = false }: { name: string; compact?: boolean }) {
  const slug = platformLogoSlug(name);
  return (
    <span className={`platform-chip${compact ? ' platform-chip-compact' : ''}`} title={platformLabel(name)}>
      {slug ? (
        <img
          src={`https://cdn.simpleicons.org/${slug}/ffffff`}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          className="platform-logo"
        />
      ) : (
        <span className="platform-fallback">{platformLabel(name).charAt(0).toUpperCase()}</span>
      )}
      {compact ? null : <span className="platform-label">{platformLabel(name)}</span>}
    </span>
  );
}

// MixBar extracted to ./mix-bar.tsx — shared with generic-detail.tsx (binance Market mix).
