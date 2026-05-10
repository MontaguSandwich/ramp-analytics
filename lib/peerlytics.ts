// Peerlytics API client (https://peerlytics.xyz/api/v1).
// Auth: x-api-key header. Read ZKP2P_ANALYTICS_KEY from env.
//
// Most endpoints return `{ success, data }` and we unwrap; a few endpoints
// (analytics/{summary,overview,leaderboard}, account/*) return the payload
// directly and we use rawGet for those.

const BASE_URL = 'https://peerlytics.xyz/api/v1';

export class PeerlyticsApiError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  constructor(message: string, status: number, code: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function getKey(): string {
  const k = process.env.ZKP2P_ANALYTICS_KEY;
  if (!k) throw new Error('ZKP2P_ANALYTICS_KEY not set in environment');
  return k;
}

type ParamValue = string | number | boolean | string[] | undefined | null;

function buildUrl(path: string, params?: Record<string, ParamValue>): string {
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const x of v) url.searchParams.append(k, String(x));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'x-api-key': getKey(), accept: 'application/json' },
    signal,
  });
  if (!resp.ok) {
    let code = 'http_error';
    let message = resp.statusText;
    try {
      const body = (await resp.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      // body not json; ignore
    }
    const retry = resp.headers.get('retry-after');
    throw new PeerlyticsApiError(
      `peerlytics ${resp.status} ${code}: ${message}`,
      resp.status,
      code,
      retry ? Number(retry) : undefined,
    );
  }
  return (await resp.json()) as T;
}

/** GET an endpoint that returns the payload directly (no envelope). */
export async function rawGet<T>(
  path: string,
  params?: Record<string, ParamValue>,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJson<T>(buildUrl(path, params), signal);
}

/** GET an endpoint that wraps payload in { success, data }; returns data. */
export async function envelopeGet<T>(
  path: string,
  params?: Record<string, ParamValue>,
  signal?: AbortSignal,
): Promise<T> {
  const json = await fetchJson<{ data: T }>(buildUrl(path, params), signal);
  return json.data;
}

// ───────────────────────────── Typed responses ──────────────────────────

// v2 response uses snake_case throughout; the doc's camelCase examples are stale.

export interface AnalyticsWindow {
  from: number;
  to: number;
  days: number;
  range: string;
  from_iso?: string;
  to_iso?: string;
  computed_for?: string;
}

export interface AnalyticsSettlement {
  settled_volume_usd: number;
  signaled_volume_usd: number;
  completed_trades: number;
  signaled_intents: number;
  fulfilled_intents: number;
  pruned_intents: number;
  success_rate_pct: number;
  unique_makers: number;
  unique_takers: number;
  unique_participants: number;
  new_deposits: number;
  average_trade_usd: number;
  average_daily_volume_usd: number;
}

export interface AnalyticsCompositionItem {
  key: string;
  label: string;
  volume_usd: number;
  fulfilled_intents: number;
  share_pct: number;
}

export interface AnalyticsComposition {
  platforms?: AnalyticsCompositionItem[];
  currencies?: AnalyticsCompositionItem[];
}

export interface AnalyticsLiquidity {
  available_usd?: number;
  active_deposits?: number;
  active_makers?: number;
}

export interface AnalyticsSpreads {
  current_spread_bps?: number | null;
  min_spread_bps?: number | null;
  max_spread_bps?: number | null;
}

export interface AnalyticsSummary {
  window?: AnalyticsWindow;
  summary?: AnalyticsSettlement;
  composition?: AnalyticsComposition;
  liquidity?: AnalyticsLiquidity;
  spreads?: AnalyticsSpreads;
  comparison?: unknown;
  meta?: { cached_at?: string; cache_duration_seconds?: number; source?: string };
  [key: string]: unknown;
}

export interface OverviewSnapshot {
  settled_volume_usd?: number;
  signaled_volume_usd?: number;
  completed_trades?: number;
  total_intents?: number;
  fulfilled_intents?: number;
  success_rate_pct?: number;
  prune_rate_pct?: number;
  expired_before_fill_pct?: number;
  active_liquidity_usd?: number;
  locked_liquidity_usd?: number;
  active_deposits?: number;
  unique_makers?: number;
  unique_takers?: number;
  unique_participants?: number;
  avg_daily_volume_usd?: number;
  avg_trade_size_usd?: number;
  avg_deposit_size_usd?: number;
  turnover_pct?: number;
  median_fill_seconds?: number;
  avg_fill_seconds?: number;
  top_maker_liquidity_share_pct?: number;
  top_currency_share_pct?: number;
  top_platform_share_pct?: number;
}

export interface OverviewActivityPoint {
  date: string;
  settled_volume_usd: number;
  trades: number;
  participants?: number;
}

export interface OverviewLiquidityPoint {
  date: string;
  liquidity_usd: number;
  average_liquidity_usd?: number;
}

export interface OverviewTimeseries {
  activity?: OverviewActivityPoint[];
  liquidity?: OverviewLiquidityPoint[];
}

export interface AnalyticsOverview {
  period?: string;
  updated_at?: string | number;
  time_range?: string;
  window?: AnalyticsWindow;
  snapshot?: OverviewSnapshot;
  summary?: AnalyticsSettlement;
  composition?: AnalyticsComposition;
  liquidity?: AnalyticsLiquidity;
  spreads?: AnalyticsSpreads;
  growth?: unknown;
  timeseries?: OverviewTimeseries;
  protocol_mix?: unknown;
  meta?: { cached_at?: string; cache_duration_seconds?: number; source?: string };
}

export interface TimeseriesBucket {
  bucket: string; // YYYY-MM-DD for granularity=day
  value: number;
}

export interface TimeseriesResponse {
  entity: 'deposits' | 'intents' | 'volume';
  granularity: 'hour' | 'day';
  groupBy: 'platform' | 'currency' | 'maker' | 'verifier' | null;
  from: string;
  to: string;
  buckets: TimeseriesBucket[] | null;
  series:
    | Array<{
        key: string;
        label: string;
        buckets: TimeseriesBucket[];
      }>
    | null;
  cached?: boolean;
}

export interface OrderbookLevel {
  rate: number;
  total_liquidity_usd: number;
  deposit_count: number;
  platforms: string[];
  top_deposit?: { depositor: string; deposit_id: string; escrow_address: string };
  pricing_mode?: 'fixed' | 'oracle' | 'mixed';
  oracle_spread_bps_min?: number;
  oracle_spread_bps_max?: number;
  oracle_sources?: string[];
  delegated_entry_count?: number;
}

export interface OrderbookCurrency {
  currency: string;
  levels: OrderbookLevel[];
  total_liquidity_usd: number;
  best_rate: number;
  fx_mid_rate: number;
}

export interface OrderbookResponse {
  stats: {
    total_liquidity_usd: number;
    active_makers: number;
    volume24h_usd: number;
    active_intents: number;
  };
  orderbooks: OrderbookCurrency[];
  activity?: Array<{
    id: string;
    type: string;
    amount_usd: number;
    currency: string;
    platform: string;
    timestamp: number;
  }>;
  filters: {
    applied: {
      currency: string | null;
      platform: string | null;
      platforms?: string[];
      min_size: number;
    };
    available: {
      currencies: string[];
      platforms: string[];
      currencies_by_platform?: Record<string, string[]>;
    };
  };
}

export interface MetaPlatforms {
  platforms: Array<{ id: string; label: string; method_hashes: string[] }>;
}

export interface MetaCurrencies {
  currencies: Array<{ code: string; label: string; flag?: string; hashes: string[] }>;
}

// ──────────────────────────── Convenience methods ────────────────────────

export async function getSummary(
  params: { range?: string; from?: number; to?: number; compare?: 'prior_period' | 'prior_year' } = {},
  signal?: AbortSignal,
): Promise<AnalyticsSummary> {
  return envelopeGet<AnalyticsSummary>('/analytics/summary', params, signal);
}

export async function getOverview(
  params: { range?: string; from?: number; to?: number } = {},
  signal?: AbortSignal,
): Promise<AnalyticsOverview> {
  return envelopeGet<AnalyticsOverview>('/analytics/overview', params, signal);
}

export async function getTimeseries(
  params: {
    entity: 'deposits' | 'intents' | 'volume';
    granularity?: 'hour' | 'day';
    range?: string;
    from?: number;
    to?: number;
    groupBy?: 'platform' | 'currency' | 'maker' | 'verifier';
    platform?: string[];
    currency?: string[];
  },
  signal?: AbortSignal,
): Promise<TimeseriesResponse> {
  return envelopeGet<TimeseriesResponse>('/analytics/timeseries', params, signal);
}

export async function getOrderbook(
  params: { currency?: string; platform?: string; minSize?: number } = {},
  signal?: AbortSignal,
): Promise<OrderbookResponse> {
  return envelopeGet<OrderbookResponse>('/orderbook', params, signal);
}

export async function getMetaPlatforms(signal?: AbortSignal): Promise<MetaPlatforms> {
  return envelopeGet<MetaPlatforms>('/meta/platforms', undefined, signal);
}

export async function getMetaCurrencies(signal?: AbortSignal): Promise<MetaCurrencies> {
  return envelopeGet<MetaCurrencies>('/meta/currencies', undefined, signal);
}

export interface DepositMarketEntry {
  platform: string;
  currency: string;
  rate: number;
  paymentMethodHash?: string;
  currencyCode?: string;
  conversionRate?: string;
  takerConversionRate?: string;
  spreadBps?: number;
  isOracleBacked?: boolean;
  isDelegated?: boolean;
}

export interface DepositRow {
  id: string;
  chainId: number;
  escrowAddress: string;
  depositId: string;
  depositor: string;
  remainingDeposits: string;
  intentAmountMin: string;
  intentAmountMax: string;
  acceptingIntents: boolean;
  status: 'ACTIVE' | 'CLOSED';
  totalAmountTaken?: string;
  totalIntents?: number;
  fulfilledIntents?: number;
  successRateBps?: number;
  availableUsd?: number;
  totalUsd?: number;
  takenUsd?: number;
  markets?: DepositMarketEntry[];
}

export interface DepositsResponse {
  deposits: DepositRow[];
  count: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  filters: Record<string, unknown>;
}

export async function getDeposits(
  params: {
    currency?: string | string[];
    platform?: string | string[];
    status?: 'ACTIVE' | 'CLOSED';
    accepting?: boolean;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal,
): Promise<DepositsResponse> {
  return envelopeGet<DepositsResponse>('/deposits', params, signal);
}
