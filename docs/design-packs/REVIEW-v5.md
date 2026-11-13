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
