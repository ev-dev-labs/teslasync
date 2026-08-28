# TeslaSync Accessibility Conformance Statement

**Product:** TeslaSync — self-hosted Tesla Fleet Intelligence Platform (React 18 SPA + Go API)
**Target standard:** WCAG 2.1 Level AA
**Statement scope:** the web application served by `teslasync-web` (all routes under `/`), including the standalone `/s/:token`, `/watch`, and `/onboarding` surfaces.
**Evaluation methods:** automated static audits (repository scripts), automated runtime audits (axe-core via Playwright), component-level unit tests (Vitest), and manual keyboard / screen-reader testing per [`audits/manual-sr-test-protocol.md`](./audits/manual-sr-test-protocol.md).

> **Status: partial conformance.** The automated and structural criteria below
> are enforced continuously in CI. The criteria marked **Not yet verified**
> require a human operating a real assistive technology and are pending the
> manual test pass described in the protocol document. This statement
> deliberately does not claim conformance for anything that has not been
> measured — see [Known limitations](#known-limitations).

---

## 1. How each requirement is enforced

Every row names the mechanism that would *fail a build* if the behaviour
regressed. Every `scripts/audit-*.mjs` referenced below is registered as an
npm script and chained from `npm run lint`, which `.github/workflows/ci.yml`
runs on every push (`npm run audit:a11y-static` runs the whole static set
locally). A requirement with no enforcement mechanism is listed as
manual-only and appears in [Known limitations](#known-limitations).

### 1.1 Perceivable

| WCAG SC | Requirement | Enforcement |
|---|---|---|
| 1.1.1 Non-text Content | Icon-only controls carry a name; decorative icons are `aria-hidden` | `scripts/audit-accessible-name.mjs` |
| 1.3.1 Info and Relationships | Heading levels map to semantics; landmarks are named; tables use `<th scope>` + `<caption>` | `scripts/audit-landmarks.mjs`, `components/layout/__tests__/headingContract.test.tsx`, `components/ui/__tests__/DataTableA11y.test.tsx` |
| 1.3.1 | Complex visualisations expose a text alternative | `hooks/__tests__/useA11ySummary.test.tsx`; charts additionally render a fallback data table via `ChartContainer` |
| 1.4.1 Use of Colour | State is never colour-only — every status pairs colour with an icon or text | `lib/tokens.ts` severity tokens; PROHIBITED PATTERN #11 in `.github/copilot-instructions.md` |
| 1.4.3 Contrast (Minimum) | 4.5 : 1 body text, 3 : 1 UI components | `docs/audits/contrast.md`; axe `color-contrast` rule in `e2e/accessibility.smoke.spec.ts` |
| 1.4.11 Non-text Contrast | Borders and focus rings remain perceivable in Windows High Contrast | `scripts/audit-forced-colors.mjs` (resolves the CSS cascade, including `ThemeProvider`'s inline custom properties) + `components/ui/__tests__/ForcedColors.contract.test.tsx`, both chained from `npm run lint` |

### 1.2 Operable

| WCAG SC | Requirement | Enforcement |
|---|---|---|
| 2.1.1 Keyboard | Every control is reachable and operable by keyboard | Manual protocol § 2; axe `focusable-content` / `tabindex` rules |
| 2.1.2 No Keyboard Trap | Dialogs trap focus *while open* and release it on close | `hooks/useDialogFocus.test.tsx`, `hooks/__tests__/useDialogFocus.edge.test.tsx` |
| 2.2.2 Pause, Stop, Hide | No animation loops for more than 5 s without a way to stop it | `scripts/audit-reduced-motion.mjs`, `components/motion/__tests__/ambient.test.ts`, `components/charts/__tests__/chartMotion.test.ts` |
| 2.3.3 Animation from Interactions | Motion collapses under `prefers-reduced-motion` — including chart series, map camera, and skeleton shimmer | same as 2.2.2, plus the `@media (prefers-reduced-motion: reduce)` block in `src/index.css` |
| 2.4.1 Bypass Blocks | A "Skip to main content" link is the first focusable element | `components/feedback/SkipToContent.tsx`; `Layout.test.tsx` |
| 2.4.2 Page Titled | Route changes update `document.title` and announce it | `components/a11y/__tests__/RouteAnnouncer.test.tsx` |
| 2.4.3 Focus Order | Route changes move focus to the new page's `<h1>`; dialogs restore focus to their trigger | `lib/__tests__/routeFocus.test.ts`, `components/a11y/__tests__/RouteFocusManager.test.tsx`, `hooks/useDialogFocus.test.tsx` |
| 2.4.6 Headings and Labels | Exactly one `<h1>` per page; every landmark named | `scripts/audit-landmarks.mjs` |
| 2.4.7 Focus Visible | A focus indicator survives forced-colors mode | `src/index.css` (`*:focus-visible { outline: 2px solid Highlight }`) + forced-colors contract test |
| 2.5.5 Target Size | ≥ 44 × 44 px below the `md` breakpoint | `scripts/audit-touch-target.mjs` |

### 1.3 Understandable

| WCAG SC | Requirement | Enforcement |
|---|---|---|
| 3.2.1 On Focus | Focus never triggers a context change | Manual protocol § 2 |
| 3.2.2 On Input | Filter inputs update the URL without stealing focus | `lib/routeFocus.ts` (`text-entry-in-progress` / `same-path` suppression) + tests |
| 3.3.1 Error Identification | Failed submits surface a focusable summary listing every error | `components/forms/ValidationSummary.test.tsx` |
| 3.3.2 Labels or Instructions | Every form control has a persistent name — placeholders are never the only label | `scripts/audit-accessible-name.mjs`; `SearchInput` guarantees a name at the component level |

### 1.4 Robust

| WCAG SC | Requirement | Enforcement |
|---|---|---|
| 4.1.2 Name, Role, Value | Every interactive control exposes a name and role; sortable columns expose `aria-sort` including `none` | `scripts/audit-accessible-name.mjs`, `DataTableA11y.test.tsx` |
| 4.1.3 Status Messages | Async outcomes reach a live region without moving focus, and without chatter | `lib/__tests__/announcePolicy.test.ts`, `hooks/__tests__/useStatusAnnouncer.test.tsx`, `hooks/__tests__/useConnectionAnnouncement.test.tsx` |

---

## 2. Live-region policy (SC 4.1.3)

Status messages are governed rather than fired directly, because an
ungoverned live region is worse than none: a telemetry stream that ticks
40×/s turns a screen reader into a metronome and buries every message
that mattered.

| Event | Channel | Priority | Governance |
|---|---|---|---|
| Page data finished loading | `loaded:<page title>` | polite | Fires only on the `isLoading` → settled edge, so background refetches are silent. Wired centrally in `PageContainer`. |
| Refresh failed | `refresh-error:<label>` | assertive | Identical errors from sibling panels collapse into one within a 4 s window. |
| Record saved / save failed | `saved:<label>` / `save-error:<label>` | polite / assertive | Also delivered by the shared toast, which is itself a live region (`role="status"` / `role="alert"`). |
| Bulk action outcome | `bulk:<action>` | polite, or assertive when any item failed | — |
| Table selection changed | `selection` | polite | Rate-limited to 1 s and coalesced, so a shift-range across 40 rows speaks once with the final count. |
| Table sort changed | `sort` | polite | Edge-triggered — a table that renders pre-sorted stays quiet. |
| Live connection state changed | `stream:<scope>` | polite, assertive on disconnect | 10 s floor + 30 s dedupe window, so a flapping connection cannot chatter. Never announces on mount. |
| Route changed | dedicated region | polite | Separate from the shared announcer so a mutation message and a navigation cannot clobber each other. |

Implementation: `web/src/lib/announcePolicy.ts` (pure decision layer) and
`web/src/hooks/useStatusAnnouncer.ts` (semantic helpers).

---

## 3. Reduced-motion policy (SC 2.2.2 / 2.3.3)

`prefers-reduced-motion: reduce` suppresses, in order of how easy each is
to miss:

1. **CSS animations and transitions** — the global block in `src/index.css`.
   Ambient loops (`animate-pulse`, `animate-shimmer`, `animate-skeleton-wave`,
   `.shimmer`, `.pulse-glow`) get `animation: none` rather than a compressed
   duration, because a single 0.01 ms iteration parks the shimmer's highlight
   gradient off to one side and leaves the placeholder permanently lopsided.
2. **framer-motion loops** — `useMotionPreference()` for components that own
   one or two animations; `ambientLoop()` / `ambientFrames()` for scenes with
   many looping layers (`VehicleTwin`, `TeslaCarViz`). Enforced by
   `scripts/audit-reduced-motion.mjs`.
3. **Recharts series** — `AREA_DEFAULTS` exposes `isAnimationActive` and
   `animationDuration` as *getters*, so the ~225 call sites that already spread
   it re-read the preference on every render with no edit. Primitives that do
   not spread it use `chartAnimationProps()`.
4. **Leaflet camera movement** — `fitBounds` / `setView` / `panTo` pass
   `animate: false`, so the map jumps instead of gliding across a whole drive.

---

## 4. Forced-colors / high-contrast policy (SC 1.4.11)

Windows High Contrast (and the Contrast Themes successor) overrides
foreground and background colours, suppresses `box-shadow` and background
images, and treats `border-color: transparent` as invisible.

TeslaSync styles almost everything through CSS custom properties, and
forced-colors mode does **not** rewrite custom properties. A token that
resolves to `#11151c` therefore keeps rendering near-black inside a High
Contrast *light* theme, and an `rgba(255,255,255,0.09)` border disappears
entirely.

The fix is a token remap inside `@media (forced-colors: active)`:
surfaces → `Canvas`, text → `CanvasText`, muted text → `GrayText`, borders →
`CanvasText`, brand accents → `Highlight` / `HighlightText`, elevation
shadows → `none`.

**Every declaration in that block is `!important`, and that is load-bearing.**
`ThemeProvider` writes the live theme onto `<html>` as *inline* style
(`root.style.setProperty('--surface-1', …)`), and an inline declaration
outranks every normal author rule no matter how specific its selector is. A
plain `:root { --surface-1: Canvas }` inside the media block is therefore
inert at runtime — the remap silently does nothing. An `!important` author
declaration is the one thing that beats a non-important inline one
(CSS Cascade 4 §6.6.1). The corollary is a hard rule: `ThemeProvider` must
never call `setProperty(..., 'important')` for these tokens.

`scripts/audit-forced-colors.mjs` enforces this by resolving the actual
cascade — author rules with specificity and source order, plus the inline
properties `ThemeProvider` is known to write — for both the `dark` and
`light-mode` document states, and failing if the winning declaration is not
the system-colour one. `ForcedColors.contract.test.tsx` imports the same
resolver, so the spec and the build gate cannot disagree.

Component-level `forced-colors:` variants remain required for the eleven
critical components listed in the audit; they now only have to handle
component-specific chrome rather than every surface in the app.

---

## 5. Known limitations

These are stated plainly rather than papered over.

1. **No assistive-technology verification has been performed for this
   release.** Every claim above is backed by automated tests or static
   analysis. Screen-reader *quality* — whether an announcement is
   intelligible, whether a summary reads naturally, whether a reading order
   makes sense — cannot be measured by axe or Vitest. The protocol in
   [`audits/manual-sr-test-protocol.md`](./audits/manual-sr-test-protocol.md)
   exists to close this gap and has not yet been executed against a build.
2. **Accepted axe debt.** A small, reviewed set of runtime violations is
   baselined per route in `web/e2e/axeBaseline.ts`. The suite fails on any
   *new* violation and on any change to the known targets, so the debt cannot
   grow silently — but the baselined items are, today, non-conformances.
3. **AAA contrast (7 : 1) is out of scope.** The brand palette cannot reach
   it. AA only.
4. **Charts rely on a fallback data table, not on sonification or a
   described trend.** A user who cannot see the chart gets the numbers, not
   the shape.
5. **Maps expose a summary sentence, not a navigable route.** A screen-reader
   user learns the endpoints, distance, duration, and sample count; they
   cannot step through the path.
6. **`role="application"` on the route-playback map** suppresses the screen
   reader's browse mode inside that widget. This is deliberate (the playback
   controls are keyboard-driven), but it means the widget must be exited to
   resume normal reading.
7. **Third-party map tiles** are raster images supplied by the configured tile
   provider and are not described.

---

## 6. Reporting an accessibility problem

Open an issue in the repository with the route, the assistive technology and
version, and what you expected to happen. Accessibility defects are treated
as functional defects, not as enhancements.

---

## 7. Related documents

- [`A11Y_GUIDELINES.md`](./A11Y_GUIDELINES.md) — the contributor-facing rules.
- [`ACCESSIBILITY_SHORTCUTS.md`](./ACCESSIBILITY_SHORTCUTS.md) — keyboard reference.
- [`audits/manual-sr-test-protocol.md`](./audits/manual-sr-test-protocol.md) — NVDA / VoiceOver test protocol.
- [`audits/a11y-audit.md`](./audits/a11y-audit.md) — generated component-level audit.
