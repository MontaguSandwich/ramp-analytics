import { Fragment } from 'react';
import { CATEGORY_LABEL, costLegRows, fmtPct, fmtUsd, fmtUsdSigned } from '@/lib/format';
import type { CostLeg1k, ProductYaml, Snapshot } from '@/lib/types';

type PricingLayer = NonNullable<NonNullable<ProductYaml['pricing']>['layers']>[number];
const PRICING_LAYER_LABEL: Record<PricingLayer, string> = {
  maker_quote: 'Maker quote',
  venue_quote: 'Venue quote',
  venue_fee: 'Venue fee',
};

// Hover definitions — a "Venue fee" pill on a venue widely believed to be fee-free
// needs to say what it means. Layer semantics, not per-venue amounts (those live in
// the itemized $1k cost rows below).
const PRICING_LAYER_TITLE: Record<PricingLayer, string> = {
  maker_quote: 'The price is set by the counterparty (a maker posting an ad), not by the venue.',
  venue_quote: 'The venue itself quotes the price you trade against.',
  venue_fee: 'The venue charges a separately-itemized fee on top of the quoted price.',
};

/**
 * Venue Properties info card — the cross-product venue fact sheet: category,
 * direction, pricing model, launch year, live spread + depth posture, audits.
 *
 * Trimmed scope post-design-pass: Custody, Settlement, Proof of Reserves moved
 * into the Classification card. Team transparency, Legal entity, Licenses
 * dropped as low signal for the cross-product comparison.
 *
 * Shared between GenericDetail (binance / ramp / kraken) and Zkp2pDetail.
 */
export default function PropertiesCard({ yaml: y, snapshot: s }: { yaml: ProductYaml; snapshot?: Snapshot }) {
  const showOnramp = y.direction === 'on' || y.direction === 'both';
  const showOfframp = y.direction === 'off' || y.direction === 'both';
  const spreadBps = s?.observed_spread_bps.value ?? null;
  const deepest = deepestPair(s);
  const maxSingle = maxSingleTradeUsd(s);
  return (
    <div className="info-card">
      <div className="info-title">Venue Properties</div>
      <dl className="info-kv">
        <dt>Category</dt>
        <dd>
          <span className={`tag cat-${y.category}`}>
            {CATEGORY_LABEL[y.category] ?? y.category}
          </span>
        </dd>
        <dt>Direction</dt>
        <dd>
          <div className="direction-pills">
            {showOnramp ? <span className="tag tag-onramp">Onramp</span> : null}
            {showOfframp ? <span className="tag tag-offramp">Offramp</span> : null}
          </div>
        </dd>
        <dt>Pricing</dt>
        <dd>
          {y.pricing?.layers?.length ? (
            <div className="pricing-pills">
              {y.pricing.layers.map((l) => (
                <span
                  key={l}
                  className={`tag tag-${l.replace(/_/g, '-')}`}
                  title={PRICING_LAYER_TITLE[l]}
                >
                  {PRICING_LAYER_LABEL[l] ?? l}
                </span>
              ))}
            </div>
          ) : (
            y.pricing?.spread_method?.replace(/_/g, ' ') ?? '—'
          )}
        </dd>
        <dt>Live since</dt>
        <dd>{y.launched ?? '—'}</dd>
        {spreadBps != null ? (
          <>
            <dt>Spread (~$1k)</dt>
            <dd className="mono">{fmtPct(spreadBps)}</dd>
          </>
        ) : null}
        {s?.cost_1k?.value.onramp ? (
          <CostLegRow label="$1k onramp cost" leg={s.cost_1k.value.onramp} />
        ) : null}
        {s?.cost_1k?.value.offramp ? (
          <CostLegRow label="$1k offramp cost" leg={s.cost_1k.value.offramp} />
        ) : null}
        {deepest ? (
          <>
            <dt>Deepest pair</dt>
            <dd className="mono">
              {deepest.pair}{' '}
              <span className="muted">
                · {fmtUsd(deepest.sum_offers_usd)}
                {deepest.n_makers != null ? ` · ${deepest.n_makers} makers` : ''}
              </span>
            </dd>
          </>
        ) : null}
        {maxSingle != null ? (
          <>
            <dt>Max single trade</dt>
            <dd className="mono">{fmtUsd(maxSingle)}</dd>
          </>
        ) : null}
        {y.audits?.length ? (
          <>
            <dt>Audits</dt>
            <dd>{y.audits.map((a) => `${a.firm} (${a.date})`).join('; ')}</dd>
          </>
        ) : null}
        {y.licenses?.length ? (
          <>
            <dt>Regulation</dt>
            <dd>
              {y.licenses.map((l, i) => {
                const line = `${l.jurisdiction} — ${l.type}${l.status ? ` (${l.status}${l.since ? `, ${l.since}` : ''})` : l.since ? ` (${l.since})` : ''}`;
                return (
                  <div key={i} title={l.note}>
                    {l.url ? (
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {line}
                      </a>
                    ) : (
                      line
                    )}
                    {l.authority ? <span className="muted"> · {l.authority}</span> : null}
                  </div>
                );
              })}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Itemized ~$1k cost row: total (bps) headline, component equation as the sub-line,
 * full assumptions in the hover tooltip. The optional exit-to-chain line renders
 * separately and is excluded from the total (off-chain-settlement decision).
 */
function CostLegRow({ label, leg }: { label: string; leg: CostLeg1k }) {
  const assumptions = Object.entries(leg.assumptions)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join('\n');
  return (
    <Fragment>
      <dt title={assumptions} style={{ cursor: 'help' }}>
        {label}
      </dt>
      <dd>
        <div className="cost-breakdown">
          {costLegRows(leg).map((r) => (
            <div className="cost-breakdown-row" key={r.label}>
              <span className="muted">{r.label}</span>
              <span className="mono">{fmtUsdSigned(r.usd)}</span>
            </div>
          ))}
          <div className="cost-breakdown-row cost-breakdown-total">
            <span>Total</span>
            <span className="mono">
              {fmtUsdSigned(leg.total_usd)}{' '}
              <span className="muted">({fmtPct(leg.total_bps)})</span>
            </span>
          </div>
        </div>
      </dd>
    </Fragment>
  );
}

function deepestPair(
  s: Snapshot | undefined,
): { pair: string; sum_offers_usd: number; n_makers?: number } | null {
  if (!s) return null;
  const liq = s.liquidity.value;
  if (liq.kind === 'p2p_offerbook') {
    const top = [...liq.top_pairs].sort((a, b) => b.sum_offers_usd - a.sum_offers_usd)[0];
    if (!top) return null;
    return { pair: top.pair, sum_offers_usd: top.sum_offers_usd, n_makers: top.n_makers };
  }
  if (liq.kind === 'onchain_inventory') return liq.deepest_pair ?? null;
  return null;
}

function maxSingleTradeUsd(s: Snapshot | undefined): number | undefined {
  if (!s) return undefined;
  const liq = s.liquidity.value;
  if (liq.kind === 'p2p_offerbook' || liq.kind === 'onchain_inventory') {
    return liq.max_single_trade_usd;
  }
  return undefined;
}
