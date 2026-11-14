# Iconic Showroom (`v5`) review

## Status

**Passed-with-notes** records implementation and bounded review with
unresolved failures, not a visual or accessibility pass.
The six images below were inspected, but five capture cases failed. The
stylesheet fixes made after inspection have not been recaptured: both allowed
capture invocations have been spent.

Both invocations used:

```powershell
Set-Location web
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_CHECK_CONTRAST='1'
node scripts\capture-design-packs.mjs --pack v5 --pages dashboard,drives,energy --viewports phone-390,desktop --base-url http://127.0.0.1:54872
```

1. **Exit 1:** the shared server refused the connection before Playwright
   started; no images were produced.
2. **Exit 1:** after server recovery, Playwright reported `5 failed` and
   `1 passed (5.0m)`. All three phone cases failed; desktop Drives and Energy
   failed while a mocked `GET /api/v1/pinned` was still pending. Desktop
   Dashboard passed. Images written before those assertions are diagnostic
   artifacts, not passing tests.

Inspected all six viewport images:

- `shots\v5\phone-390-scale-1\dashboard.png`
- `shots\v5\phone-390-scale-1\drives.png`
- `shots\v5\phone-390-scale-1\energy.png`
- `shots\v5\desktop-scale-1\dashboard.png`
- `shots\v5\desktop-scale-1\drives.png`
- `shots\v5\desktop-scale-1\energy.png`

## Five findings and disposition

1. **Phone navigation clipped.** In all three phone images Charging and More
   extended below their buttons; the capture measured label bottoms at 837px
   versus button bottoms at 832px, and reported 11px on the nav buttons.
   The v5 navigation spacing was also matching the bottom bar. Excluded that
   bar from the rule and applied the shared phone body-size token to its
   buttons. A screenshot-free synthetic check of 18 combinations
   (360/390/430px, .85/1/1.35 font scales, normal/forced colors) passed
   label containment, 16px text, 44px targets, and horizontal overflow.
   Actual route recapture remains outstanding.
2. **Protected Digital Twin accessibility.** Dashboard capture reported its
   Open target at 36×36, refresh at 10×28, and heading/content text at 14px.
   These protected descendants cannot be repaired by this stylesheet; see
   `requests\v5.md`. The phone dashboard case remains failed.
3. **Dashboard secondary information was too small.** The capture identified
   12–14px context, units and footer links outside the protected subtree.
   Owner-scoped phone rules now apply the shared body-size token to widget
   context/units and links, with a 44px minimum link height. A synthetic browser
   check passed those sizes and confirmed an unowned preserved node unchanged;
   the real dashboard has not been recaptured.
4. **Readout borders were too heavy and square.** The Drives and Energy
   images showed dense rectangular, 3px-topped instrument cells that fought
   the softer showroom frames. Neutral operational metric frames now use
   subtler token borders and rounded corners without changing their values or
   bank columns. The post-fix appearance still needs visual verification.
5. **Vehicle hierarchy was delayed below the fold.** The desktop dashboard
   shows “Get started” before the vehicle card, leaving most imagery outside
   the viewport. Reduced the page-content/section gaps and stopped forcing
   phone page actions to a full-width row; those refinements are unrecaptured.
   The saved widget order itself must not be changed or hidden by a pack.
   The coordinator should decide whether the existing fixture/order is
   sufficient for showroom review; see `requests\v5.md`.

The capture's axe output reported zero contrast violations on the three phone
cases and desktop Dashboard. It also requested manual review for one phone
Drives node and two desktop Dashboard nodes because of overlap/pseudo-element
background uncertainty. Desktop Drives/Energy failed before contrast analysis.
No manual contrast pass is claimed.

## Other verification and limits

- `npx tsc --noEmit`: exit 0, no output, before the final CSS-only refinements.
- `npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx -t v5`:
  `Test Files 1 passed (1); Tests 4 passed | 107 skipped (111)`.
- Earlier broader preservation run: `175 passed, 3 failed`; the failures were
  for `v1` while that stylesheet was being edited concurrently. It was not a
  passing suite.
- `git diff --check -- web\src\components\ui\app-designs\packs\iconic.css`:
  passed. PostCSS parsed 69 owner-qualified rules with no literal CSS colors.
  The stylesheet audit reported no violations.
- No production-route, light-mode, open-dialog, or post-fix screenshot review
  was performed. No build was run. No page components or hooks were changed,
  so page line/section counts and hook routes are not applicable.

## Coordinator build

The coordinator ran `npm run build` in an isolated checkout of the committed
shared foundation with the completed Classic, v1, v2, v5, v6 and v7
stylesheets. It exited 0:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

The build does not resolve the failed captures or incomplete contrast checks.

## Showroom distinctness follow-up — 2026-11-13

The earlier phone comparisons predate later v2 and v5 refinements; they do not
establish what either pack currently looks like. To distinguish Showroom's
composition without moving components, v5 now uses a double inset gallery
frame on neutral dashboard exhibits and standalone briefs, a segmented neutral
placard rule on widget headers, a double-mat vehicle hero, and fine inset
caption and page-header keylines. The page title uses slightly wider tracking
relative to the saved tracking token; it retains the selected font. Frames
use existing palette tokens, allocate no layout space, and exclude protected
Digital Twin subtrees. Forced colors retain their existing system treatment.

Screenshot-free validation:

```text
> npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx -t v5
Test Files  1 passed (1)
     Tests  4 passed | 107 skipped (111)

> npx tsc --noEmit
[no output; exit 0]

> node -  [PostCSS selector/color check]
PASS: PostCSS parsed 75 owner-qualified rules; no literal colors.

> node -  [synthetic browser comparison with the pre-follow-up stylesheet]
PASS: 36 synthetic phone cases; geometry, protected/preview content, palette/font, overflow and keyboard interaction preserved; frames applied only in normal colors.

> git diff --check -- web\src\components\ui\app-designs\packs\iconic.css
[no output; exit 0]
```

The synthetic comparison covered 360/390/430px, .85/1/1.35 font scales,
light/dark palettes and normal/forced colors. It checked representative boxes,
vehicle-image attributes, a protected subtree, a differently owned preview,
semantic text, and a keyboard action. It is not a real-route or full
accessibility audit. No screenshots were taken and no server was started or
stopped. The visual distinctness of the current production render remains
unverified; earlier capture failures and shared requests remain as documented
above.

## Standalone DataTable frame repair — 2026-11-13

The v5 standalone DataTable frame has `shadow-e1`, not `shadow-panel`, so
the existing pack panel selectors missed it. Its owner-qualified standalone
frame now receives the showroom's token-derived neutral border and inset
gallery shadow. Embedded and protected frames are excluded; no table, scroll,
row, selection or layout properties are changed.

Before the repair, the focused DataTable command exited 1 with
`expected 0 to be greater than 0` for the v5 identity rule:
`Test Files 1 failed (1); Tests 1 failed | 34 skipped (35)`.

After the repair, from `web`:

```text
> npx vitest run src\components\ui\DataTable.appDesign.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx --testNamePattern='v5'
 RUN  v4.1.12 D:/repos/teslasync/web

 ✓ src/components/ui/DataTable.appDesign.test.tsx (35 tests | 34 skipped) 398ms
     ✓ v5 binds only the painted frame to existing base and identity surface rules  395ms
 ✓ src/components/ui/app-designs/packs/PackNativeCompositionPreservation.test.tsx (111 tests | 107 skipped) 1826ms
     ✓ keeps the native host, inline bank and specialized metrics outside generic card restructuring at every breakpoint  457ms
     ✓ honors nearest complete and incomplete previews, widget-only neutrality and final-target ownership  1135ms

 Test Files  2 passed (2)
      Tests  5 passed | 141 skipped (146)
   Start at  12:45:14
   Duration  20.83s (transform 20.38s, setup 1.45s, import 32.41s, tests 2.22s, environment 2.93s)

> node -  [synthetic browser comparison with the rule removed]
PASS: 12 synthetic browser cases (360/430/1280px, light/dark, normal/forced colors); standalone paint changed only in normal colors; frame/table/scroll geometry, selection, focus, embedded/protected/other-owner paint preserved.

> npx tsc --noEmit
[no output; exit 0]

> audit_code D:\repos\teslasync\web\src\components\ui\app-designs\packs\iconic.css
✅ web/src/components/ui/app-designs/packs/iconic.css: No violations found.

> git diff --check -- web\src\components\ui\app-designs\packs\iconic.css docs\design-packs\REVIEW-v5.md
PASS: git diff --check
```

The DataTable test also checks the actual standalone and embedded markup,
retained rows, selected values, sort and selection callbacks. The browser
comparison uses synthetic markup, not an actual route. No images were captured
and no server was managed; current visual appearance and the earlier
accessibility notes remain unverified.

The orchestrator subsequently ran `npm run build` in the verification snapshot
with the repaired v5, v6 and Atlas stylesheets: **exit 0**. All three SHA-256
hashes matched the working files. The combined native-composition, ordered-step
and DataTable contracts reported **3 files passed, 200 tests passed**. This
does not establish the post-capture appearance or contrast.
