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
