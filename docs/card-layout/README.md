# Shared card layout evidence

**Current V15 route matrix, captures, focused regressions and reviewed native
Windows comparisons pass; final PR workflows are pending.**
The twelve current AFTER images were refreshed from the frozen V15 mock build
and individually inspected. All twelve capture cases and twenty focused browser
cases pass with zero proxy escapes. Those checks include four formerly failing
linked Settings cells, six chart/fullscreen cases, two exact SVG geometry cases,
two notification pagination cases and six exact responsive CI replays.
Pagination requires native wheel scrolling and five-point hit tests, not merely
viewport intersection.

The shared fill fix respects authored block/hidden display instead of forcing
every relay to grid: only actual grid/flex parents replace native percentage
fill. The route guard now also checks the content allocation of single-card
relay cells, retaining padding and margins. Fourteen affected suites pass 177
tests; actual app, Node and affected browser TypeScript, full frontend lint and
the unchanged strict startup limit pass (399.8KB of 400KB).
V15 protects 145 source/config/fixture hashes, all twelve BEFORE images and
the original dist. The combined verifier accepts all 2,216 unique expected
records: 277 routes at 390/768/1280/1920px in both themes. Missing, unexpected,
duplicate and finding arrays are empty; all sixteen bounded wrappers pass
with zero proxy escapes. The interrupted original shard 12 is excluded;
its complete fresh rerun supplies that shard's acceptance records.
Seven Windows baselines are regenerated natively for the reviewed intended
dashboard and notification layout changes. Visual tolerances are unchanged.
The manual snapshot-update run 41018927032 is not comparison evidence:
it regenerated expected images and uploaded no updated-snapshot artifacts.
The temporary CI update mode has been removed; every Windows visual shard
again compares committed baselines unconditionally.
Prior strict run 41086199287 on `00638d611d` confirmed the baseline mismatch:
seven Windows snapshot-difference shards (1/5/10/13/14/17/56) and their
aggregate fail. All other code-head PR checks pass (192 successful, eight
failed, one skipped). The separate native large-fleet readiness job passed
its isolated unchanged rerun after trace review and a passing nonvisual
Linux readiness replay. No snapshot comparison was waived or updated from
CI artifacts. The original mirror's four unrelated untracked HTML files
remain untouched; it was not synced while dirty.

## Native Windows baseline provenance

After the user's renewed continuation, a separate clean mirror at
`D:/repos/teslasync-pr223-visual-20261030` isolates the native visual work
from the original mirror's unrelated files. It clones pushed `fa4da80703`,
uses Windows Node 26.8.1, npm 11.19.0 and locked Playwright 1.63.0, restores
missing dependencies once, and builds the mock application once in 43.86s.
Every visual command runs on Windows, with `E2E_MOCKS=1`,
`E2E_REUSE_BUILD=1`, `CI=true`, `TZ=UTC` and a separate 20-minute bound.

Native comparison first reproduces the mobile dashboard's intended 951-pixel
difference. Only reviewed shards 1/5/10/13/14/17/56 are regenerated, one at
a time, producing exactly seven changed PNGs. All seven old/new images were
inspected: dashboard variants remove nested shortcut borders, while notification
variants retain all evidence rows and the intended Inbox navigation.
The native-generated light-mobile, light-notification and forced-colors images
are also byte-identical to the reviewed CI actuals; no CI actual was copied
into an expected baseline.

Strict native comparison then passes all thirteen cases in those seven shards,
with zero proxy escapes. Two additional native notification pagination tests
verify wheel scrolling, interaction and five-point unobscured hit testing in
both themes. Both exposed-footer images were inspected. TypeScript also passes.
Only the seven generated PNGs are copied into WSL for commit; the isolated
mirror is returned to a clean tracked tree afterward.

## Prior V11 acceptance

**V11 complete route matrix and visual review passed.**
All 277 routes pass at 390/768/1280/1920px in both themes: 2,216 unique
passing records, no missing/unexpected/duplicate records or findings.
All sixteen bounded wrappers pass, 512 browser cases with zero proxy escapes.
All seventeen previously failing browser cases now pass, with all 71 unique
target/neighbor records clean and zero proxy escapes. At that acceptance, all
twelve AFTER captures used the frozen v11 build and passed their source-isolation
assertions. All 24 images were visually inspected with no new shared-layout regression.
The V10 review caught detached legend markers despite passing containment:
a new browser regression reproduced 155px marker-to-text gaps. Shared
intrinsic grouping now gives 12px gaps at 390/1280px in both themes.
The original eleven BEFORE images remain unchanged; a twelfth pair adds
a populated dashboard.
Earlier v4/v8 images and failing route receipts remain in session artifacts,
not as current acceptance.
Power and elevation plots now fit their allocated cards without overlapping
following sections. Earlier rejected overflow images and their failing geometry
receipts remain preserved in the session's `bug3-card-layout/v1-regression/`
artifacts; they are not the current AFTER images.

The `before-*-1280-dark.png` images capture the existing production `web/dist`
before the shared-layout changes. They use the existing synthetic dashboard,
analytics and drive-detail fixtures, not a backend or production data. The seven
routes are `/`, `/drives/412`, `/analytics`, `/charging`, `/battery`, `/energy`
and `/settings`. These are Linux evidence images, **not Windows snapshot
baselines**. The application owns an inner scrolling region, so the images show
the initial viewport rather than pretending to include every offscreen section.

The shared mechanism stretches single-card grid wrappers to their natural row
height, without percentage-height chains or filler heights. ChartCard delegates
its visible title, help, actions and optional statistics to one ChartContainer
header/anatomy. Download and fullscreen controls share the owning card header;
fullscreen returns their ownership to the expanded figure.
SourceContent empty bodies are centered within the remaining LayoutCard body.
Aligned card rows share intrinsic header/statistics/body/footer tracks through
CSS subgrid: longer titles or descriptions determine the row, not a hardcoded
minimum height. Embedded charts in an ordinary LayoutCard place their canonical
toolbar in the host header; fullscreen returns the controls to the figure.
Empty-state checks use the source's remaining local allocation after neighboring
controls and metadata, not unrelated content in another evidence column.

The declarative contract is `Grid`/`CardGrid` plus `Card layout`,
`CardHeader`, `CardContent` (`layoutSlot="summary"` for optional statistics),
and `CardFooter`. LayoutCard and ChartCard participate automatically.
`CardContent as="section" layoutSlot="column"` declares a semantic nested
column, used by the shared EvidencePanel without changing its three sections.
Shared empty states also register their native grid column, keeping short
messages centered in the remaining space beside populated evidence.
ChartContainer names its header, summary, plot, accessible caption and annotation
slots. `card-layout.css` owns track sizing and logical gutters. A shared context
registers semantic single-card wrappers as relays to the nearest Grid; it neither
measures pixels nor flattens/reorders markup, and leaves wrappers with independent
controls intact. Native grid adoption requires opted-in surfaces in every cell;
a transparent one-child grid relay cannot become a competing row owner.
Slot styling never depends on a `div > div > figure` depth.
DataTable can opt into the same header/summary ownership with `cardLayout`;
ordinary tables retain their inline toolbar. MetricGrid uses container width,
and FlowGrid preserves its complete node/connector sequence while changing
orientation when its cells cannot fit the shared minimum width.

Query containment belongs to leaf slots, not the subgrid boundaries: inline-size
query containers impose layout containment and prevent borrowing intrinsic rows.
Fluid embedded charts share their host's space with its heading instead of
requesting 100% of the host plus that heading. Explicit chart heights,
responsive sizing, download and fullscreen/restore behavior remain supported.

`web/e2e/route-layout-guard.smoke.spec.ts` retains the existing width,
overflow, text-wrapping and timezone checks. It additionally records card
geometry and checks row holes, top alignment, title/action alignment, sibling
statistics/plot offsets and short empty-state placement, in both themes.
It also verifies that chart frames, plots, responsive viewports and SVG surfaces
fit their containing allocation, catching the previously rejected vertical spill.
390px is added without removing the previous widths. Per-route JSON includes
the actual rectangles and violations; `GUARD_ARTIFACT_DIR` can direct these
receipts outside Playwright's cleaned output directory.

## Capture manifest and inspection

The eleven pairs below are 1280 × 900, dark theme, Chromium on Linux. Each listed stem has
both `before-<stem>-1280-dark.png` and `after-<stem>-1280-dark.png`:

| Stem | Scope and inspected result |
| --- | --- |
| `dashboard` | Synthetic E2E quick-navigation layout; disconnected-account notice and links retained. This is not a full production dashboard-widget fixture. |
| `drive-detail` | Initial Overview only: route, endpoint evidence and page actions remain visible. |
| `analytics` | Recorded summary values retained; chart titles, icons, download and fullscreen actions now share one header row. |
| `charging` | Empty selected-range state, retry and metric controls remain visible; no populated charging-series claim. |
| `battery` | Pack-health metrics, source notices and review action retained. |
| `energy` | Consumption/cost metrics and missing-measurement disclosure retained. |
| `settings` | Preferences and quick-action cards retained. |
| `drive-energy` | Scrolled energy/range evidence, values and source/method disclosures. |
| `drive-cost` | Scrolled cost/savings table; unavailable gas comparisons remain unavailable. |
| `drive-power` | Plot fits its card; summary, time-weighted method disclosure and top-right download remain visible; following elevation card does not overlap. |
| `drive-elevation` | Dual-axis plot and legend fit their card; following temperature card is separate, with its source-aware summaries retained. |
| `dashboard-populated` | Additional 1280 × 1600 owner-dashboard pair with eight real catalogue-backed widgets; uses the app's Auto arrange control, not a second preview page. |

The additional populated pair uses the canonical eight-widget owner
composition. It seeds the existing catalogue sources, then uses the real
Customize, Auto arrange and Done controls on `/`. Both captures' console,
page, API and explicit unmocked-outbound assertions pass; the owning app
remains honestly disconnected from a Tesla account. This is an initial
1600px-high viewport, not proof that offscreen widgets fit.

The original seven BEFORE PNGs were SHA-256 checked before and after this
refresh and remain byte-identical. Additional BEFORE captures came from
unchanged `web/dist`; final AFTER captures reused the consolidated
`E2E_MOCKS=1` build in `web/e2e/.app-dist`, without rebuilding during capture. Capture runs
used one browser worker, `E2E_REUSE_BUILD=1 CI=true TZ=UTC`, and synthetic API
and map responses. No production service was contacted.

The seven refreshed viewport captures and four scrolled captures per build
passed their existing error/unmatched-request/network-escape assertions.
The additional populated-dashboard pair passes the same source-isolation
checks. All 24 capture diagnostic records report zero errors, unmatched
mocks and network escapes. The final v11 inspection covers all twelve pairs
and resolves the rejected v10 legend regression. Its acceptance remains
limited to the captured synthetic Linux/dark viewports, including their
documented crops, empty sources, date drift and map-background differences;
it is not a Windows baseline or all-width visual approval.
The first exploratory scrolled selector matched navigation/overview labels;
it was replaced with exact source-section headings and all four BEFORE
sections were recaptured and inspected, without relaxing assertions.

The preserved older charging image says Oct 16–22, 2026; the v8 image says
Oct 17–23. The relative UTC preset crossed a date boundary between sessions.
Both show an empty selected range; this pair is layout evidence, not an
identical-clock pixel baseline. The power summaries also reflect the separate
time-weighted calculation change, so they are not numerical pixel baselines.

## Bounded verification

- Shared layout/consumer suites: 649 tests passed; another adapter group passes
  92 tests, including one overlapping FlowGrid case.
- Parent fixture/date/source-trust suites: 361 tests passed, including 214 exact
  fixture contracts. All 7,728 frozen localization contracts pass after all
  370 calls across six changed producers were verified and the sanctioned
  generators regenerated receipts.
- Actual app/guard TypeScript and full frontend lint exited 0.
- V10 adds 387 passing targeted tests in 18 suites; the parent's completed
  annotated-title fixture passes all 28 ChartContainer tests. The full lint
  command initially caught that test's absent tabular data, then passed after
  adding the real score fixture rather than a suppression.
- The deduplicated affected run passes 43 suites / 1,317 tests. After the
  shared legend correction, all 59 focused ChartLegend/ChartContainer tests
  and six real chart-fit/fullscreen cases pass. The glyph-to-marker check
  measures actual text nodes, not a misleading full-width label box.
- The frozen V11 mock build completes in 48.11 seconds. App TypeScript,
  targeted guard/fixture/chart TypeScript and full frontend lint pass.
  The broad existing E2E project still reports legacy library/declaration
  configuration and unmodified caller errors; it is not claimed clean.
- Whole-source audit reports 35 pre-existing findings: 33 raw controls and two
  direct imports. All 21 affected files are byte-identical to pre-BUG3
  `adc001fea8`; no new finding belongs to this work. The earlier displayed
  eleven-file count was truncated, not the complete unique-file inventory.
- Real chart fit/fullscreen/restore: six browser cases passed, with zero fit
  violations, errors, unmatched mocks or network escapes.
- All 277 unique real routes pass the 1280px/dark preflight, with zero missing,
  duplicate, layout, runtime, unmatched or escape findings. All four wrappers
  pass. Earlier v4 samples with unmatched requests are not the current gate.
- The actual debugger passes all 12 existing width/theme variants, including
  all eight required variants; its former geometry and timestamp findings
  are both zero. Together with chart-fit tests, 18 browser cases pass.
- All 17 original failing width cases pass on v10: 71 unique records,
  zero geometry/readability/timezone/runtime/unmatched/escape findings.
- Seven V11 AFTER viewport, four scrolled and one populated-dashboard
  capture pass with zero proxy escapes. All 123 frozen changed source/fixture
  hashes, twelve BEFORE hashes and both build indexes remain unchanged.
- Final frozen V11 matrix: 2,216 / 2,216 unique expected records pass across
  all 277 routes and eight required variants. All sixteen wrappers pass;
  missing, unexpected, duplicate and issue arrays are empty. Runtime,
  unmatched-source and proxy-escape checks remain active. All owned preview
  processes and temporary capture specs are stopped/removed.

## Source preservation

Read-only comparison against `13d4e6dbc0` follows each page's recursive
same-feature production component imports, including extracted components
but excluding tests and shared library code. All twenty-two measured scopes retain at least
70% of their original lines and preserve their semantic sections and primary
surface openings. These scopes overlap: do not sum them as unique repository
lines. Source openings are not rendered instance counts.

| Page scope | Feature lines before / after | Semantic sections before / after | Primary surfaces before / after |
| --- | --- | --- | --- |
| State debugger | 2645 / 2649 | 3 / 3 | 23 / 23 |
| Developer tools | 3701 / 3702 | 3 / 3 | 11 / 11 |
| API playground | 1074 / 1074 | 4 / 4 | 8 / 8 |
| Firmware canary | 1000 / 1000 | 4 / 4 | 3 / 3 |
| Energy flow | 959 / 959 | 1 / 1 | 9 / 9 |
| Sleep efficiency | 3239 / 3240 | 17 / 17 | 17 / 17 |
| Battery passport | 3734 / 3734 | 14 / 14 | 14 / 14 |
| SQL playground | 612 / 614 | 2 / 2 | 3 / 3 |
| HVAC cycling | 2098 / 2100 | 14 / 14 | 13 / 13 |
| Automation builder | 2859 / 2859 | 0 / 0 | 7 / 7 |
| Vehicle detail | 2844 / 2837 | 0 / 0 | 20 / 20 |
| Ingest X-ray | 1011 / 1013 | 2 / 2 | 5 / 5 |
| Drive score | 1650 / 1650 | 9 / 9 | 16 / 16 |
| Drive detail | 3939 / 3945 | 2 / 2 | 28 / 28 |
| Driving dynamics | 4100 / 4100 | 7 / 7 | 37 / 37 |
| Charge advisor | 1738 / 1738 | 2 / 2 | 2 / 2 |
| Parking analytics | 1895 / 1900 | 9 / 9 | 8 / 8 |
| Driving rhythm | 1946 / 1946 | 4 / 4 | 8 / 8 |
| Home-energy orchestrator | 1317 / 1317 | 0 / 0 | 7 / 7 |
| Power flow | 934 / 934 | 5 / 5 | 9 / 9 |
| Charging curves | 1744 / 1743 | 5 / 5 | 18 / 18 |
| Battery degradation | 1433 / 1436 | 2 / 2 | 14 / 14 |

EvidencePanel's three raw `section` tags became semantic `CardContent
as="section"` declarations, not removed sections. Card/ChartCard replacements
are included when comparing the former GlassPanel/ChartContainer surfaces.

These are synthetic-source review receipts, **not Windows snapshot baselines**.
The complete 277-route matrix at 390/768/1280/1920px in both themes passes
on frozen V11: 2,216 unique records across sixteen clean shards.
This does not claim Windows platform-baseline or current-head CI acceptance.
The completed additional v8 dark diagnostic has all 831 unique expected
390/768/1920px records: 814 pass and 17 expose real findings on 14 routes.
There are no missing, duplicate or unexpected records, runtime errors,
unmatched mocks or proxy escapes. The failures concerned shared chart
containment/anatomy, mobile ingest timestamps and six narrow passport
metrics. They remain preserved red evidence, not accepted layout results.
The bounded v9 source checkpoint adds 404 passing unit tests, clean app
TypeScript/scoped lint and a 49.88-second build. Replaying all seventeen
failed browser cases passes nine and fails eight, with zero proxy escapes.
It confirmed six repaired route scopes; two motor surfaces still spilled
20px and seven other route variants remained. V10 resolves all seventeen
cases without changing the guard. V11 additionally resolves the visually
detached legend and passes the complete 2,216-record final acceptance gate.
