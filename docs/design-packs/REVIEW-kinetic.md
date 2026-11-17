# Kinetic Type review

## Round 1

Command: `node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs kinetic`
with `DESIGN_PACK_CAPTURE_OUTPUT_ROOT` set to the absolute `docs\design-packs\shots\kinetic` path.
Exit **1**: three desktop tests passed; all three phone tests failed their accessibility diagnostics.
All six viewport images were opened: dashboard, drives and energy at phone-390 and desktop.
The first-round images are preserved under `shots\kinetic\round-1`.

Five concrete findings and owned refinements, pending the final capture:

1. The five phone navigation buttons computed at 11px even though their child labels displayed at 16px. The pack now applies the mobile body-size token to the button itself without changing tab geometry.
2. The dashboard audit found 14px widget context and 12px units and footer links outside the preserved twin. Mobile widget copy now uses the body-size token, and small footer links receive a 44px-high touch area.
3. “Drive history” and “Energy intelligence” wrapped under competition from header actions at 390px. Phone titles now reserve enough width before actions wrap to the next row.
4. The inherited vertical title stripe competed with the pack's horizontal directional rule. The decorative stripe is suppressed for the owned page header; the rule remains, including its RTL direction.
5. Operational summaries appeared as densely boxed tiles, and “No baseline” and “120 Wh/km” wrapped at phone size. Standalone summary tiles now use quiet bottom rules, with a scale-aware 20px minimum reading on phones.

The protected Digital Twin still produced 36×36px Open and 10×28px Refresh targets and 14px text. It cannot be changed by this stylesheet without violating preservation. Axe reported zero contrast violations but **36 incomplete nodes** across the six tests, requiring manual review; this is not a contrast pass. See `requests\kinetic.md` for shared follow-up.

## Final round

The same command ran a second and final time, with the same output root. Exit **1**:

```text
1 failed
  [phone-390] capture dashboard (/)
5 passed (4.3m)
```

The remaining dashboard failures are the protected twin's 36×36px Open and 10×28px Refresh controls and 14px “DIGITAL TWIN”, “—”, and “Aurora” text. The previously reported 11px navigation button text and unprotected widget copy are no longer in the diagnostic output. Both phone drives and energy passed the capture checks. Axe again reported zero violated rules and 36 incomplete nodes requiring manual contrast review.

All six final viewport images were opened: `phone-390-scale-1\dashboard.png`, `drives.png`, and `energy.png`; and `desktop-scale-1\dashboard.png`, `drives.png`, and `energy.png` under `shots\kinetic`. The drive heading and both previously wrapped readings now fit on one line. The energy heading still wraps naturally to two readable words at 390px. The redundant vertical stripe is gone and the operational metrics use lighter rules. Complete terminal diagnostics are retained in `shots\kinetic\round-1.log` and `round-2.log`.

## Focused verification

The requested standalone DataTable frame contract initially failed with `1 failed | 34 skipped`: Kinetic's ordinary panel rule did not match the table's existing standalone frame. A final owner-qualified, token-derived paint-only frame rule was added; it does not change embedded grids, selection, scrolling, dimensions, or table contents. This rule was added after the two screenshot rounds and has **not** been visually recaptured.

```text
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='kinetic binds only the painted frame' --reporter=dot --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed | 34 skipped (35)

npx vitest run src\components\ui\app-designs\packs\PackCMetricPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx -t kinetic --reporter=dot --maxWorkers=1
Test Files  3 passed (3)
     Tests  9 passed | 183 skipped (192)

npx vitest run src\components\ui\AppDesignBridge.test.tsx -t 'explicitly resets every assigned app-owned property' --reporter=dot --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed | 12 skipped (13)

npx tsc --noEmit
[no output; exit 0]
```

The CSS audit returned `No violations found`; a selector check returned `Owner-qualified selectors: 70/70`; `git diff --check` was clean. No build was run. Light themes, forced colors, RTL, other routes and 360/430px were not visually captured in these bounded rounds. Shared standalone-route coverage and identity-safe no-flash selection remain outside this pack's verification.

## Follow-up: dashboard layout name on phones

The final 390px dashboard image truncated the selected name. Before the fix,
the real dashboard's name span had `white-space: nowrap`, `overflow: hidden`
and `text-overflow: ellipsis`; its scroll width was 285px in a 160px box.
The Kinetic-only phone rule now allows the name to wrap, including long
unbroken words, and keeps the adjacent caption unbroken and nonshrinking.
The original 160px name limit and 256.25px button width remain; the
auto-height button grows from 44px to 81.17px to show the full fixture name.
The rule also applies in forced-colors mode. It is owner-qualified and does
not target the protected Digital Twins.

Screenshot-free real-CSS DOM check: `node -` with an inline Playwright
script and the existing synthetic dashboard fixture, served by the shared
Vite server. The script checked the complete selected text, per-character
text bounds, caption/name/icon separation, target dimensions, page scroll,
menu opening and Escape, and the two protected twins before and after the
interaction. It checked the actual combined Vite stylesheet, not a copied
CSS rule. No screenshots were taken.

```text
PASS 360px name_lines=3 caption_lines=1 button=256.25x81.17 name=160x67 scroll=360/360 twins=2 owned_twin_descendants=0 menu=open+Escape
PIN 360px button=328.00x81.17 right=344.00 scroll=360/360 name_lines=3 name_contained=true text="Layout\nImplementation review - synthetic data\nmodified\nAurora"
PASS 390px name_lines=3 caption_lines=1 button=256.25x81.17 name=160x67 scroll=390/390 twins=2 owned_twin_descendants=0 menu=open+Escape
PASS 430px name_lines=3 caption_lines=1 button=256.25x81.17 name=160x67 scroll=430/430 twins=2 owned_twin_descendants=0 menu=open+Escape
```

An additional inline `node -` check asserted nonoverlap and containment
with actual pinned and modified badges, enlarged text, an unbroken long
name, forced colors, and a different final-target owner:

```text
PASS 360px scale=1.35 pinned+modified name_lines=4 caption_lines=1 button=328.00x137.50 badges=2 overlap=0 scroll=360/360
PASS 360px scale=1.35 forced_colors=false unbroken_name_lines=6 text_contained=true owner_isolation=true scroll=360/360
PASS 390px scale=1 forced_colors=true unbroken_name_lines=4 text_contained=true owner_isolation=true scroll=390/390
```

The first DOM-check attempt failed because it expected a standalone
`kinetic.css` Vite style tag; Vite actually combines the rule into
`appDesignPacks.css`. The checks above use the combined live stylesheet.
These are DOM checks, not a new visual review.

```text
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='kinetic binds only the painted frame' --reporter=dot --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed | 34 skipped (35)
DATATABLE_EXIT=0

npx vitest run src\components\ui\app-designs\packs\PackCMetricPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx -t kinetic --reporter=dot --maxWorkers=1
Test Files  3 passed (3)
     Tests  9 passed | 183 skipped (192)
NATIVE_EXIT=0

npx vitest run src\features\dashboard\components\__tests__\DashboardGrid.test.tsx -t 'preserves .* viewport presentation' --reporter=dot --maxWorkers=1
Test Files  1 passed (1)
     Tests  4 passed | 16 skipped (20)
TWIN_EXIT=0

npx tsc --noEmit
[no output]
TSC_EXIT=0
```

The audit skill's `audit.sh` was run through WSL against the owned CSS,
with the Windows paths translated by `wslpath`. Its actual output was:

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
AUDIT_EXIT=0
```

Those six pattern counts are CSS-only and do not audit TS/TSX; TypeScript
was actually run. An independent scoped `Select-String` count returned:

```text
raw HTML controls: 0
static inline styles: 0
camelCase URL params: 0
direct library or old API imports: 0
double API prefix: 0
GREP_EXIT=0
```

The CSS audit tool also reported `No violations found`. A PostCSS selector
scan returned `Owner-qualified selectors: 72/72` and `SELECTOR_EXIT=0`;
`git diff --check` returned `DIFF_CHECK_EXIT=0`. The unchanged dashboard page
has 1,050 lines and three `GlassPanel`/`ChartContainer` occurrences both at
HEAD and in the working tree. No hooks were changed; the directly relevant
dashboard and preference routes were spot-checked against `router.go`.

The audit process generated an untracked `shots\kinetic\node-compile-cache`.
Its 535 verified generated files were removed individually, without recursive
directory deletion; the empty directories remain. No build or further
screenshot capture was run.
