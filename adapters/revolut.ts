import type { Adapter, Snapshot, QuoteRequest, QuoteResponse, DailyPoint, CostLeg1k } from '../lib/types.ts';

const PRODUCT_ID = 'revolut';

/**
 * Revolut in-app retail crypto — first RTPN venue. There is NO public API for the
 * in-app exchange (quotes, spreads, volume are all inside the authenticated app),
 * so this adapter publishes the venue's own FEE SCHEDULE, hand-transcribed from:
 *
 *   https://www.revolut.com/legal/exchangingcryptocurrenciespersonalfees/
 *   (verified 2026-07-22 against the UK page + in-app fee sheet screenshots;
 *   the EEA page — Revolut Digital Assets Europe Ltd — carries the same
 *   percentages with EUR-denominated brackets)
 *
 * Everything here is provenance 'self_reported' (venue-published), and the
 * execution-time rate markup remains structurally unobservable from outside —
 * that gap is the target of the community attestation pipeline (COMMUNITY_DATA.md).
 *
 * ── Fee schedule (per 30d rolling volume, % of trade) ──────────────────────────
 * NOTE: Revolut has announced this tier structure is REPLACED on 2026-08-10 by
 * flat fees: Standard/Plus 1.49%, Premium/Metal 0.99% (page section "fees from
 * 10 August 2026"). Update TIERED_FEES_END + FLAT_FEES_FROM_AUG_2026 handling
 * after that date.
 */
export const EXCHANGE_FEE_TIERS_BPS: Record<string, Array<{ upToGbp: number | null; bps: number }>> = {
  // 30d volume brackets are GBP/EUR-denominated (local-currency equivalents).
  standard_plus: [
    { upToGbp: 10_000, bps: 149 },
    { upToGbp: 50_000, bps: 129 },
    { upToGbp: 100_000, bps: 109 },
    { upToGbp: 250_000, bps: 89 },
    { upToGbp: null, bps: 49 },
  ],
  premium_metal: [
    { upToGbp: 10_000, bps: 99 },
    { upToGbp: 50_000, bps: 79 },
    { upToGbp: 100_000, bps: 69 },
    { upToGbp: 250_000, bps: 49 },
    { upToGbp: null, bps: 29 },
  ],
  ultra: [
    { upToGbp: 10_000, bps: 49 },
    { upToGbp: 50_000, bps: 39 },
    { upToGbp: 100_000, bps: 29 },
    { upToGbp: 250_000, bps: 19 },
    { upToGbp: null, bps: 0 },
  ],
};

/** From 2026-08-10 the tiers above collapse to flat fees (published in advance). */
export const FLAT_FEES_FROM_AUG_2026_BPS = { standard_plus: 149, premium_metal: 99 };

/** Withdrawal service fee (GBP or local equivalent) — network fee added on top. */
export const WITHDRAWAL_SERVICE_FEE_GBP_CHEAP = 1; // XRP, XLM, DOT, SOL, AVAX, XTZ, ALGO, ADA
const WITHDRAWAL_SERVICE_FEE_GBP_OTHER = 3; // everything else, incl. BTC/ETH/USDC/USDT

const FEES_URL = 'https://www.revolut.com/legal/exchangingcryptocurrenciespersonalfees/';
const NOTIONAL_USD = 1000;

/** GBP-per-USD via Revolut's own ramp-api mids (BTC/GBP ÷ BTC/USD) — keeps the fee
 *  conversion self-consistent with the venue, with a static fallback if it's down. */
async function gbpPerUsd(): Promise<number> {
  try {
    const get = async (fiat: string) => {
      const r = await fetch(`https://ramp.revolut.com/ramp-api/crypto-stats?fiatCurrency=${fiat}`, {
        headers: { accept: 'application/json' },
      });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { cryptoStats: Array<{ pair: string; mid: string }> };
      const btc = data.cryptoStats.find((s) => s.pair.startsWith('BTC/'));
      if (!btc) throw new Error('no BTC pair');
      return Number(btc.mid);
    };
    const [gbp, usd] = await Promise.all([get('GBP'), get('USD')]);
    if (gbp > 0 && usd > 0) return gbp / usd;
  } catch {
    /* fall through */
  }
  return 0.78; // static fallback, close enough for a ~$4 fee conversion
}

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();
  const fx = await gbpPerUsd();
  const withdrawalUsd = WITHDRAWAL_SERVICE_FEE_GBP_OTHER / fx;

  // ── cost_1k: USD balance → USDC → own wallet (the cross-venue $1k comparable) ──
  // Published terms make the exchange leg FREE for this specific journey:
  //   - fiat ↔ stablecoin exchanges are exempt from both the percentage fee and the
  //     minimum fee (all plans);
  //   - USDC/USD and USDT/USD convert 1:1 with no spread (barring depeg / abuse
  //     carve-outs).
  // The only venue cost is moving the crypto out: £3-equivalent service fee plus a
  // variable network fee quoted in-app at withdrawal time (excluded here — it is a
  // pass-through the venue does not fix in advance; attestation target).
  const onramp: CostLeg1k = {
    direction: 'buy',
    notional_usd: NOTIONAL_USD,
    payment_method_fee_usd: 0,
    venue_fee_usd: 0,
    maker_spread_usd: 0,
    withdrawal_fee_usd: withdrawalUsd,
    total_usd: withdrawalUsd,
    total_bps: (withdrawalUsd / NOTIONAL_USD) * 10_000,
    assumptions: {
      market: 'USD balance → USDC → external wallet',
      plan: 'any (stablecoin exemption applies to all plans)',
      exchange_fee: '0 — fiat↔stablecoin exchanges exempt from % and minimum fees',
      rate: 'USDC/USD converts 1:1, no spread (depeg and abuse carve-outs apply)',
      fair_usage:
        'Standard: crypto exchanges count toward the £1,000/mo exchange allowance; beyond it a 1% fair-usage fee applies. $1k fits a fresh allowance.',
      withdrawal_service_fee: '3 GBP-equivalent (non-cheap-network asset class)',
      network_fee:
        'variable, quoted in-app at withdrawal, passed through — excluded here (attestation target)',
      usdt_note:
        'USDT/USD 1:1 also published (UK schedule); EEA USDT availability is restricted post-MiCA — USDC used as the anchor',
      fee_source: FEES_URL,
    },
  };
  // Offramp mirror: deposit crypto (free) → USDC/USD 1:1 (free) → USD balance.
  const offramp: CostLeg1k = {
    direction: 'sell',
    notional_usd: NOTIONAL_USD,
    payment_method_fee_usd: 0,
    venue_fee_usd: 0,
    maker_spread_usd: 0,
    withdrawal_fee_usd: 0, // deposits are free; chain gas goes to the network, not the venue
    total_usd: 0,
    total_bps: 0,
    assumptions: {
      market: 'external wallet → USDC → USD balance',
      deposit_fee: '0 — "We do not charge any fees for deposits"',
      rate: 'USDC/USD converts 1:1, no spread (depeg and abuse carve-outs apply)',
      fair_usage: 'same fair-usage allowance caveat as the onramp leg (Standard/Plus)',
      offboarding_note:
        'getting USD out of Revolut to a bank is a fiat transfer priced by the account plan, not the crypto product',
      fee_source: FEES_URL,
    },
  };

  return {
    liquidity: {
      value: { kind: 'ramp_capacity', fiat: {} },
      provenance: 'unavailable',
      last_verified: now,
      notes:
        'Revolut does not disclose in-app crypto liquidity, internal order flow, or per-trade capacity. Exchange limits are per-account and plan-dependent.',
    },
    volume_30d_usd: {
      value: null,
      provenance: 'unavailable',
      last_verified: now,
      notes: 'Revolut does not publish in-app crypto trading volume.',
    },
    observed_spread_bps: {
      value: 0,
      provenance: 'self_reported',
      spread_aggregation: 'effective_at_size',
      sample_size: 1,
      period: 'usd_$1k_published_fee_schedule',
      last_verified: now,
      evidence_url: FEES_URL,
      notes:
        'Published terms: USD↔USDC (and USDT on the UK schedule) convert 1:1 with no spread and no exchange fee — the $1k stablecoin onramp leg is free before withdrawal. Non-stablecoin trades pay the plan/volume-tiered fee (Standard 1.49% at $1k) plus an execution-time rate markup that is NOT publicly observable — attestation target.',
    },
    fee_snapshot: {
      ts: now,
      sample_rows: [
        { fiat: 'USD', asset: 'USDC', payment_method: 'balance (any plan)', effective_rate_bps: 0 },
        { fiat: 'USD', asset: 'BTC', payment_method: 'balance (Standard/Plus)', effective_rate_bps: 149 },
        { fiat: 'USD', asset: 'BTC', payment_method: 'balance (Premium/Metal)', effective_rate_bps: 99 },
        { fiat: 'USD', asset: 'BTC', payment_method: 'balance (Ultra)', effective_rate_bps: 49 },
      ],
      provenance: 'self_reported',
    },
    cost_1k: {
      value: { onramp, offramp },
      provenance: 'self_reported',
      last_verified: now,
      evidence_url: FEES_URL,
      notes:
        'Derived from the published fee schedule (venue-reported, not independently observed). The tiered exchange-fee structure is replaced by flat fees on 2026-08-10 (Standard/Plus 1.49%, Premium/Metal 0.99%) — stablecoin exemption unchanged.',
    },
    // No public quote endpoint, no orderbook — single Overview page.
    capabilities: { orderbook: false, quote: false },
  };
}

async function quote(_req: QuoteRequest): Promise<QuoteResponse | null> {
  // In-app only; no public quote surface. Community-attested observations may
  // later provide indicative (non-executable) numbers.
  return null;
}

async function history(_days: number): Promise<DailyPoint[]> {
  return [];
}

const adapter: Adapter = { id: PRODUCT_ID, snapshot, quote, history };
export default adapter;
