# UI simplification plan

Source of truth: `docs/ui-simplification-task.md`, starting at section 0. Branch: `ui/simplification`, created from `fix/dashboard-followups` at `7570c940ec`.

## Explore inventory

- Evidence card: `web/src/components/data-display/OperationalBrief.tsx`; current props include eyebrow, descriptive sentence, status badge, scope, freshness, actions, provenance, metrics, and narrative. Drawer is `OperationalNarrativeDetails.tsx`; tests include `OperationalBrief.test.tsx` and many feature/page suites that query its `Review details` role.
- Widget shell: `web/src/features/dashboard/widgets/WidgetShell.tsx` already centralizes a `DataFreshness` / `DataFreshnessAuto` header slot, refresh callback, loading/error states, help, pin and actions. Freshness implementation is under `web/src/components/data-display/DataFreshness*`; inspect before changing. The requested shared freshness dot will need to replace the existing chip consistently.
- Shared primitives: `web/src/components/ui/Button.tsx`, `Tooltip.tsx`, `Card.tsx`, `GlassPanel.tsx`, `Drawer.tsx`; icons are from `web/src/lib/icons.ts`. Reuse these and their established tooltip / keyboard conventions.
- Dashboard widgets are under `web/src/features/dashboard/widgets/`; feature pages and cards are under `web/src/features/*`. Initial recursive searches found OperationalBrief usage in vehicle pages, dashboard widgets, and other feature evidence views. The broad `Refresh` icon scan found 40+ candidates, so migrations will be inventory-driven and sequenced by shared component, dashboard, then high-traffic feature surfaces.
- Copy catalog is `web/src/i18n/en.json`, with generated split locale bundles. New UI strings will use `t()` and complete sentence keys; plural forms will use `count`. Run 
ode scripts/split-i18n-catalog.mjs --check` after catalog edits.
- Package commands: 
pm run build`, 
pm run lint`, 
px tsc --noEmit`, 
px vitest run`, and 
pm run e2e` (Playwright wrapper). No browser/dev-server interaction is attempted until the in-app/browser tooling and existing server are verified.

## Baseline gates

On `fix/dashboard-followups`, before UI edits: split catalog check passed (57 bundles, 181 fallbacks, 1,264 inlined keys, 0 missing); 
pm run lint` passed; 
px tsc --noEmit` passed; 
pm run build` passed (one existing CSS parse warning and a non-failing startup-JS budget warning, 404.8 KB vs 400 KB). Per the user's revised order, defer the full Vitest suite until simplification is complete. No e2e baseline was run.

## Checklist

| # | file / surface | page/route | widget/card | A | B | C | D | data-layer gap | attempts | status |
|---|---|---|---|---|---|---|---|---|---:|---|
| 0 | `OperationalBrief.tsx`, `OperationalNarrativeDetails.tsx`, shared tests | shared | Evidence card | todo | todo | todo | todo | inspect existing freshness contract | 0 | todo |
| 1 | `components/ui/IconButton.tsx`, shared tooltip, button | shared | IconButton | n/a | done | n/a | n/a | none | 1 | done |
| 2 | shared widget header and freshness primitives | dashboard | WidgetShell | n/a | done | done | n/a | known polling cadences supplied by eight polling widgets; other shell data is manual | 2 | done |
| 3 | `features/dashboard/widgets/**` | dashboard | all dashboard widgets | todo | in-progress | in-progress | todo | review remaining custom freshness and nested surfaces | 1 | in-progress |
| 4 | `features/vehicles/**` | vehicle routes | evidence cards and repeated actions | todo | todo | todo | todo | per row | 0 | todo |
| 5 | `features/charging/**` | charging routes | evidence cards and nested panels | todo | todo | todo | todo | per row | 0 | todo |
| 6 | remaining `features/*/**` | all remaining routes | evidence cards, repeated actions, nested cards | todo | todo | todo | todo | per row | 0 | todo |
| 7 | grep exit check, full gates and browser/e2e | app-wide | leftovers / summary | verify | verify | verify | verify | confirm | 0 | todo |

## Progress checkpoints

- Row 1 complete: added `IconButton` with caller-provided accessible label, tooltip, variants, route-link mode, busy/disabled behavior and menu ARIA props. Focused suite passed 3/3; standalone typecheck, full lint, and production build passed. No catalog key was needed because every label is passed in by the caller.

## Progress checkpoints

- Row 1 complete: added IconButton with caller-provided accessible label, tooltip, variants, route-link mode, busy/disabled behavior and menu ARIA props. Focused suite passed 3/3; standalone typecheck, full lint, and production build passed. No catalog key was needed because every label is passed in by the caller.

- Row 2 complete: WidgetShell renders freshness after other header actions, with a state dot, age, and a separate icon-only refresh action. Eight widgets with known poll intervals now pass those cadences; manual indicators go stale after 15 minutes and automatic ones after two missed intervals. All indicators share one 30-second ticker, and the dot pulses once only when status changes. The DataFreshness and WidgetShell tests pass 69/69; the eight affected widget tests pass 218/218; `tsc --noEmit`, full lint, and build pass. No new copy or catalog keys were needed. Existing empty-state tests now identify the specific empty-state status region after the shared freshness status was added.
- Row 0 complete: OperationalBrief now keeps the card face to its title, optional range, actions, flat metric values, and the review control; metadata, narrative, provenance, and metric explanations remain in the drawer. Empty metric values are filtered from the face and detailed in the drawer with a pluralized count. All-empty summaries explain when measurements will appear. Added four complete-sentence `operations.*` catalog entries and regenerated split catalogs; split check passes. Focused tests pass 23/23; standalone typecheck, full lint (including accessible-name audit), and production build pass. The build retains the existing CSS syntax warning and 404.8 KB startup bundle warning.
- Row 2 follow-up complete: removed the whole-widget green glow; new data pings the dot twice, stale uses an outlined warning ring, failed uses a slow red pulse, and reduced motion disables those animations. Retained content dims to 45% when stale or failed. Widget headings truncate and expose the full title. Focused freshness/shell tests pass 71/71; typecheck, full lint, and production build pass. The broader exploratory dashboard widget run reports 3,617 passing and 220 failing tests across 172 files; failures are queued for the ordered full-suite repair after simplification, since the full suite was explicitly deferred until then.
- Row 3 started: the eight widgets with existing automatic polling now provide their refresh interval to the shared header. The shared dashboard stat group now uses flat, wrapping 200px metric tiles, stacked labels/values, no decorative icons, and an optional `maxPerRow` cap (`cols` remains a compatible alias). `WidgetStatGrid` and `StatCard` tests pass 38/38; typecheck, full lint, and production build pass. Continue the dashboard inventory and apply A-D to every applicable widget.

## Decision log

| row # | situation | decision | why |
|---|---|---|---|
| 1 | `Tooltip` already owns hover/focus/touch/Escape behavior and Button owns busy/disabled button state. | Compose these primitives; link mode uses React Router `Link` with the shared button tokens. | Keep behavior and visuals shared and avoid another tooltip implementation. |
| 0 | User requested catalog discipline for every new user-facing string. | All new copy will be added as a complete-sentence `en.json` key and called through `t()`; counted text uses i18next `count`; run split check after each catalog edit. | Explicit user requirement and task guardrail. |
| 2 | Initial freshness checkpoint still used a whole-widget glow and did not dim stale retained content. | Move the two-cycle ping to the fresh dot, use state-specific ring/pulse shapes, dim retained content to 45%, and remove the shell glow. | Match the written C spec and keep motion local to the indicator. |
| 3 | Dashboard KPI tiles use the shared StatCard inside a single WidgetShell surface. | Preserve StatCard's shared metric formatting while rendering the dashboard group as flat flex-wrapped tiles and omitting decorative icons. | Remove nested boxes and meet the A/D metric layout without per-widget copies. |
| 0 | User reordered gates and full test execution. | Build, standalone typecheck, lint, and split check pass before simplification; full Vitest follows simplification. | Latest user priority order. |
| 0 | Task requires commits to stay build/lint/typecheck green. | Keep those checks on each shared-component or migration commit; targeted tests per row, then full Vitest at requested stage. | Task hard rule. |

## Report-only findings

- Baseline build emitted CSS warning `Unexpected "$"` at generated input `hue.bg-$`; build still exited 0.
- Baseline bundle report warns startup JS is 404.8 KB against 400 KB; non-failing.

## Summary

In progress. Row 1 IconButton and row 2 shared widget freshness are complete. Row 3 dashboard widget rollout is in progress. Current branch is `ui/simplification`; started from `fix/dashboard-followups` at `7570c940ec`.




