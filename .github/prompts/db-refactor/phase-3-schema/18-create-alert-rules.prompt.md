---
description: "Phase 3 — Create alert_rules table (typed alert rule storage)"
---

# 🟢 Schema 18 — `alert_rules`

> **Severity:** Standard
> **Priority:** Medium
> **Category:** Phase 3 — Schema (alerting)
> **Prompt #:** 19 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/18-alert-rules.sql` |
| Depends on | `01-create-vehicles` |
| Blocks | `20-create-notifications` (notifications reference rule_id) |
| ADR refs | ADR-001 (typed-by-default — replaces any prior `rule_def jsonb`) |
| Estimated effort | small (~25 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/18-alert-rules.sql` containing the typed alert rule definition table.

## What's Being Established

The previous schema stored alert rules as JSONB. Per ADR-001, alert rules are typed: a rule has a signal name, an operator, a threshold value, and an optional vehicle filter. Severity is a closed enum.

## Recommendation

- `id bigint GENERATED ALWAYS AS IDENTITY`
- `severity` text + CHECK (info/warn/critical)
- `vehicle_id` nullable — NULL means "all vehicles"
- `cooldown_min` integer — minimum minutes between consecutive alerts for the same rule

## Output (full file contents)

```sql
-- =========================================================================
-- 18 — alert_rules
-- ADR-001: typed rule storage (no jsonb rule_def).
-- =========================================================================

CREATE TABLE alert_rules (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name          text             NOT NULL,
  description   text,
  enabled       boolean          NOT NULL DEFAULT true,
  vehicle_id    bigint           REFERENCES vehicles(id) ON DELETE CASCADE,
  signal_name   text             NOT NULL,
  op            text             NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','changed','between','outside')),
  value_num     double precision,
  value_text    text,
  value_bool    boolean,
  value_min     double precision,
  value_max     double precision,
  severity      text             NOT NULL DEFAULT 'warn'
                                 CHECK (severity IN ('info','warn','critical')),
  cooldown_min  integer          NOT NULL DEFAULT 60 CHECK (cooldown_min >= 0),
  created_at    timestamptz      NOT NULL DEFAULT now(),
  updated_at    timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE  alert_rules IS 'Typed alert rule storage. ADR-001: no jsonb rule_def column.';
COMMENT ON COLUMN alert_rules.vehicle_id IS 'NULL = applies to all vehicles owned by the user.';
COMMENT ON COLUMN alert_rules.cooldown_min IS 'Minimum minutes between consecutive alerts from this rule, regardless of signal value.';

CREATE TRIGGER alert_rules_set_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = true;
CREATE INDEX idx_alert_rules_signal  ON alert_rules (signal_name);
```

## Suggested Fix

1. Confirm `vehicles` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] CHECK on `op` covers 9 operators including `between`/`outside`
- [ ] CHECK on `severity` enforces info/warn/critical
- [ ] CHECK on `cooldown_min >= 0` applied
- [ ] FK to vehicles is CASCADE; nullable
- [ ] Both indexes present (partial enabled + signal_name)
- [ ] Trigger registered
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\18-alert-rules.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# 3 CHECK constraints
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT count(*) FROM pg_constraint WHERE conrelid='alert_rules'::regclass AND contype='c';"
# Expected: 3 (op, severity, cooldown_min)

# Partial index on enabled
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT indexdef FROM pg_indexes WHERE indexname='idx_alert_rules_enabled';"
```

## Out of Scope

- Don't add `notification_channel_ids text[]` — channel routing is per-notification.
- Don't add ML/anomaly-detection rules — out of Phase 3 scope.
- Don't add a `rule_def jsonb` fallback — ADR-001 forbids.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/18-alert-rules.sql
git commit -m "schema(db-refactor): add alert_rules typed storage

ADR-001: replaces prior jsonb rule_def with typed columns.
9 operators including between/outside; severity info|warn|critical.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-001-jsonb-policy.md`
