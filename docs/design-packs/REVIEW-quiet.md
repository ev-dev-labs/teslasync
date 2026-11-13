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
