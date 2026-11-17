# Atlas visual review

## First round — before retry

The original worker's capture exited **1**. I inspected the six preserved
`round-1` images (dashboard, drives and energy, at phone-390 and desktop).

1. Dashboard's active layout name is ellipsized, so the chosen layout cannot
   be read in the header without opening the menu.
2. The phone Energy title wraps even at the default font scale; the padded
   banner crowds the heading and its action.
3. Dashboard phone actions use too much vertical space and feel disconnected
   from the title and layout control.
4. The desktop contextual navigation strip cuts its groups off vertically,
   while its rail labels inherit an 11px font.
5. Onboarding has two competing left rails: the dashboard-wide Atlas rail
   runs alongside the widget's own rail.
6. Onboarding's compact 13px body text is too small on a phone; some
   dashboard actions also fail the 44px target requirement.
7. Atlas reads as generic dark cards rather than an exploration/route-planning
   design; the map/field-notebook identity needs clearer framing.

The Digital Twin widgets are protected. Their reported small controls and
text must remain unresolved here and be addressed in the shared owner.

## Retry changes and verification

- Let the active layout name wrap instead of truncating; tightened the phone
  header insets and action gaps without removing controls. A screenshot-free
  DOM measurement reduced the 390px dashboard header from 187px to 177px;
  the name itself now takes two lines, so its action rail remains 107px.
- Energy's 390px heading changed from two lines to one, with its 44px action
  retained; its header changed from 93px to 64px in the same fixture.
- Expanded the desktop contextual strip's bounded vertical viewport from
  129px to 178px for 177px of content in the reviewed Home section, while
  retaining scrolling for larger sections. The desktop rail label changed
  from 11px to 14px at the default font scale.
- Removed only the extra dashboard-canvas Atlas border, leaving the widget
  rail and any warning/state treatment intact.
- Added phone-size rules for owned compact dashboard body text, widget links,
  buttons and the bottom-tab button parent. The native metric-context and
  protected Digital Twin exceptions are requested separately.
- Strengthened map frames and legend hierarchy using theme tokens and
  tabular figures, without recoloring map tiles, chart series or imagery.

The measurements above are screenshot-free synthetic-fixture observations,
not full-route accessibility passes. Only the six named viewport images were
captured per round; no build was run.

### Focused checks before the final two CSS refinements

The following ran before the post-capture refinements described below:

```text
npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx -t atlas
Test Files  1 passed (1)
     Tests  4 passed | 107 skipped (111)
Atlas native test exit: 0

npx vitest run src\components\ui\AppDesignBridge.test.tsx
Test Files  1 passed (1)
     Tests  13 passed (13)
bridge isolation exit: 0
```

Scoped violations audit (the TSX/import categories do not meaningfully scan
a CSS file, and no API hook or page was changed):

```text
& 'C:\Program Files\Git\bin\bash.exe' '.github\skills\audit-violations\audit.sh' 'web\src\components\ui\app-designs\packs\atlas.css'
═══════════════════════════════════════════════════════════
  TeslaSync Engineering Guidelines Audit
  Target: web\src\components\ui\app-designs\packs\atlas.css
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
Scoped audit exit: 0
```

The audit itself ran `npx tsc --noEmit` in `web`; the compiler emitted no
diagnostics. The `audit_code` tool also reported no violations for the CSS
file. Page line/section comparisons and route checks are not applicable to
this CSS-only change.

## Final capture — incomplete

```text
$env:DESIGN_PACK_CAPTURE_OUTPUT_ROOT = 'D:\repos\teslasync\docs\design-packs\shots\atlas'
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs atlas
  2 failed
    [phone-390] › capture dashboard (/)
    [desktop] › capture dashboard (/)
  4 passed (2.1m)
CAPTURE_EXIT=1
```

I inspected all six fresh images:
`phone-390-scale-1\dashboard.png`, `drives.png`, `energy.png` and
`desktop-scale-1\dashboard.png`, `drives.png`, `energy.png`. The original six
are preserved under `round-1`. The complete final output is in
`shots\atlas\capture-round-2.log`.

- At 390px, the Energy title is on one line, the duplicate onboarding rail
  is gone, and the full dashboard name is visible. The actions still occupy
  two rows; the Drive history title also wraps.
- The final phone dashboard screenshot exposed a newly split “Layout”
  caption. A **post-capture**, owner-scoped flex refinement keeps that short
  caption from shrinking while allowing long translations to wrap. It was
  not visually recaptured or separately tested.
- Home and Energy desktop navigation showed more content, but Driving still
  cuts through long groups at the bounded scroll edge. A **post-capture**
  change raises the desktop maximum from 17rem to 22rem, still capped at
  42vh and scrollable; it was not visually recaptured or separately tested.
  Keyboard focus, RTL and short-window behavior of that follow-up need review.
- These screenshots do not contain a full route map, so the strengthened map
  frame and Atlas's overall distinctiveness are not visually verified.
- The phone dashboard failed its 44px target and 16px text checks. The output
  names protected **Open** (36×36), protected **Refresh data** (10×28),
  protected “Digital twin”, “—” and “Aurora” (14px), and an unprotected
  native metric-context timestamp (14px). See `requests\atlas.md`.
- The desktop dashboard failed because a synthetic `GET /api/v1/pinned`
  remained **pending** at the mock-routing completion check; no cause or
  escaped request is established. Its contrast audit did not run.
- Axe reported zero violated contrast rules where it ran, but **25 nodes
  require manual review**: phone Drives 1, desktop Drives 6, desktop Energy
  18. Phone dashboard and phone Energy each reported zero incomplete nodes.
  Incomplete nodes, including chart labels, navigation and status text, are
  not contrast passes.

The caption, navigation and DataTable-frame refinements postdate the six
images. The earlier native and audit checks predate those refinements; the
subsequent DataTable contract below exercises the frame only. No additional
screenshot round, build, scaled-font, RTL, forced-colors or cross-browser
route review was run. The review therefore remains incomplete.

## Standalone DataTable frame contract

The existing contract initially found no matching Atlas identity rule with a
paint declaration for a standalone DataTable frame:

```text
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='atlas binds only the painted frame' --reporter=dot

 RUN  v4.1.12 D:/repos/teslasync/web

-------------x---------------------

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/ui/DataTable.appDesign.test.tsx > DataTable standalone frame source-to-consumer contracts > atlas binds only the painted frame to existing base and identity surface rules
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ expectSurface src/components/ui/DataTable.appDesign.test.tsx:49:97
     47|   expect(identity.length).toBeGreaterThan(0);
     48|   expect(identity.some(rule => rule.nodes.some(declaration => declarat…
     49|     && ['border', 'background', 'background-color', 'box-shadow'].incl…
       |                                                                                                 ^
     50|   // Selector activation is not a rendered/media-query acceptance clai…
     51|   for (const rule of [base!, ...identity]) {
 ❯ src/components/ui/DataTable.appDesign.test.tsx:107:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 34 skipped (35)
   Start at  12:51:24
   Duration  20.10s (transform 8.38s, setup 988ms, import 12.92s, tests 367ms, environment 4.84s)
Exit: 1
```

Atlas now paints only its owner-qualified, unprotected standalone table frame
with the panel surface token and an inset border-token shadow. It does not
change the table, embedded frame, sizing, overflow, or selection styles.

```text
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='atlas binds only the painted frame' --reporter=dot

 RUN  v4.1.12 D:/repos/teslasync/web

-------------·---------------------

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  12:53:01
   Duration  13.62s (transform 6.06s, setup 792ms, import 8.62s, tests 487ms, environment 3.29s)
Exit: 0
```

The contract was also rerun with a single worker:

```text
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='atlas binds only the painted frame' --reporter=dot --maxWorkers=1

 RUN  v4.1.12 D:/repos/teslasync/web

-------------·---------------------

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  12:56:08
   Duration  11.47s (transform 5.76s, setup 483ms, import 8.07s, tests 549ms, environment 2.02s)
Exit: 0
```

The source-to-consumer test checks the embedded variant, selection, sorting,
sticky header and configured scroll height; it does not prove rendered
geometry, media-query behavior or visual contrast.

The orchestrator subsequently ran `npm run build` in the verification snapshot
with the repaired v5, v6 and Atlas stylesheets: **exit 0**. All three SHA-256
hashes matched the working files. The combined native-composition, ordered-step
and DataTable contracts reported **3 files passed, 200 tests passed**. This
does not resolve the post-capture or contrast limitations above. The stopped
worker's Atlas-owned browser scratch was removed after inspection.

## Ordinary phone metric follow-up

A screenshot-free real-route regression reproduced the Recent drives context
at **11.9px** in both themes at 360px and font scale 0.85. Atlas now uses the
body-size token for ordinary owned headline context and units, while excluding
protected twins, native gauges, specialized metrics, and report/kiosk modes.
The simulated dashboard covered 360/390/430px, font scales 0.85/1/1.35 and
normal/forced colors; it checks containment, context overlap and page overflow.
This does not verify other routes, localized strings, or the protected twin
defects above.

The local Edge configuration below was temporary and disabled screenshots,
video and traces; CI runs the same regression through its normal projects.

```text
npx playwright test --config playwright.v6-mobile.local.config.ts --project local-v6 --grep "dashboard metric context remains readable"
  4 passed (53.2s)
PHONE_METRIC_TEST_EXIT=0

npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx --reporter=dot --maxWorkers=1
 Test Files  1 passed (1)
      Tests  113 passed (113)
PRESERVATION_TEST_EXIT=0

npx tsc --noEmit -p e2e\tsconfig.json
E2E_TYPESCRIPT_EXIT=0
```
