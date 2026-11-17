# Analog visual review

## Round 1

Command: `node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs analog`

Exit **1**: 3 desktop captures passed; 3 phone captures failed the mobile
diagnostics. Axe reported 0 violations, but contrast review was incomplete:
phone dashboard/drives/energy had 3/1/0 nodes needing manual review and
desktop dashboard/drives/energy had 4/4/13 respectively. These incomplete
results are not contrast passes.

Inspected all six images in `shots\analog\phone-390-scale-1` and
`shots\analog\desktop-scale-1`: `dashboard.png`, `drives.png`, and
`energy.png` at each viewport.

Most important findings:

1. The dashboard's preserved Digital Twin Open and Refresh controls are below
   the 44px touch target, and some of its text is below 16px. This is protected
   component-owned content; requested a shared fix rather than changing it.
2. The five phone-navigation buttons have an 11px computed font size, even
   though the visible labels are 16px. Fixing the owned button rule while
   requesting a shared correction for the other packs.
3. Dashboard footer links, the headline unit, and contextual text are too small
   on phones. Enlarging unprotected, owner-qualified widget text only.
4. Energy's phone title wraps beside its actions; the dashboard layout name is
   truncated. Giving the title its own row and allowing the real selector text
   to wrap instead of truncating.
5. Narrow phone brief tiles wrap readings and have heavy rectangular edges; the
   first fold doesn't show the instrument-ring signature clearly. Reducing
   inline padding, softening their frames, and applying a ring to the actual
   page-help control.

The corresponding shared ownership requests are in `requests\analog.md`.

## Round 2

The same six-image command, with `DESIGN_PACK_CAPTURE_OUTPUT_ROOT` set to the
Analog shots directory, exited **1**: **5 passed, 1 failed**. All six resulting
images were inspected: `dashboard.png`, `drives.png`, and `energy.png` in
both `phone-390-scale-1` and `desktop-scale-1`.

The remaining phone-dashboard capture failure reported Digital Twin's Open
link at 36×36px, Refresh at 10×28px, three 14px Digital Twin texts, and an
unprotected charge-status `km` unit at 12px. The first three are protected
component issues; the unit was corrected afterward in the Analog stylesheet.
The phone drives and energy captures and all desktop captures passed the
runner's other checks.

Axe reported 0 violated contrast rules in all captures, but manual review was
still required for phone dashboard/drives/energy **3/1/0** and desktop
dashboard/drives/energy **4/4/13** nodes. These are incomplete findings, not
proof that all text and charts pass contrast.

The softer brief frames and single-line `120 Wh/km` reading improved the
energy phone image. Two residual layout defects were visible: the energy title
still wrapped because the shared mobile rule sets `flex-basis`, and the
dashboard's newly untruncated selector split its “Layout” label. Desktop still
truncated the selector. After this final capture, the owned CSS was refined to
give the title a full flex row, keep the selector label intact, unwrap the
actual layout name, and enlarge the charge-status unit. **These last edits
were not visually recaptured** because both permitted rounds were used.

## Screenshot-free follow-up and validation

- Edge DOM probe using the real review fixtures: energy's title is one line at
  390px, the selector label occupies one line, and the charge-status unit is
  16px. Scanning the 390px fixture after scrolling found no undersized text,
  touch targets, horizontal scroll regions, or split navigation/metric words
  on drives or energy. Dashboard retained only the three protected 14px texts
  and the two protected undersized controls listed above.
- Real-fixture Edge DOM checks passed **30 cases**: dashboard and energy,
  widths 360/390/400/401/430px, scales 0.85/1/1.35; no document or detected
  horizontal scrolling, clipped or split bottom labels. Energy's title fit on
  one line at default scale. A separate synthetic check passed **18 cases**
  across widths 360/390/430px, those three scales and forced colors on/off,
  including nested-preview and protected-subtree isolation.
- Desktop DOM checks passed **6 cases** at 768/1024/1440px in light and dark
  themes: layout name untruncated, no document overflow, and measured title
  contrast **16.30:1 light**, **15.90:1 dark**. This does not resolve the Axe
  chart/image-background incompletes.
- Focused Analog Vitest: **3 files passed, 2 skipped; 7 tests passed, 233
  skipped**, exit 0. CSS parser: **59 rules, 0 unowned selectors, 0 unreset
  app tokens**. `git diff --check`: exit 0.
- Scoped violations-audit script: six categories each reported 0 and
  `npx tsc --noEmit` passed; exit 0. Most categories inspect TS/TSX, not CSS,
  so those six zeros are not a full CSS audit.
- Initial DOM-probe attempts included an incorrect border-box assertion, two
  unsuccessful in-memory fixture-bundling attempts due to CSS modules, and an
  unsuccessful optional Jiti import involving `import.meta`. Corrected probes
  passed as described; the DOM recheck did not include that optional fixture
  module and is not another screenshot-runner pass.
- No production build was run. API hooks, page sections, and line counts were
  unchanged/not applicable to this stylesheet-only change.

The runner cleaned its unique output child. The orchestrator removed the
task-owned Playwright transform cache after the worker stopped.

## Standalone DataTable preservation repair

The Analog surface rule now also matches an owner-qualified standalone
`[data-app-table-frame]` panel without depending on the GlassPanel background
class. It changes only theme-token-derived surface paint and radius, leaving
embedded frames and native table scrolling, selection, and layout untouched.

`npx vitest run src\components\ui\DataTable.appDesign.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx src\components\ui\app-designs\feedback-native-followup.test.tsx --testNamePattern 'analog|keeps public/widget-only/incomplete previews neutral|removes only the surface binding'`
exited **0**:

```text
Test Files  4 passed (4)
     Tests  10 passed | 227 skipped (237)
```

The previously failing Analog DataTable test passed. The scoped violation
audit also exited **0** with six categories reporting 0 and TypeScript passing;
the TS/TSX checks are not a full CSS audit. CSS parsing reported
`59 rules; 0 unowned selectors; 0 unreset app tokens`. No screenshot or build
was run for this repair; the prior visual-review limitations still apply.

The orchestrator subsequently ran `npm run build` in the verification
snapshot with the repaired Analog stylesheet: **exit 0**. Its SHA-256 matched
the working stylesheet. The prior capture and contrast limitations remain.
