---
title: Data sources & per-venue notes
order: 5
---

Each venue is probed differently, because each exposes data differently. This page documents exactly where each venue's numbers come from, how often they refresh, and the caveats that come with them. Transparency about *how* a number is produced is part of the number.

## Update cadence

A snapshot job runs **every 30 minutes**. It calls each venue's adapter, writes the latest figures, and appends to the self-accumulating liquidity logs that drive the sparklines. The deployed site rebuilds from that fresh snapshot, so figures on the dashboard are at most one snapshot interval old. Each field's exact "last verified" time is on its provenance dot.

## Per-venue

### Onchain P2P (zkp2p / Peer)

- **Sources** — a paid analytics API for live order-book and volume data, an on-chain indexer for historical TVL backfill, and direct reads of the venue's contracts on Base.
- **Coverage** — on-ramp direction; real available liquidity and a ~90-day history.
- **Strength** — settlement is on-chain, so liquidity and volume are verifiable rather than self-reported.

### CEX P2P (Binance P2P)

- **Source** — a single public marketplace search endpoint, probed for **both** buy and sell sides.
- **Depth** — we read the top ~20 ads per market across many fiat markets. This is a **partial view of the book** (on the order of the most competitive slice), so the headline *Available USDT* figure is a **floor, not the full book** — true depth is materially higher.
- **History** — the venue publishes no historical series; we accumulate our own liquidity log over time.
- **Extras** — maker-activity aggregates (active makers, ad counts, finish rates) are derived from advertiser fields in the buy-side probes.

### Licensed Ramps (Ramp Network)

- **Sources** — public REST endpoints for assets, payment methods, and currencies.
- **Pricing** — live per-quote pricing requires a partner key we do not hold, so prices use **Approach B**: a hand-maintained fee table calibrated against observed quotes, with currency tiers (major vs. exotic) for card methods. These figures are tagged `self_reported` and **approximated**, and are kept in sync with the venue's published pricing policy.
- **Liquidity** — a Licensed Ramp has no order book; its liquidity figure is *Max single trade* (see [Methodology & Metrics](/methodology/metrics)), not pooled depth.

## Known limitations

- **CEX P2P depth is understated.** We sample the top of each book, not the whole book — read *Available USDT* as a conservative floor.
- **Ramp pricing is approximated.** Until partner-grade quoting is wired in, ramp prices come from a maintained fee table, not a live per-quote API.
- **History is uneven.** Only the on-chain venue has a deep historical series; others accumulate from the day we started logging them.
- **Coverage lists can lag.** Where a live API exposes current coverage we prefer it, but static lists may briefly trail a venue's real support.

We would rather show a labeled, conservative number than an unlabeled, optimistic one. Where this page and the dashboard disagree with a venue's own marketing, the difference is usually one of these caveats — not an error.
