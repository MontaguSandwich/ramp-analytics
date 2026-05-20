---
title: Definitions & Taxonomy
order: 4
---

The vocabulary used across the dashboard. Most terms are standard, but they carry specific meanings here — this page pins them down.

## Participants

- **Maker** — the party that posts an offer (locks funds and quotes a rate). On P2P venues, anyone can be a maker.
- **Taker** — the party that accepts an offer and initiates the trade.

## Direction

- **On-ramp** — fiat → crypto (the user is buying crypto).
- **Off-ramp** — crypto → fiat (the user is selling crypto).
- A venue may support one direction or **both**.

## Custody

How the user's assets are held during and after a trade:

- **Self** — assets are delivered directly to the user's own wallet; the venue never holds them.
- **Hosted** — the venue holds assets on the user's behalf (e.g. a custodial exchange balance).

## Settlement

Where the trade actually clears:

- **On-chain** — settled by a smart contract or direct wallet transfer, verifiable on a block explorer.
- **Off-chain** — settled on the venue's internal ledger. For CEX P2P, withdrawal to a self-custodial wallet is a separate, post-settlement step.

## Pricing layers

How a venue's all-in price is built up, shown as badges on the venue's properties card:

- **Maker quote** — the rate is set by an individual maker.
- **Venue quote** — the rate is set by the venue itself, as counterparty.
- **Venue fee** — the venue takes a separately itemized commission on top of the base rate.

A venue can stack layers (e.g. a maker quote *plus* a venue fee).

## Pricing & spread terms

- **bps (basis points)** — 1 bps = 0.01%. Spreads and fees are often quoted in bps.
- **Spread** — the gap between a venue's effective rate and a reference (oracle or FX) mid. Negative spread favors the taker.
- **Oracle / FX mid** — the reference mid-market rate a spread is measured against.

## Liquidity terms

- **Available liquidity** — see [Methodology & Metrics](/methodology/metrics); the meaning is kind-aware.
- **Escrow** — funds locked by a maker (or the venue) to back an open offer until the trade settles or cancels.
- **Max single trade** — the largest single transaction a counterparty-style venue (a Licensed Ramp) will process. Used in place of pooled liquidity for that category.
