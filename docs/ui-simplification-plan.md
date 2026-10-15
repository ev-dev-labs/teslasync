# UI simplification plan

Source of truth: `docs/ui-simplification-task.md`, starting at section 0. Branch: `ui/simplification`, created from `fix/dashboard-followups` at `7570c940ec`.

## Explore inventory

- Evidence card: `web/src/components/data-display/OperationalBrief.tsx`; current props include eyebrow, descriptive sentence, status badge, scope, freshness, actions, provenance, metrics, and narrative. Drawer is `OperationalNarrativeDetails.tsx`; tests include `OperationalBrief.test.tsx` and many feature/page suites that query its `Review details` role.
- Widget shell: `web/src/features/dashboard/widgets/WidgetShell.tsx` already centralizes a `DataFreshness` / `DataFreshnessAuto` header slot, refresh callback, loading/error states, help, pin and actions. Freshness implementation is under `web/src/components/data-display/DataFreshness*`; inspect before changing. The requested shared freshness dot will need to replace the existing chip consistently.
- Shared primitives: `web/src/components/ui/Button.tsx`, `Tooltip.tsx`, `Card.tsx`, `GlassPanel.tsx`, `Drawer.tsx`; icons are from `web/src/lib/icons.ts`. Reuse these and their established tooltip / keyboard conventions.
- Dashboard widgets are under `web/src/features/dashboard/widgets/`; feature pages and cards are under `web/src/features/*`. Initial recursive searches found OperationalBrief usage in vehicle pages, dashboard widgets, and other feature evidence views. The broad `Refresh` icon scan found 40+ candidates, so migrations will be inventory-driven and sequenced by shared component, dashboard, then high-traffic feature surfaces.
- Copy catalog is `web/src/i18n/en.json`, with generated split locale bundles. New UI strings will use `t()` and complete sentence keys; plural forms will use `count`. Run `node scripts/split-i18n-catalog.mjs --check` after catalog edits.
- Package commands: `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, and `npm run e2e` (Playwright wrapper). No browser/dev-server interaction is attempted until the in-app/browser tooling and existing server are verified.

## Baseline gates

On `fix/dashboard-followups`, before UI edits: split catalog check passed (57 bundles, 181 fallbacks, 1,264 inlined keys, 0 missing); `npm run lint` passed; `npx tsc --noEmit` passed; `npm run build` passed (one existing CSS parse warning and a non-failing startup-JS budget warning, 404.8 KB vs 400 KB). Per the user's revised order, defer the full Vitest suite until simplification is complete. No e2e baseline was run.

## Checklist

| # | file / surface | page/route | widget/card | A | B | C | D | data-layer gap | attempts | status |
|---|---|---|---|---|---|---|---|---|---:|---|
| 0 | `OperationalBrief.tsx`, `OperationalNarrativeDetails.tsx`, shared tests | shared | Evidence card | todo | todo | todo | todo | inspect existing freshness contract | 0 | in-progress |
| 1 | shared tooltip, button, icons | shared | IconButton | n/a | todo | n/a | n/a | none expected | 0 | todo |
| 2 | shared widget header and freshness primitives | dashboard | WidgetShell | n/a | todo | todo | n/a | inspect query freshness fields | 0 | todo |
| 3 | `features/dashboard/widgets/**` | dashboard | all dashboard widgets | todo | todo | todo | todo | per widget during inventory | 0 | todo |
| 4 | `features/vehicles/**` | vehicle routes | evidence cards and repeated actions | todo | todo | todo | todo | per row | 0 | todo |
| 5 | `features/charging/**` | charging routes | evidence cards and nested panels | todo | todo | todo | todo | per row | 0 | todo |
| 6 | remaining `features/*/**` | all remaining routes | evidence cards, repeated actions, nested cards | todo | todo | todo | todo | per row | 0 | todo |
| 7 | grep exit check, full gates and browser/e2e | app-wide | leftovers / summary | verify | verify | verify | verify | confirm | 0 | todo |

## Decision log

| row # | situation | decision | why |
|---|---|---|---|
| 0 | User requested catalog discipline for every new user-facing string. | All new copy will be added as a complete-sentence `en.json` key and called through `t()`; counted text uses i18next `count`; run split check after each catalog edit. | Explicit user requirement and task guardrail. |
| 0 | User reordered gates and full test execution. | Build, standalone typecheck, lint, and split check pass before simplification; full Vitest follows simplification. | Latest user priority order. |
| 0 | Task requires commits to stay build/lint/typecheck green. | Keep those checks on each shared-component or migration commit; targeted tests per row, then full Vitest at requested stage. | Task hard rule. |

## Report-only findings

- Baseline build emitted CSS warning `Unexpected "$"` at generated input `hue.bg-$`; build still exited 0.
- Baseline bundle report warns startup JS is 404.8 KB against 400 KB; non-failing.

## Summary

In progress. No UI code changed yet. Current branch is `ui/simplification`; started from `fix/dashboard-followups` at `7570c940ec`.
