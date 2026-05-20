---
title: Methodology & Metrics
order: 3
---

This page defines every metric on the dashboard and the provenance system that sits behind all of them.

## Provenance flags

Every field on the dashboard carries a provenance tag, rendered as a colored dot with a "last verified" timestamp on hover:

| Dot | Provenance | Meaning |
|---|---|---|
| 🟢 | `onchain` / `api` | Read directly from chain state or a live API at snapshot time. |
| 🟠 | `self_reported` | Published by the venue (docs, fee page) but not independently verified. |
| ⚪ | `manual` / `unavailable` | Hand-entered from a source, or **not disclosed** by the venue. |

When a field is structurally not disclosed, the dashboard shows **"Not disclosed"** with a tooltip explaining why, rather than a zero or a guess.

## Metrics

### Available liquidity

The headline liquidity figure is **kind-aware** — what "liquidity" means depends on the venue model, so the label changes with it:

- **Order-book depth** (CEX P2P) — the sum of escrowed stablecoin across the ads we observe, totaled across markets. Labeled *Available USDT*.
- **On-chain inventory** (Onchain P2P) — stablecoin locked in maker deposits, read from chain state. Labeled *Available liquidity*.
- **Ramp capacity** (Licensed Ramps) — the **largest single transaction** the venue will process, in USD-equivalent. This is **not** pooled liquidity; a ramp quotes against its own capacity, not an order book. It is labeled *Max single trade* and flagged with a footnote wherever it appears.

Because these are different measurements, we never sum them into one cross-venue "total liquidity" without saying which kind each contribution is.

### Spread (~$1k)

The effective spread on a **~$1,000 trade** in the venue's deepest USD market, measured against an oracle or FX mid. By convention, **negative = favorable for the taker**. The exact computation varies by venue type:

- **CEX P2P** — the cheapest USD ad that accepts a $1k order and has enough escrow to fill it; the spread of that single match.
- **Onchain P2P** — walk the USD order book in price order until $1k of stablecoin is filled, then compare the liquidity-weighted average rate to the oracle mid.
- **Licensed Ramps** — the all-in fee (in bps) of the USD card quote at $1k. This is **approximated** (see [Data sources](/methodology/data-sources)) and tagged `self_reported`.

The spread is a glance metric. The real cost of any transaction depends on payment method, fiat, asset, and amount — open a venue's live rates table for the per-row detail.

### 30-day volume

Trailing 30-day traded volume in USD, **where the venue publishes it**. Many venues do not, in which case the field is blank rather than estimated.

### Supported fiats & payment methods

Counts of distinct fiat currencies and payment methods the venue supports. We prefer the **live coverage** observed at snapshot time over a static list, since coverage shifts. Click a count on the Overview table to expand the full list.

### Fees

A representative best-case fee is shown for context, but per-transaction fees depend on method, fiat, asset, and amount. Treat the live rates table as the source of truth, not the headline.

## KYC / PII model

We classify each venue by its **PII floor** — the minimum personal data required to transact:

| Floor | Meaning |
|---|---|
| `none` | No identity data at the venue layer. |
| `email` | Email / account only. |
| `id` | Government ID. |
| `id+poa` | ID plus proof of address. |
| `enhanced` | ID plus enhanced checks (source of funds, liveness, etc.). |

A venue may also be marked **non-KYC available** when a usable flow exists without identity verification.

## How to read the dashboard

- **Overview** — the venues table is the home view. Sort and filter by category, direction, custody, KYC, and fiat; each row links to a venue detail page.
- **Venue detail** — KPI strip, properties, coverage, classification, live rates, and (where available) an order book and quote tool.
- **Aggregator** — enter a route (direction, amount, fiat, asset, method) and compare live quotes across venues, ranked, with a source tag per row.
