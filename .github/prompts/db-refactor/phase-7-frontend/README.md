# Phase 7 — Frontend Types, Hooks & Page Incidentals

> **Goal:** Align `web/` with the Phase 3 schema + Phase 5 Go shapes. Delete legacy fields (`signals`, `raw_json`, `trigger_config`, `conditions`, `actions`), add CTI automation types + `SignalObservation` + `SignalCatalogEntry`, update all 15 hook files, fix any page that read removed fields.
>
> **Pre-req:** Phase 6 complete — backend ships the new shapes.

## Prompts in this phase

| # | File | Purpose |
|--:|------|---------|
| 01 | `01-update-api-types.prompt.md` | Delete eliminated fields from `web/src/api/types.ts` |
| 02 | `02-add-new-types.prompt.md` | Add `SignalObservation`, `SignalCatalogEntry`, `AutomationFull`, `AutomationStep`, 12 step-child interfaces |
| 03 | `03-update-hooks.prompt.md` | Update all 15 `web/src/api/hooks/*.ts` for new shapes |
| 04 | `04-fix-page-incidentals.prompt.md` | Fix any page/component reading removed fields |
| 05 | `05-tsc-and-lint.prompt.md` | `npx tsc --noEmit` + `npm run lint` + `audit_code` gates |

## Reference

- Phase 3 README (column inventory)
- Phase 5 README (Go struct shapes — TS mirrors them with snake_case)
- Old monolith: `prompts/05-update-frontend-types.prompt.md` (superseded)
