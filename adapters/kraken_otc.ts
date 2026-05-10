import type { Adapter, Snapshot, QuoteRequest, QuoteResponse, DailyPoint } from '../lib/types.ts';

const PRODUCT_ID = 'kraken_otc';

// Kraken OTC has no public API — quotes are RFQ via voice/chat. Snapshot is mostly
// static, populated from public-facing OTC desk page. min_ticket and settlement
// time are the only fields users actually compare on for OTC.
const MIN_TICKET_USD = 100_000;

async function snapshot(): Promise<Snapshot> {
  const now = Date.now();

  return {
    liquidity: {
      value: { kind: 'otc_minimum', usd: MIN_TICKET_USD },
      provenance: 'manual',
      last_verified: now,
      evidence_url: 'https://www.kraken.com/otc',
      notes: 'Min ticket from public OTC desk page; subject to relationship review',
    },
    volume_30d_usd: {
      value: null,
      provenance: 'self_reported',
      last_verified: now,
      notes: 'Kraken does not separately disclose OTC desk volume',
    },
    observed_spread_bps: {
      value: null,
      provenance: 'manual',
      spread_aggregation: 'sample',
      sample_size: 0,
      period: 'n/a',
      last_verified: now,
      notes: 'OTC pricing is RFQ — no public quote feed',
    },
    fee_snapshot: { ts: now, sample_rows: [], provenance: 'manual' },
  };
}

async function quote(_req: QuoteRequest): Promise<QuoteResponse | null> {
  // RFQ-only — programmatic quote not available.
  return null;
}

async function history(_days: number): Promise<DailyPoint[]> {
  return [];
}

const adapter: Adapter = { id: PRODUCT_ID, snapshot, quote, history };
export default adapter;
