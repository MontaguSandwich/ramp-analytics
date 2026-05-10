export type Provenance = 'onchain' | 'api' | 'self_reported' | 'manual';
export type Category = 'cex_p2p' | 'ramp' | 'onchain' | 'otc';
export type Direction = 'on' | 'off' | 'both';
export type SpreadAggregation = 'median' | 'mean' | 'min_top_n' | 'sample';
export type ProductId = string;

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

export interface QuoteRequest {
  direction: 'buy' | 'sell';
  amount: number;
  fiat: string;
  asset: string;
  chain: string;
  payment_method: string;
  country?: string;
}

export interface QuoteResponse {
  product_id: ProductId;
  effective_rate_bps: number;
  fee_pct: number;
  estimated_received: number;
  ttl_sec: number;
  source: 'live' | 'snapshot';
  evidence: { kind: 'deposit' | 'quote_endpoint' | 'snapshot'; ref: string };
  notes?: string;
}

export interface DailyPoint {
  day: string;
  volume_usd: number;
  median_spread_bps: number;
  n_trades: number;
  /** Standing balance of free, currently-available liquidity at end of day. */
  liquidity_available_usd?: number;
}

export interface Adapter {
  id: ProductId;
  snapshot(): Promise<Snapshot>;
  quote(req: QuoteRequest): Promise<QuoteResponse | null>;
  history(days: number): Promise<DailyPoint[]>;
}
