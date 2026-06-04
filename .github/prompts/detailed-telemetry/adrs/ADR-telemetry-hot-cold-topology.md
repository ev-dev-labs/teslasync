# ADR-0092 — Telemetry hot/cold topology: Timescale-hot always-on, ClickHouse-cold profile-gated (confirms ADR-0090)

- Status: **Proposed**
- Date: 2026-06-04
- Deciders: Platform Architecture, Telemetry Storage owners
- Consulted: Ingest/Writer team, Analytics/Alerts team, Deployment/Helm owners
- Informed: All Phase-2 migration authors, Phase-6 cold-tier + CDC owners
- Template: MADR-Lite (`docs/adr/0000a-template-lite.md`)

> **MADR-Lite note.** This is a **confirmation / scoping** decision, not a fresh
> trade-off. ADR-0090 already chose the hybrid two-tier topology and is
> **Accepted**. This ADR pins the **Phase-1 baseline scope** of that decision so
> Phase 2 and Phase 6 build against a fixed seam. It therefore uses the light
> template (context, decision, consequences, related decisions) rather than the
> full option-scoring form.

---

## Context and Problem Statement

ADR-0006 ratified TimescaleDB **provisionally** and deferred the durable choice
to doc-15 (`planning/40-storage-compute/15-time-series-storage.md`). **ADR-0090
(Accepted) supersedes ADR-0006** with a **two-tier hybrid**:

- **Hot tier — TimescaleDB (always on).** Serves Q1/Q3 (single-vehicle charts,
  the last-15-minute alert hot path) and all OLTP JOINs.
- **Cold tier — ClickHouse (profile-on for fleet+ tiers only).** Serves Q2/Q4
  (multi-year rollups, fleet-wide degradation analytics).
- **Wiring — Postgres-WAL CDC → Redpanda → ClickHouse**, target CDC lag ≤ 60s
  p95, **never on the synchronous ingest path**.

Three forces hardened ADR-0090 and are **not re-opened here**:

1. **H24** — Timescale multi-node was removed in 2.14, so a single Timescale node
   caps the fleet-wide analytics path; the cold tier exists to lift that cap.
2. The **"no re-platform at 10k vehicles"** directive — the fleet path must scale
   without a storage migration.
3. The **AGPL self-host pillar** — a one-vehicle self-host must come up with a
   single command and must never be forced to run ClickHouse.

The open question this ADR closes is **not** "which stores" (ADR-0090 settled
that) but **"what does Phase 1 ship, and where is the cold-tier seam?"** Without
pinning this, Phase-2 migrations could target the wrong store and a single-vehicle
self-host could be saddled with an idle ClickHouse + Redpanda + CDC stack.

## Decision Outcome

**Confirm ADR-0090; scope Phase 1 to "hot-tier + CDC-seam-ready."**

1. **Phase 2 builds the two-layer store (`raw_signals` + `canonical_signals`)
   on TimescaleDB only.** No cold-tier tables are created in Phase 1/2. (The
   two-layer table shape itself is owned by Phase-1 prompt 01 / ADR-0091 and is
   out of scope here.)

2. **The cold tier is profile-gated and default OFF.** Phase 6 builds the
   ClickHouse schema **and** the CDC consumer, activated only by a dedicated
   **`cold-tier` deployment profile** (Compose profile / Helm value, default
   disabled). A 1-vehicle self-host therefore never instantiates ClickHouse,
   Redpanda, or the CDC writer.

3. **CDC is off the synchronous hot path (H24 invariant).** The cold path is
   Postgres logical replication → Redpanda → cold writer. It is **not** in the
   ingestor or `ts-writer` synchronous path: hot writes never block on cold
   availability. The cold-tier failure mode is annotated **`FAIL_OPEN_DEGRADED`**
   — losing CDC/Redpanda/ClickHouse degrades **analytics freshness only** and
   **never** stalls or fails a hot write.

4. **The cold seam is designed now, built later.** Phase 1 fixes the contract of
   the seam — the CDC source (logical-replication slot on `canonical_signals` /
   `raw_signals`), the Redpanda topic, and the cold-writer consumer contract — so
   Phase 6 can implement against a stable interface. No cold code ships in Phase 1.

5. **The CDC-lag SLO number (≤ 60s p95) is owned by the TL-register
   (Phase-1 prompt 06)** and is **measured via OTel (H10)**. This ADR records the
   target's existence and ownership but defers the authoritative number and its
   alerting to the register.

### Decision in one line

> Ship the hot tier (Timescale, always-on) and the two-layer store on it in
> Phase 2; design the cold seam now but gate ClickHouse + CDC behind a default-OFF
> `cold-tier` profile built in Phase 6, with CDC permanently off the hot write path.

## Consequences

- ✅ **Self-host stays one-command-up.** Default profile = hot tier only; no
  ClickHouse/Redpanda/CDC for a single-vehicle deployment.
- ✅ **Fleet path uncapped.** The cold tier lifts the single-node Timescale
  analytics cap (H24) for fleet+ tiers without a re-platform.
- ✅ **Hot writes are never coupled to cold availability** (`FAIL_OPEN_DEGRADED`);
  a stuck/absent ClickHouse degrades analytics freshness only.
- ✅ **Stable seam for Phase 6.** The CDC topic + cold-writer contract are fixed in
  Phase 1, so Phase 6 implements against a known interface.
- ➖ **Two stores at fleet+.** Operators on fleet tier run and observe both
  Timescale and ClickHouse (plus Redpanda + CDC).
- ➖ **CDC lag on cold analytics.** Fleet-wide rollups trail real time by the CDC
  lag (target ≤ 60s p95, owned by the TL-register); acceptable for Q2/Q4 (rollups
  / degradation), never used for the alert hot path (Q1/Q3 stay on the hot tier).

## Confirmation

- Phase-2 migrations create `raw_signals` / `canonical_signals` on TimescaleDB
  only; no ClickHouse DDL appears in Phase 1/2 (migration review).
- The `cold-tier` profile is **absent or disabled by default** in Compose and Helm
  values; enabling it is the only way ClickHouse/Redpanda/CDC instantiate
  (`helm template` / `docker compose config` review).
- The ingestor and `ts-writer` synchronous paths contain **no** call that blocks on
  ClickHouse/Redpanda/CDC (writer review + a failure-injection test asserting hot
  writes succeed with the cold tier down).
- The CDC-lag SLO is registered and OTel-measured in the Phase-1 prompt-06
  TL-register, not hard-coded here.

## Related Decisions

- **ADR-0090** — Time-series storage hybrid (Timescale + ClickHouse), **Accepted**
  — *confirmed, not re-decided,* by this ADR.
- **ADR-0006** — TimescaleDB (provisional) — *superseded* by ADR-0090; recorded
  here for lineage.
- **ADR-0017** — Two-layer signal store — the layers placed by this topology.
- **ADR-0091** — Telemetry two-layer store is the system of record (Phase-1
  prompt 01) — defines the table shape that lives on the hot tier here.
- **ADR-0342** — Collector topology — upstream of the ingest path referenced by
  the hot-path invariant.
- **ADR-0345** — Retention — governs hot-tier compression/retention and the
  cold-tier horizon the CDC seam ultimately feeds.

## Out of Scope

- The two-layer table DDL / shape (Phase 2 / ADR-0091).
- The ClickHouse schema and the CDC consumer implementation (Phase 6).
- The authoritative CDC-lag SLO number and its alert wiring (Phase-1 prompt 06
  TL-register).

## Notes

The ADR-0090 / ADR-0006 / ADR-0017 / ADR-0342 / ADR-0345 documents, the
`docs/adr/0000a-template-lite.md` template, and `planning/40-storage-compute/15-time-series-storage.md` §9
cited above were referenced from the Phase-1 prompt brief; the corresponding
files are not yet present in the repository at authoring time. Reviewers should
reconcile these citations against the canonical `docs/adr/` set before moving the
status from **Proposed** to **Accepted**. No proto, SQL, or Kotlin was touched by
this docs-only change.
