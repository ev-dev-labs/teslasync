# ADR-0095 — Telemetry retention + redaction model (reconciles ADR-0345, ADR-0017, ADR-0074)

- Status: **Proposed**
- Date: 2026-06-04
- Deciders: Platform Architecture, Telemetry Storage owners, Privacy/DPO
- Consulted: Ingest/Normalize owners, Observability/SDK owners, Security/Crypto owners, SRE/ops
- Informed: All Phase-2 retention/compression authors, Phase-6 cold-tier owners, Phase-7 redaction owners
- Template: MADR-Lite (`docs/adr/0000a-template-lite.md`)

> **MADR-Lite note.** This is a **reconciliation**, not a fresh trade-off. Three
> already-accepted/active policies — ADR-0017 (raw/canonical retention split),
> ADR-0345 (per-signal-per-tier observability retention), and ADR-0074
> (redaction-at-source for the OTel pipeline) — must collapse into **one coherent
> model** so that Phase 2 (retention/compression jobs), Phase 6 (cold-tier), and
> Phase 7 (redaction processor) build against a fixed seam. Nothing is
> re-decided here; this ADR states how the three compose and draws the boundary
> between *stored signal data* and *observability telemetry*. It therefore uses
> the light template (context, decision, consequences, related decisions) rather
> than the full option-scoring form.

---

## Context and Problem Statement

Three policies currently describe retention and redaction from different angles,
and Phase 2 / Phase 6 / Phase 7 each need a single answer:

1. **ADR-0017 — two-layer signal store.** `raw_signals` is compressed after **7
   days** and retained **90 days by default**; `canonical_signals` is retained
   for the **same period or longer**. This is a property of the *stored business
   data*.

2. **ADR-0345 — observability retention is per-signal-per-tier.** The value of a
   signal — and therefore how long it is worth keeping — is a function of **both**
   the signal **and** the deployment tier (a reading at **T1** self-host has a
   different retention value than the same reading at **T4** fleet). Retention is
   not a single global number; it is parameterised.

3. **ADR-0074 — telemetry redaction policy.** A **mandatory `SpanProcessor`
   chain** at the SDK source redacts identifiers (hashing), geo (geo-fuzzing,
   2dp default), and secret patterns, applied **symmetrically across all
   exporters**. This governs the **OTel telemetry pipeline** (spans / metrics /
   logs).

The open question is how raw-vs-canonical retention, per-tier retention, and
redaction-at-source **compose**, and — critically — what each one actually
governs. Left unreconciled, a Phase-2 author could apply a single global
retention number (losing the per-tier scaling of ADR-0345), or could conflate
the redaction processor with stored-data privacy (double-counting it against
`privacy_class`), or could try to "redact" `raw_signals` rows (violating the
append-only contract of ADR-0091/H17).

ADR-0091 (Phase-1 prompt 01) already established that `raw_signals` is the
append-only system of record and `canonical_signals` is the SI query surface.
ADR-0094 (Phase-1 prompt 04) already established that **stored-signal** privacy
is governed by a `privacy_class` column plus **crypto-erasure** (per-user DEK
destruction, H35/ADR-0332), *not* by the OTel redaction chain. This ADR closes
the loop on the **retention** dimension and pins the **stored-data vs
observability** boundary that all three policies implicitly assume.

## Decision Outcome

**Reconcile, don't re-decide.** Adopt one model with two distinct enforcement
surfaces and an explicit boundary between them.

### 1. Stored-signal retention (raw / canonical), parameterised per tier

- **`raw_signals`:** compress after **7 days**, retain **90 days by default**
  (ADR-0017 unchanged). Raw retention is the floor and is broadly tier-invariant.
- **`canonical_signals`:** retain **≥ raw**, **scaled per tier per ADR-0345** —
  longer at higher tiers (e.g. T4 fleet) where multi-year analytics matter,
  shorter (but never below the raw floor) at lower tiers (e.g. T1 self-host).
- **Mechanism / phasing:** retention + compression on the hot store
  (TimescaleDB) are **TimescaleDB policies created in Phase 2**. **Cold-tier
  (ClickHouse) retention** is set in **Phase 6** (profile-gated per ADR-0092).
- This ADR mandates *that* canonical retention is per-tier; it does **not** fix
  the numbers — see §4.

### 2. Observability redaction-at-source (the OTel pipeline)

- The **mandatory `SpanProcessor` chain** in `observability-sdk` (ADR-0074)
  redacts **spans / metrics / logs** — identifier hashing, geo-fuzzing (2dp
  default), secret-pattern redaction — applied **symmetrically across all
  exporters**. **Built in Phase 7.**
- This is the defense against an accidental VIN / coordinate / token leaking into
  a **trace attribute**. It operates on the *observability* signal, never on the
  stored `raw_signals` / `canonical_signals` business rows.

### 3. The stored-data vs observability boundary (the point of this ADR)

> **Two surfaces, both mandatory, neither a substitute for the other.**

| Concern | Stored signal data | Observability telemetry |
|---|---|---|
| What | `raw_signals` / `canonical_signals` business rows | OTel spans / metrics / logs |
| Privacy governed by | `privacy_class` column + **crypto-erasure** (ADR-0094, H35/ADR-0332) | **redaction-at-source** `SpanProcessor` chain (ADR-0074) |
| Retention governed by | raw 7d-compress/90d + canonical ≥ raw, per tier (this ADR, ADR-0017/0345) | observability retention per ADR-0345 (out of scope for the stored-data jobs) |
| Erasure | per-user DEK destruction (append-only raw is never row-deleted, H17) | redacted at source; nothing user-identifying is stored to erase |

- **Redaction does not protect stored data; `privacy_class` + crypto-erasure
  does.** Conversely, `privacy_class` does not protect a trace attribute;
  redaction-at-source does. They are **not interchangeable** and must **both**
  hold.
- Applying the redaction chain to `raw_signals` is **forbidden** — raw is the
  append-only system of record (ADR-0091/H17); its privacy is crypto-erasure, not
  in-place mutation.

### 4. Defer the exact per-tier numbers to the TL-register

The concrete per-tier canonical-retention durations are deferred to the
**TL-register (prompt 06)** unless **ADR-0345 already fixes them**, in which case
the Phase-2 / Phase-6 jobs **cite ADR-0345's values directly**. The raw
7-day-compress / 90-day-retain figures are fixed here from ADR-0017.

### Decision in one line

> **Stored** signal retention is raw (compress@7d / 90d) + canonical (≥ raw,
> scaled per tier per ADR-0345), enforced by TimescaleDB policies in Phase 2 and
> ClickHouse retention in Phase 6; **observability** telemetry is protected by the
> mandatory redaction-at-source `SpanProcessor` (ADR-0074) in Phase 7 — a
> **distinct** surface from stored-data privacy, which is governed by
> `privacy_class` + crypto-erasure (ADR-0094). Both surfaces hold; numbers defer
> to the TL-register unless ADR-0345 fixes them.

## Consequences

- ✅ **One coherent model.** Raw/canonical retention, per-tier scaling, and
  redaction now have a single stated composition; Phase 2/6/7 build against a
  fixed seam instead of three overlapping policies.
- ✅ **No double-counting of redaction vs `privacy_class`.** Redaction-at-source
  governs the OTel pipeline; `privacy_class` + crypto-erasure governs stored
  rows. Neither is mistaken for the other, so neither is skipped on the
  assumption the other covers it.
- ✅ **H17 preserved.** The redaction chain never touches append-only
  `raw_signals`; stored-data erasure stays crypto-erasure (ADR-0094).
- ✅ **Per-tier value honoured.** Canonical retention scales with deployment tier
  (ADR-0345) rather than collapsing to a single global number.
- ➖ **Two distinct enforcement surfaces.** Operators must reason about *both* the
  retention/compression jobs (Phase 2/6) *and* the redaction processor (Phase 7);
  a reviewer cannot assume one implies the other.
- ➖ **Numbers deferred.** The exact per-tier canonical durations are not fixed
  here; Phase 2/6 must read them from the TL-register (prompt 06) or cite ADR-0345
  if already fixed. A missing TL-register entry blocks the retention-policy job
  rather than inventing a default.
- ➖ **Cross-phase dependency.** Phase 6 (cold-tier retention) must stay
  consistent with the per-tier model set here; an inconsistent ClickHouse TTL
  would silently shorten canonical retention below its tier target.

## Confirmation

- Phase-2 TimescaleDB policies implement raw **compress@7d / retain 90d** and
  canonical **retain ≥ raw**, with the canonical duration **parameterised by
  tier** (policy review + a test asserting canonical retention ≥ raw retention
  for every tier).
- Phase-6 ClickHouse cold-tier retention is set consistently with the per-tier
  model (review against the TL-register / ADR-0345).
- The Phase-7 redaction `SpanProcessor` chain operates on **spans/metrics/logs
  only**; **no** code path applies it to `raw_signals` / `canonical_signals`
  rows (processor scope review + grep for redaction calls in the storage write
  path returning none).
- Stored-data erasure remains **crypto-erasure** (ADR-0094); there is **no
  retention job that `DELETE`s `raw_signals` to satisfy privacy** (the 90d raw
  retention is an ops/cost policy on the hypertable, distinct from DSAR erasure).
- Per-tier numbers are either **cited from ADR-0345** or **carried in the
  TL-register**; no job hard-codes a tier duration absent from both.

## Related Decisions

- **ADR-0345** — Observability retention is per-signal-per-tier — the source of
  the **per-tier parameterisation** of canonical retention; supplies the numbers
  if already fixed.
- **ADR-0017** — Two-layer signal store retention — the source of **raw
  compress@7d / 90d** and **canonical ≥ raw**.
- **ADR-0074** — Telemetry redaction policy — the mandatory redaction-at-source
  `SpanProcessor` chain for the **OTel pipeline** (Phase 7), the *observability*
  half of the boundary.
- **ADR-0331** — Per-signal `privacy_class` (H14 `SignalDescriptor`), **Proposed**
  — the source of the class that governs **stored-data** privacy.
- **ADR-0090 / ADR-0092** — Hot/cold topology (Timescale-hot, ClickHouse-cold,
  profile-gated) — the substrate on which hot (Phase 2) and cold (Phase 6)
  retention policies are created.
- **ADR-0091** — Two-layer store is the system of record (Phase-1 prompt 01) —
  the append-only `raw_signals` (H17) the redaction chain must never mutate.
- **ADR-0094** — Telemetry consumes `privacy_class` + crypto-erasure (Phase-1
  prompt 04) — the **stored-data** half of the boundary this ADR pins.

## Out of Scope

- Writing the Phase-2 retention / compression TimescaleDB policies.
- Setting the Phase-6 ClickHouse cold-tier retention.
- Implementing the Phase-7 redaction `SpanProcessor` chain.
- Fixing the exact per-tier canonical-retention numbers — deferred to the
  TL-register (prompt 06) unless ADR-0345 already fixes them.

## Notes

ADR-0345, ADR-0017, ADR-0074, ADR-0331, ADR-0090, and the
`docs/adr/0000a-template-lite.md` template cited above were referenced from the
Phase-1 prompt brief; the corresponding files are not all present in the
repository at authoring time. Reviewers should reconcile these citations against
the canonical `docs/adr/` set before moving the status from **Proposed** to
**Accepted**. No proto, SQL, or Kotlin was touched by this docs-only change.
