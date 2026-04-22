# ADR-009: Future Signal Onboarding Runbook

**Status:** Accepted (2026-04-22)
**Date:** 2026-04-22
**Owner:** Backend / On-call
**Depends on:** ADR-002, ADR-001

---

## Context

Tesla adds new Fleet Telemetry signals quarterly without coordination. Historical examples:
- `ChargePort` was added mid-2024 — required new column + handler change
- `BMSState` enum gained values — required widening migration
- `TonneauPosition` was added for Cybertruck — required new column

If new signals can only be ingested after a code+migration deploy, the engineering team becomes a bottleneck for product timeliness. If new signals are dropped silently, we lose data.

ADR-002 establishes a hot/cold split where unknown signals automatically land in `signal_observations`. This ADR defines the **operational runbook** that turns ADR-002 into a real workflow:

1. How does an unknown signal get noticed?
2. When should it be promoted to a typed column (hot path)?
3. Who decides? What does the migration look like?

Without this runbook, `signal_observations` grows indefinitely with signals nobody knows about, and the hot/cold boundary drifts arbitrarily.

## Decision

**Adopt the following lifecycle for unknown signals.**

### Stage 1 — Auto-ingest (zero friction)
- Telemetry handler routes any unrecognized signal name to `signal_observations`
- A `signal_catalog` table tracks every signal name ever seen:
  ```sql
  CREATE TABLE signal_catalog (
    signal_name      text PRIMARY KEY,
    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    observation_count bigint NOT NULL DEFAULT 0,
    storage_tier     text NOT NULL DEFAULT 'cold' CHECK (storage_tier IN ('hot','cold','dropped')),
    typed_table      text,         -- when promoted: where the typed column lives
    typed_column     text,         -- when promoted: the column name
    notes            text
  );
  ```
- A nightly job updates `last_seen_at` and `observation_count` from `signal_observations`

### Stage 2 — Discovery alert
- A scheduled query runs daily:
  ```sql
  SELECT signal_name, observation_count, last_seen_at - first_seen_at AS lifespan
  FROM signal_catalog
  WHERE storage_tier = 'cold' AND observation_count > 10000
  ORDER BY observation_count DESC;
  ```
- Results emitted to the `#tesla-signals` notification channel weekly
- This is the **on-call signal triage** ritual

### Stage 3 — Promotion decision
A cold signal becomes a candidate for promotion when ANY of:
- (a) Used by a Grafana dashboard (queried >100 times/week)
- (b) Used by an automation trigger or condition
- (c) Used by an alert rule
- (d) Observation count >100k/week sustained

When a candidate emerges, the on-call engineer:
1. Files a brief promotion ticket (template: signal name, evidence, proposed home table)
2. Tags an ADR-002 amendment (no full ADR needed — just a row append in a tracking doc)
3. Implements the migration:
   - ALTER TABLE add column on the target snapshot table (instant on hypertables)
   - Update `internal/enums/signal_types.go` to add the signal to the hot list
   - Update `normalizeFleetUnits` if needed for unit conversion or compound flattening
   - Update `signal_catalog` row: `storage_tier='hot', typed_table=..., typed_column=...`
4. Backfill (optional): copy historical observations from `signal_observations` into the typed column for dashboard continuity. Can be skipped if dashboard only needs forward data.

### Stage 4 — Demotion (rare)
A hot signal can be demoted back to cold if it stops being queried for >90 days. This is a manual decision; not automatic. Demotion is the reverse migration: drop column, mark `storage_tier='cold'`. The cold-path data continues to exist.

### Stage 5 — Drop (very rare)
If Tesla deprecates a signal entirely and we have no historical use case, set `storage_tier='dropped'` and add an ingest-time skip. Existing data in `signal_observations` is left for retention to expire it.

## Consequences

**Positive:**
- New Tesla signals never block product work
- Promotion is a checklist, not a debate
- Schema evolves data-driven, not opinion-driven
- The `signal_catalog` table becomes the operational source of truth for "what signals exist"
- On-call rotation has a concrete weekly task that prevents drift

**Negative:**
- Adds a small operational ritual (~30 min/week)
- Requires `signal_catalog` updates to be reliable (a bug in the discovery query means signals slip through unnoticed)

**Neutral:**
- The promotion threshold criteria (10k, 100k, etc.) are starting points; tune after 6 months of operation
- Some teams may try to promote signals "just in case" — pushback expected and welcome

**Risks:**
- If the discovery alert is ignored for months, `signal_observations` grows large with rarely-used signals. Mitigation: retention policy on `signal_observations` (365 days per ADR-002) caps growth.
- A signal may be promoted but the historical backfill missed, causing a silent dashboard gap. Mitigation: promotion checklist includes "verify dashboard query returns data for last N days".
