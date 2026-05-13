// Frontend-side types. Subset/echo of root lib/types.ts to keep web/ self-contained.

/**
 * Where a snapshot field's value came from — or, in the case of `'unavailable'`,
 * an explicit signal that the underlying data is structurally not knowable for this product
 * (e.g. Binance does not publish P2P volume, Kraken OTC has no public quote feed).
 *
 * UI color convention:
 *   green = `onchain` | `api`
 *   yellow = `self_reported`
 *   gray = `manual` | `unavailable`
 *
 * When `provenance: 'unavailable'`, `value` should be `null` and `notes` should explain
 * the reason. The UI renders these fields as "Not disclosed" rather than "—".
 */
export type Provenance = 'onchain' | 'api' | 'self_reported' | 'manual' | 'unavailable';
export type Category = 'cex_p2p' | 'ramp' | 'onchain' | 'otc';
export type Direction = 'on' | 'off' | 'both';
export type SpreadAggregation = 'median' | 'mean' | 'min_top_n' | 'sample' | 'effective_at_size';

export interface Wrapped<T> {
  value: T;
  provenance: Provenance;
  evidence_url?: string;
  last_verified: number;
  notes?: string;
}

export type LiquidityValue =
  | {
      kind: 'p2p_offerbook';
      top_pairs: Array<{ pair: string; sum_offers_usd: number; n_makers: number }>;
      /**
       * Sum of observed escrowed-asset surplus across every probed market — for binance_p2p,
       * this is "USDT depth in top 20 ads × N markets" (USDT ≈ $1, so units ≈ USD).
       * This is the basis for the "Available USDT" KPI. Optional for backward compat with
       * older snapshots that only stored `top_pairs`.
       */
      total_observed_usd?: number;
      /** Number of fiat markets that contributed at least one ad to the sum. */
      markets_observed?: number;
    }
  | {
      kind: 'ramp_capacity';
      fiat: Record<string, { single_tx_max: number; daily_max: number }>;
    }
  | {
      kind: 'onchain_inventory';
      tvl_usd: number;
      active_makers_30d: number;
      contract_addrs: string[];
    }
  | { kind: 'otc_minimum'; usd: number };

export interface FeeSampleRow {
  fiat: string;
  asset: string;
  payment_method: string;
  effective_rate_bps: number;
}

export interface Coverage {
  fiats: string[];
  /**
   * Fiats the product structurally supports but where it no longer has active liquidity
   * (e.g. Binance P2P market exits: NGN, RUB, KRW, SGD, THB). Distinct from `fiats`,
   * which lists currently-reachable currencies. Surfacing this as a transparency signal
   * is mission-aligned: it tells the reader which markets the product has withdrawn from.
   */
  fiats_inactive?: string[];
  fiat_flags?: Record<string, string>;
  platforms: string[];
  /**
   * Map of fiat ISO → payment-method identifiers available for that fiat.
   * Matches what the product's own UI shows when a user picks a currency
   * (e.g. Binance TND → 13 methods, Binance USD → 175). UI consumers use this
   * to filter the method-picker by selected fiat instead of showing the global set.
   */
  payment_methods_by_fiat?: Record<string, string[]>;
  currencies_by_platform?: Record<string, string[]>;
  active_markets?: number;
  active_makers_window?: number;
  active_takers_window?: number;
  active_deposits?: number;
  window?: string;
}

export interface CompositionItem {
  key: string;
  label: string;
  volume_usd: number;
  share_pct: number;
  fulfilled_intents: number;
}

export interface Composition {
  platforms: CompositionItem[];
  currencies: CompositionItem[];
  period: string;
}

export interface Market {
  currency: string;
  platform: string;
  best_rate: number;
  fx_mid_rate: number;
  spread_bps: number;
  total_liquidity_usd: number;
  /**
   * Generic "unit count" for this market — represents deposits for zkp2p (the count of
   * onchain deposit orders at the best rate) and ads for binance_p2p (the total ad count
   * Binance reports, not just the sampled top-N).
   */
  deposit_count: number;
  /**
   * Distinct makers observed in the sampled slice for this market. Optional because zkp2p
   * doesn't currently populate it; binance_p2p does.
   */
  n_makers?: number;
}

/**
 * Declares which interactive subpages a product surfaces in the UI.
 * Drives the tab nav: when any capability is `true`, the product page renders tabs
 * (Overview / Orderbook / Get a Quote). When all are `false` (or `capabilities` is absent),
 * the product gets a single Overview page with no tab strip.
 *
 * A capability should only be `true` when BOTH (a) the adapter can produce the data, and
 * (b) the web app has a route to render it (e.g. `web/app/api/{id}/quote/route.ts`).
 */
export interface Capabilities {
  orderbook: boolean;
  quote: boolean;
}

export interface NetworkHealth {
  median_fill_seconds?: number;
  avg_fill_seconds?: number;
  success_rate_pct?: number;
  top_maker_share_pct?: number;
  top_platform_share_pct?: number;
  top_platform_label?: string;
  top_currency_share_pct?: number;
  top_currency_label?: string;
}

export interface Snapshot {
  liquidity: Wrapped<LiquidityValue>;
  volume_30d_usd: Wrapped<number | null>;
  observed_spread_bps: Wrapped<number | null> & {
    spread_aggregation: SpreadAggregation;
    sample_size: number;
    period: string;
  };
  fee_snapshot: {
    ts: number;
    sample_rows: FeeSampleRow[];
    provenance: Provenance;
  };
  coverage?: Wrapped<Coverage>;
  composition?: Wrapped<Composition>;
  markets?: Wrapped<Market[]>;
  network_health?: Wrapped<NetworkHealth>;
  capabilities?: Capabilities;
}

export interface ProductYaml {
  id: string;
  name: string;
  display_name?: string;
  category: Category;
  subcategory?: string;
  website: string;
  links?: {
    website?: string;
    twitter?: string;
    docs?: string;
    github?: string;
    telegram?: string;
    discord?: string;
  };
  logo?: string;
  description?: string;
  launched?: string;
  legal_entity?: string;
  licenses?: Array<{ jurisdiction: string; type: string; url?: string }>;
  contracts?: Array<{ chain: string; address: string }>;
  direction: Direction;
  countries_supported?: string[];
  fiats: string[];
  assets: Array<{ symbol: string; chain: string }>;
  payment_methods?: string[];
  payment_methods_by_country?: Record<string, string[]>;
  delivery_chains?: string[];
  kyc_tiers?: Array<{
    name: string;
    requirements: string[];
    min?: number | null;
    max?: number | null;
    period?: string;
  }>;
  non_kyc_available?: boolean;
  pii_floor?: 'none' | 'email' | 'id' | 'id+poa' | 'enhanced';
  pricing?: {
    spread_method?: 'none' | 'vs_mid' | 'vs_oracle' | 'marketmaker_quote';
    pricing_endpoint?: string;
    min_ticket_usd?: number;
  };
  settlement_time?: { value?: Record<string, string>; provenance?: Provenance; last_verified?: string };
  chargeback_protection?: boolean;
  delivery_custody: 'self' | 'hosted' | 'either';
  requires_account?: boolean;
  wallet_setup_required?: boolean;
  audits?: Array<{ firm: string; date: string; scope?: string; url?: string }>;
  open_source?: { is_open: boolean; repo_url?: string };
  proof_of_reserves?: { exists?: boolean; url?: string; last_updated?: string };
  team_transparency?: 'public' | 'partial' | 'pseudonymous' | 'anonymous';
  integration_types?: Array<'widget' | 'rest_api' | 'sdk' | 'hosted_checkout' | 'smart_contract' | 'none'>;
  sdks?: Array<{ platform: string; url?: string }>;
  kyc_inheritance?: 'none' | 'partial' | 'full';
  white_label?: 'yes' | 'no' | 'not_applicable';
  webhooks?: boolean;
  sandbox?: boolean;
  docs_url?: string;
  integrator_fee_model?: string | { type: string; details?: string };
  address_linkage?: 'none' | 'internal' | 'shared_with_partners' | 'onchain_attestation';
  third_party_sharing?: { shares?: boolean; partners?: string[] };
  onchain_privacy?: 'none' | 'zk_proof' | 'encrypted';
}

export interface Product {
  yaml: ProductYaml;
  snapshot?: Snapshot;
}
