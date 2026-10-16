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
| 0 | `OperationalBrief.tsx`, `OperationalNarrativeDetails.tsx`, shared tests | shared | Evidence card | done | done | n/a | done | shared dashboard brief callers use embedded mode | 2 | done |
| 1 | `components/ui/IconButton.tsx`, shared tooltip, button | shared | IconButton | n/a | done | n/a | n/a | none | 1 | done |
| 2 | shared widget header and freshness primitives | dashboard | WidgetShell | n/a | done | done | n/a | known polling cadences supplied by eight polling widgets; other shell data is manual | 2 | done |
| 3 | `features/dashboard/widgets/**` | dashboard | all dashboard widgets | done | done | done | done | Quick Nav is static; shared header retouch and embedded overview brief verified | 2 | done |
| 4 | `features/vehicles/**` | vehicle routes | evidence cards and repeated actions | done | done | done | done | per row | 2 | done |
| 5 | `features/charging/**` | charging routes | evidence cards and nested panels | todo | todo | todo | todo | per row | 0 | todo |
| 6 | remaining `features/*/**` | all remaining routes | evidence cards, repeated actions, nested cards | todo | todo | todo | todo | per row | 0 | todo |
| 7 | grep exit check, full gates and browser/e2e | app-wide | leftovers / summary | verify | verify | verify | verify | confirm | 0 | todo |

Exit-check inventory: `rg -n '<(OperationalBrief|DashboardSourceBrief|ChargingSummaryBrief|VehicleEvidenceBrief)' web/src` and review each enclosing card, section surface, or widget for `variant="embedded"` or removal of the outer surface. Check tile row caps with `rg -n 'maxPerRow|data-max-per-row' web/src`; six-tile groups should use three per row and short rows must remain balanced. Trace composed component parents for every brief and similar card, not only its immediate JSX file. Validate every metric grid's `maxPerRow` cap and balanced rows; six tiles should render 3 + 3, with no orphan tile row.

## Progress checkpoints

- Row 4 complete: vehicle evidence panels, Tesla Physics, Vehicle List, vehicle detail, access, and cockpit summaries use the shared evidence-card patterns; missing values and drawer-only details are reflected in the regression assertions. The seven focused vehicle suites pass 239/239. Split catalog check, lint, typecheck, and production build pass. Browser screenshots at 375px, 768px, and desktop remain unavailable because this session has no in-app browser tool.

- Row 1 complete: added IconButton with caller-provided accessible label, tooltip, variants, route-link mode, busy/disabled behavior and menu ARIA props. Focused suite passed 3/3; standalone typecheck, full lint, and production build passed. No catalog key was needed because every label is passed in by the caller.

- Row 2 complete: WidgetShell renders freshness after other header actions, with a state dot, age, and a separate icon-only refresh action. Eight widgets with known poll intervals now pass those cadences; manual indicators go stale after 15 minutes and automatic ones after two missed intervals. All indicators share one 30-second ticker, and the dot pulses once only when status changes. The DataFreshness and WidgetShell tests pass 69/69; the eight affected widget tests pass 218/218; `tsc --noEmit`, full lint, and build pass. No new copy or catalog keys were needed. Existing empty-state tests now identify the specific empty-state status region after the shared freshness status was added.
- Row 0 complete after handoff correction: `OperationalBrief` supports `standalone` and `embedded`; dashboard summaries default to embedded, and Quick Stats, Glance, and Fleet Posture callers are explicitly set to the appropriate mode. The inner attention row is flat. Updated the evidence-card tests to assert missing fields and metadata in the drawer, as required by the spec. Focused OperationalBrief, DashboardSourceBrief, AnalyticsSummary, and FleetPosture suites pass 58/58; split catalog check, typecheck, full lint, and production build pass. Added one complete-sentence analytics empty-state key and regenerated the split locale bundles.
- Row 2 follow-up complete: removed the whole-widget green glow; new data pings the dot twice, stale uses an outlined warning ring, failed uses a slow red pulse, and reduced motion disables those animations. Retained content dims to 45% when stale or failed. Widget headings truncate and expose the full title. Focused freshness/shell tests pass 71/71; typecheck, full lint, and production build pass. The broader exploratory dashboard widget run reports 3,617 passing and 220 failing tests across 172 files; failures are queued for the ordered full-suite repair after simplification, since the full suite was explicitly deferred until then.
- Row 3 started: the eight widgets with existing automatic polling now provide their refresh interval to the shared header. Shared dashboard stat tiles use flat, wrapping 200px bases, stacked labels/values, no decorative icons, and optional `maxPerRow` (`cols` remains compatible). Tip and status lists now use flat rows with hairline dividers. The four affected shared-component suites pass 77/77; typecheck, full lint, and production build pass. The dashboard inventory still needs review for nested surfaces, repeated actions, and unsupported freshness sources.
- Row 3 checkpoint: Fleet Posture now uses the shared freshness control and no longer duplicates its text Refresh action. Onboarding Checklist refreshes all three prerequisite queries from the shared control and uses the oldest successful prerequisite timestamp; this applies to both active and dismissed states. Focused widget tests pass 26/26. `npx tsc --noEmit`, full `npm run lint` (all registered audits), `node scripts/split-i18n-catalog.mjs --check`, and `npm run build` pass. Build retains the known CSS parser and startup bundle warnings. Quick Nav is static navigation content without a data source, so no freshness indicator applies. Browser screenshots are unavailable because no browser tool is exposed; continue with focused tests/render checks and record this constraint at final review.
- Row 3 complete: every dashboard `DashboardSourceBrief` (47 widget usages) renders embedded; the two page-level summaries explicitly remain standalone. Fleet Posture's direct brief is embedded too. Surface scan found no remaining card-inside-card widgets: `WidgetDetailCard` is a `KVList`, and the only dashboard `<Panel>` grep hit is a `PanelTitle`. Freshness source scan found all live-data widget files covered (147 of 148); Quick Nav is static and has no freshness source. Shared icon-only actions cover both Digital Twin Open links, both Recent Drives View all links, Signal Log Pause/Resume, and Onboarding Dismiss. Other direct buttons are flow or item actions, not repeated toolbar actions. The six suites pass 144/144. Typecheck, full lint/audits, build, and catalog check pass. Empty-state cleanup remains tracked separately; no `no-action:` comments were added in these row changes.
- Shared-header follow-up: the freshness dot is now the per-widget refresh control; controls stay in a compact right cluster; shell bodies do not create nested scroll areas; title-equal WidgetBigNumber/WidgetStatGrid labels are hidden. Climate's duplicate brief heading is suppressed while its title remains available in details. Analytics fleet overview now uses an embedded brief. StatStrip accepts `maxPerRow` and distributes six items as 3+3, with short final rows balanced. Add `rg -n '<(OperationalBrief|DashboardSourceBrief|ChargingSummaryBrief|VehicleEvidenceBrief)' web/src` and `rg -n 'maxPerRow|data-max-per-row' web/src` to the final surface review. Focused shared/dashboard tests pass 144/144; browser screenshots remain blocked because no browser is available in this environment.

- Row 4 started: vehicle evidence briefs now accept standalone/embedded variants. Physics Cockpit and Tesla Physics briefs inside LayoutCard surfaces, plus vehicle battery/charging detail briefs inside GlassPanel surfaces, use embedded mode. Vehicle Access refresh controls are icon-only; empty drivers/invitations states have real actions. Charging telemetry's self-populating empty state now uses the shared informational variant and explains when data appears. Evidence, charging telemetry, battery range, Vehicle Access, and Physics Cockpit suites pass (10/10, 10/10, 13/13, 33/33, 17/17). Tesla Physics last reported 24 failures (43/67 passing) while summary context and missing-field assertions are being moved into the Review details drawer. Vehicle List last reported 21 failures (101/122 passed); many assertions still expect missing metric placeholders or methodology on the card face. Row 4 is not complete or committed.

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




