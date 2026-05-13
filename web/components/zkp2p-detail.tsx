import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Product } from '@/lib/types';
import type { DailyPoint } from '@/lib/data';
import {
  fmtRelTime,
  fmtUsd,
  provenanceColor,
  provenanceLabel,
} from '@/lib/format';
import ProtocolCharts from './protocol-charts';
import { KycBadges } from './chips';

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

function shortAddr(a: string): string {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
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

function fmtPctNum(n: number | undefined, digits = 1): string {
  if (n == null) return '—';
  return `${n.toFixed(digits)}%`;
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

  const contract = y.contracts?.[0];
  const contractHref = contract
    ? `https://basescan.org/address/${contract.address}`
    : null;

  return (
    <>
      {/* Newcomer intro */}
      <section className="protocol-intro">
        <p>
          <strong>Peer</strong> is a permissionless, privacy-focused ramp for fiat ↔ crypto swaps on Base.
          Makers lock USDC and quote rates; takers signal intent, pay the maker via payment method.
          USDC is unlocked to the Taker upon successful payment proof submission via the Peer extension.
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
          label="Custody type"
          value={y.delivery_custody === 'self' ? 'Self-custodial' : y.delivery_custody}
          provenance="manual"
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
          {/* Protocol Properties */}
          <div className="info-card">
            <div className="info-title">Protocol Properties</div>
            <dl className="info-kv">
              <dt>Category</dt>
              <dd>Onchain P2P</dd>
              <dt>Direction</dt>
              <dd>On-ramp only</dd>
              <dt>Custody</dt>
              <dd>Self-custodial</dd>
              <dt>Pricing</dt>
              <dd>Marketmaker quote · Chainlink oracle</dd>
              <dt>Settlement</dt>
              <dd>USDC on Base</dd>
              <dt>Live since</dt>
              <dd>{y.launched ?? '—'}</dd>
              <dt>Contract</dt>
              <dd>
                {contract ? (
                  <a className="mono" href={contractHref!} target="_blank" rel="noreferrer">
                    {shortAddr(contract.address)} ↗
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </div>

          {/* Coverage — supported things (fiats / platforms) */}
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
                {cov?.fiats?.length ?? '—'}
                {cov?.fiats?.length ? (
                  <div className="fiat-grid">
                    {cov.fiats.map((f) => (
                      <FiatChip key={f} code={f} flag={cov.fiat_flags?.[f]} />
                    ))}
                  </div>
                ) : null}
              </dd>
              <dt>Payment platforms</dt>
              <dd>
                {cov?.platforms?.length ?? '—'}
                {cov?.platforms?.length ? (
                  <div className="platform-grid">
                    {cov.platforms.map((p) => (
                      <PlatformChip key={p} name={p} />
                    ))}
                  </div>
                ) : null}
              </dd>
            </dl>
          </div>

          {/* Classification */}
          <div className="info-card">
            <div className="info-title">Classification</div>
            <div className="badge-grid">
              <Badge state="ok" title="Self Custody" desc="USDC lands directly in the user's own wallet" />
              <Badge
                state={y.non_kyc_available ? 'ok' : 'warn'}
                title="No KYC"
                desc="Protocol layer requires no PII; payment-platform KYC is out of scope"
              />
              <Badge
                state={y.open_source?.is_open ? 'ok' : 'warn'}
                title="Open Source"
                desc={y.open_source?.repo_url ?? 'Public source code'}
              />
              <Badge
                state={y.onchain_privacy === 'zk_proof' ? 'ok' : 'warn'}
                title="Onchain Settlement"
                desc="Trades settle on Base; zk proof attests payment without revealing identity"
              />
            </div>
          </div>

          {/* Network Health — execution quality + activity counts */}
          <div className="info-card">
            <div className="info-title">
              Network Health
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
              <dt>Spread (~$1k)</dt>
              <dd
                className="mono"
                style={{
                  color:
                    s?.observed_spread_bps.value != null
                      ? spreadColor(s.observed_spread_bps.value)
                      : 'var(--fg)',
                }}
              >
                {s?.observed_spread_bps.value != null
                  ? fmtSpreadPct(s.observed_spread_bps.value)
                  : '—'}
              </dd>
              <dt>Median fill time</dt>
              <dd className="mono">{fmtSeconds(health?.median_fill_seconds)}</dd>
              <dt>Avg fill time</dt>
              <dd className="mono">{fmtSeconds(health?.avg_fill_seconds)}</dd>
              <dt>Top platform</dt>
              <dd className="mono">
                {health?.top_platform_label ? platformLabel(health.top_platform_label) : '—'}{' '}
                <span className="muted">
                  {health?.top_platform_share_pct != null
                    ? `(${fmtPctNum(health.top_platform_share_pct)})`
                    : ''}
                </span>
              </dd>
              <dt>Top currency</dt>
              <dd className="mono">
                {health?.top_currency_label ?? '—'}{' '}
                <span className="muted">
                  {health?.top_currency_share_pct != null
                    ? `(${fmtPctNum(health.top_currency_share_pct)})`
                    : ''}
                </span>
              </dd>
              <dt>Active markets</dt>
              <dd className="mono">{cov?.active_markets?.toLocaleString() ?? '—'}</dd>
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

      {/* Composition */}
      {composition && (composition.currencies.length || composition.platforms.length) ? (
        <section className="section">
          <h2>
            Composition{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {composition.period}</span>
          </h2>
          <div className="composition-grid">
            <MixBar title="By fiat currency" items={composition.currencies} flagsByCode={cov?.fiat_flags} />
            <MixBar title="By payment platform" items={composition.platforms} usePlatformLogo />
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

interface MixItem {
  key: string;
  label: string;
  volume_usd: number;
  share_pct: number;
  fulfilled_intents: number;
}

function MixBar({
  title,
  items,
  flagsByCode,
  usePlatformLogo,
}: {
  title: string;
  items: MixItem[];
  flagsByCode?: Record<string, string>;
  usePlatformLogo?: boolean;
}) {
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
            <div className="mix-label">
              {usePlatformLogo ? (
                <PlatformChip name={it.label} />
              ) : flagsByCode ? (
                <FiatChip code={it.label} flag={flagsByCode[it.label]} />
              ) : (
                platformLabel(it.label)
              )}
            </div>
            <div className="mix-bar-wrap">
              <div className="mix-bar" style={{ width: `${Math.min(100, it.share_pct).toFixed(2)}%` }} />
            </div>
            <div className="mix-pct mono">{it.share_pct.toFixed(1)}%</div>
            <div className="mix-vol mono muted">{fmtUsd(it.volume_usd)}</div>
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
