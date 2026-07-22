# DESIGN_NOTES.md — DefiLlama-skin redesign

Branch: `design/defillama-skin`. Visual layer only: zero behavior changes, zero data
changes, zero user-facing text changes. Plain CSS + custom properties; the only new
"dependency" is Inter via `next/font` (built into Next.js, self-hosted at build time).

Token values were observed from the live defillama.com dark theme (custom-property
values inspected in their served CSS) and recreated by hand — no CSS, assets, or
imagery copied. Per the brief, the live site wins over the brief's approximate hexes
(e.g. brand blue is the live `#1f67d2`, not the approximate `#2172e5`).

## Final token table

All tokens live in `:root` in `web/app/globals.css`. Everything in the file consumes
them; no stray hexes outside `:root` (the single exception is the USDC glyph gradient
inside `.quote-asset-logo`, a pictorial icon, not a theme color).

### Surfaces

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#090b0c` | page background |
| `--bg-elev` | `#131516` | cards, table wrap, inputs-on-cards |
| `--bg-overlay` | `#181a1b` | dropdown panels (msd) |
| `--bg-raise` | `#1c1f22` | hovered/raised elements, active toggle segments |
| `--code-bg` | `#101314` | inline code in docs prose |

### Borders & interaction tints (white-alpha scale)

| Token | Value | Used for |
|---|---|---|
| `--border-subtle` | `rgba(255,255,255,.05)` | row separators |
| `--border` | `rgba(255,255,255,.07)` | default hairline |
| `--border-strong` | `rgba(255,255,255,.14)` | control borders, hover hairline |
| `--row-hover` | `rgba(255,255,255,.03)` | table row hover |

### Text

| Token | Value | Used for |
|---|---|---|
| `--fg` | `#ffffff` | primary |
| `--fg-dim` | `#c6c6c6` | secondary (body copy, table text) |
| `--fg-mute` | `#878787` | tertiary (labels, captions, footers) |
| `--fg-disabled` | `#5c6370` | absent-value dashes (`.na`), disabled |

### Brand, links, semantic

| Token | Value | Used for |
|---|---|---|
| `--brand` | `#1f67d2` | header bar, primary buttons, active fills |
| `--brand-hover` | `#1a58b4` | primary-button hover |
| `--on-brand` | `#ffffff` | text/icons on brand/accent fills |
| `--accent` | `#4b86db` | links, focus rings, active tab underline, table entity names, chart volume |
| `--accent-bright` | `#7aa5e8` | link hover |
| `--accent-tint` | `rgba(75,134,219,.12)` | active filter-pill background |
| `--green` | `#3fb68b` | favorable spreads, onramp, live/best states |
| `--red` | `#e24a42` | unfavorable, errors (`--warn` aliases) |
| `--amber` | `#ff8e2b` | offramp series, venue-fee cost signal |
| `--yellow` | `#facc15` | provenance: self-reported |
| `--gray` | `#6b7280` | provenance: manual/unavailable |
| `--prov-good/mid/low` | aliases → green/yellow/gray | provenance dots (semantics unchanged) |

### Accents (editorial color-coding, hues unchanged from before)

| Token | Value |
|---|---|
| `--cat-onchain` / `--cat-cex_p2p` / `--cat-ramp` / `--cat-rtpn` | green / yellow / `#60a5fa` / `#c084fc` |
| `--price-maker-quote` / `--price-venue-quote` / `--price-venue-fee` | `#60a5fa` / `#a78bfa` / amber |
| `--kyc-wallet` / `--kyc-email` / `--kyc-id` | green / amber / red |
| `--chart-1` / `--chart-2` / `--chart-3` | accent (volume) / green (liquidity) / `#c084fc` (trades) |

### Type, spacing, radius, elevation, motion

| Token | Value |
|---|---|
| `--font-sans` | `var(--font-inter), ui-sans-serif, system-ui, …` (Inter via next/font, weights 400–700) |
| `--font-mono` | ui-monospace stack — only for `.code` (raw-data paths, contract addresses, API routes) |
| `--fs-xs/sm/md/base/lg/xl/2xl/3xl/4xl` | 11 / 12 / 13 / 14 / 16 / 20 / 24 / 28 / 32px |
| `--sp-1…--sp-16` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64px |
| `--r-sm` / `--r-md` / `--r-lg` / `--r-full` | 6px controls / 8px / 12px cards+tables / pills |
| `--shadow-pop` | `0 8px 24px rgba(0,0,0,.45)` |
| `--ease` | `120ms ease` — all interaction transitions, color/opacity/background only |
| `--chrome-h` | `97px` — sticky offset (56px blue bar + tab row) for table headers and docs sidebar |

Numbers use Inter + `font-variant-numeric: tabular-nums` everywhere (the `.mono`
class name is kept for call-site stability but now means "aligned numeric").

## Per-surface summary

### Tokens (commit 1)
Full `:root` rewrite into the scale above; light-theme media queries deleted (dark
only, `color-scheme: dark`); Inter loaded in `layout.tsx` with `display: swap`;
`.code` split from `.mono` (generic-detail raw data, binance orderbook API path);
`P/` favicon added (`web/public/favicon.svg` via `metadata.icons`).

### Primitives (commit 2)
- **Chip system**: ONE display-chip geometry (22px / 6px / 11px-500), color variants
  only — category ×4, direction ×2, pricing ×3, source ×3 (new), chain (+dashed
  off-chain sentinel kept), KYC badge, fiat/platform/asset chips. Hover `title`
  tooltips all preserved.
- **Controls**: one 32px height for filter pills, selects (with hand-drawn chevron),
  Clear/.csv buttons; active pill = blue tint + blue text (was inverted white-on-black).
- **Table base**: 44px rows, sticky header, 11px uppercase mute headers, hairline
  separators, row hover, edge gutters, horizontal scroll contained in the card.
- **Buttons**: primary = brand blue (aggregator submit, quote CTA — was inverted
  white); outline `.cta-link` (+ new `-sm`); text `.link-btn` blue.
- **Inputs**: one border language (strong → mute hover → accent focus), normalized
  heights; `outline:none` removed so keyboard users keep the global focus ring.
- **Cards**: 12px radius, consistent 16px padding.
- **Focus**: global `:focus-visible` blue outline; `::selection` tint; thin scrollbars;
  dark `<option>`.
- **Dead CSS removed** (confirmed unused via grep): `highlight-*`, `venue-card-*`,
  `placeholder-*`, `best-rate-*`, `detail-hero-*`, `dot-good/mid/low`, `evidence`,
  `pname-sub`, `section-title`, `platform-grid`, `quote-platform-chips`,
  `platform-toggle-*`.

### Chrome (commit 3)
Two-row sticky header: 56px solid brand-blue bar (white "Payments/ OOI" wordmark +
tagline, Methodology link right) over a page-background tab row (quiet muted tabs,
blue active underline, no button backgrounds). Detail-page `.tab-nav` shares the
language.

### Overview (commit 4)
Hero stats became flat cards (label/600-value/sub); venues table gets DefiLlama
grammar — numeric columns right-aligned (`# Fiats`, `# Methods`, `Spread (~$1k)*`,
`30d volume`, `Available liquidity`, `Liquidity: 14d trend`), venue name as
brand-blue link, absent values as disabled-color dashes, inset expansion rows.
Sparklines quiet neutral, right-aligned. All inline styles on `/` eliminated.

### Venue detail pages (commit 5)
KPI strip (exactly 4 cards, untouched order/content) with tabular numerals; ONE
micro-label rule for all card/KPI/filter/stat labels (11px uppercase 600 mute); live
rates tables right-aligned numerics; spread cells use `.spread-val` with a
`--spread-color` CSS variable (dynamic sign color preserved without inline color);
`cursor: help` → `.tip`; chart palette hexes → `--chart-*`; SVGs sized via
`.chart-svg`; dual-bar series via `color-mix` of green/amber.

### Orderbooks, Aggregator, Categories, Methodology, Quote tabs (commit 6)
Both orderbook views: numeric columns, `.spread-val`, stat-sub classes, error variant
`.no-results.is-error`, dead `alignSelf`/`minWidth` inline styles removed (container
already aligns `flex-end`). Aggregator: source pills join the chip system (identical
●/◐/✕ text), Results h2 styled, direction segmented control aligned with the
live-rates toggle, best-route callout in green-tint card. Quote tabs: brand-blue CTA;
the app's only inline style *reset block* (asset-pill `<select>`) folded into CSS
(`:has(select)` + bare-select rules); `.tag-xs` for dense comparison cells.
Methodology: prose tables shielded from data-table grammar (no sticky/uppercase/44px
rows/edge-gutters); sidebar sticks below the chrome; everything tokenized.

### Coherence sweep (commit 7 + 8)
- Every remaining inline `style={{}}` in the app is now data-driven and
  intentionally kept: provenance dot backgrounds, bar widths, `--spread-color`,
  stale-quote dots, msd `maxHeight`, KYC dot vars. Zero purely-visual inline styles.
- **Bug found & fixed**: Inter was silently falling back to Times — next/font's
  `--font-inter` was on `<body>` while `--font-sans` is defined on `:root`; CSS
  custom properties substitute at the element where they're *defined*, so
  `--font-sans` computed guaranteed-invalid. `inter.variable` moved to `<html>`.
- **Bug found & fixed**: table rows rendered 50.5px not 44px — direction pills
  wrapped to two lines (now `nowrap`), venue names wrapped (now `nowrap`).
- Clip breakpoint raised 1180→1280px so nowrap tables can never be clipped without
  scroll.
- `--on-brand` token for white-on-blue text; reduced-motion guard for bar-fill
  width transitions.
- Verified via headless Chrome + CDP: computed-style assertions (bg/surface/brand/
  link colors, 44px rows, 11px uppercase headers, 22px tags, 32px controls, 12px
  radii, tabular KPIs, Inter) and 21 behavioral checks all pass; horizontal scroll
  checked at 1440/1024/390 on all 13 routes — no body overflow anywhere.

## Deviations from DefiLlama's pattern (and why)

1. **Sparklines are neutral gray, not accent-colored.** DefiLlama's table sparklines
   are quiet thin lines; accent-blue sparklines would fight the blue venue links in
   the same row.
2. **Category/direction/pricing/KYC color-coding kept from the old design** (hues,
   re-tokenized). The brief mandates "restyle, don't re-map": these are editorial
   semantics DefiLlama doesn't have an equivalent for (their categories are just
   text). Geometry is unified; only the hues differ from a pure DefiLlama palette.
3. **Provenance traffic-light (green/yellow/gray) kept.** It's this dashboard's
   core honesty mechanism; DefiLlama has no analog.
4. **Direction series green/amber kept** (onramp/offramp) — DefiLlama's up/down is
   green/red, but red would falsely read as "bad" for offramps.
5. **Tab row under the header, not inside the blue bar.** The brief specifies it
   (DefiLlama keeps primary nav inside its blue bar). With only 3 top-level tabs +
   Methodology, the split reads cleaner and matches the detail-page tab nav.
6. **±5% liquidity band sub-line, cost receipts, "Onramp liquidity vs Offramp
   demand"** — data-dense elements with no DefiLlama precedent; styled with the
   same token grammar (aligned label/value, hairline total rule, tabular numerals).
7. **44px rows.** DefiLlama's densest tables run ~44–50px; 44px exact fits the
   4px spacing scale and the brief's "~44px" guidance.

## Left for follow-up (intentional)

- **Sparkline trend coloring** (green up / red down over the period) — a behavior
  change masquerading as style; skipped on purpose.
- **Column sorting UI** on the venues table (headers are styled sortable-looking
  but sorting is not implemented; out of scope — behavior).
- **Custom dropdowns** for selects (flags/platform logos per the parked aggregator
  goal #2 in CLAUDE.md) — behavior + assets, not skin.
- **Orderbook depth-chart visuals** — the orderbook pages remain table-only; a
  DefiLlama-feel depth chart would be new functionality.
- **`.mono` rename** to `.num` — the class now means "tabular numeric" everywhere;
  renaming ~70 call sites adds churn without visual benefit. Documented in CSS.
- **Sticky table header on pages between 1180–1280px viewport** — in that band the
  wrap uses `overflow-x: auto`, which inertly disables viewport stickiness (CSS
  containment trade-off); tables scroll horizontally instead, headers stick within
  the card. At ≥1280px the header sticks to the viewport as intended.

## Verification

- Gates `npm run web:typecheck` && `npm run web:build` pass on every commit.
- All 13 routes return 200 and were exercised in headless Chrome at 1440/1024/390px.
- 33/33 automated checks pass (computed styles + interactions: filters, Clear,
  expansions, `?category=` pre-filter, direction toggle, `<details>`, tab nav,
  chart period selector, aggregator live round-trip, orderbook fetch, docs sidebar).
