# CLAUDE.md — agent context for this repo

> Read this **before** touching anything. It's the project's anti-hallucination
> ground truth. Decisions made here are not to be re-litigated unless the user
> explicitly reopens them.

## Project

Neutral, transparent comparison dashboard for crypto on/off-ramp products.
Local-first MVP. Working dir: this repo. Dev URL: `localhost:3017`.

Remote: `github.com/MontaguSandwich/ramp-analytics` (private).

## Per-product status

| product       | adapter | snapshot                                  | history          | detail page                              | orderbook | quote |
|---------------|---------|-------------------------------------------|------------------|------------------------------------------|-----------|-------|
| zkp2p (Peer)  | real    | ✓ live                                    | ✓ (90d backfill) | rich bespoke `Zkp2pDetail`               | ✓         | ✓     |
| binance_p2p   | rich    | ✓ live (USDT × ~71 markets, ~14% depth)   | ✗ (pending self-accum) | generic + tabs + info-grid + live rates  | ✓         | ✗     |
| ramp_network  | partial | ✓ basic                                   | ✗                | generic + info-grid (no tabs)            | ✗         | ✗     |
| kraken_otc    | stub    | static only                               | ✗                | generic + info-grid (no tabs)            | ✗         | ✗     |

## Architecture in five lines

1. Per-product adapter at `adapters/{id}.ts` exporting `{ id, snapshot, quote, history }`.
2. `scripts/snapshot.ts` runs every adapter's `snapshot()` and writes `data/snapshots/{id}.json` + appends to `data/charts/{id}_active_liquidity.json` (one row per UTC day, dedupe by day).
3. `scripts/history.ts` writes `data/charts/{id}.json` (zkp2p only — others return `[]`).
4. Next.js 15 frontend in `web/` (App Router). Server components do the filesystem reads via `web/lib/data.ts`. Client components only where interactivity is needed.
5. Snapshot fields are wrapped: `{ value, provenance, last_verified, evidence_url?, notes? }`. Provenance enum: `'onchain' | 'api' | 'self_reported' | 'manual' | 'unavailable'`. Color dots in UI: green = onchain/api, yellow = self_reported, gray = manual/unavailable. Use `'unavailable'` when a field's value is structurally not disclosed (e.g. Binance 30d volume) — UI renders "Not disclosed" + tooltip from `notes`.

## Data sources by product

- **zkp2p**: Peerlytics paid API (`x-api-key` from `ZKP2P_ANALYTICS_KEY` in `.env.local`). Envio GraphQL indexer for historical TVL backfill. `@zkp2p/sdk` for contract addresses + ABIs.
- **ramp_network**: Public REST (`api.rampnetwork.com/api/host-api/v3/...`) — `/assets`, `/payment-methods`, `/currencies` are key-less. `/onramp/quote/all` requires a `hostApiKey` we don't have.
- **binance_p2p**: Single public endpoint — `POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search`. No history, no aggregates.
- **kraken_otc**: No API. YAML + manual static fields only.

## Decisions locked — don't re-litigate

- Category enum value `'onchain'` is rendered as **"Onchain P2P"** in UI labels. The full mapping lives in `web/lib/format.ts` as `CATEGORY_LABEL`.
- Onchain category page (zkp2p) uses **`Zkp2pDetail` layout** dispatched by `id === 'zkp2p'` in `web/app/products/[id]/page.tsx`. Every other product uses the upgraded **`GenericDetail`** (`web/components/generic-detail.tsx`) which contains the 2×2 info grid (Properties / Coverage / Classification / Network Health) + optional Live Rates table. The legacy single-column Pricing / Trust sections were folded into Properties + Classification — don't restore them.
- Tab nav (`Overview · Orderbook · Get a Quote`) is **capability-driven**. Lives in `web/app/products/[id]/layout.tsx`, renders for any product with `snapshot.capabilities.orderbook === true` or `.quote === true`. Each tab is independently shown/hidden based on its own boolean. Backward-compat fallback in `TabNav` still grandfathers zkp2p when capabilities are absent on legacy snapshots.
- **`ProductHeader`** (`web/components/product-header.tsx`, renamed from `Zkp2pHeader`) is the universal header for tab-enabled products. Reads `yaml.display_name`, `yaml.category`, and `yaml.links` (with fallbacks to `yaml.website` / `yaml.docs_url` / `yaml.open_source.repo_url`). When wrapped, `GenericDetail` suppresses its own inline hero and just renders the intro paragraph from `yaml.description`.
- zkp2p `direction: 'on'` (on-ramp only from taker perspective).
- zkp2p `display_name: 'Peer'`; internal `name` stays `'zkp2p'`.
- `launched` field renders as **"Live since"** on the detail page.
- **Spread KPI** is `observed_spread_bps` rendered as **"Spread (~$1k)"** in the KPI strip, NOT a median anymore. Per-product math:
  - **binance_p2p**: USD-market cheapest ad whose `min/max single tx` accepts $1k and has ≥1000 USDT escrowed → spread of that single match. `spread_aggregation: 'effective_at_size'`, `period: 'usd_usdt_$1k_single_match'`, `sample_size: 1`.
  - **zkp2p**: walks USD Peerlytics orderbook levels in price-asc until $1k of USDC filled → liquidity-weighted avg rate vs Chainlink oracle mid. `period: 'usd_usdc_$1k_clob_walk'`, `sample_size: levels_walked`.
  - **ramp_network**: `provenance: 'unavailable'` — needs partner `hostApiKey` for real user-quoted spreads. The `/assets` reference price was misleading because it excludes payment-method fee (the dominant cost component).
  - **kraken_otc**: `provenance: 'unavailable'` — RFQ-only, no public feed.
  - KPI sub-line uses `spreadKpiSub()` (`web/components/generic-detail.tsx`) which translates the period into human form.
- KPI strip is exactly four cards: liquidity / 30d volume / Spread (~$1k) / KYC requirement. No fifth card. The liquidity label is **kind-aware**: "Available USDT" for `p2p_offerbook` (with "top 20 ads × N markets" sub-line), "Available liquidity" for `onchain_inventory`, "Daily capacity" for `ramp_capacity`, "Min ticket" for `otc_minimum`.
- **KYC KPI** renders as `<KycBadges pii={y.pii_floor} />` (dot-coloured pills: 🟢 Wallet / 🟠 Email / 🔴 ID / 🔴 Address / 🔴 Enhanced, cumulative per floor). Pure text fallback dropped. `KycBadges` + `kycKindsFor` live in `web/components/chips.tsx`, shared by `GenericDetail` and `Zkp2pDetail`. `KpiProps.value` is `ReactNode` in both components.
- Coverage card = what's *reachable* (fiats, platforms). Active counts (markets / makers / takers / deposits) live in Network Health.
- **Classification card has 5 badges** (not 4): Custody type, KYC requirements, Disputes settlement, Settlement, Proof of Reserves. Titles are fixed; descriptions are derived per-category in `ClassificationCard` (`generic-detail.tsx`). State (ok/warn/fail) still encodes user-friendliness so the colour signal carries. PoR is category-aware: `ok` for onchain (verifiable on-chain by design) or CEX with published PoR; `fail` for CEX without; `warn` for ramp/OTC. `Badge.desc` is `ReactNode` so PoR can embed a "View ↗" link to the source.
- Live rates table is **grouped per currency**, sorted by best spread ascending.
- Get a Quote uses **single-select platform dropdown** (matches currency pill aesthetic), default `Any platform`. No BUY/SELL/SEND tabs.
- Quote page layout is centered solo by default, splits 2-col when comparison panel has ≥1 row.
- Charts use **hand-rolled SVG**, no chart lib. Three charts on zkp2p detail: Liquidity available / Weekly on-ramp volume / Trades per day. Range chips: 7d / 30d / 90d / 1Y / All.
- **Standing-balance liquidity** for zkp2p comes from a self-accumulating daily log (`data/charts/{id}_active_liquidity.json`) + a one-time Envio backfill via `scripts/backfill-zkp2p-liquidity.ts`. Peerlytics' `analytics/overview.timeseries.liquidity` is **monotonically cumulative gross deposits**, NOT standing balance. Do not use it that way.
- Currency display: flag emoji from `snapshot.coverage.fiat_flags` (populated from Peerlytics `meta/currencies`).
- Platform display: simpleicons CDN with explicit white (`/ffffff`), inverted in light theme via CSS filter.
- Depositor addresses link to `https://basescan.org/address/{addr}` (BaseScan, opens in new tab).
- "Open in Peer" CTA on the Quote page links to `https://www.peer.xyz/swap?tab=buy` (no prefilled params — Peer handles its own state).
- **Binance "Available USDT" KPI** is `sum(surplus_amount across top 20 SELL ads × ~134 candidate fiats)` — covers ~14% of the full ad-book by count. The number is an honest undercount and is explicitly labeled "top 20 ads × N markets" in the sub-line. **Do not** call this TVL; it's an observed-offer-depth snapshot, not capital locked in a contract. Increasing depth means more HTTP calls (pagination) — current choice is rows=20 × ~134 fiats = 13.6% coverage.
- **Binance `tradeType: BUY`** in `adv/search` returns maker **SELL** ads (the side with escrowed USDT) — the only side worth summing for liquidity. BUY-side ads (makers wanting to buy USDT, paying fiat) lock no capital. Never sum across both sides.
- **`MultiSelectDropdown`** (`web/components/multi-select-dropdown.tsx`) is the reusable long-list multi-select. Compact pill → click → listbox with checkboxable rows, conditional search box when `options.length > 20`. Built to match Binance's C2C page pattern. Used in **both** orderbook views for fiat-aware payment-method pickers.
- **`CountBrowser`** (`web/components/count-browser.tsx`) is the reusable "long list compactor" used in `CoverageCard`. Renders `{count} ⓘ [search]`; click ⓘ to reveal a glyph-only grid below; type to filter to chip results inline. Generic via `glyphOf` / `labelOf` / `renderResult` callbacks. Specialized Client wrappers in `fiat-browser.tsx` and `payment-method-browser.tsx` exist so Server-Component callers (`GenericDetail`) don't have to cross the SSR boundary with function props.
- **`chips.tsx`** holds the pure-presentational chip components (`FiatChip`, `AssetChip`, `PaymentChip`, `PaymentGlyph`, `KycBadges`). No hooks → importable by both Server and Client Components.
- **Coverage type** (`lib/types.ts`) has `fiats_inactive?: string[]` (markets the product has withdrawn from — "transparency angle") and `payment_methods_by_fiat?: Record<string, string[]>` (per-fiat method lists; drives orderbook view's chip pool when fiat changes).
- **Live rates table** (`LiveRatesTable` in `generic-detail.tsx`) renders top 10 markets by USDT depth, filtered to those with FX mids available, sorted by best spread ascending. Currently only binance_p2p populates `snapshot.markets[]`.
- **Fiat flag emojis** come from `fiatFlagEmoji(code)` in `web/lib/format.ts` — programmatic from ISO 4217 → ISO 3166 regional indicators, with overrides for EUR/XAF/XOF/XCD/XPF. No per-fiat data fetch needed.
- **Crypto logos** come from `cryptoIconUrl(symbol)` (cryptocurrency-icons jsDelivr CDN), gated to a `KNOWN_CRYPTO_ICONS` allowlist so missing assets (e.g. FDUSD) render text-only chips instead of broken `<img>` tags (we render in Server Components — can't attach `onError`).
- **Payment method logos** come from `paymentMethodLogoSlug(name)` (simpleicons CDN). ~30 globally-recognized brands have entries; the long tail of regional banks renders a first-letter circle fallback. `paymentMethodLabel(name)` pretty-prints common slugs.
- **Venue Properties card** (`PropertiesCard` in `generic-detail.tsx`) has 4-6 rows: Category (colored badge via `tag cat-{category}`) / Direction (Onramp + Offramp pills, one or both) / Pricing / Live since / optional Audits / optional Contract. **Custody, Settlement, Proof of Reserves moved to Classification card.** Team transparency / Legal entity / Licenses were dropped.
- **Direction pills**: `tag-onramp` (green, `#34d399`) and `tag-offramp` (amber, `#f59e0b`). Container is `.direction-pills`.
- **Binance adapter probe stability**: `fetchAllMarkets` in `adapters/binance_p2p.ts` probes CANDIDATE_FIATS in **chunks of 10 with a 300ms gap between chunks** (PROBE_CHUNK_SIZE / PROBE_CHUNK_DELAY_MS). Single Promise.all of all 134 caused Binance's Cloudflare to shed requests randomly (coverage swung 13–91 markets between runs). Chunked probing gives steady 70–90 markets per run at ~25–30s total wall time. Do not re-introduce the un-chunked burst.
- **Orderbook stats strip is unified across products**: 4 cards (Liquidity / Active makers / Showing N (of M) / 24h volume). 24h volume is "Not disclosed" muted for products without a volume source (binance). zkp2p's old standalone "Best rates" panel was dropped — same info lives in each row's Spread column.

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
- **Binance `adv/search` returns duplicate `tradeMethods` entries** for the same `identifier` (one fully populated + N metadata-stripped clones). Always dedupe via `Array.from(new Set(...))` at the normalization layer. The orderbook API route does this; do the same in any new consumer of `tradeMethods`.
- **CoinGecko free tier is ~5–15 req/min** — too brittle for snapshot bursts touching many fiats. The disk cache at `data/cache/fx.json` (24h TTL, gitignored) makes this a non-issue after the first cold-run of the day. `fxMidBatch('USDT', [...fiats], ts)` is the right entry point — one HTTP call batched via `vs_currencies` comma-list. Set `COINGECKO_KEY=CG-...` for the demo tier (~30 req/min) if cold-run reliability matters (e.g. CI cron).
- **CoinGecko coverage is incomplete for exotic fiats** (VES, EGP, IRR, etc. return no rate). The adapter handles this by including such markets in the liquidity sum (USDT≈$1, no FX needed) but excluding them from the rates table and spread metric.
- **CANDIDATE_FIATS in `adapters/binance_p2p.ts` is hand-curated** and once silently dropped USD entirely (reorganization bug). When editing: cross-check the resulting `coverage.fiats` output is plausible and includes USD.
- **GitHub Actions snapshot cron fails when `ZKP2P_ANALYTICS_KEY` isn't set as a repo secret.** Workflow `.github/workflows/snapshot.yml` runs `*/30 * * * *`; zkp2p adapter errors when the key is missing and the snapshot script exits 1. Fix: `gh secret set ZKP2P_ANALYTICS_KEY --repo MontaguSandwich/ramp-analytics` (and ideally `COINGECKO_KEY` + `BASE_RPC_URL`). Alternative: change `scripts/snapshot.ts` to tolerate per-adapter failures.

## Files to read first

| if you're touching... | read these |
|---|---|
| Anything | `lib/types.ts` + `web/lib/types.ts` (mirror; keep in sync) |
| Adapter logic — zkp2p | `adapters/zkp2p.ts`, `lib/peerlytics.ts` (typed client) |
| Adapter logic — binance | `adapters/binance_p2p.ts` (CANDIDATE_FIATS, fxMidBatch priming, fetchAllMarkets) |
| Schema | `schema/product.schema.json`, `data/products/zkp2p.yaml` |
| Page dispatch | `web/app/products/[id]/page.tsx` (zkp2p → bespoke; everyone else → GenericDetail) |
| Generic detail page | `web/components/generic-detail.tsx` (info grid + LiveRatesTable + kind-aware KPI label) |
| Bespoke zkp2p page | `web/components/zkp2p-detail.tsx` |
| Tab nav / layout / header | `web/app/products/[id]/layout.tsx`, `web/components/tab-nav.tsx`, `web/components/product-header.tsx` (universal) |
| Charts | `web/components/protocol-charts.tsx` (hand-rolled SVG, zkp2p-only) |
| Quote | `web/components/quote-view.tsx` + `web/app/api/zkp2p/quote/route.ts` |
| Orderbook — zkp2p | `web/components/orderbook-view.tsx` + `web/app/api/zkp2p/orderbook/route.ts` |
| Orderbook — binance | `web/components/binance-p2p-orderbook-view.tsx` + `web/app/api/binance_p2p/orderbook/route.ts` |
| Long-list multi-select UX | `web/components/multi-select-dropdown.tsx` (reusable) |
| FX rates / disk cache | `lib/fx.ts` (`fxMid`, `fxMidBatch`, disk cache at `data/cache/fx.json`) |
| Cron entry | `scripts/snapshot.ts` (note: appends to liquidity log) |
| CI cron | `.github/workflows/snapshot.yml` (every 30 min, needs `ZKP2P_ANALYTICS_KEY` secret) |

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
- `COINGECKO_KEY=CG-...` (optional) — CoinGecko demo-tier key (~30 req/min). Local snapshot runs work fine without it thanks to the disk-cached FX (`data/cache/fx.json`, 24h TTL). Setting this matters more for the GitHub Actions cron, which has no disk cache between runs.
- `BASE_RPC_URL=https://...` (optional) — used by zkp2p adapter for onchain reads. Falls back to a public RPC if absent.

## Public API reference files at repo root

- `llm-full.json` — Peerlytics technical reference (markdown despite the extension)
- `api-zkp2p.json` — Peerlytics OpenAPI 3.1 spec

## Probing instead of guessing

When in doubt about an API's response shape: probe live. There's a `scripts/probe-peerlytics.ts` you can edit to test endpoints quickly:

```sh
npx tsx scripts/probe-peerlytics.ts
```

Modify it freely — it's a scratchpad, not part of the cron.
