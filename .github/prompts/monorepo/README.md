---
description: "Monorepo Native Apps — master plan for porting TeslaSync web to fully-native Windows / Android / macOS / iOS at full parity"
---

# monorepo — TeslaSync Native Apps (Windows · Android · macOS · iOS)

## What this is

The **architecture and execution plan** for porting the TeslaSync **web SPA** to
**fully native** applications on four platforms, at **pixel / panel / API parity**
with the web app:

| Platform | UI framework | Language | Design language |
|---|---|---|---|
| **Windows** | WinUI 3 (Windows App SDK 1.6+) | C# / .NET 10 LTS | Microsoft **Fluent** |
| **Android** | Jetpack Compose | Kotlin 2.2.x | Google **Material 3 (Expressive)** |
| **macOS** | SwiftUI | Swift | Apple **HIG** |
| **iOS / iPadOS** | SwiftUI | Swift | Apple **HIG** |

A **Kotlin Multiplatform (KMP)** shared core holds all non-UI logic for Android +
Apple. Windows consumes the same wire contract via a generated **C# client**. The
**Go API is the backend for all four** and is *not* rewritten — the native apps are
first-class clients of `/api/v1/*` + SSE.

> This mirrors the proven structure of `.github/prompts/db-refactor`: **phases →
> prompts**, an **ADR** layer, an inlined **Honesty Covenant**, structured logging,
> and machine-checkable **gates**. The one addition unique to this effort is a
> **parity gate**: every UI prompt is graded against the canonical web-parity
> manifest produced in P1.

## What this is NOT

- **Not** a WebView wrapper. Tauri / Electron / Capacitor / Cordova are explicitly
  rejected (see ADR-002). Every screen is real native UI.
- **Not** a cross-platform UI framework. Flutter / .NET MAUI / React Native /
  Compose-Multiplatform-UI are rejected for the **UI layer** (ADR-002). KMP is used
  for **shared logic only**.
- **Not** a backend rewrite. The Go API, TimescaleDB schema, MQTT pipeline, and
  SI-canonical contract stay as-is.
- **Not** a "ship it in a sprint" plan. This is a multi-month, multi-program effort.
- **Not** a place for new product features. Parity first; net-new features get their
  own tickets after parity is reached.

---

## Why fully native (the one-paragraph rationale)

The user mandate is a *flawless, platform-idiomatic* experience on every OS, with
resources no object, optimized for the long term. Cross-platform UI frameworks each
trade away platform fidelity and add **single-vendor framework risk** (a stalled
framework forces a full rewrite). Fully native bets only on Apple / Google / Microsoft
maintaining their own first-party toolkits — the safest long-term bet — while a KMP
core + OpenAPI contract removes the usual "3× the logic" cost by sharing everything
that does not draw pixels. Full reasoning in **ADR-002**.

---

## The five programs

| # | Program | Output | Depends on | Ships? |
|---|---|---|---|---|
| **P0** | Foundation & Governance | ADRs, methodology, repo scaffold, CI matrix, toolchain + version locks | — | ❌ Docs/scaffold |
| **P1** | Shared | parity manifest, OpenAPI contract, codegen, KMP core, design tokens, shared tests | P0 | ⚠️ Library only |
| **P2** | Windows (WinUI 3) | Native Windows app at full parity | P1 | ✅ MSIX / Store |
| **P3** | Android (Compose) | Native Android app at full parity | P1 | ✅ AAB / Play |
| **P4** | Apple (SwiftUI) | Native macOS + iOS/iPadOS apps at full parity | P1 | ✅ .app / App Store |
| **P5** | Hardening & Release | e2e, perf, a11y, l10n, store submission, GA | P2–P4 | ✅ GA |

Build order per user mandate: **P1 Shared → P2 Windows → P3 Android → P4 Apple**.
P2/P3/P4 may overlap once P1 is frozen, but each platform's first prompt depends on
P1 being `STATUS=DONE`.

---

## Directory structure (this folder)

```
.github/prompts/monorepo/
  README.md                      ← you are here
  0000-methodology.prompt.md     ← inlined safeguards + Honesty Covenant for this effort
  adrs/                          ← ADR-001 … ADR-016 (binding architecture decisions)
  logs/                          ← execution logs (one per prompt, *.log)
  parity/page-units.json         ← canonical list of routed web pages (drives page prompts)
  p0-foundation/                 ← P0 prompts (NN-*.prompt.md) + README
  p1-shared/                     ← P1 phase index + prompts; S8/ = one state-holder prompt per web hook domain
  p2-windows/                    ← P2 phase index + infra prompts; pages/<feature>/<Page>.prompt.md = one per web page
  p3-android/                    ← P3 phase index + infra prompts; pages/<feature>/...
  p4-apple/                      ← P4 phase index + infra prompts; pages/<feature>/...
  p5-hardening/                  ← P5 phase index + prompts
```

## Prompt inventory (materialized — these are real on-disk prompts, not a backlog)

| Set | Count | How produced |
|---|---|---|
| Per-page parity prompts | **429** | one per real web page (143) × 3 platform tracks (Windows/Android/Apple); each is page-specific — real hooks, panels, chart types, **named-panel enumeration where titles exist in source**, panel count, and i18n keys extracted from the actual `.tsx` source. Discovery cross-checked against `web/src/__tests__/lazyRoutes.list.ts` — **all 124 lazy-routed pages present**, plus 19 sub-pages reached via wrapper/nested routing. |
| Per-dashboard-widget parity prompts | **354** | one per `features/dashboard/widgets/*Widget.tsx` (117 + 1 suffix-less `RecentlyUnlockedAchievements`) × 3 platforms; canonical registry metadata extracted from `widgets/registry/*.ts` (id, display name, default/min/max grid size, category); hooks + shared components + chart/map usage + i18n keys extracted per-widget. |
| Widget-primitive prompts | **39** | one per `WidgetShell.tsx` + `widgets/shared/Widget*.tsx` (13) × 3 platforms — the composable building blocks every widget uses (BigNumber, GaugeHero, FlowDiagram, EventFeed, etc). |
| Modal / dialog / sheet / drawer / popover prompts | **93** | one per overlay surface (31) × 3 platforms — focus-trapped, dismiss-aware, native overlay primitives per platform HIG. **Doubled** from earlier round after audit found 16 overlays in `components/**` (ReauthDialog 621 LOC, NotificationBellPopover 538 LOC, FeedbackModal, JobProgressDrawer, etc.). |
| Feature-view prompts | **924** | one per meaningful `features/*/components/**/*.tsx` + 11 promoted `features/**/pages/` siblings that aren't `*Page` defaults but are substantive (308 total) × 3 platforms — sub-page composed views like `AlertStudioPage` (2,343 LOC), `ActionBuilder`, `TriggerConfigurator`, `AlertDetailTimeline`, automation rule editors, settings panels, chart wrappers, etc. Atomic helpers (<30 lines and no hooks) excluded — they stay bundled in the platform component-library prompt. |
| Shared meaningful surface prompts | **705** | one per `components/**/*.tsx` that is ≥80 LOC OR uses ≥1 hook (235 surfaces) × 3 platforms — cross-feature UI like the entire `components/ai/**` suite (AIFeedbackQueueTriage, AICrossRuleConflictDetection, AIGeofenceAwareAutomationSuggestions, AIFeatureCard at 339 LOC), `components/feedback/*` (ChangelogModal, FeedbackModal, SessionExpiringModal), `components/layout/*` (Sidebar, NotificationBellPopover, TopBar), `components/a11y/*` (RouteAnnouncer, VisuallyHidden), `components/charts/*` (chart overlays + annotation popovers), etc. **Added in round 2.5** after audit found 235 non-atomic shared components that were wrongly bundled in the first round. |
| Misc surface prompts (provider/launcher/lib-level) | **9** | one per orphan surface (3) × 3 platforms — `TourLauncher` (onboarding tour), `globalShortcuts.tsx` (lib-level keyboard layer), `selectedVehicle.tsx` (provider with UI). |
| Shared state-holder prompts (P1/S8) | **59** | one per real web API-hook domain (`web/src/api/hooks/*.ts`), listing that domain's actual exported hooks to port |
| Foundation prompts (P0) | **12** | hand-authored governance/scaffold/CI/toolchain |
| Shared-core phase prompts (P1/S0–S12,S99 excluding S8) | **15** | hand-authored |
| Platform infra phase prompts (P2/P3/P4 scaffold + theme + components + nav + auth + data + live + push + polish + tests + gate) | **54** (18 each) | agent-authored |
| Hardening phase prompts (P5: H0..H9, H99) | **11** | hand-authored |
| **TOTAL prompt files on disk** | **2,705** | — |

**Per-program totals:**

| Program | Prompts | Notes |
|---|---|---|
| Foundation (top-level methodology) | 1 | `0000-methodology.prompt.md` |
| P0 Foundation & Governance | 12 | repo scaffold, ADRs, CI, toolchain, version lock |
| P1 Shared core (incl. 59 S8 state-holders) | 74 | OpenAPI, codegen, KMP, networking, SSE, units, auth, cache, tokens, i18n, diagnostics, tests, gate |
| P2 Windows (18 infra + 143 page + 118 dashboard-widget + 13 widget-primitive + 31 modal + 308 feature-view + 235 shared-meaningful + 3 misc) | 869 | WinUI 3 / .NET 10 / C# |
| P3 Android (18 infra + 143 page + 118 dashboard-widget + 13 widget-primitive + 31 modal + 308 feature-view + 235 shared-meaningful + 3 misc) | 869 | Compose / Material 3 / Kotlin |
| P4 Apple (18 infra + 143 page + 118 dashboard-widget + 13 widget-primitive + 31 modal + 308 feature-view + 235 shared-meaningful + 3 misc) | 869 | SwiftUI / HIG / macOS + iOS adaptive |
| P5 Hardening | 11 | parity reconcile, e2e, perf, a11y, l10n, push, security, observability, store, rollout, GA gate |

**Page-level coverage honesty (no overclaiming):**

- **143 real pages covered** = every `web/src/features/**/pages/*.tsx` that has either a `usePageTitle`, a `<PageContainer>`, an in-file `*_PATH` constant, or an App.tsx route. This includes 6 pages that are NOT routed from `App.tsx` (e.g. `SystemPage`, `UsersPage`, `LiveLogsPage`, `RbacMatrixPage`, `DiagnosticPage`, `HelpPage`) — their route is resolved from in-file `*_PATH` constants or noted as `(unrouted)` with a flag telling the implementer to wire it into the matching native nav location.
- **9 files excluded** that live under `features/**/pages/` but are sub-components (`ActionBuilder`, `ConditionBuilder`, `TriggerConfigurator`, `PresetGallery`, `ConflictWarnings`, `AutomationActivityFeed`, `AutomationCard`, `ScheduledExportsPanel`, `TeslaChargingSessionsMap`) — they have no `export default function …Page`, no `usePageTitle`, no `<PageContainer>`. They're composed inside their parent page prompts.
- **Panel enumeration:** **136 of 143 pages (95.1%) have ≥ 1 explicitly named panel** in their prompt with the source i18n key. Extraction covers `<ChartContainer title=>`, `<FormSection title=>`, `<SectionErrorBoundary>`, `<SectionTitle>`, `<PanelTitle>`, `<PageHeader title=>`, `<h1..h4>` (including `<Icon /> + literal` and `<Icon /> + {t(...)}`), `<span className="font-semibold">`, tab object literals `{ key, label: t(...) }`, and t(...) calls anywhere inside a heading. **1,651 panel titles** named in total. **62 pages have at least one delegated feature component followed** (page → `<XxxComponent />`) and its facts merged into the parent prompt; story-pattern containers (e.g., `SlideRenderer`) follow sibling `*Slide.tsx` files. The remaining **7 anonymous-panel pages** are: `ApiPlaygroundPage`, `QuickStatsPage`, `HelpPage`, `LiveSignalMonitorPage`, `SignalGapDetectorPage`, `TirePressurePage`, `WatchFacePage` — their prompts include the total region count + every delegated component + an explicit directive: _"open the web source and every delegated component listed above and reproduce every region in the same data + grouping + order"_, gated by the PARITY_REQUIRED counter.

**On "each pixel" — be honest about what a prompt can encode:**

Pixel-perfect screen reproduction isn't a prompt-level deliverable. The chain that delivers it is:
1. **Design tokens (P1/S9)** lock colors, spacing, type ramps, shadows, radii to the same numeric values the web app uses.
2. **Component library mappings (W2/A2/P2)** ensure every shared web component has a native equivalent with the same anatomy + props + states.
3. **Per-page prompts** name every data source, every shared component, every chart type, every titled panel + region count, every state, every i18n key.
4. **PARITY_REQUIRED gate** + **placeholder scan (ADR-011)** mechanically refuse to mark a page DONE until every region is implemented.

What the prompts CANNOT magic up: titles that simply don't exist in the source (an anonymous `<GlassPanel>` with a sibling label is what it is). Those are explicitly flagged for the implementer rather than glossed over.

> The Apple page set is **adaptive** (one SwiftUI implementation satisfies both the
> `apple-macos` and `apple-ios` parity ledgers), so the 429 page prompts cover all four
> shipping platforms. Every page prompt enumerates its `PARITY_REQUIRED` count and must reach
> `PARITY_COVERED == PARITY_REQUIRED` plus a clean placeholder scan before it can log `STATUS=DONE`.

## .tsx surface coverage (after round-2.5 audit & expansion)

Driven by the principle **"every `.tsx` that renders UI gets its own per-platform prompt"**:

| Surface tier | Web .tsx files | Per-platform prompts (×3) | Source of truth |
|---|---:|---:|---|
| Pages | 143 | 429 | `features/**/pages/*.tsx` + App.tsx route map + `lazyRoutes.list.ts` |
| Dashboard widgets | 118 | 354 | `features/dashboard/widgets/*Widget.tsx` + `RecentlyUnlockedAchievements.tsx` + `widgets/registry/*.ts` |
| Widget primitives | 13 | 39 | `widgets/shared/Widget*.tsx` + `WidgetShell.tsx` |
| Modals / dialogs / sheets / drawers / popovers | 31 | 93 | `**/*(Modal\|Dialog\|Sheet\|Drawer\|Popover).tsx` — covers feature dirs AND `components/**` |
| Feature views | 308 | 924 | `features/*/components/**/*.tsx` (filtered to JSX + hooks-or-≥30-lines) + 11 substantive `features/**/pages/` non-`*Page` siblings |
| Shared meaningful surfaces | 235 | 705 | `components/**/*.tsx` with **≥80 LOC OR ≥1 hook** — all of `components/ai/**`, plus `components/feedback/*`, `components/layout/*` chrome, `components/a11y/*`, etc. |
| Misc surfaces | 3 | 9 | `TourLauncher.tsx`, `globalShortcuts.tsx`, `store/selectedVehicle.tsx` |
| **Total per-unit surface prompts** | **851** | **2,553** | |
| Atomic shared components (`components/**`, <80 LOC + 0 hooks) | 54 | bundled in W2/A2/P3 component-library prompts | Button/Input/Badge/small Card variants/etc — design system. A native `Button` is a single token/style mapping, not a per-file native implementation. |
| Tiny feature helpers (<30 LOC + 0 hooks) | 8 | bundled in parent feature-view prompts | `constants.tsx`, `MiniStat.tsx`, `StatBox.tsx`-class helpers |
| Type-only / barrel files | 7 | 0 | Files with no JSX render path (`ErrorBoundary` re-exports, sidebar manifests, etc.) |
| App / main bootstrap | 2 | covered by P0/P2/P3/P4 infra scaffold prompts | `App.tsx`, `main.tsx` |
| **Grand total .tsx accounted** | **925** | — | — |

**925 .tsx total** across `web/src` (excl. tests/stories). **851 (92%)** have their own per-platform per-unit prompt; **62 (7%)** are bundled in category prompts (atomic primitives + tiny helpers); **9 (1%)** are excluded by design (type-only / barrel / app-bootstrap).

Each surface prompt extracts from the web source: hooks used (`useXxx`), shared components used (`@/components/**`), chart and map usage, i18n keys (`t('key','Label')`), states the surface renders, and panel titles. Dashboard widgets additionally include canonical registry metadata (id, display name, default/min/max grid size, category).

### Round-2.5 audit findings (the honest backstory)

After round-2 emit, an audit script (`audit-skipped.mjs` in session files/) reclassified every `.tsx` independently and found four real gaps that earlier rounds had glossed over:

1. **236 `components/**` files were wrongly bundled as "atomic"**. Files like `AIFeedbackQueueTriage` (146 LOC, 4 hooks), `ReauthDialog` (621 LOC, 17 hooks), `NotificationBellPopover` (538 LOC, 25 hooks), `AIFeatureCard` (339 LOC) are not atomic primitives — they're full composed surfaces with real business logic. Now per-unit (235 shared-meaningful prompts × 3).
2. **16 modals/dialogs in `components/**` were missed** by the earlier modal regex that only walked `features/**`. Modal count corrected from 15 → 31.
3. **4 substantive files in `features/*/pages/` were excluded** because they don't have a `*Page` default export — including `AlertStudioPage.tsx` at 2,343 LOC. Now promoted to feature-view tier.
4. **4 orphan surfaces** weren't matched by any tier regex: `RecentlyUnlockedAchievements` (a registered dashboard widget without the `Widget` suffix), `TourLauncher`, `globalShortcuts.tsx`, `selectedVehicle.tsx` (a provider that renders UI).

These are now all covered. The audit script is committed alongside the emitter so the same check can re-run anytime a new web `.tsx` is added.

## Target repo structure (what the prompts build)

```
teslasync/                       ← existing repo (monorepo)
  internal/  cmd/                ← Go backend (unchanged)
  web/                          ← existing React SPA (parity source of truth; kept)
  api/openapi/                  ← NEW: generated OpenAPI 3.1 spec of the Go API
  apps/                         ← NEW
    shared/                     ← KMP: contract clients, models, net, SSE, units, auth, cache, presentation
    design/                     ← cross-platform design tokens + per-platform mapping (Fluent/Material/HIG)
    windows/                    ← WinUI 3 (.NET 10) solution
    android/                    ← Jetpack Compose (Gradle) project  → depends on :shared
    apple/                      ← SwiftUI Xcode workspace (macOS + iOS) → consumes shared.xcframework
    parity/                     ← parity-manifest.json + per-platform parity ledgers
```

---

## Parity model (the spine of the whole effort)

The web app is large — **21 feature areas, ~60 API hooks, ~162 page files** plus a
9-category shared component library. Parity is enforced by data, not by vibes:

1. **P1 Phase S0** scans `web/src` and emits `apps/parity/parity-manifest.json`: one
   row per **route**, **page**, **panel/section**, **shared component**, **chart**,
   **map**, **API call**, and **user-visible string**.
2. Every UI prompt in P2/P3/P4 targets **one manifest unit** (e.g. one page or one
   panel) and lists the exact panels/charts/states it must render.
3. Every UI prompt's **parity gate** asserts the implemented screen covers 100% of its
   manifest unit's panels, data sources, loading/empty/error states, and strings.
4. A per-platform **parity ledger** tracks coverage; a program is not `DONE` until its
   ledger shows 100%.

This is what guarantees "**each UI page, each panel, each pixel, each API**" — and
makes "no stubs / no skeletons" a *checkable* invariant (ADR-011).

---

## Architecture Decision Records (read first, in order)

ADRs use the Nygard template (**Status · Context · Decision · Consequences**), are
≤1 page, make **one** decision each, and are **binding** for downstream prompts once
accepted. Changing an accepted ADR requires a superseding ADR.

| ADR | Decision |
|---|---|
| ADR-001 | Monorepo + `apps/` layout (one repo, not many) |
| ADR-002 | Fully-native-per-platform UI; reject WebView + cross-platform-UI frameworks |
| ADR-003 | OpenAPI 3.1 contract generated from the Go API = single source of truth |
| ADR-004 | KMP shared core for Android + Apple; generated C# client for Windows |
| ADR-005 | Design system: cross-platform tokens mapped to Fluent / Material 3 / HIG |
| ADR-006 | Parity specification methodology (web is source of truth; manifest-driven) |
| ADR-007 | Build/release order (Shared → Windows → Android → Apple) + branch strategy |
| ADR-008 | Authentication (Authentik forward-auth) + per-platform secure storage |
| ADR-009 | Live data: SSE strategy per platform + mobile push (FCM/APNs) |
| ADR-010 | Testing strategy + quality gates per platform |
| ADR-011 | Definition of Done: "no stub / no skeleton / polished" made checkable |
| ADR-012 | Technology + version lock (latest, as of 2026-06) |
| ADR-013 | Offline / cache strategy + freshness/staleness contract |
| ADR-014 | Localization (i18n) parity across platforms |
| ADR-015 | Accessibility baseline per platform (WCAG + platform APIs) |
| ADR-016 | Telemetry/observability inside the apps (crash, analytics, logs) |

---

## How to read & run

- Each `pNN-*/README.md` is the **phase index** for that program: ordered prompt list,
  binding rules, and the parity scope it covers.
- Prompts are named `NNNN-slug.prompt.md`, run in ascending order, and declare
  `Depends on` + `Blocks` in their Artifact Metadata.
- Every prompt writes a log to `logs/` and ends with `EXIT=<int>` and
  `STATUS=<DONE|BLOCKED>` on their own lines (see methodology).

## Non-goals (do not sneak these in)

- New product features beyond web parity (separate tickets, post-parity).
- Backend/API changes beyond *adding* the OpenAPI spec + any additive endpoints
  strictly required for a native affordance (must be ADR-justified).
- Replacing TanStack Query / React in the web app.
- Multi-tenant or auth-model changes.
- Shipping Compose-Multiplatform or MAUI UI "to save time."

---

## Status

**Authoring: COMPLETE.** All 1,910 prompts are on disk across P0..P5, each with the
binding Honesty Covenant + Gate + Acceptance + commit trailer + `STATUS=DONE` markers.
No exemplars, no stubs — every page prompt is page-specific (real hooks, real panels,
real chart types extracted from `web/src`), every state-holder prompt is hook-specific,
every infra prompt is platform-specific.

**Execution: not started.** These are planning documents. The multi-month port begins
when P0 is run; subsequent programs gate on the predecessor's `STATUS=DONE`.
