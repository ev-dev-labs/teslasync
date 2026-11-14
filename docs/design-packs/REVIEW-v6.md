# Expressive Form (`v6`) review

Status: **passed-with-notes** for the bounded review, not a visual or
accessibility pass. The second capture still has one failing test and
additional manual review is required.

The owned stylesheet uses theme-derived canvas, panel, raised and overlay
surfaces; an offset framed heading and action rail; asymmetric corners;
segmented controls; and scoped chart, grid and Helix treatments. It keeps
native metric/chart geometry, semantic paint and protected Digital Twins with
their existing owners.

## First round — interrupted

```powershell
Set-Location web
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_CHECK_CONTRAST='1'
node scripts\capture-design-packs.mjs --pack v6 --pages dashboard,drives,energy --viewports phone-390,desktop --base-url http://127.0.0.1:54872
```

Exit **1**. Six tests failed: the phone dashboard failed its touch and text
diagnostics; the other five could not navigate because the shared server
refused connections. The coordinator identified the server's watcher following
Playwright trace files as the cause. The only image produced and inspected was
`shots\v6\round-1\phone-390-scale-1\dashboard.png`. Phone Drives and Energy,
and all three desktop images, were missing. The dashboard's Axe output was
`Contrast: 0 violated rules, 0 nodes require manual review`; this does not
clear its failed diagnostics or the missing pages.

### Highest-priority findings and changes

1. The dashboard's layout name was visibly truncated as “Implementation
   rev…”. The scoped mobile action selector now allows the name to wrap.
2. The framed heading consumed unnecessary phone height before the layout
   selector and commands. Its vertical padding was reduced without shrinking
   the info action's touch target or reordering the action zones.
3. The five phone-navigation buttons measured **11px** on the button even
   though their label children appeared larger. Their v6-scoped computed font
   size now follows the shared 16px-or-larger phone role.
4. The dashboard's “All drives” and “Open vehicle” footer links measured
   **12px** during the scroll audit. App-owned widget-footer links now use
   the phone body role.
5. Protected Digital Twin “Open” and refresh targets measured **36×36px**
   and **10×28px**; protected text measured **14px**. The audit also
   identified a **14px** native metric context and a **12px** unit. Those
   require shared/widget-owner resolution, not changes to protected or
   specialized metric geometry; see `requests\v6.md`.

The dashboard screenshot shows only the initial viewport, not every scrolled
audit target.

## Second and final capture round

The same command ran after the coordinator recovered the shared server.
Exit **1**: **5 passed, 1 failed**. All six final images were produced and
inspected:

- `shots\v6\phone-390-scale-1\dashboard.png`
- `shots\v6\phone-390-scale-1\drives.png`
- `shots\v6\phone-390-scale-1\energy.png`
- `shots\v6\desktop-scale-1\dashboard.png`
- `shots\v6\desktop-scale-1\drives.png`
- `shots\v6\desktop-scale-1\energy.png`

The dashboard at 390px still failed the touch and text diagnostics for the
protected Digital Twin and native metric noted above. The navigation-button
and widget-footer findings from round one were absent from the final
dashboard diagnostic. The phone Drives and Energy headings wrap onto two
lines beside the action controls; their text remains legible, but this
compact-layout tradeoff deserves further visual review.

The final dashboard image showed the label “Layout” split across lines. A
subsequent owner-scoped mobile rule prevents that label from shrinking while
allowing the adjacent name to wrap. A **synthetic DOM-only** browser check of
that control at 360, 390 and 430px found one label line and no horizontal
overflow at each width. It did not use the running app or take a screenshot;
all saved final images predate this last CSS change. No third screenshot
round was run.

Axe reported zero violated contrast rules in all six captures, with
incomplete/manual-review nodes as follows:

| Page | 390px | Desktop |
| --- | ---: | ---: |
| Dashboard | 0 | 0 |
| Drives | 1 | 3 |
| Energy | 0 | 17 |

These are not contrast passes: the incomplete results include a phone
Drives text element, desktop chart-axis labels, and desktop Energy chart
axis/legend elements. Full selectors and capture output are retained in
`shots\v6\round-2.log`.

## Verification

From `web`, `npx tsc --noEmit` exited **0** with no output. An initial
preservation-test name filter matched no tests and is not evidence; the
corrected `npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx -t v6`
also ran after the final CSS change:

```text
Test Files  1 passed (1)
     Tests  4 passed | 107 skipped (111)
```

The scoped engineering-guideline script exited **0**, reporting zero in
each of its six checks and `TypeScript passes`; the separate file audit also
reported no matches. Those TSX/API-oriented checks have limited relevance to
this CSS-only file. An ownership/reset-property check before the final
single selector reported `Unowned selectors: 0` and `Unreset app properties:
0`; the added selector is explicitly owner-scoped and introduces no custom
property. `git diff --check` for the stylesheet exited **0**. No build was
run, per the worker brief. This CSS-only task changes no page sections or
API hooks.

Light mode, forced colors, 360/430px, enlarged fonts, open controls, keyboard
focus, reduced motion and Helix states remain visually unreviewed. Standalone
routes and `/period-compare` remain shared coverage gaps in `DECISIONS.md`.

## Coordinator build

The coordinator ran `npm run build` in an isolated checkout of the committed
shared foundation with the completed Classic, v1, v2, v5, v6 and v7
stylesheets. It exited 0:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

The build does not resolve the failed capture or incomplete contrast checks.

## Standalone DataTable preservation repair

The v6-only DataTable test reproduced the reported baseline failure:
`AssertionError: expected 0 to be greater than 0` for the identity-rule
match (exit 1). The v6 stylesheet now applies its token-derived panel paint
and asymmetric corners to the owner-scoped standalone table frame, without
changing its border widths or targeting embedded tables, widget-owned
surfaces, semantic tones or other pack owners.

From `web`, the post-fix command was:

```powershell
npx vitest run src\components\ui\DataTable.appDesign.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx --testNamePattern='v6'
```

Exit 0; actual output:

```text
 RUN  v4.1.12 D:/repos/teslasync/web

 ✓ src/components/ui/DataTable.appDesign.test.tsx (35 tests | 34 skipped) 569ms
     ✓ v6 binds only the painted frame to existing base and identity surface rules  553ms
 ✓ src/components/ui/app-designs/packs/PackNativeCompositionPreservation.test.tsx (111 tests | 107 skipped) 1344ms
     ✓ honors nearest complete and incomplete previews, widget-only neutrality and final-target ownership  879ms

 Test Files  2 passed (2)
      Tests  5 passed | 141 skipped (146)
   Start at  12:44:43
   Duration  17.84s (transform 15.45s, setup 1.18s, import 25.80s, tests 1.91s, environment 3.08s)
```

A separate inline, synthetic DOM-only Edge check applied the new rule
without using a server or taking screenshots. Its actual output was:

```text
DOM-only frame paint: PASS (v6 standalone only; embedded, other owner, tone and widget unchanged)
DOM-only geometry, scroll offsets, focused selection and border widths: UNCHANGED
Forced-colors native frame radius: PASS
```

`npx tsc --noEmit` exited 0 with no diagnostics. The scoped
`audit-violations` script exited 0 with this output; its TSX/API-specific
checks have limited relevance to a CSS-only change:

```text
═══════════════════════════════════════════════════════════
  TeslaSync Engineering Guidelines Audit
  Target: D:\repos\teslasync\web\src\components\ui\app-designs\packs\expressive.css
═══════════════════════════════════════════════════════════

▸ [1/7] Static inline styles (var(--*))...
  ✅ 0 violations

▸ [2/7] Raw HTML elements...
  ✅ 0 violations

▸ [3/7] Direct library imports...
  ✅ 0 violations

▸ [4/7] Old API imports...
  ✅ 0 violations

▸ [5/7] Double /api/v1/ prefix...
  ✅ 0 violations

▸ [6/7] camelCase query params (vehicleId=)...
  ✅ 0 violations

▸ [7/7] TypeScript compilation...
  ✅ TypeScript passes

═══════════════════════════════════════════════════════════
  ✅ ALL CHECKS PASSED — 0 total violations
═══════════════════════════════════════════════════════════
```

`git diff --check` for the stylesheet and review exited 0. No new screenshots
were taken; the existing capture and accessibility limitations above remain.

The orchestrator subsequently ran `npm run build` in the verification snapshot
with the repaired v5, v6 and Atlas stylesheets: **exit 0**. All three SHA-256
hashes matched the working files. The combined native-composition, ordered-step
and DataTable contracts reported **3 files passed, 200 tests passed**. This
does not establish the post-capture appearance or contrast.

## Phone heading follow-up

The saved 390px Drives image shows the short page title wrapping beside the
action rail. A real-route, screenshot-free regression reproduced two title
lines at 390px in both dark and light modes. The pack's phone heading now
reserves a larger, font-scale-aware title width, allowing the action rail to
wrap instead of squeezing the title.

The same browser check then passed at 360/390/430/768/1440px, scales
0.85/1/1.35, both modes and normal/forced colors. It checked containment,
overlap, page overflow and the phone help target; the short title was one
line at the default scale. Report and kiosk title tokens stayed at their
existing value. The separate dashboard layout-name check also passed across
all 27 packs at the three phone widths:

```text
3 passed (1.0m)
V6_HEADING_FINAL_EXIT=0
```

No new screenshots were taken. The saved images predate this change, so the
updated layout and its extra action-row space have not been visually approved.

```text
Test Files  3 passed | 1 skipped (4)
     Tests  9 passed | 204 skipped (213)
V6_UNIT_FINAL_EXIT=0
Test Files  2 passed (2)
     Tests  43 passed (43)
V6_OWNER_CONTRACT_EXIT=0
FRONTEND_TSC_EXIT=0
E2E_TSC_FINAL_EXIT=0
E2E_ESLINT_FINAL_EXIT=0
ISOLATED_BUILD_EXIT=0
V6_AUDIT_EXIT=0
FULL_LINT_EXIT=0
```

The isolated Vite build included all four normal postbuild checks. The pack's
engineering audit reported zero in all six pattern categories and `TypeScript
passes`; those pattern checks do not certify CSS contrast.

## Phone metric follow-up

A screenshot-free real-dashboard regression reproduced the Recent Drives
context at **11.9px** at 360px and font scale 0.85 in both modes. On phones,
ordinary owned Expressive headline context and units now use the body-size
token. Preserved widgets, native gauges and rings, and report/kiosk
presentations are excluded.

The same check passed for actual Recent Drives context and Battery units at
360/390/430px, scales 0.85/1/1.35, both modes and normal/forced colors. It
checks text size, widget containment, overlap and document overflow; it does
not approve the appearance or other widget layouts. A separate selector
contract covers protected, gauge, ring, report and kiosk boundaries:

```text
2 passed (28.7s)
V6_METRIC_FINAL_EXIT=0
Test Files  1 passed (1)
     Tests  5 passed | 107 skipped (112)
V6_METRIC_BOUNDARY_FINAL_EXIT=0
V6_METRIC_LINT_FINAL_EXIT=0
V6_METRIC_E2E_TSC_FINAL_EXIT=0
Test Files  5 passed (5)
     Tests  244 passed (244)
V6_METRIC_CONTRACTS_EXIT=0
V6_METRIC_AUDIT_EXIT=0
```

No new screenshots were taken. The saved dashboard images predate this
change; protected Digital Twin text and controls remain unresolved.
