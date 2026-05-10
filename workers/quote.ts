import { adapters } from '../adapters/index.ts';
import type { QuoteRequest, QuoteResponse } from '../lib/types.ts';

interface Env {
  QUOTE_CACHE: KVNamespace;
  BASE_RPC_URL: string;
}

const CACHE_TTL_SEC = 60;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('POST only', { status: 405 });
    }

    let body: QuoteRequest;
    try {
      body = (await req.json()) as QuoteRequest;
    } catch {
      return new Response('invalid json', { status: 400 });
    }

    const cacheKey = JSON.stringify({
      d: body.direction,
      a: bucket(body.amount),
      f: body.fiat,
      s: body.asset,
      c: body.chain,
      p: body.payment_method,
    });

    const cached = await env.QUOTE_CACHE.get<QuoteResponse[]>(cacheKey, 'json');
    if (cached) return Response.json(cached);

    const settled = await Promise.allSettled(adapters.map((a) => a.quote(body)));
    const quotes = settled
      .filter((r): r is PromiseFulfilledResult<QuoteResponse | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((q): q is QuoteResponse => q !== null)
      .sort((a, b) => a.effective_rate_bps - b.effective_rate_bps);

    await env.QUOTE_CACHE.put(cacheKey, JSON.stringify(quotes), { expirationTtl: CACHE_TTL_SEC });
    return Response.json(quotes);
  },
};

function bucket(amount: number): string {
  const log = Math.floor(Math.log10(Math.max(amount, 1)));
  return `1e${log}`;
}
