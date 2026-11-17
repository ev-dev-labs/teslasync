# Material Play bounded review

## First round

The six initial 390px and desktop dashboard, drives, and energy images were
inspected. The capture exited **1**: four tests passed; the phone dashboard
failed the touch/text diagnostics and the desktop dashboard had a pending
mocked `/api/v1/pinned` request.

Five concrete findings and changes:

1. The dashboard's selected layout was ellipsized on both widths. The
   initial selector missed the `section` wrapper and the second capture
   still showed the ellipsis. A subsequent owner-qualified selector permits
   the full name to wrap; a synthetic browser check confirms its computed
   overflow and wrapping, but this post-capture change was not recaptured.
   Its static screen-reader name still needs the shared fix requested
   separately.
2. The 390px Energy title wrapped after “Energy” despite available header
   space. The first adjustment was overridden by later shared mobile CSS,
   so the second capture still showed the wrap. A subsequent targeted title
   flex basis passed a synthetic browser geometry check at 360, 390, and
   430px, but was not recaptured against the real page.
3. The desktop “Setup checklist hidden” widget placed its action in an
   oversized, full-width empty slab between half-width blocks. Its
   Material-owned empty-state action and detail slots now form a more compact
   group without changing the controls; the second desktop screenshot shows
   the action alongside the lead and the explanatory text below.
4. Desktop rail labels were approximately 11px and difficult to scan. Their
   size now follows the saved font scale from a 12px base.
5. The phone dashboard diagnostic found two undersized controls and four
   undersized texts, including a 12px `km` unit. Non-protected ordinary
   `text-sm` metric units now use the phone body floor; the protected twin
   controls and text remain a shared request. The unit's ancestry was not
   recorded, but it no longer appeared in the second diagnostic.

These are changes made after inspection, not yet visual passes. Axe reported
zero violated rules on the five completed contrast checks, but 3, 1, 0, 6,
and 16 nodes respectively need manual review for phone dashboard, phone
drives, phone energy, desktop drives, and desktop energy. Desktop dashboard
contrast did not run. Incomplete checks are not contrast passes.

## Final capture and remaining limitations

The second and last invocation exited **1**: five tests passed and the phone
dashboard failed. All six final images were inspected: `dashboard.png`,
`drives.png`, and `energy.png` in each of `shots\material\phone-390-scale-1`
and `shots\material\desktop-scale-1`. The six first-round images are preserved
under `shots\material\round-1`; full output is in `capture-round-1.log` and
`capture-round-2.log`.

The remaining phone failures are within the protected Digital Twin: Open is
36×36px; Refresh is 10×28px; “Digital twin”, “—”, and “Aurora” are 14px.
They are not modified by this pack. Desktop dashboard succeeded in round two,
including the mocked-request check; the prior pending `/api/v1/pinned` was not
reproduced.

Final Axe output reported zero violated rules and respectively **3, 1, 0,
6, 6, 16** incomplete nodes for phone dashboard, drives, energy and desktop
dashboard, drives, energy. These nodes need manual contrast review; this is
not an accessibility pass.

The post-capture selector and header fixes were tested in a synthetic Edge
document using the real Material and shared mobile styles in source order,
without screenshots. Headings occupied one 30px line at 360/390/430/1440px;
the example layout name had `overflow: visible`, `white-space: normal`, and
`max-width: none`; no synthetic viewport had horizontal overflow. This is not
a replacement for a real-page visual recapture. An initial probe incorrectly
required the actions to wrap even at 430px, where they fit; the corrected
probe allows the single-line arrangement and passed.

## Verification

```text
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='material binds only the painted frame' --reporter=dot --maxWorkers=1

 RUN  v4.1.12 D:/repos/teslasync/web

--------------------·--------------

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  12:55:32
   Duration  12.26s (transform 5.88s, setup 557ms, import 8.28s, tests 495ms, environment 2.54s)
```

```text
npx vitest run src\components\ui\app-designs\packs\PackCMetricPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx --testNamePattern material --maxWorkers=1

 Test Files  3 passed (3)
      Tests  9 passed | 183 skipped (192)
```

```text
npx tsc --noEmit
TSC_EXIT=0

npx vitest run src\components\ui\AppDesignBridge.test.tsx --maxWorkers=1
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
AssertionError: expected '' to be '0px' // Object.is equality
BRIDGE_TEST_EXIT=1
```

The bridge failure is the shared test's Bauhaus-root `--panel-radius`
expectation in `AppDesignBridge.test.tsx:125`; the Bauhaus stylesheet currently
does not assign that property. Its owner reports that the root override was
intentionally removed because it inherited into protected Digital Twin
GlassPanels; Bauhaus now uses the owner-qualified `--app-card-radius` instead.
The shared test expectation needs updating to check the scoped token and
preview reset. The test has not been rerun since that explanation.

```text
Material-scoped audit: No violations found.
Hardcoded CSS color matches: 0
Inline-style, direct-library, old-API and double-prefix matches: 0
git diff --check: clean
```

No build was run by this worker; page line counts, section counts, and
API-hook route changes are not applicable to this stylesheet-only
implementation. The six captures use the default theme and font scale; they
do not establish visual passes for light theme, other scales, reduced motion,
or forced colors.

The orchestrator corrected the stale Bauhaus assertion and reran the bridge
test against the current styles:

```text
Test Files  1 passed (1)
     Tests  13 passed (13)
```

An isolated snapshot containing the finished Material stylesheet passed
`npm run build`; its stylesheet hash matched the working tree:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
MATERIAL_SNAPSHOT_BUILD_EXIT=0
MATERIAL_HASH_MATCH=True
```
