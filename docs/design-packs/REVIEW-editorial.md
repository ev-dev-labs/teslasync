# Editorial review

## First round

Command: `node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs editorial`

The run was interrupted, without a normal exit code, after the runner selected
an operating-system temporary directory for Playwright artifacts. Three
390px images were saved and inspected; no desktop images were captured.
Copies are in `shots\editorial\round-1`.

- Dashboard: test failed; Axe reported 0 violations and 0 incomplete nodes.
- Drives: test failed; Axe reported 0 violations and 1 incomplete node because
  the background of an overlapping text element could not be determined.
- Energy: image saved, but the test did not finish; Axe had reported 0
  violations and 0 incomplete nodes.

The interrupted run did not print the complete assertion details, so the two
failed tests are not attributed to a specific cause.

### Observed defects and changes

1. The Drive history and Energy intelligence headlines wrapped unnecessarily.
   The phone masthead now gives the title its own full-width row.
2. The command icons were squeezed beside those headlines. The phone action
   rail now has a separate full-width row while retaining the existing groups.
3. The dashboard layout name was truncated to “Implementation rev…” despite
   unused width. Context-menu names may now wrap within the available width.
4. The equal-width ledger columns made labels such as “Projected 30-day use”
   wrap early. Phone brief rows now give labels a modestly wider column.
5. The original blue vertical title stripe competed with the journal's
   horizontal masthead rule. The decorative stripe is suppressed for Editorial.

## Final capture

The same wrapper was invoked a second time with its scratch directory under
`shots\editorial`. Exit status: **1**.

```text
  3 failed
    [phone-390] capture dashboard (/)
    [phone-390] capture drives (/drives)
    [phone-390] capture energy (/energy)
  3 passed (2.6m)
```

All six images in `phone-390-scale-1` and `desktop-scale-1` were inspected:
`dashboard.png`, `drives.png` and `energy.png` in each directory. The first
round produced only the three phone images in `round-1`.

All three phone tests flagged the five bottom-navigation button elements at
11px; the visible label spans were 16px. Dashboard also flagged a protected
36×36 Open target and 10×28 refresh target, 14px protected-widget text, and
small app-owned dashboard text and links. Details and shared requests are in
`requests\editorial.md`.

Axe reported zero violations in all six captures. Incomplete findings were:
phone Drives 1, desktop Drives 4, desktop Energy 19; the other three had zero.
Those incomplete nodes are not contrast passes.

The final images show the two headlines and brief labels no longer wrapping
prematurely, and the decorative stripe removed. They also exposed a split
“Layout” label and desktop metric rows spanning too wide. After the capture,
the label was prevented from shrinking and desktop metric banks were grouped
into columns. A no-screenshot Edge check passed 108 combinations of 360/390/
430px, 0.85/1/1.35 font scales, three densities and forced colors; a synthetic
desktop check verified multi-bank columns and preserved explicit single-column
briefs. The screenshots predate these two changes. A subsequent desktop layout
name-width adjustment was not browser-verified, and no third capture was run.

## Nonvisual checks

After the post-capture label and metric-bank fixes, the focused
component-preservation run reported:

```text
Test Files  3 passed (3)
     Tests  14 passed | 186 skipped (200)
```

Command:
`cd web; npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx src\components\ui\DataTable.appDesign.test.tsx -t 'editorial|blueprint|keeps protected widget trees'`

Before the final desktop name-width adjustment, the scoped
`audit-violations` script reported:

```text
Static inline styles: 0 violations
Raw HTML elements: 0 violations
Direct library imports: 0 violations
Old API imports: 0 violations
Double /api/v1/ prefix: 0 violations
camelCase query params: 0 violations
TypeScript passes
```

The audit target was the Editorial CSS file, not the whole frontend.
`git diff --check` reported `Editorial diff whitespace: clean` before that
last adjustment. No build was run; no page components or API hooks changed.

The orchestrator subsequently built a snapshot containing the final Terminal,
Editorial, Quiet, Swiss and Warm stylesheets with `npm run build` (exit 0);
Editorial's SHA-256 matched the working stylesheet. A combined native
composition, ordered-step and DataTable selection reported 3 files passed,
35 tests passed and 165 skipped. These checks do not resolve the visual or
contrast findings above.

## Phone metric follow-up

Recent drives context measured 11.9px at scale 0.85 and 14px at scale 1.
The owned ordinary headline context and units now use the phone body token;
protected and specialized surfaces remain excluded. See `DECISIONS.md` for
the screenshot-free regression results and remaining limitations.
