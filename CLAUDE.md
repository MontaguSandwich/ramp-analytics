# CLAUDE.md — agent context for this repo

> Read this **before** touching anything. It's the project's anti-hallucination
> ground truth. Decisions made here are not to be re-litigated unless the user
> explicitly reopens them.

## Project

Neutral, transparent comparison dashboard for crypto on/off-ramp products.
Local-first MVP. Working dir: this repo. Dev URL: `localhost:3000`.

Remote: `github.com/MontaguSandwich/ramp-analytics` (private).

## Top-level dashboard tabs

The landing has 3 primary tabs (URL-routed, `MainNav` in `web/components/main-nav.tsx`):

| Tab | Path | What it does |
|---|---|---|
| **Overview** | `/` | Editorial intro + 4 hero stats + the full venues table (`ProductsView`). DefiLlama-style: the table IS the home view. Reads `?category=X` to pre-filter. |
| **Categories** | `/categories` | 4 editorial cards (vertical stack) describing each venue category. Click → `/?category=X` to land on the Overview pre-filtered. RTPN card is disabled state (0 venues yet). |
| **Aggregator** | `/aggregator` | Live cross-venue route comparator. Form (direction / amount / fiat / asset / method / KYC tolerance) → fans out to per-venue quote endpoints → ranked results. |

`/venues` was removed (the table moved to `/`). The dispatch in `web/app/products/[id]/page.tsx` is unchanged — product detail pages still render under `/products/[id]`.

## Per-product status

| product | adapter | snapshot | history | detail page | orderbook | quote | live rates direction toggle |
|---|---|---|---|---|---|---|---|
| zkp2p (Peer) | real | ✓ live | ✓ (90d) | bespoke `Zkp2pDetail` | ✓ | ✓ | n/a (onramp only) |
| binance_p2p | rich, both BUY+SELL | ✓ live (~14% depth × N markets × 2 dirs) | self-accum log only | `GenericDetail` (full) | ✓ | ✓ (direction-aware) | ✓ |
| ramp_network | full Approach B | ✓ live + approx rates | ✗ | `GenericDetail` (no orderbook) | ✗ | ✗ (Approach B in aggregator) | ✓ |

`kraken_otc` was **removed** during the OTC → RTPN category swap. Adapter, YAML, and snapshot deleted. RTPN category exists in the schema with 0 venues tracked — ready for Revolut etc.

Category enum: `'cex_p2p' | 'ramp' | 'onchain' | 'rtpn'`. `'otc'` is **gone**.

## Architecture in five lines

1. Per-product adapter at `adapters/{id}.ts` exporting `{ id, snapshot, quote, history }`. Wired in `adapters/index.ts`.
2. `scripts/snapshot.ts` runs every adapter's `snapshot()` and writes `data/snapshots/{id}.json` + appends to `data/charts/{id}_active_liquidity.json` (one row per UTC day, dedupe by day).
3. `scripts/history.ts` writes `data/charts/{id}.json` (zkp2p only — others return `[]`).
4. Next.js 15 frontend in `web/` (App Router). Server components do the filesystem reads via `web/lib/data.ts`. Client components only where interactivity is needed.
5. Snapshot fields are wrapped: `{ value, provenance, last_verified, evidence_url?, notes? }`. Provenance enum: `'onchain' | 'api' | 'self_reported' | 'manual' | 'unavailable'`. Color dots: green = onchain/api, yellow = self_reported, gray = manual/unavailable. Use `'unavailable'` when a field is structurally not disclosed (UI renders "Not disclosed" + tooltip from `notes`).

## Shared detail-page components (one source of truth)

These live as standalone files and are imported by both `GenericDetail` and `Zkp2pDetail`:

| Component | File | Purpose |
|---|---|---|
| `PropertiesCard` | `web/components/properties-card.tsx` | Venue Properties info card (category badge, direction pills, pricing layers, live since, audits, spread/deepest-pair/max-single-trade rows when snapshot provided) |
| `CoverageCard` | `web/components/coverage-card.tsx` | Fiats (FiatBrowser) / Settlement assets (unique symbols) / Settlement chains (union of `delivery_chains` + asset chains, off-chain sentinel handled) / Payment methods (PaymentMethodBrowser) / Withdrawn markets / Countries |
| `LiveRatesTable` | `web/components/live-rates-table.tsx` | Kind-aware (p2p_offerbook vs ramp_capacity), Onramp/Offramp toggle when `Market.direction` populated for both directions, Method column for ramp |
| `MixBar` | `web/components/mix-bar.tsx` | Horizontal bars for Market mix. Field name `amount_usd` is direction-agnostic (callers map volume or liquidity into it). Takes `renderLabel(item)` callback for chip rendering. |
| `DualBarChart` | `web/components/dual-bar-chart.tsx` | Per-fiat onramp/offramp dual horizontal bars (green/amber). Shared scale across rows. |
| `ChainChip` | `web/components/chips.tsx` | Plain text pill for chain names. Special-cases `'offchain'` sentinel with dashed border + italic + tooltip. |
| `AggregatorWidget` | `web/components/aggregator-widget.tsx` | Aggregator form + results table (client component, used by `/aggregator`). |
| `MainNav` | `web/components/main-nav.tsx` | Top-level tab nav (Overview / Categories / Aggregator). |

## Data sources by product

- **zkp2p**: Peerlytics paid API (`x-api-key` from `ZKP2P_ANALYTICS_KEY` in `.env.local`). Envio GraphQL indexer for historical TVL backfill. `@zkp2p/sdk` for contract addresses + ABIs.
- **ramp_network**: Public REST (`api.rampnetwork.com/api/host-api/v3/...`) — `/assets`, `/payment-methods`, `/currencies` are key-less. `/onramp/quote/all` requires a `hostApiKey` we don't have → Approach B (see decisions).
- **binance_p2p**: Single public endpoint — `POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search`. No history, no aggregates. Probed for both BUY and SELL sides (sequential).

## Decisions locked — don't re-litigate

### Detail-page layout

- zkp2p uses the bespoke `Zkp2pDetail` (charts + 3 subpages). Every other product uses `GenericDetail` (`web/components/generic-detail.tsx`).
- `Layout` (`web/app/products/[id]/layout.tsx`) **always renders** `ProductHeader` + container + back-link. Tab nav is gated on `snapshot.capabilities.orderbook === true || .quote === true`. zkp2p grandfathered.
- KPI strip is exactly 4 cards: liquidity / 30d volume / Spread (~$1k) / KYC requirement. The liquidity label is **kind-aware**:
  - `p2p_offerbook` → "Available USDT" + "top 20 ads × N markets" sub-line
  - `onchain_inventory` → "Available liquidity"
  - `ramp_capacity` → "Max single trade" (USD-equivalent, **NOT** the bogus sum of per-fiat single_tx_max — see lib/format.ts `snapshotTvlUsd`)
- Info grid: Properties / Coverage / Classification / **Marketplace dynamics** (renamed from "Network Health"). Marketplace dynamics is **gated**: only renders when `network_health.value.active_makers != null` (i.e. binance only currently — ramp/zkp2p use their own paths).
- Section order on `GenericDetail`: KPI strip → Info grid → Live rates → **Market mix** (under live rates) → Integration (collapsed `<details>`) → Raw data (collapsed `<details>`).

### Pricing layers (badges)

- `yaml.pricing.layers` is a `('maker_quote'|'venue_quote'|'venue_fee')[]` array rendered as pills in PropertiesCard. **Replaces** the freeform `spread_method` for display.
- Per-product mapping:
  - zkp2p: `[maker_quote]`
  - binance: `[maker_quote, venue_fee]`
  - ramp: `[venue_quote]`
- "Venue fee" = venue takes a separately-itemized commission on top of a maker-set price. Kraken (had `venue_quote` only) doesn't get "Venue fee" because its spread is intrinsic to the quote, not a separate layer.
- CSS: `.tag.tag-maker-quote` (blue), `.tag.tag-venue-quote` (purple), `.tag.tag-venue-fee` (amber).

### Settlement assets vs chains

- `CoverageCard` separates **Settlement assets** (unique asset symbols, deduped) from **Settlement chains** (union of `yaml.delivery_chains` + chains pulled from `yaml.assets[].chain`).
- CEX-P2P venues use the `'offchain'` sentinel in `delivery_chains`: settlement is to the venue's internal ledger, **not** a chain. `ChainChip` renders "Off-chain" with dashed-border italic styling and an explanatory tooltip.
- When `delivery_chains: ['offchain']`, asset-level `chain` entries are **ignored** (asset's native chain ≠ settlement venue for CEX). `isOffchainOnly` gate in `CoverageCard`.
- binance_p2p uses `[offchain]`. Ramp + zkp2p use real chains. kraken_otc had real chains too (institutional OTC settles direct to wallets typically) before it was removed.

### Spread KPI (`observed_spread_bps`)

- Always rendered as **"Spread (~$1k)"** in the KPI strip, with `spreadKpiSub()` (`web/lib/format.ts`) providing the sub-line.
- Per-product math:
  - **binance_p2p**: USD-market cheapest ad whose `min/max single tx` accepts $1k and has ≥1000 USDT escrowed → spread of that single match. `period: 'usd_usdt_$1k_single_match'`, `sample_size: 1`. Computed for BUY direction only (headline stays onramp-anchored).
  - **zkp2p**: walks USD Peerlytics orderbook in price-asc until $1k of USDC filled → liquidity-weighted avg rate vs Chainlink oracle mid. `period: 'usd_usdc_$1k_clob_walk'`.
  - **ramp_network**: USD card method's fee_bps (currently 245 per observed quote, see Approach B). `provenance: 'self_reported'`, `period: 'usd_$1k_quote_approximated'`.
- The KPI also lives on the Venue Properties card (slight duplication accepted — KPI = glance, properties = contextualized fact sheet).

### Marketplace dynamics card

- Renamed from "Network Health" (the old name was misleading — nothing in the card measures network-layer state).
- Gated on `snapshot.network_health?.value?.active_makers != null` — i.e. only renders when the adapter populates **maker aggregates**. Hidden for ramp/kraken; visible for binance.
- For binance the card shows 5 rows of maker-aggregate data: Active makers / Active ads / Avg maker finish-rate / Avg maker monthly orders / Merchant share. All computed by `adapters/binance_p2p.ts` from advertiser fields in the BUY probes (`monthFinishRate`, `monthOrderCount`, `userType`).
- For zkp2p (bespoke detail page) the equivalent rows are: Median fill / Avg fill / Active makers (30d) / Active takers (30d) / Active deposits. Same widget container in zkp2p-detail.tsx.

### Direction (onramp / offramp) — the Phase 1+2 work

- `Market.direction?: 'buy' | 'sell'` field on the type. Optional for backward compat.
- `LiveRatesTable` shows the toggle when both directions present in `snapshot.markets[]`. Default = onramp.
- **KPI strip stays onramp-anchored** regardless of the toggle. The toggle is a drilldown affordance on the Live rates table, not a stateful page-wide switch.
- Sign convention: **negative spread_bps = favorable for taker** in both directions. For SELL ads, `fetchAllMarkets` in `adapters/binance_p2p.ts` flips the sign so the convention is uniform.
- ramp adapter has `RAMP_FEE_BPS_BY_METHOD_BUY` + `_SELL` (sourced from docs). Emits 56 rows (28 fiats × 2 directions). PIX is buy-only per docs; ACH is sell-only.
- binance adapter probes both directions **sequentially** (parallel would 2× the burst hitting Cloudflare's rate-limit cliff). Snapshot wall time: ~30s → ~39s after enabling SELL probes.

### Aggregator (live cross-venue route comparison)

- Page: `/aggregator`. Widget: `web/components/aggregator-widget.tsx` (client).
- Backend: `/api/aggregator/quote` (`web/app/api/aggregator/quote/route.ts`).
- Fans out per-venue, in parallel:
  - **zkp2p**: POST to `/api/zkp2p/quote` (Peerlytics-backed). Onramp only.
  - **binance**: POST to `/api/binance_p2p/quote` (adv/search-backed). Direction-aware (BUY/SELL passed through as `tradeType`).
  - **ramp**: Approach B computed inline (no HTTP hop to ourselves). Mirrors the fee table from `adapters/ramp_network.ts` — **keep in sync** when fees update.
- KYC filter (`kyc_max: 'any' | 'none' | 'email' | 'id' | 'id+poa'`): per-venue `VENUE_KYC` constant in the aggregator route mirrors YAML `pii_floor`. Excluded venues are short-circuited before HTTP, returned as dimmed placeholder rows in the response with `notes: 'Excluded by KYC filter (venue requires id)'`.
- Fiat list on the form is the **live union** across `snapshot.coverage.value.fiats` from every venue (server-side load in `aggregator/page.tsx`, passed as `allFiats` prop). Sorted: popular (USD/EUR/GBP/BRL/CNY/INR/JPY) first, then A-Z.
- Response field `asset_amount` is **direction-agnostic**: for buy = asset user receives, for sell = asset user sends. Sort direction flips: buy = DESC (more = better), sell = ASC (less = better).
- Source pill per row: `'live'` (green) / `'approximated'` (yellow, ramp) / `'unavailable'` (gray, e.g. zkp2p on offramp).
- **Not in aggregator today**: country / KYC tier inputs for Ramp's jurisdiction-specific quoting. Visual polish vs the reference picker (custom modal with flags + platform logos) — see "Future goals" below.

### Ramp Network — Approach B pricing

- Decision (2026-05-17): use **Approach B** — hand-maintained payment-method fee table — instead of waiting for a partner hostApiKey.
- `adapters/ramp_network.ts` has `RAMP_FEE_BPS_BY_METHOD_BUY` and `RAMP_FEE_BPS_BY_METHOD_SELL` consts. **Edit these when Ramp publishes new fees** (https://rampnetwork.com/pricing-policy).
- Calibrated against user-observed quote: $1000 USD → 975.2 USDC.base = +245 bps all-in (likely card). Card buy fee set to 245 (well under the 390 bps docs ceiling for major fiats).
- Currency-tier handling for card-like methods: `MAJOR_CARD_FIATS = {USD, EUR, GBP}` get 245 bps; others get `CARD_EXOTIC_BPS_BUY = 545`. Implemented via `feeBpsFor(method, fiat, direction)`.
- The same fee table is **mirrored** in `web/app/api/aggregator/quote/route.ts` because the aggregator route computes ramp quotes inline (no HTTP hop to the adapter). **Keep in sync.**
- Ramp YAML's `pii_floor` is `'id'` per docs ("All purchases require identification document"). `kyc_tiers` restructured to the docs' US/EU ladder.
- The adapter populates `snapshot.markets[]` with 56 rows (28 fiats × 2 directions), each tagged with `direction: 'buy' | 'sell'`. Methods: PIX is buy-only, ACH is sell-only (per docs).

### Binance — offramp + maker aggregates + Market mix

- `fetchAllMarkets(now, fxMids, tradeType)` is parameterized: called twice sequentially in `snapshot()` (BUY then SELL).
- `total_observed_usd`, `markets_observed`, max single trade, maker aggregates, and the headline spread are **BUY-side only** (the "Available USDT" semantics).
- `snapshot.depth_composition` populates per-fiat with `buy_liquidity_usd` + `sell_liquidity_usd` + combined `liquidity_usd`. The Market mix section renders two cards side-by-side:
  1. **By USDT locked up** (`MixBar`) — sorted by BUY-side depth, share_pct recomputed against BUY-only total
  2. **Onramp vs Offramp** (`DualBarChart`) — sorted by combined depth, shared scale exposes asymmetry per fiat (MWK/HKD/KHR are heavily offramp-skewed)
- Surface area: 134 candidate fiats × 2 directions × top-20 ads each = ~270 HTTP calls per snapshot. Probed in chunks of 10 with 300ms gap between chunks (`PROBE_CHUNK_SIZE`, `PROBE_CHUNK_DELAY_MS`). Two passes run **sequentially**, not parallel — Cloudflare sheds under burst.

### Categories page

- Editorial cards (4 of them — Onchain P2P, CEX P2P, Ramps, Crypto-friendly RTPNs). Vertical stack (`.category-grid` is `display: flex; flex-direction: column`).
- Card title uses **brand-as-category-proxy** ("ZKP2P", "Binance P2P") not generic ("Onchain P2P"). Per user editorial decision. `CATEGORY_LABEL` map stays generic for the rest of the dashboard.
- Each card has: title + blurb + italic KYC note + venue list + CTA → links to `/?category=X` (the Overview pre-filtered).
- Disabled state for categories with 0 venues (RTPN currently).

### Other locked decisions

- `SPREAD_NEUTRAL_BPS = 10` on orderbook views (tightened from 25 so stablecoin spreads register green/amber instead of always-muted). Kept at 25 in `generic-detail.tsx` for the Marketplace dynamics card to avoid flicker.
- ZKP2P orderbook page: dropped "Top depositor" column (BaseScan link removed there); Pricing column renders binary "Fixed" / "Float" / "Mixed" (was `oracle · Chainlink`).
- ZKP2P orderbook page has a "Limits" column showing intent_min_usd – intent_max_usd per level. Server-side join via Peerlytics `/deposits?currency=X` (which requires a filter param). `lib/peerlytics.ts` `DepositRow` type is **snake_case** (Peerlytics v2 actually returns; the camelCase doc examples are stale).
- Orderbook stats strip: "Liquidity" shows the local-fiat total **plus** a USD sub-line ("≈ $42.8k") when a currency is selected — both zkp2p and binance views.
- Binance orderbook has FX mid + Spread columns (uses `lib/fx.ts`). Sign-flipped for SELL ads.
- `typedRoutes: false` in `web/next.config.ts` — friction vs benefit for our 3-route surface.
- `suppressHydrationWarning` on `<html>` in `web/app/layout.tsx` — Peer browser extension injects `data-peer-injected="true"` which triggers React's hydration mismatch otherwise.
- Categories on the Overview's "Categories breakdown" strip → **removed**. Cheapest $1k onramp callout → **removed** (not neutral; revisit for Aggregator later if wanted).
- Section order on Overview: editorial intro → 4 hero stats → "Venues" h2 → ProductsView table.

### KYC display

- KPI KYC badge uses `KycBadges` from `web/components/chips.tsx` (dot-coloured pills: 🟢 Wallet / 🟠 Email / 🔴 ID / 🔴 Address / 🔴 Enhanced, cumulative per floor).
- `kycKindsFor(pii)` maps `pii_floor` → array of kinds. zkp2p with `pii_floor: 'none'` AND `non_kyc_available: true` shows just Wallet.
- Aggregator KYC column shows venue's `pii_floor` directly ("None", "id", etc.).

## Hard constraints — anti-hallucination

- **Peerlytics is zkp2p-specific.** No equivalent exists for the other products.
- **Peerlytics v2 returns snake_case** field names everywhere. The doc examples in `llm-full.json` show camelCase — they're stale. Always probe live response shapes before typing them.
- **Peerlytics `analytics/*` ARE wrapped in `{ data: ... }`** despite the doc claiming otherwise.
- **Peerlytics `/deposits` requires a filter** (`currency`, `platform`, `depositor`, or `delegate`). Listing all deposits in one call is not possible.
- **Binance P2P** has NO public historical data. No volume series, no liquidity series.
- **Binance `tradeType: BUY`** in `adv/search` returns maker SELL ads (the escrowed side). `tradeType: SELL` returns maker BUY ads. `surplusAmount` is **always in USDT** regardless of direction.
- **Binance `adv/search` returns duplicate `tradeMethods` entries** for the same `identifier`. Always dedupe via `Array.from(new Set(...))` at the normalization layer.
- **Binance burst-rate cliff**: don't fire all 134 fiats in one Promise.all — Cloudflare sheds requests. Chunk 10 in parallel × 300ms inter-chunk pause. Don't probe both directions in parallel either.
- **Ramp `/onramp/quote/all`** requires a `hostApiKey`. Approach B is the current workaround.
- **Ramp `/currencies`** returns a top-level array (NOT wrapped in `{ data: ... }`). Inconsistent with other Ramp endpoints.
- **Don't put charts on non-zkp2p detail pages** — they don't have history data (binance has a self-accum liquidity log; charting is feasible once ~14 days accumulate from 2026-05-12).
- **CoinGecko free tier is ~5–15 req/min.** Disk cache at `data/cache/fx.json` (24h TTL, gitignored) is the right approach. `fxMidBatch('USDT', [...fiats], ts)` is the batch entry point. Some exotic fiats (VES, EGP, IRR) return no rate — adapter handles this.
- **CoinGecko's `SYMBOL_TO_ID`** in `lib/fx.ts` doesn't cover BNB or FDUSD; both return null. Aggregator + orderbook code handles this with "—" fallback.
- **Node 18 doesn't support `--env-file`.** Scripts import `dotenv/config` explicitly and load `.env.local`.
- **Don't `git add -A` casually.** Use specific paths or verify with `git status --short` after.
- **GitHub Actions snapshot cron needs `ZKP2P_ANALYTICS_KEY`** as repo secret. Workflow `.github/workflows/snapshot.yml` runs `*/30 * * * *`. Also ideally `COINGECKO_KEY` + `BASE_RPC_URL`.
- **Type-mirror duty**: any change to `lib/types.ts` MUST be mirrored in `web/lib/types.ts`. Same for the Ramp fee table (adapter file ↔ aggregator route).
- **MixBar's field is `amount_usd`** (not `volume_usd`) — direction-agnostic. Callers map `volume_usd` (Composition) or `liquidity_usd` (DepthBreakdown) into it.
- **`Fragment` shorthand `<>` can't take a `key` prop.** When a map iteration returns multiple sibling elements, use `<Fragment key={...}>` from `react`.

## Files to read first

| if you're touching... | read these |
|---|---|
| Anything | `lib/types.ts` + `web/lib/types.ts` (mirror; keep in sync) |
| Top-level nav / tabs | `web/components/main-nav.tsx`, `web/app/layout.tsx` |
| Overview / landing | `web/app/page.tsx`, `web/components/products-view.tsx` |
| Categories | `web/app/categories/page.tsx` |
| Aggregator | `web/app/aggregator/page.tsx`, `web/components/aggregator-widget.tsx`, `web/app/api/aggregator/quote/route.ts` |
| Product detail dispatch | `web/app/products/[id]/page.tsx` (zkp2p → bespoke; everyone else → GenericDetail) |
| Product detail layout | `web/app/products/[id]/layout.tsx` (always renders header; tab nav gated) |
| Generic detail page | `web/components/generic-detail.tsx` (info grid + Live rates + Market mix) |
| Bespoke zkp2p page | `web/components/zkp2p-detail.tsx` |
| Shared cards | `web/components/properties-card.tsx`, `coverage-card.tsx`, `live-rates-table.tsx`, `mix-bar.tsx`, `dual-bar-chart.tsx`, `chips.tsx` |
| Adapter — zkp2p | `adapters/zkp2p.ts`, `lib/peerlytics.ts` (typed client) |
| Adapter — binance (BUY + SELL probing) | `adapters/binance_p2p.ts` (CANDIDATE_FIATS, fetchAllMarkets, chunked probing) |
| Adapter — ramp (Approach B) | `adapters/ramp_network.ts` (RAMP_FEE_BPS_BY_METHOD_* tables) |
| Quote routes | `web/app/api/{zkp2p,binance_p2p,aggregator}/quote/route.ts` |
| Orderbook — zkp2p | `web/components/orderbook-view.tsx` + `web/app/api/zkp2p/orderbook/route.ts` |
| Orderbook — binance | `web/components/binance-p2p-orderbook-view.tsx` + `web/app/api/binance_p2p/orderbook/route.ts` |
| Schema | `schema/product.schema.json`, `data/products/*.yaml` |
| FX rates / disk cache | `lib/fx.ts` (`fxMid`, `fxMidBatch`, disk cache at `data/cache/fx.json`) |
| Cron entry | `scripts/snapshot.ts` (appends to liquidity log) |
| CI cron | `.github/workflows/snapshot.yml` (every 30 min, needs `ZKP2P_ANALYTICS_KEY` secret) |

## Workflow commands

```sh
npm run snapshot                     # refresh live snapshots (~40s after binance dual-direction)
npm run history                      # refresh daily history (~10s; zkp2p only produces data)
npm run backfill:zkp2p-liquidity     # one-time historical TVL backfill via Envio (~30s)
npm run validate                     # AJV-validate product YAMLs
npm run typecheck                    # root + adapter typecheck
npm run web:dev                      # Next.js dev server on localhost:3000 (default)
npm run web:typecheck                # web app typecheck
npm run web:build                    # production build
```

## Env vars (`.env.local`, gitignored)

- `ZKP2P_ANALYTICS_KEY=pk_live_...` — Peerlytics paid API key. Required for zkp2p snapshot/history/quote/orderbook. Symlinked from `web/.env.local` so Next.js picks it up.
- `COINGECKO_KEY=CG-...` (optional) — CoinGecko demo-tier key (~30 req/min). Local snapshot runs work fine without it thanks to the disk-cached FX. Matters more for CI cron.
- `BASE_RPC_URL=https://...` (optional) — used by zkp2p adapter for onchain reads. Falls back to a public RPC if absent.

## Public API reference files at repo root

- `llm-full.json` — Peerlytics technical reference (markdown despite the extension)
- `api-zkp2p.json` — Peerlytics OpenAPI 3.1 spec

## Probing instead of guessing

When in doubt about an API's response shape: probe live. There's a `scripts/probe-peerlytics.ts` you can edit to test endpoints quickly:

```sh
npx tsx scripts/probe-peerlytics.ts
```

For Binance / Ramp endpoints, just use `curl` directly — both are public and authless for the relevant routes.

## Future goals (parked, ready when revisited)

These were discussed and shelved with deliberate trade-offs noted. When revisiting, **start by re-reading the relevant section here**, not the original discussion (which may have been less developed):

### 1. Multi-page binance probing (~14% → ~80% coverage)
- Current: top-20 ads per market × 134 markets × 2 directions = ~270 calls. ~14% of full book.
- Sweet spot: **5 pages × adaptive stopping** (stop early when `total ≤ pages × 20`). Most markets have <500 ads; only ~25% need >2 pages.
- Cost: snapshot wall time ~70s → ~3 min.
- Benefit: "Available USDT" KPI currently understated ~7x ($12.94M observed → likely $80-100M actual). Maker aggregates also gain accuracy.
- Risk: Cloudflare rate-limit cliff. Tighten chunking if hitting it.
- Headline `$1k effective spread` KPI **does not change** — the cheapest USD ad always qualifies in top-20.

### 2. Aggregator — visual polish + extensions
- Replace styled `<select>` elements with **custom dropdowns** matching the reference picker (zkp2p's "Select currency & platform" modal — flags in dropdown rows, platform logos, status badges).
- Add **country input** for Ramp's jurisdiction-specific quoting.
- Add a **slippage curve** view ($100 / $1k / $10k effective spreads per venue) — different from current point-quote view.
- Asset list currently 4 stables/majors; expand to per-venue actual asset coverage if needed.

### 3. Ramp partner `hostApiKey`
- If/when acquired, replace Approach B with real `/onramp/quote/all` calls in `adapters/ramp_network.ts` and the inline aggregator copy. `quote()` already returns null when key absent — wired for the upgrade.
- Email: partnerships@ramp.network. Pitch: "neutral comparison dashboard wanting to surface accurate quotes."

### 4. p2p.army-style dual-orderbook "Constructor"
- Pro-trader workspace for cross-venue arb spotting. Discussed in detail; ranked as Option C ("don't build it") vs Option A ("Spreads" page = round-trip cost table).
- **Recommended phase 1**: ship Option A first (the consumer-friendly "Spreads" page). Data is already in snapshots. ~2-3h.
- Option B (dual-orderbook side-by-side comparator) only after Option A validates pro-curious audience exists. ~10h+.

### 5. Binance liquidity sparkline
- Self-accumulating log started 2026-05-12. Becomes visually meaningful around 2026-05-26 (~14 days).
- Same charting infrastructure as zkp2p (`web/components/protocol-charts.tsx`) — hand-rolled SVG, no chart lib.

### 6. Future RTPN product (Revolut etc.)
- Category slot exists with 0 venues. Add a YAML at `data/products/revolut.yaml` with `category: 'rtpn'`. Adapter pattern: likely a stub initially (Revolut has no public quote API for their crypto buy/sell flow).
- The Categories page card will auto-light up once a venue is added.
