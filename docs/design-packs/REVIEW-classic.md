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

## Help and session-card refinement

The revised 1440px Help captures passed in both modes. The welcome panel no
longer stretches to match a taller neighbor; the three ways to get help now
form a compact row. The 390px captures also show the welcome and help panels
without horizontal overflow. These are interim judgments, not acceptance:

| Page and image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Help, `desktop/help.png` | 8 | 8 | 7 | 7 | 6 | — | 5 |
| Help, `desktop-light/help.png` | 8 | 8 | 7 | 7 | 6 | — | 5 |
| Help, `phone-390/help.png` | 7 | 6 | 7 | 7 | 6 | 6 | 5 |
| Help, `phone-390-light/help.png` | 7 | 6 | 7 | 7 | 6 | 6 | 5 |

Five remaining defects: the two-row phone navigation takes substantial
content space; the breadcrumb and title have excessive vertical separation;
the first actionable help links are below the first phone viewport; panels
share a generic border-and-card treatment; and focus, hover, other widths and
other scroll states have not yet been visually reviewed. The desktop Axe scan
reported no violations but left one selected-navigation label in each mode
for manual contrast review. The visible text against its opaque selected
surface measures 16.03:1 dark and 14.93:1 light; the decorative pseudo-element
is a narrow leading rule, not a text overlay.

The 390px Energy card preserves the session-detail link, with all seven fields
available in Quick View. A strengthened rendered-text check exposed a cascade
conflict: the card's six text elements were still 14px despite the token
override. The rule and browser fixture now account for the actual `text-sm`
class. The same check distinguished compact status-bar metadata from page body
links and found a 14px Vehicles details link. After both corrections, the
390px Battery, Energy, Help and Vehicles captures passed in both modes:

```text
8 passed (2.1m)
```

Those captures checked visible touch targets, body-link and card text sizes,
horizontal scrolling, and the seven Quick View labels and values. The final
scrolled states reported zero automated contrast violations and zero
incomplete nodes; other scroll states still require manual contrast review.
The Energy card is clearer, but its page-size control is stranded on a
separate row and the preceding charger chart leaves conspicuous blank space.

At 360px and 430px, the four-page dark/light matrix initially reported
`14 passed, 2 failed`: the two failures were Battery captures waiting on a
skeleton outside the clipped scrollport. After correcting that readiness
check, the two 360px Battery recaptures passed. The 430px Battery scan left
two legend labels per mode for manual contrast review; their observed
foregrounds against the opaque chart surface measure 8.73:1 dark and
7.31:1 light. Other states and scroll positions remain unverified.

At 1.35 text scale, the 360/430px Energy, Help and Vehicles matrix returned
`10 passed, 2 failed`. Both failures were Help at 360px, where the support
bundle JSON had a 350px scroll width inside a 294px container. The bundle is
now allowed to wrap without changing its text. The dark/light recapture at
both widths checked the opened JSON and its parseability and returned:

```text
12 passed (5.2m)
```

An open-disclosure screenshot is still needed for visual review. At 0.85
scale, Energy passed all four 360/430px dark/light cases.

The earlier 360px, 1.35-scale Energy screenshot exposed two further defects:
the narrow operational-metric columns split "consumption" across lines, and
the header truncated "Last 7 days". The subsequent workspace refinement and
recaptures are recorded below. The one-category chart now uses the shared
bounded-height API instead of overriding its measured viewport; the
three-category 360/430px dark/light captures reported `4 passed (1.8m)`.
The chart still has visible empty space below the single category.

On the current source, `npx tsc --noEmit`, `npm run build`, and `npm run lint`
each exited 0. The Energy page regression run reported:

```text
Test Files  1 passed (1)
     Tests  14 passed (14)
```

The focused engineering audit reported zero violations in each of its six
categories and `TypeScript passes`. The capture harness contracts and hook
route check reported:

```text
48 passed (14.1s)
ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES
```

Energy's page file has 1,642 lines versus 1,620 on the source branch, with
nine chart/panel references in each. The initial full Vitest run was stopped
before completion and restarted from an isolated worktree at commit
`143c362a40` so subsequent edits cannot alter its source. That run remains
in progress and is not a passing full-suite result.

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

## Protected Digital Twin comparison

The original Tesla-image widgets are isolated from app-wide composition rules
while retaining inherited theme and widget-pack tokens. With app-wide styling
off and on, the real Digital Twin and Mini were captured at 360, 390 and
430px, tablet and desktop in dark and light mode. The comparison checks the
image origin, ownership, position, dimensions and corner treatment. Phone and
tablet cases passed directly; desktop grid width increased by 18px with the
app-wide shell, so geometry was compared at the same width after preserving
the natural screenshots. Both desktop cases passed the normalized comparison.
The phone images visibly retain the widget-only composition; this is not a
pass for the surrounding dashboard or other interaction states.

A separate 390px dashboard diagnostic at saved font scale 1.01 found undersized
Settings, widget refresh, the twin Open link, All drives and Open vehicle
targets. It also found 14.1px widget titles and body text, including text
inside the protected twins. The original widgets' geometry and these mobile
requirements must both be respected; neither this diagnostic nor dashboard
mobile accessibility has passed. Its saved screenshots are defect evidence.
After the owner-scoped refinement and a production rebuild, the same
diagnostic reports only the protected twins' 36 x 36 Open and 10 x 28 refresh
targets, plus their 14.1px title and body text. The retained screenshot shows
the warning and dashboard actions still occupy most of the first screen;
the visual result remains generic and is not a pass.

The refreshed protected-twin comparison completed with `10 passed (1.5m)`
across the five sizes and both modes. Four 390px page captures completed
with `8 passed (2.1m)` across both modes. These results cover the captured
states, not all interactions or contrast findings.
The open Charging and Charging Patterns tables were then recaptured in both
modes with `4 passed (1.1m)`; the two inspected examples show stacked rows
with readable labels but remain visually repetitive.

The dashboard was also recaptured and inspected at 768px and 1440px in
both modes: `4 passed (48.5s)`. The final scrolled state reported no
automated contrast violations, but one desktop and three tablet nodes per
mode required manual review. A follow-up context capture completed with
`4 passed` and found the selected Home label over an opaque background at
16.03:1 dark and 14.93:1 light. After scrolling the other tablet nodes into
view, the Physics label measured 6.01:1 dark and 5.58:1 light, and the
latency text 5.66:1 and 5.64:1. This does not resolve their originally
reported partial occlusion or establish full-page contrast.

| Dashboard image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `desktop/dashboard.png` | 5 | 4 | 6 | 7 | 5 | — | 4 |
| `desktop-light/dashboard.png` | 5 | 4 | 6 | 7 | 5 | — | 4 |
| `tablet/dashboard.png` | 5 | 4 | 6 | 7 | 5 | — | 4 |
| `tablet-light/dashboard.png` | 5 | 4 | 6 | 7 | 5 | — | 4 |

The hidden setup checklist occupies a large first panel, leaving the vehicle
below the fold; this is the captured saved layout, not a reason to remove the
widget. At tablet width the layout selector and icon actions crowd their row.
The similarly toned panels and repeated rules still make Classic feel generic
in both modes. The 11px rail labels are also hard to read.

Action center, Charging overview, Charging Patterns and Drives were recaptured
and inspected at 768px and 1440px in both modes: `16 passed (2.6m)`. Axe
reported zero violated contrast rules in the final scrolled states. Its
incomplete-node counts per mode were, respectively, 3/2/20/2 on tablet and
1/0/18/7 on desktop; those nodes and the other scroll positions still need
review.

| Page and viewport, dark/light | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Action center, tablet | 6 | 5 | 6 | 7 | 5 | — | 4 |
| Action center, desktop | 6 | 6 | 6 | 7 | 6 | — | 4 |
| Charging overview, tablet | 6 | 5 | 6 | 7 | 5 | — | 4 |
| Charging overview, desktop | 6 | 6 | 6 | 7 | 5 | — | 4 |
| Charging Patterns, tablet | 6 | 5 | 6 | 7 | 5 | — | 4 |
| Charging Patterns, desktop | 6 | 6 | 6 | 7 | 6 | — | 4 |
| Drives, tablet | 7 | 6 | 6 | 7 | 6 | — | 4 |
| Drives, desktop | 7 | 6 | 6 | 7 | 6 | — | 4 |

The Action center's important counts have too little visual priority among
wide repeated rules. The tablet Charging and Drives search hints clip despite
unused horizontal space. Charging Patterns still has a large gap between the
chart title and its fine axis labels. All four pages need a more distinctive
Classic surface and typographic hierarchy.

Vehicles, Energy, Battery and Analytics were captured at tablet and desktop
sizes in both modes. The run did **not** pass:

```text
  3 failed
    [tablet-light] capture vehicles (/vehicles)
    [desktop-light] capture battery (/battery)
    [desktop-light] capture vehicles (/vehicles)
  13 passed (2.3m)
```

In the final scrolled state, the light-mode Vehicles "View details" link and
the Battery home-charge count use `#3b82f6` on `#fafbfc`, measuring **3.54:1**
against the required 4.5:1. The selected accent itself must remain unchanged;
these text uses need an accessible foreground role instead. Axe also reported
incomplete nodes requiring manual review: Analytics 28/23, Battery 4/9, Energy
3/13 and Vehicles 2/0, for tablet/desktop respectively in each mode. The
automated results do not cover every scroll position.

| Page and viewport, dark/light | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Vehicles, tablet | 6 | 5 | 6 | 4 | 5 | — | 4 |
| Vehicles, desktop | 6 | 6 | 6 | 4 | 5 | — | 4 |
| Energy, tablet | 6 | 5 | 6 | 7 | 5 | — | 4 |
| Energy, desktop | 6 | 6 | 6 | 7 | 5 | — | 4 |
| Battery, tablet | 6 | 5 | 6 | 7 | 5 | — | 4 |
| Battery, desktop | 6 | 6 | 6 | 4 | 5 | — | 4 |
| Analytics, tablet | 6 | 5 | 6 | 7 | 5 | — | 4 |
| Analytics, desktop | 6 | 6 | 6 | 7 | 5 | — | 4 |

These are partial visual scores, not contrast certification. The Vehicles
page spends its first screen on source status and repetitive summary rows
before the actual vehicle. Energy and Battery repeat similarly weighted
metric banks, and Analytics gives its section selector a large sparse panel.
Fine labels and near-identical surfaces make all four views feel generic.

The same four pages were captured at 390px in both modes with the scoped
touch-target, prose-size, horizontal-scroll and Axe checks enabled:

```text
  6 failed
  2 passed (1.6m)
```

Energy has a horizontally scrollable table: its 352px content sits in a
330px viewport. No Energy screenshots were written because this assertion
failed first. Battery has four 10px chart-summary labels. Vehicles has 28px
Reveal and Copy controls, and its light-mode details link also fails contrast.
Analytics passed the automated checks in both modes, but each scan left 14
nodes for manual contrast review. These are captured states, not full-page
accessibility passes.

| Page and image, dark/light | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Vehicles, `phone-390*/vehicles.png` | 5 | 4 | 5 | 4 | 4 | 3 | 4 |
| Battery, `phone-390*/battery.png` | 6 | 5 | 4 | 7 | 5 | 4 | 4 |
| Analytics, `phone-390*/analytics.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |

Vehicle source cards delay the actual vehicle, the Battery first screen is
dominated by the long introductory metric bank, and Analytics repeats dense
rules without a clear visual focal point. The bottom-navigation labels are
also visibly clipped on these images. Energy remains unscored because no
normal capture was produced.

Another capture batch covered Geofences, Help, Journeys and Trips at 390px
and 1440px in both modes:

```text
  3 failed
  13 passed (2.6m)
```

Help overflows to 471px on both phone modes; its light desktop dashboard
link also fails contrast at 3.54:1. Phone screenshots were not saved because
the overflow assertion failed. Axe reported 11 incomplete nodes per phone
mode on Journeys; desktop Geofences had none, while Journeys and Trips had
four and nine respectively. These still require manual contrast review.

| Page and image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Geofences, `phone-390/geofences.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Geofences, `desktop/geofences.png` | 6 | 5 | 6 | 7 | 5 | N/A | 4 |
| Journeys, `phone-390/journeys.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Journeys, `desktop/journeys.png` | 6 | 4 | 5 | 7 | 4 | N/A | 4 |
| Trips, `phone-390/trips.png` | 6 | 5 | 5 | 7 | 5 | 5 | 4 |
| Trips, `desktop/trips.png` | 6 | 5 | 5 | 7 | 5 | N/A | 4 |
| Help, `desktop-light/help.png` | 4 | 3 | 5 | 4 | 4 | N/A | 3 |

Geofences repeats nested empty panels, the Journeys split view leaves a large
unbalanced blank column, and Trips' exported chart actions compete with its
heading on mobile. Help's first card has excessive empty space. The phone
navigation remains visibly clipped in the newly viewed captures.

| Latest viewed image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Action center, `phone-390/action-center.png` | 7 | 6 | 6 | 7 | 6 | 6 | 4 |
| Charging overview, `phone-390/charging.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Charging patterns, `phone-390-light/charging-heatmap.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Drives, `phone-390/drives.png` | 7 | 6 | 6 | 7 | 6 | 6 | 4 |
| Dashboard, `phone-390-scale-1-01/dashboard.png` | 6 | 5 | 6 | 7 | 4 | 3 | 4 |

The refreshed dashboard image exposes a previously unreported defect:
the Charging label in the bottom navigation wraps and is clipped by the
viewport. Its target dimensions alone did not catch this. The dashboard
warning and controls still postpone the first vehicle panel, and the Action
center's wrapped action rail and sparse metric rules consume excess height.
Charging's search hint clips, the heatmap needs many phone screens, and fine
metric labels remain hard to scan. These are open defects, not passes.

The changed DashboardGrid remains 582 → 586 lines against
`feature/app-design-themes`, with 6 → 6 `GlassPanel`/`ChartContainer` lines.
WidgetShell remains 217 → 217 lines with 0 → 0 such sections.

Checkpoint verification on the protected-surface changes:

```text
Dashboard and ownership Vitest: Test Files  4 passed (4)
                               Tests       39 passed (39)
Twin browser comparison, phone/tablet: 8 passed
Twin browser comparison, normalized desktop: 2 passed (20.8s)
npx tsc --noEmit: exit 0 (no output)
targeted ESLint: exit 0 (no output)
npm run lint: exit 0
npm run build: exit 0
frontend guideline audit: 0 total violations; TypeScript passes
hook verification: ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES
390px dashboard touch and body-size diagnostic: 1 failed
```

The full Vitest suite has not completed cleanly on this checkpoint.
The latest `npm run lint` completed successfully on the current source:

```text
OK — no direct date/time formatting outside the shared layer (3856 files scanned)
[audit-registry] OK — every audit is registered, executable, thresholded and wired
[release-identity] OK — release threads VITE_APP_VERSION + VITE_GIT_SHA + VITE_RELEASE_BUILD into the single build-scan/export step; compose uses its own opt-in variables and unversioned builds stay unparseable and harmless
```

The phone prose rule initially did not apply in forced-colors mode. A browser
contract reproduced 14px text and now verifies the 16px floor there without
changing widget text or forced-colors borders. A separate contract exposed a
Classic metric-grid rule collapsing a two-column widget grid to one column;
the rule now excludes widget descendants and the isolated normal and
forced-colors checks preserve the two-column geometry.
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

The revised navigation was captured on Geofences at 360, 390 and 430px in
both modes, at saved text scales 0.85, 1 and 1.35. All 18 captures passed
the scoped target, body-size, overflow, label-clipping and word-splitting
checks. The 1.35 forced-colors matrix added six passing captures. Axe found
no violations in the final scrolled states; the enlarged normal-color and
forced-colors captures each left one warning badge per viewport for manual
review. A prior measurement of the observed badge was 7.99:1 dark and
5.88:1 light. A 390px forced-colors recapture measured white on black and
black on white respectively (21:1); other widths have not been independently
measured.
The isolated browser contract also passed at 400 and 401px, in LTR and RTL,
with three tracking settings and simulated safe-area insets.

| Latest viewed image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Geofences, `phone-360-touch-scale-1-35/geofences.png` | 6 | 5 | 6 | 7 | 5 | 6 | 4 |
| Geofences, `phone-390-light-touch-scale-1/geofences.png` | 6 | 5 | 6 | 7 | 5 | 6 | 4 |

Labels are no longer visibly clipped or split, including at the largest text
scale. The two-row bar still consumes significant content space; small metric
labels, a sparse page header and repetitive nested panels remain defects.
These are not a page or pack pass.

| Latest viewed image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Drives, `phone-390/drives.png` | 7 | 6 | 6 | 7 | 6 | 6 | 4 |
| Action center, `phone-430/action-center.png` | 7 | 6 | 6 | 7 | 6 | 6 | 4 |
| Charging overview, `phone-360/charging.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Charging patterns, `phone-390-light/charging-heatmap.png` | 6 | 5 | 6 | 7 | 5 | 5 | 4 |
| Dashboard, `phone-390-scale-1-01/dashboard.png` | 6 | 5 | 6 | 7 | 5 | 4 | 4 |

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

## Enlarged-text workspace refinement

The actual 360px Energy image first exposed a 16px overlap between the
vehicle text area and its enlarged action, then a fractional-width truncation
of "Aurora" despite a permissive measurement tolerance. The revised spacing
and stricter measurement show the full sample name and "Last 7 days" without
splitting the metric label. Longer names and non-Latin metric labels have not
been established as readable. The browser fixture checks LTR and RTL, one
and two actions, forced colors and both saved-scale extremes.

| Inspected image | Hierarchy | Spacing | Typography | Color | Polish | Mobile | Distinctiveness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Energy, 360px dark/light | 7 | 6 | 7 | 7 | 6 | 6 | 5 |
| Energy, 390px dark | 7 | 6 | 7 | 7 | 6 | 6 | 5 |
| Energy, 430px light | 7 | 6 | 7 | 7 | 6 | 6 | 5 |
| Help open support, 360px dark and 390px light | 6 | 6 | 6 | 7 | 6 | 6 | 5 |
| Vehicles, 360px dark | 6 | 5 | 7 | 7 | 6 | 6 | 4 |
| Action center, 360px dark | 7 | 6 | 7 | 7 | 6 | 6 | 4 |
| Drives, 360px dark | 6 | 6 | 7 | 7 | 6 | 6 | 4 |

These are partial judgments, not acceptance scores or WCAG certification.
The title and a lone bookmark still consume separate rows; two-row navigation
occupies substantial phone space; the Vehicles first screen is mostly
repetitive status cards; the Help JSON breaks long strings across lines; and
the pages still share generic surfaces. Loading, error, hover and additional
scroll positions remain unreviewed.

The 1.35-scale touch-device captures cover Energy, Help and Vehicles at
360/390/430px in both modes, with the support disclosure open and the workspace
comparison/custom-range interactions exercised. Action center and Drives
were recaptured at the same widths and modes:

```text
18 passed (4.5m)
12 passed (3.1m)
51 passed (19.3s)  # capture harness contracts
```

The final scrolled states had no automated Axe contrast violations, but each
Energy, Help and Vehicles capture had one incomplete warning badge; the Drives
captures also had an incomplete result-count label. A 360px dark/light context
recapture returned `6 passed (2.1m)`. The visible warning badge measures
7.99:1 dark and 5.88:1 light against its opaque background. After scrolling
the Drives label into view, its colors measure 8.73:1 dark and 7.31:1 light.
This does not resolve its original partial-overlap finding or certify other
viewport and scroll states.

Current `npx tsc --noEmit` exited 0 with no output; `npm run build` and
`npm run lint` both exited 0. Lint printed an upstream JSXEmptyExpression
diagnostic without failing. The Energy guideline audit reported zero
violations in all six categories and `TypeScript passes`. EnergyPage remains
1,620 → 1,642 lines
against `feature/app-design-themes`, with 0 → 0 `GlassPanel`/`ChartContainer`
matches, 4 → 4 `BatteryPanelGrid`, 4 → 4 `ChartCard` and 1 → 1
`OperationalBrief`.

A subsequent hook check initially reported two false missing routes although
both are registered. Its `grep -q` pipeline could return SIGPIPE under
`pipefail`; the fixed checker passed the full hook scan, and the large-route
regression passed while failing against the prior script. The isolated full
Vitest run is still in progress and has not established a passing suite.

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
