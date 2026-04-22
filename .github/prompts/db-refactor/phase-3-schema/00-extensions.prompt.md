---
description: "Phase 3 — Create extensions (timescaledb, vector, pg_stat_statements)"
---

# 🟢 Schema 00 — Extensions

> **Severity:** Foundational (no DDL depends on this directly, but every other Phase 3 prompt assumes the extensions are loaded)
> **Priority:** Must run first
> **Category:** Phase 3 — Schema
> **Prompt #:** 1 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/00-extensions.sql` |
| Depends on | (none — first prompt of phase) |
| Blocks | every other Phase 3 prompt (FKs need `vehicles`; hypertables need `timescaledb`) |
| ADR refs | ADR-007 (engine strategy) |
| Estimated effort | small (~15 min) |
| Throwaway DB role | **starts** the cumulative `ts-schema-validate` container |

## Single Goal

Write `schema/00-extensions.sql` containing the three `CREATE EXTENSION` statements the rest of the schema depends on.

## What's Being Established

ADR-007 chose `timescale/timescaledb-ha:pg17` as the engine because it bakes the three extensions we need into the image. They still must be `CREATE EXTENSION`-registered inside each database — the image only installs the .so files. This file does that registration **once**, before any table is created.

## Recommendation

Three extensions, in this order:

| Extension | Purpose | Used by |
|---|---|---|
| `timescaledb` | hypertables, compression policies, CAGGs | every hypertable file (03-08, 10) |
| `vector` | pgvector for embeddings | future embeddings table in `23-system-tables.sql` |
| `pg_stat_statements` | query performance instrumentation | observability — Grafana panels query this |

`IF NOT EXISTS` on each so re-runs are idempotent.

## Output (full file contents)

```sql
-- =========================================================================
-- 00 — Extensions
-- ADR-007: timescale/timescaledb-ha:pg17 image bakes these in. CREATE
-- EXTENSION is still required to register them inside the database.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

## Suggested Fix (implementation steps)

1. Create the schema directory if it doesn't exist:
   ```powershell
   New-Item -ItemType Directory -Force -Path D:\repos\teslasync\.github\prompts\db-refactor\schema | Out-Null
   ```
2. Write the file contents above to `schema/00-extensions.sql`.
3. Spin up the cumulative throwaway DB **(this prompt is the only one that creates it; later prompts just `docker exec` into it)**:
   ```powershell
   docker run -d --name ts-schema-validate -p 5499:5432 `
     -e POSTGRES_PASSWORD=v -e POSTGRES_DB=v `
     timescale/timescaledb-ha:pg17
   Start-Sleep -Seconds 12
   ```
4. Apply the file and run verification (below).
5. Commit (boilerplate at bottom).

## Acceptance Criteria

- [ ] File `schema/00-extensions.sql` exists and matches the contents above exactly
- [ ] Container `ts-schema-validate` is running on port 5499
- [ ] `psql -f` of the file succeeds with zero errors
- [ ] Query `SELECT extname, extversion FROM pg_extension WHERE extname IN ('timescaledb','vector','pg_stat_statements')` returns 3 rows
- [ ] `timescaledb` version ≥ 2.20 (anything in TS-HA pg17 satisfies this; spike measured 2.26.3)
- [ ] No tables, types, or schemas were created (only extensions)
- [ ] File is committed with the boilerplate message below

## Verification

```powershell
# Apply
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\00-extensions.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# Confirm extensions
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('timescaledb','vector','pg_stat_statements') ORDER BY extname;"

# Confirm no tables created (sanity — only extensions)
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) AS user_tables FROM information_schema.tables WHERE table_schema = 'public';"
# Expected: 0
```

## Out of Scope (reject if asked)

- Don't add `CREATE TABLE` here — tables go in numbered files starting at 01.
- Don't `CREATE SCHEMA` — we use `public`.
- Don't `CREATE ROLE` / `GRANT` — that's a runtime/Helm concern.
- Don't enable `timescaledb-toolkit` or other optional extensions speculatively.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/00-extensions.sql
git commit -m "schema(db-refactor): add extensions file

Establishes timescaledb, vector, pg_stat_statements per ADR-007.
First file of Phase 3; spins up the cumulative ts-schema-validate
container that subsequent prompts apply DDL into.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-007-engine-strategy.md` — engine + image decision
- `.github/prompts/db-refactor/phase-3-schema/README.md` — phase index and binding rules
