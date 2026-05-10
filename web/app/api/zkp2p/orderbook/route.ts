// Server-side proxy to Peerlytics /orderbook. Keeps API key off the client.
// Caches for 20s on the edge; the underlying Peerlytics endpoint has its own
// 30s response cache, so polling faster than that wastes credits.

const PEERLYTICS_BASE = 'https://peerlytics.xyz/api/v1';

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
  // Allow multiple platform values
  for (const v of params.getAll('platform')) {
    if (v && !upstream.searchParams.getAll('platform').includes(v)) {
      upstream.searchParams.append('platform', v);
    }
  }

  try {
    const resp = await fetch(upstream.toString(), {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      cache: 'no-store',
    });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: {
        'content-type': 'application/json',
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
