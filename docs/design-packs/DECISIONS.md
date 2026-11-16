# Design Pack Decisions

### Pixel Cockpit final-matrix evidence

The pinned matrix reported `1014 passed, 2 failed`. Both phone dashboards
reported protected twin targets and text, plus a 12px Charge Status distance
unit. All 1,016 PNGs passed signature, chunk-CRC and viewport-dimension
checks. The v7 phone selector now covers owned stat-card units and context,
without changing protected or specialized surfaces.

```text
V7_DISTANCE_BROWSER_EXIT=0  # 2 passed: dark/light, three phone widths, scales and forced colors
V7_PRESERVATION_EXIT=0      # 12 passed
FRONTEND_TSC_EXIT=0
TOUCHED_ESLINT_EXIT=0
```

The two dashboard pages were recaptured against current Vite source. Both
still failed on protected twin targets and text, but the small unit was no
longer reported. Their PNG integrity and dimensions were verified, though
the initial viewport does not include that card. The matrix and recaptures
represent mixed builds, not full acceptance.

### Generated-artifact Git output

CI at `23e0cf85c9` failed its generated-artifact gate when `git ls-files -z`
exceeded Node's default synchronous child-process output buffer. The Git
wrapper now allows 64 MiB and reports the underlying spawn error without
printing truncated stdout. The regression creates 10,000 virtual tracked
files and verifies both tracked-file and worktree listings over 1 MiB.

```text
FRESHNESS_LARGE_INDEX_RED_EXIT=1  # reproduced the truncated Git listing
FRESHNESS_CONTRACT_EXIT=0         # 11 passed
FRONTEND_TSC_EXIT=0
FRESHNESS_TEST_ESLINT_EXIT=0
FRESHNESS_SCRIPT_SYNTAX_EXIT=0
```

The complete generated-artifact gate is running in a separate detached
worktree so ongoing screenshot writes cannot affect its mutation check.

### Expressive Form final-matrix evidence

The pinned matrix reported `1014 passed, 2 failed (49.5m)`. Both phone
dashboards reported protected twin targets and text as well as a 12px Charge
Status distance unit. All 1,016 PNGs passed signature, chunk-CRC and viewport
dimension checks. A focused regression reproduced the unit at 10.2px at
360px and scale 0.85; the v6 phone selector now covers owned stat-card units
and context without changing protected or specialized surfaces.

```text
PHONE_DISTANCE_FINAL_EXIT=0  # 4 passed across v4/v6, dark/light, phone widths, scales and forced colors
V6_PRESERVATION_EXIT=0       # 121 passed
FRONTEND_TSC_EXIT=0
E2E_TSC_EXIT=0
TOUCHED_ESLINT_EXIT=0
```

The two fixed dashboard pages were recaptured against current Vite source.
Both cases still failed on protected twin targets and text; the small unit
was no longer reported. Their PNG integrity and dimensions were verified,
but the initial viewport does not include that card. The matrix and
recaptures therefore represent mixed builds, not full acceptance.

### Iconic Showroom final-matrix evidence

The pinned matrix reported `1013 passed, 3 failed (49.1m)`: the two
protected dashboard widget cases and the 430px Digital Twin page landmark.
All 1,016 PNGs passed signature, chunk-CRC and dimension checks. The page-only
square-corner repair was subsequently checked without screenshots at 360 and
430px in dark and light themes: `4 passed (4.2m)`. The older matrix images
and the unresolved protected widget findings are not full acceptance.
The repaired 430px page alone was recaptured against the newer build:
`1 passed (2.3m)`, with PNG integrity and dimensions verified. The resulting
evidence is mixed-build.

### Executive Concierge charge unit

The pinned matrix reported a 12px `km` unit on both phone dashboards. A
screenshot-free diagnostic identified the unprotected Charge Status stat
card. The v4 phone selector now gives owned stat-card units the same
body-size token as headline units, without changing protected surfaces.

```text
CONCIERGE_DISTANCE_EXIT=1  # 360px pack-review-charge-status distance unit: 12px
CONCIERGE_DISTANCE_MATRIX_EXIT=0  # 2 passed (2.2m)
CONCIERGE_PRESERVATION_EXIT=0  # 3 files, 19 passed, 504 skipped
```

The browser retry covered dark/light, 360/390/430px, scales 0.85/1/1.35
and normal/forced colors, including unit containment and document overflow.
The two phone dashboards were recaptured against the newer build. Both
cases still failed on protected twin targets and text, but no longer
reported the `km` unit. Their PNGs passed integrity and dimension checks;
the initial viewport does not include the corrected card. The protected
twin findings remain open.

### Latest Docker preview

The committed frontend at `cead512118c7` was built into the immutable image
`teslasync-web:design-packs-v2-cead512118c7`. The candidate passed health,
asset, authentication-proxy and initial-route browser checks before replacing
the task-owned preview at `localhost:3120`. The previous container remains
stopped for rollback.

```text
PREVIEW_BUILD_SHA=cead512118c7 PREVIEW_BUILD_EXIT=0
PREVIEW_HEALTH=healthy INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200
PREVIEW_BROWSER width=360  http=200 main=visible overflow=0 pageErrors=0
PREVIEW_BROWSER width=430  http=200 main=visible overflow=0 pageErrors=0
PREVIEW_BROWSER width=1440 http=200 main=visible overflow=0 pageErrors=0
SYSTEM_HEALTH_PROXY_HTTP=503
```

These are initial-route smoke checks, not all-page acceptance. The later
Pixel Cockpit charge-unit fix is not in this image.

### Previous Docker preview (`f9c93755bfa2`)

The committed frontend at `f9c93755bfa2` was built into the immutable image
`teslasync-web:design-packs-v2-f9c93755bfa2`. A separate loopback candidate
passed its Docker health check, index, static-asset and authentication-proxy
checks, then replaced the task-owned preview at `localhost:3120`. The
previous container remains stopped for rollback.

```text
PREVIEW_BUILD_SHA=f9c93755bfa2 PREVIEW_BUILD_EXIT=0
PREVIEW_HEALTH=healthy INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200
PREVIEW_BROWSER width=360  http=200 main=visible overflow=0 pageErrors=0
PREVIEW_BROWSER width=430  http=200 main=visible overflow=0 pageErrors=0
PREVIEW_BROWSER width=1440 http=200 main=visible overflow=0 pageErrors=0
SYSTEM_HEALTH_PROXY_HTTP=503 BACKEND_HTTP=503
```

These are initial-route smoke checks, not all-page acceptance. The later
Expressive Form charge-unit fix was not in this image and needs a new build.

### Earlier Docker preview (`98debceb5a8b`)

The committed frontend at `98debceb5a8b` was built into the immutable image
`teslasync-web:design-packs-v2-98debceb5a8b`. A separate candidate passed its
Docker health check, index, static-asset and authentication-proxy HTTP checks.
The live task-owned preview at `localhost:3120` was then replaced, retaining
the previous container for rollback. Its frontend and proxy returned 200; the
existing backend health endpoint still returned 503.

```text
PREVIEW_BUILD_SHA=98debceb5a8b PREVIEW_BUILD_EXIT=0
PREVIEW_HEALTH=healthy INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200 BACKEND_HEALTH_HTTP=503
PREVIEW_BROWSER width=360 main=visible horizontalOverflow=0
PREVIEW_BROWSER width=430 main=visible horizontalOverflow=0
PREVIEW_BROWSER width=1440 main=visible horizontalOverflow=0
PREVIEW_BROWSER_PAGE_ERRORS=0
PREVIEW_BROWSER_EXIT=0
```

The candidate's gallery check passed for all pack thumbnails. The first
no-flash test used a different, stale default E2E build and failed to observe
the preference request; rerunning against the extracted image assets reported
`1 passed (26.7s)`. The unmocked candidate rendered visible main content at
360, 430 and 1440px with zero page errors and document overflow. These checks
do not establish full-app visual or accessibility acceptance.

### Precision Ledger destination metrics

The pinned matrix exposed a split word in the 360px destination brief. An
initial wider label column still split words at the largest text scale, so
Precision Ledger now stacks labels above their right-aligned values on phones
while retaining the ruled ledger and the desktop side-by-side layout.
Protected widget compositions are unchanged.

- Chromium dark/light destination checks across 360, 390 and 430px, three
  font scales, forced colors and desktop: `2 passed (1.6m)`.
- The screenshot-free matrix route check reported `4 passed (9.9m)` at 360
  and 430px in both themes.
- The pack-preservation suite reported `1 file, 120 tests passed`.
  The original matrix images predate this change; fixed-route captures and
  cross-browser verification remain outstanding.
- The scoped Precision Ledger stylesheet audit reported `No violations found`.
- Full frontend lint and its registered audits completed successfully:

  ```text
  [audit-registry] 42 audit script(s) on disk, 42 active (2 thresholded), 3 manual report(s), 1 archived
  [audit-registry] OK — every audit is registered, executable, thresholded and wired
  [release-identity] OK — release threads VITE_APP_VERSION + VITE_GIT_SHA + VITE_RELEASE_BUILD into the single build-scan/export step; compose uses its own opt-in variables and unversioned builds stay unparseable and harmless
  PHONE_FIXES_FULL_LINT_EXIT=0
  ```

The pinned final matrix subsequently finished Precision Ledger with
`1013 passed, 3 failed (52.5m)`: the two preserved dashboard twin cases and
the 360px destination brief fixed above. Each viewport produced 254 PNGs;
all 1,016 passed signature, chunk-CRC and exact-dimension checks. The first
integrity script incorrectly assumed 360px captures were at least 844px high;
the corrected check used the configured 360x800 viewport. The inspected
destination phone, dashboard desktop and notification tablet images are
older than the fixes and are not visual or contrast acceptance.

### Horizon final-matrix evidence

The Horizon run against the pinned `445e5bb317b1` assets reported
`1012 passed, 4 failed (58.6m)`. Both phone Dashboard failures are the
preserved widget findings. The 430px Digital Twin page landmark failure was
fixed and passed the screenshot-free 360/430px retry below. The tablet
Dashboard timed out; its screenshot-free retry reported `2 passed (4.1m)`.
The original failures remain part of the matrix evidence.

The run produced 254 phone-360, 254 phone-430, 253 tablet and 254 desktop
PNGs. All 1,015 passed signature, chunk-CRC and viewport-dimension checks;
the original tablet Dashboard image was missing. A later capture against
`98debceb5a8b` recovered that image and replaced only the repaired Digital
Twin page images at 360 and 430px. All three new PNGs passed integrity and
dimension checks. The other images predate later fixes; this mixed-build
evidence does not establish visual acceptance. The matrix continues.

### Horizon Digital Twin page targets

Horizon overrides the ordinary square-corner utility on the transparent
touch controls in `/digital-twin`, clipping a charge-port landmark. The
page-only touch target now explicitly keeps square corners. The protected
dashboard and mini widgets continue to use their original geometry.

- Screenshot-free Horizon route checks at 360 and 430px: `2 passed (5.7m)`.
- Digital Twin and pack-preservation Vitest: `3 files, 462 tests passed`,
  with existing motion warnings; focused ESLint exited 0.
- The scoped VehicleTwin audit reported `0 violations` in all six checks and
  `TypeScript passes`. The protected dashboard phone failures remain open.

### Notification health phone axes

The fatigue and burn-rate charts now measure phone-axis labels using the
owned body-size token. Desktop and unowned charts retain their existing
layout. Long rule labels can be abbreviated on the chart; the data table
retains the complete rule names.

- A later isolated Firefox run found the fatigue score's `100.00` tick
  clipped at 360px. Phone chart margins now reserve measured space for
  localized endpoint ticks. Isolated retries passed in Chromium dark/light
  and custom German typography (`3 passed`), Firefox dark (`1 passed`) and
  WebKit custom German typography (`1 passed`); the WebKit check reported
  `BROWSER_PROBE_API_ESCAPE=0` and `SCREENSHOT_COUNT=0`. These checks also
  retain the desktop and unowned chart assertions.
- The current notification component and raw-bridge Vitest selection
  reported `4 files, 159 tests passed`, with existing Recharts zero-size
  warnings.
- The notification feature guideline audit reported `0 violations` in all
  six categories and `TypeScript passes`; the scan included 131 TSX files.
- Edge geometry checks at 360, 390 and 430px, three font scales, dark,
  light and custom typography, and four packs: `3 passed (1.5m)`.
- `npx tsc --noEmit`: exit 0; `npx tsc --noEmit -p e2e\tsconfig.json`:
  exit 0 before the later capture-diagnostic edit.
- The notification hook verification found 36 URL patterns and reported
  `ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES`.
- `npm run lint`: exit 0; targeted notification and Command History Vitest:
  `4 files, 129 tests passed`, with Recharts zero-size warnings.
- The Windows Firefox browser was absent and its installation timed out.
  Cross-browser verification will use the existing isolated browser image.

### Notification latency chart phone axes

The app-owned phone histogram now uses measured horizontal categories and a
height derived from the body-size token. All six ranges remain visible; the
tooltip and data table retain their complete values. Desktop and unowned
charts keep their existing presentation.

- Chromium geometry checks for all four notification health charts reported
  `3 passed (3.6m)` across 360, 390 and 430px, three font scales, dark,
  light and custom German typography; three additional packs were checked at
  360 and 430px. The custom fixture includes 1,000 deliveries.
- Targeted latency Vitest reported `2 files, 67 tests passed` with existing
  Recharts zero-size warnings; app and E2E TypeScript exited 0.
- The project audit reported zero violations in all six categories and
  `TypeScript passes`. The separate `audit_code` tool incorrectly identified
  the shared `Table` imported from `@/components/ui` as raw HTML.
- An earlier browser run failed strict mock accounting for aborted requests;
  the clean retry above passed without relaxing those assertions.
  The current measured-margin cross-browser retries are listed above.

### Classic matrix and capture continuation

The resumed Classic matrix completed with `1014 passed` and `2 failed
(3.0h)`. Both failures are the protected dashboard Digital Twin on phone,
whose existing controls and text do not meet the requested 44px and 16px
minimums. No protected geometry was changed. The 956 newly saved Classic
PNGs passed signature, chunk-CRC and viewport-dimension checks, but preserved
older images make this mixed-build evidence, not visual acceptance.
`/period-compare` and six standalone routes remain excluded.

The capture runner can now resume `--pack all` after a named pack without
restarting the shared server or overwriting existing screenshots. Its focused
tests reported `6 passed` and its ESLint and syntax checks exited 0. The
remaining matrix was started after Classic with four workers, using assets
copied from Docker image `teslasync-web:design-packs-v2-445e5bb317b1`.
It is not a completed or passing matrix.

### Current CI follow-up

On pushed head `876619a52e`, frontend shards 1 and 3 passed after the catalog
repair. Shard 7 failed one Grafana editor test that checked persisted
storage immediately after the editor changed, although persistence runs in
a React effect. The test now waits for both the empty editor and the removed
draft without changing application behavior. The full Grafana page and
manual-editor tests reported `25 passed`; the formerly failing case passed
three additional runs. Shard 8 separately failed a Journey departure hint
visibility assertion; its enclosing entry animation starts at zero opacity.
The test now waits for the real hint to become visible and still checks its
accessible description and exact zone exclusions. Local verification reported:

```text
 Test Files  2 passed (2)
      Tests  25 passed (25)
GRAFANA_TEST_EXIT=0

 Test Files  1 passed (1)
      Tests  14 passed (14)
JOURNEY_ZONE_TEST_EXIT=0

GRAFANA_CLEAR_REPEAT_EXIT=0
JOURNEY_HINT_REPEAT_EXIT=0
FRONTEND_TEST_LINT_EXIT=0
FRONTEND_TYPESCRIPT_EXIT=0
```

Each repeat ran three times; the Journey suite emitted a Node
`MaxListenersExceededWarning`. A subsequent full frontend lint run completed:

```text
OK — no direct date/time formatting outside the shared layer (3859 files scanned)
[audit-registry] OK — every audit is registered, executable, thresholded and wired
[release-identity] OK — release threads VITE_APP_VERSION + VITE_GIT_SHA + VITE_RELEASE_BUILD into the single build-scan/export step; compose uses its own opt-in variables and unversioned builds stay unparseable and harmless
FULL_LINT_EXIT=0
```

The frontend quality run on that same head subsequently finished with a
WebKit desktop isolation failure: the custom-font case failed all three
attempts, while the light case passed on its second retry. The exact
comparison reported a 0.5px table-row height difference and matching sampled
styles; its cause remains under investigation. The replay reported
`46 passed, 1 flaky, 1 failed` and `E2E preview proxy escape check: 0 errors`.
The three engine aggregates failed because they include that design job.

The security and Lighthouse workflows completed successfully at that head;
the security workflow warned that GitHub could not retrieve the full
300-file PR diff. The CI aggregate and frontend coverage merge failed because
the frontend shards failed, so the PR is not green.

## Catalog preservation and preview refresh

PR head `445e5bb317` failed frontend test shards 1, 3 and 7 because the two
new speed-heatmap legend keys were not projected out before historical catalog
fingerprints were checked. The projection now verifies their exact values
before removing them; the predecessor counts and digests are unchanged.
The regression checks the actual widget calls, generated catalog, retained
historical legends, and rejection of altered or missing new copy.

```text
Test Files  12 passed (12)
     Tests  7766 passed (7766)
CATALOG_PRESERVATION_EXIT=0
CATALOG_FINAL_TSC_ESLINT_EXIT=0
I18N_AUDIT_EXIT=0
```

The committed `445e5bb317b1` application was built into the local Docker
preview. The candidate's first browser run passed two checks but failed the
startup check because that test had loaded an older `e2e/.app-dist`. The
startup check passed when rerun with assets extracted from the candidate
image; the deployed image then passed all three browser checks using those
same assets. No screenshots were taken. The previous preview remains stopped
as `teslasync-design-packs-rollback-87afae094c6e-445e`.

```text
PREVIEW_IMAGE_BUILD_EXIT=0
CANDIDATE_HEALTH=healthy INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200
CANDIDATE_STARTUP_EXIT=0
PREVIEW_HEALTH=healthy INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200
3 passed (3.5m)
LIVE_PREVIEW_BROWSER_EXIT=0
LIVE_PREVIEW_REAL_BROWSER_EXIT=0
PREVIEW_HEALTH_HTTP=503 BACKEND_HEALTH_HTTP=503
```

The live browser check covered the initial route at 360, 430 and 1440px with
no page errors or horizontal overflow; it is not an all-page acceptance
check. The existing backend health failure is unchanged. The catalog fix
touches tests only, so the preview contains the current application source.

## Sampled speed-heatmap periods

The captured light and custom heatmaps distinguished zero-speed samples from
missing periods by only 1.067:1 and 1.073:1 respectively. Sampled SVG cells now
have a token-colored, non-scaling outline; missing cells do not. The legend
identifies that outline and describes stronger color rather than claiming that
higher speeds are always brighter. The reviewed Classic light detail is
`shots/classic/review/light-speed-heatmap.png`. This is a focused crop, not a
replacement for the unfinished page matrix.

```text
Heatmap and i18n preservation contracts: 4 files, 869 tests passed
Split-catalog and i18n loading contracts: 4 files, 167 tests passed
Edge: 4 pack/theme heatmaps at 360, 390, 430 and 1440px plus cancellation contract: 5 passed (2.9m)
WebKit: Classic light and Blueprint custom heatmaps, repeated twice: 4 passed (7.9m)
Scoped SpeedHeatmapWidget guideline audit: 0 violations
Widget nonblank lines: 348 before, 351 after; chart/panel references: 3 before, 3 after
Final-source TypeScript, changed-file ESLint, i18n lint, service-worker typecheck,
isolated production build and four postbuild checks: HEATMAP_V2_BUILD_CHECKS_EXIT=0
npm run lint after the final test-wait and catalog-key correction: HEATMAP_V2_FULL_LINT_EXIT=0
useDriving hook verification: 28 paths matched, DRIVING_HOOK_VERIFY_EXIT=0
```

The phone dashboard intentionally shows the existing compact peak reading
instead of the full heatmap. The focused browser test checks that behavior and
containment without changing it. The fixture accepts `GET /pinned?type=vehicle`
as cancelled only when its matching client abort and network failure are both
observed; other queries and methods remain failures.

The first Firefox/WebKit heatmap run had seven passes and one failure. WebKit
Classic light timed out waiting for the application DOM to settle, before
reaching the heatmap assertions. A two-repeat WebKit follow-up passed once and
failed once after resize while the widget measured two pixels wide outside the
viewport. The focused test now waits for the same containment assertion to
pass after responsive reflow and allows 20 seconds for DOM settling; it does
not waive containment. The subsequent two-repeat check passed for both
Classic light and Blueprint custom, with `BROWSER_PROBE_API_ESCAPE=0` and
`SCREENSHOT_COUNT=0`. The earlier attempts do not establish the cause of the
delay, and these focused checks do not certify every pack or page.

The original higher-speed legend is retained in the historical English
catalog; the revised copy uses a new key. Replacing the historical value
failed its preservation contract before that correction.

The exact desktop WebKit comparison previously differed by 0.5px in a table
row. A focused custom/1440 probe including real portal interactions passed
under Memphis and Blueprint (`1 passed (8.0m)`, `BROWSER_PROBE_API_ESCAPE=0`,
`SCREENSHOT_COUNT=0`). All sampled descendant table styles and geometry agreed
in that run. A separate collapsed-table probe did not reproduce a size change
from fractional vertical position. Neither result establishes the cause of the
earlier difference; the exact comparison remains in place and the next CI run
is required. Three engine aggregate checks failed because their shared design
matrix included the five WebKit failures, not because their smoke shards failed.

## Desktop WebKit heatmap evidence

The `2b2aef0093` WebKit 1440px light and custom jobs failed both the
dashboard heatmap-paint check and mixed-pack isolation. The existing custom
failure image shows a correctly ordered heatmap, but its recorded sample
coordinates came from a different SVG geometry than the captured image.
Mapping the SVG viewBox into that image gives the maximum, middle, zero and
missing samples as `[156,106,222]`, `[93,69,135]`, `[31,33,48]` and
`[23,28,37]` respectively. This confirms a measurement mismatch for that
image; the light failure and other packs still need the exact CI rerun.

The paint sampler now maps cell centers through the captured image's
`xMidYMid meet` viewBox, retaining the actual-pixel ordering assertions.
A synthetic regression simulating a capture-time resize failed in Chromium,
Firefox and WebKit before the change and passed afterwards. The synthetic
tests create no stored PNG files:

```text
Before: 3 failed
After: 12 passed (47.1s)
SCREENSHOT_COUNT=0
E2E_TYPESCRIPT_EXIT=0
FOCUSED_ESLINT_EXIT=0
```

The exact dark 390px isolation phase also passed on retry:
`1 passed (3.9m)`, `BROWSER_PROBE_API_ESCAPE=0`, `SCREENSHOT_COUNT=0`.
Desktop isolation and the next CI run are not yet verified.

## WebKit preview restoration follow-up

The failing CI isolation checks compared the preview before inherited styles
had consistently settled. The browser contract now waits for the restored
map-pane leading, chart-legend colors and icon font sizes, then retains the
exact owner and composition comparisons. Neutral error wrappers are checked
before comparing previews under different outer packs. These checks do not
establish why WebKit sometimes reports stale inherited values.

The focused dark and custom 390px checks passed in an isolated WebKit
container. The exact custom CI isolation phase also passed, but the exact dark
phase timed out clicking the Quiet preview before reaching the comparison.
Host CPU utilization was 100% during that attempt; its effect on the timeout
is unproven. An earlier exact-phase run could not change scope because
network-isolated WebKit reports `navigator.onLine=false`. The explicitly
opt-in `E2E_REVIEW_ONLINE=1` setting supplies an online state only to the
synthetic review; offline product behavior is unchanged.

```text
Focused WebKit dark/custom at 390px: 2 passed (3.9m)
Exact WebKit 390px mixed-pack isolation, dark/custom: 1 failed, 1 passed (5.1m)
BROWSER_PROBE_API_ESCAPE=0
SCREENSHOT_COUNT=0
E2E_TSC_EXIT=0
FOCUSED_ESLINT_EXIT=0
Scoped app-design audit: 0 violations; TypeScript passes
```

At that point the dark exact phase, other viewport/theme combinations, and
the next CI run were unverified. Sensitive-mode isolation runs suppress their
explicit preview screenshots; normal CI evidence capture is unchanged.

## Full Vitest snapshot

The immutable frontend snapshot at `243a4c319943` completed:

```text
Test Files  2947 passed (2947)
     Tests  101822 passed | 4 skipped (101826)
FULL_VITEST_EXIT=0
```

Later commits changed several pack stylesheets and browser-test files, so
this is not a full-suite result for the latest source. On PR head
`2b2aef0093`, all eight frontend test shards, merged frontend coverage,
frontend lint and frontend build report success; other browser jobs are
still running and later local changes have not been pushed.

## Cyber grid intersection contrast

The original Cyber canvas painted two translucent grid layers over each other.
For the light Vehicles breadcrumb, a conservative calculation at their
intersection gives 4.284:1 against the actual canvas and muted-text colors;
whether a glyph covered an intersection in the earlier scan was not
established. The canvas now uses one conic-gradient layer for the same
96px grid, with pack-owned size and line-width tokens, so the two traces no
longer compound. The orchestrator added the required resets for those inherited
tokens at preview boundaries; neutral and other-pack previews must not inherit
Cyber grid geometry. The corresponding calculated worst case is 4.886:1.
This does not resolve the earlier incomplete Axe nodes or certify every
background and text combination.

```text
Edge: preview-token isolation and Cyber Vehicles at 360/430px, light/dark: 5 passed (22.0s)
Firefox/WebKit: the same checks: 10 passed (2.6m)
BROWSER_PROBE_API_ESCAPE=0
Old built CSS: focused light 360px regression failed, 2 layers instead of 1
Current CSS: focused light 360px probe passed, calculated ratio 4.885835
Light 360px Axe: Energy 0 violations/7 incomplete; Vehicles 0/16 incomplete
Cyber preservation: 3 files, 9 tests passed, 192 skipped
npx tsc --noEmit: exit 0
npx tsc -p e2e\tsconfig.json --noEmit: exit 0
npm run typecheck:sw: exit 0
focused ESLint and three scoped guideline audits: exit 0
isolated current-source Vite build and four postbuild checks: exit 0
npm run lint: exit 0 before the final test-fixture import and timeout changes
final focused ESLint and E2E TypeScript: exit 0
```

Firefox and WebKit were unavailable in the Windows cache; after two launch
attempts failed before running a test, the repeat above used the existing
network-isolated Linux browser image and an isolated production build. An
initial final-source repeat reported ten passing tests but an escaped
`/api/v1/export/jobs` request during teardown, so it was not accepted. The
test now uses the guarded page fixture; the subsequent repeat above had no API
escape. No screenshots were taken, and broader contrast and visual review
remain open.

## Committed charger preview

The local preview was rebuilt from commit `0fae1a58ab97`. Its candidate was
checked on an unused loopback port before replacing the task-owned 3120
container; the preceding container remains stopped for rollback.

```text
PREVIEW_BUILD_EXIT=0
CANDIDATE_HEALTH=healthy INDEX_HTTP=200 ASSET_HTTP=200 AUTH_HTTP=200
PREVIEW_HEALTH=healthy INDEX_HTTP=200 ASSET_HTTP=200 AUTH_HTTP=200
360px, 430px, 1440px: HTTP 200, main visible, 0 page errors, 0 document overflow
SYSTEM_HEALTH_HTTP=503
```

The browser checks used the live initial route and took no screenshots.
The existing backend health endpoint still reports the Tesla API unhealthy.

## Charger details on phones

The scoped phone-text scan missed the charger breakdown's session count and
cost rate, which rendered at 12px. Owned charger metadata now uses the shared
phone body-size token and its rows can wrap. Terminal's chart keeps inset edge
rules without a background image, so its charger text can be contrast-tested
without changing chart dimensions. The mobile typography rule excludes
explicitly protected content.

Screenshot-free Edge checks of three charger categories passed in all 27
packs at 360px and 430px, in light and dark modes, at font scale 1.35:
all six metadata values per page met the size floor and stayed within the
chart, and the document had no horizontal overflow. Terminal also passed the
same checks at scale 1; its chart's automated color-contrast audit had no
violations or incomplete nodes at either scale, width or mode. A synthetic
contract verified the 0.85 scale floor, protected content and desktop sizing.
This covers the charger panel, not every text element or route.
The phone-text scanner now includes these charger captions, with a regression
for undersized protected and unowned samples.

```text
charger contract and phone checks: 9 passed (2.0m), including all 27 packs
in four scale-1.35 scenarios
Terminal Digital Twin preservation at 360/430px: 2 passed (46.3s)
Terminal energy check-only capture at 360/430px, scale 1.35: 2 passed (57.8s)
  0 contrast violations; one short-content node per viewport requires review
EnergyPage, DataTable and AppDesignBridge: 3 files, 62 tests passed
npm run lint: FULL_LINT_EXIT=0 (before final focused scanner changes)
npx tsc --noEmit: exit 0
npx tsc -p e2e\tsconfig.json --noEmit: exit 0
npm run typecheck:sw: exit 0
isolated vite build and four postbuild checks: exit 0
```

The light-mode sweep below used earlier built CSS. No screenshot was taken
for these checks.

## All-pack light phone sweep

The earlier build completed the three-route check in light mode:

```powershell
Set-Location web
$env:DESIGN_PACK_CHECK_ONLY='1'
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_CHECK_CONTRAST='1'
$env:DESIGN_PACK_DIST_DIR='D:\repos\teslasync\web\dist'
node scripts\capture-design-packs.mjs --pack all --pages vehicles,drives,energy --viewports phone-360-light,phone-430-light --base-url http://127.0.0.1:54872 --workers 1
27 packs: 6 passed each
162 contrast checks: 0 violated rules, 64 incomplete nodes
ALL_PACKS_LIGHT_PHONE_EXIT=0
```

The 64 incomplete results are not contrast passes: Cyber had 43, Terminal
12, Ambient and Atlas three each, Swiss two, and Precision Ledger one.
The subsequent Terminal charger-panel checks above resolved the twelve
reported Terminal nodes in the tested scenarios; the other 52 results still
need review. The scoped phone-text scan missed the charger captions described
above, so neither sweep establishes full-page text-size compliance.

## Three-route phone sweep across all packs

A screenshot-free sweep of Drives, Energy and Vehicles at 360px and 430px
in dark mode completed for all 27 packs:

```powershell
Set-Location web
$env:DESIGN_PACK_CHECK_ONLY='1'
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_DIST_DIR='D:\repos\teslasync\web\dist'
node scripts\capture-design-packs.mjs --pack all --pages vehicles,drives,energy --viewports phone-360,phone-430 --base-url http://127.0.0.1:54872 --workers 2
27 packs: 6 passed each
ALL_PACKS_THREE_ROUTES_EXIT=0
```

The runner enabled its scoped visible-touch-target and body-text checks, with
0.1px tolerance, but did not scan contrast. These mock-data checks do not
establish visual acceptance, every interaction state, other routes, light
mode or other font scales. The check-only capture safety changes were made
while the sweep was running, so this is not a single immutable harness
revision. Its CSS matched the then-current Docker preview before the charger
follow-up; its index and JavaScript assets differed.

## Screenshot-free preservation and WebKit follow-up

Check-only capture now disables Playwright failure screenshots and traces.
The Digital Twin preservation check still compares geometry, but does not
create, remove, attach or replace images in that mode. It also honors the
configured shots root when image capture is enabled.

```text
npx playwright test --config=playwright.contract.config.ts --grep 'check-only capture disables screenshots and browser traces'
1 passed (3.0s)

npx playwright test --config=e2e\design-packs-capture.config.ts --project=phone-390 --grep 'preserve the two Digital Twin widgets'
1 passed (43.7s)
TWIN_SENTINELS_UNCHANGED=True

node --test scripts\__tests__\capture-design-packs.test.mjs
tests 5, pass 5, fail 0
```

The four sentinel files were isolated task-owned fixtures, not review images.
The Twin run used `DESIGN_PACK_CHECK_ONLY=1`, the existing local server and
an isolated shots root. The guideline audit reported no violations in the
capture configuration, capture spec and harness contract.
No application page or API hook changed in this follow-up.
The preservation check does not resolve the protected twins' small phone
controls or text.

Repeated isolated WebKit preview attempts remain blocked. An earlier custom
phone run had one exact owner-restoration geometry mismatch; a later
two-repeat run timed out during clicks on the source-quality filter and
the second outer pack's preview button. The host reported 100% CPU during
that run, but the cause is not established. Neither run took screenshots;
the restoration assertion has not been weakened. Defer this issue while
other checks continue, then revisit it after the active sweeps finish.

The subsequent two-repeat real-app WebKit run reported `4 passed, 2 failed
(10.2m)`. Both failures were at 1440px: one source-quality-filter click timed
out, and one exact-restoration comparison found changed chart geometry and
legend inheritance after owner restoration. A separate motion diagnostic
failed earlier while waiting for the synthetic outer pack selection to apply,
so it captured no click-motion samples. No screenshots were taken. The cause
is still unproven; do not treat these failures as a pass or attribute them
solely to host load.

The pending acceptance helper now yields browser frames between stability
samples, and the nested-dialog check waits for focus to return before the
next interaction. Exact owner, geometry and style comparisons remain in
place. The synthetic owner and Quiet-grid contracts passed. A post-sweep
Firefox/WebKit real-app repeat reported `4 passed, 2 failed (9.7m)`: Firefox
custom-phone could not find the preview after its click, and WebKit desktop
again differed in chart geometry and inherited legend color after restoration.
The restored legend color matched its parent's computed color, while the
pre-probe child color differed from that same parent. The cause is unproven;
the assertions remain enabled and no API requests escaped the fixture.

```text
npx playwright test --config=playwright.contract.config.ts --grep 'owner activation|Quiet preview sizes' --workers=1
10 passed (44.1s)
OWNER_CONTRACT_EXIT=0

npx tsc --noEmit
exit 0
npx tsc -p e2e\tsconfig.json --noEmit
E2E_TYPESCRIPT_EXIT=0
npx eslint e2e\harness.contract.spec.ts e2e\widget-design-packs.acceptance.ts e2e\widget-design-packs.app.spec.ts --max-warnings 0
FOCUSED_ESLINT_EXIT=0
```

## Precision Ledger phone follow-up

A screenshot-free `v3` check covered Drives, Energy and Vehicles at 360px and
430px in light and dark modes:

```text
12 passed (3.5m)
V3_PHONE_CHECK_EXIT=0
```

All 12 scans reported zero Axe contrast violations. Both 360px Drives scans
also reported one incomplete node: Axe could not determine the background of
the sticky `4 results` summary because of a partial overlap. A screenshot-free
context check in that same scrolled state found an opaque ancestor, no
intervening background image, filter or opacity, and the label was the top
hit at nine sampled points. Its computed foreground/background pairs were
8.73:1 in dark and 7.31:1 in light. This resolves only the sampled state, not
other scroll positions or visual acceptance.

The local build used for the Pixel and Precision phone checks has the same
12 CSS asset names and SHA-256 hashes as Docker preview `fdcd380f40`; its
index and JavaScript assets differ. Neither check covers the protected twin,
other pages, or the complete final matrix.

## Pixel phone follow-up

A screenshot-free Pixel Cockpit (`v7`) check covered Drives, Energy, and
Vehicles at 360px and 430px in dark and light modes:

```text
Contrast: 0 violated rules, 0 nodes require manual review
12 passed (3.2m)
V7_PHONE_CHECK_EXIT=0
```

The contrast result was repeated for each of the 12 cases. It does not cover
the protected dashboard, other routes, or visual acceptance.

## Parallel review capture

The shared preview/dev server is owned by the orchestrator. The pack capture
runner accepts a pack, page list and viewport-project list and requires an
already-running local server; its Playwright configuration never starts one.
For pack reviews it saves one viewport image per page and project, scans the
scrolling content without saving extra frames, and keeps each pack's test
artifacts separate. Existing stitched images are historical evidence. The
two-round limit applies to subsequent per-pack reviews, not past captures.
Viewport-only reviews save the settled initial view before detailed assertions,
so a failing geometry check can still be inspected. A saved image is not a
pass; the capture command's complete diagnostics remain authoritative. Use
the explicit default font scale suffix for new spot checks to keep historical
viewport and stitched images intact.
Begin with eight isolated pack workers and refill each slot as it finishes.
This keeps browser and build load bounded on the shared machine; it is not
an eight-pack completion gate.
Additional workers may implement their owned stylesheets while the browser
slots are occupied; they must wait for an explicit capture release.
The initial Vite process watched Playwright trace files, reloaded active
reviews and exited with `EBUSY` on a locked `.network` trace. The orchestrator
restarted the same local origin with the transient capture-artifact directory
excluded from its watcher and confirmed HTTP 200. An interrupted invocation
still counts toward the affected pack's two-round cap; its missing or failed
evidence must be reported, not silently replaced.
Capture invocations now use a unique temporary Playwright output directory
outside the Vite root and remove that directory after completion; the
requested review images remain under `shots`. Direct use of the capture
configuration also defaults outside the Vite root. Workers restricted to
project-local scratch can set `DESIGN_PACK_CAPTURE_OUTPUT_ROOT` to their own
existing pack shots directory; the runner creates and removes only its unique
child. Roots inside `web` are rejected. The focused runner tests reported:

```text
tests 4
pass 4
fail 0
```

For the final matrix, `DESIGN_PACK_SHOTS_ROOT` can point at a separate
directory so existing review images are not overwritten. Playwright's
`--list` reports 255 eligible capture cases per viewport and pack: the
requested 27-pack, four-width matrix therefore contains 27,540 cases before
the excluded standalone routes. Listing cases is not a screenshot run.

The shared server later exited with `EBUSY` while watching a task-owned
Memphis browser profile under `web`. The orchestrator restarted the same
origin with dot-directory scratch excluded from the watcher and verified
HTTP 200. Workers were told to keep browser profiles outside `web`, count
interrupted invocations, and preserve the two-round cap. No unrelated
processes or files were stopped or removed.

The first eight dashboard captures were compared side by side without taking
new screenshots. Horizon Loft looked too close to Classic and Concierge, and
Precision Ledger too close to Studio. Their owners were sent back for
pack-only, screenshot-free differentiation; the existing images predate
those refinements and are not proof that the distinction is resolved.
After eight committed packs, the existing Classic, Studio, Horizon, Showroom,
Expressive, Pixel, Motorsport and Blueprint phone dashboards were compared
without another capture. Studio/Pixel show denser technical frames, Motorsport
uses an italic heading and directional rule, and Blueprint has a drafting
grid; Horizon and Showroom still appear close in the saved views. Those views
precede subsequent refinements, so Showroom was sent for a pack-only,
screenshot-free showroom composition refinement, not a claimed visual pass.
The next eight existing 390px dashboard images (Ambient, Precision, Concierge,
Terminal, Editorial, Quiet, Warm and Analog) were compared without another
capture. Terminal's prompt-like geometry, Editorial's masthead, Ambient's
separation and Analog's concentric framing were visible. Precision, Quiet and
Concierge remained too similar in these saved views; Precision was sent back
for a stronger ruled-ledger header and aligned action zone. The comparison
images predate several subsequent fixes, so neither the new distinction nor
the other packs' full-page distinctiveness is established by this check.
The next eight existing phone dashboards (Atlas, Bauhaus, Material, Swiss,
Observatory, Glass, Deco and Kinetic) were compared side by side. Material and
Glass both read as rounded, filled floating headers with pill-like stacks.
Glass was sent for a screenshot-free, owner-only refinement toward a lighter
architectural sheet with a reflected edge; the saved images predate that
refinement and cannot establish the result. Glass's subsequent dark/light
DOM checks and 44 focused tests passed without new screenshots; see its
review for their scope. The current-source full unit run was stopped early
so the refinement would not change files beneath it and has been restarted
after the stylesheet stabilized.
The remaining Neo Brutal, Cyberdeck and Memphis phone dashboards were also
compared with Expressive, Pixel and Motorsport. The saved views show Brutal's
heavy frame, Cyberdeck's technical rules and Memphis's patterned geometry;
some screenshots predate later fixes and do not establish full-page
distinctiveness.
Precision Ledger and Executive Concierge exceeded the 45-minute slot. Both
were asked to stop and reported their incomplete evidence; this runtime did
not expose an agent-kill operation. No concurrent replacement was allowed to
edit either owned stylesheet while its worker was still active. Concierge's
single retry is screenshot-free because both capture invocations were spent;
the original Ledger owner is doing the distinctness follow-up.
Horizon Loft's original worker also exceeded its slot and was asked to stop;
it has now reported. This runtime exposes no agent-kill operation.
Motorsport, Blueprint, Editorial and Ambient were likewise asked to stop or
finish their in-flight bounded command and report at 45 minutes. No
replacement can edit their stylesheets while they remain active.
Terminal, Atlas, Analog and Observatory also exceeded their slots and were
asked to stop or finish their current bounded command and report. The old
full Vitest process was stopped after running for over 100 minutes against
an earlier source snapshot; it did not provide a complete final result.
Observatory's first worker stopped without taking screenshots or writing a
review; its one permitted retry owns the existing stylesheet and both
remaining capture invocations.
Atlas's original worker stopped after one failed capture round, without
finishing its review or fixes. Its single retry owns the stylesheet and may
use only the one remaining capture invocation.

The real phone bar was clipped when the lazy-loaded `sidenav.css` applied its
60px minimum after the app-design styles. The shared mobile layer now
overrides that minimum with the existing 44px touch token and controls the
shell's competing padding and gap. A screenshot-free regression loads the
real styles in that order and checks all 27 profiles at 360/390/430px, with
additional 400/401px, density, scale and safe-inset combinations for Classic
and Studio, in normal and forced colors. It checks bounds, overlap, whole
labels and status-bar reservation:

```text
2 passed (1.2m)
```

Headerless workbench sections no longer reserve an empty heading column; the
same browser run checks both headed and headerless sections. A separate
follow-up checks the equivalent hidden-heading case and reported:

```text
1 passed (1.8m)
```

The related navigation and design unit tests reported:

```text
Test Files  3 passed (3)
     Tests  72 passed (72)
```

These are synthetic contracts, not full-route or cross-browser acceptance.
The capture runner's invalid-pack test exited 1 as expected and left zero
new temporary output directories; its e2e TypeScript and focused ESLint
checks exited 0.

## Identity and existing preferences

Keep all 27 persisted IDs, names and aliases. The existing verified,
server-scoped preference remains authoritative: do not introduce a browser
cache that can apply another identity's choice. Pack presentation must compose
with the saved mode, accent, fonts, density and accessibility preferences
rather than overwrite them. Keep the existing Card, GlassPanel, DataTable and
ChartContainer APIs and owner isolation; add presentation roles at their
existing token boundary where necessary.

The existing chart palette preference owns actual series colors, including
colorblind-safe and neon choices; replacing it per pack would violate the
design contract and the instruction to preserve behavior. Pack roles therefore
style chart framing, grid and label ink while the existing palette hook keeps
series identities. This constraint is not proof of distinct per-pack palettes.
The shared phone layer extends the existing opted-in mobile grid and heatmap
patterns; it does not guess table identities, fields or privacy masks for
tables lacking a mobile presentation.

Pack sheets can compose four app-surface roles from the saved theme, alongside
the shared card, control, grid, chart, conversation, spacing and motion
roles. They must leave semantic surfaces, chart series and saved font settings
with their existing owners. This is a token boundary for pack work, not a
claim that every existing component or chart palette has been redesigned.

The first preview-isolation regression run exposed four Classic phone tokens
that were inherited by nested previews. Reset those tokens at the existing
preview boundary before dispatching pack work. The targeted preservation run
then reported:

```text
Test Files  4 passed (4)
     Tests  205 passed (205)
```

The latest browser contracts, including 27 synthetic profiles at
360/390/430px and normal/forced colors, reported:

```text
6 passed (15.5s)
```

These are component-level contracts, not rendered-route or contrast passes.

After the shared CSS changes, `cd web; npm run build` in the isolated
verification checkout exited 0:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

The later combined snapshot also built successfully with the default public
mapless output. Running `npm run perf:check` against that output failed
because strict locality checks require `VITE_SOURCEMAP_MODE=private`; it is
not a performance pass. A current-source private-map build then exited 0;
its strict check stopped because the Playwright headless browser was missing.
An isolated browser install failed after five CDN timeouts. The check was
retried with the documented `LOCALE_PROBE_EXECUTABLE_PATH` pointing to the
already-installed Chrome, without changing its assertions or budget. The
retry passed:

```text
[i18n-runtime] cold NotFound: 0 deferred locale requests
[i18n-runtime] missing namespace console errors: 0
[i18n-runtime] fallback locality OK — every route stayed inside its grouped-bundle allowance and request budget
[duplicate-modules] OK
[source-maps] OK — no publicly reachable source maps, serving path denies .map
PRIVATE_PERF_CHROME_EXIT=0
```

An actual dashboard geometry probe across the 27 packs found the saved layout
name clipped in Classic, Studio, Showroom, Pixel, Motorsport, Swiss and Deco
at all three phone widths; Cyberdeck also split the short caption at 360px.
A shared, owner-scoped phone rule now permits the saved name to wrap and
prevents the caption from shrinking. A screenshot-free recheck reached the
end of its geometry loop without reporting a layout failure, but the overall
browser test failed on a pending mocked auth-mode request. The gallery and
Energy browser checks likewise reported pending mocked requests in that run;
waiting for fixture quiescence did not resolve the accounting failure. A
third gallery diagnostic observed `net::ERR_ABORTED` for API requests in
the development build. Do not silence the accounting or count those runs as
passes. Against the current-source production snapshot, the gallery,
27-pack dashboard layout names, forced-colors Energy table, and no-flash
startup/reload browser checks passed with strict mock accounting:

```text
  4 passed (42.5s)
PRODUCTION_ACCEPTANCE_EXIT=0
```

The capture harness can also serve the built index and assets to the existing
local origin using `DESIGN_PACK_DIST_DIR`; it does not start or restart the
shared server or relax mock accounting.

The single final matrix was interrupted after its first 40 Classic 360px
cases: 27 passed and 13 failed. The failures include horizontally scrolling
data grids, undersized timeline and map targets, small body copy, and the
protected twins' existing phone geometry. Forty-three viewport images were
written, including in-flight cases; images alone are not passes. Fix the
observed breakages before continuing the uncaptured cases. The matrix includes
the previously unstable period-comparison route, but the six standalone routes
remain outside the identity-safe capture registry.

Initially, `DESIGN_PACK_SKIP_EXISTING=1` skipped existing images and their
diagnostics. The runner now preserves those images but still runs diagnostics
against the current build. An expected failure against an older build and a
pass against the repaired build both left the existing image hash unchanged.
Passing diagnostics do not establish that a preserved image depicts the
current build or retroactively pass an interrupted capture.

`DESIGN_PACK_CHECK_ONLY=1` reruns the same geometry, touch, text, contrast,
mock and browser-error checks without taking or changing screenshots. The
360px check-only run passed the 12 repaired Classic pages and retained the
existing dashboard image unchanged; the dashboard still failed on the
protected twins' original small controls and text. This does not establish
the other pages or packs.

The changed `app-designs` audit reported zero static inline styles, raw HTML,
direct library imports, old API imports, double prefixes and camelCase query
parameters; its TypeScript check passed. The hook verifier found 571 URL
patterns and reported `ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES`.
The capture change also passed `npx tsc --noEmit -p e2e\tsconfig.json` and
focused ESLint. The full Vitest run was stopped before the next source edits,
so it did not finish and is not a passing full run.

Use restrained, accessible depth and outlines rather than decorative colored
glows. The design contract requires semantic colors, focus visibility, reduced
motion and forced-color support regardless of the pack.

On phones, enforce a 16px minimum for Classic's body-role and brief prose even
when the saved font scale is below 1. Larger saved scales still apply, and the
saved preference is not changed. App-owned widget prose follows the same
floor; protected Digital Twin subtrees remain unchanged and need separate
resolution.
Use the same floor for page-owned field labels, field values and labeled
buttons to keep forms legible and avoid undersized mobile input text. The
browser contract checks the floor and protected-widget exclusion at the saved
scale extremes; production-route coverage is still in progress.
Apply the phone sizing and layout rules in forced-colors mode too, while
leaving system color and control-border treatment intact. A browser contract
checks the 16px floor at the smallest saved scale; full-page forced-colors
and fallback-table review are still required.

The shared WidgetShell is pinned by exact-source contracts. Its footer can be
identified as the sibling of the existing `widget-body` boundary, so use that
existing boundary instead of adding a new attribute to the pinned source.
The preliminary full Vitest run was stopped after reporting four failures
caused by that attribute; it did not finish and is not a passing full run.
The two affected source-contract files were rerun after restoring the pinned
source:

```text
Test Files  2 passed (2)
     Tests  776 passed (776)
```

The browser contract for the existing footer boundary also passed:

```text
1 passed (1.3s)
```

Preserve the exact-source i18n contracts on `Text`, `Tooltip`, `FreshnessDot`
and `ChartContainer`. Classic identifies existing body roles through their
canonical classes rather than changing `Text`'s markup. Enlarge actionable
page and app-owned widget freshness targets through owner-scoped CSS, including
their busy state; leave read-only and protected-widget indicators unchanged.
For app-owned local tooltips only, remove an
opacity-hidden or Escape-dismissed bubble from scroll layout; restore its
original positioning while active. This does not change the trigger, portal
or focus behavior. Body-class matching is a scoped diagnostic, not proof
that every kind of body copy has been identified.

For the weekly chart's forced-colors table, localize the mobile field labels
on the existing page section and inherit them into generated labels. This
preserves the shared chart's exact source and its native accessible table.
The normal data-table alternatives continue using their existing localized
cell attributes. Chrome checks cell names and labels; cross-browser behavior
remains unverified.

On narrow phones, Classic's bottom navigation uses two rows of whole labels
rather than splitting words or clipping them. Its reserved shell height
includes the saved text scale and bottom safe area; the status bar sits above
it. This trades content space for legible, thumb-reachable controls and does
not change the saved typography preference. The tradeoff remains a visual
defect to revisit as part of the full Classic review.

Classic's operational metric columns use a pack-owned minimum width that
scales with the saved font preference, falling back to one column rather
than breaking words inside narrow labels. The mobile workspace range trigger
shares the available width with vehicle selection and may grow vertically
for long or compared range labels. Its input keeps enough space for enlarged
action targets and the leading icon; both controls retain their existing
selection behavior. The 360/390/430px Energy captures exercise these controls
in both modes at 1.35 scale, including comparison and custom-range changes.
Longer vehicle names can still be truncated and need further review.

Use the existing mobile data-grid presentation for Energy's recent sessions:
retain the desktop columns, session-detail destination and data, and expose
all seven fields in Quick View. Classic's phone text floor applies to the
actual grid text classes as well as detail labels and values. Keep the compact
status bar's secondary status metadata separate from page body-link checks;
its links still participate in the touch-target and contrast diagnostics.
For Help, use the existing page and panel boundaries to compact the desktop
hero and enlarge contextual links without changing its source-locked markup.
The support-bundle JSON may wrap on phones without changing the copied text.
For a single charger category, Energy uses the existing 300px mobile chart
height instead of overriding the chart viewport's containment contract;
multiple categories retain the existing 420px height.

## Visual evidence

Use isolated synthetic API fixtures and block external requests for screenshot
reviews. The capture matrix uses 390 x 844, 768 x 1024 and 1440 x 900, plus
360 x 800 and 430 x 932 for the requested phone-width extremes. Include
production routes and known detail fixtures; missing fixtures, runtime errors,
overflow and incomplete captures are failures, not visual passes. Do not mark
a pack passed until its screenshots have been inspected and all requested
gates have actually run.

The API-hook verifier's route lookup used `grep -q` behind a pipe with
`pipefail`, occasionally treating a successful match as a failure when the
producer received SIGPIPE. A large-route-table regression reproduces the old
failure; feeding the matcher without that pipeline preserves genuine missing
route failures. No application endpoint or hook behavior was changed.

The application scrolls its `main` element rather than the document, so a
normal Playwright full-page screenshot only captures the first screen. Save
that unaltered screen as `<page>.png` and, when there is more content, save
`<page>--full.png` as a vertical sequence of actual viewport captures while
scrolling the main region. Repeated navigation and chrome in that sequence are
intentional; they do not represent a single continuous screen. Each attempt
clears that page's previous viewport and full images; a normal capture leaves
its separate interactive-table image intact. State captures clear the old
table image before attempting to replace it. Viewport-only matrix runs write
their first image after initial readiness, before later mock, browser-error,
overflow, touch and prose assertions. Other runs write after the mock,
browser-error and overflow checks. A saved image is defect evidence, not a pass.
The cleanup contract and a real Charging recapture verified that an existing
table image survives an ordinary run:

```text
2 passed (683ms)
1 passed (19.7s)
Interactive table unchanged: True
```

Composite or file-write
failures remove both outputs rather than leaving a partial page. Capture test
artifacts use a port-specific directory separate from the ordinary Playwright
output: an overlapping harness run removed two active trace files in the
390px probe, so those two results must be rerun. Set
`DESIGN_PACK_CAPTURE_OUTPUT_DIR` to a unique task-owned directory when
invoking the capture configuration directly, and pass a unique `--output`
directory to other Playwright commands in a shared workspace. The bounded
capture script now creates its own isolated temporary directory.

`DESIGN_PACK_CHECK_TOUCH=1` additionally fails a phone capture when a visible
interactive target is smaller than 44 x 44 CSS pixels. This is a diagnostic
for rendered states, not proof for unopened menus, off-screen overlays or
assistive technology. `DESIGN_PACK_CHECK_CONTRAST=1` runs Axe's contrast rule
and reports incomplete checks separately; incomplete findings require manual
review and are not passes.
`DESIGN_PACK_CHECK_TEXT_SIZE=1` checks visible unclassified paragraphs, explicit
body roles, feedback copy and history-row primary, route and inline metric
text, page links, mobile-grid text, operational metric labels, and Quick View
details against the 16px phone minimum. Explicit captions and other metric
labels are treated as metadata. It is a diagnostic, not proof for all
unclassified text, nested styles or unopened states.

At 360px, a lazy Battery chart's skeleton sat below the clipped main scrollport
but inside the browser viewport. The readiness check incorrectly waited for
that hidden skeleton. It now intersects activity with clipping ancestors; a
browser contract verifies that fully clipped loading is ignored and partially
visible loading must finish. The dark and light Battery recaptures then passed.

For the interactive Charging Patterns heatmap, keep every weekday/hour slot,
the existing roving keyboard order, detail popover and data table. On phones,
wrap each day into six-hour rows with 44px targets instead of horizontally
scrolling a 24-column chart. On coarse-pointer tablets, choose balanced
six-, eight-, twelve- or twenty-four-hour rows from the plot's available
width and stack the native data table. The chart viewport follows its
content's height on touch devices; fine-pointer desktop sizing is preserved.
The 768px touch-tablet dark/light production captures passed geometry,
keyboard, open-table and overflow checks, with 20 incomplete Axe nodes per
mode. A forced-colors tablet capture found 12px fallback captions and
headers; the responsive rule was extended and the production recapture
passed in both modes. One Axe node per forced-colors capture still requires
manual review. Incomplete Axe findings are not contrast passes.

The Observatory review found a six-column chart fallback scrolling sideways
in phone forced-colors mode. Chart fallback tables now opt into the existing
mobile stacked-table presentation and carry the localized column label on
each cell; native table headings and values are retained. The labels use the
phone body-size token. A real Observatory `/energy` fixture at 360, 390 and
430px passed its semantic, label and horizontal-overflow checks:

```text
1 passed (6.1s)
```

The live-thumbnail phone test also passed separately. A synthetic contract
passed for all 27 profiles at 360/390/430px, three font scales, and normal and
forced colors. These checks do not prove every route or chart is free of
overflow or contrast defects.

The current capture excludes `/connect`, `/glance`, `/onboarding`, `/s/:token`,
`/watch` and `/year-review/:year`: those standalone routes do not all use the
authenticated shell or its verified design bridge. Their coverage and
identity-safe theming remain unresolved and block a full-app pass.

### Final-matrix recovery

The interrupted first Classic 360px matrix recorded 27 passing and 13 failing
cases and saved 43 images, including unfinished cases. Those files remain
evidence rather than proof of a pass. Mobile grid, typography and layout fixes
were followed by an explicit recapture of the 12 repaired pages at 360, 430,
768 and 1440px:

```text
48 passed (3.9m)
REPAIRED_AUDITS=48 AUTOMATED_RULE_FAILURES=0 INCOMPLETE_NODES=184
```

The incomplete contrast nodes need manual review. A screenshot-free 360px
diagnostic also passed those 12 pages; the protected dashboard remained a
failure. The final matrix resumes with `DESIGN_PACK_SKIP_EXISTING=1`, which
preserves old files but does not convert an earlier failure or interrupted
case into a pass. Only the pages explicitly repaired were recaptured. A
12-failure threshold stops further capture churn so new failures can be
investigated. The previously documented period-comparison route remains
temporarily excluded.

The resumed Classic run stopped at its 12-failure threshold: 40 passed,
42 existing images and their diagnostics were skipped under the earlier
resume behavior, three cases were interrupted and 919 did
not run. The failures include several horizontally scrolling tables, an
overflowing heatmap, small interactive targets, one contrast failure, one
small body-text finding and a live-signals fixture that did not settle.
These are not full-pack passes.

After repairing the non-protected findings, a screenshot-free check of those
11 Classic routes at 360px and 430px against the current isolated build
reported:

```text
22 passed (2.9m)
MOBILE_CHECK_EXIT=0
```

The automated contrast audit found no violated rules in those checks, but
two chart-label nodes on notification health still require manual contrast
review. This is not a pass for other routes, other packs or the protected
Digital Twin. The shared native treatments now exclude semantic-tone surfaces
and descendants; the native-consumer and preservation suites reported
148 and 327 passing tests respectively.

The same 11 routes were recaptured at 360 and 430px:

```text
22 passed (1.8m)
```

Those are initial-viewport images, not full-page visual approval. Inspection
found explanatory copy rendered as 12px captions around operational briefs
on feature flags, telemetry coverage, developer tools and the state debugger.
The phone stylesheet now treats those immediate brief siblings as body prose
using `--app-body-size`, while preserving compact metadata inside the brief,
desktop typography and protected widgets. The text diagnostic also checks
those siblings; real-route checks and replacement images are separate gates.
The first development-server recheck reported `6 passed, 2 failed`: the
360px feature-flags and coverage cases each recorded a pending auth-mode
request in the strict fixture audit. A serial retry failed both for the same
reason; neither failure is treated as a visual pass. A third, screenshot-free
check against the updated production build passed both routes with zero
violated or incomplete Axe contrast nodes:

```text
2 passed (21.1s)
```

The development-server request-accounting discrepancy remains unexplained.
The four changed routes were recaptured against the production build at
360px and 430px:

```text
8 passed (2.4m)
```

All eight initial views were inspected. The coverage page rendered its long
destination explanation as a small caption, visible at 430px; that was a
separate body-text defect, not covered by the brief-sibling rule. Its
destination, legend and orphan-warning explanations now use body paragraphs
instead of caption roles; the existing phone body token governs their size.
The existing source-preservation receipt records these exact reversible
presentation changes and continues to check the original translation calls,
bindings and control flow.
After the receipt was updated, the related preservation suites reported:

```text
Test Files  4 passed (4)
     Tests  2104 passed (2104)
```

The page's regression suite and a screenshot-free 430px route check reported:

```text
Test Files  1 passed (1)
     Tests  19 passed (19)
1 passed (30.6s)
```

The route check found no violated or incomplete Axe contrast nodes. It does
not verify the orphan-warning state visually. The corrected page was then
recaptured against the updated production build at 360px and 430px:

```text
2 passed (14.9s)
```

Both initial views in `shots/final-coverage-body/classic` were inspected. The
destination explanation is now body-sized where visible at 430px; the
orphan-warning state and below-fold appearance were not visually reviewed.
The two-row phone navigation takes substantial vertical space, some headings
and actions wrap, and a temperature-impact value wraps. Chart text at 11px is
also a legibility concern.

For the two incomplete Classic notification-health chart labels at 430px, a
screenshot-free DOM inspection found opaque `rgb(132, 144, 162)` text over
`rgb(17, 21, 28)` with no overlapping filled SVG shapes. Their calculated
contrast is 5.66:1 in that observed state. This resolves only that measured
foreground/background pair, not other chart labels or the remaining Axe
incomplete findings.

Kinetic had assigned a length to the unitless `--app-content-density`
multiplier, invalidating shared spacing calculations. Its multiplier is now
unitless while its existing local gaps still use the density-gap length.
Quiet now explicitly supplies its previous default multiplier. A browser
contract checked all 27 multipliers and Kinetic's computed spacing:

```text
1 passed (5.4s)
```

### Temporarily skipped: period comparison capture

The initial 390px probe, a targeted phone/desktop retry, and an isolated
desktop diagnostic all failed to settle `/period-compare`. The browser trace
recorded 250 successful `/api/v1/settings` reads in about 10 seconds, with
repeated query-observer subscriptions. Do not mask the churn or change API
behavior as part of this visual-only work. Skip this route temporarily and
revisit it at the final gate; it has no passing screenshot evidence.

A screenshot-free development diagnostic traced the churn to the existing
inline Recharts tooltip renderer in `PeriodDeltaChart.tsx`: repeated
`ChartTooltipBase` mounts subscribe to settings again. In 12 seconds the
instrumented page recorded 117 settings requests and 340 tooltip-content
mounts. Both the chart and tooltip sources match `feature/app-design-themes`;
changing this pre-existing request behavior is outside the visual-only scope.
The diagnostic itself is not a route or screenshot pass.

### Current-source validation

The mobile prose change passed its two browser contracts, including 360/390/
430px, reduced and enlarged font settings, forced colors, desktop and the
protected-subtree boundary:

```text
2 passed (4.9s)
```

An additional synthetic browser contract loaded the 27 pack sheets at 360px
and 430px, with reduced/enlarged font settings and normal/forced colors,
and checked brief-sibling and in-panel explanations plus protected/metadata
exclusions. Together with the shared phone and diagnostic contracts:

```text
3 passed (24.7s)
```

`npx tsc --noEmit`, the browser-harness TypeScript check and targeted ESLint
exited 0 with no output. The complete hook verifier reported:

```text
  Found 571 unique URL patterns
  Found 888 route patterns
  ✅ ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES
HOOK_AUDIT_EXIT=0
```

The coverage page retained 399 lines and four panel tags against the source
branch. The scoped shared-design violations audit reported:

```text
✅ ALL CHECKS PASSED — 0 total violations
VIOLATIONS_AUDIT_EXIT=0
```

An isolated build with the exact updated mobile stylesheet and coverage page
reported:

```text
[pwa-precache] OK — route chunks remain on-demand
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
BUILD_EXIT=0
```

Full lint on the preceding snapshot reported `LINT_EXIT=0`; targeted lint
also passed for the later coverage and preservation edits. A prior-snapshot
full test run and a separate current-source full test run are in progress;
the focused contracts and updated build cover the phone and coverage changes.

### Mobile evidence follow-up

The shared phone treatment now stacks the populated archetype evidence and
candidate tables, preserves their localized column labels, and gives the
candidate viewport enough height for the stacked rows. The weekly punchcard
retains all 168 cells and localized accessible labels without a horizontal
phone scroller. Drive-detail, parking, Powershare and API-log tables opt into
the existing mobile presentation rather than changing their data or actions.
Drive and physics action links use the shared touch-size treatment.

A production build was made from an isolated snapshot after all 34 modified
frontend files were copied and their hashes matched the working tree:

```text
[pwa-precache] OK — route chunks remain on-demand
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

With that build served through the existing local origin, screenshot-free
checks of populated `/drive-archetypes` and `/drives/412` at 360px and 430px
reported:

```text
4 passed (1.8m)
```

The earlier development-server retries intermittently left a mocked
`/api/v1/system/auth-mode` request pending; the production checks passed
without relaxing request accounting. These four checks do not establish
contrast or other routes. A broader Classic 360px sweep is in progress.
Nine changed routes were recaptured at 360px and 430px on that pre-subtitle
build, with the mobile overflow, touch and text diagnostics enabled:

```text
18 passed
```

Inspection of the parking capture found another undersized chart subtitle.
The shared chart now exposes a subtitle marker and the owner-scoped phone
layer gives that copy the existing body-size token, excluding preserved
widgets. The browser contracts check this treatment across all 27 pack sheets
and its protected boundary:

```text
3 passed (18.8s)
```

The focused chart test reported:

```text
Test Files  1 passed (1)
     Tests  1 passed | 30 skipped (31)
```

Those synthetic checks do not replace a production recapture. The updated
build and full lint are in progress. A later source review retained the
mobile grid's Quick View columns, stabilized its presentation props, and
used the SI duration converter without changing the displayed minutes.
The relevant component and preservation tests reported:

```text
Test Files  10 passed (10)
     Tests  966 passed (966)
```

Inspection of the existing Driving Rhythm and Physics phone images exposed a
small explanatory caption and a clipped selected investigation. The former
now uses a body role; the latter also exposes its full translated title below
the native chooser. Their focused component tests reported:

```text
Test Files  2 passed (2)
     Tests  8 passed (8)
```

The added browser check requires that title to be visible, body-sized and
unclipped. These changes still require production recaptures.

The case-sensitive scan of the 18 changed production feature files reported:

```text
raw interactive HTML: 0
static CSS-variable inline styles: 0
direct chart/map or old API imports: 0
double API prefix: 0
camelCase vehicle query: 0
```

The audit extension also flagged six archetype and seven drive-detail
`<Table>` uses as raw tables; the reported elements are the shared
`@/components/ui` component, not lowercase `<table>` elements.

The latest production-snapshot recaptures covered those nine routes at both
phone widths (`18 passed`) and Energy Orchestrator at all four target widths
(`4 passed`). Empty source notices no longer introduce 140px of blank space.
The desktop capture revealed a split battery-switch label; its new browser
assertion failed against the earlier snapshot as expected. The refreshed
Docker build passed the four-width recapture (`4 passed`) and the corrected
images were inspected.

The API logs scope explanation measured 12px on the prior Docker build.
Three explanatory texts now use the shared body role, while compact counts
remain metadata. A new browser check failed on the old build as expected;
the updated Docker build passed the 360px and 430px checks:

```text
Contrast: 0 violated rules, 0 nodes require manual review
Contrast: 0 violated rules, 0 nodes require manual review
2 passed (36.7s)
```

Both initial viewport images were inspected. The explanatory copy is below
the initial viewport, and the two-row 360px navigation still takes substantial
space; these checks do not establish coverage of all interaction states.

A screenshot-free Classic diagnostic checked the 2FA, privacy, sessions,
data-quality and feature-flags routes at both phone widths:

```text
10 passed (1.8m)
```

This run checked scoped touch targets, text size and overflow, but did not
perform a contrast or visual review. A broader phone diagnostic excluded the
known protected dashboard and `period-compare` and stopped at its three-failure
limit:

```text
3 failed, 1 interrupted, 402 did not run, 90 passed (12.2m)
```

At 360px, Quick Stats had four 14px body readings; Range Buffer and Redis
Signals had horizontally scrolling data grids. Classic now uses the phone
body-size token for those readings. Range Buffer and Redis Signals use the
shared mobile grid, with their original columns available in Quick View.
Redis coordinate summaries stay masked until explicitly revealed.

The three repaired routes passed screenshot-free checks at 360, 390 and
430px in both color modes (`18 passed`). Focused mobile and privacy unit
tests on the current source report `24 passed`. A later interactive browser
run reported `10 passed, 2 failed`: one mock request remained pending and
one page lost its execution context. Both failed cases passed individually
on retry. After correlating client cancellation with the failed request, a
screenshot-free run against the refreshed Docker image covered both routes at
360, 390 and 430px in both modes:

```text
12 passed (4.0m)
MOBILE_INTERACTION_FINAL_EXIT=0
```

These are interaction and geometry checks, not a visual or contrast pass.

The historical preservation checks now verify the exact touch-token and
accessible chart-brush successors before restoring their pinned predecessor
bytes. Their targeted tests report `778 passed`. The independent native-card
and dialog-consumer contracts report `59 passed`, and pack/native surface
preservation reports `222 passed`. These checks do not replace the missing
full unit suite or visual review.

The capture runner can now select every canonical pack with `--pack all`
and optionally set `--workers`; its focused safety tests report `5 passed`.
Explicit `--exclude-pages` values are validated against the route registry
(`1 passed` selection contract); omitted routes are not counted as passes.
The final matrix remains incomplete, and `period-compare` and the six
standalone routes remain explicitly unverified.

The task-owned Docker preview is isolated at `http://localhost:3120` and
uses the existing backend. Its index, entry asset, API version route, browser
render at phone and desktop widths, and container health passed. The existing
upstream system health endpoint reports the Tesla API component unhealthy; the
preview does not change or repair the backend. A startup-readiness race
triggered a rollback on the first replacement attempt; waiting for Docker
health succeeded on the second. The latest image was independently
preflighted and deployed with the previous preview retained for rollback. Its
production service worker was active and controlled a reload with zero page
errors. Two additional screenshot-free Playwright checks against that image
passed: dashboard layout labels across all 27 packs at 360, 390, and 430px,
and the Energy chart's forced-colors mobile fallback at the same widths.

Against the running image, the isolated gallery test checked all 27
thumbnails at 360, 430 and 1440px, then selected and reloaded a mocked
server preference. A separate delayed-preference startup test used assets
copied from that image. Neither test started a server or took screenshots:

```text
1 passed (19.6s)
1 passed (15.0s)
```

The same screenshot-free gallery and delayed-preference startup checks on
the refreshed `67c12d5f88dc` image reported:

```text
1 passed (14.8s)
DOCKER_GALLERY_EXIT=0
1 passed (9.3s)
DOCKER_STARTUP_EXIT=0
```

The isolated snapshot's full Vitest run was stopped in error while it was
still producing output. It did not finish and is not a full-suite result. A
new current-source run emitted at least 147 failure markers before being
stopped for diagnosis and subsequent source fixes. It did not finish or
produce a failure summary. A targeted follow-up for three nearby test files
reported `725 passed`, so those files do not identify the failures.

Another fail-fast Vitest run stopped after one notification consumer failure:

```text
Test Files  1 failed | 18 passed
Tests       1 failed | 3844 passed
```

The focused notification file initially reported `7 failed | 48 passed`.
Six packs lacked treatments for standalone provider cards and definition
panels; Atlas and Analog also lacked the ghost context-link treatment. Their
pack styles now use token-based treatments while excluding semantic,
embedded, conversation, data-grid, and protected widget surfaces. The
notification and native-surface preservation checks now report:

```text
Test Files  4 passed (4)
Tests       253 passed (253)
```

After replacing the new fixed shadow widths with the existing border-width
token, the notification and native-composition checks reported `172 passed`
again. A screenshot-free Chromium computed-style check verified the six
provider/definition treatments, protected semantic backgrounds, and the two
ghost-link treatments. These are behavioral checks, not a visual review.
The new selectors were then tightened to exclude protected and conversation
markers on both the target and its ancestors. The focused boundary tests and
the complete notification consumer file reported:

```text
Tests  8 passed | 55 skipped
Tests  63 passed
NOTIFICATION_LINT_EXIT=0
TSC_FINAL_EXIT=0
E2E_TSC_FINAL_EXIT=0
```

The full Vitest suite has not yet completed, and these checks do not establish
visual acceptance or mobile coverage for the affected pages.

An Analog notification-channels diagnostic with no screenshots checked 360px
and 430px in both modes. Three cases passed; the 360px light case failed the
strict mock guard with one pending `GET /api/v1/vehicles`. No overflow, touch
target, or body-size failure was reported before that guard. The same guard
failed on retry. The fixture now also correlates client cancellation and
network abort for the exact same-origin vehicle-list GET; extra queries,
other methods, off-origin calls and blocked requests still fail. The focused
strictness contract and a second retry both passed:

```text
1 passed (8.4s)
1 passed (15.0s)
1 passed (8.2s)
70 passed (1.6m)
```

Together with the three initial passes, the diagnostic covered both widths in
both modes, but it did not inspect screenshots or check contrast.

The current-source frontend checks completed with:

```text
TSC_EXIT=0
LINT_EXIT=0
```

On `0966cdb7b28f`, CI's frontend shard 8 found that the new readability
rule did not satisfy `charts.css`'s existing forced-color and selector
boundary:

```text
Test Files  1 failed | 367 passed (368)
Tests       2 failed | 13942 passed (13944)
```

The readability invariant now lives in the descriptor-neutral screen
layer alongside the other cross-mode accessibility rules. The chart
presentation sheet retains its original forced-color and profile boundaries;
the existing assertions were not relaxed. Focused tests reported:

```text
Test Files  3 passed (3)
Tests       49 passed (49)
CHART_BOUNDARY_TEST_EXIT=0
Test Files  3 passed (3)
Tests       68 passed (68)
BASE_STYLE_CONTRACT_EXIT=0
3 passed (20.8s)
LEGEND_BOUNDARY_BROWSER_EXIT=0
```

The merged coverage job on the same CI head reported the same two
chart-boundary failures, not an additional failure:

```text
Test Files  1 failed | 2946 passed (2947)
Tests       2 failed | 101795 passed | 4 skipped (101801)
```

After the repair, frontend TypeScript and full lint passed; the committed
source also built as the Docker image `teslasync-web:design-packs-v2-7d6dca06e1ca`:

```text
TSC_AFTER_BOUNDARY_EXIT=0
LINT_BOUNDARY_EXIT=0
```

The candidate image was checked on loopback before replacing the task-owned
preview. The browser contracts for hidden legends, preview isolation and the
mobile gallery reported `4 passed`. The startup persistence contract initially
failed because it defaulted to an older local `e2e/.app-dist`; after pointing
it at the candidate image's extracted assets, it reported `1 passed`.
The refreshed `localhost:3120` container is healthy, and its index, built
asset and auth proxy return 200. Actual-browser checks at 360, 430 and
1440px reported zero page errors and document overflow on the initial route.
The existing backend health endpoint still returns 503. These are smoke
checks, not a full mobile or visual acceptance.

All 32 Windows visual snapshot shards passed on `0966cdb7b28f`. A
screenshot-free recheck against the current Docker image covered the five
late mobile routes repaired after the earlier `b6750e2fff` diagnostic:

```text
> node scripts\capture-design-packs.mjs --pack classic --pages service-intelligence,settings--safety,sharing--trips,vehicles--7,vehicles--7--access --viewports phone-360,phone-430 --base-url http://127.0.0.1:3120 --workers 2
10 passed (1.3m)
LATE_MOBILE_RECHECK_EXIT=0
```

That command used `DESIGN_PACK_CHECK_ONLY=1` and did not verify contrast or
save or inspect screenshots.

The remaining late Classic routes were checked without screenshots or
contrast auditing:

```text
> node scripts\capture-design-packs.mjs --pack classic --pages share-card,signal-change-points,signal-correlation,signal-deadband,signal-diff,signal-entropy,vehicles,weekly-digest,what-if,vehicle-systems--software --viewports phone-360,phone-430 --base-url http://127.0.0.1:3120 --workers 2
20 passed (1.9m)
LATE_MOBILE_REMAINING_EXIT=0
```

In an isolated Command History experiment, the existing SVG axis labels
measured 11px. Forcing 16px placed the top tick outside the SVG at each of
360, 390 and 430px, even though adjacent tick labels did not overlap. The
global override was not applied; a safe solution must account for chart
geometry and remains skipped rather than treating small labels as resolved.

At the final-gate revisit, a screenshot-free Classic 360px check of
`/period-compare` again failed because the mocked requests did not become
quiet (`PERIOD_REVISIT_EXIT=1`). The pre-existing request churn remains
outside the visual-only scope, and the route remains skipped.

The refreshed Docker preview was built from production source
`67c12d5f88dc` and preflighted on a separate loopback port before replacing
the task-owned preview. The previous container was retained for rollback.
The image build, full lint before subsequent test-harness-only edits,
candidate browser and proxy checks reported:

```text
DOCKER_BUILD_EXIT=0
FULL_LINT_EXIT=0
CANDIDATE_CONTAINER=running healthy
INDEX_HTTP=200
ASSET_HTTP=200
BROWSER_HTTP=200 MAIN_VISIBLE=true PAGE_ERRORS=0
PORT_3121_HEALTH_HTTP=503 AUTH_HTTP=200
PORT_8080_HEALTH_HTTP=503 AUTH_HTTP=200
PREVIEW=running healthy
WIDTH=360 HTTP=200 MAIN_VISIBLE=true PAGE_ERRORS=0 DOCUMENT_OVERFLOW=0px
WIDTH=430 HTTP=200 MAIN_VISIBLE=true PAGE_ERRORS=0 DOCUMENT_OVERFLOW=0px
WIDTH=1440 HTTP=200 MAIN_VISIBLE=true PAGE_ERRORS=0 DOCUMENT_OVERFLOW=0px
```

The backend's existing health failure is not caused or repaired by this
frontend preview. The candidate container was removed after the replacement
became healthy; the preview remains available on `127.0.0.1:3120`. These
width checks cover the live preview's initial route only.

The browser fixture previously left canceled startup auth-mode and vehicle-list
requests pending when Playwright never invoked their routes. Its accounting
now requires both the matching client abort signal and a matching aborted
network request; other pending or blocked requests still fail the strict
completion guard. The focused contract verifies that unknown paths, extra
query parameters, off-origin requests, other methods, and requests blocked
before a client abort remain incomplete:

```text
1 passed (8.2s)
4 passed (9.6s)
6 passed (33.4s)
HARNESS_CONTRACT_EXIT=0
NETWORK_HARNESS_EXIT=0
E2E_HARNESS_ESLINT_EXIT=0
E2E_HARNESS_TYPECHECK_EXIT=0
```

The API Logs engineering audit reported zero violations in each of its six
categories and `TypeScript passes`. The page has 477 lines and five
panel/chart references, unchanged from `feature/app-design-themes`.

The latest production-source snapshot, `ebf27e706445`, was built into the
Docker preview and preflighted separately before replacing the task-owned
container. The preceding preview remains stopped for rollback. The first
browser launch could not find a bundled Chromium executable; retrying with the
installed Edge browser passed without installing another browser:

```text
PREVIEW_BUILD_EXIT=0
FINAL_LINT_EXIT=0
CANDIDATE_HEALTH=healthy
INDEX_HTTP=200
ASSET_HTTP=200
/api/v1/system/auth-mode CANDIDATE_HTTP=200 BACKEND_HTTP=200
/api/v1/system/health CANDIDATE_HTTP=503 BACKEND_HTTP=503
PREVIEW_HEALTH=healthy
PREVIEW_INDEX_HTTP=200
PREVIEW_ASSET_HTTP=200
WIDTH=360 HTTP=200 MAIN_VISIBLE=true PAGE_ERRORS=0 DOCUMENT_OVERFLOW=0px
WIDTH=430 HTTP=200 MAIN_VISIBLE=true PAGE_ERRORS=0 DOCUMENT_OVERFLOW=0px
WIDTH=1440 HTTP=200 MAIN_VISIBLE=true PAGE_ERRORS=0 DOCUMENT_OVERFLOW=0px
SERVICE_WORKER_CONTROLLED_RELOAD=true MAIN_VISIBLE=true PAGE_ERRORS=0
2 passed (20.6s)
PREVIEW_GALLERY_STARTUP_EXIT=0
```

The gallery and delayed-preference tests used the deployed image's copied
assets and mocked preference API. They took no screenshots. The width checks
cover only the initial live route, and the full Vitest run remains incomplete;
neither result establishes full-app visual or mobile acceptance.

The fail-fast full Vitest run subsequently stopped on an embedded-metric
preservation failure:

```text
Test Files  1 failed | 20 passed (2947)
Tests       1 failed | 3523 passed (3586)
FULL_VITEST_EXIT=1
```

Four data modes applied density padding inside embedded metric surfaces,
overriding their component-owned geometry. Removing those broad rules restores
the existing embedded-surface contract while retaining ordinary tile
treatments. A focused rerun and a screenshot-free browser check reported:

```text
Test Files  2 passed (2)
Tests       126 passed (126)
1 passed (5.6s)
```

The full suite has not been rerun to completion, and this fix has not received
visual acceptance on the previously captured pages.

The fixed source snapshot was independently built and preflighted before
replacing the local Docker preview. The previous preview is retained for
rollback. The screenshot-free checks covered the initial route only:

```text
PREVIEW_BUILD_EXIT=0
FIX_LINT_EXIT=0
CANDIDATE_HEALTH=healthy
INDEX_HTTP=200 ASSET_HTTP=200
/api/v1/system/auth-mode CANDIDATE=200 BACKEND=200
/api/v1/system/health CANDIDATE=503 BACKEND=503
WIDTH=360 HTTP=200 PAGE_ERRORS=0 OVERFLOW=0
WIDTH=430 HTTP=200 PAGE_ERRORS=0 OVERFLOW=0
WIDTH=1440 HTTP=200 PAGE_ERRORS=0 OVERFLOW=0
PREVIEW=running HEALTH=healthy IMAGE=teslasync-web:design-packs-v2-84413e2fe493
PREVIEW_INDEX=200 ASSET=200
AUTH_HTTP=200
PREVIEW_BROWSER_HTTP=200 ERRORS=0 OVERFLOW=0
```

The next full-suite snapshot stopped at a second, incompatible expectation:
the comfort-consistency consumer required data-mode tile framing even for
explicitly embedded metrics. Its contract now checks that embedded metrics
retain their paint and layout while ordinary tiles receive their data-mode
treatment. Nested-profile isolation is verified on their enclosing record;
the selector matcher also checks the owner on the matching selector itself,
not on an unrelated selector in the same CSS rule.

```text
Test Files  2 passed (2)
Tests       99 passed (99)
1 passed (3.8s)
ESLINT_EXIT=0
```

The browser check covers semantic and embedded paint and padding in the four
data modes at 360px and 1440px. A full-suite pass is still outstanding.

Seven routes that failed an earlier Classic 360px sweep were checked again
against the current development server without taking screenshots. The
checks cover 360px and 430px, including touch targets, text size, overflow and
mock API completion; they do not establish visual or contrast acceptance.

```text
  14 passed (2.4m)
CURRENT_MOBILE_EXIT=0
TSC_EXIT=0
```

The routes were Admin Feedback, Battery Degradation, Charging Detail,
Charging Schedule, Energy Orchestrator, Guard Mode and Navigation. The
separately protected Digital Twin failure remains unresolved.

The fail-fast full-suite snapshot at `9a066c635c` stopped on the same
embedded-metric expectation in the driving consumer. Its contract now
separately verifies preserved embedded geometry and ordinary data-mode tile
treatment. The focused run below passed; the full suite remains incomplete.

```text
Test Files  1 failed | 6 passed (2947)
Tests       1 failed | 526 passed | 194 skipped (777)

> npx vitest run src\features\driving\components\driving-01.native-adoption.test.tsx --maxWorkers=2
Test Files  1 passed (1)
Tests       57 passed (57)
DRIVING_TEST_EXIT=0
```

The next Classic 360px diagnostic stopped at its failure limit: 84 passed,
8 failed, one interrupted and 21 did not run. Failures included overflowing
safety, security and signal-history tables; undersized physics navigation
links; a missing trip-detail fixture; and two navigation-context errors.
These are not visual or contrast approvals.

The safety and security history tables, trip-detail drives, and the physics
attention and logbook tables now opt into the existing phone grid. Quick View
retains the original column renderers, including timestamps and unit
formatters. Logbook session links remain available on the phone and in the
expanded evidence. The physics raw-evidence wrapper can explicitly preserve
its desktop expansion when a mobile presentation is supplied; its existing
default remains unchanged. The trip-detail fixture matches only its exact,
query-free request.

Screenshot-free Classic checks against isolated production assets reported:

```text
6 passed (58.3s)
4 passed (51.1s)
```

The first run checked logbook, modes and trip detail at 360px and 430px; the
second opened and expanded logbook and nervous-system evidence at both widths.
These checks covered scrolling, touch targets, text size, browser errors and
strict mock completion, not visual or contrast approval. The focused physics
and raw-evidence tests reported `Test Files 2 passed (2)`, `Tests 98 passed
(98)`. The combined safety, security, trip, physics and fixture run reported:

```text
Test Files  6 passed (6)
     Tests  383 passed (383)
```

It emitted existing React `act(...)` and JSDOM `scrollTo` warnings. Frontend
and E2E TypeScript checks exited 0; focused ESLint exited 0. The guideline
audit reported no violations in the changed production files. The safety
page changed from 925 to 944 counted lines and retained eight `LayoutCard`
occurrences; it uses no direct `GlassPanel` or `ChartContainer` tags. No API
hooks changed; the earlier hook verifier matched 571 extracted URL patterns.

The separate security-access check still fails at both phone widths: seven
existing shared Digital Twin hotspots measure approximately 11-14px. The
history grid repair does not resolve or waive that protected-design conflict.

The committed `b6750e2fff` frontend passed the full lint and production
build, and was built into the local Docker preview. A separate loopback
candidate was healthy and served its index, entry asset and auth-mode proxy
before replacement. The previous preview is retained as a stopped rollback.
The installed Chrome browser was used after the bundled Chromium executable
was unavailable; no browser was installed. The replacement checks reported:

```text
INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200
HEALTH=healthy
{"width":360,"http":200,"body":true,"main":1,"overflow":0,"pageErrors":0}
{"width":1440,"http":200,"body":true,"main":1,"overflow":0,"pageErrors":0}
PROXY_HEALTH_HTTP=503 BACKEND_HEALTH_HTTP=503
```

These are live initial-route checks, not all-page acceptance. The pre-existing
backend health failure remains unchanged. A full Vitest run is in progress
in a separate checkout; it is not yet a passing result.

## Protected surfaces

Keep the Digital Twin and Digital Twin Mini layouts and existing Tesla vehicle
images. Pack changes may affect their existing presentation tokens, not their
data, geometry, interactions or image assets.

The dashboard marks the full panel of each protected twin as an application
composition boundary, including the fullscreen panel. The design-scope
observer removes app-owned selector markers inside that boundary, including
on inserted or reparented content, while inherited theme and widget-pack
tokens remain available. Other widgets and app previews retain their existing
ownership. Phone target sizes inside these protected widgets still require
separate verification; preserving geometry alone is not a mobile pass.
The before/after comparison records each widget at its actual viewport width.
Because the surrounding desktop shell can change the grid's available width,
it then measures both widget compositions at the same width; the captured
images remain the unaltered, naturally sized widgets.

### Temporarily skipped: protected widget phone targets and text

The original 390px diagnostic, an instrumented retry, and a rebuilt
refinement still leave the protected twins' 36 x 36 Open control, 10 x 28
refresh control and 14.1px text below the requested phone minima. The
non-protected dashboard targets and prose in the observed fixture improved,
but the protected-subtree boundary deliberately prevents their rules from
altering the twins. Do not waive these findings or change the preserved
design without a compatible token-only solution. Revisit at the final gate;
Classic remains passed-with-notes, not a full pass.

## Draft PR CI repair evidence

The previous PR head failed frontend unit shards, several responsive browser
shards, application-design scope checks, Windows visual baselines, route
discovery and the secret scan. Repairs in the working tree restore scoped
native treatments, keep thumbnail scopes separate from the page, reinstall
mock fixtures safely, and supply identity-scoped ForwardAuth preferences.
The browser harness only accepts a reviewed cancelled read when both the
client abort and its matching network failure are present.

The focused unit rerun reported `16` files and `1,116` tests passed; the mock
asset tests reported `5 passed`. The provider identity and MFA browser
contracts reported `10 passed`; the real 27-pack native-interaction and
thumbnail checks reported `2 passed`. A separate responsive-grid run reported
`49 passed, 1 failed` before cancellation accounting was extended; the failed
case then passed five repeats. These are targeted results, not a full-suite
or visual acceptance.

The complete browser harness run reported `75 passed, 1 failed`: the
486-combination chart-table contract exceeded the default 30-second test
timeout. Its explicit timeout is now 120 seconds without reducing coverage
or changing any assertion; the focused rerun reported `1 passed (55.2s)`.

The current isolated frontend build and its four postbuild checks completed:

```text
[bundle-size] OK (transitive startup ≤ 400 KB, vendor ≤ 140 KB, route ≤ 100 KB, locale ≤ 67 KB, per-namespace locale fallback ≤ 20 KB)
[pwa-precache] OK — route chunks remain on-demand
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
POSTBUILD_EXIT=0
```

The full frontend lint reported `FULL_LINT_EXIT=0`; the later heading and
browser-test edits also passed their focused ESLint run. Frontend and E2E
TypeScript reported `FRONTEND_TSC_EXIT=0` and `E2E_TSC_EXIT=0`.

The PWA and build identity contracts reported `92 passed`; the output-path
contracts reported `27 passed`. Browser installation was attempted in a
task-owned cache after the missing-executable failures, but all five Firefox
download attempts timed out, so local Firefox and WebKit pack checks remain
unverified. The previous Windows CI images predate the current heading fix;
their differences have not been accepted as current baselines.

The old long-content battery image exposed a real desktop defect: the brief
review action wrapped below its heading. A screenshot-free regression first
failed with a `38px` vertical center mismatch. Giving the desktop heading a
zero flex basis kept the action alongside it; the same regression then
reported `1 passed`, and the API evidence flow reported `3 passed` at
390/1024/1440px.

The redacted filesystem scan over the shared working directory reported
`232` matches, which is not equivalent to CI's clean checkout. No findings
were printed or removed. A redacted scan of the 51 tracked edits reported
`SCANNER_EXIT=0` and `FINDINGS=0`; a separate full tracked-file candidate
scan is pending. The earlier CI scan reported one finding; the corresponding
non-secret fingerprint variable was renamed rather than allowlisted.

## Phone legends and current Windows baselines

The Classic phone contrast audit found passive chart legend labels at 12px.
The shared phone rule now uses the existing body-size and leading tokens for
owned legend labels, wraps long text and excludes preserved widgets. The
mobile text audit also reports undersized legend labels. A focused browser
contract first failed at `12px`, then reported `2 passed` after the fix,
covering all 27 packs at 360/390/430px in normal and forced colors, plus
representative font scales and protected content. Screenshot-free checks of
command reliability and charging curves
reported `4 passed` each for Classic and Terminal at 360/430px. These checks
do not establish full chart or app-wide acceptance.

The legend unit suites reported `Test Files 2 passed (2)`, `Tests 42 passed
(42)`. Frontend, E2E and service-worker TypeScript each exited 0. An isolated
Vite build and the four normal postbuild checks also exited 0; the full lint
rerun reported `FULL_LINT_EXIT=0`.

The earlier 26 Classic route/width contrast checks had zero automated
violations but left 26 chart nodes requiring manual assessment. Their recorded
dark-mode text colors against the nearest opaque CSS background give 8.73:1
for legends and 5.66:1 for axes; SVG overlaps and other backgrounds still
need review. A new Classic dark/light check of two chart pages reported
`4 passed` and zero automated violations, but left 16 chart nodes for manual
review. A separate light-mode DOM check of the eight Command Reliability
nodes gave 7.31:1 for legend text and 4.59:1 for axes against their nearest
opaque CSS background, without resolving possible SVG overlaps. The observed
11px SVG axis labels remain a legibility concern.
Raising axis font size without remeasuring tick layout risks overlaps, so
this is not treated as a completed fix.

For CI run `43594099353` at `ced744f586c9`, each updated Windows image was
reviewed against its tracked expected image. The mobile Battery, Drives and
Fleet briefs show complete headings rather than truncated headings, while
Charging shows larger explanatory text in the mobile and desktop profiles.
Actual images were identical across all retries and the expected images
matched the tracked baselines. All 32 Windows visual shards completed: 24
passed and the eight failing shards are covered by the reviewed images.
Other browser jobs and later code changes are not assumed to pass.

On `ced744f586c9`, GitHub's aggregate frontend lint, eight Vitest shards,
merged coverage and build check passed, as did the Security Scan workflow.
This does not establish a full-suite result for the later legend commit or
resolve the still-running browser and visual jobs.

The actual Command History chart's hidden interactive legend label measured
2.42:1 in Classic dark and 1.92:1 in Classic light at 360px. Its original
40% opacity caused the failure. Opted-in, non-preserved chart labels now use
full opacity when hidden, retain their strike-through and pressed state, and
remain reversible; the existing 40% fallback is unchanged for unowned and
protected content. The new token is reset at preview boundaries. Forced-color
mode receives the same scoped readability treatment.

Before the fix, the two real-chart checks failed at the ratios above. After
the fix, the same dark/light checks at 360/1440px and an ownership,
preview-boundary, protected-widget and forced-color contract reported:

```text
3 passed (29.0s)
HIDDEN_LEGEND_AFTER_EXIT=0
```

The chart legend unit suites again reported `Test Files 2 passed (2)`,
`Tests 42 passed (42)`. These checks do not prove contrast for all packs or
all chart axes.

The local frontend, E2E and service-worker TypeScript checks and full lint
finished on the new code:

```text
TSC_EXIT=0
E2E_TSC_EXIT=0
SW_TSC_EXIT=0
LINT_EXIT=0
```

## Command History phone axes: earlier attempt

The Classic Command History chart still renders 11px axis labels on phones.
A screenshot-free browser regression with populated synthetic data was
configured for 360/390/430px, dark/light modes and font scales 0.85/1/1.35;
it failed at 360px before reaching the wider widths. Simply enlarging the
labels clipped ticks; additional measured widths and ownership-aware
remeasurement still left the first date label overlapping the zero tick at
360px and scale 1.35 in both modes. Increasing the X-axis tick margin did
not resolve that overlap. The final attempted check reported:

```text
2 failed
dark 360px scale 1.35: overlapping ticks
light 360px scale 1.35: overlapping ticks
AXIS_AFTER_EXIT=1
```

The tentative changes and failing test were removed rather than shipped at
that point. The later phone-axis follow-up below supersedes this attempt; it
does not establish general phone compliance.

## Dashboard phone context follow-up

A screenshot-free mocked dashboard survey found ordinary Recent drives
context below the requested floor in v4, v7, Editorial, Terminal, Bauhaus and
Neo Brutal: 11.9px at scale 0.85 and 14px at scale 1. Atlas had the same
defect, and Classic's different detail-list presentation measured 10.2px and
12px. The affected pack styles now use the body-size token for those ordinary
phone contexts; the seven headline packs also cover ordinary metric units.
Protected twins, native gauges, specialized metrics, and report/kiosk
presentations remain outside these treatments.

The temporary Edge-only configuration used the existing Vite server and
disabled screenshots, video and traces:

```text
npx playwright test --config playwright.v6-mobile.local.config.ts --project local-v6 --grep "dashboard metric context remains readable"
  16 passed (3.0m)
PHONE_METRIC_TEST_EXIT=0

npx playwright test --config playwright.v6-mobile.local.config.ts --project local-v6 --grep "recent-drive context is readable across design packs"
  2 passed (1.1m)
ALL_PACK_CONTEXT_EXIT=0

npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx --testNamePattern="phone metric typography" --reporter=dot --maxWorkers=1
 Test Files  1 passed (1)
      Tests  9 passed | 111 skipped (120)
METRIC_BOUNDARIES_EXIT=0
```

The first check covers the eight headline packs including the earlier v6 fix,
with both themes, normal/forced colors, 360/390/430px and scales 0.85/1/1.35;
it checks context and Battery unit size, widget containment, context overlap,
and document overflow. The second covers Recent drives context in all 27
packs at those widths and scales in both themes, without forced colors.
These checks do not establish visual acceptance, other-route behavior,
localized text or the unresolved protected-twin requirements.

## Browser teardown and cross-browser checks

The application-design fixture keeps its mock SSE server alive until the
page has unloaded. It also accounts for and validates keepalive requests
created during actual navigation, rather than allowing them to reach the
preview proxy after Playwright removes the page routes.
Late `sendBeacon` calls are also retained for validation; if the seeded
beacon fixture is absent, the request is blocked and fails the check. Before
that change the new invalid-beacon regression unexpectedly resolved instead
of rejecting.

The charging heatmap detail is allowed to follow the selected cell while
respecting the shared popover's viewport clamp. Nested-preview comparisons
now move the pointer off interactive controls before comparing appearances.
Two focused, screenshot-free checks passed against the isolated build:

```text
npx playwright test --config=playwright.v6-mobile.local.config.ts --grep "charging detail follows|nested preview comparison" --workers=1
  2 passed (29.9s)
FIREFOX_REGRESSION_EDGE_EXIT=0

npx playwright test --config=playwright.contract.config.ts --grep "application design teardown" --workers=1
  5 passed (10.0s)
TEARDOWN_CONTRACT_EXIT=0
```

The local Firefox run could not start because its Playwright browser was
missing. A retry of the browser download timed out on three CDN endpoints;
the installation was stopped. Edge results do not establish a Firefox pass,
so the Firefox CI job remains the cross-browser verification.

### Isolated Linux browser follow-up

A matching Playwright container made Firefox and WebKit available without
changing the local browser installation. Against assets copied from the
`7402197cfc2f` Docker candidate, the first run passed both Firefox checks and
one WebKit check; WebKit timed out while sampling a large charging page.
After a DOM-sampling optimization, WebKit still timed out under load and a
second run also found a preview geometry mismatch before layout settled.
These failures were not counted as passes.

The harness now caches the serialized markup length until the observed main
content changes, while continuing to require five stable samples. The DOM
deadline is 20 seconds rather than eight for slow browser renders. Its
contracts also check replacement of `main` and rejection of continuously
changing content. The preview owner probe still removes and restores owners
in one synchronous task, verifies every owner, and compares the fully laid-out
geometry after two animation frames.

With the same isolated assets and no screenshots:

```text
npx playwright test widget-design-packs.app.spec.ts --project=app-design-firefox --project=app-design-webkit --grep="charging detail follows|nested preview comparison" --workers=1 --reporter=line
  4 passed (2.2m)
BROWSER_PROBE_HTTP=200
BROWSER_PROBE_API_ESCAPE=0
FIREFOX_WEBKIT_FINAL_EXIT=0

npx playwright test --config=playwright.contract.config.ts --grep="harness tracks DOM changes after replacing the main content|harness rejects continuously changing DOM content" --workers=1
  2 passed (28.7s)
DOM_READINESS_CONTRACTS_EXIT=0
```

The container used `--network none`, synthetic fixtures and a local asset
server that rejects unexpected API calls. The main-replacement contract also
passed separately in Firefox and WebKit (`2 passed`). This is focused engine
coverage, not a full visual or mobile pass. The container's dependency
installation reported four low-severity audit findings; no manifests changed.

The complete Edge harness and frontend type check subsequently reported:

```text
npx playwright test --config=playwright.contract.config.ts --workers=1
  85 passed (2.8m)
HARNESS_FULL_EXIT=0

npx tsc --noEmit
FRONTEND_TSC_EXIT=0

npm run lint
FULL_LINT_EXIT=0
```

The full lint emitted an existing `jsx-ast-utils` diagnostic for a
`JSXEmptyExpression`; the command still exited successfully. Scoped
engineering audits reported no violations in `mockApi.ts`,
`harness.contract.spec.ts`, or `widget-design-packs.acceptance.ts`.

## Command History phone-axis follow-up

The application-wide phone chart now measures its date and count labels using
the current font and body-size token. Multi-year dates use two lines and a
taller shared chart preset; the tooltip and accessible table keep full dates.
Desktop and unowned charts retain their previous treatment.

An initial isolated WebKit run found a transient zero-width chart after
resizing and, independently, only one count tick at 360px with the German
locale, Georgia and scale 1.35. Waiting longer did not fix the count tick at
the standard height. The multi-year chart now uses the `detail` preset; the
same custom-font case passed against an isolated production build. Geometry
polling allows 15 seconds for the slow isolated browser to settle, while
still requiring two ticks per axis, the body-size floor, no overlap or
clipping, and no document overflow.

During the phone-legend retry, a cancelled navigation-pins read was reported
as an escaped request. The fixture now recognizes only the exact
`GET /api/v1/pinned?type=navigation` target when both the client abort signal
and matching browser failure are witnessed. The contract still rejects
different queries, writes, unreviewed traffic and unwitnessed failures.

```text
npx playwright test --config=playwright.contract.config.ts --workers=1
  85 passed (2.5m)
FINAL_CANCELLATION_HARNESS_EXIT=0

npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 --grep="hidden chart legends stay readable" --workers=1 --repeat-each=3
  6 passed (1.0m)
REPEATED_PHONE_LEGEND_EXIT=0

npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 --grep="Command History" --workers=1
  8 passed (1.9m)
EDGE_DETAIL_AXIS_EXIT=0

npx playwright test widget-design-packs.app.spec.ts --project=app-design-firefox --project=app-design-webkit --grep="Command History" --workers=1 --reporter=line
  16 passed (13.0m)
BROWSER_PROBE_HTTP=200
BROWSER_PROBE_API_ESCAPE=0
FIREFOX_WEBKIT_DETAIL_AXIS_EXIT=0

npx vitest run src\features\system\pages\CommandHistoryPage.test.tsx --reporter=dot --maxWorkers=1
  Tests 26 passed (26)
POST_DETAIL_COMMAND_VITEST_EXIT=0

npx tsc --noEmit
POST_DETAIL_FRONTEND_TSC_EXIT=0
npx tsc --noEmit -p e2e\tsconfig.json
CANCELLATION_E2E_TSC_EXIT=0
npx eslint e2e\mockApi.ts e2e\harness.contract.spec.ts e2e\widget-design-packs.app.spec.ts src\features\system\pages\CommandHistoryPage.tsx
FINAL_CHANGED_FILES_ESLINT_EXIT=0

npx vite build --outDir <isolated-session-directory>
VITE_AXIS_DETAIL_BUILD_EXIT=0
DETAIL_BUNDLE_EXIT=0
DETAIL_PRECACHE_EXIT=0
DETAIL_PWA_CONTRACT_EXIT=0
DETAIL_SOURCE_MAPS_EXIT=0
```

The page has 806 lines versus 714 on the base, and six panel/chart openings
in both versions. The scoped engineering audit reported zero in its six
categories; the Command History hook verifier matched all three extracted
paths. The Vitest run emitted the existing JSDOM/Recharts zero-size warnings.
The Edge axis cases cover recent and year-spanning dates, 360/390/430px,
three scales and both themes in Classic, plus all 27 packs at 360/430px,
scale 1.35 and both themes. They also check a German/Georgia preference and
desktop/unowned preservation. The Firefox/WebKit cases ran against isolated
production assets in a Linux container with no external network; the local
asset server reported no unexpected API traffic.
These focused checks do not establish full-page mobile, contrast, visual or
cross-pack acceptance.

The committed frontend image was built from `632cd7218af7` and tested before
replacing the task-owned preview. The previous preview container is retained
stopped for rollback. The candidate used port 3122 and the refreshed preview
uses port 3120; neither browser run saved screenshots.

```text
docker build --build-arg VITE_GIT_SHA=632cd7218af7420127b550a177e545ab62b81cb0 --tag teslasync-web:design-packs-v2-632cd7218af7 --file <committed-context>\Dockerfile.web <committed-context>
PREVIEW_DETAIL_BUILD_EXIT=0

npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 --grep="live application thumbnails|all pack dashboard layout names|Command History" --workers=1
  10 passed (1.9m)
CANDIDATE_BROWSER_EXIT=0

npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 --grep="applies the verified pack before the shell appears and persists on reload" --workers=1
  1 passed (10.9s)
CANDIDATE_STARTUP_EXIT=0

npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 --grep="live application thumbnails|Command History phone axes remain legible and contained in dark \(year-boundary, custom font and locale\)" --workers=1
  2 passed (25.4s)
REFRESHED_PREVIEW_BROWSER_EXIT=0

PREVIEW_HEALTH=healthy
PREVIEW_INDEX=200
/assets/index-DSKDPHLK.js HTTP=200
/healthz HTTP=200
/api/v1/system/auth-mode HTTP=200
/api/v1/system/version HTTP=200
/api/v1/system/health HTTP=503
BACKEND_SYSTEM_HEALTH_HTTP=503
```

The startup check used assets extracted from the candidate image; all browser
checks used synthetic API fixtures. The system health 503 is also present on
the existing backend and reports the Tesla API component degraded.

## PR source receipt and readiness follow-up

On PR head `14ac6803f9`, frontend shards 1, 3, 6 and 7 failed because the
Command History phone-axis edit lacked its exact mobile-presentation receipt.
The receipt now reverses the actual current bytes to the previously verified
source and retains the existing translation-projection and drift checks.
Coverage and aggregate frontend jobs failed downstream of those shards.
Chromium responsive shard 8 separately failed because the default DOM
readiness deadline had been increased from the eight seconds required by its
existing contract. The default is restored; its five stability samples remain.

```text
npx vitest run src\i18n\authorized-canonical-recovery.test.ts src\i18n\copy-owner-contracts.test.ts src\i18n\excluded-consistent-defaults.test.ts src\i18n\resolved-baseline-producer.test.ts src\i18n\widget-implementation-contract.test.ts src\i18n\excluded-feature-owned-producers.test.ts --testNamePattern="retains actual source calls|preserves frozen producer contracts|preserves complete source and every original call" --reporter=dot --maxWorkers=2
 Test Files  6 passed (6)
      Tests  1009 passed | 7330 skipped (8339)
CI_RECEIPT_CONTRACTS_EXIT=0

npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 --grep="DOM readiness|caller-specific DOM budget" --workers=1
  3 passed (21.7s)
READINESS_BUDGET_EXIT=0

npx playwright test --config=playwright.contract.config.ts --grep="owner activation|harness tracks DOM changes|harness rejects continuously changing DOM" --workers=1
  5 passed (32.6s)
OWNER_STABILITY_EXIT=0

npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 --grep="charging detail follows|nested preview comparison" --workers=1
  2 passed (39.4s)
STABILITY_EDGE_APPLICATION_EXIT=0
```

In the first restored-budget run, 18 Firefox/WebKit application cases passed
and two WebKit cases failed: the populated charging heatmap exceeded eight
seconds and a preview changed height between owner-guard measurements. A
separate instrumented WebKit run observed late Recharts mutations at about
10.6 seconds. Only the heatmap review now has an explicit 20-second DOM
budget; it still requires the same stable samples. The preview owner probe
waits for loaded fonts and five stable geometry samples before its unchanged
owner-removal and exact-restoration comparisons. Its contracts reject
continuous changes and changes after restoration. Cross-browser verification
of these follow-up changes is pending.

Repeating the heatmap and preview checks twice in Firefox and WebKit gave
`6 passed, 2 failed`; both failures were the WebKit preview's exact
owner-restoration comparison. A browser-side diagnostic showed the real
Quiet preview grid changing its implicit rows from 125.1875, 125.1875 and
150.921875px to three 150.921875px rows after owner removal and restoration,
even with stable fonts, geometry and matching computed styles. Waiting alone
did not fix it. An owner-scoped intrinsic-row experiment preserved every
captured node before and after the probe in both outer packs. The resulting
CSS change is limited to the Quiet synthetic overview, excludes preserved
widgets, twins and special metric grids, and leaves owner and exact-geometry
assertions intact. An earlier diagnostic attempt timed out before reaching
the preview; no screenshot was taken.

```text
npx playwright test --config=playwright.v6-mobile.local.config.ts --project=local-v6 harness-readiness.smoke.spec.ts --workers=1 --reporter=line
  3 passed (19.5s)
READINESS_SMOKE_EXIT=0

npx playwright test --config=playwright.contract.config.ts --grep="Quiet preview sizes|owner activation|harness tracks DOM changes|harness rejects continuously changing DOM" --workers=1
  6 passed (33.1s)
QUIET_OWNER_CONTRACT_EXIT=0

npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx --reporter=dot --maxWorkers=1
 Test Files  1 passed (1)
      Tests  120 passed (120)
QUIET_NATIVE_PRESERVATION_EXIT=0

npx tsc --noEmit
FRONTEND_TSC_EXIT=0
npx tsc --noEmit -p e2e\tsconfig.json
E2E_TSC_EXIT=0
```

The rebuilt-assets Firefox/WebKit run completed with 7 passed and 1 failed.
Both Quiet preview repetitions passed in each browser; one WebKit heatmap
repetition left its focused tooltip 15.28125px from the expected centered,
viewport-clamped position. The second WebKit heatmap repetition passed. No
screenshots or unexpected API requests were recorded; the failure is under
investigation rather than waived. Three subsequent diagnostic WebKit
repetitions passed, so they did not reproduce or explain the offset.
An independent deterministic regression exposed a matching anchor race:
when focus synchronously flushes React, the keyed popover measured the old
cell before the new anchor was assigned (`112px` instead of `152px`).
Assigning the new anchor before focus preserves the keyboard interaction and
the full heatmap unit file now passes. The original WebKit failure did not
capture enough geometry to prove it had the same cause.

```text
npx vitest run src\features\charging\components\charging-heatmap\HeatmapGrid.test.tsx --testNamePattern="anchors detail to the next cell even when focus synchronously flushes rendering" --reporter=dot --maxWorkers=1
 Test Files  1 failed (1)
      Tests  1 failed | 28 skipped (29)
Expected left: 152px; received left: 112px

npx vitest run src\features\charging\components\charging-heatmap\HeatmapGrid.test.tsx --reporter=dot --maxWorkers=1
 Test Files  1 passed (1)
      Tests  29 passed (29)
HEATMAP_GRID_TESTS_EXIT=0
```

On the previous `14ac6803f9` PR head, WebKit application-design CI also
failed its 390px custom owner-restoration comparison and its 390px light
incomplete-preview comparison. The former reported a 51.46875px sandbox
height difference; the latter reported one text-color difference between
the two outer packs. The uploaded CI JSON identifies the differing node as
an unowned `feedback-copy` wrapper whose parent has the same primary text
color in both previews. These are separate assertions from the focused Quiet
preview check above and remain to be verified against the local fixes.
The first expanded screenshot-free WebKit reproduction stopped before the
neutral comparison: the network-isolated browser reported offline, and an
offline disclosure obscured the preview heading. The focused online scenario
now explicitly seeds `navigator.onLine` while retaining blocked external
network access and synthetic API fixtures.

The custom-mode diagnostic later identified stale inherited line-height on
WebKit's unpainted Leaflet panes and SVG after restoring the incomplete
profile: 18px before the probe and 21px after it. Reading the panes made
their values settle, but exposed the same difference on the SVG. The pending
working-tree owner probe waits for the captured computed styles as well as geometry to
remain stable; it still compares the complete restored snapshot exactly.
An animated-background regression failed before that change. The four
focused geometry, style, post-restoration and continuous-change contracts
then passed. Neutral feedback inheritance is checked after pointer settling,
not before it.

The expanded screenshot-free WebKit run still did not complete:

```text
  2 failed
  light: Dismiss help click timed out while waiting for stability
  custom: second Preview Quiet Form click timed out during dispatch
  BROWSER_PROBE_API_ESCAPE=0
```

These are temporarily skipped for the local validation pass after repeated
attempts; neither result establishes that the two CI comparisons now pass.
The exact owner-restoration and neutral-isolation assertions remain enabled.
An additional diagnostic was stopped after its isolated WebKit renderer
remained busy; it exited 137 and is not a pass. The focused hover and
incomplete-profile checks are now separate tests to avoid duplicating portal
interactions within a single scenario.

The separated WebKit comparison reproduced the light-mode difference on the
unowned error surface's content and action wrappers, not just its copy wrapper.
All three wrappers must inherit their immediate parent's color before the
unchanged cross-pack comparison; the check now reads them in tree order.
A later custom-mode failure identified detached Recharts tick nodes whose
ownership had been correctly cleared after a responsive remount. The working-tree probe now
checks the live tree's ownership, checks removed nodes were cleared, and
compares fresh, settled geometry and styles exactly after restoration. It also
samples foreground color and font family. An equivalent-remount contract
failed before the change; the new checks still reject an unowned remount, a
geometry-changing remount, and later style changes.

```text
npx playwright test --config=playwright.contract.config.ts --grep="owner activation|Quiet preview sizes" --workers=1
  9 passed (35.0s)
OWNER_REMOUNT_CONTRACT_EXIT=0

npx tsc --noEmit
FRONTEND_TSC_EXIT=0
npm run typecheck:sw
SW_TSC_EXIT=0
npx eslint e2e\harness.contract.spec.ts e2e\widget-design-packs.acceptance.ts e2e\widget-design-packs.app.spec.ts --report-unused-disable-directives --max-warnings 0
FINAL_PREVIEW_ESLINT_EXIT=0

npx vite build --outDir <isolated-session-directory>
ISOLATED_VITE_BUILD_EXIT=0
POSTBUILD_check-bundle-size.mjs_EXIT=0
POSTBUILD_check-pwa-precache.mjs_EXIT=0
POSTBUILD_check-pwa-contract.mjs_EXIT=0
POSTBUILD_check-source-maps.mjs_EXIT=0

npm run lint
FULL_LINT_EXIT=0
```

The build used the local source tree, including the pending Quiet stylesheet.
It emitted the existing Rollup annotation and i18n audit notices; lint emitted
the existing `JSXEmptyExpression` diagnostic. The latest browser-harness edits
were made after full lint and passed focused ESLint. Cross-browser verification
of the remount-aware probe remains incomplete. The screenshot-free Firefox
light/custom cases passed, but WebKit light reported differing inherited font
sizes and colors on SVG descendants after restoration; WebKit custom passed.
The exact comparison remains enabled. This issue is deferred while the other
completed fixes and local preview are handled.

The completed remote 1440px light WebKit job also reported an 18px change in
the Quiet overview's metric-grid row after owner restoration. The scoped
intrinsic-row change has a passing synthetic boundary contract. A separate
screenshot-free WebKit check of the actual metric grid at a 768px allocation
now passes for both outer packs; the full desktop isolation phase still fails
on chart geometry and inherited legend colors.

A screenshot-free Classic dark-mode sweep of the eligible capture registry
at 360px and 430px, using synthetic data, reported:

```text
  2 failed
  504 passed (55.0m)
```

Both failures were `/security-access`: seven protected twin hotspots measured
about 11.5px at 360px and 14.3px at 430px. The sweep checked visible touch
targets, text, horizontal overflow, browser errors and mock completion, not
contrast or visual quality. It excluded the previously documented
`/period-compare` route and the six standalone routes outside the capture
registry. The readiness implementation changed while the sweep was running,
so it is not evidence for a single immutable harness revision. The protected
widgets were not altered or exempted; these failures remain unresolved.

The local preview was rebuilt from committed source `d97ada73ed2b` and
preflighted on a separate loopback port before replacing the task-owned
container on port 3120. The previous container was retained for rollback.
The candidate and live checks reported:

```text
PREVIEW_IMAGE_BUILD_EXIT=0
CANDIDATE_HEALTH=healthy
INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200 ASSET=/assets/index-N_mc3Kql.js
2 passed (26.2s)
CANDIDATE_BROWSER_EXIT=0
IMAGE=teslasync-web:design-packs-v2-d97ada73ed2b HEALTH=healthy RESTART=unless-stopped
INDEX_HTTP=200 ASSET_HTTP=200 AUTH_PROXY_HTTP=200 ASSET=/assets/index-N_mc3Kql.js
2 passed (23.5s)
LIVE_PREVIEW_BROWSER_EXIT=0
1 passed (13.0s)
PREVIEW_STARTUP_EXIT=0
PREVIEW_HEALTH_HTTP=503
BACKEND_HEALTH_HTTP=503
```

The browser checks used mocked data and no screenshots. The existing backend
health failure is unchanged. A screenshot-free Telemetry Studio phone sweep
is running against the committed snapshot; it excludes the already documented
period-comparison route and does not establish visual or contrast acceptance.

The pending owner probe was extended to sample intermediate ancestors and the
same SVG geometry used by its exact snapshot. Its focused Edge contracts and
type/lint checks passed, but the screenshot-free cross-browser revisit did
not:

```text
10 passed (39.2s)
OWNER_CONTRACT_EXIT=0
HARNESS_TYPE_LINT_EXIT=0

  2 failed
  4 passed (6.8m)
BROWSER_PROBE_API_ESCAPE=0
CROSS_BROWSER_EXIT=1
```

Firefox passed light, custom and desktop-light cases, and WebKit passed the
custom phone case. WebKit light still changed restored phone timeline geometry
and desktop chart geometry/inherited legend colors. No screenshot was taken;
the exact comparison remains enabled. This failed revisit is deferred again
while the separate phone sweep and CI continue.

The narrower real-page desktop metric-grid check used the newly built Docker
assets and retained exact owner and geometry comparisons:

```text
  1 passed (1.3m)
BROWSER_PROBE_API_ESCAPE=0
CROSS_BROWSER_EXIT=0
QUIET_DESKTOP_GRID_EXIT=0
PREVIEW_DESKTOP_TYPE_LINT_EXIT=0
```

The same desktop check against older `7402197cfc2f` assets failed while
clicking the second outer pack's preview button, before reaching its grid
assertion. It is not evidence that the metric-row regression was reproduced
on those older assets:

```text
  1 failed
BROWSER_PROBE_API_ESCAPE=0
QUIET_DESKTOP_BASELINE_EXIT=1
```

The immutable `d97ada73ed2b` Telemetry Studio phone sweep completed without
screenshots:

```text
  8 failed
  500 passed (57.1m)
V1_PHONE_CHECK_EXIT=1
```

At each of 360px and 430px, Dashboard and Security Access failed on preserved
Digital Twin controls; Help overflowed and Quick Stats had undersized readings.
Period Compare and six standalone routes remained excluded. This is not a
contrast or visual pass, and the protected widgets were neither changed nor
exempted.

The Studio stylesheet now applies the existing phone body-size token to owned
headline units and inline readings outside preserved content. Real Quick Stats
checks passed at 360/390/430px in both themes (`6 passed`) and at font scales
0.85 and 1.35 at 360/430px in both themes (`8 passed`). The focused native
composition checks reported:

```text
Test Files  2 passed (2)
     Tests  13 passed | 161 skipped (174)
STUDIO_NATIVE_PRESERVATION_EXIT=0
```

The Help overflow also reproduced in Horizon Loft: the support action group
was prevented from shrinking. The Help page now lets that group wrap and
uses the phone text and touch tokens for its glossary and dashboard links,
without changing their destinations or actions. A short-link minimum and
the exact support JSON are checked alongside the panel bounds. The source
preservation receipts record only these presentation changes.

The expanded Help check passed at 360px and 430px in Horizon, including
non-overlapping actions and short/long link geometry. An all-pack,
screenshot-free baseline was interrupted after 12 packs when the same
Quick Stats text defect appeared in ten of them. All 24 completed Help
checks passed; the 20 Quick Stats checks for those ten packs failed.
Classic and Studio passed both routes. No visual or contrast pass is
implied by these checks.

```text
2 passed (42.5s)
HELP_ACTION_GEOMETRY_EXIT=0
HELP_GEOMETRY_E2E_TYPE_LINT_EXIT=0
TSC_NO_EMIT_EXIT=0
HELP_TOKEN_FULL_LINT_EXIT=0
Test Files  6 passed (6)
     Tests  1009 passed | 7330 skipped (8339)
HELP_CANONICAL_RECEIPTS_EXIT=0
HELP_TOKEN_BUILD_EXIT=0
```

The Help guideline script reported zero violations in each of its six
categories and `TypeScript passes` (`HELP_AUDIT_EXIT=0`). Against the
preceding commit, the three Help components retained their respective
409/63/215 line counts and 3/3/3 `GlassPanel`/`ChartContainer` matches.
The complete extracted hook verification reported
`ALL EXTRACTED HOOK PATHS MATCH REGISTERED ROUTES` (`HOOK_AUDIT_EXIT=0`).

The shared phone layer now applies the body-size token to owned headline
units and inline metric badges, outside protected widgets and conversations.
This avoids duplicating the same correction across packs. The screenshot-free
all-pack Quick Stats check used an immutable build at 360px and 430px in both
themes. Summing its per-pack results gives 106 passed and two failures:
Blueprint split the words
"Charging" and "efficiency" at 430px in both themes. The shared reading-size
defect did not recur in those cases. Blueprint's ledger spacing has since been
corrected; a focused browser regression and all four original Blueprint
capture checks now pass against the corrected build. The 26 other packs'
104 passing checks used the preceding build, which differs by the Blueprint
stylesheet change.

Selected output:

```text
node scripts\capture-design-packs.mjs --pack all --pages quick-stats --viewports phone-360,phone-430,phone-360-light,phone-430-light --base-url http://127.0.0.1:54872 --workers 2
Capturing design pack blueprint
  2 failed
  2 passed (29.6s)
Capturing design pack memphis
  4 passed (34.4s)
SHARED_PHONE_METRIC_ALL_PACK_EXIT=1
Test Files  3 passed (3)
     Tests  188 passed (188)
SHARED_PHONE_METRIC_TEST_EXIT=0
Test Files  3 passed (3)
     Tests  78 passed (78)
SHARED_PHONE_BRIDGE_TABLE_TEST_EXIT=0
SHARED_PHONE_METRIC_TYPE_LINT_EXIT=0
SHARED_PHONE_METRIC_BUILD_EXIT=0
SHARED_PHONE_METRIC_FULL_LINT_EXIT=0
```

The scoped engineering audit reported no violations in the shared CSS or
vehicle-card regression test.

The Blueprint regression failed against the earlier build at 430px, then
passed against the corrected build in both themes at 360/390/430px, font
scales 0.85/1/1.35 and normal/forced colors. It also checks the existing
1440px metric-bank layout. The capture checks also passed at 360/430px in
both themes. No screenshots were taken.

```text
2 passed (15.3s)
BLUEPRINT_REGRESSION_FINAL_EXIT=0
4 passed (28.5s)
BLUEPRINT_CAPTURE_CHECK_EXIT=0
Test Files  5 passed (5)
     Tests  244 passed (244)
BLUEPRINT_BRIEF_PACK_TEST_EXIT=0
BLUEPRINT_REGRESSION_TYPE_LINT_EXIT=0
BLUEPRINT_PHONE_BUILD_EXIT=0
```

The isolated WebKit light-phone retry did not complete its comparison: the
second preview-button click timed out after starting the click action. The
exact restoration assertion remains unchanged and unresolved; no screenshot
was taken and the mock API reported no escaped requests.

```text
1 failed
BROWSER_PROBE_API_ESCAPE=0
WEBKIT_LIGHT_OWNER_EXIT=1
```

### Committed-source Docker refresh

The current frontend image was built from commit `bd586368207c`, preflighted
on loopback port 3122, and then installed as the task-owned preview on port
3120. The preceding preview remains stopped for rollback. Browser checks used
the image's extracted assets and synthetic data; they took no screenshots.
The existing backend health endpoint still returns 503.

```text
PREVIEW_IMAGE_BUILD_EXIT=0
CANDIDATE_ID=3f54e863cd3e83c147663ae5eacdb4409f5b5029936b91498754207bd90182c2 HEALTH=healthy
INDEX_HTTP=200 ASSET_HTTP=200 API_VERSION_HTTP=200
BACKEND_HEALTH_HTTP=503
  5 passed (43.5s)
CANDIDATE_BROWSER_EXIT=0
PREVIEW_HEALTH=healthy
INDEX_HTTP=200 ASSET_HTTP=200 API_VERSION_HTTP=200
BACKEND_HEALTH_HTTP=503
  5 passed (42.8s)
LIVE_PREVIEW_BROWSER_EXIT=0
BLUEPRINT_PHONE_FULL_LINT_EXIT=0
```

The browser selector covered both Blueprint phone themes, thumbnail isolation,
the charging-detail focus anchor, and saved-appearance startup and reload. CI
run `43653409615` passed on `8e784a91a5`. The frontend-quality watcher exited
because GitHub's API rate limit was exhausted; that does not establish a
workflow failure or success. Its final result remains unverified.

The quota reset allowed the existing frontend-quality run to be inspected.
All 32 Windows visual shards passed, but application-design and responsive
shards were still running. A new push would cancel that run, so retain it
until its result is known before synchronizing the pending local commits.

The Classic dark-mode contrast spot check was repeated without screenshots
using the committed Docker assets at 360px and 430px:

```text
npx playwright test --config=e2e\design-packs-capture.config.ts --grep="capture " --project=phone-360 --project=phone-430 --workers=1
  8 passed (2.2m)
CONTEXT_EXIT=0
```

The four axe results needing manual review were two repetitions each of a
charging result count and a decorative Quick Stats arrow. At both widths the
count used `rgb(170, 180, 195)` on `rgb(17, 21, 28)` (8.73:1); the arrow
used `rgb(244, 247, 251)` on that surface (17.03:1). These are computed-style
samples, not a full contrast or visual review. The completed all-pack
four-page results are recorded below.

### All-pack contrast spot checks and phone follow-up

The screenshot-free checks completed against immutable `bd586368207c` assets:
charging, drives, Quick Stats and settings at 360px and 430px in each of the
27 packs. Dark and light each reported 214 passed and two failed: Editorial's
430px charging and settings labels split words. In each theme axe reported
zero violated rules across 216 reports; 176 nodes in 116 reports still need
manual review. These results do not certify contrast or untested pages.

```text
dark:  214 passed, 2 failed; 216 reports, 0 violated rules, 176 incomplete nodes
light: 214 passed, 2 failed; 216 reports, 0 violated rules, 176 incomplete nodes
```

Editorial's phone metric banks now stack labels and values when narrow. The
final Edge regression passed on the revised production assets in both themes,
including the previously failing 430px pages and a 360px, 1.35-scale label.
Its `14 passed` includes ten Helix cases; it does not replace the full
contrast or screenshot matrix.

Helix's long code and wide Markdown tables also overflowed or squeezed on
phones. The owner-scoped phone treatment wraps code and stacks table cells
with their original column headings, without changing copied text or API
data. Fine-pointer desktop, widget-only, report and kiosk treatments remain
unchanged; larger coarse-pointer screens use the shared stacked-table rules.
The all-pack browser check switches complete CSS profile attributes directly;
it tests owner propagation and composition, not saved-selection persistence.

```text
Edge production-build regression:             14 passed (1.4m)
Firefox/WebKit Helix regression:              20 passed (8.8m)
Firefox/WebKit Editorial regression:           8 passed (4.3m)
BROWSER_PROBE_API_ESCAPE=0
MarkdownRenderer.test.tsx:                    10 passed
Pack/steps/DataTable preservation:            15 passed | 194 skipped
FRONTEND_TSC_EXIT=0
SERVICE_WORKER_TYPECHECK_EXIT=0
E2E_TSC_EXIT=0
ISOLATED_VITE_BUILD_EXIT=0
POSTBUILD_check-bundle-size.mjs_EXIT=0
POSTBUILD_check-pwa-precache.mjs_EXIT=0
POSTBUILD_check-pwa-contract.mjs_EXIT=0
POSTBUILD_check-source-maps.mjs_EXIT=0
```

The scoped audit reported no violations in the modified CSS, renderer or
browser tests. It reported one `raw-html-table` finding in `MarkdownTable.tsx`:
the matched `<Table>` is the shared component imported from `@/components/ui`,
not a raw HTML table. No screenshots were taken for these follow-ups.

### Preview refresh and verification

The image built from committed `35aa7ff61dc9` replaced the task-owned Docker
preview at `http://localhost:3120` after a separate candidate was checked.
The previous container remains stopped as a rollback. Both candidate and
replacement returned HTTP 200 for the index, bundled script, auth mode and
version; the existing backend health endpoint returned 503 through both the
old and candidate previews. No screenshots were taken.

```text
PREVIEW_IMAGE_BUILD_EXIT=0
CANDIDATE_HEALTH=healthy
candidate browser regression: 10 passed (1.3m)
PREVIEW_HEALTH=healthy
replacement browser regression: 5 passed (41.8s)
FRONTEND_FULL_LINT_EXIT=0
API_HOOK_AUDIT_EXIT=0
```

The hook verifier extracted 571 URL patterns and matched them against 888
registered route patterns; it reported no double prefix or camelCase query
parameters. The full local Vitest run was stopped before completion to apply a
subsequent fix; it is not a passing full-suite result.

The previously failing Editorial charging and settings cases were rechecked
without screenshots against the image's extracted assets at 360px and 430px
in both themes:

```text
8 passed (1.6m)
EDITORIAL_CONTRAST_RECHECK_EXIT=0
```

All eight axe reports had zero violated rules; the four charging reports each
had one overlapping result-count node requiring manual contrast review.
Across the earlier 176 incomplete nodes per theme, 54 are the same decorative
`aria-hidden` arrow accompanying the visible Details link. The remaining 122
include 60 gradient-background, 58 overlap and four short-content findings;
they have not been individually resolved or certified.

The isolated WebKit light-phone owner check passed once, then two repetitions
failed: one on exact restoration and one on a preview click timeout. In the
restoration failure, sampled nodes retained identical owner attributes, matched
the same CSS selectors and exposed the same body-size token, yet their
computed font sizes changed from 14px or 12px to 16px after owner removal and
restoration. This narrows the symptom but does not establish its cause. The
exact assertion remains enabled; no API requests escaped and no screenshots
were taken.

### Security Access phone twin follow-up

The Security Access page opts into the existing expanded twin targets on phones
and coarse pointers. Their interactive layer uses positioned HTML rather than
SVG `foreignObject` buttons, which WebKit did not consistently hit on touch.
The default dashboard twin and mini-widget designs remain unchanged.

The focused unit run covered the shared twin, Security Access, and both
protected widgets and their pack variants: `6` files, `542` tests passed. The
phone regression checked all nine target labels, non-overlap, 44px minimum,
landmark alignment, tooltips and horizontal overflow at 360, 390 and 430px.
It passed in Edge (`2 passed`) and in Firefox, WebKit and iPhone-emulated
WebKit (`6 passed`), including real taps in the touch project. The isolated
Vite build and four postbuild checks exited 0. No screenshots were taken. These
checks do not resolve the separate protected dashboard-widget target findings.

```text
FINAL_LINT_EXIT=0
FINAL_TSC_EXIT=0
VEHICLE_TWIN_AUDIT_EXIT=0
SECURITY_PANEL_AUDIT_EXIT=0
```

### Docker preview refresh

The image built from committed `19c0889436` now serves the task-owned preview
at `http://localhost:3120`. A separate candidate was checked before replacement;
the previous container remains stopped as a rollback. A phone-sized Edge probe
rendered the app without horizontal overflow or page errors. The pre-existing
backend system-health endpoint still returns 503; no screenshots were taken.

```text
PREVIEW_BUILD_EXIT=0
state=running health=healthy
INDEX_HTTP=200 INDEX_BYTES=10575
ASSET_HTTP=200 PATH=/assets/index-DG9FMpM6.js BYTES=1047814
ASSET_HTTP=200 PATH=/assets/vendor-react-DhiZVHQA.js BYTES=366611
ASSET_HTTP=200 PATH=/assets/index-Ca4-G2L9.css BYTES=222205
AUTH_PROXY_HTTP=200
DEPLOYED_IMAGE=teslasync-web:design-packs-v2-19c0889436 HEALTH=healthy RESTART=unless-stopped
DEPLOYED_BROWSER={"status":200,"rootChildren":4,"cssSheets":2,"overflow":false,"pageErrors":0}
SYSTEM_HEALTH_HTTP=503
```

### CI balancing, interaction fixes and preview refresh

The 32 required Chromium quality jobs now divide ordinary cases into 24
shards and design-pack cases into eight. Exact discovery for the CI project
set confirmed that this partition neither drops nor duplicates a case:

```text
FULL=2867 DESIGN=197 ORDINARY=2670 UNIQUE=2867 DISJOINT=True EXACT_MULTISET=True
CI_DISCOVERY_EQUIVALENCE_EXIT=0
```

The Horizon freshness panel wraps long ranked labels, and Helix history
preserves primary-mouse selection when WebKit scrolls a focused button.
Targeted unit, lint, type, build and cross-browser checks passed before the
push; these do not establish full-page mobile acceptance. The previous full
Vitest run was not an immutable source snapshot and did not pass:

```text
Test Files  2 failed | 2945 passed (2947)
     Tests  4 failed | 101812 passed | 4 skipped (101820)
```

A fresh full Vitest run is running from an isolated checkout of `3b65d101b4`;
its result is not yet known. Draft PR #259 now points to that commit, and its
new workflows are running. The strict WebKit owner-restoration assertion is
still under investigation: a single-preview diagnostic passed twice, but
that does not establish isolation across both outer packs.

The Docker image built from `3b65d101b4` replaced the task-owned preview after
a separate healthy candidate passed its index, asset, auth-proxy and phone
browser checks. The previous preview remains stopped for rollback. The six
focused Helix and Horizon browser regressions passed against the deployed
image without screenshots; the pre-existing backend health endpoint still
returns 503.

```text
DOCKER_BUILD_EXIT=0
CANDIDATE_HEALTH=healthy
CANDIDATE_BROWSER={"status":200,"rootChildren":4,"cssSheets":6,"horizontalOverflow":false,"pageErrors":0}
DEPLOYED_IMAGE=teslasync-web:design-packs-v2-3b65d101b4c7 HEALTH=healthy RESTART=unless-stopped
INDEX_HTTP=200
AUTH_PROXY_HTTP=200
DEPLOYED_BROWSER={"status":200,"rootChildren":4,"cssSheets":4,"horizontalOverflow":false,"pageErrors":0}
6 passed (43.2s)
DEPLOYED_BROWSER_REGRESSION_EXIT=0
SYSTEM_HEALTH_HTTP=503
```

### Preservation and browser teardown follow-up

The Helix pointer-focus repair now has an exact, reversible source receipt.
Eight preservation suites, including mutation checks for its three hunks,
passed without changing the existing producer or translation projections:

```text
Test Files  8 passed (8)
     Tests  8524 passed (8524)
HELIX_PRESERVATION_EXIT=0
```

The immutable full Vitest run on `3b65d101b4` was stopped because it did not
contain that required receipt. A new run is using committed snapshot
`243a4c3199`; its result is not yet known. Draft PR #259 points to that
commit, with workflows running.

The cross-browser smoke now uses the guarded page fixture, which navigates
away while mock routes are still installed. The actual-navigation teardown
contracts passed (`5 passed`). Six screenshot-free Firefox and WebKit live-map
repetitions recorded no escaped API requests but did not all pass: one Firefox
pack selection remained on the previous pack, and one WebKit Streets control
did not activate. Both are under investigation.

```text
2 failed
4 passed (7.6m)
BROWSER_PROBE_API_ESCAPE=0
CROSS_BROWSER_SMOKE_EXIT=1
```

A subsequent instrumented WebKit-only run passed three repetitions. Each
recorded pointer-down, pointer-up and click on Streets, without escaped API
requests. It did not reproduce the earlier failure; the temporary
instrumentation was removed and the intermittent interaction remains
unresolved. An instrumented Firefox-only run also passed three repetitions
with matching synthetic preference writes and reads; it did not reproduce the
stale selection, so that intermittent failure remains unresolved as well.

```text
3 passed (3.5m)
BROWSER_PROBE_API_ESCAPE=0
WEBKIT_MAP_TRACE_EXIT=0
3 passed (4.0m)
BROWSER_PROBE_API_ESCAPE=0
FIREFOX_PREFERENCE_TRACE_EXIT=0
```

The strict two-outer-pack WebKit light-phone owner check subsequently passed
twice with the pending diagnostic instrumentation. An earlier repetition
failed exact inherited-style restoration, so those two passes are not proof
that the intermittent defect is resolved. The pending owner-settling,
restoration and protected-grid contracts passed in Edge (`10 passed`), and
the diagnostic files passed focused ESLint and E2E TypeScript. No screenshots
were taken.

### Semantic and embedded metric surfaces

A screenshot-free browser contract now checks the actual stylesheet for each
of the 27 packs, two semantic palettes, and 360px and 1440px widths. It
found that Classic changed warning and danger padding, and that Classic,
Expressive, Pixel, Ambient, Analog, Observatory, Swiss, Glass and Cyberdeck
could add metric treatments inside embedded surfaces. Their selectors now
preserve the existing semantic and embedded ownership boundaries while
ordinary metric treatments remain active.

```text
Browser contracts: 5 passed (33.8s)
Real-component preservation: Test Files 4 passed; Tests 140 passed
Pack composition and notification preservation: Test Files 4 passed; Tests 312 passed
TypeScript: npx tsc --noEmit exited 0
Frontend lint: npm run lint exited 0
Production build: npm run build exited 0; PWA and source-map postchecks passed
Pack directory guideline audit: Scanned 3 files: No violations found.
```

The browser fixture checks computed paint and geometry, not rendered-route
visual approval or full contrast compliance. No screenshots were taken.

The same all-pack contract passed in the isolated Firefox and WebKit engines:

```text
2 passed (1.4m)
```

The committed `fdcd380f40` production source was rebuilt into the task-owned
Docker preview. Port 3121 was already allocated to an existing container, which
was left untouched; the new candidate was preflighted on port 3130. The
previous 3120 preview remains stopped for rollback.

```text
PREVIEW_BUILD_EXIT=0
CANDIDATE_HEALTH=healthy INDEX_HTTP=200 AUTH_PROXY_HTTP=200
DEPLOYED_IMAGE=teslasync-web:design-packs-v2-fdcd380f408e HEALTH=healthy RESTART=unless-stopped
DEPLOYED_BROWSER: 360px, 430px, 1440px: HTTP 200, no initial horizontal overflow or page errors
SYSTEM_HEALTH_HTTP=503
```

The browser check covers the initial live route only. The existing backend
health failure and the broader visual and mobile acceptance gaps remain.

### Current Docker preview and WebKit CI

The committed Cyber contrast and preview-boundary changes were built into
`teslasync-web:design-packs-v2-87afae094c6e`. A candidate on the free
loopback port 3133 passed its health, index, JavaScript asset, auth proxy and
screenshot-free 360px browser checks before replacing the task-owned preview.
The prior preview was retained as
`teslasync-design-packs-rollback-0fae1a58ab97-20261115`. The new preview is
available at `http://localhost:3120`:

```text
PREVIEW_BUILD_EXIT=0
PREVIEW_HEALTH=healthy
PREVIEW_INDEX=200
PREVIEW_ASSET=200
PREVIEW_AUTH=200
PREVIEW_BROWSER_360=360/360 root=4
PREVIEW_BROWSER_430=430/430 root=4
PREVIEW_BROWSER_1440=1440/1440 root=4
PREVIEW_BROWSER_STATUS=200
BACKEND_HEALTH_HTTP=503
```

These are initial-route responsiveness checks, not all-page visual or mobile
acceptance. The existing backend health failure is unchanged.

On PR head `2b2aef0093`, the 390px WebKit custom and dark application-design
jobs failed after 20 tests passed in each. Both failures involved mixed-pack
isolation: custom reported changed line heights after owner activation, while
dark reported a changed neutral-preview text color and an activation
restoration failure on retry. The other browser jobs were still running when
checked. Local screenshot-free diagnostics are investigating the failures;
neither an application defect nor a test-timing cause has been established.

A screenshot-free WebKit diagnostic against the rebuilt frontend failed three
focused incomplete-preview cases. Light 390px showed inherited SVG font and
legend color differences after owner restoration; custom 390px timed out
performing the filter click; light 1440px timed out waiting for the journey
button to stabilize. The captured CI dark mismatch was specifically the
`feedback-copy` wrapper's inherited color. These findings are not yet a
verified fix:

```text
3 failed
BROWSER_PROBE_API_ESCAPE=0
```

The Cyber regression explicitly disables screenshots, traces and video and
passed against the same committed build in isolated Chromium:

```text
5 passed (1.3m)
BROWSER_PROBE_API_ESCAPE=0
```
## 2026-11-16: accepted design and bounded finalization

The one requested full local frontend run completed:

```text
npm test -- --maxWorkers=4
Test Files  9 failed | 2941 passed (2950)
Tests  29 failed | 101850 passed | 4 skipped (101883)
Duration  6959.17s
```

Seven failing files had loaded the old catalog projection before its repair.
Six passed in the documented 7-file focused run below; the remaining
`final-four-localization-gaps.test.ts` subsequently passed all 7 tests.
The weekly-digest fixture mixed local week boundaries with its UTC display
zone, which diverged on Sunday evening in the Windows host timezone.
Anchored the existing fixtures to UTC and pinned only Date at that boundary,
without changing production date logic, metrics or assertions. Its 40 tests
passed. The intelligence-pack contract's full-run timeout passed unchanged
on its one focused rerun (8 tests, including the original 30-second budget).

```text
npm test -- src\features\analytics\components\weekly-digest\useWeeklyDigest.test.tsx src\features\intelligence-packs\components\__tests__\IntelligencePacksLateNative.appDesign.test.tsx --maxWorkers=2
Test Files  2 passed (2)
Tests  48 passed (48)
npm test -- src\i18n\final-four-localization-gaps.test.ts --maxWorkers=1
Test Files  1 passed (1)
Tests  7 passed (7)
```

Browser reproduction correction: Docker `--network none` made the browser
offline, so operational writes were correctly disabled and error reporting
buffered instead of transmitting. Those diagnostic runs are not passing
CI evidence and their offline failures do not justify product changes.
Subsequent browser runs use the task-owned internal Docker network
`teslasync-final-browser`, which provides a live interface without external
egress or access to the shared application containers.

The existing thermal-source browser assertions still counted the duplicate
direct-request/resilient-fallback transport removed by the rate-limit
integration in `46871c6b8a`. Updated their exact ledgers to one direct attempt
plus the single QueryClient retry, retaining the nonzero data, unavailable,
manual-retry and source-isolation assertions. This corrects the stale test,
not the production retry policy or a tolerance.

```text
npm run e2e:quality -- operationalbrief-contracts/charging.smoke.spec.ts --grep="thermal numeric selection"
8 passed (4.9m)
E2E preview proxy escape check: 0 errors
```

Several Chromium jobs passed every browser case but failed the existing
preview-network gate on late `/api/v1/web-errors` requests. The affected
smoke tests used raw Playwright teardown or direct reload/close rather than
the existing navigation capture/validation lifecycle. Reusing the existing
fixture and preparing explicit navigations keeps routes alive while the
document is retired; late payload schemas, unmatched requests and delivery
dispositions remain asserted. No production transport, preview escape gate,
retry threshold or design styling is changed by this repair.

Docker finalization: rebuilt the main-integrated source including the Pixel
and scoped Twin phone repairs as `teslasync-web:design-packs-v2-final-candidate`.
The image embeds the truthful pre-commit working-build identity
`8625f37a85-final-working`; its digest is
`sha256:eae419e7637b8a1506926be5481ef9d6d08d19bfaa27d616c7489df72a9dfe94`.
Preflighted on loopback port 3131, then replaced only the task-owned
`teslasync-design-packs-v2` container on port 3120. Kept the previous container
stopped as `teslasync-design-packs-v2-rollback-cead512118c7`; other containers
were not changed. The temporary preflight container was removed.

```text
docker build -f Dockerfile.web --build-arg VITE_GIT_SHA=8625f37a85-final-working -t teslasync-web:design-packs-v2-final-candidate .
exit 0
preview=200
auth-proxy=200
health=200
ready=200
true sha256:eae419e7637b8a1506926be5481ef9d6d08d19bfaa27d616c7489df72a9dfe94
```

The user accepted the pack designs and ended redesign work. Only dashboard
Digital Twin accessibility failures, Firefox chart axes, phone overflow or
unreadable text, generated-artifact freshness, merge regressions and failing
PR workflows remain in scope. No new test suites or screenshot matrices
will be introduced. Existing screenshots will be committed unchanged;
only an explicitly repaired page may have its existing capture replaced.
Deferred work is recorded in FOLLOWUPS.md.

The matrix process (shell 7795) was stopped. The pause extension failed, so
the known task-owned process was stopped directly; unrelated servers and
containers were left alone.

GitHub rejected the requested direct base edit because #259 belonged to
native stack #260. Both members were open drafts with no auto-merge.
The stack association was removed, #258 was left open against main, and
#259 was retargeted to main. No branches were rewritten or force-pushed.
Fetched origin/main was already an ancestor of design-packs-v2.

The main merge reported `Already up to date.` at
`b79759f9cc454857a6bb5807f6cbf9f96a350dbe`; `npm run build` exited 0.
The requested protected-dashboard repair is interpreted as a narrow,
widget-owned accessibility exception, not permission to redesign the Twins.
Their phone header controls now have a 44px floor, header actions can wrap,
and existing 14px body text has a 16px floor respecting larger saved scales.
Vehicle scene markup, imagery, geometry and data behavior are unchanged.

The existing screenshot-free dashboard checks passed at 360px and 430px
(`2 passed`), Firefox notification-axis regressions passed dark, light and
custom-font/locale cases (`3 passed`), and the generated freshness command
passed all registered checks and its byte-identical non-mutation assertion.

CI exposed three stale contracts from the already-committed rate-limit
integration, not flaky failures: the historical catalog projection omitted
six net new leaves, the auth-probe test omitted its cancellation signal and
expected a write to trigger a read probe, and the Guard route source assertion
still named the replaced middleware alias. The repair pins the exact new
copy before reconstructing the unchanged historical catalog, asserts the
probe signal and write's single transport call, and pins the same 5/minute
rate limit and impersonation protection using the current middleware alias.
No historical fingerprint, threshold, test or workflow step is removed.

Verification receipts for these repairs:

```text
Dashboard existing capture checks (check-only; Classic dark 360/430):
  2 passed (47.2s)
Dashboard existing capture checks (check-only; Pixel light 360/430):
  2 passed (1.8m)
Firefox Notification health phone chart axes:
  3 passed (7.2m)
Affected frontend contracts with CI coverage options:
  Test Files  7 passed (7)
       Tests  7744 passed (7744)
Linux go test -race -coverprofile=/tmp/guard-coverage.out -covermode=atomic ./internal/api/guard:
  ok github.com/ev-dev-labs/teslasync/internal/api/guard 2.093s coverage: 87.2% of statements
Twin file audit:
  static-inline-vars=0 raw-controls=0 old-api-imports=0
  direct-vendor-imports=0 camelcase-query=0 double-api-prefix=0
```

Windows ARM64 cannot run Go race instrumentation, so the exact package command
was run in the Go 1.27.4 Linux container instead. Both Twin widget source files
gained one className line; their sections, hooks and URLs are unchanged.
No screenshots were created or replaced by these check-only runs.

The existing route-layout chunk and Main custom-desktop core-interactions
phase passed after the navigation lifecycle repair, with the unchanged
preview escape gate reporting zero errors. The same local invocation also
ran the unchanged widget-overflow case: its first 121-widget geometry pass
reported zero violations, but element screenshot stability exhausted its
existing time budget. That invocation is therefore a failure, not a clean
suite result. No timeout, assertion, screenshot or geometry threshold was
removed or relaxed.

```text
npm run e2e:quality -- widget-design-packs.app.spec.ts route-layout-guard.smoke.spec.ts dashboard-widget-overflow.smoke.spec.ts --grep="Application design languages at 1440px in custom.*core interactions|route layout guard chunk 0 at 375px in dark|widget bodies never overflow horizontally"
1 failed
2 passed (17.2m)
E2E preview proxy escape check: 0 errors
npx tsc --noEmit
exit 0
npx eslint [all modified TypeScript test files]
exit 0
```

Responsive shard 29 subsequently passed all 24 cases on the old PR head but
failed the same late `/web-errors` proxy gate (job 133152263385). It belongs
to the existing navigation-lifecycle fix, not a new design defect. Duplicate
completion assertions immediately before `closeMockedPage` were removed:
that helper already performs the identical assertion before retiring the
document. Local follow-up runs may disable failure-only video/trace capture
and use one worker to reduce ARM64 capture overhead; test assertions and
timeouts remain unchanged, and repository/CI configuration is untouched.

The 48-case lifecycle invocation ended with `11 failed`, `1 flaky`,
`36 passed (30.5m)` and zero proxy escapes. Four failures exposed custom
data-repair fixtures calling raw `route.fulfill`, leaving their request
ledger pending despite successful responses. Those five fixture branches
now use the existing `fulfillApiFixture` helper; response bodies, write
confirmation requirements and business assertions are unchanged. The other
failures exhausted existing local timing budgets.

The sequential 16-case follow-up (layout reopening, motion states and thermal
source retention) exited zero: `14 passed`, `2 flaky (19.5m)`, zero proxy
escapes. All eight thermal cases passed on the corrected online/internal
network; all four sleep-retention cases passed in the preceding lifecycle
run. The two timing-sensitive cases and all four repaired data-correction
cases then passed without retries using native Edge against a newly built
application, retaining the existing Vite proxy-escape gate:

```text
npm run e2e:build
vite v6.4.6 building for production...
✓ built in 1m 59s
npm run e2e:quality -- dashboard-layouts.smoke.spec.ts dashboard-widget-motion.smoke.spec.ts data-repair-correction.smoke.spec.ts --config=playwright.finish.local.config.ts --workers=1 --grep="390px in light mode|375px in dark|reviewed corrections remain explicit"
7 passed (2.1m)
E2E preview proxy escape check: 0 errors
```

The temporary native-browser config selected installed Edge and disabled
failure-artifact recording only; it changed no assertion, timeout or retry
count and was removed afterward. An initial session-directory config failed
module loading before tests started, not an application test. Build output
still includes the existing i18n inventory, vendor annotation and bundle-size
warnings. Responsive shard 27 also finished all 24 cases on the old head
before the same proxy-escape gate failed; it is covered by this lifecycle
repair. Existing design screenshots remain untouched.

The final lifecycle review found the same raw-fulfillment ledger gap in
the server-restored dashboard layout fixture. Its two responses now use
`fulfillApiFixture`. The existing drag-persistence and server-restoration
cases passed with strict teardown: `2 passed (22.9s)`, proxy escapes `0`.
Final TypeScript and targeted ESLint commands exited zero. No workflow,
threshold, production API, design styling or committed screenshot changed
in this CI-contract batch.

On commit `127896f3b3`, responsive shard 3 passed 110 cases and failed the two
docked-picker cases because strict teardown exposed an unmocked
`GET /mileage/daily` read from the newly dropped Odometer widget. The test now
registers that specific source using the existing typed card-layout fixture
resolver. Unknown vehicles, query shapes and methods still fall through to
the unmatched-request gate. No production endpoint, widget or assertion was
changed.

While CI ran, the existing WebKit phone core-interactions phase was started
locally. Unlike Chromium, this engine reports offline on Docker's internal
network without a default route. That invalid attempt was stopped; a
task-owned bridge network (not the shared application network) reported
`navigator.onLine === true` before the existing phase was restarted.

The repaired CI ordinary-shard selection passed locally with all 112
registrations intact, using installed native Edge and one worker:

```text
npm run e2e:quality -- --shard=3/24 --grep-invert="widget-design-packs\.(app|energy|native)\.spec\.ts" --config=playwright.finish.local.config.ts --workers=1
112 passed (11.1m)
E2E preview proxy escape check: 0 errors
npx tsc --noEmit
exit 0
npx eslint e2e/dashboard-drag-drop.smoke.spec.ts
exit 0
```

The temporary config was removed. The existing shard also wrote 41 tracked
charging/dashboard screenshots outside the design-pack directory; only
those test-generated changes were restored to their committed bytes.
No design-pack screenshot changed. The online ARM64 WebKit diagnostic had
click and screenshot timing failures; these are not presented as a local
pass or grounds for changing accepted designs. The previous GitHub
390px/dark WebKit job passed, but only the latest-commit checks can establish
final acceptance.

