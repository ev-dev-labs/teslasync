# Warm Modern (`warm`) review

## Status

Implementation is in `web\src\components\ui\app-designs\packs\warm.css`.
The pack uses saved theme surfaces, accent and typography with a rounded
masthead, softer panels and metrics, density-aware spacing, navigation,
controls, charts, grid and Helix treatments. Digital Twin compositions and
widget-owned presentation remain protected.

This is **not a visual or accessibility pass**. Round one failed five of
six captures. The coordinator requested a stop during round two; its first
viewport image was written, but no test completed. Both permitted invocations
are spent. There was no build, per the worker assignment.

## Inspected evidence

All six first-round viewport images were opened:

- `shots\warm\round-1\phone-390-scale-1\dashboard.png`
- `shots\warm\round-1\phone-390-scale-1\drives.png`
- `shots\warm\round-1\phone-390-scale-1\energy.png`
- `shots\warm\round-1\desktop-scale-1\dashboard.png`
- `shots\warm\round-1\desktop-scale-1\drives.png`
- `shots\warm\round-1\desktop-scale-1\energy.png`

The second-round initial dashboard phone viewport was also opened at
`shots\warm\phone-390-scale-1\dashboard.png`: its masthead is visibly shorter
than in round one, but still occupies three rows. The other five current
viewport files are first-round images, not final-round evidence. No completed
second-round diagnostics or other final images are available.

## Findings and owned changes

1. The phone masthead consumed too much vertical space on the dashboard and
   drives; the energy title wrapped early. Reduced phone header padding and
   action gaps and adjusted title flex-basis. Only the dashboard's initial
   viewport was re-inspected; energy and drives remain unverified.
2. The phone text diagnostic reported 11px on all five navigation buttons,
   even though their child labels were already larger. Applied the existing
   scalable body-size floor to the buttons themselves. No final diagnostic
   completed.
3. Dashboard “All drives” and “Open vehicle” links were 12px; a headline
   context was 14px and its unit 12px. Added the phone body-size floor and
   wrapping to app-owned widget footer links and headline context/unit text,
   excluding protected and native-gauge subtrees. Final diagnostics are absent.
4. Drives and energy phone metric tiles touched vertically and appeared more
   angular than the surrounding panels. Added density-aware row spacing and
   rounded brief tiles outside embedded and widget surfaces. The final phone
   images were not captured.
5. Desktop ordinary panels and their data tiles looked too uniformly dark
   for the intended layered hierarchy. Mixed existing theme surfaces for the
   neutral panel role and used a raised surface for ordinary brief tiles,
   without replacing semantic or series colors. Final light/dark contrast and
   desktop appearance were not recaptured.

## Capture results

Both invocations used the same six-page/viewport wrapper:

```powershell
$env:DESIGN_PACK_CAPTURE_OUTPUT_ROOT = 'D:\repos\teslasync\docs\design-packs\shots\warm'
node 'C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs' warm
```

Round one exited **1** (`shots\warm\round-1.log`):

- Phone dashboard: failed 44px touch targets and 16px text checks.
- Phone drives: failed the text check; Axe had zero violations and one
  incomplete node requiring manual contrast review.
- Phone energy: failed the text check; Axe had zero violations and zero
  incomplete nodes.
- Desktop dashboard and energy: failed while `GET /api/v1/pinned` was
  pending in the mock-API completion check; their contrast checks did not run.
- Desktop drives: runner passed, but Axe had three incomplete nodes requiring
  manual contrast review. This is not a contrast pass.
- Phone dashboard Axe reported zero violations and zero incomplete nodes.

Round two was **stopped** on the coordinator's request; it had no numeric
wrapper exit status or completed test summary (`shots\warm\round-2.log`).
The interrupted runner left its task-owned
`shots\warm\teslasync-design-pack-capture-40dcf851-bbb6-45e3-8b2e-f92cb9333d2e`
artifact directory; it was absent when the orchestrator later inspected it.

## Shared issues and verification limits

The dashboard diagnostic found the protected Digital Twin's **Open 36×36px**
and **Refresh 10×28px** controls below 44px, plus three 14px text findings
whose exact ownership needs confirmation. These and the intermittent pending
mock request are recorded in `requests\warm.md`. Protected widget geometry was
not changed. Axe incomplete nodes still require manual contrast review.

Before the final CSS refinement, focused preservation tests reported:

```text
Test Files  3 passed (3)
     Tests  9 passed | 183 skipped (192)
```

The prior audit, including `npx tsc --noEmit`, exited 0; its TSX-only
violation categories do not meaningfully cover this CSS. After the phone and
panel refinement, but before the chart-viewport follow-up below, a PostCSS
parse/scope/token/color check exited 0:

```text
64 rules; 23 app roles; 0 scope/token/color problems
```

The focused tests and TypeScript were not rerun after the refinement because
of the stop request. No page or hook changed, so page section/line-count and
hook-route comparisons are not applicable. Light mode, forced colors, reduced
motion, other phone widths, opened overlays and the remaining routes lack
final visual evidence.

## Nested-preview follow-up

The shared preservation test clones a chart viewport directly into a complete
Quiet-to-Warm preview, without its original `data-chart-variant` figure.
`ChartContainer` normally supplies that figure, but the shared chart role
styles an owned viewport directly and the nearest-preview contract expects
the cloned target to receive Warm presentation. Warm now supplies its
owner-qualified viewport background without requiring the figure; panel
rounding and the embedded transparent override remain variant-specific.
No chart geometry or series paint was changed. This follow-up was not
visually recaptured.

An initial overly specific Vitest name selector exited 0 but selected no tests:

```text
Test Files  1 skipped (1)
     Tests  111 skipped (111)
```

The corrected focused command was:

```powershell
cd web
npx vitest run 'src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx' -t quiet
```

It exited 0, including the Quiet-to-Warm nested-preview assertion:

```text
Test Files  1 passed (1)
     Tests  4 passed | 107 skipped (111)
```

The worker did not rerun the full Warm preservation selection or TypeScript
after this follow-up; the existing two capture invocations remain the limit.

The orchestrator subsequently built a snapshot containing the final Terminal,
Editorial, Quiet, Swiss and Warm stylesheets with `npm run build` (exit 0);
Warm's SHA-256 matched the working stylesheet. A combined native
composition, ordered-step and DataTable selection reported 3 files passed,
35 tests passed and 165 skipped. These checks do not resolve the interrupted
final capture or visual and contrast findings above.
