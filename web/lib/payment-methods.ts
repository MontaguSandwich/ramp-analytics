/**
 * Canonical payment methods for the Aggregator, mapped to each venue's own identifiers.
 *
 * WHY THIS EXISTS. The aggregator used to send one raw string to every venue. But the
 * venues don't share a taxonomy: Ramp uses a SCREAMING_SNAKE enum (`MANUAL_BANK_TRANSFER`),
 * Binance uses its own catalogue (`SEPA`, `SEPAinstant`, `BANK`, `Wise`, `Zelle`, `Pix`),
 * and zkp2p uses display names (`Cash App`, `Revolut`). So picking "Bank transfer (SEPA)"
 * sent Ramp's identifier to Binance, which matched nothing and returned an empty book —
 * the venue was silently dropped from the comparison even though it had ads to quote.
 * Measured 2026-07-22 on EUR/USDC $1k: with no method filter all three venues quoted
 * (Binance 1131.22, zkp2p 1121.26, Ramp 1113.04); with `MANUAL_BANK_TRANSFER` only Ramp
 * survived. A comparison tool that eliminates competitors through a taxonomy mismatch is
 * worse than one with no filter at all.
 *
 * HOW TO EXTEND. Identifiers below are verified against live venue coverage
 * (`snapshot.coverage.value.platforms` for binance/zkp2p, Ramp's documented enum). Do NOT
 * add an identifier you haven't seen in that data — an invented one silently zeroes the
 * venue, which is exactly the bug this file exists to prevent. A venue absent from a
 * method's `venues` map means "this venue genuinely does not offer it", and the aggregator
 * renders an explicit unavailable row saying so.
 */

export type VenueId = 'zkp2p' | 'binance_p2p' | 'ramp_network' | 'revolut_ramp';

export interface CanonicalMethod {
  id: string;
  label: string;
  /** Venue-native identifiers. Absent venue = method not offered there. */
  venues: Partial<Record<VenueId, string[]>>;
}

/**
 * Ordered for the picker: broadly-supported rails first, then single-venue wallets.
 * `revolut_ramp` never appears — its quote endpoint takes no payment-method parameter
 * (it prices card/bank generically), so filtering by method can't apply to it.
 */
export const PAYMENT_METHODS: CanonicalMethod[] = [
  {
    id: 'bank_transfer',
    label: 'Bank transfer',
    venues: {
      ramp_network: ['MANUAL_BANK_TRANSFER'],
      binance_p2p: ['BANK', 'SpecificBank'],
    },
  },
  {
    id: 'sepa',
    label: 'SEPA (EUR bank transfer)',
    venues: {
      ramp_network: ['MANUAL_BANK_TRANSFER'],
      binance_p2p: ['SEPA', 'SEPAinstant', 'BANK'],
    },
  },
  {
    id: 'card',
    label: 'Card',
    venues: {
      ramp_network: ['CARD_PAYMENT'],
      binance_p2p: ['VISADirect', 'MastercardSend'],
    },
  },
  {
    id: 'apple_pay',
    label: 'Apple Pay',
    venues: { ramp_network: ['APPLE_PAY'] },
  },
  {
    id: 'google_pay',
    label: 'Google Pay',
    venues: { ramp_network: ['GOOGLE_PAY'] },
  },
  {
    id: 'open_banking',
    label: 'Easy bank transfer (open banking)',
    venues: { ramp_network: ['AUTO_BANK_TRANSFER'] },
  },
  {
    id: 'pix',
    label: 'PIX',
    venues: { ramp_network: ['PIX'], binance_p2p: ['Pix'] },
  },
  {
    id: 'wise',
    label: 'Wise',
    venues: { binance_p2p: ['Wise'], zkp2p: ['Wise'] },
  },
  {
    id: 'zelle',
    label: 'Zelle',
    venues: { binance_p2p: ['Zelle'], zkp2p: ['Zelle'] },
  },
  { id: 'revolut', label: 'Revolut', venues: { zkp2p: ['Revolut'] } },
  { id: 'venmo', label: 'Venmo', venues: { zkp2p: ['Venmo'] } },
  { id: 'cashapp', label: 'Cash App', venues: { zkp2p: ['Cash App'] } },
  { id: 'paypal', label: 'PayPal', venues: { zkp2p: ['PayPal'] } },
  { id: 'monzo', label: 'Monzo', venues: { zkp2p: ['Monzo'] } },
  { id: 'chime', label: 'Chime', venues: { zkp2p: ['Chime'] } },
  { id: 'mercado_pago', label: 'Mercado Pago', venues: { zkp2p: ['Mercado Pago'] } },
];

const BY_ID = new Map(PAYMENT_METHODS.map((m) => [m.id, m]));

export function methodById(id: string | undefined): CanonicalMethod | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/**
 * Venue-native identifiers for a canonical method.
 *  - `undefined` method (user chose "Any") → `[]`, meaning "don't filter".
 *  - method the venue doesn't offer → `null`, meaning "exclude with an explanation".
 */
export function venueMethodIds(venue: VenueId, methodId: string | undefined): string[] | null {
  if (!methodId) return [];
  const m = BY_ID.get(methodId);
  if (!m) return null;
  return m.venues[venue] ?? null;
}

/** Human-readable list of venues offering a method — drives the picker's sub-label. */
export function venuesSupporting(methodId: string): VenueId[] {
  return (Object.keys(BY_ID.get(methodId)?.venues ?? {}) as VenueId[]).sort();
}

export const VENUE_LABEL: Record<VenueId, string> = {
  zkp2p: 'Peer',
  binance_p2p: 'Binance P2P',
  ramp_network: 'Ramp Network',
  revolut_ramp: 'Revolut Ramp',
};
