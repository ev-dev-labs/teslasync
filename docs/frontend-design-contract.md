# TeslaSync frontend design contract

**Phase-1a authority; design decisions, not implementation or runtime acceptance.**
Every frontend worker reads this existing contract before modifying UI. It covers
[mission](frontend-mission.md) §2 and the whole application, including standalone
connection/public surfaces, native hosts and production-used reference components.
Only explicit assigned ownership authorizes writes.

## Authority, scope and validation — MDC-001

Phase 0 is accepted and committed at **2dd0943ead**; checkpoint **bfeaa733d9**.
[Current inventory](frontend-inventory.md) records **237 production source audits,
4 DEV exclusions, 480 proposals and 244 semantic review scopes**. A review scope
is neither an approved component nor implemented behavior. Source audit is not
fresh authentication, backend, visual, keyboard or runtime acceptance.

Preserve the [historical inventory](frontend-component-inventory.md)'s **20
contracts: 2 new, 2 promotions, 16 existing extensions**. Its scoped historical
acceptance remains historical; reuse the actual APIs, not a competing library.
Current inventory dispositions (`reuse`, `extend-review`, `styling-review`,
`integration`, `local`, `unresolved-owner-review`) retain their evidence limits.
The accepted current inventory governs proposal ownership; historical cohort
counts, staging/index observations and prior permission stops do not govern dispatch.

The orchestrator **only audits, plans, dispatches, monitors health, runs gates and
commits**; implementation belongs to assigned workers. Workers never run Git.
Dispatch one atomic item per worker, at most **32** concurrent workers, with
exclusive files and actual lifecycle ownership through completion/failure and
release. Preserve former-worker ownership and every unrelated inherited delta;
an old report or silent heartbeat does not release another worker's files.
The orchestrator performs a **scoped sequential commit after each verified DONE**,
and phase checkpoints. Do not reintroduce October 4 cohort write scopes,
staged-only/no-commit prerequisites, prior-approval entry gates or stats permission
loops. A verified documentation DONE does not imply a passed implementation gate.

Typecheck every **15 commits, including report-only commits**. Inherited health:
at commit **240**, `cd web; npx tsc --noEmit` exited **2**, with **54 diagnostics
in 37 files**. Current cadence is **243**, next due **255**. These are inherited
receipts, not a fresh run or repaired baseline. All implementation phase gates
must pass: supported runtime, build/typecheck, required lint/audits/tests and
phase-specific preservation/QA. Red is never green; resolve failures through
assigned bounded items, without weakening ratchets. Full runtime acceptance is future.

Actual inherited Node is **24.18.0**, versus `web\package.json` engines **>=26.0.0**.
The inspected NVM list contains 24.18.0, 20.19.0, 20.18.0 only. This does **not**
prove Node 26 is absent elsewhere. Locate/provision and verify a supported runtime
before gates; this documentation item installs/switches nothing.

## One existing architecture — MDC-002

Existing CSS variables/Tailwind/`web\src\lib\tokens.ts` → primitives → composites
→ feature components → pages → existing shell. D0 foundations have no consumer
dependencies; D1 primitives/query/trust depend on D0; D2 layouts/composites use
D0/D1; D3 domain adapters/pages use those layers. Validation is not a component
dependency. No new theme context, token engine, query store, formatter, router,
overlay engine, ModernCard or speculative component family.

Features/pages use category barrels (`@/components/ui`, `layout`, `forms`,
`data-display`, `charts`, `feedback`, `maps`, `motion`, etc.). Shared components
use concrete internal modules, never their own transitively recursive category
barrel. Vendor charts/maps/motion stay behind existing shared boundaries.
Typed hooks own reads; lib/domain adapters own calculations; components render.
Retain cancellation (`{ signal }` → `request()`), query keys, enablement,
retry/stale-time policies, raw payloads and source scope. No `any`, swallowed
failures, ad-hoc fetch/useEffect data loading or speculative backend capabilities.

Reuse before extension; a shared public API expansion needs two independent
production consumers unless intrinsically global. Children of one page are not
independent consumers. Report unsupported mappings as KEEP/UNKNOWN and retain
the source behavior. Domain-specific work stays local; only its assigned
integration owner changes endpoints/types/catalogs/routing/lifecycle.

## Restrained foundation decisions

Values below are **Phase-1 targets at existing owners**, not a claim that current
tokens already implement them. Keep role names and public APIs; pages do not
paste these hex values into local styles. Implementation gaps are listed in
MDC-080. Read snapshots are citations, not locks on concurrent source changes.

### Color, theme and text — MDC-010 / MDC-011 / MDC-012

Reduce noise actively: neutral surfaces, soft text, one dominant action, bounded
semantic accents. No decorative neon, glow, saturated gradients, white metadata,
rainbow progress bars or colored shadows. Hue conveys meaning, not card grouping.
One primary metric/state/action can lead; supporting content and metadata recede
through spacing/type/surfaces, never inaccessible low contrast.

| Existing role | Dark target | Light target |
| --- | --- | --- |
| `--bg`, `--bg-app` | `#0b0d12` | `#f8fafc` |
| `--surface-1`, `--panel-bg` | `#11151c` | `#fafbfc` |
| `--surface-2`, elevated/control | `#171c25` | `#f1f5f9` |
| `--surface-3`, control hover | `#202733` | `#e2e8f0` |
| `--text-primary` | `#f4f7fb` | `#0f172a` |
| `--text-secondary` | `#aab4c3` | `#475569` |
| `--text-muted` starting value | `#8490a2` | `#64748b` |
| `--border-subtle/default/strong` | white at 5.5% / 9% / 16% | black at 6% / 12% / 20% |
| `--surface-overlay` | black at 60% | `#0f172a` at 50% |
| `--focus-ring` | `#91b4d2` | `#385e7e` |

Borders above organize surfaces, not sufficient control/focus contrast by
themselves. Required interactive outlines must reach **3:1** against adjacent
backgrounds; strengthen the existing control/border role where necessary.
Text, including captions/muted data, must reach **4.5:1** on the actual composed
background. Existing `accessibleMutedForeground()` must continue adjusting across
all preset surfaces; starting values are not universally certified pairs.
Disabled is an interaction state, not a substitute for unknown/stale values.

| Semantic role at existing token maps | Dark foreground | Light foreground | Treatment |
| --- | --- | --- | --- |
| Brand/info/focus | `#91b4d2` | `#385e7e` | Restrained blue, no cyan bloom |
| Success/online/complete | `#91b9a5` | `#38614f` | Only source-confirmed success |
| Warning/stale | `#cfb481` | `#745829` | Explicit reason/age, not failure |
| Danger/error/failed | `#d6a0a5` | `#83464e` | Error/destructive meaning only |
| Secondary series hue | `#b5a8c9` | `#625077` | Data identity, not universal status |
| Neutral/unknown/offline | `--text-secondary` | `--text-secondary` | Distinct icon/label explains state |

Semantic chip/callout tint: foreground hue mixed into the neutral surface at
**8% dark / 6% light**; semantic border **24% dark / 20% light**. Keep body
content neutral. These low-opacity borders do not replace the stronger accessible
focus/interaction outline. No glow role. Focus is **2px with 2px offset**, not
a diffuse shadow; validate its contrast on filled controls and custom themes.

Preserve all saved `ThemeId`/`ModeId`, custom colors, `auto`, density and chart
preferences without resets/renames. `neon-cyan` remains Signal Blue's persisted
ID. Matrix Green, OLED and `chart_palette="neon"` retain identity and user choice,
not permission for fluorescent chrome everywhere. Keep saved raw choices intact;
existing theme/palette owners must derive restrained, contrast-safe presentation
roles from them. No decorative pure white, including OLED typography: soften its
presentation foreground without rewriting saved mode identity. The current direct
raw-accent rendering needs a bounded foundation followup, not a page-side clamp.

**Necessary exceptions:** computed on-fill foregrounds may use white/black when
needed for 4.5:1; system colors in forced-colors and black-on-white print remain;
control thumbs and genuine logos/media are not blindly recolored. Light surfaces
are off-white targets, not a prohibition on system/print white. Preserve
`--theme-on-primary`, `--theme-on-accent`, `--text-on-accent` and inverse roles;
recompute contrast for derived fills rather than assuming white always works.

Owners: `web\src\index.css:38–80,131–204,606–634`,
`web\src\lib\tokens.ts` (`neonColorMap`, `semanticToNeon`, `severityTokens`,
`gaugeTone`, typography colors), `web\src\components\ui\ThemeProvider.tsx:79–114,
138–217,315–340`, `web\src\components\ui\themePresets.ts`.

### Typography — MDC-013

Use `web\src\components\ui\Typography.tsx` Heading/Text and role wrappers; their
optional `as` preserves semantic HTML, attributes and default roles. Defaults:
Inter/system sans, JetBrains Mono/Fira Code mono; scale 1, body leading 1.5,
tracking 0; weights 400/500/600/700. Saved font/scale/leading/weight choices survive.

| Role | Existing default scale and emphasis |
| --- | --- |
| Display/metric | 24px → 30px at `sm`, 700, tabular numbers for metrics |
| Page title | 24px → 30px at `sm`, 700, leading 1.3 → 1.2 |
| Section / widget-panel title | 20px / 18px, 600 |
| Body / secondary | 14px, 400, primary / secondary foreground |
| Caption/helper / label | 12px, 400 / 500, contrast-safe muted foreground |
| Code | 12px mono; contain long identifiers without losing copyable value |

16px body remains appropriate for comfortable reading/forms; avoid promoting
everything to display/bold. Existing 10px micro token is not the default for
essential instructions/data. Do not add per-page scales, font packages or fixed
pixel overrides that bypass user scaling. Preserve full rich captions and units.
Owners: `web\src\lib\tokens.ts:169–234`, `web\tailwind.config.js:145–185`,
`web\src\index.css:18–26`, `web\src\components\ui\FontProvider.tsx`.

### Font-size inheritance adoption — MDC-013 / MDC-020

**Additive decision for `phase3-font-inheritance-contract`:** Accordion's
`text-[length:inherit]` is one genuine unresolved arbitrary-font candidate in
`.agent-status\receipts\phase3-accordion-checks.log` (scanner exit **1**).
Accepted source is not a clean shared gate. Preserve its size inheritance against
Button's default `text-sm`; no fixed-size replacement or scanner waiver.

Approve `theme.extend.fontSize['size-inherit'] = 'inherit'` at
`web\tailwind.config.js`, exposed as `typography.size.inherit =
'text-size-inherit'` at `web\src\lib\tokens.ts`. Generated CSS must be exactly
`.text-size-inherit { font-size: inherit; }`, with no added line-height, weight,
family, color or scale multiplication. This is a granular inheritance role,
not a new body/heading variant. Existing resolved sizes, including `d-base`,
choose scaled sizes rather than inherit the parent's computed size; none is
equivalent. Built-in `text-inherit` means **color: inherit**, not font size.
The proposed size key is absent in the inspected resolved config.

Register `{ text: ['size-inherit'] }` in the existing `font-size` class group of
`extendTailwindMerge` at `web\src\lib\cn.ts`. Without that registration the
inspected merger retains `text-sm` and drops the ordinary text-color class.
Require last-size-wins in both directions while retaining ordinary and
forced-colors text colors; do not rely on stylesheet order or `!important`.
Accordion substitutes only this named role for its arbitrary size class.
Its later `headerClassName` retains caller override precedence; root sizing,
saved font scale/leading/family/weight, and descendant Text roles remain intact.
Inherit the parent's already computed size, never apply `--font-scale` twice.
Do not remove descendants' intentional body/secondary role sizes.

Keep system-color/focus/border rules and forced-color adjustment unchanged;
the size role is mode-independent, not a forced-colors override. Preserve
Button defaults elsewhere, native button/type/attributes/events/loading/disabled
semantics and forwarded ref; Accordion has no public ref to add or remove.
Keep disclosure IDs/ARIA, controlled/uncontrolled state, slots, mounting,
wrapping, focus, motion and reachable content unchanged.

Required downstream owners: `phase3-font-inheritance-tokens` owns the existing
Tailwind config, typography token and cn merge registrations with matching
token/merge tests and generated-CSS equivalence checks;
`phase3-accordion-font-adoption` owns Accordion and its matching tests after
those registrations, then reruns strict scoped checks and the unchanged scanner.
These are followup assignments, not token/UI/scanner implementations here.
OS forced-colors, 200% text/caller scaling, wrapping, keyboard, native-host/ref
and composed visual acceptance remain implementation/QA obligations under
MDC-040–043/060–070; this documentation decision clears no runtime gate.

### Spacing, shape and elevation — MDC-014 / MDC-015

Use existing Tailwind 4px rhythm: 4/8/12/16/24/32/48px; 4–8px within controls,
12–16px within related content, 24px between sections, 32px between major groups.
Use normal shell gutters, 12–16px narrow-container panel padding and 16–24px
larger-panel padding through existing primitives, not arbitrary page overrides.
Density remains comfortable (44px row, 16/12px padding, 12px gap, 14px text),
compact (32px row, 10/6px padding, 8px gap, 13px text), spacious
(56px row, 24/20px padding, 16px gap, 16px text). Do not rename saved choices or
force globally larger rows; keep non-overlapping reachable mobile controls.

Existing radii: xs 4, sm 6, md 8, lg 10, xl 14px; pill 9999px only for true
chips/toggles. Controls use shape-sm, panels shape-lg via `--panel-radius`;
do not silently redefine Tailwind's unrelated radii. Card/GlassPanel share
panel surface/border/radius/elevation, retaining names and print markers.
Panel blur stays **0px**. Default panels use e1, embedded sections e0, transient
raised content e2, dialogs/drawers e3; never glowing shadows or lift on every card.
Existing dark e1 is 0 1px 2px black/32%; e2 0 2px 6px black/36% plus
0 1px 2px/24%; e3 0 8px 24px/44% plus 0 2px 6px/28%.
Keep the softer light-mode ladder at `index.css:632–634` and token-backed
`shadow-e1/e2/e3`; no page-defined shadows.

Owners: `web\src\index.css:91–96,131–204,209–227`,
`web\tailwind.config.js:56–87,187–208`, `web\src\lib\tokens.ts` table/surface tokens.

### Iconography and motion — MDC-016 / MDC-042

Use Lucide's existing family, default **2px stroke**, aligned/shrink-free boxes:
xs 12, sm 14, md 16, lg 20, xl 24px through existing Icon/iconSize.
Decorative icons are hidden; icon-only actions have localized names and target
sizes independent of glyph size. Logos retain their existing branded owner.

**Icon locality resolution:** `web\src\lib\icons.ts` is semantic mapping
authority, not a mandatory eager runtime dependency. Route-local named
`lucide-react` imports are allowed when matching the canonical concept and
rendered through existing Icon. Type-only imports remain erased. Shell uses
existing `web\src\lib\sidebarGlyphs.ts`; deferred collection glyphs remain
deferred at their actual owner. Do not pull the whole registry into startup via
a wrapper/barrel. This resolves the contradictory “registry only” examples in
`docs\ICON_GUIDELINES.md`; its startup bundle constraint remains mandatory.
No second registry or icon family. Owners: `web\src\components\ui\Icon.tsx`,
`web\src\lib\tokens.ts:49–59`, existing route-local mappings.

Motion is feedback, not decoration: fast **150ms** hover/focus, normal **250ms**
disclosure/overlay, slow **400ms** only for justified major transition.
Use existing standard `cubic-bezier(0.2,0,0,1)` and named easing/duration utilities.
Do not unify the distinct legacy `animationDuration` seconds API silently
(0.15/0.2/0.3, stagger 0.06); audit consumers before any timing migration.
No ambient pulse/glow/bounce or animated numeric theater. Keep necessary busy
feedback without confusing “busy” with unknown.
OS reduced motion **or low bandwidth** invokes `useMotionPreference()`:
JS entrance `initial=false`, duration 0, static values instead of infinite loops;
CSS reduced-motion remains the safety net. Remove nonessential loops in normal
mode too. Owners: `web\src\hooks\useMotionPreference.ts:44–48`,
`web\src\lib\tokens.ts:108–163`, `web\src\index.css` reduced-motion rules.

## Existing interaction and layout owners

| Stable ID | Decision / preserved API | Exact existing owner |
| --- | --- | --- |
| MDC-020 buttons | Existing primary/secondary/outline/danger/ghost; destructive uses danger. Icon is a prop, not a new variant. Native links retain navigation semantics with BUTTON_BASE. Default/hover/active/focus/disabled/loading and aria-busy survive. One dominant action; wrap long labels via wrapLabel. Existing sm/md/lg heights are 36/40/48px, auto density-aware; do not claim default md already meets 44px mobile. | `web\src\components\ui\Button.tsx:9–80` |
| MDC-021 fields | Input/Textarea/Select/Checkbox/RadioCard/Toggle and existing specialist inputs; FormSection/FormField/ValidationSummary compose forms. Visible localized labels, required/native values/ref/events, hints/errors/external descriptions survive. Unique locale-independent implicit IDs; explicit id/name/settings keys unchanged. Field error + summary can focus the real control; placeholder is not a label. | `web\src\components\ui\Input.tsx`, `Textarea.tsx`, `Select.tsx`; `web\src\components\forms\FormSection.tsx`, `FormField.tsx`, `ValidationSummary.tsx` |
| MDC-022 help | HelpIcon/Tooltip own localized human-readable help, keyboard/open behavior and contextual-help preference. Explicit help.for/ariaLabel (including empty overrides) retain priority. Only real rendered body IDs belong in aria-describedby. | `web\src\components\ui\HelpIcon.tsx`, `Tooltip.tsx` |
| MDC-023 tables | DataTable is the filtering/sorting/selection/pagination/persistence/export pipeline; Table is the semantic matrix primitive. Preserve tableId, source order, columns and matchingLoaded/selectedLoaded/fullResult distinctions. Mobile adapter or contained table scroll preserves every field/action/detail; never infer full results from loaded rows. Standalone/embedded remain existing variants. | `web\src\components\ui\DataTable.tsx`, `Table.tsx`, `MobileDataTableAdapter.types.ts`; `docs\TABLE_GUIDELINES.md` |
| MDC-024 overlays | Modal/Drawer/Popover/ConfirmDialog/useDialogFocus own focus/restore/Escape/labels and scroll. Preserve Modal fullscreen versus full distinction; viewport-contained body scroll, persistent reachable footer, safe-area/chrome offsets. Mobile sheet presentation must use existing owner, not a new engine. Nonmodal popovers retain their appropriate semantics, not indiscriminate aria-modal. | `web\src\components\ui\Modal.tsx`, `Drawer.tsx`, `Popover.tsx`, `ConfirmDialog.tsx`; `web\src\hooks\useDialogFocus.ts` |
| MDC-025 statuses | Badge/severityTokens and vehicle StatusBadge/FSM definitions remain authorities. Online/success/complete use success; warning/stale warning; error/failed danger; connecting/queued/processing info; offline/unknown neutral with distinct text/icons; charging keeps actual domain mapping. No global remap of domain thresholds or universal status registry. Color never conveys state alone. | `web\src\components\ui\Badge.tsx`; `web\src\components\data-display\StatusBadge.tsx`; `web\src\lib\tokens.ts` |
| MDC-030 shell | Layout/Sidebar/WorkspaceHeader/CommandDeck/BottomTabBar own navigation, breadcrumbs/search/notifications/account and workspace controls. Preserve active/nested/collapsed/mobile navigation, pins/recents/preferences, routes/aliases, auth/native/report/kiosk behavior and destinations. | `web\src\components\layout\Layout.tsx`, `Sidebar.tsx`, `WorkspaceHeader.tsx`, `BottomTabBar.tsx`, `sidebar\CommandDeck.tsx` |
| MDC-031 composition | PageContainer/PageHeader/PageActions/Grid/Stack plus existing PageLayout/Section/CardGrid/LayoutCard/ChartCard/SourceContent/AboutPanel/LockedNotice. Analytics fills allocated width, aligned with header and normal shell gutters; constrain prose/forms individually, not the whole page. No new local width engine or duplicate header chrome. | `web\src\components\layout\PageContainer.tsx`; `web\src\components\layout\layout-reference\PageLayout.tsx`, `CardGrid.tsx`, `Section.tsx`; category `web\src\components\layout\index.ts` |
| MDC-032 scope | Header/mobile View settings and vehicle picker own workspace range/vehicle state. Consume startInstant/endInstantExclusive and selected vehicle/VIN hooks, register real route scope, pass both bounds to server lists AND whole-range aggregates. Preserve rolling/custom/calendar/DST/timezone semantics. No second page picker or scope=local bypass. Fleet/admin routes with intentionally hidden header vehicle selection retain required local selection; independent business dates/year navigation/chart zoom remain independent. | `web\src\lib\workspaceScope.ts`; `web\src\hooks\useRangeState.ts`, `useSelectedVehicle.ts`, `useVehicleVinFilter.ts` |
| MDC-034 charts/maps | Canonical ChartContainer/ChartCard and category chart/map boundaries. Preserve all series, axes, missing gaps, annotations, zoom/brush, legend IDs/preferences, fullscreen/export and accessible table/text alternatives. Line 2px primary / 1px reference, point 3px when needed, subtle grid, neutral tooltip. Area tint at most 8%; no glow/3D/unnecessary gradients. Never change aggregates, scales or sample away source data for looks. | `web\src\components\charts\ChartContainer.tsx`; `web\src\components\layout\layout-reference\ChartCard.tsx`; `web\src\lib\tokens.ts` chartTokens; `web\src\lib\colors.ts`; `web\src\hooks\useChartPalette.ts` |

### Overlay geometry adoption — MDC-024 / MDC-022

**Additive source decision for `overlay-geometry-contract`:** accepted Modal,
Drawer and Tooltip primitive sources contain genuine arbitrary geometry utilities.
Approve the following named additions at the **existing** `theme.extend` owner in
`web\tailwind.config.js`; do not create another token system or change existing
semantic tokens. Read-only inspection and Tailwind's existing config resolver
confirm these four extension names are absent, with no resolved-name collisions;
built-in `height.dvh` / `maxHeight.dvh` are `100dvh` and `sm` remains `640px`.

| Existing source utility / owner | Approved role and exact value | Source-equivalent adoption |
| --- | --- | --- |
| Modal and Drawer `z-[60]` | `zIndex.overlay = '60'` | `z-overlay` on the existing overlay root |
| Modal full width `sm:max-w-[min(96vw,1100px)]` | `maxWidth['modal-full'] = 'min(96vw,1100px)'` | `sm:max-w-modal-full` |
| Tooltip `max-w-[calc(100vw-1.5rem)]` | `maxWidth['tooltip-viewport'] = 'calc(100vw - 1.5rem)'` | `max-w-tooltip-viewport` in the existing multiline/boundary branch |
| Modal non-fullscreen `sm:max-h-[90vh]` | `maxHeight.modal = '90vh'` | `sm:max-h-modal`, not a dynamic-viewport cap |
| Modal fullscreen `h-[100dvh] max-h-[100dvh]` | Existing Tailwind built-ins; no extension | `h-dvh max-h-dvh` |

This is a naming-only adoption, not geometry redesign or blanket numeric/calc/
viewport scanner permission. Keep all other findings visible for their own
bounded disposition. In particular, retain Modal's non-fullscreen base
`max-h-[calc(100dvh-var(--shell-chrome-bottom,0px))]` exactly, its
`pb-[var(--shell-chrome-bottom)]`, `safe-bottom` body/footer and `sm:pb-4`.
Do not substitute `max-h-dvh` for the shell-subtracted expression.

Preserve Modal size IDs `sm/md/lg/full/fullscreen`, default `md`, existing
`sm:max-w-sm/sm:max-w-lg/sm:max-w-2xl` and fullscreen `max-w-none`; `full`
stays width-limited, not fullscreen. Keep the <640px bottom sheet, >=640px
centered rounded card and fullscreen branch distinct. Drawer retains `sm/md/lg`,
default `md`, both sides, existing widths and
`bottom-[var(--shell-chrome-bottom)]`. Layer 60 stays above shell layer 55;
Modal internal `z-10`, Tooltip `z-50` and nested overlay ordering stay unchanged.
Do not change portals (Modal/Drawer to body; Tooltip remains local), public props,
refs, labels, focus trap/restoration/Escape/backdrop behavior or reduced motion.
Preserve Modal overlay scroll, normal body scroll/fullscreen overflow ownership
and persistent footer; Drawer keeps reference-counted body locking, independent
body scroll, tabs and its undefined/default versus null/hidden footer behavior.
Tooltip keeps `w-80`, wrapping, side offsets, measured boundary/viewport correction,
computed inline max-width/translation, hover/focus/touch/Escape and described-by
identity; only its static viewport cap receives a name.

Affected owners must recheck after adoption: `overlay-geometry-tokens` proves
generated CSS equivalence, responsive precedence and unchanged existing tokens
at `web\tailwind.config.js` with its existing token test owner;
`overlay-modal-adoption`, `overlay-drawer-adoption` and
`overlay-tooltip-adoption` recheck their existing primitive/matching tests,
preserved APIs, geometry, layering, focus, footer and scroll behavior. QA owners
rerun bounded style classification without scanner waivers and the applicable
MDC-040–043/060–070 open/nested overlay matrix. No implementation is made here;
this source decision establishes neither browser/mobile nor forced-colors,
composed contrast, keyboard or visual acceptance. No geometry deviation approved.

### Docked side-panel geometry adoption — MDC-024 / MDC-030 / MDC-043

**Additive decision for `phase3-side-panel-geometry-contract`:** the read-only
HelixSidePanel receipt retains three genuine arbitrary-geometry candidates:
`w-[420px]`, `max-w-[40vw]` and `min-h-[4.5rem]` (final scanner exit **1**).
Existing resolved Tailwind width/max-width/min-height roles have no exact
equivalents; `spacing.18` is absent. Reuse existing Drawer and shell breakpoints,
but do not round these dimensions to nearby spacing or Drawer size values.
The earlier modal/tooltip roles are different constraints, not replacements.

Approve only these additions at the existing `theme.extend` owner in
`web\tailwind.config.js`; names below are design targets, not implemented roles:

| Source utility | Semantic role and exact value | Naming-only adoption |
| --- | --- | --- |
| Desktop dock `w-[420px]` | `width['side-panel'] = '420px'` | `w-side-panel` |
| Desktop dock `max-w-[40vw]` | `maxWidth['side-panel-viewport'] = '40vw'` | `max-w-side-panel-viewport` |
| Dock header `min-h-[4.5rem]` | `minHeight['side-panel-header'] = '4.5rem'` | `min-h-side-panel-header` |

These are existing global-shell geometry roles, not a new side-panel component,
public size API or generic spacing extension. Generate exactly `width: 420px`,
`max-width: 40vw` and `min-height: 4.5rem`, with no added declarations.
Keep pixel width pixel-based, the cap viewport-based (not 40% of the dock),
and the header minimum rem-based: 72px at a 16px root, 90px at 20px.
Do not replace the minimum with fixed height or multiply by `--font-scale`;
long/scaled text must be allowed to grow the header.

Register the named utilities in the existing `extendTailwindMerge` groups at
`web\src\lib\cn.ts`: `w: [{ w: ['side-panel'] }]`,
`max-w: [{ 'max-w': ['side-panel-viewport'] }]` and
`min-h: [{ 'min-h': ['side-panel-header'] }]`. Prove last-conflicting-class-wins
in both orders against ordinary and arbitrary utilities, including matching
responsive variants. Different properties/variants must coexist; width and
max-width must never conflict with each other. Do not rely on CSS source order,
`!important` or a scanner exemption. No token/config/merge implementation occurs
in this documentation item.

Preserve the actual <=1279px Drawer / >=1280px dock split, not the Drawer
primitive's own `sm` breakpoint. Desktop continues using `helix-dock-slot`,
`role="complementary"`, localized label, `h-full`, `min-w-0`, `shrink-0`,
logical start border and `pb-7`. The width/cap pair is `min(420px, 40vw)`
under the existing flex constraints; at all current desktop QA widths the
420px width wins. No portal, overlay layering, modal semantics, focus trap,
body locking, safe-area/chrome offset or workspace-layout redesign is approved.
Retain the growing header, visible Close, independent transcript scroll,
persistent composer, full privacy hint, toggle, Send and configuration link.
Preserve open/onClose, Escape/composer focus, mobile Drawer behavior and all
stream/session/route cancellation, source/error and opt-in semantics.

Separate downstream assignments: **`phase3-side-panel-geometry-tokens`** owns
only the existing Tailwind config and cn registrations with directly matching
tests, generated-CSS equivalence, resolved-name collision and merge checks;
**`phase3-helix-side-panel-geometry-adoption`** owns only
`web\src\components\layout\status-bar\HelixSidePanel.tsx` and its matching test
after implementation, substituting the three utilities and retaining behavior.
Recheck strict scoped lint/tests, preservation and the unchanged style scanner,
keeping every other finding visible. The inherited preservation exit **2**
(computed message identities) is not cleared by this decision.
QA rechecks MDC-040–043/060–070: 1279/1280 transition, mission widths and narrow
allocated docks, 200% text/root scaling, long translations/RTL, reachable
unclipped focus/Close/composer, keyboard dismissal, transcript scrolling,
mobile safe-area/chrome and dark/light/custom/forced-colors contrast.
Documentation resolves the naming decision only; unimplemented utilities,
source-equivalent geometry and old test receipts are not completed UI or runtime
acceptance. No arbitrary-value waiver or geometry deviation is approved.

Chart series use only as many distinguishable hues as data needs; repeated series
keep their identities/order. Target palette starts with the blue/green/amber/rose/
purple foreground pairs above, then neutral (`#abb4bf` dark / `#4f5f70` light)
and ochre (`#c0a384` / `#775c37`) only when necessary. Distinguish series with
labels/dashes/markers as well as color; semantic warning/error colors must not
mislabel arbitrary series. Preserve saved palette IDs, including opt-in neon,
while deriving restrained presentation. Existing `chartTokens.series`,
`CHART_COLORS*`, theme builders and preference hook must be reconciled by their
owners, not supplemented with a page palette. Chart brush/cursor are neutral
and theme-aware; their current fixed cyan/white values are followups.

Chart-frame audit resolves imports through barrels and requires actual incoming
children inside the canonical frame. Renaming a raw wrapper, unrelated framed
siblings, duplicated children or an unused helper do not pass. Keep existing
parser regressions for `audit:chart-frame` and `audit:datatable-tableid`.

## States, numeric data and preservation

### Asynchronous trust — MDC-026

Use `web\src\api\dataState.ts:130–177`, `web\src\hooks\useDataState.ts` and existing
SourceContent/feedback APIs. Provenance (live/cached/historical/inferred/repaired/
unknown) is orthogonal to initial/ok/stale/partial/unavailable/initialFailure.
Initial loading uses source-shaped skeleton geometry, not fabricated readings.
Authoritatively empty means explain what/why/next; filtered no-match differs from
no records. Unknown is a missing fact, not zero/offline/error.

Only `fatalError` **without retained data** may replace that source's content.
Refresh failures retain usable payload/last-success time, show nonblocking
warning and individual retry; paused/offline uses isRefreshBlocked, not an
invented server failure. Independent sources/sections stay visible and recover
independently. No all-page `{data && ...}` gate, blank placeholder component or
generic error that erases neighbors. Announce meaningful outcomes without
re-announcing every live telemetry tick; preserve existing boundary/toast policy.

`useSignalEvidenceBundle().sources` in `web\src\api\hooks\useTelemetry.ts` retains
**every normalized signal identity**, including pending/failed history, payload,
last-success timestamp, fatal/refresh distinction and individual retry.
Resolved empty history is unavailable, not measured zero. Never infer identities
from only successful series or drop retained series on refresh failure.

### Statistics / OperationalBrief numeric API — MDC-033

Reuse `web\src\components\data-display\stat-reference\StatStrip.tsx`, `StatGroup.tsx`,
`web\src\lib\metric-reference\formatMetric.ts`, `types.ts`,
`web\src\components\data-display\OperationalBrief.tsx`,
`web\src\hooks\useOperationalMetrics.tsx` and `usePublicOperationalMetrics.ts`.
No competing KPI grid/glossary/converter. Retain raw input, numeric accessible
output, missing/invalid reasons, context, comparisons, period/provenance and links.
Do not turn source measurements into text to bypass numeric validation.

- `bytes`: bytes, existing binary formatBytes; signed net growth valid, negative
  data sizes invalid. `byteRate`: bytes/second; display.byteRatePeriod s/d changes
  only presentation. `latency`: nonnegative seconds; milliseconds/adaptive display.
- `mass`: kilograms; `multiplier`: dimensionless ×, not percent. `countTotal`:
  nonnegative safe integer; unknown numerator remains unknown with known total.
- `display.formatter`: validated numeric source plus effective preferences before
  default physical conversion; value/unit strings preserve specialist formatting.
  Missing/invalid input never reaches it, including invalid negative durations
  with roundedMinutes. `notation: 'source'` retains unrounded numeric representation.
- `rate`: explicit source rate unit, not a physical preference change;
  `identifier`: safe nonnegative integer without grouping/rounding, optional prefix.
  Preserve precision/locale/currency symbol-versus-ISO semantics; never guess ISO
  currency from a symbol or replace valid negative/zero values.

OperationalBrief captions remain fully visible, including rich specialist
context. Loading never fabricates values; its details drawer honors the summary's
loading suppression. Status/scope/freshness/review actions come from real sources,
not copied example labels. Keep calculation ownership in domain adapters.
Public reports use `usePublicOperationalMetrics(metrics, preferences)` with
explicit existing viewer/source preferences and the same pure formatter, without
authenticated settings/workspace subscriptions or new public data exposure.

### Localization, SI, persistence and privacy — MDC-044 / MDC-045 / MDC-046

Localize labels/help/errors/actions with canonical catalogs and existing split
tools (`docs\I18N_GUIDELINES.md`); interpolation/plurals, not concatenation.
Locale drives numbers/dates; retain user's units, currency, timezone and 12/24h
choices. Use existing `web\src\lib\dateFormat.ts`, display hooks/formatters and
range semantics; show period/timezone when interpretation depends on it.
RTL uses logical alignment/spacing and meaningful directional icons; do not
mirror logos, data or charts blindly. No translated DOM identities, user-data
recasing or competing production catalog.

Raw SI remains on wire/cache/hooks; convert **only at display** with existing
`useUnits()` / `useFormatting()` / current unitConversion helpers. No deprecated
useSettings converter or source-unit compatibility engine. API hook URLs omit
the client-added `/api/v1`; query parameters match snake_case server contracts.
Unknown backend units/bounds/totals/authorization stay integration unknowns.

Retain QueryClient/request/SSE/queryBroadcast, cancellation/retries/cache keys,
theme/table/chart/navigation IDs and consent. Commands/mutations remain live-only,
with existing confirmation, auth/capability checks and success-only lifecycle
transitions; no fake completion, offline mutation queue or unsolicited production
action. Preserve route-specific capabilities, public privacy, session/demo/native
boundaries, redaction and exports. No browser token storage or sensitive logging.

## Responsive and accessibility acceptance

### Breakpoints and container/mobile strategy — MDC-043

Existing Tailwind viewport bands: base <640px; sm 640; md 768; lg 1024; xl 1280;
2xl 1536; custom 3xl 1920px. Do not introduce a competing breakpoint engine.
Preserve actual custom 640–1023 branches, not a blanket tablet rewrite. Shell
desktop navigation activates at 1280px; narrower allocated cards must still reflow
on wide screens using existing container queries/CardGrid placement policy.

Use `w-full`, `min-w-0`, bounded grids, wrapping toolbars and stacked narrow forms.
No accidental page horizontal scrolling; tables/charts may own clearly labeled,
keyboard-reachable contained scroll regions. Mobile summary/details/disclosure
must keep **every** original field/action/section reachable, not delete “secondary”
metadata to satisfy mission shorthand. No hover-only help, collapsed inaccessible
actions or fixed footer hiding content. Retain safe-area and shell bottom-chrome
offsets, zoom/fullscreen/export and independent scroll ownership.

Existing shell `web\src\components\layout\shellFocusTrap.ts` owns mobile isolation:
aside/scrim reuse activateShellOverlayGuard; Tab/Shift+Tab containment,
ancestor inert/aria-hidden, clickable exempt data-sidebar-backdrop, 44px Close,
release on desktop/report/kiosk and deferral to nested portaled aria-modal.
Preserve hidden/inert-ancestor filtering and explicit child visibility behavior.
These source contracts do not prove browser focus/restoration acceptance.

### Accessibility / forced colors — MDC-040 / MDC-041

WCAG 2.2 AA: semantic headings/landmarks/table headers/sort state, keyboard
order/reachability, localized names, visible unclipped focus, form associations,
chart alternatives and no color-only meaning. Use existing skip/route-focus/
announcement owners; no positive tabindex or duplicate landmarks/live messages.
Text target 4.5:1 and meaningful UI/focus 3:1 on composed backgrounds.
Mobile default **44×44px below md**; smaller desktop/compact controls require
documented 24×24px/spacing WCAG exceptions and no overlapping hit areas.

Forced-colors maps to Canvas/CanvasText/ButtonFace/ButtonText/Highlight/
HighlightText through existing `web\src\index.css` remaps and Tailwind variant.
System-color overrides outrank ordinary theme inline properties; ThemeProvider
must never set important theme variables. Do not suppress forced-color adjustment
globally; preserve focus/borders/selected indicators and chart/table alternatives.
System-mode contrast exceptions are deliberate, not permission for normal-mode
pure-white decoration. Validate actual OS/open states, not source presence.

## Historical foundation compatibility — MDC-050 / MDC-051 / MDC-052

Retain implemented Input/Textarea implicit React useId identity; explicit caller
fallback semantics remain Input `||`, Textarea `??`. Labels/feedback suffixes,
refs/native names/values/events/external descriptions remain. Implicit IDs are
opaque, not persistence keys; automation needing stable IDs passes an explicit
id or uses semantic labels. Keep FormField/caller identity and specialist-input
forwarding; dynamic/external slug selectors remain a compatibility risk.

HelpIcon does not fabricate `${for}-help`; Tooltip alone supplies its rendered
body ID. Explicit help targets/names, empty overrides, localized human names and
contextual-help preferences retain their existing distinctions. Keep focused
identity/help/cold-real-i18n regression coverage, not stale label-slug assertions.
Earlier authored/archived receipts and native attempts are not a fresh pass;
the historical frozen5241 native attempt redirected to authentication, not
successful application acceptance. No obsolete nine-file cohort owns this phase.

## Evidence reuse and acceptance workflow — MDC-060 / MDC-070

Reuse current inventory report/source identities and historical source catalogs,
not a replacement route/stat inventory. Historical crosswalk counts (234 page
references, 289 mobile joins, 1,694 stat joins, 807 unknown coordinates) remain
historical source evidence only. Existing handoffs/catalogs may guide preservation;
unresolved route mounts/record IDs/auth, mobile adapters/export completeness,
specialist precision, contrast, motion, focus and source drift remain explicit.

Workers read relevant mission/instructions, inspect existing APIs, capture bounded
source/preservation evidence, implement only assigned files, and report exact
commands/results or NOTRUN. Heartbeat at start/every three minutes/before release:
`UTC timestamp | current step | files touched`. One atomic item, no Git, queue,
unassigned shared edits, installs or unrequested full-repository gates. Page
workers report shared gaps instead of patching global owners. Stats decisions
are delegated under NO DATA LOSS, not repeated adoption/naming permission loops.

Orchestrator verifies DONE evidence, scoped sequential commits and phase checkpoints;
serializes health/full gates on stable inputs without expanding its source-write
role. Focused affected tests accompany API changes; documentation-only items
need bounded document validation, not a full application build. Commit cadence
typecheck still includes documentation commits. Required implementation phase
gates and mission §§43–45 cannot be waived by a source-ready label.

Existing preservation CLI: `node web\scripts\check-modernization-preservation.mjs`
`capture --root <repo> --scope <scope.json> --out <baseline.json>` (optional
`--catalogs <pinned-inputs.json>`), then `check --root <repo> --baseline
<baseline.json>` (optional `--report <report.json>`). Keep frozen originals;
never regenerate baselines/screenshots to hide regressions. Exit 2 is unresolved
source evidence, not a pass. Extraction counts include page plus owned components;
retain ≥70% original total unless genuinely simpler with explicit parity evidence.
Retain section/action/series/export coverage, not just line count.

Future acceptance requires raw receipts for supported-runtime `npx tsc --noEmit`,
`npm run build`, required tests/lint/audits and relevant preservation checks,
plus mounted functional/visual/keyboard/accessibility QA. Reuse `web\playwright.config.ts`,
existing DEV routes/e2e tooling and chart/table/palette/chunk-cycle gates.
QA matrix: **320/375/390/430/768/1024/1280/1440/1920/2560px**, narrow allocated
containers, dark/light/saved custom modes, RTL, 200% text, long labels/addresses,
zero/negative-valid/huge/null data, large tables, open/nested overlays, forced
colors, reduced motion/low bandwidth, retained/offline sources and individual retry.
Fixtures stay in DEV/QA, never production. Authentication redirects or mocks
cannot establish real runtime acceptance. Profile before virtualization/sampling/
memoization; keep lazy routes, bundle budgets and startup icon locality — MDC-047.
Rollback is scoped/orchestrator-owned; never revert unrelated inherited work.

## Bounded implementation followups / deferred acceptance — MDC-080

No source, style, configuration, catalog or queue changes are made by this item.
Followups use current semantic review scopes, not 244 approved components:

1. **Neutral/semantic foundations:** `web\src\index.css`,
   `web\src\lib\tokens.ts`, `web\tailwind.config.js`,
   `web\src\components\ui\ThemeProvider.tsx`, `themePresets.ts`: implement the
   MDC-010–015 role targets, off-white light panels/OLED presentation, restrained
   derived saved hues, contrast-adjusted text/control/focus, and remove decorative
   neon/glow/loop usage without changing settings IDs/default density/font behavior.
   Reconcile neonColorMap/semanticToNeon's colored “neutral”, severityTokens,
   gaugeTone, typography.error and fixed-white glassCardClasses at these owners.
2. **Charts:** `web\src\lib\colors.ts`, `web\src\lib\tokens.ts`,
   `web\src\hooks\useChartPalette.ts` and existing chart owners reconcile
   chartTokens.series, CHART_COLORS_CB_SAFE/NEON and theme builders into restrained
   preference-preserving roles. Brush/cursor become neutral/theme-aware; preserve
   identities, accessible alternatives and data. Mode/custom/CVD/composed contrast
   must be checked before this is called visually accepted.
3. **Icon policy/tooling:** reconcile contradictory registry-only prose in
   `docs\ICON_GUIDELINES.md` and `web\src\components\ui\Icon.tsx` documentation
   through their assigned owners, retaining concept mappings, type-only imports
   and measured startup locality. No eager registry migration.
4. **Existing primitive/composite review:** current inventory G001/G005/G007/G028/
   G032/G068 and other assigned scopes resolve Select identity, named table
   expansion, complete mobile detail/export adoption, retained-source behavior,
   reachable targets and conditional useCardPlacement export. Its real owner is
   `web\src\components\layout\layout-reference\CardPlacementContext.ts`, not .tsx.
   Missing Commands tile frame remains unresolved/local G187, not a new global API.
5. **Health and QA:** orchestrator locates/verifies Node >=26 and dispatches
   inherited compiler repairs, runs cadence 255 and mandatory implementation
   phase gates, then the full matrix/runtime acceptance. Backend bounds/totals/
   route capabilities, historical signal recovery and public privacy remain
   integration proof obligations, not assumptions resolved by design.

This document update establishes decisions only. Foundation implementation,
effective contrast across presets, supported-runtime gates and full application
acceptance remain deferred to the explicitly assigned implementation/QA phases.

**Documentation-only verification:** scoped PowerShell checks found 43 exact
`web\...` file citations, zero missing files, all 20 mission §2 topics and all
retained MDC IDs; exit 0 after correcting the checker's `.json` matching.
An inline Python luminance check of the seven target semantic/series foreground
pairs against opaque surface-3 returned dark 6.30–7.50:1 and light 5.05–5.81:1,
exit 0. This is mathematical pair evidence only, not composed/custom-theme,
forced-colors, CVD, visual or browser acceptance. Typecheck/build/lint/tests and
runtime gates were NOTRUN here: this assigned item changes documentation only
and prohibits full-repository gates.

## Shell overlay geometry naming — MDC-024 / MDC-030 / MDC-034 / MDC-043

**Additive decision for `phase3-shell-overlay-geometry-contract`: naming only.**
Read-only `phase3-{theme-quick-switcher-popover,notification-bell-panel,
connection-segment,workspace-context-control,presentation-mode-segment,
breadcrumbs,map-layer-switcher}-crash-review.log` receipts at
`.agent-status\receipts\` retain respectively **3/2/1/2/1/2/1** genuine
geometry candidates, with scanner exit **1**. Repeated receipt entries are not
additional source candidates. These findings are not waived or freshly rescanned
here; semantic-token and forced-colors reviews, catalog/test/preservation
unknowns and inherited notification trust/error findings remain separate.

The inspected resolved config has no exact existing utility or name collision
for the ten additions below. Reuse existing `z-overlay = 60`, modal/tooltip
and side-panel roles where genuinely equivalent; they are **not** equivalents
for layer 80/1000, a 1rem viewport subtraction, or these width/height constraints.
Approve only the following additions to existing `theme.extend` in
`web\tailwind.config.js`; use direct named utilities, as with the earlier overlay
decision, not a new token registry, component API, positioning or layer engine.

| Read-only candidate owner and region | Exact existing value / approved role | Naming-only replacement |
| --- | --- | --- |
| `web\src\components\layout\ThemeQuickSwitcherPopover.tsx:38` and `NotificationBellPanel.tsx:198`, `z-[80]` | `zIndex['shell-panel'] = '80'` | `z-shell-panel` at both roots |
| `web\src\components\layout\ThemeQuickSwitcherPopover.tsx:38`, `w-[22rem]` | `width['theme-switcher'] = '22rem'` | `w-theme-switcher` |
| Same theme root, `max-w-[calc(100vw-1rem)]` | `maxWidth['shell-panel-viewport'] = 'calc(100vw - 1rem)'` | `max-w-shell-panel-viewport` |
| `web\src\components\layout\NotificationBellPanel.tsx:198`, `max-h-[calc(100vh-6rem)]` | `maxHeight['notification-panel'] = 'calc(100vh - 6rem)'` | `max-h-notification-panel` |
| `web\src\components\layout\status-bar\ConnectionSegment.tsx:181`, `w-[min(92vw,320px)]` | `width['connection-diagnostics'] = 'min(92vw,320px)'` | `w-connection-diagnostics` |
| `web\src\components\layout\status-bar\PresentationModeSegment.tsx:173`, `w-[min(92vw,340px)]` | `width['presentation-menu'] = 'min(92vw,340px)'` | `w-presentation-menu` |
| `web\src\components\layout\WorkspaceContextControl.tsx:243`, `w-[min(92vw,27rem)]` | `width['workspace-context'] = 'min(92vw,27rem)'` | `w-workspace-context` |
| Same workspace root, `max-h-[min(80vh,38rem)]` | `maxHeight['workspace-context'] = 'min(80vh,38rem)'` | `max-h-workspace-context` |
| `web\src\components\layout\Breadcrumbs.tsx:66,78`, `max-w-[200px]` | `maxWidth['breadcrumb-label'] = '200px'` | `max-w-breadcrumb-label` in both branches |
| `web\src\components\maps\MapLayerSwitcher.tsx:28`, `z-[1000]` | `zIndex['map-control'] = '1000'` | `z-map-control` |

The two layer-80 roots share one role; the two breadcrumb branches share one
cap. Connection/presentation/workspace widths share a constraint family, **not**
one value: do not round 320px/340px to rem, replace 27rem with pixels, or
introduce generic spacing entries. `vw`/`vh` stay viewport-based, not container
percentages or dynamic `dvw`/`dvh`. Theme width remains 22rem; its cap subtracts
1rem, not Tooltip's 1.5rem. Notification's existing inline width **360px** and
inline `maxWidth: 'calc(100vw - 1rem)'` remain unchanged: equivalent cap wording
does not authorize moving inline declarations or changing their precedence.

### Position, layer and public behavior preservation

Theme remains a body portal with fixed positioning, caller-provided `coords.top`
and independently optional left/right values; preserve refs, lazy picker/loading
geometry, close/customize actions and external positioning owner. Notification
keeps fixed inline top/right, forwarded/dialog refs, nonmodal dialog identity,
its existing Tab containment and external Escape/restore ownership, clipped
flex root, independently scrolling preview and reachable header/footer.
No shared focus-trap or modal/body-lock migration is authorized.

Connection keeps Popover `side="top" align="start"`; presentation keeps
`side="top" align="end"`; workspace keeps header bottom/status top, end alignment,
`zIndex={70}` and independent `overflow-y-auto`. Existing
`web\src\components\ui\Popover.tsx` retains inline zIndex default **60**, gap
**6px**, viewport margin **8px**, optional <640px mobile-chrome bottom inset
**80px**, measured flip/clamp, initially hidden offscreen position,
ResizeObserver/scroll/resize recomputation, shell portal registration and focus
restoration/outside/Escape behavior. Do not replace its numeric prop/default with
a CSS class that loses to inline style, alter alignment for RTL, or add a trap.
This item authorizes no Popover source adoption.

Breadcrumbs retain 200px truncation and title access, caller `className` merge
precedence, prefetch destinations, current-page ARIA, local horizontal scroll,
<640px middle-item hiding/ellipsis and >=640px visibility, mobile target sizing
and directional RTL chevrons. Map control stays local and absolute, with
`bottom-6 start-2 end-2`, fit width/full cap, four columns, responsive labels,
pressed states, existing forced-colors treatment and map interaction behavior.
Its layer 1000 is **map-local**, not an app-wide overlay priority. Preserve
actual stacking contexts/portals/ancestor transforms: a numeric layer cannot
prove ordering between unrelated contexts. Layer-80 equality retains current
DOM/portal order; do not impose a new notification-versus-theme priority.
All props/defaults/refs/IDs/actions/settings/data/lifecycle semantics survive.

### Separate implementation and adoption assignments

**`phase3-shell-overlay-geometry-tokens`** owns only
`web\tailwind.config.js`, `web\src\lib\cn.ts`,
`web\src\lib\__tests__\tokens.test.ts` and `web\src\lib\cn.test.ts`.
Add the ten roles without modifying previous resolved entries/plugins/screens,
and extend existing merge groups: `z` with
`{ z: ['shell-panel', 'map-control'] }`; `w` with
`{ w: ['theme-switcher', 'connection-diagnostics', 'presentation-menu',
'workspace-context'] }`; `max-w` with
`{ 'max-w': ['shell-panel-viewport', 'breadcrumb-label'] }`; `max-h` with
`{ 'max-h': ['notification-panel', 'workspace-context'] }`.
Keep earlier overlay/dock/font decisions intact; no `tokens.ts`, index.css,
scanner, catalog or test-configuration expansion is required by this decision.

After that token item, assign seven independent bounded adoption items:
`phase3-theme-quick-switcher-geometry-adoption`,
`phase3-notification-bell-geometry-adoption`,
`phase3-connection-geometry-adoption`,
`phase3-workspace-context-geometry-adoption`,
`phase3-presentation-mode-geometry-adoption`,
`phase3-breadcrumbs-geometry-adoption` and
`phase3-map-layer-switcher-geometry-adoption`.
Each owns only its exact table-cited component and directly matching existing
tests (or an explicitly reserved colocated test when missing). Substitute only
its listed arbitrary utilities; never include the token/config/merge owners,
positioning parents, unrelated siblings or data hooks in that adoption scope.
Missing test ownership is **UNKNOWN** until separately reserved, not permission
to edit another worker's files.

Token acceptance requires generated CSS for every old/new utility pair to have
identical declarations, values, importance and media conditions, apart from
selector spelling. Include base and matching sm/md/xl variants; do not move a
base utility behind a breakpoint. Resolve-name collision checks and comparison
with the immediately preceding config must show only these ten additions.
Preserve existing token fingerprint assertions; extend their additive accounting
without deleting/loosening the frozen prior comparison. Merge tests require
last-conflicting-class-wins in **both** orders versus ordinary and arbitrary
z/width/max-width/max-height utilities, same responsive variants and caller
overrides; different variants and different properties must coexist. Width and
max-width do not conflict. No stylesheet-order reliance or `!important`.

Each adoption reruns strict exact-scope lint/tests, source/API preservation and
the unchanged scoped scanner, retaining every unrelated finding. Browser QA
then compares pre/post bounding boxes, computed width/caps/layers, position and
scroll ownership on the same mounted inputs at all MDC-070 mission widths,
narrow allocated containers and both sides of 640/768/1280 transitions.
Use 16px and 20px root sizes plus 200% text scaling and long RTL translations:
22rem is 352/440px; 27rem is 432/540px; 38rem is 608/760px;
fixed 200/320/340/360px values do not scale with root font size.
Exercise short/tall viewports, mobile browser chrome, resize/scroll and delayed
content measurement, edge anchors, all existing align/side branches and nested
overlays/maps. Preserve unclipped keyboard focus and reachable actions, safe
areas/chrome, reduced-motion and dark/light/custom/forced-colors behavior.
An existing geometry defect remains a separate finding, not silently redesigned
or declared acceptable because equivalence passes.

### Intake addendum: distinct unresolved geometry

Read-only `phase3-background-work-segment-crash-review.log` retains three
candidates at `web\src\components\layout\status-bar\BackgroundWorkSegment.tsx`:
line194 `max-w-[180px]` summary truncation; line209 `max-h-[280px]`
scroll cap and `min-w-[260px]` Popover minimum. None is equivalent to an approved
role above; minimum width is not connection/presentation preferred width.
**UNKNOWN named mappings** remain for a separate bounded design/token disposition
and BackgroundWorkSegment adoption owner. Preserve top/end positioning and all
three exact values; do not invent roles or fold them into this token assignment.

Read-only `phase3-virtualized-vehicle-grid-crash-review.log` retains two candidates
at `web\src\components\vehicles\VirtualizedVehicleGrid.tsx:108`:
`h-[min(72vh,56rem)]` and `min-h-[28rem]`. These belong to virtualized-list scroll
geometry, not shell overlay/layer roles. **UNKNOWN named mappings** require a
separate design/token and VirtualizedVehicleGrid adoption assignment preserving
virtualizer measurement, min-height precedence, scrollbar gutter, scroll/ref,
visible-row callbacks, computed total height/row translation and caller merge.
No numeric or viewport family resemblance authorizes using workspace caps.

This documentation adds names/ownership only. None of the nine owners' scanner
candidates, normal tests, source-preservation unknowns or composed/browser/
mobile/RTL/contrast/native acceptance is cleared. No UI/token implementation,
scanner exception or runtime acceptance is claimed; MDC-040–043/060–070 and
mission §§43–45 remain required at their implementation/QA owners.

## Remaining geometry naming — MDC-024 / MDC-030 / MDC-034 / MDC-043

**Additive `phase3-remaining-geometry-contract`: naming only; prior decisions immutable.**
Read-only `.agent-status\receipts\phase3-presentation-overlay-checks.log` retains
six layer candidates (four 9999 roots, one 9998, one 9997); `phase3-alerts-segment-checks.log`
retains two dimensions. Both scanners exited 1. The corresponding exact
`phase3-{map-tile-layer,background-work-segment,virtualized-vehicle-grid,recent-pages-segment,
active-vehicle-segment,playback-controls,page-actions}-crash-review.log` receipts retain
1/3/2/1/4/2/1 candidates; HeaderFilter's `phase3-data-table-header-filter-attempt-2-checks.log`
retains two (scan exit 1, normal tests exit 1). These are inspected receipts, not fresh gates.

Approve the following additions at existing `web\tailwind.config.js` `theme.extend`.
Current resolved config has no exactly equivalent values; names must also be collision-checked
against intervening additions. Reuse accepted `max-w-shell-panel-viewport` for HeaderFilter's
`calc(100vw - 1rem)` cap; it is the same property/value, unlike Tooltip's 1.5rem cap.

| Exact current owner / region | Approved map key = exact current value; replacement |
| --- | --- |
| `web\src\components\layout\presentation\PresentationOverlay.tsx:71,136,151,178` toolbar/clock/rotation/exit | `zIndex['presentation-controls'] = '9999'`; `z-presentation-controls` |
| Same file `:113` inert burn-in dimmer | `zIndex['presentation-dimmer'] = '9998'`; `z-presentation-dimmer` |
| Same file `:124` inert cursor layer | `zIndex['presentation-cursor'] = '9997'`; `z-presentation-cursor` |
| `web\src\components\layout\status-bar\AlertsSegment.tsx:204,231` Popover/list scroll | `width['alerts-preview'] = 'min(92vw,380px)'`; `w-alerts-preview`; `maxHeight['alerts-preview'] = '320px'`; `max-h-alerts-preview` |
| `web\src\components\maps\MapTileLayer.tsx:183` Leaflet control | `zIndex['map-tile-control'] = '800'`; `z-map-tile-control` |
| `web\src\components\layout\status-bar\BackgroundWorkSegment.tsx:194,209` summary/Popover | `maxWidth['background-summary'] = '180px'`; `max-w-background-summary`; `maxHeight['status-options'] = '280px'`; `max-h-status-options`; `minWidth['background-work'] = '260px'`; `min-w-background-work` |
| `web\src\components\vehicles\VirtualizedVehicleGrid.tsx:108` list scroll | `height['vehicle-grid'] = 'min(72vh,56rem)'`; `h-vehicle-grid`; `minHeight['vehicle-grid'] = '28rem'`; `min-h-vehicle-grid` |
| `web\src\components\layout\status-bar\RecentPagesSegment.tsx:137` Popover | `width['recent-pages'] = 'min(92vw,360px)'`; `w-recent-pages` |
| `web\src\components\layout\status-bar\ActiveVehicleSegment.tsx:97,176,208,225` options/two labels/Popover | Reuse `max-h-status-options`; `maxWidth['active-vehicle-label'] = '160px'`; `max-w-active-vehicle-label`; `maxWidth['active-vehicle-compact-label'] = '140px'`; `max-w-active-vehicle-compact-label`; `minWidth['vehicle-options'] = '220px'`; `min-w-vehicle-options` |
| `web\src\components\data-display\PlaybackControls.tsx:315,455` shortcuts/scrubber | `gridTemplateColumns['replay-shortcuts'] = 'auto 1fr'`; `grid-cols-replay-shortcuts`; `flex['replay-scrubber'] = '1 1 12rem'`; `flex-replay-scrubber` |
| `web\src\components\layout\PageActions.tsx:112` scope-first responsive grid | `gridTemplateColumns['page-actions-scope'] = 'minmax(0,1fr) auto'`; `sm:grid-cols-page-actions-scope` |
| `web\src\components\ui\DataTableHeaderFilter.tsx:53` filter Popover scroll | Reuse `max-w-shell-panel-viewport`; `maxHeight['table-filter-viewport'] = 'calc(100dvh - 2rem)'`; `max-h-table-filter-viewport` |

This resolves the prior BackgroundWorkSegment/grid **UNKNOWN naming mappings only**:
current literals, scroll/minimum purpose and matching crash receipts suffice; no behavior
acceptance is inferred. Keep grid height/min-height together (minimum can exceed the vh cap),
virtualizer measurement/ref/callbacks/row transforms, stable scrollbar gutter and caller override.
Retain 280px shared scroll caps, distinct 180/160/140px truncation and 260/220px minimum widths.
No rounding px to rem, viewport to container/dynamic units, fixed height for minimum, or
new breakpoint. HeaderFilter keeps w-80, start alignment and dynamic-viewport subtraction;
status Popovers keep top/end positioning. PageActions keeps base single column, sm grid,
xl flex; replay keeps auto/1fr tracks and its 1 1 12rem wrapping basis. Preserve logical
start/end, meaningful RTL direction, reachable scrolling/actions/focus and all public semantics.
Presentation keeps fixed/inert/pointer-events branches, dim opacity, clock/rotation/exit behavior
and equal-layer DOM order: 9997 < 9998 < 9999. Map 800 remains map-local and distinct from
accepted map-control 1000; unchanged stacking contexts/portals, not cross-context priority proof.

Independent **`phase3-remaining-geometry-tokens`** owns only `web\tailwind.config.js`,
`web\src\lib\cn.ts`, `web\src\lib\__tests__\tokens.test.ts`, `web\src\lib\cn.test.ts`.
Add exactly 19 entries; register each in existing merge groups z/w/max-w/min-w/max-h/h/min-h/
grid-cols/flex (same property prefixes). Preserve the accepted first ten shell roles and all
earlier entries. Compare every old/new utility's generated declarations/value/importance/media
exactly except selector, including actual sm grid and matching sm/md/xl variants. Require
both-order last-conflict-wins versus ordinary/arbitrary same-property classes and caller overrides;
different variants/properties coexist, including width/caps and height/minimum. No !important.
After tokens, ten independent `phase3-<owner>-geometry-adoption` scopes use owner names
`presentation-overlay`, `alerts-segment`, `map-tile-layer`, `background-work-segment`,
`virtualized-vehicle-grid`, `recent-pages-segment`, `active-vehicle-segment`, `playback-controls`,
`page-actions`, `data-table-header-filter`: each owns only its table-cited source and directly
matching reserved tests, never config/merge/parents/catalog/scanner. Rerun strict scoped checks
and unchanged scanner; retain unrelated findings and failing normal-test/preservation receipts.
Downstream compare computed dimensions/layers/bounding boxes before/after at MDC-070 widths,
16/20px roots, 200% text, short/tall viewports, narrow containers and RTL, preserving scroll/focus.
Authentic supplied vehicle paint is not decorative chrome. `phase3-vehicle-icon-crash-review.log`
retains public `web\src\components\maps\vehicleIcon.ts:8` fallback `#00f0ff`: separate semantic/
color-renderer decision must preserve caller paint and public-default compatibility; geometry
does not resolve that color finding. No UI/browser/contrast pass, scanner waiver or full gate here.

## Resource semantics and bounded geometry addendum — MDC-026 / MDC-033 / MDC-043

**`phase3-resource-and-geometry-addendum`: decisions only, append-only.**
The accepted remaining-19 decision (`9564fe1fdd`) and all first-29 shell/remaining
roles above are unchanged. Immutable dispatch prefix SHA-256:
`06328a1991676ac58da8ef80f065f885e754f166c14c2feb1683437f93d76220`.
Read-only receipts in `.agent-status\receipts\` are evidence of unresolved
findings, not fresh tests or implementation acceptance:
`phase3-metric-card-reboot-review-checks.log`,
`phase3-base-error-boundary-fallback-checks.log`,
`phase3-combobox-multi-focus-role-checks.log`,
`phase3-command-deck-checks.log` and
`phase3-data-freshness-post-root-review-checks.log` each retain scanner exit 1.
The last records 29 passing tests and corrected fixture diagnostics 0; neither
those receipts nor this document clear its minimum-width finding.

### Exact naming-only geometry and merge contracts

Approve only these equivalents at existing Tailwind owners. The installed
normal config loader/resolver found the five initial proposed extension names
absent, and the late freshness name absent. It found **existing `minWidth.24 =
'6rem'`**: reuse `min-w-24` rather than inventing a competing Combobox role.

| Exact source region / literal | Existing equivalent or approved `theme.extend` entry | Adoption |
| --- | --- | --- |
| `web\src\components\data-display\MetricCard.tsx:77`, `grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem]` | `gridTemplateColumns['metric-compact'] = 'minmax(0,1fr) minmax(0,1fr) 5rem'` | `@[26rem]/metric:grid-cols-metric-compact` |
| `web\src\components\feedback\ErrorBoundary.tsx:169`, default `min-h-[400px]` | `minHeight['error-fallback'] = '400px'` | `min-h-error-fallback` |
| `web\src\components\forms\ComboboxMulti.tsx:500`, `min-w-[6rem]` | Reuse resolved `minWidth.24 = '6rem'`; no addition | `min-w-24` |
| `web\src\components\layout\sidebar\CommandDeck.tsx:233`, `transition-[width]` | `transitionProperty.width = 'width'` | `transition-width` |
| Same CommandDeck region, `w-[76px]` / `w-[320px]` | `width['command-deck-collapsed'] = '76px'`; `width['command-deck-expanded'] = '320px'` | `w-command-deck-collapsed` / `w-command-deck-expanded` |
| `web\src\components\data-display\DataFreshness.tsx:231`, `min-w-[4.5rem]` | `minWidth['freshness-age'] = '4.5rem'` | `min-w-freshness-age` |

Exactly **six extensions**, plus one reused built-in; no `tokens.ts`, spacing,
breakpoint, color, layer or scanner additions. Names are approved targets, not
implemented utilities. Register in existing cn merge groups: `grid-cols` with
`{ 'grid-cols': ['metric-compact'] }`, `min-h` with
`{ 'min-h': ['error-fallback'] }`, `w` with
`{ w: ['command-deck-collapsed', 'command-deck-expanded'] }`, `transition` with
`{ transition: ['width'] }`, and `min-w` with
`{ 'min-w': ['freshness-age'] }`. Built-in `min-w-24` uses existing recognition.
Require both-order last-conflict-wins against ordinary/arbitrary same-property
utilities, actual caller overrides and matching responsive/container/motion
variants. Different properties and variants coexist; do not conflate width
with minimum/maximum width, transition property with duration/easing, or grid
columns with placement. No CSS-order dependency, `!important` or waiver.

Generated declarations, values, importance, selectors' variant conditions and
media/container context must match old/new pairs exactly except utility spelling.
MetricCard retains named `@container/metric` and the **26rem container** threshold,
not viewport `sm`: two equal `minmax(0,1fr)` tracks plus an always-reserved 5rem
comparison track, including when no delta exists. Keep placement, wrapping,
compact/default branches, icon/help/subtitle and caller merge order. Track width
is 80/100px at 16/20px roots; the threshold is 416/520px. Default ErrorBoundary
keeps a growing 400px **minimum**, p-8/max-w-md centering, inline/caller-fallback
branches, catch/report/reset/chunk reload/retry/route/public semantics. Naming
does not resolve its independent localization or fixture-type blockers.

Combobox retains flex-1/native input/ref, labels/ARIA/IDs, chip selection,
keyboard/focus/value/disabled/max-count/loading and original offsets. Its minimum
is 96/120px at 16/20px roots. DataFreshness keeps the noncompact age label's
inline-block, wrapping, text-start and tabular numbers; 4.5rem is 72/90px at those
roots, a growing minimum rather than fixed width. Preserve compact omission,
source/freshness distinctions, timestamp/relative-time/localization, refresh
button versus static branch, announcements, disabled/fetching and motion.
Do not multiply these rem dimensions by `--font-scale`.

CommandDeck preserves the >=1280px desktop rail/secondary panel and <1280px
mobile drill/Back visibility, panelOpen/panelCollapsed state, overflow-visible,
shrink-0, physical pixel widths, logical RTL origin/enter direction and existing
duration-normal/ease-standard. Width transition remains **width only**; retain
`motion-reduce:transition-none` and JS `useMotionPreference()` suppression,
including low bandwidth, without introducing entrance/exit lag. Preserve all
navigation/pins/collections/route/ref/focus callbacks. These substitutions
change no z-index, portal, stacking context, positioning or layer ordering.

### ResourcesPanel: utilization is not worker health

The exact final `phase3-resources-panel-attempt2-checks.log` reports **FAILED**
for missing semantics, despite 24 passing tests: no source/test writes in that
attempt. `web\src\components\status\ResourcesPanel.tsx:19–28,73–95` exposes only
presentation and percent and treats >=90 as critical. The real sole production
caller, `web\src\features\system\pages\SystemStatusPage.tsx:377–384,721–725`,
passes `healthy_count / total * 100`. Its worker status at :320–328 already
distinguishes all healthy / some healthy / none healthy / no workers. Do not
reverse all percent thresholds or infer meaning from translated label/metaText.
This is an explicitly approved bounded correction at these existing owners,
not a universal metric engine or an invented second consumer.

Approve an additive discriminated ResourceRow API retaining existing
label/valueText/metaText/icon and panel title/emptyText/footnote/id/className:
default/omitted `metricKind: 'utilization'` retains optional `percent` with
existing finite clamping, neutral below 70, warning >=70, danger >=90, including
valid measured zero. Explicit `metricKind: 'healthy-workers'` instead requires
raw `healthyCount: number | null` and `totalCount: number | null`; disallow a
caller percent in that branch. Never parse valueText, synthesize counts, coerce
missing values to zero, or accept a localized-label heuristic.

Validate health counts as finite nonnegative safe integers, total >0 and
healthyCount <= total before deriving the ratio. All healthy = success; some
healthy but fewer than total = degraded/warning; measured healthyCount=0 with
positive valid total = real outage/danger **with a measured zero bar**.
Thus 95/100 is degraded, never utilization danger; 100/100 is healthy/success.
Missing/invalid count, inconsistent numerator, total=0/no configured workers,
negative/noninteger/nonfinite/unsafe counts = explicit unknown, **no bar**.
No denominator clamping or invented backend capacity. Plain non-percent
resource rows remain plain readings, not newly classified outages.

Add optional per-row `sourceState?: DataState<unknown>` using the existing
`web\src\api\dataState.ts` type, without duplicating payload/query state or
creating another trust model. Domain outcome and trust are orthogonal:
retained data remains visible on refresh error/stale/paused/offline, with
existing nonblocking trust/retry presentation; a retained healthy ratio is not
fresh confirmed health. Only fatalError with no retained data may replace that
source's row content; initial loading must not fabricate zero/outage, and no
one-source failure blanks neighboring resources. Use existing feedback APIs
with concrete internal imports, no new query/error provider inside the panel.
Keep status text/icon and localized accessible bar naming alongside color:
approve optional `barAriaLabel`/`statusText` presentation strings for the caller's
localized worker-health versus utilization descriptions. Preserve defaults'
intent through canonical localization, never concatenated translated “usage”.
Any absent canonical copy is a separately assigned catalog prerequisite,
not permission for this component/caller to write catalogs or undeclared keys.

SystemStatusPage adoption passes actual workers counts and workersState into
the health branch, retaining workers' unknown row when unresolved; DB pool
retains utilization and extendedState. Other rows retain their actual backing
backupStatsState/versionState/extendedState as appropriate. Reuse current
useDataState at :154–163, source retry/timestamps/fatal-versus-refresh semantics
and all existing sections. Pass the existing translated resources heading.
Do not guess CPU/disk capacity, change endpoints/hooks/server types, or replace
raw payloads with formatted fake measurements. Tests must cover utilization
70/90 boundaries; health 95/100,100/100,0/positive; missing/invalid/no workers;
initial/fatal, retained refresh error and independent neighbor recovery.

### Atomic assignments, serialization and frozen accounting

The already queued **first-ten test-only accounting** item owns only its
explicitly reserved `web\src\lib\__tests__\tokens.test.ts` scope; shell-token
acceptance waits for it, not vice versa. It need not wait for component adoption.
After first-ten owner release/accounting/acceptance, serialize the existing
`phase3-remaining-geometry-tokens` (19 entries), then separate
**`phase3-resource-geometry-tokens`** (six entries above). The latter owns only
`web\tailwind.config.js`, `web\src\lib\cn.ts`, matching `cn.test.ts` and explicitly
reserved `__tests__\tokens.test.ts`. Freeze each immediate accepted baseline;
no overlapping token/test leases, no component dependencies at token owners.

For every future token owner preserve **all three original expected resolved
fingerprints** in tokens.test.ts: `63d006e08dcb1f52224d56d3f7d7d1525736932525b32c951702ae968f7dc503`,
`9da0b97a5e67e5717e4c1767411cad4b7d682bd8048016e0a4447c2164e016ba`,
`14fb24118b45d5c77912cb0e86a20e10572577a76f8a9453027e6dc6f797caf4`.
Explicitly assert exact approved property/key/value additions before excluding
only those accounted additions from each historical projection; retain exact
immediate-predecessor comparison too. Unknown entries/value mutations/plugins/
screens must still fail. No hash reset, ratchet pruning, broad suffix/property
deletion, baseline regeneration or deletion of original expectations. Each
serialized scope accounts for its actual accepted predecessors and only its
own new set, not speculative future additions; test-only accounting changes
neither config nor cn and never waits on downstream adoption.

After corresponding token acceptance, five independent geometry adoptions own
only their cited source plus matching reserved tests: **`phase3-metric-card-geometry-adoption`**
(MetricCard.test.tsx), **`phase3-error-fallback-geometry-adoption`**
(ErrorBoundary.test.tsx and __tests__\ErrorBoundary.routeReset.test.tsx),
**`phase3-combobox-multi-geometry-adoption`** (forms\__tests__\ComboboxMulti.test.tsx),
**`phase3-command-deck-geometry-adoption`** (sidebar\CommandDeck.test.tsx), and
**`phase3-data-freshness-geometry-adoption`** (data-display\__tests__\DataFreshness.test.tsx).
Combobox's built-in substitution needs no new token; dispatch its separately
owned adoption only after the serialized equivalence/merge proof. Coordinate
ErrorBoundary's localization owner without overlapping source leases.

Independently assign **`phase3-resources-panel-semantic-api`** only ResourcesPanel
and status\__tests__\ResourcesPanel.test.tsx after any required copy owner, then
**`phase3-system-status-resource-adoption`** only SystemStatusPage and its matching
SystemStatusPage.test.tsx after API acceptance. Neither depends on geometry
adoptions; the API owner never waits on its caller. These are separate bounded
assignments, **not a third ResourcesPanel migration retry**. No ownership of
catalog/config/backend/routing/scanners is implied for either.

All implementation owners rerun exact scoped tests/lint/type/preservation and
unchanged scanner; retain unrelated findings. QA compares old/new computed
geometry and merge/selector behavior at MDC-070 widths, narrow containers,
26rem container and 1279/1280 transitions, 16/20px roots, 200% text, long RTL
labels, themes/forced-colors and reduced motion, preserving reachable focus,
scroll/actions and layer contexts. This DOC scope runs no UI/browser/full gates
and claims no fresh runtime, contrast, native, backend or application acceptance.

## Map renderer and authentic vehicle materials — MDC-034 / MDC-010 addendum

**`phase3-map-and-material-contract`, attempt 1: design disposition only.**
Append to accepted `bc2d35fde2` contract prefix: exactly **78429 bytes**, SHA-256
`ddd3554dc5a39b2ca6c5b0d82e78457c28a90bb40b7a130298bf508a9c7f8fa9`.
All preceding semantic/status/ResourcesPanel APIs, first-35 geometry decisions,
fingerprints and original preservation requirements remain untouched.
Read mission §§0,5–8,27–31, worker conventions and docs CONTRIBUTING first.
No UI, helper, token, catalog, scanner, backend, tests or queue implementation
is authorized by this documentation delivery.

### Evidence and prior art before extension

Fresh realpaths, full source/test/original/profile/receipt hashes and the complete
**106-entry** retained scanner inventory (each exact line, column, literal and
source statement) are recorded in
`receipts\phase3-map-and-material-contract-checks.log`, rooted at
`F:\github\TeslaSync`. Original/profile evidence lives under session
`bba4960d-f516-4831-bda3-877640f907ce\files`, particularly
`verified-phase3-originals`, `frontend-phase3-owner-plan.json`,
`frontend-phase3-complex-owner-plan.json` and
`frontend-phase3-vehicle-twin-scoping.json`; these stay immutable.
Original scope, not a reboot delivery, defines preservation. Current hashes:

| Exact existing owner | Current source SHA-256 | Evidence/acceptance boundary |
| --- | --- | --- |
| `web\src\components\vehicles\VehicleTwin.tsx` | `dc45bd9a1c73df45204e78e206edb12de469d9f968edca95f6d3c4d0cfb1c9c0` | Final ink delivery remains failed: 103 candidates, three token reviews; reboot receipt proves historical scoped 8/8 tests, lint/fixture zero, not current runtime acceptance. |
| `web\src\components\vehicles\VehiclePaintPicker.tsx` | `50a138afedb421885e76b24cb0246126b4dee7ab1e53e3a1bbf6544bb224d7b6` | Oracle intake did not accept original migration; two on-fill candidates remain in unchanged scanner. |
| `web\src\components\maps\vehicleIcon.ts` | `092001077eb129896551a27d596787a3692c909497e6992673d4ed5325172a23` | One actual default `#00f0ff` candidate, not authentic caller paint. |
| `web\src\components\maps\GeofenceDrawer.tsx` | `e579b135516268516e5726fa191e9488aeaf90553ece3794e3e31a10ac6089b9` | CSS-variable default passed to Canvas is unsupported; mocked option assertions do not prove rendered compatibility. |

Prior art: `lib\tokens.ts` has `neonColorMap`, `severityTokens`, `gaugeTone`,
`resolveGaugeColor` and `chartTokens`; these return CSS references for DOM/SVG,
**not resolved Canvas colors**. `lib\colors.ts` preserves ordered chart palette
identities/derived presentation; its older COLOR/status literals are not a new
map fallback or a domain-threshold authority. `lib\vehicleColors.ts` owns five
physical palettes, inferred/fallback paint and gradients; `useVehiclePaint`
owns browser-local per-vehicle override/broadcast/reset, not telemetry.
`lib\chartTypography.ts` demonstrates guarded computed-style access for
non-DOM rendering, but is neither a color resolver nor permission to copy its
hardcoded font fallback into colors. Reuse these owners; no parallel theme,
palette, paint preference or semantic-status engine.

### Exact material versus meaning disposition

Authentic material describes the vehicle's physical appearance; semantic ink
describes application state. White specular reflections, black tires/shadows,
red taillight lenses and amber physical turn lamps are not white metadata,
danger/success chips or decorative neon. Preserve model/photo/paint precedence,
all real artwork paths and per-instance gradient/mask IDs. Never desaturate a
user's actual paint, recolor photos or rewrite saved choices to match chrome.
Conversely a charge underglow, lock halo, sentry pulse or swept highlight does
not become authentic material merely because it is drawn inside the car SVG.

The pinned scanner report
`.agent-status\receipts\phase3-vehicle-twin-semantic-overlay-ink-scan.log`,
SHA-256 `628d37320b5d98f968edce6d4cd71dd4a9c40b2a2ea1f43af1140944da60cbd8`,
is the exact literal/column inventory; grouped coordinates below cover every
candidate. This is a **design exception specification, not a scanner waiver**.

| Exact VehicleTwin source sites / count | Role, permitted values and state constraints | Separate acceptance requirement |
| --- | --- | --- |
| C:206,208,214–216,218–220,231–234 / 12 | Keep exactly pinned RGBA cladding/glass aperture, lens/light, ground/tire materials. Physical white/yellow/red/amber emission belongs only to actual light geometry and existing predicates; no domain outcome inferred from hue. | Verify all uses stay physical; do not exempt semantic C entries or ambient loops. |
| GroundShadow:319 / 1; WheelSVG:367,371,388,395–396,401,408–409,416 (two literals),417 / 11 | Preserve exact pinned black alpha ground/contact shadow, rubber/metal/spokes/rim shading, including both :416 literals. | Mask/gradient scope and composed legibility, not a page-chrome exemption. |
| Body/trim/glass:435,443–445,447,449–450,452–453,458,460,493,500,509,521,546,597,600–601,607,613 (two),640,678,689,697,701,704,710–711,723–724,726–727,738,750,757 / 37; charge flap:876–877 / 2 | Retain exact pinned static material shading/reflection/closed-branch literals. At 521/546/876 only the physical closed branch qualifies; open/warning/null overlays retain existing semantic roles/predicates. | Preserve optical paths; separately remove decorative sweeps, not material stops. Never convert unknown to closed/off. |
| Physical light base branches:957,963,967,1027,1033 / 5 | Pinned smoked lens/DRL/taillight colors, including white `rgba(235,245,255,0.95)` and red `rgba(255,90,90,0.95)`, remain physical artwork, not asserted live/on status. Preserve photo suppression and existing actual hazard/turn predicates. | Light-feedback owner removes breathing/bloom; static lens color cannot manufacture confirmed headlights or hazards. |
| SvgDefs:1338–1341,1344–1347,1350–1352,1357–1359,1362–1364,1367–1368,1373–1375,1378–1380,1383–1385,1388–1390 / 31 | Preserve exact pinned ordered stops/offsets for shoulderHighlight, softReflection, glassReflection, glassGrad, lowReflection, windshieldGrad, headlightLens, taillightGrad, rimGrad, tireOuter. No theme substitution for optical gradients. | Stops are material; animated consumers are not exempt. Preserve paint-derived body/lower/hood/mirror stops separately. |
| PhotoOverlay edgeMask:1245 / 1 | `#000` is opaque alpha-mask coverage, not visible UI black; retain radial geometry/feather arithmetic and transparent edge. | Confirm CSS mask coverage/composition, no visible black fill substitution. |
| ChargingUnderglow:334,339 / 2 | `rgba(34,197,94,0.18)` and `rgba(34,197,94,0.38)` are **not material exceptions**. Replace ambient green bloom with bounded static existing info-role charge indication under actual `isCharging` predicate. | Existing charge-security owner, preserving bolt/flap/security paths and null states; no generic ink retry. |
| GradientIds:157 / 1 | `glow: p('glow')` is an instance-safe identifier, not itself paint. Identifier-only disposition cannot exempt the filter or its consumers. | Separately remove nonessential bloom uses at light/charge owners; preserve instance isolation and any justified finite physical effect. |

Partition is **99 physical literal candidates + one alpha-mask literal + two
non-exempt charging literals + one identifier = 103**; three token-reference
reviews remain separate. No blanket 103 waiver, filename exemption, scanner
change, candidate deletion or “scan clean” claim. QA records exact tuple
`source hash + line/column + literal + role + branch/gradient + caller/state`
against this inventory; any new literal/use/hash drift requires refreshed
scoped evidence, not automatic inheritance. Material permission never permits
extra glow, wider alpha, new loops, fake states or arbitrary layout changes.

For VehiclePaintPicker preserve `vehicleId`, nullable `exteriorColor`,
`className`, all five stable IDs/order, labels, detection/override/reset,
roving radio arrows/Home/End/RTL, focus refs and selected announcements.
Approve **only its :105 selected check stroke** `#000000` on pearl-white and
`#ffffff` on the other four opaque authentic swatches, not UI text/chrome.
Actual sRGB contrast calculation in this receipt: pearl-white `#e9ecf2`
17.745070:1; midnight-silver `#5b6675` 5.829692:1; deep-blue `#1f3a72`
11.015153:1; solid-black `#0d1117` 18.924631:1; red-multicoat `#a3001a`
8.164147:1. This proves the pinned color pairs analytically, **not browser
contrast/forced-colors acceptance**. The :93 swatch `p.swatch` and :92 bounded
`forced-color-adjust:none` preserve authentic paint only; outer radio border,
focus and accessible label still use theme/system roles. Changed palette pairs
must recompute on-fill contrast, not rely on a permanent ID heuristic.
Existing picker oracle needs no further implementation attempt; its original
owner/QA records these exact material/on-fill dispositions with retained scan1.

### Map renderer boundary and intentional public-default change

Approve bounded `vehicleIcon.ts:8` default change from decorative `#00f0ff`
to trusted **`var(--semantic-info)`** at the existing DOM DivIcon owner.
This intentionally changes the appearance of omitted, null, blank, malformed
and injection-rejected colors across default consumers: VehicleCharts,
GuardLiveMap, GeofenceWidget and MapOverviewPage. It is not compatibility
identity preservation; callers with validated explicit physical/custom paint
retain their exact color. Keep exported DEFAULT_VEHICLE_COLOR/sanitizeColor/
vehicleIcon signatures, injection grammar, two paint sites, static halo,
28px geometry/anchors and surface border. A trusted internal default may be a
CSS reference; do not broaden untrusted string interpolation to arbitrary
var/markup/style bodies. DOM resolves the trusted role in light/dark/custom/
forced-colors; no hardcoded old-cyan compatibility fallback. Check default
consumers' tile contrast, selection/popup access and SSR markup separately.
No status inferred from a dot, no pulsing marker and no page redesign.

For GeofenceDrawer retain `color?: string`, default theme-primary intent,
fences/IDs, modes, circle SI radius, polygon/rectangle topology, callbacks,
editable/delete enablement and control handlers/cleanup. **Never send
`var(--theme-primary)` or any unresolved CSS reference to Canvas fillStyle/
strokeStyle.** SVG-only restriction would break its existing renderer-neutral
public contract and is not approved.

Resolve color at the map's mounted DOM/style boundary: preserve valid explicit
literal caller colors; resolve default/valid CSS-reference inputs to a concrete
browser-computed color in the owning map theme context (including nested vars
and forced-colors), validate resolution, then pass the same resolved paint to
draw shapeOptions and persisted layers. Reading a raw custom-property string
alone is insufficient. An inert, noninteractive scoped computed-color probe
may resolve CSS through the browser; never interpolate caller text into HTML,
introduce a theme provider or mutate saved theme/paint. Default comes from
existing restrained theme role, not COLOR.CYAN/first chart series/copied hex.
An unbound variable, cyclic variable or invalid color must not be mistaken for
the probe's inherited/default computed color. Verify the referenced role's
availability and resolved color validity; test these failures explicitly.
Malformed/unresolvable overrides use the resolvable existing default role;
if that too is unavailable return explicit unresolved, never prior Canvas
context paint, black, old cyan or another hardcoded compatibility value.

SSR/no document/no computed-style/throwing style access must be guarded with
no import-time DOM side effects. Defer renderer paint initialization until
mounted resolution is available; keep source geometry/actions owned and
available, retry when theme context becomes available, and expose persistent
resolution failure through existing source feedback rather than fabricated
data or silently invisible shapes. Do not issue create/edit/delete callbacks
on resolution or redraw. Theme/mode/custom/forced-colors changes resolve and
update both draft and existing shapes without losing an in-progress drawing,
IDs, callbacks or focus. Existing structural mode/callback enablement changes
retain their intentional lifecycle; a color-only theme update is not permission
to rebuild the map or discard edit state. Keep 2px line and 0.08 fill opacity;
verify draft legibility against actual tiles and selected state independently.

**No new shared color helper/token root now:** only GeofenceDrawer demonstrates
the inspected Canvas resolution need; DivIcon's DOM variable paint is a
different boundary. Keep resolution internal to its owner. A later second
independent Canvas consumer must supply exact source evidence before a
separately assigned existing-token/helper-root extension, then separate
consumer adoptions; no speculative map API, chart migration or token addition.

### Bounded owners, DAG and preservation acceptance

| Assignment / exclusive future write scope | Actual prerequisite / acceptance |
| --- | --- |
| `phase3-map-and-material-evidence-disposition` — read-only original ink/picker source/tests; assigned QA receipt only | This contract accepted; exact current/original hashes and tuple inventory verified. Resolve material/on-fill design blocker, retain raw scanner1 and distinguish remaining successor-owned decoration; do not accept whole renderer. Not a third ink/picker migration or scanner owner. |
| `phase3-vehicle-icon-restrained-default-correction` — only maps\vehicleIcon.ts and maps\__tests__\vehicleIcon.test.ts | Contract acceptance and original owner release; exact export/default impact, sanitizer/injection and caller-paint tests plus default-consumer composed QA. No consumer writes needed to acquire DOM theme role. |
| `phase3-geofence-canvas-paint-correction` — only maps\GeofenceDrawer.tsx and maps\__tests__\GeofenceDrawer.test.tsx | Contract acceptance and original owner release; actual SVG **and Canvas** color behavior, explicit paint/default/theme refresh, SSR/unresolved handling, draft/edit preservation and no callback fabrication. Mocked string equality alone fails acceptance. |
| Existing `phase3-vehicle-twin-static-reflections` → body-window-door-feedback → light-feedback → charge-security-feedback — each only vehicles\VehicleTwin.tsx plus matching VehicleTwin.test.tsx | Preserve existing profile's sequential dependencies after original ink disposition/release; never concurrent source/test leases. Static reflections keep material stops; light owner removes bloom; charge/security owner owns :334/:339 and expanding rings/pulses, preserves required finite sentry ellipse. No whole-SVG rewrite or third generic migration. |

Map corrections and evidence disposition are independent siblings; none waits
on a downstream caller, resource API or geometry adoption. Original owner/QA
may accept only the original ink/picker's bounded scope after exact exception
review; successor-owned charging/light/reflection findings remain explicit
open work, not an invented prerequisite cycle or whole-renderer acceptance.
Future source owners freeze immediate accepted baseline **and** immutable originals, carry forward
all original assertions/typed fixtures and prior approved deltas; no test
weakening/hash reset. Existing public props, photo/model precedence, paint
storage, geometry/shapes, sections/actions, true/false/null predicates,
independent source trust/failure/retry and all SI/wire/cache values survive.
No new source-state model: retained stale/error/offline data remains visible
with existing trust presentation, never converted to confirmed live status.

Implementation owners run authorized exact scoped tests/lint/typing and
unchanged scanner, retaining findings, then separately owned composed QA:
dark/light/custom/forced-colors, real SVG/Canvas maps/tiles, long RTL labels,
44px radio targets, keyboard/focus/selection, 200% text and mission widths;
OS reduced motion and low bandwidth suppress nonessential loops while genuine
hazard/turn feedback retains accessible static meaning. Labels/text/icons,
not color alone, communicate state. DOC-only verification here checks prefix,
realpaths, hashes, exact inventory partition, analytical on-fill pairs and
acyclic nonoverlapping scopes. Docs build, application tsc/lint/build/tests,
browser/native/backend/runtime acceptance are **NOT RUN / NOT CLAIMED**.

## Ownership evidence-strength badges — MDC-025 / MDC-026 / MDC-044 addendum

**`phase3-verdict-strength-contract`, attempt 1: explicit presentation decision only.**
Preserve the accepted **95305-byte** prefix exactly, SHA-256
`4c4a5a9c5456812ef4726f2db1d7e57900f6d9e3d0224f8d36ebc7cb5ce2243b`.
The prior label-adoption refusal correctly identified an absent strength mapping;
canonical copy alone did not authorize guessing success/failure semantics.

### Supported roles and source-backed meaning

Reuse `web\src\components\ui\Badge.tsx` and its actual supported variants
`info/success/warning/danger/neutral`; no new variant, token or component.
At `web\src\features\ownership\components\VerdictBadge.tsx`, explicitly assign:

| Normalized evidence/confidence-strength value | Exact Badge variant | Meaning, not outcome or health |
| --- | --- | --- |
| `strong` | `info` | Informational emphasis for stronger supporting evidence; not success, confirmed identity or a desirable recommendation. |
| `moderate` | `neutral` | Intermediate evidence strength without an alarm; visible text preserves its distinction from unknown. |
| `weak` | `warning` | Caution about reliance on limited separation/evidence; not danger, failed operation, unhealthy system or a negative verdict. |
| `unknown` / unrecognized value / absent value | `neutral` | No known strength classification; never substitute weak, zero, failure or success. Preserve the distinct text rules below. |

These are restrained existing roles, not a new ordinal color scale or confidence
thresholds. Source reasons: `web\src\types\ownership.ts` defines
`DriverAttributionReport.separation_verdict: string`, nullable separation score,
separate numeric confidence, DataQuality and Evidence; it supplies no closed
strength enum or numeric-to-strength conversion. The existing interpretation in
`web\src\features\ownership\pages\DriverAttributionPage.tsx:794–813` and canonical
`ownership.driver.verdict` copy describes strong as well-separated clusters,
moderate as overlapping clusters needing more labels, and weak as indicative
only. Thus info/neutral/warning communicates evidence and reliance, not
positive/negative outcome. Its separate metric's positive/default/warning tones
are not a Badge API or authority to equate strong with success.
SubscriptionVerdict and its separate confidence also remain independent.
Do not remap the original **38** VerdictBadge tone entries (including health,
quality, trust and keep/review/cancel), general MDC-025 statuses, page metrics,
numeric confidence, source freshness or backend classifications.

### Exact bounded adoption and acceptance

Resume only **`phase3-verdict-label-adoption`** after this decision is accepted
and its source lease is released: only
`web\src\features\ownership\components\VerdictBadge.tsx`, plus the explicitly
reserved new adjacent `VerdictBadge.test.tsx` after verifying it remains absent.
This is the existing narrow adoption, not a third generic verdict-badge retry.
No Badge/shared primitive, ownership types, page, catalog, generator, token,
scanner, backend or API-hook writes; no downstream caller prerequisite.

Adopt the existing **41** `ownership.verdict.<value>` canonical short labels in
`web\src\i18n\en.json` (matching generated `en\locale-ownership.json`), not the
long interpretation prose. All 41 English labels exactly match the current
lowercase/underscore-to-space display. Keep `value: string | null | undefined`,
optional `label`, optional `dot`, default `dot=true` and category-barrel Badge
reuse unchanged. Preserve `(value ?? '').toLowerCase()` without trimming or
recasing unknown input beyond that existing rule. Explicit `label` wins via
`??`, including the empty string. Recognized `unknown` shows its localized
short label; null/undefined/empty value without override shows **`—`**; every
unrecognized nonempty string remains its normalized underscore-to-space text,
never relabeled "unknown", dropped or sent to an invented catalog key.
Unknown inherited object names must not accidentally resolve as known values.
The decorative dot remains hidden from assistive technology; preserve native
span semantics, wrapping and Badge forced-colors behavior, without new live
announcements, controls, tooltips or status claims.

Use an exhaustive typed local mapping for all 41 known labels/tones constrained
to actual Badge variant types; safe own-key recognition keeps arbitrary public
strings valid. No `any`, unsafe cast to a closed backend enum or public API
narrowing. Tests must verify all original38 tone/label pairs unchanged, the
three exact strength assignments, all41 canonical English label parity and
localized-label lookup, uppercase inputs, underscore fallback, unknown/new
strings and inherited names, null/undefined/empty, explicit/custom/empty label,
dot default/false and readable text independent of hue.
Freeze original source SHA-256
`98853bb9668e8cdc09083a3158962d97770becc568ebc3930d748a7fca699d3d`
and retain original behavior assertions; do not regenerate preservation evidence
or weaken tests. Run normal exact-scope tests, strict scoped lint, source and
fixture typing/preservation and unchanged scanner, recording raw commands/exits
and all remaining findings. QA separately checks long localized/RTL labels,
200% text, narrow containers/mission widths, dark/light/custom/forced-colors
and composed text contrast under MDC-040–043/060–070.

This DOC-only item verifies prefix, read-only hashes, supported variants,
canonical41 parity and decision scope in
`.agent-status\receipts\phase3-verdict-strength-contract-checks.log`.
It changes no source or data semantics and clears no implementation, scanner,
browser/native/contrast or mission §§43–45 gate. Application TypeScript,
tests/lint/build, docs build and runtime QA are **NOT RUN / NOT CLAIMED** here;
no broad waiver or catalog/root extension is needed for this mapping.

## Hero stream observation and retained trust — P172 / MDC-026 addendum

**`phase3-hero-observation-contract`, attempt 1: docs-only decision.**
Preserve the accepted **101320-byte** prefix exactly, SHA-256
`1605f3da7414182a5ca70cd2e2f8c35ce5113fd096b2361ce1e1672d89da9ffc`.
This explicitly authorizes a bounded extension of the existing shared Hero:
global justification is preventing a stream timestamp from becoming a false
measurement-freshness claim in a reused renderer, not a speculative second
consumer or new trust framework. Styling delivery is not freshness acceptance.

### Actual evidence and optional API

`internal\service\current_state.go:345–373` selects the newest real, non-null,
timestamped, non-synthetic live signal across the vehicle stream.
`web\src\api\hooks\useVehicles.ts:126–150` already maps `observed_at` to
`observedAt: number | null` and exposes the existing `VehicleStateFreshness`
(`fresh/stale/unknown`). `verifiedFields` records winning-value provenance;
it does **not** supply individual observation times or absent-field coverage.
No backend capability is needed for stream observation. Per-reading freshness,
completeness and continuous coverage remain unestablished by this response.
QuickStatsPage:92–93/195–205 currently passes only `stateData?.state`; the
mapped metadata is discarded at the Hero boundary. Query/DataState `updatedAt`
is last successful **fetch**, never a substitute observation timestamp.

Approve these optional additions to `VehicleHeroCardProps`, and no new enum,
server field, hook or domain model:

```ts
dataState?: DataState<unknown>;
observation?: {
  observedAt: number | null;
  freshness: VehicleStateFreshness;
} | null;
```

Use the existing types from `@/api/dataState` and `@/api/hooks/useVehicles`.
The caller owns derivation, provenance and source policy; Hero renders the
existing `vehicleState` prop, not an independently decoded DataState payload.
Keep these new props out of forwarded DOM attributes. Omitting them preserves
the original identity/readings/photo/actions/ref/HTML API and layout behavior,
but establishes no observation or fresh/complete claim. No required prop,
replacement reading interface, automatic query, new selection or local clock
as observation. Use existing `useDateFormat`/date helpers with a validated Date
from server epoch milliseconds; invalid/null/non-finite instants stay unknown.

### Trust, labels and limits

- Keep DataState's exact initial/ok/stale/partial/unavailable/initialFailure
  and live/cached/historical/inferred/repaired/unknown vocabulary. `ok` is
  request success here, **not** proof that all Hero values are fresh/complete.
  `live` identifies pipeline provenance, not vehicle online state.
- Retain every usable reading through refresh errors, stale observations,
  partial sources and paused refresh. Only `fatalError` without retained
  readings replaces this source's body; identity/navigation and neighboring
  sources remain. Missing individual readings stay `—`, including partial
  payloads with valid zero/false. Missing metadata is unknown, not unavailable,
  offline or measured zero; unavailable requires authoritative source evidence.
- `isRefreshBlocked` means paused/deferred refresh, not proven device or vehicle
  offline. Never manufacture a refresh error. Reuse SourceContent retained
  presentation and StaleRefreshWarning with source-specific retry; avoid two
  notices/retries for one event. Do not use `dataSources.status.paused`
  (“Paused offline”) or `dataState.refreshBlocked.message` to assert an
  unverified connectivity cause.
- Use existing exact labels: `statusBar.connectionDiagnostics.telemetry`
  (“Telemetry stream”) scopes
  `dashboard.fleetPosture.scope.observed` (“Last real observation {{age}}”).
  Format that age from `observation.observedAt`, not fetch time.
  `dashboard.fleetPosture.scope.noObservation` (“No verified observation time
  for this vehicle”) and `common.unknown` (“Unknown”) cover absent evidence.
  `freshness.stale` (“Stale”) may qualify the **stream**, never each gauge.
  Do not use `freshness.fresh` (“Up to date”) as blanket Hero assurance,
  `freshness.lastUpdated` as an observation label, or infer freshness from a
  successful fetch/`live` boolean. Retained observation age continues to grow;
  an observation initially marked fresh must not remain so indefinitely.
  Reuse the existing hook freshness resolver/window, not a new threshold.
- Request retention and stream age are separate: stale refresh can retain a
  recent observation; successful refetch can return an old/unknown observation.
  Historical provenance must not receive a live-stream assurance. Unknown
  provenance stays unknown; do not infer a precise server source from `live`.
  `freshness.source` (“Source: {{source}}”) requires an established, localized
  source label, not an invented wire field or guessed source.
- Existing catalog has stream/observation labels but lacks a Hero-scoped
  qualification that individual reading timestamps and completeness are not
  supplied. **Report this as a bounded catalog prerequisite**, not permission
  for inline English, a new invented key/copy or reuse of unrelated two-reading
  battery copy. Catalog owner must approve that exact scope before rendering
  the combined observation presentation. This document's limitation is a
  design requirement, not newly shipped UI copy.

Vehicle StatusBadge/FSM meaning remains distinct from trust: preserve current
state precedence, selection, online/offline operational interpretation and
links; trust metadata never rewrites `vehicle.state` or `vehicleState.state`.
No per-reading badge, verified-complete indicator or fake timestamp. Source
uncertainty is readable text, not color alone or announcements on every tick.

### Bounded owners and dependency order

1. **Catalog owner**, separately leased: only
   `web\src\i18n\en.json`'s existing `vehicleHero` scope for the missing
   observation limitation and its normal generated outputs (currently
   `en\locale-detail-vehicleHero.json`, plus vehicleHero copies in
   `en\locale-dashboard.json`, `en\locale-vehicles.json`, `en\locale-admin.json`
   and required generated manifests). Obtain that explicit atomic lease before
   regeneration; no unrelated catalog changes, new namespace, translation
   campaign, status renaming or token/scanner work.
2. **Hero API/test owner**, separately leased after this decision and catalog
   acceptance: only `web\src\components\vehicles\VehicleHeroCard.tsx` and
   `VehicleHeroCard.test.tsx`. Preserve the current accepted implementation and
   all original assertions. Cover omitted props, true server/null/invalid
   observation, growing age, stream-stale versus fetch-stale, retained error,
   paused without error/offline assertion, partial/null/zero/false readings,
   historical/unknown provenance, independent vehicle state, retries and
   non-forwarded props. Reuse existing feedback/typography/date helpers;
   no shared helper/type/hook/server/catalog writes under this lease.
3. **QuickStats caller integration**, separately leased **after both the
   QuickStats page migration and Hero API acceptance**: only
   `web\src\features\dashboard\pages\QuickStatsPage.tsx` and its adjacent page
   test. Derive DataState from the same selected vehicle state query, pass its
   retained observation metadata alongside the unchanged readings, preserve
   as-of/query policy and workspace selection, and deduplicate source notices.
   Tests cover selection changes without attaching another vehicle's metadata,
   retained/paused/error recovery and fetch time never becoming observation.
   No page migration dependency on this integration, and no other Hero callers
   silently migrated; later consumers require their own scoped evidence.

Owners run their authorized scoped preservation/tests/lint/typing/scanner
checks; composed QA remains separately owned for themes, RTL/long text,
keyboard, narrow widths and accessible trust interpretation. This decision
verifies prefix/hash and narrowly read-only source/label evidence only, in
`.agent-status\receipts\phase3-hero-observation-contract-checks.log`.
No UI/runtime/browser/composed acceptance, backend change, application or docs
build, TypeScript, tests, scanner or full gates are run or claimed here.

## Mobile StatusBar touch allocation — MDC-030 / MDC-040–043 addendum

**Design decision only; implementation and composed acceptance remain pending.**
This append follows the accepted **109817-byte** prefix, SHA-256
`718ba7c82702a6902abe1302017f0d0536518d9c3ebd33db9deed717021b4a09`,
frozen in `phase3-mobile-statusbar-contract-dispatch-baseline.json`.
All earlier decisions and immutable failure/preservation receipts remain intact.

### Actual constraint and responsive decision

The actual final2 receipt
`.agent-status\receipts\phase3-recent-pages-segment-attempt-2-checks.log`
reports a **20px** RecentPages trigger (`h-5 min-h-0`) inside the **24px**
fixed StatusBar (`h-6 xl:h-7`). Its normal 19-test/type/lint/scan results
are historical scoped evidence, not mobile acceptance. A 44px child cannot
fit that parent. Do not authorize a third generic RecentPages retry, a
spacing exception, invisible oversized hit slop, intercepted overlay, negative
positioning, or content under another fixed bar to evade this constraint.

At **below md (768px)**, retain every existing status control and allocate
**two real rows**, rather than squeezing all eight possible controls into one.
The existing first group remains Connection, LiveTelemetry, HonestyMeter,
OperationalMode and conditional Alerts; the second remains RecentPages,
More and Helix. Preserve conditional Alerts behavior and More's existing
background-work/presentation/help/about disclosure; this is not permission
to remove or relocate actions into an unimplemented menu.

| Band, standard presentation with status enabled | Status allocation | Arrangement |
| --- | --- | --- |
| <768px | **7rem (112px at 16px root)** | Two equal rows; at least **2.75rem (44px)** control height and width |
| 768–1279px | Existing **1.5rem (24px)** | Existing single-row density/visibility |
| >=1280px | Existing **1.75rem (28px)** | Existing desktop single row; tab bar hidden |

The mobile 7rem budget includes the existing top border. Two nominal 3.5rem
rows leave room for 44px controls plus the existing **2px outline / 2px
offset** without clipping at the row edges. This is a design allocation,
not a measured browser rectangle. Do not substitute 44px for the entire
bar, which would still overcrowd the 320px composition. Keep the existing
<1024 icon-only and <1280 More branches, user `compact`/`iconOnly` choices,
and desktop density. No new desktop compact accessibility exemption is
granted: the inherited >=md targets/spacing still require their own actual
MDC-040 proof. Coarse-pointer tablet/desktop findings stay explicit; they
are not certified by the below-md allocation or silently waived.

Use existing Tailwind spacing **h-28**, **h-11 / min-h-11 / min-w-11**,
**gap-2 (8px)** and **p-1 (4px)**, plus existing neutral surface, border,
typography, shape and focus roles. No new size family, Button variant,
theme token, breakpoint, or global button resize is needed. StatusBar
height itself must consume **`--shell-status-bar-height`**, not duplicate
`h-6 xl:h-7`; 7rem is the below-md value of that existing role.
Decorative dividers may be absent below md, with the existing desktop
dividers retained. Each row gets 4px internal focus clearance and an 8px
inter-control gap. Controls do not shrink below the real 44px target;
icon/dot/count/status/name semantics and native links remain unchanged.
Keep compact counts, including Alerts' existing count presentation, rather
than fabricating or dropping source values.

Use the existing 12px shell gutter with physical safe-area protection:
mobile left/right padding is respectively
**`max(0.75rem, env(safe-area-inset-left, 0px))`** and
**`max(0.75rem, env(safe-area-inset-right, 0px))`**, at the existing
`[data-role="status-bar"]` CSS owner. Each row uses available width, not
viewport-wide child widths. If safe areas, text zoom or intrinsic content
exhaust it, that row owns a bounded horizontal scroll region with padding
for focus, keyboard/touch reachability and its existing localized status
name; the page must not acquire horizontal scroll. No hidden/ellipsis-only
action, hover-only escape hatch, clipped focus or opaque scroll overlay.
This fallback must be exercised, not inferred from source classes.

### One height/offset authority; no competing workspace owner

At `web\src\index.css:124–126,452–465`, preserve the existing
`--shell-tab-bar-height = calc(3.5rem + env(safe-area-inset-bottom, 0px))`
below xl, its xl zero, and
`--shell-chrome-bottom = tab height + status height`. Add only the below-md
7rem status value; retain 1.5rem at md and 1.75rem at xl. The existing
`html[data-status-bar='off']` zero must win at every width, as must the
tab-off override. Do not increase specificity so hidden/report/kiosk
states reserve phantom chrome.

StatusBar remains above the tab bar via
`bottom-[var(--shell-tab-bar-height)] xl:bottom-0`; bottom safe area belongs
to BottomTabBar, not an additional StatusBar bottom pad. At a 16px root,
enabled mobile bottom chrome is **168px + bottom safe inset** (112 + 56),
not 80px or double the inset. This is arithmetic, not viewport output.
Preserve layers StatusBar 55 / tab bar 50 / existing portaled overlays and
shell guard; do not raise chrome to intercept overlay taps.

`web\src\components\layout\Layout.tsx:866–877,1498–1550` already owns
the standard/report/kiosk datasets, reactive enabled preference and main
`pb-[var(--shell-chrome-bottom)]`. Reuse these unchanged mechanisms.
`BottomTabBar.tsx` already consumes the tab-height role and `safe-bottom`;
keep its six native navigation destinations, selected state and focus.
`web\src\components\ui\Drawer.tsx:127` and `Modal.tsx:110,129` already
consume bottom chrome; do not paste the new height into them. Keep
`pb-safe`, native-host behavior, print exclusions, scroll/focus restoration,
and workspace header vehicle/range ownership. No duplicate selectors,
dataset writer, height hook or measured-height observer is approved.

### Bounded, acyclic dispatch scopes (implementation is not this append)

The orchestrator queues these distinct scopes with fresh accepted hashes
and exclusive leases. Existing final `phase3-status-bar` depends on failed
RecentPages, and final `phase3-layout` depends on that composite. Neither
may become a prerequisite of these roots.

1. **`phase3-mobile-statusbar-height-root`** — sole source owner
   `web\src\index.css`: existing status-height role, responsive values,
   safe left/right gutters and off-state cascade only. Depends on this
   design decision, not StatusBar, RecentPages, Layout or their acceptance.
   No Tailwind/cn/token/catalog changes. Verify generated/computed CSS
   values and override order separately; existing token tests are not
   automatically evidence for this new geometry.
2. **`phase3-mobile-statusbar-frame-root`** — owns only
   `web\src\components\layout\StatusBar.tsx` and
   `web\src\components\layout\StatusBar.test.tsx`, after height-root.
   Replace fixed height duplication, allocate the two existing groups,
   row scroll/focus clearance and the directly owned Helix trigger's
   mobile target. Preserve provider/preferences/announcer/imports,
   data hooks, lazy Helix lifecycle, labels and branch semantics. This
   presentation slice precedes and does not claim final composite
   acceptance; no child implementation dependency is introduced.
3. **`phase3-mobile-statusbar-recent-touch-adoption`** — owns only
   `web\src\components\layout\status-bar\RecentPagesSegment.tsx` and its
   existing adjacent test, after frame-root. Replace the actual mobile
   20px trigger allocation with the existing 44px utilities and explicit
   >=md restoration of its prior density. Preserve the named
   `w-recent-pages`/`max-h-alerts-preview`, all original nine cases and
   subsequent additive coverage, links/ref/events/popover IDs/store scope,
   five-entry preview, empty state and relative timestamps. Narrow adoption
   of this root decision, **not attempt3** or source/provenance rewriting.
   Resolve remaining immutable preservation diagnostics explicitly.
4. **`phase3-mobile-statusbar-peer-touch-adoption`** — after frame-root,
   bounded source/adjacent-existing-test pairs under
   `web\src\components\layout\status-bar\` for **ConnectionSegment,
   LiveTelemetrySegment, HonestyMeterSegment, OperationalModeSegment,
   AlertsSegment and MoreSegment**. One released pair per lease/dispatch,
   not six concurrent writers to shared files. Apply only mobile trigger
   sizing/row-fit changes; cover every Connection admin/non-admin branch
   and native anchor. Preserve queries/RBAC/labels/counts/state/links.
   More's existing embedded BackgroundWorkSegment, PresentationModeSegment
   and HelpSegment controls must each prove 44px below md; any deficient
   embedded control gets a separately leased source/adjacent-test adoption
   at those exact existing owners, not a broad descendant CSS selector.
5. **`phase3-mobile-statusbar-offset-proof`** — read-only consumer proof
   after roots and touch adoptions, at existing `Layout.tsx`/`Layout.test.tsx`,
   `BottomTabBar.tsx`/`BottomTabBar.test.tsx`, `Modal.tsx`, `Drawer.tsx`,
   `Popover.tsx` and `status-bar\HelixSidePanel.tsx`. Check actual callers,
   hidden/report/kiosk/native/print behavior, main last-item reachability
   and open overlay/footer containment against the common role. No
   presumptive caller source rewrite. A concrete offset defect is a
   separately bounded caller repair, never permission to restyle Layout.

Dependency order is **decision -> height-root -> frame-root -> independent
recent/peer adoptions -> offset-proof -> final StatusBar composite -> final
Layout integration**. Existing prerequisite failures remain failures until
the orchestrator accepts exact new corrective evidence; no attempt reset or
historical DONE fabrication. The final composite retains all its other
original dependencies and separately reconciles RecentPages' failed receipt
against accepted touch adoption/preservation proof. The frame-root must
release its StatusBar pair before the final composite can lease it.

### Separate implementation proof and mounted mobile acceptance

Root/adoption owners preserve frozen originals, all test intent/API/actions,
record exact source/test hashes, run their authorized normal guarded focused
tests/lint/typing/scans, and show CSS breakpoint/merge/override evidence.
Unit/jsdom rectangles and historical final2 checks do not establish touch,
viewport, safe-area, contrast or visual acceptance.

After source release and consumer proof, a distinct
**`phase3-mobile-statusbar-browser-proof`** uses the existing authorized
app and `web\playwright.config.ts`/`web\scripts\frontend-qa.mjs` tooling.
Check all MDC-070 widths plus **767/768,1023/1024,1279/1280** transitions;
record actual viewport/root-font, bounding boxes and non-overlapping targets.
At 320/375/390/430, test every enabled/disabled/compact/icon-only preference,
maximal existing status composition, admin/non-admin branches, More and
RecentPages open/close, pointer taps and keyboard/Escape focus restoration,
native link destinations/modifier navigation, row scroll and final page
content. Include RTL, 200% text, long localized names, dark/light/custom and
forced-colors focus/contrast, reduced motion and short/tall browser chrome.
Use real mobile/native safe-area evidence for zero/nonzero bottom and
left/right insets, orientation and chrome changes; desktop emulation alone
is not device safe-area acceptance. Exercise Modal/Drawer/Helix and nested
overlays without intercepted taps or unreachable footer actions, standard
versus report/kiosk, status-off reclamation and unchanged workspace selection.
No production mutation or fixture injection. Authentication/unavailable
device/browser evidence is **BLOCKED/NOTRUN**, never invented output.

This architect item changes only this document. Raw scoped reads, decision,
original/final prefix hashes, full hashes and acyclic-scope validation belong
to `.agent-status\receipts\phase3-mobile-statusbar-contract-checks.log`.
No UI/config/token/catalog/test changes, Git, installs, nested agents,
TypeScript, tests, full builds or visual/runtime gates are run or claimed here.

## New geometry and caller-specific material decisions — MDC-010 / MDC-024 / MDC-034 / MDC-043

**`phase3-new-geometry-and-material-contract`: append-only design decision.**
Preserve the entire accepted **122260-byte** prefix, SHA-256
`690de46c35135a846d08938cf79b7c85d4a045e0e1df607f2c20b8148b7c122b`,
identified by the dispatch baseline. This addendum supersedes only the mistaken
permissions/claims identified below; all other APIs, preservation requirements,
failure receipts and prior decisions remain. No implementation or acceptance
is performed by this document.

### Six missing geometry names; exact DOM behavior

Current sources/tests and original/final receipts were inspected, not merely
their disposition labels. `phase3-workspace-header-checks.log` retains **two**
geometry candidates and two token reviews; its six tests do not clear scan1.
`phase3-command-palette-frame-checks.log` and final
`phase3-command-palette-frame-attempt-2-checks.log` retain **four frame geometry**
candidates within ten total candidates/53 token reviews. Final2's 85 tests,
lint and scoped typing do not clear scanner failure or other owners' findings.
Read-only installed config resolution proves all six names and exact equivalents
absent; dock-header minimum height is not fixed workspace-header height.

Approve precisely these additions to `web\tailwind.config.js` `theme.extend`:

| Exact current owner/site | Map key = exact value | Replacement and generated declaration |
| --- | --- | --- |
| `web\src\components\layout\WorkspaceHeader.tsx:42`, `h-[4.5rem]` | `height['workspace-header'] = '4.5rem'` | `h-workspace-header`; `height: 4.5rem` |
| Same :42 balanced tracks | `gridTemplateColumns['workspace-header'] = 'minmax(0,1fr) minmax(18rem,22rem) minmax(0,1fr)'` | `grid-cols-workspace-header`; exactly that `grid-template-columns` |
| `web\src\components\ui\CommandPalette.tsx:1224`, backdrop | `zIndex['command-palette-backdrop'] = '200'` | `z-command-palette-backdrop`; `z-index: 200` |
| Same :1241, positioner | `zIndex['command-palette-positioner'] = '201'` | `z-command-palette-positioner`; `z-index: 201` |
| Same :1241, vertical padding | `padding['command-palette-viewport'] = 'max(2rem,8vh)'` | `py-command-palette-viewport`; only `padding-top` and `padding-bottom: max(2rem,8vh)` |
| Same :1257, dialog cap | `maxHeight['command-palette'] = '84vh'` | `max-h-command-palette`; `max-height: 84vh` |

Register suffixes at existing `web\src\lib\cn.ts` groups `h`, `grid-cols`,
`z`, `py` and `max-h`, respectively; add both layer suffixes to `z`.
No generic spacing role, `tokens.ts` wrapper, CSS variable or breakpoint is needed.
Prove both-order last-conflict-wins with ordinary/arbitrary same-property classes
and matching variants; `py` must retain existing directional padding conflict
semantics against `p`/`pt`/`pb`, not erase horizontal padding. Distinct properties
and variants coexist. Generate no extra declaration or importance.

WorkspaceHeader remains hidden below xl, a balanced three-track grid at xl,
with existing equal side tracks, bounded search, range/vehicle ownership,
breadcrumbs/utilities, gutters and caption. Height stays fixed rem-based
(72/90px at 16/20px roots), not a growing minimum or doubled font scale.
CommandPalette keeps its current viewport-centered, top-anchored positioner,
backdrop click-out, pointer-events split, independent overflow, 84vh dialog cap,
focus/combobox/listbox/Escape semantics and reduced-motion branches. Keep `vh`,
not `dvh`; keep both padding bounds and layer ordering 200 < 201 in existing
stacking contexts. Do not migrate it to Modal or imply cross-context priority.

### RoutePlayback: data identity, not vehicle material or health

`phase3-route-playback-checks.log` retains scanner1 and six exact current tuples:
**173:17 `#22d3ee`, 174:18 `#00b4d8`, 373:25 and 374:29 `#10b981`,
385:25 and 386:29 `#ef4444`**. The raw original receipt uses defaults at
:176–177 and endpoints :375–376/:387–388; current coordinates are not originals.
The first pair initializes `trailColor`/`markerColor`; the next pairs are
start/end `CircleMarker` stroke/fill, not success/failure telemetry. The trail
is a historical route path, not physical vehicle paint. Explicit caller paint
still overrides defaults. Approve an intentional default presentation change,
not an assertion that old and new colors are identical:

| Existing source use | Reuse exact existing role | Intended renderer |
| --- | --- | --- |
| Trail default and Polyline :366 | `chartTokens.series[0]` = `light-dark(#385e7e, #91b4d2)` | Leaflet path: current default SVG; concrete resolved paint also required for Canvas |
| Playback-position default passed to AnimatedMarker :396 | `var(--semantic-info)` | AnimatedMarker's actual DOM DivIcon background; replay position, never confirmed live/online |
| Start stroke/fill :373–374 | `chartTokens.series[1]` = `light-dark(#38614f, #91b9a5)` | SVG/Canvas endpoint identity, not success |
| End stroke/fill :385–386 | `chartTokens.series[3]` = `light-dark(#83464e, #d6a0a5)` | SVG/Canvas endpoint identity, not danger/failure |

Reuse `web\src\lib\tokens.ts`'s actual series, not legacy `COLOR.GOOD/BAD/CYAN`,
new map hex constants or a second palette. Do not introduce a chart-palette
subscription: RoutePlayback currently has none. Theme resolution changes paint
only; points/timestamps/ordering, finite-coordinate filtering, index callbacks,
heading, speed/SOC/power, source trust, timing, seeking and camera remain true.
MapOverviewPage :179–198 derives replay from history and :466 supplies no color
overrides; a replay marker is not the separate current live vehicle marker.
Never color this path by speed, infer health from endpoints, interpolate new
telemetry or turn absent speed/SOC into zero. Preserve SI `formatSpeed` display
and raw callback values. Existing summaries/labels remain; color alone cannot
be accepted as an endpoint distinction.

### Shared browser resolution boundary; no unresolved Canvas paint

RoutePlayback's path paint and GeofenceDrawer's `shapeOptions`/persisted layers
are now two inspected independent consumers. This narrowly supersedes the prior
**“no new shared color helper/token root now”** restriction: approve a pure
browser-boundary helper at existing `web\src\lib\colors.ts`, named
`resolveMapRendererColor(input: string, context: HTMLElement): string | null`,
with directly reserved tests at `web\src\lib\__tests__\mapRendererColor.test.ts`.
It adds no color role, settings/provider, Leaflet dependency or import-time DOM
access. Return a validated concrete computed CSS color or explicit null.
Use the actual mounted map theme context and safe style assignment, never HTML
interpolation. Resolve nested variables and `light-dark()` through the browser;
detect missing/cyclic references and invalid input, rather than accepting an
inherited/default probe color as success. SSR, detached/unavailable context,
absent/throwing computed-style access are unresolved. No black, previous Canvas
paint, hardcoded compatibility color or first-series fallback inside this helper.

Each caller owns fallback intent: valid explicit colors retain their appearance;
an invalid/unresolved override tries only its declared default role. If that
also fails, retain source/controls and expose existing unresolved feedback,
defer paint initialization and retry on mounted theme availability. No hidden
geometry/data failure or fabricated callback. Route resolves its path roles;
Geofence resolves existing `var(--theme-primary)` for draft and persisted shapes.
Theme/custom/mode/forced-colors changes update paint without resetting playback,
drawing/edit state, IDs, handlers or focus. Preserve geofence 2px/0.08 and replay
4px/0.8 trail, 7px endpoint radius/2px outline/full fill. Do not force SVG to
evade Canvas. DOM/SVG variable support alone cannot prove Canvas compatibility.
AnimatedMarker's existing bloom/pulse/white border remains separate source work,
not an authentic-material exception or cleared by passing a restrained color.

### VehicleTwin: split the actual warning caller, not physical turn lamps

The diagnosis's pinned scanner hash
`628d37320b5d98f968edce6d4cd71dd4a9c40b2a2ea1f43af1140944da60cbd8`
matches all **103 tuples**, with **three token reviews** separate. But the
old “99 physical” declaration partition is not a physical-only use permission.
**220:11 `rgba(251,191,36,0.78)` defines `C.amber`**. SideWindows :668 derives
`passengerAlert` from front/rear passenger windows being open/partial; :788 uses
`stroke={C.amber}` on its warning path, including photo mode. This is semantic
warning paint, not amber lens material. Assign **only that caller's stroke**
to existing **`var(--semantic-warning)`**, SVG presentation attribute, while
retaining its predicate/path/width/photo visibility and null/unknown distinctions.
Leave `C.amber` and its physical fill/strokes **:996/:1027/:1043** unchanged,
including existing turn/hazard/entry predicates. Never globally recolor the
constant to repair this warning. Pulse removal remains the separately serialized
body-window-door-feedback scope; warning-role adoption does not authorize it.

Supersede only the physical-only classification of that mixed declaration:
**98 other material-declaration candidates + one mixed C.amber declaration +
one alpha mask + two nonexempt charging paints + one identifier = 103**.
This is accounting, not 98/99/103 renderer acceptance. Preserve every exact
tuple and review its actual caller/branch; no unused material declaration proves
rendered physical use. :521/:546/:876 fallback paint also runs for null, not
only confirmed closed; null must not be labeled closed. The :1245:69 `#000`
mask belongs to **PhotoWheelSpinner**, consumed at :1261/:1262, not PhotoOverlay.
`headlightsActive` is at :947 (`on === true || driveIn`), not source-confirmed
headlights-on for every entry; ChargingUnderglow's actual caller is :1573.
These narrow corrections supersede the earlier misleading owner/state wording.
Reflection sweeps, active-light bloom, :334/:339 underglow, glow-filter consumers
and security rings remain their named successor scopes; optical stops and
physical paint/photo choices stay intact. No blanket waiver or scanner edit.

### Acyclic leases and evidence; failures remain failures

1. **`phase3-new-geometry-tokens`**: after this decision and prior config/test
   lease release, only `web\tailwind.config.js`, `web\src\lib\cn.ts`,
   `web\src\lib\cn.test.ts`, `web\src\lib\__tests__\tokens.test.ts`.
   Exactly six additive entries. Freeze the immediate accepted predecessor;
   preserve every original fingerprint expectation and all accepted 10/19/6
   accounting. Assert exact keys/values before projecting only those additions;
   no hash reset, broad exclusion, deletion or weakened ratchet. Prove generated
   CSS equivalence and merge/variant behavior. No caller prerequisite.
2. After that root, independent **`phase3-workspace-header-geometry-adoption`**
   leases only WorkspaceHeader.tsx/WorkspaceHeader.test.tsx at their existing
   layout owner; **`phase3-command-palette-frame-geometry-adoption`** leases only
   ui\CommandPalette.tsx/ui\__tests__\CommandPalette.test.tsx. Each substitutes
   only its table entries and retains original assertions' behavior intent.
3. Independent **`phase3-map-renderer-color-root`** leases only colors.ts and
   the explicitly reserved mapRendererColor.test.ts after confirming absence
   and prior color-owner release. Then separate **`phase3-route-playback-paint-adoption`**
   leases only maps\RoutePlayback.tsx/maps\__tests__\RoutePlayback.test.tsx;
   existing **`phase3-geofence-canvas-paint-correction`** leases only
   maps\GeofenceDrawer.tsx/maps\__tests__\GeofenceDrawer.test.tsx. Neither waits
   on the other. A resolver root never waits on consumer acceptance.
4. Independent **`phase3-twin-passenger-warning-role-adoption`** leases only
   vehicles\VehicleTwin.tsx/vehicles\__tests__\VehicleTwin.test.tsx, restricted
   to the :788 ink plus additive branch/physical-preservation tests. After its
   verified proof/release, read-only original-ink reconciliation can proceed;
   keep the existing serialized reflection -> body-window-door -> light ->
   charge/security chain, never simultaneous source or matching-test writers.
5. Separate read-only **`phase3-new-geometry-browser-proof`** follows geometry
   adoptions; **`phase3-map-renderer-browser-canvas-proof`** follows resolver
   and map adoptions; **`phase3-twin-warning-browser-contrast-proof`** follows
   warning adoption. Each owns evidence only, not source or scanner. Verify
   actual composed tiles/path/marker/endpoint contrast, resolved SVG and real
   Canvas rendering/theme refresh, and warning/photo-versus-lamp distinctions.
   Record mounted geometry/scroll/focus at mission widths, 16/20px roots,
   200% text, RTL, dark/light/custom/forced-colors and reduced motion.

All roots/adoptions need exact fresh hashes, immutable originals, authorized
guarded scoped tests/lint/typing/preservation and unchanged scanners retaining
all findings. Original final2 and other failed deliveries stay **FAILED** until
true post-root verification and orchestrator reconciliation; not a generic
third attempt, renewed whole-file migration or historical status rewrite.
Static review, mathematical contrast, jsdom map stubs/canvas mocks and test
counts are not browser/Canvas/device/native acceptance. Missing authorized
runtime evidence is BLOCKED/NOTRUN, never invented. No dependency points back
from a root to its caller or to final composite acceptance.

Raw commands, original/current hashes, role declarations, failure recovery and
missing evidence are recorded in
`.agent-status\receipts\phase3-new-geometry-and-material-contract-checks.log`.
This docs-only append runs no UI changes, scanner changes, application TypeScript,
tests/lint/build, docs build, browser/device/backend gates, installs or Git.
Only prefix/document/source evidence is verified here; implementation and actual
composed acceptance remain pending.

## Annotation create retention and completion ownership — MDC-024 / MDC-026 / MDC-034

**`phase3-annotation-create-retention-contract`: append-only lifecycle decision.**
Preserve the accepted **136562-byte** prefix, SHA-256
`3ca4d611f5764ed77245f2c2825c490f1dc740cc40504c858b8735b96738f146`,
from `phase3-annotation-create-retention-contract-dispatch-baseline.json`.
Prior documentation ownership is released/accepted at **8f10b35583**.
This does not reopen that geometry/material decision, migrate presentation again,
or claim asynchronous correctness from a styling/test-oracle acceptance.

### Actual defect; a toast is not draft recovery

Bounded source inspection shows `AddAnnotationPopover.tsx:86–89` validates time,
calls void `onAdd`, then immediately clears label and resets category.
`ChartContainer.tsx:379–396` uses `createMutation.mutate` at :384–391 and closes
at **:392**, before network success. `useAnnotations.ts:115–128` already owns
the real POST `/annotations`, success invalidation/broadcast and deferred
success/error toast. Its error toast cannot restore a discarded form.
The accepted popover source/oracle (`5df8b2d602`, Escape target `c45ab96610`)
preserves original synchronous behavior; neither accepts failed-create retention,
parent-controlled dismissal or composed focus restoration. Keep those historical
receipts and original cases intact; add lifecycle cases, not replacement oracles.

### Smallest backward-safe public contract

Extend the existing popover **in place**, retaining the positional arguments and
their types/defaults: `onAdd(...) => void | Promise<void>`. Add only optional
`onAdded?: () => void`, a success notification, not a second mutation callback.
The popover owns its local pending/error state and draft; the caller owns actual
creation, contextual identity and controlled open/close. No new overlay engine,
generic mutation wrapper, annotation store, public pending prop or hook is needed.
This corrects an existing create lifecycle, not a speculative component family.

- A nonthrowing synchronous `void` callback remains immediate local acceptance:
  preserve its existing validation, argument trimming/defaults and reset behavior,
  then notify `onAdded` once if supplied. Existing synchronous callers need not
  adopt the optional notification. A synchronous throw is failure, not acceptance.
- A promise-returning callback is pending until it fulfills. For ChartContainer,
  it must be an `async` adapter awaiting **`createMutation.mutateAsync(input)`**
  and returning void afterward. Do not return `mutate`, detach the promise,
  catch-and-resolve, or translate network rejection into successful void.
  Invalid/missing capability, config or occurred-at must reject before mutation,
  not return a success-shaped no-op. Keep the existing form validation first.
- Only fulfillment for the current live attempt permits clearing label,
  description, category/date defaults as originally applicable and calling
  `onAdded`. ChartContainer closes through that notification, never at dispatch
  or in `finally`; explicit idle Cancel remains a separate discard action.
  Local completion callbacks are not network operations: a notification exception
  cannot relabel an already confirmed save as a rejected create or cause retry.
- Catch a genuine rejection at the form boundary, release pending and keep the
  visible draft byte-for-byte as entered (including whitespace), original chosen
  category, optional description and manual date/time. Retry uses current edited
  fields after existing validation. Never reset fields in catch/finally.
  The submitted trimmed payload is separate from the retained editable draft.
- Show persistent standard localized operation-error/retry feedback associated
  with the form; announce it once and leave the real controls editable.
  Retain the hook's actual standard deferred error toast and success-only
  invalidation/broadcast. Do not swallow, replace or duplicate its global toast.
  Inline recovery feedback is not another toast, fake success or invented row.

### Pending, dismissal, focus and identity races

Set a synchronous in-flight latch **before** invoking `onAdd`; React rendering
alone does not prevent rapid click/Enter duplication. Exactly one call per form
attempt; no automatic UI retry, optimistic annotation or offline queue.
While pending, keep the draft visible, announce busy through existing Button/form
semantics and disable Add and field changes so success cannot erase newer edits.
After rejection, all fields become editable again without leaving the dialog.

Pending Cancel, Escape, backdrop and close requests are intentionally blocked:
they neither discard the draft nor claim to cancel an in-flight POST. Keep the
controls' disabled/busy semantics and explanatory localized feedback reachable;
consume Escape through the real focused mounted-dialog path without leaking it
to an outer overlay. Preserve Tab/Shift+Tab behavior and avoid a new focus trap.
When idle/rejected, Cancel/Escape retain their existing explicit discard/reset
and single onCancel behavior; no onAdd/onAdded occurs. Distinguish explicit
discard from unsuccessful persistence, including accessible wording.
No new confirmation dialog or backend abort capability is assumed.

Focus stays within the current form while pending/rejected; do not restore the
chart trigger on failure or steal focus on every retry. Success or explicit
idle dismissal restores the existing trigger once through the current overlay
owner, only if it is still connected and in the same chart/context. A removed
trigger uses the existing safe focus fallback. Never focus a disposed element
or a newly opened popover on an old attempt's completion.

Each attempt captures immutable vehicle ID (including existing null semantics),
annotation scope, occurred-at and chart/popover instance identity. Use a local
monotonic generation/ref and disposal guard, not timestamps as identity or a
new persisted annotation ID. Compare the captured identity before every local
settlement/reset/close/focus effect. A changed vehicle/scope invalidates the old
completion's authority over current UI, not its actual server/cache outcome.
Do not retarget a submitted payload or silently submit its draft to the new scope.

Keep an open form's original context and draft across an external vehicle/scope
change; do not key-remount or clear it. If pending, await settlement but do not
close/clear on stale completion; show the real outcome for the original target.
If that outcome is confirmed success, mark the original attempt saved and disable
resubmission of that payload: offer explicit dismissal/start-new-context instead
of a duplicate retry. On rejection retain the original draft and editable fields;
retry is enabled only after the original target/capability is current again.
Existing context labels identify the original target without exposing new data.
No target change happens merely because a range, vehicle or hook object rerenders.

A request to open another popover while this one is pending is deferred/refused,
not an implicit cancellation; the current visible draft remains. After settlement,
starting a new instance requires explicit dismissal of the retained old form.
An old promise can never release a new instance's latch, clear its error/draft,
call its onAdded, close it or move its focus. Actual server success still uses
the existing cache/broadcast/toast policy for the original target.

Unmount disposes local completion/focus authority without firing discard/reset
or claiming request abortion. Ordinary rerenders and context changes must not
unmount the retained form. Forced full chart/route teardown ends volatile local
form ownership; this API does **not** promise persistence across navigation,
reload or process death. Do not describe such teardown as successful saving or
recovered draft. If mounted-flow acceptance requires recovery across full
teardown, report a precise separately owned navigation/draft-retention blocker;
do not add storage, change shell/routing or fabricate that guarantee here.

### Separately leased roots and exact integration order

| Proposed item / role | Exclusive write scope | Exact prerequisites and limits |
| --- | --- | --- |
| `phase3-annotation-popover-async-lifecycle` / shared root | `web\src\components\charts\AddAnnotationPopover.tsx`; `web\src\components\charts\AddAnnotationPopover.test.tsx` | This contract; accepted `phase3-add-annotation-popover` and `phase3-annotation-escape-test-target`; verified release of both files. Extend callback/optional success notification, latch/error/retention and pending dismissal only. No ChartContainer/hook/catalog writes and no dependency on consumer acceptance. |
| `phase3-annotation-create-retention-integration` / caller integration | `web\src\components\charts\ChartContainer.tsx`; `web\src\components\charts\__tests__\ChartContainer.test.tsx`; `web\src\components\charts\__tests__\ChartContainer.a11y.test.tsx` | Accepted/released async popover root and this contract; preserve all existing `phase3-chart-container` prerequisites listed below. Wire mutateAsync, guarded success-only close and contextual lifecycle; lease this exact source/test trio separately, never concurrently with final ChartContainer migration. |
| `phase3-annotation-create-retention-browser-proof` / evidence only | Own receipt/heartbeat only; existing authorized QA tools read-only | Accepted/released root and caller integration. Mounted real error/success/dismissal/focus/context proof; no production mutation or source changes. Lack of authorized safe test environment is BLOCKED/NOTRUN. |

The existing ChartContainer prerequisite set remains exactly:
`phase3-add-annotation-popover`, `phase3-annotation-list`,
`phase3-chart-export-menu`, `phase3-chart-hidden-series-context`,
`phase3-empty-state`, `phase3-query-error`, `phase3-section-error-boundary`,
`phase3-table`, `primitive-button`, `primitive-typography`.
Keep its actual HeaderFilter/SectionErrorBoundary failure/reconciliation evidence;
queue labels or old source-ready receipts cannot silently unblock it.
Add the async root to final ChartContainer dependencies. If the lifecycle trio
is leased before final modernization, verify it and release all three files
before final dispatch; final integration must preserve its accepted behavior.
No cycle from the root back to ChartContainer or browser acceptance is permitted.

**No hook/API root is currently needed:** the inspected hook is already a
TanStack mutation and exports the real request/error/success lifecycle.
`mutateAsync` is the existing mutation API, not a backend or hook expansion.
If a future bounded test proves a necessary hook defect, reserve a distinct
`phase3-annotation-create-hook-lifecycle` lease only at
`web\src\api\hooks\useAnnotations.ts` plus an explicitly confirmed/reserved matching
hook test; then add its acceptance before caller integration. Preserve endpoint,
input/response types, error rejection, keys, invalidation/broadcast and toast
ownership. No router/backend/type/config expansion is authorized by this decision.

Reuse actual existing add/cancel/category/date/success/error labels and standard
pending/error feedback owners. A labels/catalog root is conditional on proving
a genuinely missing key for this exact lifecycle: separately lease canonical
`web\src\i18n\en.json` and only its established generated namespace outputs,
with exact keys/output paths frozen before dispatch; never mass-edit catalogs.
Only a consumer requiring those keys depends on that accepted root. No assumed
missing label, generator repair, fallback-only localization or tests silencing
real catalog startup failures. This document supplies no catalog permissions.

### Concrete acceptance cases; negative results stay negative

Popover tests retain every original synchronous case and genuine focused-input
Escape oracle. Add controlled deferred-promise cases: pending fields unchanged,
busy/disabled semantics, rapid click plus Enter invokes once, no onAdded before
settlement; rejection retains every field/category/date and visible real error;
edited valid retry sends the new normalized arguments and clears/notifies once
only after fulfillment. Synchronous throw retains fields; synchronous void
retains immediate valid legacy reset; empty label/invalid time never submits.
Pending Cancel/Escape/backdrop cannot discard; rejected idle dismissal resets,
calls onCancel once, never calls onAdded. Test successful completion separately
from explicit cancellation, including notification failure without a second POST.

Caller tests must exercise the actual promise-returning adapter and real hook
error path using the existing bounded request-test interception, not mocked
`mutate` acceptance. Assert rejected POST leaves the mounted form open/editable,
no success toast/clear/close, standard error feedback, no fabricated list row
or success invalidation; successful POST sends the exact original vehicle,
scope/title/category/description/occurred-at payload, closes once after response,
and preserves real success invalidation/broadcast/toast and list reconciliation.
Include missing capability/config rejection, double submit, pending dismissals,
rejection then edited retry, scope/vehicle change during pending/rejected state,
stale success shown as saved without duplicate retry, refused new-popover request,
unmount/remount before resolve/reject and no stale local reset/close/focus effects.
Verify actual existing trigger focus on valid success/idle cancel and retained
form focus on failure. Do not dispatch Escape to document outside the supported
dialog path or replace the real network error with a resolved fake promise.

Preserve manual add, click-derived and manual timestamps, existing normalization/
timezone behavior, IDs/preferences, source/user state and annotation filters.
All source series/points/axes/gaps/zoom/brush/legend/export/fullscreen/accessibility
alternatives remain. Preserve SI disk/wire/cache and display-only conversions;
no telemetry repair, synthetic timestamp/measurement, scope broadening, new route
or Phase-48 migration-order change belongs to this work.

Implementation owners record exact fresh source/test fingerprints, immutable
original preservation, authorized normal focused tests, strict owned lint,
scoped typing and unchanged scanners with every remaining finding. Test failures,
catalog startup failures and unsupported runtime are FAILED/BLOCKED, not a passed
suite. Mock/jsdom results do not establish browser focus, network, contrast or
mobile acceptance. Browser proof uses MDC-040–043/060–070 widths/themes/RTL/text
scaling/reduced motion and reachable pending/error actions on actual mounted UI.

This item ships **only this document**. Prefix/full hashes, dependency and role
proofs and actual bounded commands are in
`.agent-status\receipts\phase3-annotation-create-retention-contract-checks.log`.
No UI/hook/backend/tests/catalog/CSS/config edits, Git, installs, nested agents,
application TypeScript/lint/scans/tests/build or browser/network gates run here.
Those gates are **NOTRUN**, not implicitly green; async correctness remains
pending separately leased implementation and genuine acceptance.

## Final shell geometry names and embedded About target — MDC-024 / MDC-030 / MDC-040–043

**`phase3-final-shell-geometry-contract`: additive decisions only.** Preserve
the complete approved **152052-byte** prefix, SHA-256
`2bc690ec400bc1925da1e7369280e6ddd0c12de96367c3b1ca2f15b8c1e3bb59`.
The fresh dispatch baseline and its immutable snapshot were compared against
actual current bytes. No prior heading, decision, geometry/material permission,
failure receipt or accepted mobile height/offset contract is revised here.
Mission §2 remains the single design API; §43 still requires actual mounted QA.

### Two exact naming-only roles; no substitute geometry or layer

Read-only source inspection finds HelpSegment.tsx:176 still uses
`w-[min(92vw,260px)]` and StatusBar.tsx:130 still uses `z-[55]`.
The inspected config/cn maps contain neither exact named role. Approve only:

| Existing owner | Exact `theme.extend` addition | Exact adoption / declaration |
| --- | --- | --- |
| `web\src\components\layout\status-bar\HelpSegment.tsx:176`, Popover width | `width['help-menu'] = 'min(92vw,260px)'` | `w-help-menu`; `width: min(92vw,260px)` |
| `web\src\components\layout\StatusBar.tsx:130`, footer layer | `zIndex['shell-status-bar'] = '55'` | `z-shell-status-bar`; `z-index: 55` |

Register only suffix `help-menu` in existing cn group `w`, and suffix
`shell-status-bar` in group `z`. Width is fixed by the same viewport/pixel
minimum, not a min-width, max-width, rem conversion, growing panel or `dvw`.
Existing `w-recent-pages` is **min(92vw,360px)**; existing
`min-w-background-work` is **260px minimum**. Neither is equivalent.
Existing `z-overlay` is **60**, `z-shell-panel` **80** and palette layers
**200/201**; none replaces **55**. Retain StatusBar 55 > tab bar 50 in their
existing contexts and existing portal/overlay ordering, pointer interception
and shell guard. A numeric z-index does not prove cross-context precedence.
No positioner, portal, stacking context, DOM grouping, safe-area, height,
bottom offset, opacity, paint, focus, motion or functionality change is allowed
by these two names. Reuse existing restrained surface/text/border/semantic
roles; naming does not authorize renewed neon, glow or decorative gradients.

### Minimum serialized token and equivalence proof

`phase3-final-shell-geometry-tokens` follows this root and release of every
prior config/cn/test lease. It owns only `web\tailwind.config.js`,
`web\src\lib\cn.ts`, `web\src\lib\cn.test.ts` and
`web\src\lib\__tests__\tokens.test.ts`: exactly two additive map entries and
two existing merge-group suffixes, no new conflict engine or generic rewrite.
No CSS owner, tokens.ts wrapper, plugin, screen, caller, catalog or scanner
waiver is needed. Freeze the immediate accepted predecessor and preserve all
original fingerprints/invariants, including the three hashes pinned above and
accepted 10/19/6/six-entry accounting. Assert the two exact keys/values before
projecting only those additions; preserve exact predecessor comparison.
No golden reset, broad exclusion, baseline pruning or deletion of old assertions.
The queue's accepted **930 related cases** are predecessor context, not a fresh
run here; the implementation owner must retain them and run normal guarded proof.

Generate old/new utility CSS with actual installed Tailwind/config for bare,
`md:` and `!` forms (including `md:!`): compare property/value, selector context,
media condition, specificity and importance after class-name substitution.
Bare utilities remain non-important; important variants retain importance.
Require actual exported `cn()` checks, in **both input orders**, for each named
role against its exact old arbitrary class and ordinary alternatives
(`w-64`, `z-50`), plus another arbitrary same-property value. Matching responsive
and important contexts must retain last-conflicting-class-wins; different
breakpoints and important/non-important contexts must coexist as before.
Width versus min/max-width and layer versus positioning remain independent.
Do not infer merge behavior from suffix registration or CSS source order.
Record real command/output and generated declarations; proposed examples,
static reads and historical receipts are not executed equivalence proof.

### Embedded About: distinct mobile source adoption, not child CSS

Help's three directly owned actions already have mobile44 and explicit md36
minimums. Its test mocks VersionSegment; its guarded **16-pass** predecessor
receipt therefore does not prove the real embedded About target. Actual
`VersionSegment.tsx:93` menu branch has
`h-auto min-h-9 w-full min-w-0 justify-start px-3 py-2`: a **2.25rem (36px
at 16px root)** minimum, not the accepted below-md44 allocation.

Separately authorize only that `variant="menu"` button to use
`h-auto min-h-11 min-w-11 w-full justify-start px-3 py-2 md:min-h-9 md:min-w-0`.
Below md its minimum target is **2.75rem (44px at 16px root)**; at >=md
restore exactly the prior **min-h-9 / min-w-0**, auto height and padding.
Do not impose fixed height or truncate/wrap away metadata. Keep existing
`ms-auto`, `break-words`, icon, full labels/version and native button/focus
behavior; `variant="status"` retains its current density unchanged.
The existing RTL assertion of bare `min-w-0` may change only to test the
explicit md restoration and mobile minimum; retain its full metadata/name
and icon assertions. Preserve original **23 + 2 additive cases**, managed
versus local modal state, Enter/Space, version/server/build/dev/unknown fallback,
update/unseen precedence, uptime/provenance, release/changelog links, Escape/
close and service behavior. Add real menu-branch mobile/md presentation tests.
No broad descendant button selector, Help mock workaround, new query/key,
translation, version source, service or shared Button change is authorized.

### Acyclic source scopes and separate acceptance

The orchestrator leases one atomic owner per exact pair, with fresh immutable
originals/current hashes; it does not implement these decisions itself:

1. **This root -> `phase3-final-shell-geometry-tokens` ->**
   **`phase3-help-menu-geometry-adoption`**, only
   `web\src\components\layout\status-bar\HelpSegment.tsx` and adjacent
   `HelpSegment.test.tsx`. Substitute only the width class; retain all
   16 predecessor cases/assertions and cumulative accepted source behavior.
   Final Help owner waits for this pair's verified acceptance/release.
2. **This root + `phase3-mobile-statusbar-frame-root` ->**
   **`phase3-mobile-version-about-touch-adoption`**, only
   `web\src\components\layout\status-bar\VersionSegment.tsx` and adjacent
   `VersionSegment.test.tsx`. Independent of the token/Help naming chain;
   release before offset/browser proof. The parent source-reference freeze
   remains until the sole Resources canonical-copy root is accepted.
3. **Token acceptance + mobile frame pair release -> separately queued
   `phase3-status-bar-layer-adoption`**, only
   `web\src\components\layout\StatusBar.tsx` and `StatusBar.test.tsx`.
   Substitute only `z-[55]` with `z-shell-status-bar`; preserve all accepted
   **24 StatusBar cases**, provider/preferences/announcer, two rows, responsive
   branches, lazy Helix and persistent About ownership. Add exact layer
   assertion without replacing behavior coverage. Final `phase3-status-bar`
   remains a different lease, after this adoption and all its existing
   prerequisites; final Layout remains downstream. No root waits on either.

Existing mobile height -> frame -> touch -> offset-proof -> final composite
ordering remains; add Version's actual menu proof to touch prerequisites,
not a dependency on final Help/StatusBar acceptance. Serialize overlapping
leases and keep other original prerequisites/failures intact. No cycle,
third generic migration, attempt reset or source rewrite is approved.

Naming proof is not measured geometry or mobile acceptance. Separate mounted
QA still covers mission widths and 767/768 transitions, actual viewport/root
font, safe areas, RTL/long text/200% text, row reachability, overlays, native
links, keyboard/focus, dark/light/custom/forced-colors and reduced motion.
44px and 36px above are rem arithmetic at the stated root, not browser
rectangles. Missing authorized browser/device evidence is BLOCKED/NOTRUN.
This item changes only this document; raw original/prefix/full hashes, real
paths and acyclic-scope proof are in
`.agent-status\receipts\phase3-final-shell-geometry-contract-checks.log`.
UI/source/config/CSS/catalog/import/tkey/source-reference writes, Git, nested
agents, installs, application tests/lint/TypeScript/build and browser gates
are **NOTRUN** here. No docs-only gate or implementation acceptance is claimed.
