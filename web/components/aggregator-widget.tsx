'use client';

import { useMemo, useState } from 'react';
import { fiatFlagEmoji, paymentMethodLabel } from '@/lib/format';

/**
 * Aggregator widget — cross-venue route comparison form + ranked results table.
 *
 * Fields:
 *   - Direction toggle (onramp / offramp)
 *   - Amount input + fiat select (all supported fiats — union across venue coverage,
 *     server-provided)
 *   - Asset select (USDC default, others optional)
 *   - Payment method select (list adapts to direction)
 *   - KYC tolerance select (filter venues by their KYC requirements)
 *
 * Submit POSTs to /api/aggregator/quote which fans out per-venue (KYC-filtered) and
 * returns a ranked list. Results render below as a sortable table.
 *
 * Visual inspiration: zkp2p's "Select currency & platform" picker. MVP uses styled
 * <select>s; can iterate to custom dropdowns with flag/logo rendering once the engine
 * is validated.
 */

type KycFilter = 'any' | 'none' | 'email' | 'id' | 'id+poa';

const ASSETS = ['USDC', 'USDT', 'BTC', 'ETH'];
const METHODS_BY_DIR: Record<'buy' | 'sell', Array<{ value: string; label: string }>> = {
  buy: [
    { value: '', label: 'Any payment method' },
    { value: 'CARD_PAYMENT', label: 'Card' },
    { value: 'APPLE_PAY', label: 'Apple Pay' },
    { value: 'GOOGLE_PAY', label: 'Google Pay' },
    { value: 'MANUAL_BANK_TRANSFER', label: 'Bank transfer (SEPA)' },
    { value: 'AUTO_BANK_TRANSFER', label: 'Easy bank transfer' },
    { value: 'PIX', label: 'PIX' },
    { value: 'venmo', label: 'Venmo' },
    { value: 'zelle', label: 'Zelle' },
    { value: 'revolut', label: 'Revolut' },
    { value: 'wise', label: 'Wise' },
    { value: 'cashapp', label: 'Cash App' },
  ],
  sell: [
    { value: '', label: 'Any payment method' },
    { value: 'ACH', label: 'ACH' },
    { value: 'MANUAL_BANK_TRANSFER', label: 'SEPA' },
    { value: 'AUTO_BANK_TRANSFER', label: 'SEPA Instant' },
    { value: 'CARD_PAYMENT', label: 'Payout to card' },
  ],
};

const KYC_OPTIONS: Array<{ value: KycFilter; label: string }> = [
  { value: 'any', label: 'Any KYC' },
  { value: 'none', label: 'No KYC available' },
  { value: 'email', label: '≤ Email' },
  { value: 'id', label: '≤ ID' },
  { value: 'id+poa', label: '≤ ID + Proof of address' },
];

// Popular fiats float to the top of the dropdown list — same convention as the
// reference zkp2p picker ("Popular Currencies" section above the A-Z list).
const POPULAR_FIATS = ['USD', 'EUR', 'GBP', 'BRL', 'CNY', 'INR', 'JPY'];

interface VenueQuote {
  venue: string;
  venue_label: string;
  category: string;
  available: boolean;
  asset?: string;
  rate?: number;
  asset_amount?: number;
  spread_bps?: number;
  effective_pct?: number;
  source: 'live' | 'approximated' | 'unavailable';
  notes?: string;
  payment_method?: string;
  pii_floor: 'none' | 'email' | 'id' | 'id+poa' | 'enhanced';
  non_kyc_available: boolean;
}

interface AggregatorResponse {
  request: {
    direction: 'buy' | 'sell';
    fiat_amount: number;
    fiat_currency: string;
    asset?: string;
    payment_methods?: string[];
    kyc_max?: KycFilter;
  };
  quotes: VenueQuote[];
  ts: number;
}

export default function AggregatorWidget({ allFiats }: { allFiats: string[] }) {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState<string>('1000');
  const [fiat, setFiat] = useState<string>('USD');
  const [asset, setAsset] = useState<string>('USDC');
  const [method, setMethod] = useState<string>('');
  const [kycMax, setKycMax] = useState<KycFilter>('any');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AggregatorResponse | null>(null);

  // Sort fiats: popular first (in our curated order), then the rest A-Z. Same convention
  // as the reference picker. allFiats is the union of every venue's coverage.fiats.
  const sortedFiats = useMemo(() => {
    const popular = POPULAR_FIATS.filter((f) => allFiats.includes(f));
    const rest = allFiats.filter((f) => !POPULAR_FIATS.includes(f)).sort();
    return { popular, rest };
  }, [allFiats]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/aggregator/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          direction,
          fiat_amount: n,
          fiat_currency: fiat,
          asset,
          payment_methods: method ? [method] : undefined,
          kyc_max: kycMax,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Quote failed (${resp.status}): ${text.slice(0, 200)}`);
      }
      const data = (await resp.json()) as AggregatorResponse;
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const methods = METHODS_BY_DIR[direction];

  return (
    <div className="aggregator">
      <form className="aggregator-form" onSubmit={onSubmit}>
        <div className="aggregator-direction" role="group" aria-label="Direction">
          <button
            type="button"
            className={`aggregator-dir-btn${direction === 'buy' ? ' is-active' : ''}`}
            onClick={() => setDirection('buy')}
            aria-pressed={direction === 'buy'}
          >
            Onramp
          </button>
          <button
            type="button"
            className={`aggregator-dir-btn${direction === 'sell' ? ' is-active' : ''}`}
            onClick={() => setDirection('sell')}
            aria-pressed={direction === 'sell'}
          >
            Offramp
          </button>
        </div>

        <div className="aggregator-fields">
          <label className="aggregator-field">
            <span className="aggregator-field-label">
              {direction === 'buy' ? 'I want to spend' : 'I want to receive'}
            </span>
            <div className="aggregator-amount-row">
              <input
                type="number"
                inputMode="decimal"
                min={1}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="aggregator-input"
                placeholder="1000"
                required
              />
              <select
                value={fiat}
                onChange={(e) => setFiat(e.target.value)}
                className="aggregator-select aggregator-fiat-select"
                aria-label="Fiat currency"
              >
                {sortedFiats.popular.length ? (
                  <optgroup label="Popular">
                    {sortedFiats.popular.map((f) => (
                      <option key={f} value={f}>
                        {fiatFlagEmoji(f)} {f}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {sortedFiats.rest.length ? (
                  <optgroup label="All currencies">
                    {sortedFiats.rest.map((f) => (
                      <option key={f} value={f}>
                        {fiatFlagEmoji(f)} {f}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
          </label>

          <label className="aggregator-field">
            <span className="aggregator-field-label">
              {direction === 'buy' ? 'To receive' : 'To send'}
            </span>
            <select
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              className="aggregator-select"
            >
              {ASSETS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <label className="aggregator-field">
            <span className="aggregator-field-label">Via</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="aggregator-select"
            >
              {methods.map((m) => (
                <option key={m.value || 'any'} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="aggregator-field">
            <span className="aggregator-field-label">KYC tolerance</span>
            <select
              value={kycMax}
              onChange={(e) => setKycMax(e.target.value as KycFilter)}
              className="aggregator-select"
            >
              {KYC_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button type="submit" className="aggregator-submit" disabled={loading}>
          {loading ? 'Comparing rates…' : 'Compare rates across venues'}
        </button>
        {error ? <div className="aggregator-error">{error}</div> : null}
      </form>

      {result ? <AggregatorResults result={result} /> : null}
    </div>
  );
}

function AggregatorResults({ result }: { result: AggregatorResponse }) {
  const direction = result.request.direction;
  const fiat = result.request.fiat_currency;
  const fiatAmount = result.request.fiat_amount;
  const availableQuotes = result.quotes.filter((q) => q.available);
  const unavailableQuotes = result.quotes.filter((q) => !q.available);
  const best = availableQuotes[0];

  const amountColLabel = direction === 'buy' ? 'You receive' : 'You send';

  return (
    <section className="aggregator-results">
      <h2>
        Results{' '}
        <span className="h2-sub">
          · {availableQuotes.length} venue{availableQuotes.length === 1 ? '' : 's'} matched
        </span>
      </h2>
      {best ? (
        <div className="aggregator-best">
          <div className="aggregator-best-label">
            Best {direction === 'buy' ? 'onramp' : 'offramp'} for {fiatAmount.toLocaleString()}{' '}
            {fiat}
          </div>
          <div className="aggregator-best-body">
            <span className={`tag cat-${best.category}`}>{best.venue_label}</span>
            <span className="aggregator-best-value mono">
              {direction === 'buy' ? '+ ' : '− '}
              {best.asset_amount != null
                ? `${best.asset_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${best.asset}`
                : '—'}
            </span>
            {best.effective_pct != null ? (
              <span className="muted">spread {best.effective_pct.toFixed(2)}%</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="aggregator-empty">
          No live route matched. Try a different amount, fiat, payment method, or KYC tolerance.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th className="col-num">{amountColLabel}</th>
              <th className="col-num">Effective rate</th>
              <th className="col-num">Spread</th>
              <th>Via</th>
              <th>KYC</th>
              <th>Source</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {[...availableQuotes, ...unavailableQuotes].map((q) => (
              <tr key={q.venue} className={q.available ? '' : 'aggregator-row-na'}>
                <td>
                  <span className={`tag cat-${q.category}`}>{q.venue_label}</span>
                </td>
                <td className="col-num mono">
                  {q.asset_amount != null
                    ? `${q.asset_amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${q.asset ?? ''}`
                    : '—'}
                </td>
                <td className="col-num mono muted">{q.rate != null ? q.rate.toFixed(4) : '—'}</td>
                <td className="col-num mono">
                  {q.effective_pct != null ? `${q.effective_pct.toFixed(2)}%` : '—'}
                </td>
                <td className="muted">
                  {q.payment_method ? paymentMethodLabel(q.payment_method) : '—'}
                </td>
                <td className="muted fs-xs">
                  {q.non_kyc_available
                    ? 'None available'
                    : q.pii_floor === 'none'
                      ? 'None'
                      : q.pii_floor}
                </td>
                <td>
                  <span
                    className={`tag tag-source-${q.source}`}
                    title={
                      q.source === 'live'
                        ? 'Live quote from venue API'
                        : q.source === 'approximated'
                          ? 'Approximated from public reference price + hand-maintained fees'
                          : 'Not available for this route'
                    }
                  >
                    {q.source === 'live' ? '● Live' : q.source === 'approximated' ? '◐ Approx.' : '✕ n/a'}
                  </span>
                </td>
                <td className="muted fs-xs">
                  {q.notes ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        Ranked by {direction === 'buy' ? 'amount received (more is better)' : 'amount sent (less is better)'}.
        Sources: live quote APIs for Peer + Binance P2P; Ramp shown as approximated until we
        have a partner hostApiKey.
      </div>
    </section>
  );
}
