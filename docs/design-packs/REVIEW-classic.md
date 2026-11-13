# Classic review

Status: **in progress**. These are partial visual judgments, not acceptance
scores. Phone contrast findings and incomplete checks are recorded below;
remaining routes and interaction states are unreviewed.
The first two score tables record earlier captures; some screenshot paths
have since been overwritten by recaptures and no longer reproduce those frames.

| Page and image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dashboard, `desktop/dashboard.png` | 5 | 4 | 6 | 7 | 5 | — | 4 |
| Drives, `desktop/drives.png` | 6 | 5 | 6 | 7 | 6 | — | 4 |
| Drives, `phone-390/drives.png` | 6 | 4 | 5 | 6 | 5 | 4 | 4 |
| Action center, `desktop/action-center.png` | 6 | 5 | 6 | 7 | 6 | — | 4 |
| Action center, `phone-390/action-center.png` | 6 | 4 | 5 | 6 | 5 | 4 | 4 |

Color scores are visual impressions only; they do not establish WCAG AA.

## Refinement sample

These captures predate the latest touch-target changes and must be repeated
after those changes. The larger text case uses the saved 1.35 font scale.

| Page and image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Action center, `phone-360/action-center.png` | 7 | 6 | 7 | 7 | 5 | 6 | 4 |
| Drives, `phone-390-scale-1-35/drives.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Drives, `tablet-light/drives.png` | 7 | 7 | 7 | 7 | 6 | — | 5 |
| Drives, `desktop/drives.png` | 7 | 7 | 7 | 7 | 6 | — | 5 |
| Action center, `desktop-light/action-center.png` | 7 | 6 | 7 | 7 | 6 | — | 5 |
| Charging, `phone-430/charging.png` and scrolled frame | 6 | 5 | 5 | 6 | 5 | 5 | 4 |
| Charging Patterns, `phone-390/charging-heatmap.png` and scrolled frames | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Charging and Patterns, `phone-390/*--table.png` | 7 | 7 | 7 | 7 | 6 | 7 | 4 |
| Charging Patterns, `tablet-light/charging-heatmap.png` | 6 | 6 | 6 | 7 | 6 | — | 4 |
| Charging Patterns, `desktop/charging-heatmap.png` | 6 | 6 | 6 | 7 | 6 | — | 4 |
| Charging Patterns, `tablet-touch/charging-heatmap.png` | 6 | 5 | 6 | 7 | 5 | — | 4 |
| Charging Patterns, `tablet-touch/charging-heatmap--table.png` | 7 | 6 | 7 | 7 | 6 | — | 4 |

The compact metric values are easier to scan and the tablet rows no longer
stretch. At enlarged text, the phone header and summary still consume most of
the first screen. The desktop metric banks retain too many competing rules,
and the restrained shell remains visually generic. These scores are not a
substitute for the remaining page, state and viewport review.

## Phone contrast and touch findings

The 390px Action center and Drives captures passed the rendered touch-target
and scoped prose-size diagnostics. Enlarging the refresh target initially
pushed the Drives actions onto a second row; the adjusted spacing restored the
single row without shrinking the targets.

The first 390px Axe scan reported no Action center violations, but six nodes
in each mode need manual contrast review. Drives reported three instances of
the same low-contrast missing-location text: **3.88:1 dark** and **2.84:1
light**, against the 4.5:1 requirement. After removing the text opacity, the
same two 390px Drives scans report no automated violations. History-row route
and metric text was visibly too small on phone and was not covered by the
original scoped prose diagnostic; the row now reflows with 16px data text.
An incomplete
single-letter grade also revealed a hardcoded light-mode green: `#10b981` on
the observed `#fafbfc` panel is **2.45:1**, below the 3:1 large-bold-text
threshold. The shared grade palette now uses semantic tokens. A 390px
rendered check measured every visible Drives score against its opaque panel
and requires at least 4.5:1 in both modes.

At 390px the Charging heatmap originally scrolled horizontally. Its 24 hourly
cells now wrap into two twelve-hour rows per day, with the original 168 cells,
titles and data-table alternative preserved. The open table and chart passed
the phone overflow check in both modes. Five undersized Charging prose nodes
were promoted to body roles; their rendered-size check now passes.

The earlier 390px Action center, Charging and Drives captures passed their
scoped touch, text-size and overflow checks in both modes and had no automated
Axe violations. Axe still reported **6, 11 and 7** incomplete nodes per mode
respectively. These are not automatic passes. Manual inspection of the
Drives sticky result count and shared status bar found opaque backgrounds and
visible text; the measured dark/light contrast ratios were 8.73/7.31 for
the result count, 8.44/6.78 for API and Live, 5.66/5.64 for muted latency
and age, 7.99/5.88 for the warning badge, and 8.73/7.31 for Status. Charging's
additional incomplete nodes and all other states still need review. Those
390px captures predate the latest tooltip and summary changes and need
recapturing.

The 360/430 matrix for those three pages initially passed 10 of 12 cases.
Both 430px Charging cases exposed a 12px chart-tooltip date. After promoting
the tooltip text and grouping wrapped summary separators with their values,
the Charging and Charging Patterns captures passed all 12 phone cases
(360/390/430px, dark/light) for their scoped touch, text, overflow and
interaction checks. Automated Axe reported no violations, but Charging had
seven incomplete nodes in each case and Charging Patterns had 22–24.
Manual inspection of the observed 430px Charging nodes confirmed opaque
backgrounds and visible text at those nodes; the dark/light ratios were
8.73/7.31 for the result count and Status, 8.44/6.78 for API and Live,
5.66/5.64 for muted latency and age, and 7.99/5.88 for the warning badge.
Those measurements cover only the observed 430px states.

The 430px Charging screenshot still has a wrapped action row and repeated
scope copy. A scrolled frame exposed Recharts' large pale default hover cursor
over the dark plot; a surface-token treatment now replaces it and the
capture verifies the hovered cursor. The corrected tooltip shadow still needs
a fresh production capture.

Charging Patterns is a separate interactive heatmap, not the Charging cost
heatmap. Its first 390px capture failed the horizontal-scroll diagnostic. A
six-hour phone reflow preserving the 168 slots and roving keyboard controls
passed the phone geometry, keyboard, popover and open-table checks.
The inspected screenshot still has excessive space around the title, a long,
repetitive matrix, small metadata labels, weak day grouping and a generic
visual identity. Other viewports, states and the incomplete contrast checks
remain unverified.

The phone prose rule initially did not apply in forced-colors mode. A browser
contract reproduced 14px text and now verifies the 16px floor there without
changing widget text or forced-colors borders. A separate contract exposed a
Classic metric-grid rule collapsing a two-column widget grid to one column;
the rule now excludes widget descendants and the isolated normal and
forced-colors checks preserve the two-column geometry. The real Digital Twin
and Mini still need visual comparison in the final viewport matrix.
The first 390px forced-colors screenshot revealed that the otherwise
non-overflowing native chart fallback table squeezed its cells to 10.2px at
the smallest font scale. The revised 0.85-scale capture preserves the 168
rows and native column/cell roles and displays the caption and first rows
readably. One Axe node still requires manual contrast review. The normal
390px dark/light captures of both open charging tables also passed the
scoped row, accessible-name, cell-width and overflow checks; the repeated
field labels and long weekly matrix still need design refinement.

The normal-color phone matrix for Action center, Charging overview, Charging
patterns and Drives at 360, 390 and 430 pixels, in dark and light mode,
completed with `24 passed (6.3m)`. Axe reported zero violated contrast rules
but 0–18 incomplete nodes per capture, primarily chart text; those nodes and
other scroll positions still require manual contrast review. These captures
precede the latest forced-colors CSS edits.

| Latest viewed image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Drives, `phone-390/drives.png` | 7 | 6 | 6 | 7 | 6 | 6 | 4 |
| Action center, `phone-430/action-center.png` | 7 | 6 | 6 | 7 | 6 | 6 | 4 |
| Charging overview, `phone-360/charging.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Charging patterns, `phone-390-light/charging-heatmap.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |

The refreshed phone views still have large header/action gaps and fine
metric labels. Charging's search hint clips at 360px, and the long patterns
page delays its chart. The subdued Classic treatment is still too generic.

The tablet and desktop Charging Patterns captures preserve the bounded
desktop plot geometry, but the inspected views still have small axis labels,
excessive space above the plot and repetitive metric rules. These observations
do not establish a pass for either viewport.

The latest 768px coarse-pointer capture uses two balanced twelve-hour rows per
day and a readable stacked table. Its chart title still has excessive empty
space before the first day, and the table repeats substantial row metadata.
Both normal-color modes passed the touch, keyboard, popover, table-role and
overflow checks, but Axe left 20 nodes per mode for manual contrast review.
The first forced-colors tablet attempt found a 12px caption and hidden
headers. After the responsive fix, the production recapture passed in both
modes, with one incomplete Axe node per mode. A separate forced-colors phone
capture exposed six single-column metrics; a widget-excluding layout fix
passes the isolated browser contract and the production recapture. Action
center and Drives completed `12 passed (3.2m)` at 360/390/430px in both
forced-color schemes, including touch, prose, metric geometry and overflow
checks. Axe reported no violations in the final scrolled state; Drives has
one incomplete node at 390 and 430px in both schemes. The reviewed 390px
screens show the metrics in two columns, but the phone headers still waste
space and the fine labels need further typographic review.

The changed charging pages and their directly modified heatmap components
remain at or above their original line counts. Against
`feature/app-design-themes`, ChargingListPage is 1,606 → 1,606 lines and
7 → 7 `GlassPanel`/`ChartContainer` lines; ChargingHeatmapPage is
527 → 537 lines and 0 → 0 such lines. Its HeatmapGrid is 203 → 205 lines;
CostHeatmap is 187 → 188 lines and 3 → 3 such lines. The Action center
RecommendationCard and ProviderStatusPanel remain 175 → 175 and 85 → 85
lines, with 3 → 3 such lines each.

The latest isolated hook verification completed successfully:

```text
  Found 571 unique URL patterns
  ✅ No double prefix issues
  Found 888 route patterns
  ✅ All params use snake_case
  ✅ ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES
```

The frontend violations audit also completed successfully:

```text
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
```

The latest production `npm run build` exited 0 after the forced-colors CSS
changes. Its final checks included:

```text
[pwa-precache] OK — route chunks remain on-demand
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

The full `npm run lint` also exited 0 on the same source:

```text
OK — no direct date/time formatting outside the shared layer (3856 files scanned)
[audit-registry] OK — every audit is registered, executable, thresholded and wired
[release-identity] OK — release threads VITE_APP_VERSION + VITE_GIT_SHA + VITE_RELEASE_BUILD into the single build-scan/export step; compose uses its own opt-in variables and unversioned builds stay unparseable and harmless
```

The owner, portal, table and native-composition preservation suites passed:

```text
 Test Files  7 passed (7)
      Tests  274 passed (274)
```

An earlier full Vitest run overlapped source edits and reported 13 failing
files, 104 failed tests, 93,243 passed and 4 skipped. Targeted reruns passed,
but a clean full-suite run on stable source is still required.

The standalone audit tool separately flagged `<Table>` on Charging Patterns
as raw HTML; that finding is a false positive because the component is
imported from `@/components/ui` rather than rendered as a lowercase `<table>`.

The refreshed 390px Charging, Charging Patterns and Drives captures passed
their scoped touch, prose, overflow and interaction checks in both modes:

```text
6 passed (1.5m)
```

The final scrolled state reported zero automated contrast violations, with
one incomplete node for Charging and Drives and 18 for Charging Patterns in
each mode. Those findings and other scroll positions still need manual
review. The subsequent source-preserving freshness and chart-label changes
require a new production capture.

## Initial defects

- On the phone, even short action groups take an entire row below the page
  title, pushing the first useful section farther down the screen.
- Mobile body and field typography is frequently smaller than the requested
  16px; small labels make dense summaries difficult to scan.
- The phone Action center summary presents a sparse two-column grid with
  isolated items and excessive separators.
- The desktop Dashboard gives a hidden setup checklist a disproportionately
  large first panel, delaying the vehicle information.
- Dashboard panels and data summaries use nearly identical dark surfaces and
  rules, so the first screen lacks a clear visual focal point.
- The current Classic frame and accent underline are too generic to distinguish
  the pack clearly from other restrained profiles.
- Tap-target, composed contrast, safe-area, open-control, loading and error
  states have not been verified by this visual sample.
