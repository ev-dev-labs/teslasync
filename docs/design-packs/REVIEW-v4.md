# Executive Concierge (`v4`) — bounded review, not passed

The pack uses theme-derived canvas, panel, raised and overlay surfaces; a
structured sidebar; outlined controls; curated card summaries with a quiet
vertical guide; framed charts; and a composed Helix surface. Series palettes,
semantic colors, saved preferences, native grid/chart composition and
protected Digital Twin subtrees remain owned by their existing systems.

## Capture evidence

Both permitted invocations used:

```powershell
Set-Location web
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_CHECK_CONTRAST='1'
node scripts\capture-design-packs.mjs --pack v4 --pages dashboard,drives,energy --viewports phone-390,desktop --base-url http://127.0.0.1:54872
```

- Round 1: **exit 1**, `fetch failed`; the shared server had stopped before
  any image was produced. `shots\v4\round-1.log` records the failure.
- Round 2, after server recovery and stylesheet changes: **exit 1**, **4
  failed, 2 passed**. All six images were produced and individually inspected:
  - `shots\v4\phone-390-scale-1\dashboard.png`
  - `shots\v4\phone-390-scale-1\drives.png`
  - `shots\v4\phone-390-scale-1\energy.png`
  - `shots\v4\desktop-scale-1\dashboard.png`
  - `shots\v4\desktop-scale-1\drives.png`
  - `shots\v4\desktop-scale-1\energy.png`

The images are defect evidence, not passing results. The two pack-local
corrections below were made **after** the final capture and checked without
screenshots; the images therefore do not show those final corrections. No
third screenshot round was taken.

## Five important findings

1. **Phone navigation clipping and hit areas.** All three 390px captures
   reported clipped Charging and More labels. The v4 navigation spacing
   incorrectly included the bottom bar; the pack now excludes it. A
   screenshot-free real-route check subsequently found no clipped or split
   labels. However, the shared bar still has overlapping 60px hit areas and
   extends below the viewport; it is not a mobile pass.
2. **Desktop header hierarchy.** On Drives and Energy, the theme control
   wrapped onto a second row. The v4 header now reserves more of its grid for
   controls. A real-route DOM check measured the header decreasing from 117px
   to 73px, with all four controls on one row. The final change has not been
   recaptured.
3. **Protected Digital Twin phone access.** The dashboard diagnostic measured
   Open at 36×36px and refresh at 10×28px; twin text was 14px. The protected
   composition was not altered. A compatible shared resolution is required.
4. **Phone typography.** The diagnostic reported 12–14px app-owned dashboard
   copy, including Recent Drives and fleet-posture links. It also reported the
   bottom-nav buttons at 11px: the post-fix DOM check measured their visible
   label spans at 16px, but the buttons themselves still compute to 11px.
   The shared rule and diagnostic need coordinated review.
5. **Incomplete contrast and dashboard fixture evidence.** The desktop
   Dashboard run failed with a pending synthetic `GET /api/v1/pinned`, before
   its contrast check completed. Axe reported one incomplete node on phone
   Drives, four on desktop Drives and 13 on desktop Energy; these need manual
   review, not a pass. The phone Dashboard's first viewport shows the
   disconnected warning and empty-looking card areas, so it does not establish
   the below-fold widget presentation.

The guide is visible on the photographed Drives and Energy summaries, and
their cards reflow to one column on the phone. The 390px Drive title wraps to
two lines beside its actions; it remains visible but leaves limited first-view
content. Screenshots cover only the initial viewport, dark mode and default
scale; they do not establish light-mode, chart, Helix, below-fold or
assistive-technology visual quality.

## Verification

After the final CSS changes:

```text
npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx -t 'v4'
Test Files  2 passed (2)
Tests       6 passed | 159 skipped (165)

npx vitest run src\components\ui\AppDesignBridge.test.tsx
Test Files  1 passed (1)
Tests       13 passed (13)

git diff --check -- web\src\components\ui\app-designs\packs\concierge.css
exit 0
```

`npx tsc --noEmit` exited 0 with no diagnostics. The scoped engineering audit
exited 0 and printed zero for its six pattern categories and a TypeScript
pass; those categories scan TS/TSX, so the zero counts are not a substantive
CSS audit. The existing screenshot-free all-pack phone contract passed one
test at 360/390/430px in normal and forced colors; its simplified fixture
does not model the real bottom-tab overlap.

The screenshot-free `dom-review` check in `shots\v4` reports **2 passed,
1 failed**: clipped labels and the desktop header passed; overlapping and
off-viewport phone hit areas failed. See `dom-review-final.log`. A separate
synthetic role check passed surface, ownership, preserved geometry, reduced
motion, RTL and phone-floor assertions. Its first attempt failed because it
read an in-progress CSS transition; the reduced-motion fixture rerun passed.

No page files or API hooks were changed, so page line/section comparisons and
hook-route checks do not apply. Builds and full production-route, light-mode
and forced-colors captures were not run. Shared follow-up details are in
`requests\v4.md`.

## Screenshot-free hierarchy retry

The retry adds a ruled summary heading, a padded raised metric shelf with a
quiet logical-side guide, and a more structured desktop rail, contextual
panel, heading and group separation. These use the existing surface and
density tokens and exclude widget-pack descendants. The desktop rail needed
greater selector specificity to override the shared desktop shell. No third
screenshot was taken; the existing captures predate these changes.

The phone-bar overlap in finding 1 above describes the earlier shared
foundation. After the shared reservation correction, the following bounded
checks did not reproduce it on Drives or Energy. This does not resolve the
other findings or establish a visual, contrast or accessibility pass.

### Browser measurements

The commands were run from `web` as `node -`, with the Playwright probes and
TypeScript fixture loader supplied on stdin; the scripts were not retained as
standalone tests. They used Edge, reduced motion and isolated synthetic API
responses, and took no screenshots.

The final real-route phone probe checked both routes at 360/390/430×844,
normal and forced colors, and scales 1 and 1.35. It used a saved custom
Georgia font and custom accent, with comfortable/compact density
respectively. It checked the visible navigation targets and labels, status
bar adjacency, horizontal overflow, summary guide/metric bounds and retained
inline preferences:

```text
PHONE_ROUTE_READY route=/drives scale=1 density=comfortable unmatched=0 pending=0
PHONE_ROUTE_READY route=/energy scale=1 density=comfortable unmatched=0 pending=0
PHONE_ROUTE_READY route=/drives scale=1.35 density=compact unmatched=0 pending=0
PHONE_ROUTE_READY route=/energy scale=1.35 density=compact unmatched=0 pending=0
PHONE_CASES=24 routes=drives,energy widths=360,390,430 scales=1,1.35 forced-colors=none,active
PHONE_FAILURES=0
PHONE_EXIT=0
```

In forced colors the browser computed `--theme-accent` as `Highlight` while
the saved inline value remained `#7255aa`; that system override is expected.
These browser fixtures have a zero actual safe-area inset.

A separate real-route desktop probe opened the contextual rail panel with
compact density, scale 1.35 and the same custom font/color:

```text
REAL_DESKTOP_DARK={"panelToken":"rgb(17, 21, 28)","raisedToken":"rgb(23, 28, 37)","rail":"rgb(23, 28, 37)","panel":"rgb(17, 21, 28)","heading":"rgb(23, 28, 37)","summary":"rgb(23, 28, 37)","guide":"2px","density":"compact","scale":"1.35","color":"#7255aa"} unmatched=0 pending=0
REAL_DESKTOP_LIGHT={"panelToken":"rgb(250, 251, 252)","raisedToken":"rgb(241, 245, 249)","rail":"rgb(241, 245, 249)","panel":"rgb(250, 251, 252)","heading":"rgb(241, 245, 249)","summary":"rgb(241, 245, 249)","guide":"2px","density":"compact","scale":"1.35","color":"#7255aa"} unmatched=0 pending=0
DESKTOP_FAILURES=0
DESKTOP_EXIT=0
```

An additional dark desktop Drives comparison held the font, density and
accent constant. It measured Classic's transparent summary, zero summary
padding/guide and unruled heading against v4's raised summary, 16px inline
padding, 2px guide and 1px heading rule:

```text
COMPARE_SAVED_PREFERENCES_IDENTICAL=true
COMPARE_STRUCTURAL_SURFACES_DIFFER=true
COMPARE_EXIT=0
```

An isolated real-styles fixture additionally exercised scale 0.85, two
density gaps and a **simulated** 24px safe inset. Its protected, widget and
nested-preview summary-list paint was compared to neutral controls, rather
than assuming forced colors remain transparent:

```text
SYNTHETIC_DESKTOP={"rail":"rgb(232, 232, 232)","panel":"rgb(245, 245, 245)","heading":"rgb(232, 232, 232)","shelf":"rgb(232, 232, 232)","separator":"1px"}
SYNTHETIC_CASES=72 widths=360,390,430 scales=0.85,1,1.35 density-gaps=8,16 safe-insets=0,24 forced-colors=none,active
SYNTHETIC_FAILURES=0
SYNTHETIC_EXIT=0
```

The initial synthetic attempt failed with `GEOMETRY_FAILURES=85` and a
transparent desktop rail. Its font rule overrode the shared mobile rule and
its forced-colors assertion assumed transparent backgrounds; the transparent
rail also revealed the genuine specificity problem corrected above.
An initial real-route run reported 13 failures: 12 compared computed accent
values across the intentional forced-colors override, and one sampled the
summary immediately after a media transition. A later combined run reported
one desktop failure because its reference probe reused a transitioning element
for both surface colors. The separate final probes above use saved inline
preferences and independent surface references; these earlier failures are
not counted as passes.

### Focused checks after the retry

```text
Set-Location web
npx vitest run src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx -t 'v4' --maxWorkers=2
Test Files  2 passed (2)
Tests       6 passed | 159 skipped (165)
V4_PRESERVATION_EXIT=0

npx vitest run src\components\ui\app-designs\designs.test.ts --maxWorkers=2
Test Files  1 passed (1)
Tests       30 passed (30)
BRIDGE_EXIT=0

npx vitest run src\components\ui\AppDesignBridge.test.tsx --maxWorkers=2
Test Files  1 passed (1)
Tests       13 passed (13)
APP_DESIGN_BRIDGE_EXIT=0

npx tsc --noEmit
TSC_EXIT=0
```

The `BRIDGE_EXIT` shell label above belongs to `designs.test.ts`; the
separately listed `AppDesignBridge.test.tsx` is the bridge test.

The scoped audit script also exited 0, reporting zero in each of its six
pattern categories and a TypeScript pass. Those categories target TS/TSX
patterns and are not a substantive CSS audit. `audit_code` likewise returned
`No violations found` for `concierge.css`, with the same scope limitation.
The tests cover native composition and protected-scope ownership, not a
rendered accessibility review of the protected Digital Twin. No page or API
hook was changed; page line/section comparisons and hook-route checks remain
inapplicable. The failed capture and incomplete Axe evidence above remain
unresolved.

```text
git diff --check -- web\src\components\ui\app-designs\packs\concierge.css docs\design-packs\REVIEW-v4.md docs\design-packs\requests\v4.md
DIFF_CHECK_EXIT=0
```

The review and request are untracked, so they were also checked separately:

```text
web\src\components\ui\app-designs\packs\concierge.css trailing_whitespace_lines=0
docs\design-packs\REVIEW-v4.md trailing_whitespace_lines=0
docs\design-packs\requests\v4.md trailing_whitespace_lines=0
```

The orchestrator subsequently ran `npm run build` in the isolated verification
worktree with the final Concierge stylesheet: **exit 0**. Its SHA-256 matched
the working stylesheet. The prior capture and contrast limitations remain.

## Screenshot-free layout-name follow-up

The captured 390px Dashboard truncated the selected layout name. The v4
phone-only rule now lets the selected name wrap, including long unbroken
names, while keeping the adjacent Layout caption on one line. The selector
targets the owner-qualified context-action control and excludes protected
and widget-pack subtrees. It does not change font, density or color tokens.
No screenshots were taken; the existing captures predate this change.

### Real dashboard measurements

The following probe ran from `web` as an inline `node -` Playwright script
against the existing Vite server and isolated dashboard mock. It compared
against the original truncation through a temporary test-only style, then
removed that style and waited 150ms for CSS transitions to settle. It tested
the fixture name and an injected 92-character unbroken name. Each case
checked rendered text bounds and scroll dimensions, single-line caption,
button width and minimum target height, document overflow, adjacent action
dimensions, and the protected Digital Twin container and button/SVG
dimensions and font sizes. Height increases in the layout button are
intentional; other measured target dimensions did not change.

```text
CASE scale=1 colors=none width=360 text=words button=256.25x44.00->256.25x81.17 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=none width=360 text=unbroken button=256.25x44.00->256.25x125.95 nameLines=5 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=none width=390 text=words button=256.25x44.00->256.25x81.17 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=none width=390 text=unbroken button=256.25x44.00->256.25x125.95 nameLines=5 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=none width=430 text=words button=256.25x44.00->256.25x81.17 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=none width=430 text=unbroken button=256.25x44.00->256.25x125.95 nameLines=5 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=active width=360 text=words button=256.25x44.00->256.25x81.17 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=active width=360 text=unbroken button=256.25x44.00->256.25x125.95 nameLines=5 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=active width=390 text=words button=256.25x44.00->256.25x81.17 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=active width=390 text=unbroken button=256.25x44.00->256.25x125.95 nameLines=5 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=active width=430 text=words button=256.25x44.00->256.25x81.17 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1 colors=active width=430 text=unbroken button=256.25x44.00->256.25x125.95 nameLines=5 captionLines=1 scroll=160/160 protected=12
MENU scale=1 expanded=true visible=true afterEscape=false
DESKTOP scale=1 {"whiteSpace":"nowrap","textOverflow":"ellipsis"}
FIXTURE scale=1 unmatched=[] pending=0
CASE scale=1.35 colors=none width=360 text=words button=270.34x44.22->270.34x104.66 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=none width=360 text=unbroken button=270.34x44.22->270.34x225.53 nameLines=7 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=none width=390 text=words button=270.34x44.22->270.34x104.66 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=none width=390 text=unbroken button=270.34x44.22->270.34x225.53 nameLines=7 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=none width=430 text=words button=270.34x44.22->270.34x104.66 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=none width=430 text=unbroken button=270.34x44.22->270.34x225.53 nameLines=7 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=active width=360 text=words button=270.34x44.22->270.34x104.66 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=active width=360 text=unbroken button=270.34x44.22->270.34x225.53 nameLines=7 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=active width=390 text=words button=270.34x44.22->270.34x104.66 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=active width=390 text=unbroken button=270.34x44.22->270.34x225.53 nameLines=7 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=active width=430 text=words button=270.34x44.22->270.34x104.66 nameLines=3 captionLines=1 scroll=160/160 protected=12
CASE scale=1.35 colors=active width=430 text=unbroken button=270.34x44.22->270.34x225.53 nameLines=7 captionLines=1 scroll=160/160 protected=12
MENU scale=1.35 expanded=true visible=true afterEscape=false
DESKTOP scale=1.35 {"whiteSpace":"nowrap","textOverflow":"ellipsis"}
FIXTURE scale=1.35 unmatched=[] pending=0
CLASSIC_390={"whiteSpace":"nowrap","textOverflow":"ellipsis"} unmatched=[] pending=0
REAL_CSS_CASES=24 widths=360,390,430 scales=1,1.35 forced-colors=none,active names=words,unbroken
REAL_CSS_FAILURES=0
REAL_CSS_EXIT=0
```

The first 24-case probe failed, because it sampled `flex-shrink` immediately
after removing the temporary baseline style:

```text
REAL_CSS_CASES=24 widths=360,390,430 scales=1,1.35 forced-colors=none,active names=words,unbroken
REAL_CSS_FAILURES=9
REAL_CSS_EXIT=1
STALE_CAPTION={"immediate":{"shrink":"1","white":"nowrap","transition":"all","duration":"1e-05s","animations":["flex-shrink"]},"later":{"shrink":"0","white":"nowrap","transition":"all","duration":"1e-05s","animations":[]}}
CAPTION_SETTLING_EXIT=0
```

The final probe waited before evaluating the real styles. Its fixture has a
zero actual safe-area inset. These measurements do not constitute a visual,
contrast or accessibility pass.

### Follow-up tests and audit

```text
Set-Location web
npx vitest run src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\DataTable.appDesign.test.tsx -t 'v4|keeps public/widget-only/incomplete previews neutral' --maxWorkers=2
Test Files  3 passed (3)
Tests       8 passed | 192 skipped (200)
V4_NATIVE_DATATABLE_EXIT=0

npx vitest run src\components\ui\AppDesignBridge.test.tsx --maxWorkers=2
FAIL  src/components/ui/AppDesignBridge.test.tsx > nearest design boundary isolation > keeps actual Quiet boundary variables stable under contrasting active outer identities
AssertionError: expected '' to be '0px' // Object.is equality
 ❯ src/components/ui/AppDesignBridge.test.tsx:125:91
Test Files  1 failed (1)
Tests       1 failed | 12 passed (13)
BRIDGE_EXIT=1

npx vitest run src\components\ui\AppDesignBridge.test.tsx -t 'keeps actual Quiet boundary variables stable' --maxWorkers=2
Test Files  1 passed (1)
Tests       1 passed | 12 skipped (13)
BRIDGE_VARIABLE_RECHECK_EXIT=0

npx vitest run src\components\ui\AppDesignBridge.test.tsx --maxWorkers=2
Test Files  1 passed (1)
Tests       13 passed (13)
BRIDGE_RECHECK_EXIT=0

npx tsc --noEmit
TSC_EXIT=0
```

The first additional bridge run failed in the shared Quiet/Bauhaus variable
test despite its earlier pass above; both isolated and full rechecks then
passed. The cause of the intermittent failure is not established. That test
extracts only custom-property declarations, and this follow-up's wrapping
selectors add none; the shared test and other pack styles were left untouched.
An independent JSDOM switch diagnostic yielded Bauhaus
`--app-card-radius: 0px` both with and without the v4 stylesheet; it is not
a substitute for the bridge test.

The scoped `audit-violations` script again exited 0 with six zero pattern
counts and a TypeScript pass (`npx tsc --noEmit`). Its pattern categories
primarily target TS/TSX, not CSS. `audit_code` returned `No violations found`
for `concierge.css`; direct `rg` checks of that stylesheet and the unchanged
layout switcher returned the following:

```text
inline_styles: 0 matches (rg exit 1)
raw_html: 0 matches (rg exit 1)
direct_imports: 0 matches (rg exit 1)
old_api_imports: 0 matches (rg exit 1)
double_api_prefix: 0 matches (rg exit 1)
camel_query_params: 0 matches (rg exit 1)
```

No page or API hook was modified; page line/section comparisons and
hook-route checks remain inapplicable. The previous visual and accessibility
limitations remain unresolved.

```text
git diff --check -- web\src\components\ui\app-designs\packs\concierge.css docs\design-packs\REVIEW-v4.md
DIFF_CHECK_EXIT=0
web\src\components\ui\app-designs\packs\concierge.css trailing_whitespace_lines=0
docs\design-packs\REVIEW-v4.md trailing_whitespace_lines=0
```

## Phone metric follow-up

Recent drives context measured 11.9px at scale 0.85 and 14px at scale 1.
The owned ordinary headline context and units now use the phone body token;
protected and specialized surfaces remain excluded. See `DECISIONS.md` for
the screenshot-free regression results and remaining limitations.
