# Blueprint review

Blueprint uses a theme-derived drafting surface, fine datum and ruler marks,
measured spacing, framed records and chart surfaces, and restrained
annotation-like typography. Existing semantic colors, chart series, saved
font and density preferences, and protected Digital Twin interiors remain
with their original owners.

## Visual review

### First round — interrupted

`node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs blueprint`
was interrupted by the worker after discovering that the shared runner creates
an operating-system temporary output directory outside the permitted project
scope. No process exit status was returned. It counts as the first round.
Only `round-1\phone-390-scale-1\dashboard.png` was saved and inspected; the
other five views were not produced. The phone dashboard Axe output reported
`Contrast: 0 violated rules, 12 nodes require manual review`. These incomplete
nodes are not passes; no other diagnostic result was obtained.

The five most important findings from the available image and diagnostics:

1. The selected dashboard layout name is visibly truncated. The phone rule now
   allows the existing label to wrap within the available width.
2. The title, layout selector and command rows consume too much vertical
   space. Phone header/action gaps and padding have been modestly tightened
   without reducing touch targets.
3. The drafting ruler was too faint to convey the intended identity. Its
   neutral ticks are taller and use the theme's secondary text color.
4. The dismissed onboarding widget occupies most of the initial content
   viewport. Its grid footprint is shared and remains an open request.
5. Twelve contrast nodes could not be assessed automatically, mostly because
   of widget gradients. Their actual contrast remains unverified.

### Final round — exit 1

```powershell
$env:DESIGN_PACK_CAPTURE_OUTPUT_ROOT='D:\repos\teslasync\docs\design-packs\shots\blueprint'
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs blueprint
```

The wrapper supplied Edge, font scale 1, and contrast diagnostics. It exited
**1**: **1 failed, 5 passed (2.9m)**. All six final images were saved and
inspected: dashboard, drives and energy in `phone-390-scale-1` and
`desktop-scale-1`. The first-round phone dashboard remains separately saved.
`round-1.log` and `round-2.log` retain the available terminal output.

The phone dashboard failed both accessibility diagnostics: an **Open** link
measured 36 × 36px, a **Refresh data** button 10 × 28px, and three Digital
Twin text nodes 14px. The protected widget must not be modified by this pack.
The phone drives and energy and all three desktop tests passed their automated
capture assertions. A saved image or a passing capture assertion is not a
contrast or full accessibility pass.

Actual Axe output, in capture order:

```text
phone dashboard:   Contrast: 0 violated rules, 12 nodes require manual review
phone drives:      Contrast: 0 violated rules, 1 nodes require manual review
phone energy:      Contrast: 0 violated rules, 0 nodes require manual review
desktop dashboard: Contrast: 0 violated rules, 20 nodes require manual review
desktop drives:    Contrast: 0 violated rules, 4 nodes require manual review
desktop energy:    Contrast: 0 violated rules, 19 nodes require manual review
```

The incomplete nodes remain unverified, not passed. The mobile layout name is
now fully visible and the datum ticks are legible, but the dismissed onboarding
widget still dominates the initial phone viewport. The desktop layout name
still truncates; wide Drives and Energy briefs place individual metrics in
large full-width rows, leaving a sparse first viewport. The phone Drives title
also wraps to two lines. No additional capture was made after these findings.

## Source and test checks

- `cd web; npx tsc --noEmit`: exit 0; no output.
- `cd web; npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx --testNamePattern='(blueprint|motorsport).*native' --reporter=dot`:
  exit 0; **2 files passed, 12 tests passed, 153 skipped**. This checks native
  metrics, plots, steps and nearest-preview isolation, not rendered-route
  accessibility.
- `cd web; npx vitest run src\components\ui\app-designs\designs.test.ts --reporter=dot`:
  exit 0; **1 file passed, 30 tests passed**.
- `cd web; npx vitest run src\components\ui\AppDesignBridge.test.tsx --reporter=dot`:
  exit 0; **1 file passed, 13 tests passed**.
- PostCSS source audit: **69 owner-qualified selectors**, **0 unowned
  selectors**, **23 defined app roles**, **0 roles absent from the preview
  reset**.
- A JSDOM selector check found the intended standard-mode rules on nine shell,
  page and conversation targets, with no matching Blueprint rules on those
  targets in report or kiosk mode. This is not a visual mode review.
- Scoped stylesheet audit: **0** static inline styles, raw HTML controls,
  direct chart/map imports, old API imports, double API prefixes, camelCase
  query parameters, and hardcoded hex colors. These are source-pattern counts,
  not browser accessibility results.

No page source, sections or API hooks were changed; page line-count/section
comparisons and hook-route verification are not applicable. A build was not
run, as required by the worker brief. Light mode, forced colors, reduced
motion, other phone widths and open interactive states have not yet been
visually verified.

## Shared foundation

The shared workbench rules now split only sections with a visible direct
header, so headerless briefs no longer need a Blueprint-specific override.

## Screenshot-free follow-up

A Blueprint-only desktop rule now permits the dashboard's active layout name
to wrap rather than truncating it at 10rem. Prior screenshots and their
diagnostic results are unchanged; this follow-up has not been recaptured.
The sparse wide brief banks originate in the shared ledger grid rule and are
recorded as a shared request instead of being restructured by the pack.

The focused, screenshot-free Edge probe passed 32 synthetic layout cases:
390, 768, 1024 and 1440px; text scales 1 and 1.35; forced colors on and off;
and both ordinary and long unbroken layout names. The target did not clip
or overflow its button, and a different owner retained its original
truncation. This is a fixture check, not a new screenshot review.

The scoped stylesheet audit reported 0 inline static styles, 0 raw form/table
elements, 0 prohibited imports, 0 double API prefixes, and 70/70
owner-qualified selectors. A fresh `cd web; npx tsc --noEmit` was stopped
after more than 130 seconds without output to honor the follow-up time
limit; the earlier successful run above predates this CSS-only follow-up.

The orchestrator then ran `npm run build` in the isolated verification
worktree with the final Blueprint stylesheet: **exit 0**. Its SHA-256 matched
the working stylesheet. This does not resolve the capture or accessibility
limitations above.
