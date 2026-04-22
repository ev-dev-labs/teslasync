# Phase 7 — Frontend Types, Hooks & Page Incidentals (atomic)

> **Goal:** Align `web/` with the Phase 3 schema + Phase 5/6 Go shapes. Delete legacy fields (`signals`, `raw_json`, `trigger_config`, `conditions`, `actions`, `raw_state`), add CTI automation types + `SignalObservation` + `SignalCatalogEntry` + typed notification-channel discriminated union, update all 15 hook files, fix every consumer page.
>
> **Pre-req:** Phase 6 complete (`phase-6-write-path/32-integration-test-fleet-batch` green).

## Atomic prompt layout (44 files)

| Range | Group | Files |
|------:|-------|------:|
| 01–06 | Existing type updates (one interface per prompt) | 6 |
| 07–09 | New signal types (observation / catalog / discriminated union) | 3 |
| 10–23 | Automation CTI types (parent + base + composite + 11 step children) | 14 |
| 24–30 | Notification channel kinds (one config per prompt) | 7 |
| 31–38 | Hook updates (one hook file per prompt) | 8 |
| 39–43 | Page-level fixes (one feature dir per prompt) | 5 |
| 44    | TSC + lint + audit + build + test gate | 1 |

Each prompt has a single `Affected files` row, single goal, depends-on the prior numeric prompt (chain). Prompt 01 depends on `phase-6-write-path/32-integration-test-fleet-batch`. Prompt 44 unblocks Phase 8 (helm/docker).

## Reference

- Phase 3 README (column inventory)
- Phase 5 README (Go struct shapes — TS mirrors them with snake_case)
- Phase 6 README (HTTP handlers — hook URLs must match)
- ADR-001 (jsonb elimination), ADR-002 (signal storage), ADR-004 (CTI), ADR-009 (signal onboarding)
