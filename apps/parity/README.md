# Parity directory — manifest & ledgers

This directory is the machine-checkable spine of cross-platform parity enforcement
(**[ADR-006 — Parity methodology](../../.github/prompts/monorepo/adrs/ADR-006-parity-methodology.md)**,
**[ADR-011 — Definition of Done](../../.github/prompts/monorepo/adrs/ADR-011-definition-of-done.md)**).

The **web app (`web/src`) is the canonical specification.** Every native platform
(Windows, Android, Apple macOS, Apple iOS) is held to *semantic* parity with it: the
same information, hierarchy, data sources, states, and brand — rendered with native
components, not identical pixels (ADR-005).

## Files

| File | Role | Produced by | Consumed by |
|---|---|---|---|
| `manifest.schema.json` | JSON Schema (draft-07) for one **parity unit** record | this prompt (P0/0008) | P1 S0 generator, parity gates |
| `ledger.schema.json` | JSON Schema (draft-07) for one **per-platform coverage row** | this prompt (P0/0008) | every UI prompt's `=== PARITY ===` gate |
| `parity-manifest.json` | the populated manifest (array of units) | P1 Phase S0 (`web/src` scan) | all UI prompts |
| `<platform>-ledger.json` | per-platform coverage tracker (array of rows) | each UI prompt as it lands | program DONE gate |

`<platform>` is one of: `windows`, `android`, `apple-macos`, `apple-ios`.

## Manifest → ledger flow

```
web/src ──(P1 S0 scan)──▶ parity-manifest.json        (one record per parity unit)
                                  │
                                  │  requiredCount = panels + charts + maps + states + strings
                                  ▼
   UI prompt (P2/P3/P4) targets exactly ONE unit, implements it natively
                                  │
                                  │  emits a "=== PARITY ===" section in its log:
                                  │     unitId, platform, coveredCount/requiredCount, status
                                  ▼
   <platform>-ledger.json  ◀── one row appended/updated per implemented unit
                                  │  evidenceLog → path to that prompt's log
                                  ▼
   program DONE gate: every unit row status=done AND coveredCount==requiredCount
```

### What a parity **unit** is

Per ADR-006, a unit is the smallest enforceable slice of the web spec — keyed by
`kind`: `route`, `page`, `panel`, `component`, `chart`, `map`, `metric`, `state`,
`api`, or `string-group`. Each record carries its source file(s), data sources
(hooks → endpoints + params), child panels/charts/maps, the data `states` it must
render, and the i18n `strings` it shows. `requiredCount` is the parity target:
`panels + charts + maps + states + strings`.

### How `=== PARITY ===` maps to a ledger update

Every UI prompt targets exactly one manifest unit and, on completion, writes a
`=== PARITY ===` section asserting 100% coverage. The runner translates that section
into a single ledger row:

| `=== PARITY ===` field | Ledger field |
|---|---|
| unit being implemented | `unitId` |
| target platform | `platform` |
| items implemented vs. `requiredCount` | `coveredCount` / `requiredCount` |
| `todo` / `in_progress` / `done` / `blocked` | `status` |
| the implementing prompt | `promptId` |
| path to this log | `evidenceLog` |

A row is only allowed to be `status=done` when `coveredCount == requiredCount`
(ADR-011: 100% manifest coverage, all three data states, no forbidden placeholders).

## DONE = ledger 100%

Per **ADR-011**, a platform program (P2 Windows / P3 Android / P4 Apple) is **DONE**
only when its `<platform>-ledger.json` is **100%**: every unit in the manifest has a
row with `status=done` and `coveredCount == requiredCount`, and all platform gates are
green on `main`. Anything less — a stub, a skeleton panel, a missing data state, a
hardcoded string — keeps `coveredCount < requiredCount`, so the ledger is not 100% and
the program is not DONE. There is no eyeball or screenshot-diff shortcut (ADR-006
alternatives rejected).
