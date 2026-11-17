# Memphis Pop bounded review

The application pack uses alternating geometric corners, token-derived
surfaces and small printed accents without replacing semantic colors,
chart series, native grid behavior or the protected Digital Twins.

## First round

With `DESIGN_PACK_CAPTURE_OUTPUT_ROOT`, `TEMP`, `TMP`, and `TMPDIR` set to
`D:\repos\teslasync\docs\design-packs\shots\memphis`, the command was:

```text
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs memphis
exit 1
3 failed
  [phone-390] capture dashboard (/)
  [phone-390] capture drives (/drives)
  [phone-390] capture energy (/energy)
3 passed (3.4m)
```

All six images were opened and inspected, then preserved in
`shots\memphis\round-1\`:

- `phone-390-scale-1\dashboard.png`, `drives.png`, and `energy.png`
- `desktop-scale-1\dashboard.png`, `drives.png`, and `energy.png`

Five priority findings and the subsequent stylesheet changes:

1. The dashboard's selected layout name was ellipsized on both widths. The
   owned context trigger and name now permit wrapping within bounded width.
2. Drives and Energy operational briefs looked like generic rectangular
   cards rather than Memphis groupings. Standalone briefs and their neutral
   metric tiles now receive alternating corners and token-derived depth;
   desktop brief headings gain a small dot accent.
3. The 390px Drives and Energy title banners left commands on a separate row
   and consumed substantial vertical space. The Energy command now shares
   the title row; Drives retains a second row to keep its title and three
   controls readable without overlap.
4. The phone navigation buttons computed at 11px on all three pages, and
   desktop rail captions were also 11px. They now follow the shared phone
   body floor and the saved font scale respectively; the selected phone tab
   also receives the pack's asymmetric shape.
5. Phone dashboard diagnostics reported non-protected metric context at 14px
   and footer links and metric units at 12px. Their owned targets now use the
   shared phone body-size floor, with 44px footer-link minimums. A remaining
   stat-card unit was found in the final capture and fixed afterwards.

The first phone dashboard also reported 36×36px Open and 10×28px Refresh
controls and 14px text in the protected Digital Twin. Its 14px “Aurora”
text lacked ancestry in the capture; a later DOM probe confirmed it is inside
the protected subtree. These cannot be changed by this pack.

The six Axe scans reported zero violated rules and respectively 4, 1, 0,
8, 5 and 18 nodes requiring manual contrast review (phone dashboard, drives,
energy, then desktop dashboard, drives, energy). Incomplete findings are not
contrast passes. See `shots\memphis\round-1.log` for the full diagnostics.

## Final round

The same six-image command was run once more, with the same environment:

```text
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs memphis
exit 1
1 failed
  [phone-390] capture dashboard (/)
5 passed (2.0m)
```

All six final images were opened and inspected, with none missing:
`shots\memphis\phone-390-scale-1\{dashboard,drives,energy}.png` and
`shots\memphis\desktop-scale-1\{dashboard,drives,energy}.png`.
The 390px Drives and Energy captures now pass; the dashboard still failed on
the protected Twin's Open and Refresh targets and three 14px strings, plus
an unprotected 12px stat-card `km` unit.

The final six Axe scans reported zero violated rules and respectively
4, 1, 0, 7, 5 and 18 nodes requiring manual contrast review (phone dashboard,
drives, energy, then desktop dashboard, drives, energy). These incomplete
nodes are not passes; see `shots\memphis\round-2.log`.

The final images also showed the Energy heading's dot accent wrapping alone
onto a second line. After that last capture, the owned mobile page-heading
decoration was removed and the remaining stat-card unit (and an untagged
widget unit) was brought to the body-size floor. **The final images predate
these two last CSS fixes**; the two-round limit prevents another visual
capture. A screenshot-free DOM check subsequently measured both owned `km`
units at 16px and confirmed that the small “Aurora” is protected. A full
dashboard scan using the capture runner's existing text and touch helpers
still failed only on the three protected 14px strings and two protected
undersized targets. The shared request is in `requests\memphis.md`.

Light theme, other routes, open controls, Helix, forced colors and overall
production acceptance remain visually unverified. No build was run.

## Verification after the final CSS changes

The temporary screenshot-free Playwright probe (removed after execution) used
the existing server and the capture runner's diagnostic helpers:

```text
node node_modules\@playwright\test\cli.js test --config ..\docs\design-packs\shots\memphis\memphis-probe.config.cjs --workers=1
  1 failed
  1 passed (46.1s)
DIAGNOSTICS_EXIT=1
```

The passing test checked header containment, navigation labels and touch
dimensions, document/main overflow and the dashboard layout name on the
three captured routes at 360/390/430px and scales 0.85/1/1.35. It also
confirmed that the mobile heading pseudo-element is suppressed. The failed
test is the full dashboard text/target scan described above; it was not
filtered to make it pass. Its log is `shots\memphis\post-fix-diagnostics.log`.

The focused preservation command, run from `web`, returned:

```text
npx vitest run src\components\ui\DataTable.appDesign.test.tsx src\components\ui\app-designs\packs\PackCMetricPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx --testNamePattern=memphis --reporter=dot
 Test Files  4 passed (4)
      Tests  10 passed | 217 skipped (227)
TEST_EXIT=0
```

The separately requested standalone DataTable contract also ran:

```text
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='memphis binds only the painted frame' --reporter=dot
 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
TEST_EXIT=0
```

The shared bridge test, which had reported a Bauhaus `--panel-radius`
mismatch in an earlier run, passed when rerun:

```text
npx vitest run src\components\ui\AppDesignBridge.test.tsx --reporter=dot
 Test Files  1 passed (1)
      Tests  13 passed (13)
BRIDGE_TEST_EXIT=0
```

The scoped audit used Git Bash from the repository root; the TypeScript
command it runs is `cd web` followed by `npx tsc --noEmit`:

```text
C:\Program Files\Git\bin\bash.exe .github\skills\audit-violations\audit.sh web\src\components\ui\app-designs\packs\memphis.css
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
AUDIT_EXIT=0
```

The category scans above were scoped to the CSS file, not the application.
An additional PostCSS selector/paint guard check returned:

```text
Parsed 56 rules; ownership, hardcoded-color and forced-colors paint errors: 0
CSS_CHECK_EXIT=0
```

API-hook verification and page line/section comparisons are not applicable
to this CSS-only change.
