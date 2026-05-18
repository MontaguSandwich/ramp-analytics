import type { Provenance, Snapshot } from './types';

/**
 * UI labels for the `Category` enum. The raw enum values are slugs (e.g. `cex_p2p`);
 * these are the human-readable labels shown in tags, headers, and tables.
 *
 * Note: `onchain` is rendered as "Onchain P2P" per the CLAUDE.md locked decision.
 */
export const CATEGORY_LABEL: Record<string, string> = {
  onchain: 'Onchain P2P',
  cex_p2p: 'CEX P2P',
  ramp: 'Ramps',
  rtpn: 'RTPNs',
};

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function fmtBps(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(0)} bps`;
}

/**
 * Pretty-print a blockchain id from its lowercase yaml form to the human-readable name.
 * Falls back to capitalizing the first letter for unknown chains.
 */
const CHAIN_LABEL: Record<string, string> = {
  ethereum: 'Ethereum',
  bitcoin: 'Bitcoin',
  base: 'Base',
  polygon: 'Polygon',
  polygonzkevm: 'Polygon zkEVM',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  solana: 'Solana',
  avalanche: 'Avalanche',
  bsc: 'BSC',
  tron: 'Tron',
  zksyncera: 'zkSync Era',
  starknet: 'StarkNet',
  linea: 'Linea',
  ronin: 'Ronin',
  near: 'NEAR',
  celo: 'Celo',
  moonbeam: 'Moonbeam',
  hedera: 'Hedera',
  cosmos: 'Cosmos',
  worldchain: 'World Chain',
};
export function prettifyChain(chain: string): string {
  const k = chain.toLowerCase();
  return CHAIN_LABEL[k] ?? chain.charAt(0).toUpperCase() + chain.slice(1);
}

/**
 * Format a value as a currency in the given ISO 4217 code (no decimals).
 * Falls back to "N CODE" for codes Intl.NumberFormat doesn't recognise.
 */
export function fmtFiat(value: number, fiat: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: fiat,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${fiat}`;
  }
}

export function fmtPct(bps: number | null | undefined): string {
  if (bps == null) return '—';
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Sub-line text for the Spread KPI. Translates the wire-format `period` into
 * something a user can parse — "$1k USD/USDT · single match" for binance,
 * "$1k USD/USDC · N levels" for zkp2p — instead of the raw aggregation string.
 * Shared by GenericDetail and Zkp2pDetail so the two layouts stay in sync.
 */
export function spreadKpiSub(s: Snapshot['observed_spread_bps']): string {
  if (s.spread_aggregation === 'effective_at_size') {
    if (s.period.includes('usdt')) return '$1k USD/USDT · single match';
    if (s.period.includes('usdc')) return `$1k USD/USDC · ${s.sample_size} level${s.sample_size === 1 ? '' : 's'}`;
    return '$1k USD';
  }
  return `n=${s.sample_size} · ${s.spread_aggregation}`;
}

export function fmtRelTime(ts: number | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function provenanceColor(p: Provenance): string {
  if (p === 'onchain' || p === 'api') return 'var(--prov-good)';
  if (p === 'self_reported') return 'var(--prov-mid)';
  // 'manual' and 'unavailable' both render gray.
  return 'var(--prov-low)';
}

export function provenanceLabel(p: Provenance): string {
  switch (p) {
    case 'onchain':
      return 'Onchain';
    case 'api':
      return 'API';
    case 'self_reported':
      return 'Self-reported';
    case 'manual':
      return 'Curator';
    case 'unavailable':
      return 'Not disclosed';
  }
}

export function rowProvenance(snap: Snapshot | undefined): Provenance {
  if (!snap) return 'manual';
  // Worst-case provenance across the snapshot's volatile fields.
  // 'unavailable' sits at the worst end — if any field is structurally undisclosed,
  // the row's overall dot reflects that.
  const order: Provenance[] = ['onchain', 'api', 'self_reported', 'manual', 'unavailable'];
  const items: Provenance[] = [
    snap.liquidity.provenance,
    snap.volume_30d_usd.provenance,
    snap.observed_spread_bps.provenance,
    snap.fee_snapshot.provenance,
  ];
  return items.reduce((worst, p) => (order.indexOf(p) > order.indexOf(worst) ? p : worst), 'onchain' as Provenance);
}

export function snapshotTvlUsd(snap: Snapshot | undefined): number | null {
  if (!snap) return null;
  const v = snap.liquidity.value;
  if (v.kind === 'onchain_inventory') return v.tvl_usd;
  if (v.kind === 'p2p_offerbook') {
    // Prefer the broader `total_observed_usd` sum (across every probed market) when the
    // adapter populated it. Fall back to summing `top_pairs` (top 10) for older snapshots.
    return (
      v.total_observed_usd ??
      v.top_pairs.reduce((a, b) => a + b.sum_offers_usd, 0)
    );
  }
  if (v.kind === 'ramp_capacity') {
    // Use the USD-equivalent single-tx ceiling computed by the adapter. The old
    // implementation summed `single_tx_max` across all fiats without FX conversion —
    // produced nonsense (e.g. DKK 112k + RON 77k + GBP 13k + … all treated as USD).
    return v.max_single_trade_usd ?? null;
  }
  if (v.kind === 'otc_minimum') return v.usd;
  return null;
}

export function bestFeePctOrBps(snap: Snapshot | undefined): { label: string } {
  if (!snap || !snap.fee_snapshot.sample_rows.length) return { label: '—' };
  const min = Math.min(...snap.fee_snapshot.sample_rows.map((r) => r.effective_rate_bps));
  return { label: `${(min / 100).toFixed(2)}%` };
}

// --- Chip iconography helpers ---------------------------------------------

const FIAT_FLAG_OVERRIDES: Record<string, string> = {
  EUR: '🇪🇺',
  XAF: '🌍', // Central African CFA franc
  XOF: '🌍', // West African CFA franc
  XCD: '🏝️', // Eastern Caribbean dollar
  XPF: '🏝️', // CFP franc (Pacific)
};

/**
 * Programmatically derive a flag emoji from an ISO 4217 currency code. For ~95% of codes
 * the first two letters are the ISO 3166-1 alpha-2 country code; we convert those to a
 * pair of Unicode regional indicators which most platforms render as a national flag.
 * Multi-country currencies (EUR, XAF, XOF, etc.) have explicit overrides above.
 * Falls back to a generic 💱 if the code can't be mapped.
 */
export function fiatFlagEmoji(code: string | undefined): string {
  if (!code || code.length < 2) return '💱';
  const upper = code.toUpperCase();
  const override = FIAT_FLAG_OVERRIDES[upper];
  if (override) return override;
  const cc = upper.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(cc)) return '💱';
  const base = 0x1f1e6; // 🇦
  const A = 'A'.charCodeAt(0);
  try {
    return String.fromCodePoint(
      base + (cc.charCodeAt(0) - A),
      base + (cc.charCodeAt(1) - A),
    );
  } catch {
    return '💱';
  }
}

/**
 * Crypto icon URL via the cryptocurrency-icons npm package served through jsDelivr.
 *
 * Gated on a known-good set so we don't render a broken-image element for assets the
 * CDN doesn't have (FDUSD is a notable example — Binance-issued stable not in the icon
 * package). Caller renders a text-only chip when this returns null. The gate is needed
 * because `GenericDetail` is a Server Component — we can't attach an `onError` handler.
 */
const KNOWN_CRYPTO_ICONS = new Set([
  'btc', 'eth', 'usdt', 'usdc', 'bnb', 'sol', 'matic', 'dai', 'wbtc',
  'ada', 'avax', 'doge', 'dot', 'ltc', 'xrp', 'trx', 'arb', 'op',
  'link', 'uni', 'aave', 'shib', 'atom', 'algo',
]);

export function cryptoIconUrl(symbol: string | undefined): string | null {
  if (!symbol) return null;
  const slug = symbol.toLowerCase();
  if (!KNOWN_CRYPTO_ICONS.has(slug)) return null;
  return `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${slug}.svg`;
}

/**
 * Map Binance / zkp2p payment method identifiers to simpleicons CDN slugs. Returns null
 * for unmapped methods — caller should fall back to a first-letter chip. Binance has
 * ~733 unique identifiers in total; most are regional banks without dedicated brand
 * icons. This map covers the ~30 globally-recognized methods.
 *
 * To extend: pick the simpleicons slug from https://simpleicons.org/ and add an entry
 * keyed by the lowercase-no-spaces normalized identifier.
 */
const PAYMENT_METHOD_LOGO_SLUG: Record<string, string> = {
  // Globally-recognized brands
  zelle: 'zelle',
  wise: 'wise',
  revolut: 'revolut',
  monzo: 'monzo',
  n26: 'n26',
  cashapp: 'cashapp',
  cash_app: 'cashapp',
  paypal: 'paypal',
  pay_pal: 'paypal',
  venmo: 'venmo',
  applepay: 'applepay',
  apple_pay: 'applepay',
  googlepay: 'googlepay',
  google_pay: 'googlepay',
  visa: 'visa',
  visadirect: 'visa',
  mastercard: 'mastercard',
  pix: 'pix',
  // Regional brands with simpleicons coverage
  alipay: 'alipay',
  wechatpay: 'wechat',
  wechat: 'wechat',
  bunq: 'bunq',
  postepay: 'postepay',
  gcash: 'gcash',
  paymaya: 'paymaya',
  skrillmoneybookers: 'skrill',
  skrill: 'skrill',
  vipps: 'vipps',
  monobank: 'monobank',
  privatbank: 'privatbank',
};

/**
 * Resolve a payment-method identifier to a simpleicons slug. Returns null if no logo
 * is known — the caller should render a first-letter fallback chip.
 *
 * Matching is case-insensitive and ignores whitespace/punctuation so `"Cash App"`,
 * `"cashapp"`, and `"CASHAPP"` all resolve to the same slug.
 */
export function paymentMethodLogoSlug(name: string | undefined): string | null {
  if (!name) return null;
  const k = name.toLowerCase().replace(/[\s._-]+/g, '');
  return PAYMENT_METHOD_LOGO_SLUG[k] ?? null;
}

/**
 * Pretty-print a payment method identifier. Maps common slugs to their canonical
 * spelling (Cash App, PayPal, etc.); falls back to title-casing the first letter.
 */
const PAYMENT_METHOD_DISPLAY: Record<string, string> = {
  cashapp: 'Cash App',
  cash_app: 'Cash App',
  paypal: 'PayPal',
  pay_pal: 'PayPal',
  applepay: 'Apple Pay',
  apple_pay: 'Apple Pay',
  googlepay: 'Google Pay',
  google_pay: 'Google Pay',
  visadirect: 'Visa Direct',
  wechatpay: 'WeChat Pay',
  alipay: 'Alipay',
  skrillmoneybookers: 'Skrill',
  n26: 'N26',
  sepainstant: 'SEPA Instant',
  sepa_instant: 'SEPA Instant',
  bank: 'Bank transfer',
};

export function paymentMethodLabel(name: string | undefined): string {
  if (!name) return '—';
  const k = name.toLowerCase().replace(/[\s._-]+/g, '');
  return PAYMENT_METHOD_DISPLAY[k] ?? name;
}
