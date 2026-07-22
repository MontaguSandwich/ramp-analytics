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
      /**
       * Sum of observed escrowed-asset surplus across every probed market — for binance_p2p,
       * this is "USDT depth in up to 100 ads (5-page adaptive) × N markets" (USDT ≈ $1, so units ≈ USD).
       * This is the basis for the "Available USDT" KPI. Optional for backward compat with
       * older snapshots that only stored `top_pairs`.
       */
      total_observed_usd?: number;
      /**
       * Escrowed depth priced within N% of the FX mid, BUY side only (real, escrowed
       * capital — see the sell-side note on DepthBreakdown). `pct_5` is the headline
       * "Available USDT" figure: full-book sums include ads priced 30%+ away from mid
       * that can never be filled, so a band is the honest comparable number. ±5% (not
       * DefiLlama's ±2%) because P2P spreads run much wider than CEX order books.
       */
      depth_bands_usd?: { pct_0_5: number; pct_2: number; pct_5: number };
      /**
       * Assets summed into these figures (e.g. ['USDC','USDT']). Explicit rather than
       * inferred from `top_pairs`, which only holds the deepest 10 markets and would
       * under-report the set whenever one asset's books dominate the ranking.
       */
      assets_counted?: string[];
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
  /** Per-direction split (optional). When both populated, the UI renders a dual-bar chart.
   *
   *  ASYMMETRIC BY NATURE — do not sum these or present them as like-for-like:
   *  `buy_liquidity_usd` is real ESCROWED capital (Binance locks the maker's USDT on
   *  sell ads), whereas `sell_liquidity_usd` is unbacked maker BUY *intent* — a maker
   *  can advertise "I'll buy 1,000,000 USDT" with nothing locked. Measured 2026-07-21
   *  at full book depth: USD showed $8.05M escrowed vs $350.79M of intent, a 44x
   *  phantom. The UI labels these "liquidity" and "demand" respectively. */
  buy_liquidity_usd?: number;
  /** Unbacked maker BUY intent — NOT escrowed. Label as "demand", never "liquidity". */
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
   * Stablecoin this row's book is denominated in (e.g. 'USDT', 'USDC'). Optional for
   * venues that quote a single asset; binance_p2p populates it because it probes both,
   * and the same fiat can have materially different depth per stablecoin.
   */
  asset?: string;
  /**
   * Direction this row represents from the taker's perspective. 'buy' = taker pays fiat,
   * receives crypto (onramp). 'sell' = taker sends crypto, receives fiat (offramp).
   * Optional for backward compat — when absent the row is treated as the venue's default
   * (buy for binance until the offramp probe ships in Phase 2).
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

/**
 * Decomposed all-in cost of a ~$1k trade — one leg per direction. Instead of a
 * single opaque spread number, each leg itemizes where the money goes, with the
 * assumptions published alongside (DefiLlama-MiCA-style methodology).
 *
 * Sign convention matches spread_bps: negative = favorable for the taker
 * (P2P books often price under FX mid, so totals CAN be negative).
 *
 * `total_usd` = fiat_fee + trade_fee + spread. It deliberately EXCLUDES
 * `transfer_out_usd`: for off-chain-settled venues the headline total reflects
 * what the venue itself delivers (a balance on its ledger); moving to a
 * self-custodial wallet is a separate optional action, surfaced as its own line.
 */
export interface CostLeg1k {
  direction: 'buy' | 'sell';
  notional_usd: number;
  /**
   * Cost of moving the FIAT leg — the deposit/withdrawal rail itself (SEPA, wire, card).
   * On P2P this is usually 0: fiat moves bank-to-bank between taker and maker and the
   * venue never touches it. Non-zero rails (card, some e-wallets) belong here.
   */
  payment_method_fee_usd: number;
  /** Taker-facing fee the VENUE charges on top of the maker's price. */
  venue_fee_usd: number;
  /**
   * Cost of the price itself vs the FX mid — on a P2P book the price is maker-set, so
   * this is the maker's markup rather than a venue quote. Can be negative (P2P books
   * frequently price under mid, which pays the taker).
   */
  maker_spread_usd: number;
  /**
   * Cost of moving the CRYPTO leg. Buy = withdrawing to your own wallet; sell = depositing
   * from it (0, since venues charge nothing to receive — chain gas is paid to the network,
   * not the venue). INCLUDED in total_usd: the quoted journey is bank balance → own wallet,
   * mirroring how a CEX route is costed end-to-end.
   */
  withdrawal_fee_usd: number;
  /** payment_method_fee + venue_fee + maker_spread + withdrawal_fee. */
  total_usd: number;
  total_bps: number;
  /** Published assumptions behind the numbers (market, match rule, fee sources…). */
  assumptions: Record<string, string | number | null>;
}

export interface Cost1k {
  onramp: CostLeg1k | null;
  offramp: CostLeg1k | null;
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
  /** Itemized ~$1k trade cost per direction with published assumptions. */
  cost_1k?: Wrapped<Cost1k>;
  capabilities?: Capabilities;
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
