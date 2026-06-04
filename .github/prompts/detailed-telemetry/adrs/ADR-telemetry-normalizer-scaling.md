# ADR-0093 — Ingestor normalization is taxonomy-driven (registry over hand-coded `when`)

- Status: **Proposed**
- Date: 2026-06-04
- Deciders: Platform Architecture, Ingest/Normalize owners
- Consulted: Telemetry Storage owners, Analytics/Alerts (taxonomy) team
- Informed: All Phase-4 normalizer authors, Phase-3 event-shape owners
- Template: MADR-Lite (`docs/adr/0000a-template-lite.md`)

> **MADR-Lite note.** This is a **single-axis structural** decision — *how* the
> normalizer scales from 3 canonical branches to the full ~40-signal taxonomy —
> not a multi-store trade-off. The recommendation is clear and the alternatives
> are degenerate (keep hand-coding N branches). It therefore uses the light
> template (context, decision, consequences, related decisions) rather than the
> full option-scoring form.

---

## Context and Problem Statement

Today the ingestor normalizer
(`backend/services/ingestor/src/main/kotlin/io/otelog/ingestor/normalize/SignalNormalizer.kt`)
is a hand-coded `when (signal.kind)` with **three** canonical branches —
`vehicle.odometer_km`, `vehicle.battery.state_of_charge_pct`, and
`vehicle.speed_mps` — plus a `vendor.*` catch-all. Each canonical branch
**hand-writes its own** range/finiteness validation and its own per-event
mapping. Unknown-and-not-vendor kinds are dropped.

The full canonical taxonomy is **~40 signals** (doc-08 §4), populated into
`packages/contract-events/proto/io/otelog/signals/v1/canonical_signals.proto` by
the alerts taxonomy program (`alerts/phase-2-signal-taxonomy`). Each signal is
described by a `SignalDescriptor` carrying its canonical name, SI unit,
value-kind, validation bounds, and `privacy_class`.

**The problem.** Scaling the current pattern to ~40 signals means ~40 hand-coded
`when` branches. That would:

- **Re-implement validation ~40 times** (range + finiteness copied per branch),
  inviting drift and copy bugs.
- **Drift from the taxonomy** — the proto descriptor (SI unit, bounds,
  value-kind, `privacy_class`) and the normalizer's per-branch literals become
  two sources of truth that must be hand-kept in sync.
- **Force a code change for every taxonomy addition**, even when the descriptor
  already fully specifies the new signal's mapping.

We must record, before Phase 4 implements the scale-out, **which model the
normalizer follows**.

## Decision Outcome

**Adopt a registry-driven, taxonomy-keyed normalizer.** Retire the per-kind
canonical `when` for canonical signals; keep the `vendor.*` catch-all and the
drop-unknown rule unchanged.

1. **Introduce a `CanonicalSignalRegistry` (framework-free, `:domain:*` — H31).**
   The registry is the in-memory projection of the
   `canonical_signals.proto` descriptors, keyed by canonical `kind`:

   ```
   kind → SignalDescriptor { si_unit, value_kind, min, max, finiteness, privacy_class }
   ```

   It is **pure Kotlin** with no proto/framework imports. The proto read happens
   in an **adapter** (`:adapter:*`) that hydrates the registry at startup; the
   domain registry never sees a generated proto type. This preserves the H31
   domain-purity boundary.

2. **`SignalNormalizer` becomes a generic, descriptor-driven mapping:**
   - validate the envelope (unchanged);
   - **look up `signal.kind` in the registry**;
   - if found → apply **one generic validator** parameterized by the
     descriptor (`min`/`max`/`finiteness`/`value_kind`) and emit the
     canonical-sample event (Phase 3 shape) carrying the canonical kind, the SI
     value, and the descriptor's `privacy_class`;
   - if not found **but** `vendor.*` → **vendor passthrough (unchanged)**;
   - if not found **and** not `vendor.*` → **drop (unchanged, H14
     drop-unknown)**.

3. **Validation is unified here; event-shape reconciliation is deferred to
   Phase 3.** The three existing per-signal typed events (`VehicleSeenEvent`,
   battery, speed) may be **kept as promoted typed events fed alongside the
   generic sample** *or* subsumed — that reconciliation is **Phase 3's** call.
   But the **validation logic must be unified now**: one generic
   descriptor-driven validator, not per-branch copies. No branch may keep its
   own private range/finiteness check after Phase 4.

### Decision in one line

> Drive normalization from the `SignalDescriptor` registry built from
> `canonical_signals.proto` — one generic validator + mapping keyed on `kind` —
> so the ~40-signal taxonomy scales without ~40 hand-coded `when` branches; keep
> the `vendor.*` catch-all and drop-unknown rule, and read the proto only in an
> H31 adapter that hydrates a framework-free domain registry.

## Consequences

- ✅ **Scales to N signals.** Adding a taxonomy signal is a descriptor entry in
  `canonical_signals.proto`, not a new normalizer branch — no ingestor code
  change for a well-described signal.
- ✅ **One validation path.** Range/finiteness/value-kind checks live in a single
  generic validator parameterized by the descriptor; no per-branch duplication
  to drift.
- ✅ **Taxonomy is the single source of truth.** The proto descriptors (SI unit,
  bounds, value-kind, `privacy_class`) drive runtime behavior directly; the
  normalizer can no longer silently disagree with the taxonomy.
- ✅ **`vendor.*` and drop-unknown semantics preserved.** Unknown-but-`vendor.*`
  still passes through; unknown-and-not-`vendor.*` is still dropped (H14).
- ➖ **A registry hydration step is added.** Startup must build the registry from
  the proto descriptors before the normalizer serves traffic; a missing/partial
  registry is a startup-fail, not a per-event surprise.
- ➖ **Init-order gotcha (`by lazy`).** A sealed/enum registry with an **eager**
  `val ALL = listOf(...)` companion can NPE on class-init ordering (repo memory:
  sealed type + eager `val ALL = listOf(...)` → init-order NPE). Phase 4 **must**
  use `val ALL by lazy { ... }` (and lazy descriptor collections generally) so
  the list is materialized after all members are initialized.
- ➖ **H31 adapter boundary must hold.** The proto descriptor read lives in an
  `:adapter:*` hydrator; the `:domain:*` registry + validator stay framework-free.
  A domain type importing a generated proto class is a boundary violation.
- ➖ **Event-shape reconciliation still pending.** Whether the three typed events
  are kept-alongside or subsumed is **deferred to Phase 3**; Phase 4 ships the
  unified validator + generic sample regardless of that outcome.

## Confirmation

- Phase-4 `SignalNormalizer` contains **no per-canonical-kind `when` branch**
  with an inline range/finiteness check; the canonical path is a single
  registry lookup + generic validator (code review + a test asserting two
  different canonical kinds traverse the same validator).
- The `CanonicalSignalRegistry` and its validator carry **no framework/proto
  imports** (H31 module-boundary lint / dependency check); the proto read is in
  an adapter hydrator.
- The registry's eager collection is materialized via **`by lazy`**, verified by
  a registry-init test that touches `ALL` from a cold class load without NPE.
- `vendor.*` passthrough and the drop-unknown branch are preserved (parametrized
  normalizer tests: a `vendor.*` kind passes through, an unknown non-vendor kind
  drops).
- Each emitted canonical sample carries the descriptor's `privacy_class`
  (ADR-0331) and the SI value (ingest test).

## Related Decisions

- **ADR-0814** — Vertical-slice per-signal pattern — this ADR **generalizes** it:
  the per-signal shape it established is now driven by the descriptor registry
  rather than re-coded per slice.
- **ADR-0331** — `privacy_class` carried on the signal — the registry surfaces
  `privacy_class` from the descriptor so the emitted sample carries it.
- **ADR-0091** — Two-layer store is the system of record (Phase-1 prompt 01) —
  the canonical sample the registry-driven normalizer emits lands in
  `canonical_signals`; its vendor passthrough lands in `raw_signals`.
- **Alerts taxonomy program** (`alerts/phase-2-signal-taxonomy`) — owns the
  `SignalDescriptor` fields the registry consumes; this ADR makes that taxonomy
  the runtime source of truth for normalization.

## Out of Scope

- Implementing the registry, the generic validator, or the hydration adapter
  (Phase 4 / normalizer scale-out).
- The canonical-sample event shape and the typed-event reconciliation
  (kept-alongside vs subsumed) — Phase 3.
- Any change to the proto, SQL, or Kotlin source (this is a docs-only ADR draft).

## Notes

The `SignalNormalizer.kt`, `canonical_signals.proto`, the
`alerts/phase-2-signal-taxonomy` README, the
`docs/adr/0000a-template-lite.md` template, and ADR-0814 / ADR-0331 cited above
were referenced from the Phase-1 prompt brief; the corresponding files are not
all present in the repository at authoring time. Reviewers should reconcile
these citations against the canonical `backend/services/ingestor`,
`packages/contract-events`, and `docs/adr/` sets before moving the status from
**Proposed** to **Accepted**. The `by lazy` init-order note is drawn from repo
memory (sealed type + eager `val ALL = listOf(...)` → init-order NPE) and must
be honored by the Phase-4 implementation. No proto, SQL, or Kotlin was touched
by this docs-only change.
