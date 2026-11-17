# Quiet Form review

## Round 1

Inspected the dashboard, drives and energy viewport images at phone-390 and
desktop, all at saved font scale 1. The capture command exited **1**:
phone dashboard, drives and energy failed the text-size diagnostic; phone
dashboard also failed touch targets. Desktop dashboard failed the mock-API
completion check for a pending `/api/v1/pinned` request. Desktop drives and
energy completed, with respectively 7 and 20 Axe nodes needing manual contrast
review. The images from failed diagnostics are observations, not passes.

Five priority findings and changes for the final round:

1. The five phone-navigation buttons computed at 11px despite their larger
   child labels. The Quiet owner now applies the shared phone body-size floor
   to the buttons themselves.
2. Dashboard widget footer links, context and units appeared at 12–14px on
   phones. Non-protected widget text now uses the phone body-size token,
   excluding native gauges and protected descendants.
3. Desktop drives and energy filled the workspace rather than reading as a
   quiet column. Non-protected pages now have a centered 60rem maximum;
   pages containing preserved Digital Twins remain unconstrained.
4. Operational metric banks displayed doubled horizontal dividers. Their
   redundant outer bank borders are removed; the individual reading rules
   remain.
5. Protected Digital Twin phone text and controls remain below the requested
   minima. They cannot be altered in this pack. See
   `requests\quiet.md` and the existing shared decision.

The four owned changes above were checked in the final capture round.

## Final round

The same six phone-390 and desktop viewport images were opened and inspected.
The capture command exited **1**: **5 passed, 1 failed**. Phone drives and
energy and all three desktop captures completed. The phone dashboard still
failed solely on the protected Digital Twin: its Open and refresh targets
measured 36 × 36px and 10 × 28px, and three text nodes measured 14px. The
previous non-protected phone text failures did not recur. The narrower reading
column and removal of the duplicate metric-bank rules are visible on desktop
drives and energy; the preserved dashboard retains its original width.
After the final images, the overlay token was adjusted to `--surface-3` so
dialog elevation is distinct from raised surfaces; no dialog was open in the
captured views, and dialog appearance was not visually verified.

Axe reported zero violated contrast rules in each capture, but manual-review
nodes remain: phone dashboard 0, drives 1, energy 0; desktop dashboard 2,
drives 4, energy 2. These incomplete checks are not a contrast pass.

Both rounds used:

```powershell
$env:DESIGN_PACK_CAPTURE_OUTPUT_ROOT='D:\repos\teslasync\docs\design-packs\shots\quiet'
node 'C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs' quiet
```

## Other verification and limits

- `npx tsc --noEmit` in `web`: exit 0, no output.
- Quiet's isolation, native-composition and ordered-step Vitest selection:
  3 files passed, 9 tests passed, 169 skipped. It includes the nested
  Bauhaus-to-Quiet preview check.
- An earlier broader Quiet-name selection failed the Quiet-to-Warm nested
  preview assertion: Warm's chart-viewport rules require an ancestor
  `data-chart-variant`, but the test inserts the viewport alone into a
  preview. Warm subsequently supplied its owner-qualified viewport surface;
  the cross-pack assertion passed in the combined run below.
- The TeslaSync guideline audit reported no violations in `quiet.css`.
  At that point the worker had not run the full test suite or a build. The
  review did not cover other viewport widths, light theme, forced colors, or
  dialog screenshots.

The orchestrator subsequently built a snapshot containing the final Terminal,
Editorial, Quiet, Swiss and Warm stylesheets with `npm run build` (exit 0);
Quiet's SHA-256 matched the working stylesheet. A combined native
composition, ordered-step and DataTable selection reported 3 files passed,
35 tests passed and 165 skipped. These checks do not resolve the visual or
contrast findings above.

## Layout-name wrapping follow-up (no recapture)

Quiet's phone-only layout-switcher rule now wraps the selected name, keeps the
adjacent caption on one line, and excludes preserved descendants. It does not
change the desktop rule. No screenshots were taken in this follow-up.

### Real-browser DOM verification

The browser loaded the real `LayoutSwitcher` and the live Vite-compiled
`index.css` and `appDesignPacks.css`, inside a synthetic page-actions context
with a seeded vehicle. It measured individual character rectangles, touch
target geometry, horizontal overflow, a nested Warm preview, a preserved
sample (including a deliberately stale owner), and menu open/switch/Escape
behavior. The protected sample is not a Digital Twin rendering.

Command, from the repository root (the temporary fixture was removed after
the run):

```powershell
Set-Location 'web'
$env:TEMP = (Resolve-Path '..\docs\design-packs\shots\quiet').Path
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
Get-Content -Raw '..\docs\design-packs\shots\quiet\layout-dom-check.cjs' | node -
```

Final run, exit 0:

```text
{"width":360,"scale":1,"scrollWidth":360,"shortDelta":{"width":0,"height":0},"scenarios":{"normal":{"button":[256.25,81.17],"fontSize":16,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"short":{"button":[140.25,44],"fontSize":16,"nameLines":1,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"long":{"button":[256.25,103.56],"fontSize":16,"nameLines":4,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"badges":{"button":[328,81.17],"fontSize":16,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0}}}
{"width":360,"scale":1.35,"scrollWidth":360,"shortDelta":{"width":0,"height":0},"scenarios":{"normal":{"button":[270.34,104.66],"fontSize":21.6,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"short":{"button":[169.73,44.22],"fontSize":21.6,"nameLines":1,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"long":{"button":[270.34,165.09],"fontSize":21.6,"nameLines":5,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"badges":{"button":[328,137.5],"fontSize":21.6,"nameLines":4,"captionLines":1,"clippedCharacters":0,"widthDelta":0}}}
{"width":390,"scale":1,"scrollWidth":390,"shortDelta":{"width":0,"height":0},"scenarios":{"normal":{"button":[256.25,81.17],"fontSize":16,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"short":{"button":[140.25,44],"fontSize":16,"nameLines":1,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"long":{"button":[256.25,103.56],"fontSize":16,"nameLines":4,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"badges":{"button":[358,81.17],"fontSize":16,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0}}}
{"width":390,"scale":1.35,"scrollWidth":390,"shortDelta":{"width":0,"height":0},"scenarios":{"normal":{"button":[270.34,104.66],"fontSize":21.6,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"short":{"button":[169.73,44.22],"fontSize":21.6,"nameLines":1,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"long":{"button":[270.34,165.09],"fontSize":21.6,"nameLines":5,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"badges":{"button":[358,104.66],"fontSize":21.6,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0}}}
{"width":430,"scale":1,"scrollWidth":430,"shortDelta":{"width":0,"height":0},"scenarios":{"normal":{"button":[256.25,81.17],"fontSize":16,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"short":{"button":[140.25,44],"fontSize":16,"nameLines":1,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"long":{"button":[256.25,103.56],"fontSize":16,"nameLines":4,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"badges":{"button":[398,81.17],"fontSize":16,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0}}}
{"width":430,"scale":1.35,"scrollWidth":430,"shortDelta":{"width":0,"height":0},"scenarios":{"normal":{"button":[270.34,104.66],"fontSize":21.6,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"short":{"button":[169.73,44.22],"fontSize":21.6,"nameLines":1,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"long":{"button":[270.34,165.09],"fontSize":21.6,"nameLines":5,"captionLines":1,"clippedCharacters":0,"widthDelta":0},"badges":{"button":[398,104.66],"fontSize":21.6,"nameLines":3,"captionLines":1,"clippedCharacters":0,"widthDelta":0}}}
PASS: stale-owner preserved exclusion, forced-colors wrapping, desktop truncation
PASS: live Vite CSS and real LayoutSwitcher; phone widths, saved font scale, owner isolation, protected sample, target geometry, and menu interaction
```

`widthDelta` compares with the old truncation applied in the fixture; the
short-name target also retained its height. Two earlier fixture setup attempts
failed before measurement because an API route mock also matched source
modules, then because the Vite React preamble was absent; both were corrected.

### Preservation and audit results

From `web`, the focused command:

```powershell
npx vitest run 'src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx' 'src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx' 'src\components\ui\DataTable.appDesign.test.tsx' -t 'quiet|keeps public/widget-only/incomplete|removes only the surface binding'
```

```text
Test Files  3 passed (3)
     Tests  9 passed | 191 skipped (200)
```

The broader DataTable selection below exited 1, despite the Quiet tests passing:

```powershell
npx vitest run 'src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx' 'src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx' 'src\components\ui\DataTable.appDesign.test.tsx' -t 'quiet|DataTable standalone frame source-to-consumer contracts'
```

```text
FAIL  src/components/ui/DataTable.appDesign.test.tsx > DataTable standalone frame source-to-consumer contracts > observatory binds only the painted frame to existing base and identity surface rules
AssertionError: expected 0 to be greater than 0
 ❯ expectSurface src/components/ui/DataTable.appDesign.test.tsx:47:27
Test Files  1 failed | 2 passed (3)
     Tests  1 failed | 34 passed | 165 skipped (200)
```

The separate confirmation command also exited 1:

```powershell
npx vitest run 'src\components\ui\DataTable.appDesign.test.tsx' -t 'observatory binds only the painted frame|quiet binds only the painted frame'
```

```text
Test Files  1 failed (1)
     Tests  1 failed | 1 passed | 33 skipped (35)
```

The failing assertion concerned Observatory's identity rules and was outside
Quiet's ownership. No other pack was modified by the Quiet worker. After the
Observatory owner fixed its selector, the broader selection was rerun from
`web` with one worker:

```powershell
npx vitest run 'src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx' 'src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx' 'src\components\ui\DataTable.appDesign.test.tsx' -t 'quiet|DataTable standalone frame source-to-consumer contracts' --maxWorkers=1
```

```text
 RUN  v4.1.12 D:/repos/teslasync/web

 ✓ src/components/ui/app-designs/packs/PackNativeStepsPreservation.test.tsx (54 tests | 52 skipped) 508ms
 ✓ src/components/ui/app-designs/packs/PackNativeCompositionPreservation.test.tsx (111 tests | 107 skipped) 596ms
     ✓ honors nearest complete and incomplete previews, widget-only neutrality and final-target ownership  386ms
 ✓ src/components/ui/DataTable.appDesign.test.tsx (35 tests | 6 skipped) 1019ms

 Test Files  3 passed (3)
      Tests  35 passed | 165 skipped (200)
   Start at  13:20:56
   Duration  17.82s (transform 5.91s, setup 906ms, import 13.03s, tests 2.12s, environment 987ms)
```

Exit 0.

From the repository root, the scoped skill audit and TypeScript check:

```powershell
$script = (Resolve-Path '.github\skills\audit-violations\audit.sh').Path
$target = (Resolve-Path 'web\src\components\ui\app-designs\packs\quiet.css').Path
& 'C:\Program Files\Git\bin\bash.exe' -c 'exec bash "$(cygpath -u "$1")" "$(cygpath -u "$2")"' bash $script $target
```

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

  ✅ ALL CHECKS PASSED — 0 total violations
```

Exit 0. The source-pattern categories scan TypeScript/TSX, not CSS; the
TypeScript step ran `npx tsc --noEmit`. The existing protected Digital Twin
text and target-size findings and outstanding manual contrast review remain.
