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
