# CLAUDE.md — agent context for this repo

> Read this **before** touching anything. It's the project's anti-hallucination
> ground truth. Decisions made here are not to be re-litigated unless the user
> explicitly reopens them.

## Project

Neutral, transparent comparison dashboard for crypto on/off-ramp products.
Local-first MVP. Working dir: this repo. Dev URL: `localhost:3017`.

Remote: `github.com/MontaguSandwich/ramp-analytics` (private).

## Per-product status

| product       | adapter | snapshot     | history          | detail page         | orderbook | quote |
|---------------|---------|--------------|------------------|---------------------|-----------|-------|
| zkp2p (Peer)  | real    | ✓ live       | ✓ (90d backfill) | rich `Zkp2pDetail`  | ✓         | ✓     |
| ramp_network  | partial | ✓ basic      | ✗                | generic legacy      | ✗         | ✗     |
| binance_p2p   | partial | ✓ basic      | ✗                | generic legacy      | ✗         | ✗     |
| kraken_otc    | stub    | static only  | ✗                | generic legacy      | ✗         | ✗     |

## Architecture in five lines

1. Per-product adapter at `adapters/{id}.ts` exporting `{ id, snapshot, quote, history }`.
2. `scripts/snapshot.ts` runs every adapter's `snapshot()` and writes `data/snapshots/{id}.json` + appends to `data/charts/{id}_active_liquidity.json` (one row per UTC day, dedupe by day).
3. `scripts/history.ts` writes `data/charts/{id}.json` (zkp2p only — others return `[]`).
4. Next.js 15 frontend in `web/` (App Router). Server components do the filesystem reads via `web/lib/data.ts`. Client components only where interactivity is needed.
5. Snapshot fields are wrapped: `{ value, provenance, last_verified, evidence_url?, notes? }`. Provenance enum: `'onchain' | 'api' | 'self_reported' | 'manual'`. Color dots in UI: green = onchain/api, yellow = self_reported, gray = manual.

## Data sources by product

- **zkp2p**: Peerlytics paid API (`x-api-key` from `ZKP2P_ANALYTICS_KEY` in `.env.local`). Envio GraphQL indexer for historical TVL backfill. `@zkp2p/sdk` for contract addresses + ABIs.
- **ramp_network**: Public REST (`api.rampnetwork.com/api/host-api/v3/...`) — `/assets`, `/payment-methods`, `/currencies` are key-less. `/onramp/quote/all` requires a `hostApiKey` we don't have.
- **binance_p2p**: Single public endpoint — `POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search`. No history, no aggregates.
- **kraken_otc**: No API. YAML + manual static fields only.

## Decisions locked — don't re-litigate

- Category enum value `'onchain'` is rendered as **"Onchain P2P"** in UI labels.
- Onchain category page (zkp2p) uses **`Zkp2pDetail` layout** dispatched by `id === 'zkp2p'` in `web/app/products/[id]/page.tsx`. Other products fall through to the legacy generic page.
- Tab nav (`Overview · Orderbook · Get a Quote`) is **zkp2p-only**. Lives in `web/app/products/[id]/layout.tsx` behind `id === 'zkp2p'`.
- zkp2p `direction: 'on'` (on-ramp only from taker perspective).
- zkp2p `display_name: 'Peer'`; internal `name` stays `'zkp2p'`.
- `launched` field renders as **"Live since"** on the detail page.
- **Median spread** lives in the Network Health card, not the KPI strip.
- KPI strip is exactly: Available liquidity / 30d volume / Custody type / KYC requirement. No fifth card.
- Coverage card = what's *reachable* (fiats, platforms). Active counts (markets / makers / takers / deposits) live in Network Health.
- Classification badges = Self Custody, No KYC, Open Source, Onchain Settlement (4 total). "Permissionless" and "Audited" badges are explicitly dropped.
- Live rates table is **grouped per currency**, sorted by best spread ascending.
- Get a Quote uses **single-select platform dropdown** (matches currency pill aesthetic), default `Any platform`. No BUY/SELL/SEND tabs.
- Quote page layout is centered solo by default, splits 2-col when comparison panel has ≥1 row.
- Charts use **hand-rolled SVG**, no chart lib. Three charts on zkp2p detail: Liquidity available / Weekly on-ramp volume / Trades per day. Range chips: 7d / 30d / 90d / 1Y / All.
- **Standing-balance liquidity** for zkp2p comes from a self-accumulating daily log (`data/charts/{id}_active_liquidity.json`) + a one-time Envio backfill via `scripts/backfill-zkp2p-liquidity.ts`. Peerlytics' `analytics/overview.timeseries.liquidity` is **monotonically cumulative gross deposits**, NOT standing balance. Do not use it that way.
- Currency display: flag emoji from `snapshot.coverage.fiat_flags` (populated from Peerlytics `meta/currencies`).
- Platform display: simpleicons CDN with explicit white (`/ffffff`), inverted in light theme via CSS filter.
- Depositor addresses link to `https://basescan.org/address/{addr}` (BaseScan, opens in new tab).
- "Open in Peer" CTA on the Quote page links to `https://www.peer.xyz/swap?tab=buy` (no prefilled params — Peer handles its own state).

## Hard constraints — anti-hallucination

- **Peerlytics is zkp2p-specific.** No equivalent exists for the other three products. Don't propose querying Peerlytics for them.
- **Peerlytics v2 returns snake_case** field names everywhere. The doc examples in `llm-full.json` show camelCase — they're stale. Always probe live response shapes before typing them.
- **Peerlytics doc lies about envelopes.** `analytics/{summary,overview,leaderboard}` ARE wrapped in `{ data: ... }` in v2, despite the doc claiming otherwise.
- **Binance P2P** has NO public historical data. No volume series, no liquidity series. Any historical chart needs self-accumulation starting from today.
- **Ramp Network** quote endpoint requires a `hostApiKey` we don't have. Their public asset/method/currency endpoints work without auth.
- **Kraken OTC** has no public API. Voice/chat RFQ only. Adapter stays static.
- **Don't put charts on non-zkp2p detail pages** — they don't have history data.
- **Don't put the 4-info-card layout on non-zkp2p detail pages** until those adapters can populate `coverage`, `composition`, `network_health`, and `markets`. Most can only populate `coverage`.
- **Node 18 doesn't support `--env-file`.** `scripts/{snapshot,history,backfill-*}.ts` import `dotenv/config` explicitly and load `.env.local`.
- **Don't `git add -A` casually.** Use specific paths or verify with `git status --short` after `git add .` to confirm nothing sensitive is staged.

## Files to read first

| if you're touching... | read these |
|---|---|
| Anything | `lib/types.ts` (Snapshot/Coverage/etc. types) |
| Adapter logic | `adapters/zkp2p.ts` (reference), `lib/peerlytics.ts` (typed client) |
| Schema | `schema/product.schema.json`, `data/products/zkp2p.yaml` |
| Detail page | `web/components/zkp2p-detail.tsx` (rich), `web/app/products/[id]/page.tsx` (dispatch + legacy) |
| Tab nav / layout | `web/app/products/[id]/layout.tsx`, `web/components/tab-nav.tsx`, `web/components/zkp2p-header.tsx` |
| Charts | `web/components/protocol-charts.tsx` (hand-rolled SVG) |
| Quote | `web/components/quote-view.tsx` + `web/app/api/zkp2p/quote/route.ts` |
| Orderbook | `web/components/orderbook-view.tsx` + `web/app/api/zkp2p/orderbook/route.ts` |
| Cron entry | `scripts/snapshot.ts` (note: appends to liquidity log) |

## Workflow commands

```sh
npm run snapshot                     # refresh live snapshots (~30s)
npm run history                      # refresh daily history (~10s; zkp2p only produces data)
npm run backfill:zkp2p-liquidity     # one-time historical TVL backfill via Envio (~30s)
npm run validate                     # AJV-validate product YAMLs
npm run typecheck                    # root + adapter typecheck
npm run web:dev                      # Next.js dev server on localhost:3017
npm run web:typecheck                # web app typecheck
npm run web:build                    # production build
```

## Env vars (`.env.local`, gitignored)

- `ZKP2P_ANALYTICS_KEY=pk_live_...` — Peerlytics paid API key. Required for zkp2p snapshot/history/quote/orderbook. Symlinked from `web/.env.local` so Next.js picks it up.

## Public API reference files at repo root

- `llm-full.json` — Peerlytics technical reference (markdown despite the extension)
- `api-zkp2p.json` — Peerlytics OpenAPI 3.1 spec

## Probing instead of guessing

When in doubt about an API's response shape: probe live. There's a `scripts/probe-peerlytics.ts` you can edit to test endpoints quickly:

```sh
npx tsx scripts/probe-peerlytics.ts
```

Modify it freely — it's a scratchpad, not part of the cron.
