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

**Fillable depth, not raw book depth.** For CEX-P2P offer books we publish the depth priced **within ±5% of the FX mid**, not the sum of every ad on the book. A full book is padded with offers priced 20–30% away from mid that no taker will ever fill — quoting them as "available" would overstate the venue by roughly a third. (We use ±5% rather than the ±2% common for CEX order books because P2P spreads are structurally wider.) The raw full-book total is still shown alongside, so the filtering is visible rather than hidden.

**Escrowed liquidity is not the same as advertised demand.** On a P2P venue only one side of the book is capital-committed. When a maker offers to *sell* crypto, the venue escrows their asset — that depth is real. When a maker offers to *buy*, nothing is locked: they can advertise a million-dollar appetite for free. We therefore label the two sides **"onramp liquidity"** and **"offramp demand"**, never add them together, and never present them as like-for-like. At full book depth the gap is not subtle — one venue's USD market showed $8.05M of escrowed liquidity against $350.79M of unbacked buy intent.

### Spread (~$1k)

The effective spread on a **~$1,000 trade** in the venue's deepest USD market, measured against an oracle or FX mid. By convention, **negative = favorable for the taker**. The exact computation varies by venue type:

- **CEX P2P** — the cheapest USD ad that accepts a $1k order and has enough escrow to fill it; the spread of that single match.
- **Onchain P2P** — walk the USD order book in price order until $1k of stablecoin is filled, then compare the liquidity-weighted average rate to the oracle mid.
- **Licensed Ramps** — the all-in fee (in bps) of the USD card quote at $1k. This is **approximated** (see [Data sources](/methodology/data-sources)) and tagged `self_reported`.

The spread is a glance metric. The real cost of any transaction depends on payment method, fiat, asset, and amount — open a venue's live rates table for the per-row detail.

### $1k onramp / offramp cost

Where a venue supports it, the headline metric is not a bare spread but the **all-in cost of a ~$1,000 trade**, computed per direction and published with its assumptions. A spread is only one of four things you pay, and on some venues it is not even the largest.

The four components follow the journey in order — move fiat in, pay the venue, pay the maker's price, move crypto out:

> **payment method fee + venue fee + maker spread + withdrawal = total**

- **Payment method fee** — the cost of the fiat rail itself (SEPA, wire, card). On a P2P venue this is normally zero: the fiat moves bank-to-bank between taker and maker and the venue never touches it. Card and some e-wallet rails do carry third-party fees, which we cannot observe per-ad and therefore state as an assumption rather than invent.
- **Venue fee** — what the venue charges on top of the maker's price. Not always zero where folklore says it is: Binance P2P charges a **flat taker fee per trade order** on USDT pairs in ~97 fiat markets — introduced at 0.05 USDT in March 2024 and raised to **0.06–0.08 USDT** in September 2025 (we assume the midpoint; both announcements are linked in the snapshot). Maker fees are *not* itemized here — they are embedded in the quoted price and so already sit inside the maker spread.
- **Maker spread** — the matched fill's price against the FX mid. On a P2P book the price is set by the counterparty, not quoted by the venue, which is why it is labelled *maker* spread. It can be negative: P2P books frequently price under mid, which pays the taker. The onramp leg uses the best-priced qualifying ad; the **offramp leg uses the median of the top-5 qualifying ads**, because the best-paying sell ads are routinely premium outliers on reversible payment methods (chargeback-risk pricing) that would make off-ramping look like free money.
- **Withdrawal** — moving the crypto to your own wallet, quoted at the cheapest mainstream network. **This is included in the total**, because the journey being priced ends with the asset in your custody, not sitting on the venue's ledger — the same end-to-end basis a CEX route is costed on. On the offramp leg the mirror image is a deposit, which costs nothing at the venue (chain gas is paid to the network, and varies).

Every leg's assumptions — matched price, FX mid, the payment methods of the matched ad, fee sources with URLs, the withdrawal schedule and when it was last checked — are stored in the snapshot and shown on hover. If an assumption isn't published, the number doesn't ship.

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
