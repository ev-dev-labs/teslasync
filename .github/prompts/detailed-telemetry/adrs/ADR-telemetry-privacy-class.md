# ADR-0094 — Telemetry consumes and propagates SignalDescriptor.privacy_class (confirms ADR-0331)

- Status: **Proposed**
- Date: 2026-06-04
- Deciders: Platform Architecture, Telemetry Storage owners, Privacy/DPO
- Consulted: Ingest/Normalize owners, Analytics/Alerts (taxonomy) team, Security/Crypto owners
- Informed: All Phase-2 migration authors, Phase-7 redaction owners, DSAR/erasure owners
- Template: MADR-Lite (`docs/adr/0000a-template-lite.md`)

> **MADR-Lite note.** This is a **confirmation / scoping** decision, not a fresh
> trade-off. ADR-0331 (**Proposed**) already chose to carry `privacy_class` on the
> `SignalDescriptor`; the choice of *where the field lives* is owned by the
> taxonomy program. This ADR pins the **ownership boundary** (taxonomy owns the
> proto field; telemetry consumes it) and the **propagation contract** (how the
> class reaches the two-layer store, the redaction processor, and the DSAR
> crypto-erasure path) so Phase 2 and Phase 7 build against a fixed seam. It
> therefore uses the light template (context, decision, consequences, related
> decisions) rather than the full option-scoring form.

---

## Context and Problem Statement

ADR-0331 (**Proposed**) amends H14's `SignalDescriptor` proto with a mandatory
`privacy_class` enum (`Public` / `Internal` / `Confidential` / `Restricted` /
`Highly-Restricted`) plus a `declared_purpose` string, enforced by a build-time
validator that rejects `PRIVACY_CLASS_UNSPECIFIED`. The class is intended to be
the single source of truth from which the descriptor validator, runtime
middleware, DPR generator, DPIA gate, Parquet column metadata, OpenAPI docs, and
DSAR exports all derive privacy behaviour.

Two questions must be pinned before Phase 2 (columns) and Phase 7 (enforcement)
build on the class. Left unresolved, the two programs could both edit the proto,
and the telemetry store would have no defined way to scope erasure or redaction.

1. **Who owns the descriptor field?** The `alerts/phase-2-signal-taxonomy`
   program (or a dedicated taxonomy PR) adds `privacy_class` + `declared_purpose`
   to the `SignalDescriptor` proto. **This** telemetry program **consumes** the
   field. Phase 1 must state that boundary so the two programs do not both edit
   the proto.

2. **How does the class propagate?** It must reach (a) the `raw_signals` /
   `canonical_signals` rows (a denormalized `privacy_class` column stamped at
   write time, for query-time filters and DSAR scoping), (b) the redaction
   `SpanProcessor` (Phase 7, ADR-0074), and (c) the DSAR crypto-erasure path
   (per-user DEK; H35 / ADR-0332) so that erasure reaches **both** telemetry
   layers.

ADR-0091 (Phase-1 prompt 01) already established that `raw_signals` is the
append-only system of record and `canonical_signals` is the SI query surface;
ADR-0093 (Phase-1 prompt 03) already established that the registry-driven
normalizer surfaces `privacy_class` from the descriptor onto each emitted
canonical sample. This ADR closes the loop: it states where that class is
persisted and which downstream privacy mechanisms consume it.

## Decision Outcome

**Confirm ADR-0331 as the source of `privacy_class`; define its propagation
through the telemetry layers here.** Telemetry **consumes** the descriptor field;
it does **not** edit the descriptor proto.

1. **Ownership: the taxonomy program owns the proto field.** The proto change
   (add `privacy_class` + `declared_purpose` to `SignalDescriptor`) is owned by
   `alerts/phase-2-signal-taxonomy` (or a dedicated taxonomy PR). This program
   cites ADR-0331 as a dependency and never edits the descriptor proto itself. If
   the field is **not yet present** when Phase 4 runs, Phase 4 **blocks** on it
   (cross-program dependency with a named owner + deadline per H18 — see
   Consequences).

2. **Persistence: a `privacy_class` column on both layers, stamped at write
   time.** `raw_signals` and `canonical_signals` each carry a `privacy_class`
   column, populated from the descriptor at write time (denormalized for
   query-time filtering and DSAR scoping rather than requiring a descriptor-join
   on every read). **Phase 2 adds the column; this ADR mandates it.** The value
   is stamped from the same descriptor the registry-driven normalizer (ADR-0093)
   already reads, so the column can never silently disagree with the taxonomy.

3. **Redaction: the Phase-7 `SpanProcessor` reads the class.** The redaction
   processor (Phase 7, ADR-0074) reads `privacy_class` to decide its action
   (geo-fuzz / hash / drop). `Restricted`-and-above telemetry **never crosses a
   trust boundary raw**. The processor reads the stamped column (or the
   descriptor for in-flight spans), not a re-derived heuristic.

4. **Erasure: DSAR is crypto-erasure, not row deletion (H17 reconciliation).**
   DSAR erasure (H35 / ADR-0332) destroys the **per-user DEK**; both telemetry
   layers' user-tagged ciphertext becomes undecryptable. Because `raw_signals` is
   **append-only** (H17 / ADR-0091), erasure of telemetry is **crypto-erasure
   (key destruction)**, never row deletion. The `privacy_class` column scopes
   *which* readings are user-tagged ciphertext subject to the DEK, so erasure
   reaches both layers via one key-destruction operation. ADR-0339 (audit-log
   tombstone reconciliation) governs the corresponding audit record.

### Decision in one line

> Telemetry **consumes** the ADR-0331 `SignalDescriptor.privacy_class` (owned by
> the taxonomy program), stamps it as a column on **both** `raw_signals` and
> `canonical_signals` at write time, feeds it to the Phase-7 redaction
> `SpanProcessor`, and reaches both layers through DSAR **crypto-erasure**
> (per-user DEK destruction, H35/ADR-0332) — never editing the descriptor proto
> and never deleting append-only raw rows (H17).

## Consequences

- ✅ **One source of the class.** `privacy_class` is defined once on the
  `SignalDescriptor` (ADR-0331) and flows to columns, redaction, and erasure;
  no downstream component re-derives privacy behaviour from a private heuristic.
- ✅ **DSAR reaches telemetry.** The stamped column scopes user-tagged ciphertext
  on both layers, so per-user DEK destruction erases telemetry without per-row
  scans or deletes.
- ✅ **H17 preserved.** `raw_signals` stays append-only; telemetry erasure is
  crypto-erasure (key destruction), never row deletion. ADR-0339 governs the
  audit tombstone reconciliation.
- ✅ **No proto churn from telemetry.** This program never edits the descriptor
  proto, so the two programs cannot collide on it.
- ➖ **A column on both layers.** `raw_signals` and `canonical_signals` each gain
  a denormalized `privacy_class` column (Phase 2); it is stamped at write time
  and must stay consistent with the descriptor (guaranteed by sourcing both from
  the same registry — ADR-0093).
- ➖ **Cross-program dependency on the proto field.** Phase 4 (and the Phase-2
  column default) depend on the taxonomy program landing `privacy_class` +
  `declared_purpose` on the `SignalDescriptor`. **Owner:** the
  `alerts/phase-2-signal-taxonomy` program (taxonomy PR). **Deadline (H18):** the
  field must be present and the build-time `PRIVACY_CLASS_UNSPECIFIED` rejection
  validator green **before Phase 4 normalizer scale-out begins**; if it is not,
  Phase 4 blocks and escalates rather than stamping a default class. The Phase-2
  column may land with a `NOT NULL` + explicit-default-from-descriptor contract
  but must not invent a fallback class that disagrees with the taxonomy.
- ➖ **Erasure correctness depends on user-tagging.** Crypto-erasure only reaches
  readings encrypted under the per-user DEK; readings not user-tagged (e.g.
  `Public` aggregates) are out of DSAR scope by design. The `privacy_class`
  column is what makes that scoping auditable.

## Confirmation

- The descriptor `privacy_class` field is **owned and landed by the taxonomy
  program**; this program contains **no** edit to the `SignalDescriptor` proto
  (PR review + proto-ownership check).
- Phase-2 migrations add a `privacy_class` column to **both** `raw_signals` and
  `canonical_signals`, stamped at write time from the descriptor (migration
  review + an ingest test asserting each written row's `privacy_class` matches
  its descriptor).
- The Phase-7 redaction `SpanProcessor` selects its action from `privacy_class`
  (geo-fuzz / hash / drop), and `Restricted`+ never crosses a boundary raw
  (processor test per class).
- DSAR erasure is implemented as **per-user DEK destruction** (crypto-erasure),
  with **no `DELETE` against `raw_signals`** (erasure test asserting raw rows
  remain but are undecryptable after key destruction; H17 + ADR-0339 audit
  tombstone present).
- The cross-program dependency is tracked with the named owner + deadline above
  (Phase-1 → Phase-4 dependency register, H18).

## Related Decisions

- **ADR-0331** — Per-signal `privacy_class` (H14 `SignalDescriptor` amendment),
  **Proposed** — the **source** this ADR consumes; owned by the taxonomy program.
- **ADR-0074** — Telemetry redaction policy — the Phase-7 `SpanProcessor` that
  reads `privacy_class` to choose geo-fuzz / hash / drop.
- **ADR-0332** — Per-user DEK / crypto-erasure — the mechanism by which DSAR
  erasure reaches both telemetry layers without deleting append-only rows.
- **ADR-0339** — Audit-log tombstone reconciliation — governs the audit record
  for a crypto-erasure event.
- **ADR-0091** — Two-layer store is the system of record (Phase-1 prompt 01) —
  defines the append-only `raw_signals` (H17) that mandates crypto-erasure over
  deletion, and the `canonical_signals` query surface that carries the column.
- **ADR-0093** — Registry-driven normalizer (Phase-1 prompt 03) — surfaces
  `privacy_class` from the descriptor onto each emitted sample; the stamped
  column is sourced from the same registry so it cannot drift from the taxonomy.
- **Alerts taxonomy program** (`alerts/phase-2-signal-taxonomy`) — **owns** the
  `SignalDescriptor.privacy_class` + `declared_purpose` fields this ADR consumes.

## Out of Scope

- Editing the `SignalDescriptor` proto to add `privacy_class` / `declared_purpose`
  — owned by the taxonomy program (ADR-0331).
- Implementing the redaction `SpanProcessor` — Phase 7 (ADR-0074).
- Writing the Phase-2 migration that adds the `privacy_class` column.
- Implementing the per-user DEK / crypto-erasure machinery — ADR-0332 / H35.

## Notes

ADR-0331, ADR-0074, ADR-0332, ADR-0339, the `docs/adr/0000a-template-lite.md`
template, and the `alerts/phase-2-signal-taxonomy` program cited above were
referenced from the Phase-1 prompt brief; the corresponding files are not all
present in the repository at authoring time. Reviewers should reconcile these
citations against the canonical `docs/adr/` set and the taxonomy program before
moving the status from **Proposed** to **Accepted**. No proto, SQL, or Kotlin was
touched by this docs-only change.
