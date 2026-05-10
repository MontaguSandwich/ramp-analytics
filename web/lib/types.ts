// Frontend-side types. Subset/echo of root lib/types.ts to keep web/ self-contained.

export type Provenance = 'onchain' | 'api' | 'self_reported' | 'manual';
export type Category = 'cex_p2p' | 'ramp' | 'onchain' | 'otc';
export type Direction = 'on' | 'off' | 'both';
export type SpreadAggregation = 'median' | 'mean' | 'min_top_n' | 'sample';

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
  fiat_flags?: Record<string, string>;
  platforms: string[];
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
  deposit_count: number;
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
