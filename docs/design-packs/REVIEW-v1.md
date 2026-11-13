# Telemetry Studio (`v1`) review

Status: **passed-with-notes** for the bounded review, not a visual or
accessibility pass.

Studio uses theme-derived workbench surfaces, a narrow desktop rail, compact
instrument groups, calibrated chart rules, and restrained controls. Native
chart allocation, metric composition, semantic colors, saved preferences, and
the protected Digital Twin boundary remain intact.

## First round: defects and actions

The shared preview server stopped during the first round. Only the 390px
dashboard image was available and inspected; the drive capture encountered
`net::ERR_CONNECTION_REFUSED`. The invocation was interrupted rather than
continuing against the stopped server. Its status is **interrupted**, not a
pass or a numeric exit code. The other five views were not inspected in this
round.

1. The dashboard title had two adjacent accent rules. Removed the added rule
   and retained the page's original title marker.
2. The phone navigation buttons reported an 11px computed font size. Applied
   the shared, preference-aware mobile body size to their Studio-owned targets.
3. Dashboard footer links, including “All drives” and “Open vehicle”, reported
   12px text. Gave Studio-owned widget footer links the mobile text and touch
   floors while retaining wrapping.
4. An app-owned headline subtitle and unit reported 14px and 12px respectively.
   Applied the mobile text floor to contextual readings without changing the
   native metric host or data. The final diagnostic still found a 12px unit in
   a widget stat card; the selector was extended after that capture, but this
   last adjustment has not been visually reverified. A screenshot-free
   synthetic browser check measured the owned unit at 16px and an unowned
   protected unit at 12px.
5. Protected Digital Twin controls measured 36×36px and 10×28px, with 14px
   text. They remain untouched; see `requests/v1.md`. These are unresolved
   accessibility failures, not passes.

The initial native-composition contracts also exposed missing Studio ownership
on ordinary stat cards, an existing metric grid, and embedded chart viewports.
The stylesheet now supplies those treatments without changing plot dimensions,
native gauges, special metric structures, or embedded transparency.

First-round dashboard contrast output: `Contrast: 0 violated rules, 0 nodes
require manual review`. The dashboard nevertheless failed its touch and text
diagnostics as described above.

## Final round

Both rounds used:

```powershell
Set-Location web
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_CHECK_CONTRAST='1'
node scripts\capture-design-packs.mjs --pack v1 --pages dashboard,drives,energy --viewports phone-390,desktop --base-url http://127.0.0.1:54872
```

Final invocation exit **1**: `2 failed, 4 passed`. All six final viewport
images were opened and inspected:

- `shots/v1/phone-390-scale-1/dashboard.png`
- `shots/v1/phone-390-scale-1/drives.png`
- `shots/v1/phone-390-scale-1/energy.png`
- `shots/v1/desktop-scale-1/dashboard.png`
- `shots/v1/desktop-scale-1/drives.png`
- `shots/v1/desktop-scale-1/energy.png`

The duplicate dashboard title rule is gone. The final phone dashboard still
failed on the protected Twin's two small targets and three 14px text elements,
plus the 12px stat-card unit noted above. The previous navigation, widget
footer-link and headline-subtitle text findings no longer appeared in that
diagnostic. Desktop dashboard failed because `GET /api/v1/pinned` remained
pending in the mock-routing completeness check; its image was saved before
that failure, but contrast and full diagnostic completion are unverified.

The phone drives and energy and desktop drives and energy tests passed their
runner assertions. Axe reported zero violated contrast rules in each completed
contrast analysis, but **manual review is still required** for 1 node on phone
drives, 6 on desktop drives, and 12 on desktop energy. Phone dashboard and phone
energy had zero incomplete nodes. Incomplete nodes are not contrast passes.

The desktop energy image also shows the opening operational brief shifted
approximately 227px right of the page content, leaving an empty left column.
The frozen shared workbench layout places headerless section content in its
second grid column; a shared correction is requested below rather than
modifying that foundation. No third screenshot round was taken.

## Verification

- Before the final CSS adjustment, the violations audit reported `0 total
  violations` and `TypeScript passes`; subsequent edits were CSS only.
- After the post-capture CSS adjustment, `audit_code` returned `No violations
  found` for `studio.css`.
- The initial combined bridge/native-preservation run exited 1 with
  `3 failed | 175 passed (178)`; the three failures concerned Studio's
  stat-card, adjacent-preview ownership, and viewport treatments.
- `npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx --testNamePattern='(classic|v1).*native' --reporter=dot`:
  `Test Files 2 passed (2); Tests 12 passed | 153 skipped (165)`.
- After the post-capture adjustment,
  `npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx --testNamePattern='(classic|v1).*native' --reporter=dot`
  reported `Test Files 1 passed (1); Tests 8 passed | 103 skipped (111)`.
- A screenshot-free Playwright fixture, with the 390px mobile stylesheet and
  competing 12px stat-card rule, reported
  `STUDIO_UNIT_SIZES owned=16px protected=12px PASS`; this does not replace a
  real dashboard recapture.
- `git diff --check -- web\src\components\ui\app-designs\packs\studio.css`:
  exit 0.
- No build was run, per the worker brief. Page line/section comparisons and
  API-hook checks do not apply: no page or hook was modified.

Only the specified dark/default-scale 390px and desktop capture is in scope.
Light mode, 360px and 430px, open states, other routes, and final-gate
accessibility remain unverified.

## Coordinator build

The coordinator ran `npm run build` in an isolated checkout of the committed
shared foundation with the completed Classic, v1, v2, v5, v6 and v7
stylesheets. It exited 0:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

The build does not resolve the failed captures or incomplete contrast checks.
