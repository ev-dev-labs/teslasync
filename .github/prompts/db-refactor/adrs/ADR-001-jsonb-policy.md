# ADR-001: JSONB Policy

**Status:** Accepted (2026-04-22)
**Date:** 2026-04-22
**Owner:** Backend / Data
**Supersedes:** N/A

---

## Context

The current TeslaSync schema uses `jsonb` columns extensively (~50 columns across ~25 tables). This was convenient during early development — Tesla's Fleet API returns nested objects with unpredictable shapes — but it has become a liability:

- Queries require `->`, `->>`, `jsonb_path_query` operators that are awkward in Grafana and Go
- No type safety: a typo in a JSON key fails silently at read time
- Storage grows faster than typed equivalents (TOAST'd, compressed weakly)
- Indexing is per-key and expensive
- Schema is invisible — new engineers must read code to learn what fields exist
- Continuous aggregates over jsonb fields are slow and brittle

A naive reaction is **"strict zero JSONB"**. That is a slogan, not a policy. Three concrete cases push back on it:

1. **Tesla command params** — the Fleet command API takes per-command parameter shapes defined by Tesla, not us. Modeling each as typed columns means every new Tesla command is a schema migration.
2. **Free-form error/audit details** — debug info captured at exception sites, never queried structurally
3. **Embedding metadata** — pgvector metadata is inherently variable per provider

A blanket ban forces ugly workarounds (KV side tables, parallel arrays) that are *less* maintainable than a documented JSONB exception.

## Decision

**Typed-by-default. JSONB is allowed only when an explicit ADR carve-out is granted.**

Rules:
- The default for any new column is a typed type (text, numeric, timestamptz, enum, etc.)
- Variable-shape data goes into child tables (class table inheritance) by default
- A JSONB column requires:
  1. A named ADR carve-out (e.g., "ADR-004 §3 grants `automation_actions.command_params jsonb`")
  2. A `COMMENT ON COLUMN` referencing the ADR
  3. A documented *non-queryability* — JSONB columns must not be used in `WHERE`, `GROUP BY`, or `ORDER BY` in production code paths
  4. A review date in the ADR (max 12 months) at which the carve-out is re-examined
- The CI lint check fails any new migration introducing `jsonb` without a corresponding ADR reference in the column comment

Permitted carve-outs (granted in subsequent ADRs):
- ADR-004: `automation_actions.command_params jsonb` — Tesla command contract
- ADR-005: (none — `tesla_*.raw_json` columns are deleted entirely)
- TBD: error/audit details columns may be granted in a future ADR if a real query pattern doesn't emerge

What this is **not**:
- Not "strict zero" — see context above for why that's bad architecture
- Not "use JSONB whenever convenient" — every use requires explicit justification
- Not retroactive — existing JSONB columns in `final-enhanced-commands` get migrated table-by-table per the schema design phase

## Consequences

**Positive:**
- Schema is mostly self-documenting via column types
- Queries are simple, indexable, and fast
- Type safety propagates Go ↔ DB ↔ TypeScript
- Storage efficient (typed columns compress better in TimescaleDB columnstore)
- New engineers can learn the data model from `\d table` alone

**Negative:**
- More migrations when adding new fields (vs adding a JSON key)
- More upfront design work per table
- A few legitimately variable structures need awkward child tables

**Neutral:**
- Carve-out review dates impose recurring maintenance load (small, ~1 hour/quarter)
- CI lint adds a guard that occasionally flags a legitimate use, requiring an ADR PR

**Risks:**
- A team member may bypass the policy by stuffing JSON into a `text` column. Mitigation: code review + lint for `json.Marshal` writes to non-JSONB columns.
- The "carve-out via ADR" process may become bureaucratic if used too often. Mitigation: if we hit >5 carve-outs, the policy itself is wrong and needs revisiting.
