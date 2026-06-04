---
adr: 0860
title: Telemetry decisions register (TL-1…TL-8)
status: Proposed
date: 2026-06-04
deciders:
  - Telemetry pipeline working group
  - Copilot CLI agent (Claude Opus 4.8)
related:
  - ADR-0017 (raw/canonical retention tiers)
  - ADR-0090 (CDC-lag SLO)
  - ADR-0229 (streaming cancellation / backpressure)
  - ADR-0342 (CDC failure modes)
  - ADR-0345 (cardinality control)
  - ADR-0431 (idempotency / HLC-ULID keys)
  - ADR-0719 (ingestor freshness SLO)
  - ADR-0815 (vendor-signal persistence)
  - ADR-0817 (subscription profiles)
hard-rules:
  - H10
  - H17
  - H18
  - H24
  - H35
---

# ADR-0860 — Telemetry decisions register (TL-1…TL-8)

## Status

**Proposed** — 2026-06-04.

## Context

The alerts program maintains an **AL-register** of small, load-bearing
parameters; the notifications program maintains an equivalent. The detailed
telemetry pipeline has a parallel set of schema- and ops-gating decisions that
Phases 2–9 each reference by number (TL-N). Today these values live implicitly
across several anchor ADRs (ADR-0017, 0090, 0229, 0345, 0431, 0719, 0815, 0817)
and the `planning/40-storage-compute/15-time-series-storage.md` corpus. Without a
single register, each phase silently re-decides them, and drift between phases
becomes invisible until a parity or freshness test fails.

This ADR locks the **TL-1…TL-8** register once, with a concrete value, a
rationale, and the anchor it derives from per row, plus an owner for any value
left open (per H18). It is the telemetry counterpart of the AL-register. This is
a **decision register only** — it implements nothing. No proto, SQL, or Kotlin is
touched. Each phase that consumes a TL-N cites it; revisiting any TL-N requires a
superseding ADR (H17).

Where the anchor corpus already fixes a number (TL-1 freshness, TL-3 CDC lag,
TL-5 profile default are pinned by their ADRs), the register adopts that number
verbatim and cites it. Where the corpus does not fix a value, the register
chooses a defensible Phase-1 value and marks it revisitable with an `owner:` and
a `revisit-by:` deadline (H18).

## Decision

Adopt the following register. Each row is a single load-bearing decision.
"Status" is **Locked** when the value is pinned by an anchor ADR, or **Open
(revisitable)** when it is a defensible Phase-1 default carrying an owner +
deadline per H18.

| TL | Decision | Value | Rationale | Anchor | Status |
|---|---|---|---|---|---|
| **TL-1** | **Ingest freshness target** — max provider-event → bus latency. | **p99 ≤ 5 s** (provider emit timestamp → message published on the internal bus). | The freshness SLO downstream consumers (FSM, SSE, live reads) budget against. p99 (not mean) so a slow tail can't mask a regression; 5 s gives the ingestor headroom over the provider's own emit cadence while staying inside the "live, not stale" 2-minute contract. | ADR-0719 (ingestor freshness SLO); `planning/40-storage-compute/15-time-series-storage.md` §2.1 | **Locked** (per ADR-0719) |
| **TL-2** | **Backpressure policy** — ingestor behaviour when the bus/writer is slow. | **Bounded in-memory buffer (per-vehicle) + drop-oldest on overflow**, never block the provider connection; overflow increments `telemetry_ingest_dropped_total`. Blocking and unbounded buffering are rejected. | Blocking the provider connection risks server-side disconnect and a redelivery storm; an unbounded buffer risks OOM. Drop-oldest preserves the freshest live state (the value consumers actually read) and degrades gracefully under a slow cold-tier writer. Aligns with the cancellation/backpressure contract. | ADR-0229 (streaming cancellation / backpressure) | **Open (revisitable)** · owner: telemetry-ingest lead · revisit-by: 2026-09-30 |
| **TL-3** | **CDC-lag SLO** — Postgres-WAL → ClickHouse cold-tier lag + failure mode. | **p95 ≤ 60 s**; on breach the CDC pipeline degrades read-only (cold-tier serves last-good) and raises a lag alert — it must **not** drop WAL position or skip rows. | Cold-tier analytics tolerate up to a minute of staleness; what they cannot tolerate is silent gaps. Bounding p95 at 60 s with a "halt-and-alert, never skip" failure mode keeps raw↔canonical reconcilable (see TL-8). | ADR-0090 (≤60 s p95); ADR-0342 (CDC failure modes) | **Locked** (per ADR-0090) |
| **TL-4** | **Vendor-signal cardinality cap** — max distinct `vendor.*` kinds per vehicle/day persisted before shedding. | **≤ 2,000 distinct `vendor.*` kinds per vehicle per UTC day**; beyond the cap, new distinct kinds are dropped (not buffered) and counted in `telemetry_vendor_cardinality_shed_total`; known/canonical kinds are never shed. | Vendor-namespaced signals are uncapped by definition and a cardinality blowup poisons cold-tier index size and query cost. A per-vehicle/day ceiling contains the blast radius to one vehicle while preserving all canonical signals. 2,000 is generously above any observed legitimate vehicle/day count and is a starting point to tune. | ADR-0815 (vendor-signal persistence); ADR-0345 (cardinality control) | **Open (revisitable)** · owner: storage-compute lead · revisit-by: 2026-09-30 |
| **TL-5** | **Subscription-profile default** — profile on a fresh vehicle. | **MINIMAL** on first subscription; promotion to FULL is explicit/operator-driven; **EXPANDED_SAFE is deferred** (not offered in Phase 1). | A fresh vehicle should not open the firehose before its storage/cost envelope is understood. MINIMAL is the safe, reversible default; FULL is an opt-in. EXPANDED_SAFE is deferred until its field set is ratified. | ADR-0817 (subscription profiles) | **Locked** (per ADR-0817) |
| **TL-6** | **Raw/canonical retention split** — per-tier retention for raw vs canonical. | **Raw:** compress @ 7 d, drop/cold-evict @ 90 d. **Canonical:** retained **≥ raw** at every tier (hot ≥ 90 d, warm/cold per ADR-0017 tiering), never shorter than raw. | Raw is the replay/forensic source and is the most expensive to keep hot; 7 d compression / 90 d horizon caps cost. Canonical is the queryable product and must outlive raw so analytics never reference evicted-but-uncanonicalized data. The invariant "canonical ≥ raw" is the load-bearing rule; the exact numbers track ADR-0017's tier table. | ADR-0017 (retention tiers); ADR-0345 | **Open (revisitable)** · owner: storage-compute lead · revisit-by: 2026-09-30 |
| **TL-7** | **Idempotency key** — dedupe key for at-least-once delivery. | **`(vehicle_id, ts, kind)`** as the logical dedupe key, with a **per-event ULID** carried for ordering/tie-break and HLC-derived `ts` per ADR-0431; last-writer-wins on exact-key collision. | At-least-once delivery (H24) means the writer must dedupe. `(vehicle_id, ts, kind)` is the natural composite identity of a canonical observation; the ULID/HLC tie-break resolves same-millisecond collisions deterministically without a coordination round-trip. | ADR-0431 (idempotency / HLC-ULID); H24 | **Locked** (per ADR-0431) |
| **TL-8** | **Two-layer parity tolerance** — acceptable raw↔canonical divergence in the Phase-9 parity test. | **Row-count:** 0 % divergence for canonicalizable rows over a closed window (every raw row either produces a canonical row or a counted drop). **Value:** exact for integers/enums; **≤ 1 ULP** for floating-point unit conversions. Any divergence beyond tolerance fails the parity gate. | Parity is the trust anchor between the replay source (raw) and the product (canonical). Row-count must reconcile exactly once drops are accounted; value divergence is permitted only at float rounding, which unit conversion legitimately introduces. | ADR-0017 (raw/canonical layering) | **Open (revisitable)** · owner: telemetry QA lead · revisit-by: 2026-10-31 |

## Consequences

**Positive**

- Phases 2–9 cite a stable TL-N instead of re-deriving the value, eliminating
  silent inter-phase drift (the failure mode this register exists to prevent).
- Each value has one rationale and one anchor, so a reviewer can trace any
  telemetry parameter to its source ADR in one hop.
- Open values (TL-2, TL-4, TL-6, TL-8) carry an explicit owner + deadline per
  H18, so "Phase-1 default" never silently becomes "permanent default."

**Negative / costs**

- Adds a register that must be kept in sync: when an anchor ADR (e.g. ADR-0017's
  tier numbers) changes, the corresponding TL row must be updated or this ADR
  superseded (H17).
- Four of eight values are Phase-1 defaults, not yet load-tested; the revisit
  deadlines must actually be honoured or the register loses authority.

**Neutral**

- Each TL-N is revisitable via a **superseding ADR** (H17) — rows are not edited
  in place once a phase has shipped against them; a new ADR records the change
  and the supersession.
- The cardinality cap (TL-4), retention numbers (TL-6), and parity tolerance
  (TL-8) are starting points expected to be tuned after the first production
  window.

## Related decisions

ADR-0017 (raw/canonical retention tiers), ADR-0090 (CDC-lag SLO), ADR-0229
(streaming cancellation / backpressure), ADR-0342 (CDC failure modes), ADR-0345
(cardinality control), ADR-0431 (idempotency / HLC-ULID keys), ADR-0719
(ingestor freshness SLO), ADR-0815 (vendor-signal persistence), ADR-0817
(subscription profiles).

## References

- `planning/40-storage-compute/15-time-series-storage.md` §2
- The `alerts/` AL-register prompt (parallel structure)
- Hard rules: H10, H17, H18, H24, H35
