import type { Adapter, Snapshot, QuoteRequest, QuoteResponse, DailyPoint, Market, CostLeg1k } from '../lib/types.ts';

const PRODUCT_ID = 'revolut_ramp';
const BASE_URL = 'https://ramp.revolut.com/ramp-api';

/**
 * The partnerId ramp.revolut.com's own widget sends on /orders/quote and /limits.
 * It is NOT a secret — every anonymous visitor's browser uses this same value — but
 * the endpoints 400 without it. If quotes start failing wholesale, re-observe the id
 * in the widget's network tab (GET /ramp-api/orders/quote?...partnerId=...) and
 * update here. /config and /crypto-stats need no partnerId.
 */
const WEBSITE_PARTNER_ID = 'e5c8d239-5843-4e7b-a967-50f4206ec5d3';

/** Probe asset for per-fiat quotes: buyActive for every fiat, deep market, on the
 *  canonical chain. (No stablecoins exist on the Ramp surface to probe instead.) */
const PROBE_ASSET = { currency: 'ETH', blockchain: 'ETHEREUM' };
/** Cross-venue comparable notional for the KPI + per-fiat rows (USD). */
const NOTIONAL_USD = 1000;
/** All snapshot math is anchored to this fiat (mirrors binance's KPI_ANCHOR_FIAT). */
const ANCHOR_FIAT = 'USD';
/** Quote/limits probes run in chunks to stay polite (Revolut has no published limits,
 *  but we keep peak concurrency low on principle — the whole snapshot is ~40 calls). */
const PROBE_CHUNK_SIZE = 6;
const PROBE_CHUNK_DELAY_MS = 200;

const FEES_URL = 'https://www.revolut.com/legal/exchangingcryptocurrenciespersonalfees/';

interface RampConfig {
  fiatCurrencies: Array<{ currency: string; defaultAmount: number; fractionDigits: number }>;
  cryptoCurrencies: Array<{
    currency: string;
    blockchain: string;
    fractionDigits: number;
    buyActive: boolean;
    sellActive: boolean;
  }>;
}

interface CryptoStats {
  cryptoStats: Array<{ pair: string; mid: string }>;
}

interface RampQuote {
  quote: {
    baseAmount: { amount: number; currency: string };
    baseAmountWithoutFee: { amount: number; currency: string };
    counterAmount: { amount: number; currency: string };
    blockchain: string;
    rate: number;
    invertedRate: number;
    rateDate: number;
    fee: {
      service: { amount: number; currency: string };
      network: { amount: number; currency: string };
      total: { amount: number; currency: string };
    };
    expiresIn: number;
  };
}

interface RampLimits {
  account?: {
    max?: {
      minAmount?: { amount: number };
      dailyLimit?: { amount: number };
      monthlyLimit?: { amount: number };
    };
  };
}

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`revolut_ramp ${resp.status} ${url}`);
  return (await resp.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Convert a minor-unit amount to a real number using the currency's fractionDigits. */
function fromMinor(amount: number, fractionDigits: number): number {
  return amount / 10 ** fractionDigits;
}

async function fetchQuote(
  fiat: string,
  fiatAmountMinor: number,
  crypto = PROBE_ASSET,
): Promise<RampQuote['quote'] | null> {
  const url =
    `${BASE_URL}/orders/quote?fiatCurrency=${fiat}&cryptoCurrency=${crypto.currency}` +
    `&blockchain=${crypto.blockchain}&fiatAmount=${fiatAmountMinor}&partnerId=${WEBSITE_PARTNER_ID}`;
  try {
    const data = await getJson<RampQuote>(url);
    return data.quote ?? null;
  } catch {
    return null;
  }
}

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();

  // STAGE 1: config — fiat list (with fractionDigits) + crypto list (buy/sell flags).
  const config = await getJson<RampConfig>(`${BASE_URL}/config`);
  const fiats = config.fiatCurrencies.map((f) => f.currency);
  const fracByFiat = Object.fromEntries(config.fiatCurrencies.map((f) => [f.currency, f.fractionDigits]));
  const probeCrypto = config.cryptoCurrencies.find(
    (c) => c.currency === PROBE_ASSET.currency && c.blockchain === PROBE_ASSET.blockchain,
  );
  const probeFrac = probeCrypto?.fractionDigits ?? 8;

  // STAGE 2: per-fiat mids from Revolut's own crypto-stats (one call per fiat, parallel —
  // 18 light GETs). BTC is present in every fiat's stats and anchors the FX derivation:
  //   fx(fiat per USD) = mid(BTC/fiat) / mid(BTC/USD)
  // so we never need CoinGecko here — the venue's own mids keep the math self-consistent.
  const midsByFiat: Record<string, Record<string, number>> = {};
  await Promise.all(
    fiats.map(async (fiat) => {
      try {
        const stats = await getJson<CryptoStats>(`${BASE_URL}/crypto-stats?fiatCurrency=${fiat}`);
        const mids: Record<string, number> = {};
        for (const s of stats.cryptoStats) {
          const [sym] = s.pair.split('/');
          mids[sym] = Number(s.mid);
        }
        midsByFiat[fiat] = mids;
      } catch {
        /* skip fiat on failure */
      }
    }),
  );
  const btcUsd = midsByFiat[ANCHOR_FIAT]?.['BTC'];
  const ethUsd = midsByFiat[ANCHOR_FIAT]?.[PROBE_ASSET.currency];
  const fxPerUsd: Record<string, number> = {}; // fiat units per 1 USD
  if (btcUsd) {
    for (const fiat of fiats) {
      const btcFiat = midsByFiat[fiat]?.['BTC'];
      if (btcFiat && btcFiat > 0) fxPerUsd[fiat] = btcFiat / btcUsd;
    }
  }

  // STAGE 3: per-fiat $1k-equivalent ETH quote + account limits, chunked. Each quote
  // itemizes {service fee, network fee} and carries the all-in rate — real venue-quoted
  // numbers, not an approximation (contrast: ramp_network Approach B).
  const quoteByFiat: Record<string, RampQuote['quote']> = {};
  const limitsByFiat: Record<string, RampLimits> = {};
  for (let i = 0; i < fiats.length; i += PROBE_CHUNK_SIZE) {
    const chunk = fiats.slice(i, i + PROBE_CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (fiat) => {
        const fx = fxPerUsd[fiat];
        if (!fx) return;
        const frac = fracByFiat[fiat] ?? 2;
        const fiatAmountMinor = Math.round(NOTIONAL_USD * fx * 10 ** frac);
        const [q, lim] = await Promise.all([
          fetchQuote(fiat, fiatAmountMinor),
          getJson<RampLimits>(
            `${BASE_URL}/limits?currency=${fiat}&crypto=${PROBE_ASSET.currency}&blockchain=${PROBE_ASSET.blockchain}&partnerId=${WEBSITE_PARTNER_ID}`,
          ).catch(() => null),
        ]);
        if (q) quoteByFiat[fiat] = q;
        if (lim) limitsByFiat[fiat] = lim;
      }),
    );
    if (i + PROBE_CHUNK_SIZE < fiats.length) await sleep(PROBE_CHUNK_DELAY_MS);
  }

  // USD anchors the headline KPI and cost_1k — retry it sequentially if the burst
  // dropped it (binance lesson: don't let one shed probe blank the KPI).
  if (!quoteByFiat[ANCHOR_FIAT] && fxPerUsd[ANCHOR_FIAT]) {
    for (let attempt = 0; attempt < 3 && !quoteByFiat[ANCHOR_FIAT]; attempt++) {
      await sleep(500);
      const q = await fetchQuote(ANCHOR_FIAT, NOTIONAL_USD * 100);
      if (q) quoteByFiat[ANCHOR_FIAT] = q;
    }
  }

  // STAGE 4: Market rows — one per fiat, buy-only (the quote endpoint has no sell
  // side; in-app Revolut crypto handles sells). spread_bps is ALL-IN vs the venue's
  // own mid: service fee + network fee + rate markup, expressed on the rate.
  const markets: Market[] = [];
  for (const fiat of fiats) {
    const q = quoteByFiat[fiat];
    const mid = midsByFiat[fiat]?.[PROBE_ASSET.currency];
    const fx = fxPerUsd[fiat];
    if (!q || !mid || !fx) continue;
    const frac = fracByFiat[fiat] ?? 2;
    const fiatPaid = fromMinor(q.baseAmount.amount, frac);
    const ethReceived = fromMinor(q.counterAmount.amount, probeFrac);
    if (ethReceived <= 0) continue;
    const allInRate = fiatPaid / ethReceived; // fiat per ETH, gross of all fees
    const spreadBps = (allInRate / mid - 1) * 10_000;
    const daily = limitsByFiat[fiat]?.account?.max?.dailyLimit?.amount;
    markets.push({
      currency: fiat,
      platform: 'Revolut Pay',
      direction: 'buy',
      best_rate: allInRate,
      fx_mid_rate: mid,
      spread_bps: spreadBps,
      total_liquidity_usd: daily != null ? fromMinor(daily, frac) / fx : 0,
      deposit_count: 1, // hosted ramp: one venue quote, not an offer book
    });
  }
  markets.sort((a, b) => a.spread_bps - b.spread_bps);

  // STAGE 5: capacity + headline numbers, all USD-anchored.
  const capacityByFiat: Record<string, { single_tx_max: number; daily_max: number }> = {};
  for (const fiat of fiats) {
    const daily = limitsByFiat[fiat]?.account?.max?.dailyLimit?.amount;
    if (daily == null) continue;
    const frac = fracByFiat[fiat] ?? 2;
    const real = fromMinor(daily, frac);
    // Revolut publishes no separate single-tx ceiling — the daily account limit is the
    // binding cap on a single purchase, so we surface it for both.
    capacityByFiat[fiat] = { single_tx_max: real, daily_max: real };
  }
  const usdDaily = capacityByFiat[ANCHOR_FIAT]?.daily_max;

  const usdQuote = quoteByFiat[ANCHOR_FIAT];
  const usdMarket = markets.find((m) => m.currency === ANCHOR_FIAT);
  const spreadValue = usdMarket ? usdMarket.spread_bps : null;

  // cost_1k decomposition (onramp only): journey = Revolut balance → own wallet.
  //   payment_method_fee: 0 — Revolut Pay draws on the account balance; no rail fee.
  //   venue_fee:          the itemized service fee from the live quote.
  //   maker_spread:       rate markup vs Revolut's own published mid (venue_quote layer —
  //                       there is no maker here, the venue sets the price).
  //   withdrawal:         the network fee — Ramp delivers on-chain, so delivery IS the
  //                       withdrawal leg; there is no separate withdraw step to pay for.
  let cost1kOnramp: CostLeg1k | null = null;
  if (usdQuote && ethUsd) {
    const service = fromMinor(usdQuote.fee.service.amount, 2);
    const network = fromMinor(usdQuote.fee.network.amount, 2);
    const ethReceived = fromMinor(usdQuote.counterAmount.amount, probeFrac);
    const totalUsd = NOTIONAL_USD - ethReceived * ethUsd;
    const makerSpread = totalUsd - service - network;
    cost1kOnramp = {
      direction: 'buy',
      notional_usd: NOTIONAL_USD,
      payment_method_fee_usd: 0,
      venue_fee_usd: service,
      maker_spread_usd: makerSpread,
      withdrawal_fee_usd: network,
      total_usd: totalUsd,
      total_bps: (totalUsd / NOTIONAL_USD) * 10_000,
      assumptions: {
        market: `USD → ${PROBE_ASSET.currency} (${PROBE_ASSET.blockchain})`,
        checkout: 'Revolut Pay (account balance) — card checkout may price differently',
        mid_source: 'Revolut ramp-api /crypto-stats (venue-published mid)',
        rate_markup_note:
          'maker_spread here is the venue rate markup vs its own mid — Revolut sets the price (venue_quote layer), there is no maker',
        withdrawal_note:
          'network fee = on-chain delivery to your wallet; Ramp has no separate withdrawal step',
        fee_source: FEES_URL,
        quote_expires_in_sec: usdQuote.expiresIn / 1000,
      },
    };
  }

  return {
    liquidity: {
      value: {
        kind: 'ramp_capacity',
        fiat: capacityByFiat,
        max_single_trade_usd: usdDaily,
      },
      provenance: 'api',
      last_verified: now,
      evidence_url: `${BASE_URL}/limits`,
      notes:
        'Daily account limit from /ramp-api/limits — Revolut publishes no separate single-transaction ceiling, so the daily cap is the binding max for one purchase.',
    },
    volume_30d_usd: {
      value: null,
      provenance: 'unavailable',
      last_verified: now,
      notes: 'Revolut does not publish Ramp volume statistics',
    },
    observed_spread_bps: {
      value: spreadValue,
      provenance: 'api',
      spread_aggregation: 'effective_at_size',
      sample_size: usdMarket ? 1 : 0,
      period: 'usd_eth_$1k_quote',
      last_verified: now,
      evidence_url: `${BASE_URL}/orders/quote`,
      notes:
        'All-in cost of a live $1k USD→ETH quote vs Revolut’s own mid: service fee + network fee + rate markup. Venue-quoted (no hostApiKey needed, unlike Ramp Network).',
    },
    fee_snapshot: {
      ts: now,
      sample_rows: markets.slice(0, 8).map((m) => ({
        fiat: m.currency,
        asset: PROBE_ASSET.currency,
        payment_method: 'revolut_pay',
        effective_rate_bps: Math.round(m.spread_bps),
      })),
      provenance: 'api',
    },
    markets: markets.length
      ? {
          value: markets,
          provenance: 'api',
          last_verified: now,
          evidence_url: `${BASE_URL}/orders/quote`,
          notes:
            'Live venue quotes: $1k-equivalent ETH purchase per fiat via /ramp-api/orders/quote (key-less). spread_bps = all-in cost vs Revolut’s own published mid.',
        }
      : undefined,
    cost_1k: cost1kOnramp
      ? {
          value: { onramp: cost1kOnramp, offramp: null },
          provenance: 'api',
          last_verified: now,
          evidence_url: `${BASE_URL}/orders/quote`,
          notes:
            'Offramp: /orders/quote is buy-only. Ramp sells (ETH/BTC flagged sellActive) have no quotable public endpoint.',
        }
      : undefined,
    // quote() is implemented (used by the aggregator's inline mirror + any future
    // route), but the venue "Get a Quote" tab isn't built yet — keep the gate off.
    capabilities: { orderbook: false, quote: false },
  };
}

async function quote(req: QuoteRequest): Promise<QuoteResponse | null> {
  if (req.direction !== 'buy') return null;
  const fiat = req.fiat.toUpperCase();
  const asset = req.asset.toUpperCase();

  try {
    const config = await getJson<RampConfig>(`${BASE_URL}/config`);
    const fiatCfg = config.fiatCurrencies.find((f) => f.currency === fiat);
    // Prefer the chain the caller asked for; else the asset's first buyActive listing.
    const cryptoCfg =
      config.cryptoCurrencies.find(
        (c) => c.currency === asset && c.buyActive && c.blockchain === req.chain?.toUpperCase(),
      ) ?? config.cryptoCurrencies.find((c) => c.currency === asset && c.buyActive);
    if (!fiatCfg || !cryptoCfg) return null; // fiat or asset not on the Ramp surface

    const fiatAmountMinor = Math.round(req.amount * 10 ** fiatCfg.fractionDigits);
    const q = await fetchQuote(fiat, fiatAmountMinor, cryptoCfg);
    if (!q) return null;

    const received = fromMinor(q.counterAmount.amount, cryptoCfg.fractionDigits);
    const feeTotal = fromMinor(q.fee.total.amount, fiatCfg.fractionDigits);
    return {
      product_id: PRODUCT_ID,
      effective_rate_bps: 0,
      fee_pct: req.amount > 0 ? (feeTotal / req.amount) * 100 : 0,
      estimated_received: received,
      ttl_sec: Math.round((q.expiresIn ?? 10_000) / 1000),
      source: 'live',
      evidence: { kind: 'quote_endpoint', ref: 'GET /ramp-api/orders/quote' },
    };
  } catch {
    return null;
  }
}

async function history(_days: number): Promise<DailyPoint[]> {
  // No public historical data for Revolut Ramp.
  return [];
}

const adapter: Adapter = { id: PRODUCT_ID, snapshot, quote, history };
export default adapter;
