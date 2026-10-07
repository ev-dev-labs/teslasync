# TeslaSync frontend design contract

**Status: production foundation implemented; centralized full validation PENDING.
Runtime, visual and accessibility acceptance are NOT CLAIMED.**
This is the authoritative whole-app modernization contract at
`docs\frontend-design-contract.md`, governing all disjoint implementation
writers alongside the repository instructions. It supersedes the preparation
draft. Reviewed v1/v2/v3 source, patches and hashes remain archived in the
foundation owner's session artifacts.

## Authority, scope and validation — MDC-001

The 1,593-line whole-app specification (`paste-1790923179995.txt`) authorizes
whole-app modernization. The latest October 4 instruction authorizes live
implementation now, not another staged-only delay. Prior staged-only,
approval and prerequisite-commit ENTRY blockers no longer apply to the
authorized modernization. Stats decisions remain delegated subject to
**NO DATA LOSS**; do not add repeated naming/reference/adoption permission
stops. Full application validation follows the stable whole-app batch.
Implementation does not establish runtime acceptance or authorize premature
commits, deployment or data/feature loss.

The foundation owner integrates Input/Textarea identity, the coupled HelpIcon
description fix, their five focused test files and this document: nine exact
live targets. Other writers may implement disjoint assigned targets in parallel.
Modal, Grid, Tooltip, UI barrel, shared tokens/global CSS, feature/API/i18n and
dashboard code are outside this owner's write scope. The separate preservation
guardrail owner owns `web\scripts\check-modernization-preservation.mjs` and its
tests/baseline; this batch does not author, copy or edit that implementation.
No route, feature migration, provider, palette, engine or package is introduced.

Preserve existing business behavior and defaults. Source references and applied
code are not mounted coverage, runtime success or whole-app completion.
Authorized presentation changes must retain all data, metadata, sections,
actions, exports and specialist explanations. The mobile specification's
generic "hide secondary content" does not authorize information loss. Unknown
equivalence is a preservation risk to resolve, never permission to delete a
capability or report completion. Centralized full validation and no premature
commit remain mandatory.

## One existing architecture — MDC-002

Reuse: CSS variables / Tailwind / `lib\tokens.ts` → existing primitives →
shared composites → feature components → pages → existing shell composition.
Pages orchestrate typed hooks; components render; lib utilities derive.
Do not add ModernCard, another theme context, another token engine, router,
query-state store, duplicated formatter or a second overlay/focus system.
No feature may establish global visual patterns independently.

Feature/page callers use category barrels. Inside shared components, import
concrete modules rather than a barrel that transitively re-exports the caller.
This prevents circular cross-chunk initialization; `npm run audit:chunk-cycles`
and the production build enforce it without changing chunk budgets.

Read hooks forward TanStack Query's `{ signal }` to `request()` so unmounts and
scope changes cancel obsolete work. Keep existing query keys, enablement,
raw payloads and inherited retry/stale-time policies unchanged.

`useSignalEvidenceBundle().sources` preserves every normalized signal identity,
including pending and failed histories. Each entry exposes the existing
historical `DataState` contract with retained payload, last-success timestamp,
fatal versus refresh error and individual retry. A resolved empty history is
unavailable, not a measured zero; the existing aggregate data and query behavior
remain unchanged. Consumers must not infer missing identities from the
successful-series array or discard retained series on refresh failure.

Typography convenience wrappers forward the underlying renderer's optional
`as` element override while retaining their default element, role classes and
HTML attributes. Use this to preserve semantic markup rather than substituting
raw text elements or changing the typography role.

## Foundation APIs and design obligations

### Component-first production imports

Component-first work starts with a whole-app needs inventory, not a fixed
component count. Cover routed pages, standalone connection/public-report
surfaces and their feature components. Distinguish file enumeration from
semantic review; record uncovered paths explicitly. Development-only reference
routes are not production coverage, but shared implementations used by
production remain in scope even when their directory includes `reference`.

Map each recurring need to **reuse**, **extend**, **new**, or **local**.
The evidence-backed working list and its explicit coverage limitations are in
[the whole-app component inventory](frontend-component-inventory.md).
Check the existing implementation, not just its export name. Extensions and
new composites need concrete missing-capability evidence from at least two
independent production consumers, a typed presentation contract, preservation
requirements and focused acceptance cases. Business calculations and queries
remain outside presentation components. Consolidate overlapping proposals
before assigning exclusive implementation scopes; do not build speculative
components or resume page adoption while the needs inventory is incomplete.
Source-confirmed contracts may be implemented on exclusive paths while the
remaining inventory is closed. Finish the agreed shared-library source scope
before consolidated TypeScript, lint, regression and build acceptance; do not
repeat those full gates after every source handoff. Author focused tests with
each contract, then rerun only affected checks when a real failure needs a fix.

Finish and verify the existing shared components before expanding page adoption.
Use one bounded owner per component and centralize category exports, catalog
generation and integrated validation. Do not build another library or duplicate
an existing renderer merely because its implementation directory includes
`reference`.

Pages import `PageLayout`, `Section`, `CardGrid`, `LayoutCard`, `ChartCard`,
`LockedNotice`, `AboutPanel` and `SourceContent` from `@/components/layout`.
Import `StatStrip` and `StatGroup` from `@/components/data-display`.
`DataTable` remains the sole table pipeline in `@/components/ui`, including its
opt-in mobile presentation; `FormSection` remains in `@/components/forms`.
These exports reference the existing implementations, not replacement wrappers.
Shared implementations use concrete imports internally, never their own category
barrel. Component APIs and focused regression tests must be accepted before the
next page cohort consumes a changed contract.

Operational `StatStrip` metrics retain numeric source measurements:
`bytes` takes bytes and reuses `formatBytes` binary size formatting;
`byteRate` takes bytes per second, with `display.byteRatePeriod` selecting
`s` or `d` only at the display boundary; `latency` takes non-negative seconds,
with `display.latencyStyle` selecting fixed milliseconds or adaptive
milliseconds/seconds. Explicit precision and locale remain supported without
changing saved preferences. Signed net byte growth is valid; negative data
sizes or latency are not. Keep zero distinct from missing input, and retain
source-specific labels, captions, periods and units rather than converting
measurements to text metrics.
`mass` takes kilograms; `multiplier` keeps dimensionless factors distinct from
percentages and displays the multiplication sign. A `count` can supply numeric
`display.countTotal` to retain active/total counts without calculating a ratio.
The total must be a non-negative safe integer; an unknown numerator remains
unknown even when its total is known.
For a source-backed specialist display, `display.formatter` receives the
validated numeric source and effective display preferences before default
physical conversion, and returns value/unit strings; raw input and accessible
output remain in the shared pipeline. Invalid/missing input never reaches it,
including negative durations when `durationStyle: 'roundedMinutes'` is selected.
`notation: 'source'` retains an existing unrounded numeric representation.
`rate` permits an explicit source rate unit; it does not change physical unit
preferences. `identifier` preserves a safe non-negative integer without
grouping or rounding, with an optional `identifierPrefix`.

Contextual screenshot summaries use the existing `OperationalBrief`, not a
replacement KPI grid. `useOperationalMetrics` adapts typed source measurements
through the same formatter and saved preferences, retaining raw input, missing
reasons, source context, comparisons and navigation. Brief captions may contain
rich context and remain fully visible; loading does not fabricate values.
The details drawer follows the summary's loading suppression rather than
publishing a measurement hidden by the summary.
Status, scope, freshness and review actions must come from the actual source,
not copied "On track" or "Historical" labels from an example.

Public reports use `usePublicOperationalMetrics(metrics, preferences)` with
explicit existing viewer/source preferences. It shares the same pure formatter
as the authenticated bridge without invoking settings or formatting query
hooks. Preserve public identity, source currency and existing unit preferences;
do not add authenticated workspace subscriptions to obtain presentation data.

Paths below are relative to the repository; line citations describe the
current read snapshot. Exact hashes and source-range excerpts are in the
delivery's `source-evidence.json`; baseline proof is retained separately from
live readback. Refresh affected citations as disjoint implementations evolve.

| Stable ID | Contract / covered existing API | Source |
| --- | --- | --- |
| MDC-010 color | Neutral application/background/surface/control/border variables are canonical. Semantic hue communicates meaning; subdued surfaces and hierarchy carry structure. No new hex palette, glow or saturation escalation. | `web\src\index.css:38–80,148–207`; `web\src\lib\tokens.ts:37–45,266–294` |
| MDC-011 themes | Reuse ThemeProvider, custom colors, mode and saved theme IDs. `neon-cyan` is the persisted ID of Signal Blue, not permission to change persistence. Retain explicit Matrix Green/neon chart choices; do not force-reset preferences for aesthetic compliance. | `web\src\components\ui\ThemeProvider.tsx:138–166,315–391`; `web\src\lib\colors.ts:31–68` |
| MDC-012 text | Primary/secondary/muted/disabled/inverse/on-accent resolve through current tokens. Avoid fixed-white/fixed-gray metadata across themes. Disabled, unknown and stale are different meanings. Contrast is measured on actual composed backgrounds, not inferred from a token name. | `web\src\lib\tokens.ts:190–214`; `ThemeProvider.tsx:99–114` |
| MDC-013 typography | Use Heading/Text and role wrappers; font scale/family/weight/leading preferences survive. Tabular numbers remain. Display/metric emphasis does not make every label bold. No independent font package or arbitrary per-page scale. | `web\src\components\ui\Typography.tsx:19–126`; `web\src\lib\tokens.ts:169–234`; `web\tailwind.config.js:145–185` |
| MDC-014 spacing/density | Use Tailwind scale and density utilities. Keep default/compact/comfortable choices and non-overlapping target reachability. Do not change global padding/row defaults to claim modernization. | `web\src\index.css:91–96,209–227`; `web\tailwind.config.js:187–208` |
| MDC-015 surfaces | Card/GlassPanel share panel background/border/radius/elevation. Flat panel blur already defaults to zero. Retain public names, print markers and shapes; no competing surface wrapper merely for new vocabulary. | `web\src\index.css:131–171`; preparation inventory A14 |
| MDC-016 icons | Reuse existing Icons/Icon registries and iconSize. Decorative cues hidden from assistive tech; meaningful action names localized. Direct feature library imports do not create a new icon policy. | `web\src\lib\tokens.ts:49–59`; `docs\ICON_GUIDELINES.md` |
| MDC-020 buttons | Button already supplies primary/secondary/outline/danger/ghost, icon, loading/disabled/aria-busy, focus and density sizing. Destructive maps to danger; link chrome composes BUTTON_BASE with native navigation semantics. No new variants simply to mirror aspirational names. | `web\src\components\ui\Button.tsx:9–80` |
| MDC-021 fields | Reuse Input/Textarea/Select/Checkbox/RadioCard/Toggle plus current form patterns. Labels, feedback, required, refs, native names/values and external descriptions remain. IDs are not generated from translated content. Callers needing a predictable DOM ID must pass explicit `id`; no caller IDs, name attributes or saved data keys are renamed. | `web\src\components\ui\Input.tsx:48–61,66–108`; `Textarea.tsx:44–57,63–107`; `docs\A11Y_GUIDELINES.md:87–96` |
| MDC-022 field help | HelpIcon and Tooltip remain canonical. Help targets use field identity; default accessible help names use the visible localized label, not a generated React ID. Explicit `help.for` and `help.ariaLabel` keep priority. Contextual-help preference and tooltip keyboard/focus behavior are untouched. | `web\src\components\ui\HelpIcon.tsx:38–57,76–120` |
| MDC-023 tables | DataTable is the interaction/persistence/export owner; Table is the semantic matrix primitive. Mobile strategies must preserve full details, selection/loaded/full-result export scope, stable tableId and source ordering. DataTable.variant stays standalone/embedded. Do not substitute a fixture controller for a production pipeline. | `docs\TABLE_GUIDELINES.md`; mobile handoff API/adapter gaps |
| MDC-024 overlays | Existing Modal/Drawer/Popover/ConfirmDialog/useDialogFocus own trapping/restoration/Escape/labels. Modal now has distinct `size="fullscreen"`: full viewport at all widths, constrained internal scroll owner, persistent footer. `full` is not renamed or treated as identical. No Modal/Grid patch in this delivery; browser behavior remains parent validation. | `web\src\components\ui\Modal.tsx:16,57–79,116–138,164–178` |
| MDC-025 states/status | Badge semantic variants and severityTokens already exist; vehicle StatusBadge uses current FSM definitions. Reuse them rather than adding a competing universal status registry. Preserve domain meanings; color is never the sole signal. Unknown cannot imply offline/error/zero. | `web\src\components\ui\Badge.tsx:14–20,44–64`; `web\src\components\data-display\StatusBadge.tsx:23–49`; `web\src\lib\tokens.ts:245–307` |
| MDC-026 asynchronous trust | Distinguish initial loading, empty, unavailable, unknown, partial, stale, offline and failure. Only fatalError with no retained data may replace a source. Refresh errors keep usable data and independent neighbors. Skeleton geometry and actionable recovery are part of design. | `web\src\api\dataState.ts:130–146,158–177`; preparation A16/A19 |
| MDC-030 shell/navigation | Existing Layout/WorkspaceHeader/CommandDeck/BottomTabBar own navigation/search/notifications, selectors and account access. Retain routes, aliases, destinations, collapse prefs, pins/recents, guard/native/auth/report/kiosk behaviors. No speculative desktop moves or replacement Sidebar. | preparation inventory A03–A10/A25 and integrated crosswalk |
| MDC-031 page layout | Compose existing PageContainer/PageHeader/Grid/Stack/PageActions, then reviewed layout-reference adapters. Reports, charts and grids use the full allocated page width aligned with the header, retaining normal inherited shell gutters. Constrain individual text/form blocks when needed, not the entire analytical page; do not add a scope flag or competing width engine. Preserve content, queries, actions, `w-full`, `min-w-0` and container-query behavior. Do not compete with the layout owner or duplicate header chrome. Every section/action remains reachable; thinner orchestrators count extracted components, not fewer capabilities. Parent reports the shared PageLayout width correction source-applied; runtime validation remains pending, with no preview, deployment or native acceptance claimed. | layout implementation HANDOFF; preparation A16/A24; parent PageLayout width-correction handoff |
| MDC-032 workspace/date | Header View settings and vehicle picker own workspace scope. Consume range/vehicle hooks and URL bounds. Retain rolling/custom/calendar/DST/timezone semantics and full-server filtering; no second page date/vehicle picker. Independent business dates are not workspace selectors. | `.github\instructions\react-frontend.instructions.md:51–83`; preparation A21 |
| MDC-033 stats | One stats-owner glossary/formatMetric/StatStrip/StatGroup; raw SI to existing display helpers. Keep specialist formatters when generic support is unproved. Preserve all metrics, periods, freshness, missing reasons, comparison semantics, exports and source calculations. Delegation permits stat decisions, not data loss. | dedicated stats spec `paste-1791061822489.txt`; stats HANDOFF/adoption-policy |
| MDC-034 charts/maps | ChartContainer/category barrels/current palettes own presentation. Preserve all series, axes, zoom, legend persistence, annotation, fullscreen, export and accessible tables. Subdue reference decoration, not data meaning; do not invent data/series or replace source aggregates. | `web\src\lib\tokens.ts:chartTokens`; `web\src\lib\colors.ts:31–68`; preparation A17 |
| MDC-040 accessibility | Keyboard order/reachability, visible focus, names, semantics and text alternatives are mandatory. AA effective text contrast 4.5:1 / UI 3:1; stronger mobile target default 44px, documented WCAG spacing exceptions. Validate real open states and long labels. | `docs\A11Y_GUIDELINES.md:12–75,87–130` |
| MDC-041 forced colors | Keep system-color token remaps above ordinary inline theme properties. ThemeProvider must never write important theme variables. Preserve focus outlines and chart/table alternatives; source presence is not OS-mode acceptance. | `web\src\index.css:1649–1785`; `ThemeProvider.tsx:315–340` |
| MDC-042 motion | Existing CSS reduced-motion and useMotionPreference (OS **or** low bandwidth) remain. Reduced JS entrance uses initial=false and duration=0; no ambient loop. Do not consolidate differing animationDuration/motion timing APIs without consumer evidence; dashboard geometry belongs to parent. | `web\src\index.css:1404–1444`; `web\src\hooks\useMotionPreference.ts:44–48`; `web\src\lib\tokens.ts:108–163` |
| MDC-043 responsive | Test 320/375/390/430/768/1024/1280/1440/1920/2560; allocated container width matters as well as viewport. Retain existing desktop/mobile capabilities and 640–1023 custom branch semantics during authorized layout modernization. No lossy "mobile simplification" or repeated prior-approval entry stop. | whole-app spec §15; mobile/layout authoritative handoffs |
| MDC-044 i18n/locale | Localize labels/help/error states; use current canonical catalogs/split tools, locale/RTL/number/date policies. No secondary production catalog or source/user-data recasing. Implemented field help reuses existing `a11y.helpFor`; no catalog addition. | `.github\instructions\frontend-si-cutover.instructions.md:Required Patterns`; `docs\I18N_GUIDELINES.md` |
| MDC-045 data/SI | Raw SI survives wire/cache/hooks; display-only useUnits/useFormatting/current converters. Historical mi/mph/source-unit examples are not new implementation guidance. No backend capabilities, fake measurements, calculation changes or source-unit conversion engine. | `.github\instructions\frontend-si-cutover.instructions.md`; preparation G02/A21 |
| MDC-046 state/persistence/privacy | Reuse QueryClient/request/SSE/queryBroadcast and existing guards/preferences. Retain query keys/cache/retries/cancellation, live-only mutations, table/theme/chart/nav IDs, auth/session/demo/native boundaries and consent. No new browser token storage or telemetry logging. | preparation A01/A02/A18–A22; `web\src\api\dataState.ts` |
| MDC-047 performance | Existing lazy routes, bundle/test infrastructure and measured budgets apply. Profile before memoization, virtualization or sampling. No new dependencies solely for redesign vocabulary; no weakened ratchets. | preparation A22/A23 |

**Chart-frame source enforcement — MDC-034:** `audit-chart-frame.mjs` resolves
imported component identities through category barrels and accepts an adapter
only when its incoming children are forwarded into a canonical shared frame.
Renaming a raw wrapper, rendering an unrelated framed sibling, dropping children,
duplicating them outside the frame, or defining an unused framed helper does not
satisfy the gate. `npm run audit:chart-frame` runs the focused Node tests,
including a failing-command fixture, before auditing production source.
`npm run audit:datatable-tableid` likewise runs its parser regression tests;
both commands are wired into full frontend lint. This source proof does not
replace mounted accessibility, complete-data, toolbar, export or browser checks.

**Mobile-shell behavior — MDC-024/MDC-030:** The parent live correction preserves
the existing navigation aside and scrim, reusing `activateShellOverlayGuard`
for Tab/Shift+Tab containment and ancestor-background `inert`/`aria-hidden`
isolation; `data-sidebar-backdrop` is explicitly exempt so click-to-close
remains available. The guard releases on desktop media at min-width 1280px
and in report/kiosk modes, and Close retains a 44px target. Focus and restoration
defer to nested portaled `aria-modal` dialogs. `shellFocusTrap` excludes
hidden/inert ancestor branches while honoring an explicitly visible child's
CSS visibility override; no second overlay engine is introduced. These are
the canonical implemented behaviors, not runtime acceptance: the final
stable-source focused retest remains pending after coupled fixes, and native
visual, full TypeScript and whole-app acceptance are not established. The
unmocked frozen5241 native attempt redirected to authentication and did not
pass. No source-entry approval gate is added.

## Implemented production delta — MDC-050

**Proved source gap:** Input chooses `id || label-slug || useId`; Textarea
chooses `id ?? label-slug-or-useId`. Therefore two same-label implicit fields
produce the same control/feedback IDs, and changing the localized label changes
the implicit ID of the mounted field. Existing tests cover unlabeled uniqueness
but pin label-derived slugs; they do not prevent labeled collisions.

**Production implementation:** use each primitive's already-existing React useId for
implicit identity. Explicit caller ID fallback behavior is unchanged (Input
uses `||`, Textarea uses `??`). Labels still point at their controls; feedback
keeps existing suffixes and external-description composition. The existing
HelpIcon keeps the new implicit field target, with readable label-based
localized help names. Explicit caller ID defaults, explicit help target/name
overrides and empty-string help overrides retain baseline semantics.

No className, style, size, surface, color, default font, density, motion,
forced-color rule, preference write, form name/value, API, query, route,
calculation or section is changed. No runtime acceptance is asserted.
Automatic IDs intentionally change; they are opaque implementation identity,
not a persistence key. Consumers or automation that selected a slug must use
explicit IDs or semantic labels. Parent must validate known integration
selectors during centralized validation rather than claiming whole-app ID compatibility.

Existing Input/Textarea tests are fully retained with slug-specific
expectations changed to real association assertions. New FieldIdentity tests
cover both primitives: repeated labels/error+hint, translations, label
addition/removal, explicit IDs/native attributes, error→hint transitions,
human help names/overrides, cross-primitive collisions, refs and controlled
change events. Expanded regressions include independently mounted parents,
explicit feedback/external associations and empty help overrides. A separate
cold real-i18n test un-mocks the setup translator and loads the existing
canonical `a11y` resources; mocked fallbacks alone cannot prove localization.
All authored regression execution is **NOTRUN**.

### Compatibility closeout — MDC-051

Concrete source trace, not a second route/metric inventory:

- Old slug expectations in the existing Input/Textarea test files are confirmed
  dependencies and remain updated in the production implementation. Scoped source AST
  ID-reference matching found no additional confirmed production/external
  slug-dependent selector. This is not a blanket compatibility certificate:
  dynamic props/spreads/localized labels and external user CSS/automation
  remain UNKNOWN.
- Explicit RequestBuilder IDs and AlertMessageEditor's `textareaId` wiring
  remain unchanged. FormField injects a caller-owned ID into its cloned child;
  CurrencyInput/UnitInput/UnitListInput forward supplied IDs/descriptions
  through existing props. SearchInput keeps ref-based focus and its separate
  listbox/active-option identifiers.
- Baseline HelpIcon.for is **not only text**: it selects its default accessible
  name, supplies `data-help-for`, and adds a phantom `${for}-help` described-by
  token when truthy. Tooltip independently appends its actual body useId.
  The approved v3 root fix below removes only the phantom HelpIcon token.
  Tooltip itself remains read-only and unchanged.
- Empty `help.for=""` retains the generic More info label and empty data
  attribute, with only Tooltip's generated described-by token. Empty
  `help.ariaLabel=""` remains explicit (not converted to a derived name).
  Explicit nonempty field IDs keep ID-based default help names. Only implicit
  IDs with no explicit help target receive the readable label-derived name.

Exact bounded trace/readback, limitations and source hashes are delivered in
`compatibility-trace.SOURCE.json`, `compatibility-evidence.md` and the raw
source-only receipts. The source/browser/heavy window has been explicitly
released for live implementation. Heavy validation still belongs to the
parent's serialized baton; no writer runs project-wide validation during
concurrent source edits.

### Approved description root fix — MDC-052

Source proof: `HelpIcon.tsx:42–46,92` promises/supplies `${for}-help`, but
`Tooltip.tsx:142,203–212,222–226` generates, appends and renders its own
body ID. HelpIcon does not render any derived-ID body. Thus the fabricated
token never resolves to the help body produced by this composition.

The reviewed v3 adds only HelpIcon.tsx and its existing focused test to ownership:
remove the fabricated trigger attribute and correct its stale prop comment.
Canonical Tooltip alone supplies the actual body association. No second ID,
provider, caller-control description wiring or global Tooltip change is added.
Default/explicit/empty target names, audit data, explicit/empty ariaLabel,
contextual-help preferences, translated body, placement/classes and Escape
blur remain unchanged. Exact normalized source preservation is checked.

Focused authored tests use real Tooltip on hover/focus, require every
described-by token to resolve to its rendered body and reject phantom tokens.
They cover omitted/nonempty/empty targets, caller names (including empty),
target rerenders, preference-off and translated body plus keyboard Escape.
Execution is NOTRUN; jsdom interaction/DOM association assertions would not
prove CSS open/closed visibility, global closed-tooltip semantics or actual
screen-reader behavior. Centralized full validation and no premature commit
remain mandatory. v1/v2 and the reviewed v3 remain exact archived snapshots;
the nine reviewed targets are integrated live, not runtime accepted.

## Catalog/reference integration and unknowns — MDC-060

Consume, do not recreate:

- `parallel-modernization-preparation\snapshot.json`,
  `catalog-crosswalk.integrated.json`, `crosswalk-reconciliation.md`.
- `parallel-layout-stat-preparation` canonical route/page/JSX/stat manifests.
- `parallel-mobile-grid-preparation` original grid/list/route source records.
- `parallel-mobile-grid-reference-implementation\HANDOFF.md`, `public-api.json`.
- `parallel-layout-reference-implementation\HANDOFF.md`,
  `LAYOUT-SPEC.PROPOSED.md`.
- `parallel-stat-reference-implementation\HANDOFF.md`, `public-api.json`,
  `adoption-policy.json`, `preservation-evidence.json`.
- `parallel-dev-reference-native-specs\HANDOFF.json`: staged native specs,
  zero executed cases at its read snapshot; not borrowed acceptance.

The prior integrated crosswalk reports 234 page references, 289 exact mobile
joins and 1,694 stat joins, with 807 mobile-coordinate unknowns. These are
historical SOURCE-reference results, not fresh rendered counts. This batch
hashes its read inputs, never rebuilds route/metric inventories or upgrades
unknown coordinates into accepted consumers.

Remaining preservation/runtime unknowns (not prior approval/commit ENTRY
blockers): actual route reachability/record IDs/mounts; mobile adapters
for loaded/sorted rows/export/cumulative pages; precision/specialist semantics;
shell focus and 320px controls; actual contrast/forced colors/JS motion;
post-parent Modal behavior and current source drift. Parent-owned work may
continue changing; archived baselines are evidence, not a lock on other writers.

## Feature-agent entry and acceptance — MDC-070

For every concurrent and subsequent implementation batch:

1. Read this contract, applicable instructions and authoritative feature
   source/handoffs. Record concern IDs and exact source hashes.
2. Obtain parent-assigned exclusive targets; inspect APIs first, reuse an
   existing implementation when it meets the need.
3. Reference original catalog identities instead of inventing a route/metric
   inventory or treating snapshot line/offset as a production hook.
4. Implement the authorized modernization now within assigned write scope.
   Do not reintroduce staged-only/prior-approval/prerequisite-commit ENTRY
   blockers. Retain source/reference evidence and preserve desktop/mobile
   functionality, all preferences and every data/action/export capability.
5. Keep every metric/section/action/explanation/export and all specialist
   formatting, raw values and query/period/trust semantics. Any unsupported
   mapping is KEEP/UNKNOWN, not an EmptyState deletion.
6. Record changed public APIs, callers, explicit/automatic DOM identities and
   test expectations. Never weaken an existing behavioral assertion.
7. Reserve validation with parent. During disjoint parallel writes, do not run
   project TypeScript/build/full tests. Focused tests require an explicit
   validation baton and one worker. Parent centralizes full validation after
   the whole-app batch stabilizes; no premature commit.

The existing preservation CLI is `node web\scripts\check-modernization-preservation.mjs`:
use `capture --root <repo> --scope <scope.json> --out <baseline.json>`
with optional `--catalogs <pinned-inputs.json>` for bounded SOURCE evidence,
then `check --root <repo> --baseline <baseline.json>` with optional
`--report <report.json>`. Canonical catalog/source inputs are read-only citations
and reconciliation inputs, not inventories to recreate. Retain the frozen
original baseline; never auto-regenerate or replace it to hide regressions.
Check exit 2 explicitly means unresolved source evidence, not a clean pass.
Even source-match results and checker selftests are not full runtime,
accessibility or no-data/feature-loss proof; parent centralized validation
remains required. This adds no preimplementation approval blocker.

Acceptance checklist (all runtime items PENDING for this delivery):

- [x] Nine foundation targets integrated after exact baseline hash refresh;
      source-only post-apply readback is recorded in the session handoff.
- [ ] Explicit IDs, labels, external descriptions, focus/help and form
      values/ref/events verified in integration; implicit IDs stay unique.
- [ ] Existing and authored regressions execute; TypeScript/lint/build pass
      with raw logs (syntax-only is not typechecking).
- [ ] Relevant ten-width/theme/RTL/200%-text/long-content/open-state reviews.
- [ ] Keyboard/focus/screen reader/effective contrast/forced-colors/motion
      checked on actual UI, including retained-data and offline cases.
- [ ] No new default or persistence changes; full content/data/action/export
      parity and actual server-bound/metric invariants proven.
- [ ] Whole-app modernization batch stable; parent centralized full validation
      completed with raw evidence, no data/feature loss and no premature commit.
- [ ] Parent explicitly accepts; no source-only/global completion claim.

Rollback is parent-owned: restore only exact owned baseline bytes if this
integrated delta fails. Never revert inherited work, reset theme settings,
strip content, loosen audits or rewrite expected screenshots to hide failures.
