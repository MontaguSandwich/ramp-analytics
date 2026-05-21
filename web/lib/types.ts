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
export type Category = 'cex_p2p' | 'ramp' | 'onchain' | 'rtpn';
export type Direction = 'on' | 'off' | 'both';
export type SpreadAggregation = 'median' | 'mean' | 'min_top_n' | 'sample' | 'effective_at_size';

export interface Wrapped<T> {
  value: T;
  provenance: Provenance;
  evidence_url?: string;
  last_verified: number;
  notes?: string;
}

// Mirror of root lib/types.ts LiquidityValue. Keep in sync.

export type LiquidityValue =
  | {
      kind: 'p2p_offerbook';
      top_pairs: Array<{ pair: string; sum_offers_usd: number; n_makers: number }>;
      /**
       * Sum of observed escrowed-asset surplus across every probed market — for binance_p2p,
       * this is "USDT depth in up to 100 ads (5-page adaptive) × N markets" (USDT ≈ $1, so units ≈ USD).
       * This is the basis for the "Available USDT" KPI. Optional for backward compat with
       * older snapshots that only stored `top_pairs`.
       */
      total_observed_usd?: number;
      /** Number of fiat markets that contributed at least one ad to the sum. */
      markets_observed?: number;
      /** Largest single-trade ceiling across all observed ads (USD). Drives "Max single trade" in PropertiesCard. */
      max_single_trade_usd?: number;
    }
  | {
      kind: 'ramp_capacity';
      fiat: Record<string, { single_tx_max: number; daily_max: number }>;
      /**
       * USD-equivalent of the per-fiat single-transaction ceiling. Drives the KPI strip
       * for hosted ramps (where summing across fiats without FX is meaningless — DKK +
       * RON + GBP + … is not a real number).
       */
      max_single_trade_usd?: number;
    }
  | {
      kind: 'onchain_inventory';
      tvl_usd: number;
      active_makers_30d: number;
      contract_addrs: string[];
      /** Largest single-trade ceiling — biggest single deposit's available USDC (USD). */
      max_single_trade_usd?: number;
      /** Most-liquid (currency, platform) combination, like binance's top_pairs[0]. */
      deepest_pair?: { pair: string; sum_offers_usd: number };
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

/**
 * "Market mix" sibling for venues that don't publish historical volume — for binance_p2p
 * we surface CURRENT USDT depth per fiat instead of 30d settled volume. Same visual as
 * Composition but honest field naming (`liquidity_usd` ≠ `volume_usd`).
 */
export interface DepthMixItem {
  key: string;
  label: string;
  /** Total liquidity for this market. For bidirectional venues = buy + sell sum. */
  liquidity_usd: number;
  share_pct: number;
  /** Per-direction split (optional). When both populated, the UI renders a dual-bar chart
   *  showing onramp vs offramp depth side-by-side instead of a single combined bar. */
  buy_liquidity_usd?: number;
  sell_liquidity_usd?: number;
  ad_count?: number;
  n_makers?: number;
}

export interface DepthBreakdown {
  currencies: DepthMixItem[];
  /** Human-readable period qualifier rendered as sub-text (e.g. "current snapshot"). */
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
  /**
   * Direction this row represents from the taker's perspective. 'buy' = taker pays fiat,
   * receives crypto (onramp). 'sell' = taker sends crypto, receives fiat (offramp).
   * Optional for backward compat with single-direction snapshots.
   */
  direction?: 'buy' | 'sell';
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
  // zkp2p-flavored (observed from on-chain trade events over a 30d window)
  median_fill_seconds?: number;
  avg_fill_seconds?: number;
  success_rate_pct?: number;
  top_maker_share_pct?: number;
  top_platform_share_pct?: number;
  top_platform_label?: string;
  top_currency_share_pct?: number;
  top_currency_label?: string;
  // Binance-flavored (aggregated from per-advertiser fields in the live ad probe).
  // Snapshot, not windowed: "active" here means "posting an ad right now in our sample".
  active_makers?: number;
  active_ads?: number;
  /** Mean of advertiser.monthFinishRate across distinct makers in sample, 0–100 scale. */
  avg_maker_month_finish_rate_pct?: number;
  /** Mean of advertiser.monthOrderCount across distinct makers in sample. */
  avg_maker_month_order_count?: number;
  /** % of distinct makers whose userType is 'merchant'. */
  merchant_share_pct?: number;
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
  /** For venues without historical volume — surfaces current liquidity-per-market. */
  depth_composition?: Wrapped<DepthBreakdown>;
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
    /**
     * Profit/cost layers in the venue's pricing model. Rendered as pills in PropertiesCard.
     * - 'maker_quote': a counterparty (not the venue) sets the rate
     * - 'venue_quote': the venue itself sets the rate (spread intrinsic)
     * - 'venue_fee':   venue takes a separate, itemized commission on top of a maker price
     * 'maker_quote' and 'venue_quote' are mutually exclusive in practice; 'venue_fee' is additive.
     */
    layers?: Array<'maker_quote' | 'venue_quote' | 'venue_fee'>;
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
