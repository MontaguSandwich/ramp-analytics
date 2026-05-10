// Server-side quote endpoint. Queries Peerlytics /deposits filtered by
// currency + (optional) payment methods, computes per-deposit-market quotes,
// returns ranked candidates by best rate.

const PEERLYTICS_BASE = 'https://peerlytics.xyz/api/v1';
const USDC_DECIMALS = 6;

interface QuoteRequestBody {
  fiat_amount: number;
  fiat_currency: string;
  payment_methods?: string[];
}

// Peerlytics v2 returns snake_case fields throughout despite older doc examples.
interface DepositMarketEntry {
  platform: string;
  currency: string;
  rate: number;
  spread_bps?: number;
  is_oracle_backed?: boolean;
}

interface DepositRow {
  id: string;
  depositor: string;
  remaining_deposits: string;
  intent_amount_min: string;
  intent_amount_max: string;
  accepting_intents: boolean;
  status: 'ACTIVE' | 'CLOSED';
  markets?: DepositMarketEntry[];
}

interface QuoteCandidate {
  platform: string;
  deposit_id: string;
  depositor: string;
  rate: number;
  spread_bps: number;
  usdc_received: number;
  min_fiat: number;
  max_fiat: number;
  remaining_usd: number;
  is_oracle_backed: boolean;
}

interface QuoteResponse {
  candidates: QuoteCandidate[];
  best_per_platform: QuoteCandidate[];
  request: QuoteRequestBody;
  ts: number;
}

export async function POST(req: Request) {
  let body: QuoteRequestBody;
  try {
    body = (await req.json()) as QuoteRequestBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (
    typeof body.fiat_amount !== 'number' ||
    body.fiat_amount <= 0 ||
    !body.fiat_currency
  ) {
    return Response.json({ error: 'missing_required_fields' }, { status: 400 });
  }

  const apiKey = process.env.ZKP2P_ANALYTICS_KEY;
  if (!apiKey) {
    return Response.json({ error: 'server_missing_api_key' }, { status: 500 });
  }

  const params = new URLSearchParams();
  params.set('currency', body.fiat_currency);
  params.set('status', 'ACTIVE');
  params.set('accepting', 'true');
  params.set('limit', '200');
  if (body.payment_methods?.length) {
    for (const p of body.payment_methods) params.append('platform', p);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${PEERLYTICS_BASE}/deposits?${params.toString()}`, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (e) {
    return Response.json(
      { error: 'upstream_failed', detail: (e as Error).message },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return Response.json(
      { error: 'upstream_error', status: upstream.status, body: text.slice(0, 500) },
      { status: 502 },
    );
  }

  const json = (await upstream.json()) as { data?: { deposits: DepositRow[] } };
  const deposits = json.data?.deposits ?? [];

  const wantedPlatforms = new Set(
    (body.payment_methods ?? []).map((p) => p.toLowerCase().replace(/\s+/g, '')),
  );

  const candidates: QuoteCandidate[] = [];
  for (const d of deposits) {
    if (d.status !== 'ACTIVE' || !d.accepting_intents) continue;
    if (!d.markets) continue;
    for (const m of d.markets) {
      if (m.currency.toLowerCase() !== body.fiat_currency.toLowerCase()) continue;
      if (
        wantedPlatforms.size &&
        !wantedPlatforms.has(m.platform.toLowerCase().replace(/\s+/g, ''))
      ) {
        continue;
      }
      if (typeof m.rate !== 'number' || m.rate <= 0) continue;

      const usdcReceived = body.fiat_amount / m.rate;
      const minUsdc = Number(d.intent_amount_min) / 10 ** USDC_DECIMALS;
      const maxUsdc = Number(d.intent_amount_max) / 10 ** USDC_DECIMALS;
      if (usdcReceived < minUsdc || usdcReceived > maxUsdc) continue;

      const remainingUsdc = Number(d.remaining_deposits) / 10 ** USDC_DECIMALS;
      // Skip if this deposit doesn't have enough USDC to cover the trade
      if (usdcReceived > remainingUsdc) continue;

      candidates.push({
        platform: m.platform,
        deposit_id: d.id,
        depositor: d.depositor,
        rate: m.rate,
        spread_bps: m.spread_bps ?? 0,
        usdc_received: usdcReceived,
        min_fiat: minUsdc * m.rate,
        max_fiat: maxUsdc * m.rate,
        remaining_usd: remainingUsdc * m.rate,
        is_oracle_backed: !!m.is_oracle_backed,
      });
    }
  }

  // Sort by rate ascending (lowest rate = most USDC per fiat = best for buyer).
  candidates.sort((a, b) => a.rate - b.rate);

  // Best per platform (one row per platform, smallest rate).
  const seenPlatforms = new Set<string>();
  const bestPerPlatform: QuoteCandidate[] = [];
  for (const c of candidates) {
    const key = c.platform.toLowerCase();
    if (seenPlatforms.has(key)) continue;
    seenPlatforms.add(key);
    bestPerPlatform.push(c);
  }

  const resp: QuoteResponse = {
    candidates: candidates.slice(0, 50),
    best_per_platform: bestPerPlatform,
    request: body,
    ts: Date.now(),
  };
  return Response.json(resp, {
    headers: {
      'cache-control': 's-maxage=20, stale-while-revalidate=60',
    },
  });
}
