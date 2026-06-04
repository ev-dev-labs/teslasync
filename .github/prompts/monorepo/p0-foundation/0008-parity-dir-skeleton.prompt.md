---
description: "P0/0008 — Parity directory schema: manifest + per-platform ledgers (ADR-006)"
---

# P0 · 0008 — Parity directory schema

> **Severity:** Foundational (spine of parity enforcement) · **Delegation:** FORBIDDEN · **Prompt:** 8 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/parity/manifest.schema.json`, `apps/parity/ledger.schema.json`, `apps/parity/README.md` |
| Allowed files | `apps/parity/**`, the log file |
| Depends on | 0001 |
| Blocks | P1 S0 (manifest generation); every UI prompt's parity gate |
| ADR refs | ADR-006 (parity methodology), ADR-011 (DoD) |
| Log | `../logs/p0-0008-parity-schema.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Define the JSON schema for the parity **manifest** (the canonical web spec) and the
per-platform **ledger** (coverage tracker) so P1 can populate them and UI prompts can gate.

## Output — `apps/parity/manifest.schema.json` (one record per parity unit)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Parity manifest unit",
  "type": "object",
  "properties": {
    "id":        { "type": "string", "description": "stable id, e.g. 'page:charging/ChargingDetail' or 'panel:dashboard/FleetStatus'" },
    "kind":      { "enum": ["route","page","panel","component","chart","map","metric","state","api","string-group"] },
    "title":     { "type": "string" },
    "sourceFiles": { "type": "array", "items": { "type": "string" }, "description": "web/src paths" },
    "route":     { "type": "string" },
    "dataSources": { "type": "array", "items": { "type": "string" }, "description": "hook names + endpoints + params" },
    "panels":    { "type": "array", "items": { "type": "string" } },
    "charts":    { "type": "array", "items": { "type": "string" } },
    "maps":      { "type": "array", "items": { "type": "string" } },
    "states":    { "type": "array", "items": { "enum": ["loading","empty","error","success"] } },
    "strings":   { "type": "array", "items": { "type": "string" }, "description": "i18n keys rendered" },
    "requiredCount": { "type": "integer", "description": "panels+charts+maps+states+strings = parity target" },
    "notes":     { "type": "string" }
  },
  "required": ["id","kind","title","sourceFiles","requiredCount"]
}
```

## Output — `apps/parity/ledger.schema.json` (per-platform coverage row)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Parity ledger row",
  "type": "object",
  "properties": {
    "unitId":   { "type": "string" },
    "platform": { "enum": ["windows","android","apple-macos","apple-ios"] },
    "status":   { "enum": ["todo","in_progress","done","blocked"] },
    "coveredCount":  { "type": "integer" },
    "requiredCount": { "type": "integer" },
    "promptId": { "type": "string", "description": "the prompt that implemented it" },
    "evidenceLog": { "type": "string", "description": "path to the prompt log with === PARITY ===" }
  },
  "required": ["unitId","platform","status","coveredCount","requiredCount"]
}
```

`apps/parity/README.md`: explain manifest→ledger flow, that a program is DONE only when its
ledger has every unit `status=done` with `coveredCount==requiredCount`, and how the UI-prompt
`=== PARITY ===` section maps to a ledger update.

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. Write both schemas + README.
3. GATE: both schemas `ConvertFrom-Json` successfully; README references ADR-006 + ADR-011. Emit `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] Manifest schema covers all unit kinds + `requiredCount`.
- [ ] Ledger schema covers all 4 platform targets + coverage counts + evidence log.
- [ ] README explains DONE = ledger 100%.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add apps/parity .github/prompts/monorepo/logs/p0-0008-parity-schema.log
git commit -m "feat(monorepo): parity manifest + ledger schemas (P0/0008)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
