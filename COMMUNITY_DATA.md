# COMMUNITY_DATA.md — community-sourced venue data, and how we verify it

> Design doc for the crowdsourced fee-observation pipeline. Status: **designed, not built.**
> Decisions here were locked in the 2026-07-22 session and revised by a research spike the
> same day (104-agent adversarial pass; see "What the research changed"). Re-read this
> before re-litigating any of it.

## The problem

Most of what a user needs to compare on/off-ramps is not in an API. Binance publishes an
ad book, Revolut Ramp publishes key-less quotes — but the fee a Revolut user actually pays
in-app, in their country, on their plan, at execution time, exists only inside an
authenticated session. Every centralized ramp with a database instead of an RPC endpoint
has this shape. Coverage stalls at the venues that happen to be generous with APIs, which
is a biased sample and exactly the bias a neutral dashboard should not have.

So: let users contribute what they can see, and make the contribution verifiable enough to
publish next to machine-collected data without lying about where it came from.

## Three data classes — do not conflate them

Most designs go wrong by treating these as one thing. They have completely different
verification stories.

| Class | Example | Verifiable by | Needs crypto? |
|---|---|---|---|
| **A. Published facts** | Revolut's plan × volume fee tiers; which countries a venue serves | Reading the venue's own public page | No — a URL and a reviewer |
| **B. Observed quotes** | "Revolut quoted me 1.49% + 0.7% FX markup on a €1k buy, France, Standard, today" | Nothing public — this is the gap | Yes, or it's just a claim |
| **C. Executed transactions** | A receipt showing realized all-in cost | Nothing public; most privacy-sensitive | Yes |

Class A is already how `adapters/revolut.ts` works — the fee schedule is transcribed from
the legal page with `provenance: 'self_reported'` and an `evidence_url`. That pattern
scales to any venue with a published schedule and needs no new machinery beyond a
submission path.

**Class B is the actual prize** and the reason this pipeline exists.

## Evidence tiers

| Tier | Evidence | Verifies | Reviewer's job |
|---|---|---|---|
| 0 | Claim + public source URL | Class A | Open the URL, check the number |
| 1 | Redacted screenshot/export, hash committed | Class B/C, weakly | Judge a forgeable artifact |
| 2 | zkTLS proof against a pinned provider template | Class B/C, strongly | Verify the *template*; submissions verify mechanically |

The point of tier 2 is not that it removes human review. It **moves** review from "is this
screenshot real" (unanswerable, once per submission) to "does this template extract what it
claims, from the endpoint it claims" (answerable, once per venue). That is the same shape
as DefiLlama's adapter-review model, one level up — and it is why provider templates, not
observations, are the governed artifact here.

## Storage and submission

Observations live in this repo under `data/community/observations/{venue}/`, append-only,
one JSON file per observation. Provider templates live in `data/community/providers/`.
Submission is a GitHub PR — same rail as DefiLlama, zero new infra, and git is the audit
log. A web form that opens PRs through a GitHub App is a later funnel widener, not the MVP.

Sketch (not final — write the JSON Schema when building):

```jsonc
{
  "venue": "revolut",                    // must match a data/products/*.yaml id
  "class": "published | quote | receipt",
  "country": "FR",
  "direction": "buy",
  "fiat": "EUR", "asset": "BTC",
  "amount_tier": "1k",                   // bucketed, never exact — privacy + comparability
  "plan": "standard",                    // venue-specific dimensions that move the price
  "fee_components": { "platform_bps": 149, "fx_markup_bps": 70, "fixed_fee": null },
  "observed_at": "2026-07-22T09:14:00Z",
  "evidence": {
    "tier": 2,
    "provider_id": "revolut-x-quote-v1", // pinned, versioned template
    "proof": { }                          // zkTLS proof object
  },
  "submitter": "github:someuser"
}
```

Two rules the schema must enforce, both learned the hard way below:

1. The claimed values must be **derivable from the evidence**. For tier 2 that is
   mechanical: CI extracts the disclosed fields and diffs them against the claim.
2. The observation must record **which HTTP response** the value came from — not "the
   Revolut app", but the endpoint. See "Bytes, not pixels".

## Aggregation — observations are not facts

Individual observations stay append-only and immutable. The dashboard renders an
*aggregate* per `(venue, country, direction, method, amount_tier)`: median of the k most
recent, with freshness decay ("3 reports · last confirmed 12d ago") and a `disputed` state
when recent reports diverge beyond a threshold.

This slots into the existing provenance system as two new enum values — `community`
(tier 0–1) and `attested` (tier 2) — with their own dot colours. The UI grammar already
supports this; `Provenance` in `lib/types.ts` and `web/lib/types.ts` would need the mirror
update, plus `provenanceColor`/`provenanceLabel` in `web/lib/format.ts`.

**Selection bias is the honest caveat**: people submit when they check, and they check when
a fee annoys them. Medians, report counts and visible dispersion mitigate it; a methodology
page should state it outright rather than let the number imply a precision it lacks.

---

## What the research changed

A 104-agent adversarial research pass ran on 2026-07-22 (13 claims confirmed, **12
refuted**). It changed two decisions and hardened a third. Full transcript in the session's
workflow journal.

### 1. Provider #1 is no longer "Revolut in-app quote" — NO-GO

The original plan targeted the in-app retail crypto quote screen (the plan-tiered
1.49%→0% fees). Three grounds against it, strongest first:

- **Architectural, and decisive.** Reclaim attests **intercepted HTTP response bytes** via
  `responseMatches`/`responseRedactions`. Custom JS injection can navigate to a screen and
  trigger an XHR, but it **cannot attest a number that exists only in rendered DOM**. If a
  fee is computed client-side, it is unattestable regardless of how good the extension is.
- **Evidentiary.** The research established *nothing* about Revolut's web crypto surfaces —
  zero claims survived. (Not evidence against; nothing was tested.)
- **Process.** A new custom Reclaim provider is **inactive by default** pending manual
  Reclaim-side review. That puts a third party's human gate on the critical path of the
  first deliverable.

The selection criterion that replaces "which venue is most interesting":

> **Pick provider #1 by whether the value appears in a JSON HTTP response body on a
> desktop-browser-reachable authenticated surface.** Nothing else.

### 2. Revolut X is the better provider #1 candidate — and our own probes support it

The research couldn't answer the Revolut questions, but this session's live probing did
(primary-source, in `CLAUDE.md` under "Revolut — two venues, one legal page"):

| Surface | Browser-reachable | JSON API | Auth | Verdict |
|---|---|---|---|---|
| `ramp.revolut.com` (Ramp) | Yes | Yes, itemized fees | **None** | Already scraped directly — attestation adds nothing |
| `exchange.revolut.com` (Revolut X) | Yes | Yes | **Public via MiCA** | **RESOLVED — no attestation needed, see below** |
| In-app retail crypto | No (mobile) | Unknown | Session | Deferred — see NO-GO above |

### Revolut X is settled: the data is public (2026-07-22, later the same day)

Revolut X was briefly the leading attestation candidate on the theory that its market data
was session-gated — `/api/crypto-exchange/tickers` returns 401, and it is absent from
CoinGecko. **That theory was wrong.** MiCA obliges licensed trading platforms to publish
pre-trade and post-trade transparency data, and Revolut publishes it **unauthenticated**:

- `transparency/config` → 527 symbols
- `transparency/order-books?symbol=X&timestamp=<ISO8601>` → order book CSV (5 levels/side)
- `transparency/trades` → every executed trade since 00:00 UTC

So Revolut X needs no attestation, no login and no ToS argument. Full write-up, values and
a reference collector: `~/Desktop/offchain/defillama/scoping/revolut-x-mica/`.

**The generalizable lesson — this is the second time it has paid off today:** when a
question is about a specific reachable system, *probe it* rather than research it. Desk
research produced zero surviving claims about Revolut's surfaces; ten minutes of curl
produced the endpoints, the schema and the numbers. The regulatory angle is worth
remembering too — **compliance obligations create public data**, so before assuming a
venue's data is locked away, check whether its regulator forces it into the open.

**Consequence for this pipeline**: provider #1 is once again unassigned. The selection
criterion stands, but it now needs a target that is genuinely gated *and* returns the value
in a JSON response body. Apply the criterion venue by venue rather than reaching for the
most interesting name — that error has now been made twice.

### 3. The trust model has to be stated honestly

Reclaim is a **proxy/witness** design, not MPC. From Reclaim's own security FAQ — an
adverse-interest source, so this is as strong as evidence gets:

> a compromised attestor cannot steal user data, but **can forge proofs**; the only
> protection is decentralisation or self-hosting.

For a *public dataset whose adversary is the submitting client*, that is the risk that
matters. Two consequences:

- **Self-hosting the attestor is the right call, and it is cleaner than it first looks.**
  If we run the attestor, the forgery capability sits with the dashboard operator — who
  the reader already trusts for every other number on the site. It collapses to the
  existing trust assumption rather than adding a new one. Self-hosting is documented and
  unpermissioned (AGPL-3.0, docker-compose, stateless).
- **But it changes the marketing claim.** "Cryptographically attested" must not be read as
  "trustless". The honest phrasing is *"attested via our notary — the operator cannot see
  your credentials, and cannot silently alter what the venue returned to a third party who
  checks the signature."* Overclaiming here would be worse than not shipping it.

Reclaim's multi-attestor consensus, staking/slashing and EigenLayer AVS are described in
**transitional language** ("is addressing", "implementing") and the decentralization doc
404'd. How many attestors sign by default in July 2026 is **unconfirmed** — treat as one.

### 4. The implementation landmine that would have bitten us

`verifyProof` **only** checks hashes and attestor signatures. Validating the provider
params — URL, method, response match, redaction — against *expected* values is explicitly
the integrator's own code.

Read "SDK-supported verification" as "call `verifyProof` and you're done" and you will
**accept a correctly-signed proof of the wrong URL**. For a crowdsourced submitter that is
the primary attack, not an edge case. So CI must, independently of the SDK:

1. Check `provider_id` is on the approved, version-pinned list.
2. Re-derive the expected URL/method/selectors **from our committed template**, not from
   the proof, and diff them against what the proof asserts.
3. Extract the disclosed fields and diff against the submitted claim.
4. Apply plausibility bounds (fee outside 3× the venue's known band → maintainer label
   required, not auto-fail).

This is the concrete reason templates are the governed artifact.

### Stack comparison — as it stood July 2026

| Stack | Browser | Custom providers | Trust posture | Verdict |
|---|---|---|---|---|
| **Reclaim** | Yes | DevTool + JS injection; **manual activation gate** | Proxy; attestor can forge; self-hostable | **Base choice** |
| **Primus/PADO** | Yes (no extension required) | Data Templates, JSONPath (RFC 9535) | **Both MPC-TLS and Proxy** via `attMode` | **Hedge** — MPC is the right default when the adversary is the submitter |
| **TLSNotary** | — | — | Strongest in principle | **Not viable** — `v0.1.0-alpha.15`, README says do not use in production |
| **Opacity** | **No** — mobile-only SDKs | — | TEE/enclave | **Ruled out** for a browser flow |
| **zkp2p attestors** | — | — | — | **Open question** — both claims collapsed under verification; ask them directly |

Primus is the interesting hedge: MPC mode specifically prevents the client modifying data
before attestation, which is our exact threat. Caveat: no positive evidence `mpctls` is
production-shipped rather than documented-only. Verify before depending on it.

### Do not repeat these — refuted 

Twelve claims died in verification, several of which circulate as common knowledge:

- ❌ Reclaim's attestor "never decrypts / never terminates TLS" (refuted twice). The real
  picture is **user-authorized selective key disclosure**; the attestor sees disclosed
  plaintext plus metadata (SNI, IP, timing, ciphertext sizes).
- ❌ Reclaim ships an MIT-licensed MV3 extension template.
- ❌ Custom-provider registration is fully self-serve without Reclaim-side work.
- ❌ Primus MPC is categorically a stronger trust model than Reclaim (scope it to
  client-side tampering specifically).
- ❌ Primus requires a Chrome extension for browser integration.
- ❌ TLSNotary proxy-mode performance numbers and its trusted-verifier framing.
- ❌ Both zkp2p-fork claims (lineage and abandonment).

---

## Phasing

**Phase 0 — the cheap question, before anything else.** Open an authenticated Revolut X
session in devtools. Does a fee/quote/ticker value arrive in a JSON response body? If yes,
provider #1 is `revolut-x-*`. If no, apply the selection criterion to the next venue rather
than forcing Revolut.

**Phase 1 — tiers 0–1, no cryptography.** Schema + JSON Schema validation, `data/community/`
layout, PR template, CI plausibility gates, aggregation into `community` provenance. This is
most of the user-visible value and none of the zkTLS risk. It also makes Class A submissions
possible immediately, which is what actually widens venue coverage.

**Phase 2 — tier 2 on one provider.** Self-hosted attestor, one pinned template, the
four-step CI verification above. One provider shipped end-to-end teaches the true cost of
the activation gate, which is currently unknown.

**Phase 3 — widen.** More templates; revisit Primus MPC if client-side tampering shows up;
revisit zkp2p partnership.

## Open questions

1. ~~Does Revolut X return fees/quotes in a JSON body on an authenticated web session?~~
   **ANSWERED 2026-07-22 — moot.** Its market data is public via the MiCA transparency
   feed, so Revolut X leaves the attestation roadmap entirely. Provider #1 is unassigned;
   apply the selection criterion to the next venue.
2. What does Reclaim's manual provider-activation actually cost in time, and do they
   activate providers targeting regulated financial apps? Only knowable by asking them.
3. Is zkp2p's attestation infra usable by partners? They are already a tracked venue —
   a conversation beats desk research.
4. How many attestors sign a Reclaim claim by default today; is the AVS live; is slashing
   enforced? The forgery risk is bounded entirely by this.
5. Is Primus `mpctls` production-shipped or documented-only?
6. **Never researched**: prior art in zkTLS-attested price/fee data for public datasets,
   and how DefiLlama actually reviews community-submitted non-API data. The latter is
   directly relevant — we have shipped DefiLlama adapter PRs and may be able to adopt a
   proven review model instead of inventing one.

## Related

- `CLAUDE.md` → "Revolut — two venues, one legal page" (the probe findings this builds on)
- `CLAUDE.md` → Future goals #7 (this pipeline), #6 (Revolut X category question)
- `adapters/revolut.ts` → `EXCHANGE_FEE_TIERS_BPS` — the Class A data a Class B observation
  would be checked against
