// Pure presentational chips shared between server-rendered detail pages and
// client-rendered browser/picker components. No hooks, no event handlers — these
// render the same way regardless of who imports them.

import {
  cryptoIconUrl,
  fiatFlagEmoji,
  paymentMethodLabel,
  paymentMethodLogoSlug,
} from '@/lib/format';
import type { ProductYaml } from '@/lib/types';

export function FiatChip({ code, flag }: { code: string; flag?: string }) {
  // Prefer the explicit `flag` prop (e.g. populated for zkp2p from Peerlytics) and fall
  // back to a programmatic emoji derived from the ISO 4217 code. Works for ~95% of fiats.
  const glyph = flag ?? fiatFlagEmoji(code);
  return (
    <span className="fiat-chip" title={code}>
      <span className="fiat-flag">{glyph}</span>
      <span className="fiat-code">{code}</span>
    </span>
  );
}

export function AssetChip({ symbol, chain }: { symbol: string; chain?: string }) {
  // `cryptoIconUrl` returns null for assets the CDN doesn't have (e.g. FDUSD); we render
  // a text-only chip in that case.
  const iconUrl = cryptoIconUrl(symbol);
  return (
    <span className="asset-chip" title={chain ? `${symbol} on ${chain}` : symbol}>
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          className="asset-logo"
        />
      ) : null}
      <span className="asset-symbol">{symbol}</span>
      {chain ? <span className="asset-chain">{chain}</span> : null}
    </span>
  );
}

export function PaymentChip({ name }: { name: string }) {
  const slug = paymentMethodLogoSlug(name);
  const label = paymentMethodLabel(name);
  return (
    <span className="platform-chip" title={label}>
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
        <span className="platform-fallback" aria-hidden>
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="platform-label">{label}</span>
    </span>
  );
}

/**
 * Glyph-only renderer for payment methods — small logo when available, first-letter
 * fallback circle otherwise. Used inside CountBrowser's popover where labels are hidden.
 */
export function PaymentGlyph({ name }: { name: string }) {
  const slug = paymentMethodLogoSlug(name);
  if (slug) {
    return (
      <img
        src={`https://cdn.simpleicons.org/${slug}/ffffff`}
        alt=""
        width={14}
        height={14}
        loading="lazy"
        className="platform-logo"
      />
    );
  }
  return (
    <span className="platform-fallback" aria-hidden>
      {paymentMethodLabel(name).charAt(0).toUpperCase()}
    </span>
  );
}

// --- KYC badges -------------------------------------------------------------
// Per-product PII floor rendered as a row of dot-coloured pills. Each badge
// represents a category of personal data the venue collects at minimum to use
// the service (independent of higher tier amount-thresholds, which live in
// `yaml.kyc_tiers` and are surfaced separately as the sub-line "N tiers").
//
// Dot colour is intrinsic to the badge type:
//   - Wallet (no PII):       green — only meaningful for `pii_floor: 'none'`
//   - Email:                 orange
//   - ID, Address, Enhanced: red (severity grades downstream)
//
// Cumulative: when ID is required, Email is shown alongside since ID flows
// almost always require email first. Same for id+poa / enhanced.

export type KycKind = 'wallet' | 'email' | 'id' | 'poa' | 'enhanced';

const KYC_BADGE: Record<KycKind, { label: string; color: string }> = {
  wallet: { label: 'Wallet', color: '#34d399' }, // green
  email: { label: 'Email', color: '#f59e0b' }, // orange
  id: { label: 'ID', color: '#ef4444' }, // red
  poa: { label: 'Address', color: '#ef4444' }, // red — proof of address
  enhanced: { label: 'Enhanced', color: '#ef4444' }, // red — source of funds, liveness, etc.
};

export function kycKindsFor(pii: ProductYaml['pii_floor']): KycKind[] {
  if (!pii || pii === 'none') return ['wallet'];
  if (pii === 'email') return ['email'];
  if (pii === 'id') return ['email', 'id'];
  if (pii === 'id+poa') return ['email', 'id', 'poa'];
  if (pii === 'enhanced') return ['email', 'id', 'enhanced'];
  return ['wallet'];
}

export function KycBadges({ pii }: { pii: ProductYaml['pii_floor'] }) {
  const kinds = kycKindsFor(pii);
  return (
    <div className="kyc-badges">
      {kinds.map((k) => {
        const cfg = KYC_BADGE[k];
        return (
          <span key={k} className="kyc-badge" title={cfg.label}>
            <span className="kyc-dot" style={{ background: cfg.color }} />
            <span className="kyc-label">{cfg.label}</span>
          </span>
        );
      })}
    </div>
  );
}
