# ADR-0091 — Telemetry two-layer store is the system of record (reconciles ADR-0017 with per-signal tables)

- Status: **Proposed**
- Date: 2026-06-04
- Deciders: Platform Architecture, Telemetry Storage owners
- Consulted: Ingest/Writer team, Analytics/Alerts team
- Informed: All Phase-2 migration authors, Phase-5 writer owners
- Template: MADR-Plus (`docs/adr/0000-template-plus.md`)

> **MADR-Plus note.** This is a load-bearing, multi-consequence decision: it
> determines which tables every Phase-2 migration creates and what the Phase-5
> writer writes. It therefore uses the extended template (decision drivers,
> fully scored options, explicit consequences, confirmation, related decisions).

---

## Context and Problem Statement

Two designs for telemetry persistence currently coexist in the codebase and
they overlap in purpose. We must record, before Phase 2 mints any new tables,
how they relate so that migrations target the correct system of record.

**Design A — the generic two-layer signal store (ADR-0017, Accepted 2026-05-22).**
ADR-0017 mandates a two-layer store:

- `raw_signals` — provider-native field names / units / sample frequencies;
  append-only; hour-chunked; compressed after 7 days; 90-day default retention.
  It is the **replay + audit** substrate.
- `canonical_signals` — taxonomy-aligned and SI-united; populated on ingest; the
  **query** surface for alerts, automations, and dashboards; retention equal to
  or longer than `raw_signals`.

**Design B — per-signal typed tables (ADR-0814 vertical-slice pattern).**
The repo today persists telemetry as per-signal typed tables:

- `packages/contract-storage/sql/V007__create_vehicle_battery_samples.sql`
- `packages/contract-storage/sql/V009__create_vehicle_speed_samples.sql`
- `packages/contract-storage/sql/V010__create_vehicle_vendor_signals.sql`

These are real, indexed, queried tables — not stubs. ADR-0815 (vendor
passthrough) and ADR-0816 (composite flattening) deliberately route the long
tail of fields into the generic `vehicle_vendor_signals` table rather than mint
a per-field table for each. So the repo **already** runs a "one-and-a-half
layer" pattern: typed tables for the three promoted hot signals (battery,
speed) plus a generic vendor table for everything else.

**The divergence.** ADR-0017's `canonical_signals` generic query table and the
per-signal typed tables overlap: both claim to be the SI-united, queryable
representation of a decoded reading. Left unreconciled, Phase-2 migrations could
plausibly target either, and the Phase-5 writer would have no canonical
destination. This ADR resolves which is the system of record.

## Decision Drivers

- **Replayability / audit (ADR-0017).** We must be able to re-derive canonical
  state from provider-native readings; this requires an append-only raw layer.
- **Query performance.** Alerts, automations, and dashboards need a stable,
  SI-united, indexed query surface that does not require a `UNION` across N
  typed tables.
- **H14 — bounded table permanence.** We must not mint ~40 per-signal tables;
  table count must stay bounded and the schema must not churn as new signals are
  promoted.
- **H17 — append-only raw substrate.** The system of record must be append-only;
  no in-place mutation of historical readings.
- **H18 — single canonical query surface.** Consumers query one canonical shape,
  not a per-signal schema zoo.
- **H13 — forward-only migrations (Flyway).** We may add tables; we may not edit
  or drop already-committed migrations (V007/V009/V010).
- **Storage cost.** Duplicating readings across raw + canonical (+ derived typed)
  increases footprint; the multiplier must be acknowledged and bounded by
  retention/compression.

## Considered Options

- **(A) Two-layer generic only.** Ship `raw_signals` + `canonical_signals`;
  retire the typed tables.
- **(B) Per-signal typed tables only.** Keep V007/V009/V010 as the system of
  record; mint a new typed table per promoted signal; keep
  `vehicle_vendor_signals` as the overflow.
- **(C) Hybrid — generic SoR + derived typed [CHOSEN].** `raw_signals` is the
  append-only system of record, `canonical_signals` is the generic SI query
  layer, and the per-signal typed tables become derived read-projections /
  continuous-aggregate sources fed from `canonical_signals`.
- **(D) Per-signal tables as SoR + generic overflow.** Typed tables are the
  system of record for promoted signals; `vehicle_vendor_signals` (≈ a partial
  `raw_signals`) absorbs the long tail; no canonical query layer.

### Option scoring (against the drivers)

| Driver | (A) generic only | (B) typed only | (C) hybrid [chosen] | (D) typed SoR + overflow |
|---|---|---|---|---|
| Replay / audit (ADR-0017) | ✅ raw layer present | ❌ no raw substrate | ✅ raw layer present | ➖ partial (vendor table only) |
| Query performance | ➖ generic only, needs good indexes | ✅ dedicated schemas | ✅ generic + optional typed projections | ✅ dedicated schemas |
| H14 bounded tables | ✅ 2 tables | ❌ grows per signal | ✅ 2 + few derived | ❌ grows per signal |
| H17 append-only | ✅ | ➖ depends on table | ✅ | ➖ |
| H18 single query surface | ✅ | ❌ N schemas | ✅ canonical is the surface | ❌ N schemas |
| H13 forward-only | ❌ implies dropping V007/9/10 | ✅ | ✅ keep typed as derived | ✅ |
| Storage cost | ✅ lowest | ✅ low | ➖ ~1.5–2× | ➖ raw-ish + typed |

(A) violates H13 by requiring the committed typed tables to be dropped.
(B) and (D) violate H14/H18 (table sprawl, no single query surface) and (B)
additionally fails ADR-0017's replay mandate by having no raw substrate.
(C) satisfies every hard rule and the architectural drivers at a bounded,
acknowledged storage premium.

## Decision Outcome

**Chosen option: (C) Hybrid — generic store is the system of record, typed
tables are derived read-projections.**

Concretely:

1. **`raw_signals` is the append-only system of record** for every decoded
   reading — canonical-mapped *and* vendor — keyed `(vehicle_id, ts,
   provider_kind)` with the provider-native field name / unit. The existing
   `vehicle_vendor_signals` table
   (`packages/contract-storage/sql/V010__create_vehicle_vendor_signals.sql`) is
   the closest thing today and becomes the seed of (or is folded into)
   `raw_signals` in Phase 2.
2. **`canonical_signals` is the generic SI query layer**, keyed `(vehicle_id,
   ts, canonical_kind)` with a typed value column set (numeric / string / bool),
   populated for every signal that has a canonical name. It is the surface
   alerts / automations / dashboards query.
3. **The per-signal typed tables** —
   `vehicle_battery_samples`
   (`packages/contract-storage/sql/V007__create_vehicle_battery_samples.sql`) and
   `vehicle_speed_samples`
   (`packages/contract-storage/sql/V009__create_vehicle_speed_samples.sql`) —
   are **kept as optional narrow read-projections / continuous-aggregate
   sources** where a query genuinely benefits from a dedicated schema. They are
   **derived from `canonical_signals`** and are never a second source of truth.

This decision cites and confirms **ADR-0017** (the two-layer store stands) and
is bounded by **ADR-0090** (the Timescale/ClickHouse hybrid governs where each
layer physically lives; the hot/cold split is decided separately in Phase-1
prompt 02 and is out of scope here).

### Migration shape (honest statement, forward-only — H13)

This decision **does not drop or edit** the committed V007 / V009 / V010
migrations. Phase 2 **adds** the two generic layers (`raw_signals`,
`canonical_signals`) and re-points new signals at them, leaving the three
existing typed tables in place with a documented **"derived"** status.

During the overlap window the writer (Phase 5) must reconcile old and new. Two
acceptable strategies — the ADR records the choice for Phase 5 to confirm:

- **Double-write:** the writer writes the typed table *and* `canonical_signals`
  for the promoted signals until the typed tables are re-pointed as derived; or
- **Back-fill:** the writer writes only `canonical_signals`, and the typed
  tables are refreshed from `canonical_signals` (continuous aggregate / scheduled
  back-fill), making them genuinely derived from day one.

Recommended: **back-fill** (it makes the "derived, not a second SoR" property
true immediately and avoids divergence), with a short double-write bridge only
if a zero-gap cutover for an existing dashboard query demands it.

### Consequences

- ✅ **Replay & audit preserved** — `raw_signals` retains provider-native
  readings; canonical state is re-derivable (ADR-0017 satisfied).
- ✅ **Bounded table count (H14)** — two generic layers plus a small, fixed set
  of derived projections; no per-signal table sprawl as signals are promoted.
- ✅ **Single canonical query surface (H18)** — consumers target
  `canonical_signals`; no `UNION` across a schema zoo.
- ✅ **Forward-only (H13)** — V007/V009/V010 stay committed and untouched; only
  additive migrations.
- ➖ **Storage ~1.5–2×** — readings live in `raw_signals` and `canonical_signals`
  (and, for the few derived projections, again); mitigated by ADR-0017
  compression-after-7d and 90-day retention, and bounded by ADR-0090 placement.
- ➖ **Overlap window** — a double-write or back-fill bridge exists until the
  typed tables are formally re-pointed as derived; tracked as a Phase-2/Phase-5
  follow-up.
- ➖ **Writer complexity** — the Phase-5 writer must populate `raw_signals` +
  `canonical_signals` and (transitionally) the typed tables.

### Confirmation

- Phase-2 migrations create `raw_signals` and `canonical_signals` additively and
  do **not** modify V007/V009/V010 (Flyway repeatable check / migration review).
- Phase-5 writer routes every decoded reading through `raw_signals` and, when a
  canonical name exists, `canonical_signals`; typed tables are populated only as
  derived projections (writer review + an ingest integration test asserting a
  canonical row exists for each promoted typed-table row).
- A follow-up ADR/issue records the chosen overlap strategy (double-write vs
  back-fill) and the date the typed tables are re-pointed as derived.

## Related Decisions

- **ADR-0017** — Two-layer signal store (Accepted) — *confirmed* by this ADR.
- **ADR-0090** — Time-series storage hybrid (Timescale + ClickHouse) — governs
  physical placement of each layer; hot/cold split decided in Phase-1 prompt 02.
- **ADR-0814** — Vertical-slice per-signal typed tables — *reframed*: typed
  tables become derived projections, not the system of record.
- **ADR-0815** — Vendor passthrough into `vehicle_vendor_signals` — folds into
  `raw_signals` as the seed of the raw layer.
- **ADR-0816** — Composite/flattened signal handling — its flattened readings
  land in `raw_signals` (raw) and `canonical_signals` (when named).

## Out of Scope

- Writing the actual Phase-2 migrations.
- The hot/cold ClickHouse split (Phase-1 prompt 02 / ADR-0090).
- The canonical-sample event shape (Phase 3).

## Notes

The ADR-0017, ADR-0090, ADR-0814/0815/0816 documents and the
`packages/contract-storage/sql/V007|V009|V010` migrations referenced above are
the canonical sources for this decision. This draft was authored from the
Phase-1 prompt brief; reviewers should reconcile the cited paths against the
storage package before moving the status from **Proposed** to **Accepted**.
