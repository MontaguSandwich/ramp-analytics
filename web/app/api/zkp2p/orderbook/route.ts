// Server-side proxy to Peerlytics /orderbook + (when a currency filter is set) /deposits.
// Joins per-deposit intent_amount_min/max into each orderbook level so the view can show a
// "Limits" column. Falls back to the bare orderbook response if deposits enrichment fails.
//
// Caches for 20s on the edge; Peerlytics has its own 30s response cache, so polling faster
// than that wastes credits.

const PEERLYTICS_BASE = 'https://peerlytics.xyz/api/v1';
const USDC_DECIMALS = 6;

interface OrderbookDeposit {
  deposit_id: string;
  // …other fields ignored for enrichment
}

interface OrderbookLevel {
  deposits?: OrderbookDeposit[];
  intent_min_usd?: number; // injected
  intent_max_usd?: number; // injected
}

interface OrderbookCurrency {
  levels?: OrderbookLevel[];
}

interface OrderbookEnvelope {
  data?: { orderbooks?: OrderbookCurrency[] };
}

interface PeerlyticsDeposit {
  deposit_id: string;
  intent_amount_min?: string;
  intent_amount_max?: string;
}

interface DepositsEnvelope {
  data?: { deposits?: PeerlyticsDeposit[] };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = url.searchParams;

  const apiKey = process.env.ZKP2P_ANALYTICS_KEY;
  if (!apiKey) {
    return Response.json({ error: 'server missing ZKP2P_ANALYTICS_KEY' }, { status: 500 });
  }

  const upstream = new URL(`${PEERLYTICS_BASE}/orderbook`);
  const passthrough = ['currency', 'platform', 'minSize'];
  for (const k of passthrough) {
    const v = params.get(k);
    if (v != null && v !== '') upstream.searchParams.set(k, v);
  }
  for (const v of params.getAll('platform')) {
    if (v && !upstream.searchParams.getAll('platform').includes(v)) {
      upstream.searchParams.append('platform', v);
    }
  }

  const headers = { 'x-api-key': apiKey, accept: 'application/json' };
  const currency = params.get('currency');

  // Deposits enrichment only when a currency is selected — /deposits requires a filter
  // and per-currency stays a single extra call. Unfiltered "All (top 6)" view skips enrich.
  const depositsUrl = currency ? new URL(`${PEERLYTICS_BASE}/deposits`) : null;
  if (depositsUrl) {
    depositsUrl.searchParams.set('currency', currency!);
    depositsUrl.searchParams.set('status', 'ACTIVE');
    depositsUrl.searchParams.set('accepting', 'true');
    depositsUrl.searchParams.set('limit', '500');
  }

  try {
    const [obResp, depResp] = await Promise.all([
      fetch(upstream.toString(), { headers, cache: 'no-store' }),
      depositsUrl
        ? fetch(depositsUrl.toString(), { headers, cache: 'no-store' }).catch(() => null)
        : Promise.resolve(null),
    ]);

    // If orderbook itself fails, pass through.
    if (!obResp.ok) {
      const text = await obResp.text();
      return new Response(text, {
        status: obResp.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const obJson = (await obResp.json()) as OrderbookEnvelope;

    // Build deposit_id → {min_usd, max_usd} map from the deposits response (if we got one).
    const intentByDepositId = new Map<string, { min_usd: number; max_usd: number }>();
    if (depResp && depResp.ok) {
      try {
        const depJson = (await depResp.json()) as DepositsEnvelope;
        for (const d of depJson.data?.deposits ?? []) {
          if (!d.deposit_id) continue;
          const min = Number(d.intent_amount_min) / 10 ** USDC_DECIMALS;
          const max = Number(d.intent_amount_max) / 10 ** USDC_DECIMALS;
          if (Number.isFinite(min) && Number.isFinite(max)) {
            intentByDepositId.set(d.deposit_id, { min_usd: min, max_usd: max });
          }
        }
      } catch {
        // Deposits parse failed — proceed without enrichment.
      }
    }

    // Enrich each level: walk its deposits, pull intent ranges from the map, compute the
    // level-wide range = min(mins), max(maxes). Skip silently when no deposits resolve.
    if (intentByDepositId.size > 0) {
      for (const ob of obJson.data?.orderbooks ?? []) {
        for (const lvl of ob.levels ?? []) {
          let lvlMin = Infinity;
          let lvlMax = -Infinity;
          for (const d of lvl.deposits ?? []) {
            const r = intentByDepositId.get(d.deposit_id);
            if (!r) continue;
            if (r.min_usd < lvlMin) lvlMin = r.min_usd;
            if (r.max_usd > lvlMax) lvlMax = r.max_usd;
          }
          if (Number.isFinite(lvlMin) && Number.isFinite(lvlMax)) {
            lvl.intent_min_usd = lvlMin;
            lvl.intent_max_usd = lvlMax;
          }
        }
      }
    }

    return Response.json(obJson, {
      headers: {
        'cache-control': 's-maxage=20, stale-while-revalidate=60',
      },
    });
  } catch (e) {
    return Response.json(
      { error: 'upstream_failed', detail: (e as Error).message },
      { status: 502 },
    );
  }
}
