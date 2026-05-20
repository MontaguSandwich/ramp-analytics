---
title: Eligibility & Exclusion
order: 2
---

A venue earns a place on the dashboard when it both **does the job** (moves value between fiat and crypto) and **can be measured** (exposes data we can verify). This page sets out the inclusion bar, the exclusions, and how a venue lands in exactly one category.

## What we include

A venue is eligible if it:

- Facilitates **crypto ↔ fiat** conversion in at least one direction (on-ramp, off-ramp, or both).
- Exposes data we can verify — a public API, readable on-chain state, or a clearly documented fee/limit schedule.
- Serves end users directly (not a pure infrastructure/white-label layer with no user-facing venue).

## What we exclude

- **Venues with no verifiable data** — if rates, liquidity, and limits are entirely opaque, we cannot represent them honestly, so we leave them off.

## Categories

Each venue is assigned **exactly one** category, based on who the counterparty is and where settlement happens:

| Category | What it is | KYC |
|---|---|---|
| **Onchain P2P** | Permissionless P2P marketplace for stablecoin ↔ fiat swaps that settle on-chain. Makers lock stablecoins and quote rates and payment methods; takers pay off-chain and submit proof to unlock funds. | None at the venue layer (only the payment method's own KYC). |
| **CEX P2P** | Exchange-hosted P2P marketplace. The venue holds escrow, arbitrates disputes, and settles to its own custodial wallets. | Required. |
| **Licensed Ramps** | On/off-ramp services that act as the **counterparty**, selling to or buying from the user directly. | Required. |
| **RTPNs** | Real-time payment networks / neobanks that support crypto and let users buy and sell in-app. | Required. |
