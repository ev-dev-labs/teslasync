# Neo Brutal review

The pack uses theme-derived ink, square structural frames, solid offset
edges, ruled grids and a strong selected navigation state. It leaves native
charts, embedded tables, widget internals and protected Digital Twins intact.

## First-round findings and changes

Inspected all six initial viewport images: dashboard, drives and energy at
390 px and desktop (`shots\brutal\round-1\`). The five most important findings
were:

1. **Mobile heading space:** the drives header placed its action group on a
   full-width second row even without a context selector. Context-free actions
   can now share the title row when they fit, while retaining wrapping. The
   second screenshot still showed the old wrap; a subsequent phone-only
   spacing adjustment was checked without another screenshot (details below).
2. **Truncated layout name:** the saved dashboard layout name was ellipsized
   on both viewports. Context-menu labels can now wrap within a bounded width.
3. **Redundant rules:** energy showed an extra divider immediately between the
   outlined heading and first outlined section. The extra generic section rule
   was removed.
4. **Over-boxed navigation and dashboard widgets:** inactive desktop links
   had complete boxes inside already outlined navigation groups, and the
   dashboard widget edges looked stacked. Inactive links now use a single
   divider, while selected links keep their frame; widget shell offset edges
   were reduced from 4 px to 2 px.
5. **Phone navigation typography and shape:** the navigation button computed
   at 11 px even though its label was larger, and the selected tab retained a
   rounded outline. Its button inherits the shared phone body-size token and
   the selected frame is square without changing the shared tab geometry.

The first capture exited 1: phone checks reported the 11 px navigation button
and dashboard protected/widget touch and text issues; desktop checks stopped
on pending `/api/v1/pinned` fixture requests. Phone Axe reported zero contrast
violations, with one manually indeterminate overlapping text node on drives.
Desktop contrast did not run. See `shots\brutal\round-1.log` for details.

## Final capture

The same six images were inspected again in
`shots\brutal\phone-390-scale-1\` and
`shots\brutal\desktop-scale-1\`. No images were missing. The layout label now
wraps, the energy double divider is gone, inactive navigation is less boxed,
and the selected phone tab has a square frame. The 390 px drives heading
still uses two rows in that screenshot.

Both invocations were
`node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs brutal`
with `DESIGN_PACK_CAPTURE_OUTPUT_ROOT` set to the existing Brutal shots
directory. Both exited 1. The final output was `2 failed, 4 passed (4.1m)`:
drives and energy passed the capture checks at both widths; dashboard still
failed phone touch/text checks and desktop mock-routing completion on
`GET /api/v1/pinned`. The desktop dashboard contrast check was not reached.

In the final Axe runs that executed, zero violations were reported, but
manual review remains necessary for one phone drives node, four desktop
drives nodes and 21 desktop energy chart/legend nodes. The six viewport images
do not establish contrast for those off-screen nodes. Full diagnostics are in
`shots\brutal\round-2.log`; a passing capture check is not a production or
all-theme accessibility certification.

After those two rounds, a final pack-only header adjustment reduced the
390 px drives header from 132 px to 94.375 px by letting the heading wrap
beside its actions. A screenshot-free browser check against the same mocked
route measured 44 × 44 px controls, unclipped heading text and no document
horizontal overflow at 360, 390 and 430 px, with font scales 1 and 1.35.
At 360 px and at the larger scale the action group wraps as needed. Its
output is in `shots\brutal\geometry-check.log`. This last change is **not**
shown in the screenshots and needs a later visual review; no third capture
was taken.

## Other verification

- `npx tsc --noEmit`: exit 0, no output.
- Violations audit of `brutal.css`: 0 findings in each of the six categories;
  TypeScript passed; exit 0. These source-pattern checks do not certify CSS
  design or accessibility.
- The final native composition/metric/steps command was
  `npx vitest run src\components\ui\app-designs\packs\PackCMetricPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx --reporter=dot --maxWorkers=1 -t brutal`.
  It exited 0:

  ```text
   Test Files  3 passed (3)
        Tests  9 passed | 183 skipped (192)
     Start at  13:01:54
     Duration  37.85s (transform 9.87s, setup 1.62s, import 30.22s, tests 4.14s, environment 0ms)
  ```
- Required standalone-frame contract:
  `npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='brutal binds only the painted frame' --reporter=dot --maxWorkers=1`
  exited 0 with this output:

  ```text
   RUN  v4.1.12 D:/repos/teslasync/web

  ------------------------·----------

   Test Files  1 passed (1)
        Tests  1 passed | 34 skipped (35)
     Start at  13:01:15
     Duration  19.53s (transform 6.37s, setup 732ms, import 9.75s, tests 465ms, environment 7.73s)
  ```
- Screenshot-free geometry command:
  `node .\web\node_modules\@playwright\test\cli.js test --config .\docs\design-packs\shots\brutal\geometry-check.config.ts --workers=1`
  exited 0 with `1 passed (24.8s)`. The one-off config and test were removed
  after recording their browser measurements; no screenshot was taken.
- A broader five-file run reported `Test Files 1 failed | 4 passed (5);
  Tests 1 failed | 215 passed (216)`: the `quiet` to `warm` preview-plot
  contract failed, outside the owned pack.
- No build was run, per the shared worker brief. This CSS-only change does not
  change pages, section counts, hooks, routes or API contracts.

Shared issues requiring owner action are recorded in `requests\brutal.md`.

## Changed paths

- `web\src\components\ui\app-designs\packs\brutal.css`
- `docs\design-packs\REVIEW-brutal.md`
- `docs\design-packs\requests\brutal.md`
- `docs\design-packs\shots\brutal\round-1.log`
- `docs\design-packs\shots\brutal\round-2.log`
- `docs\design-packs\shots\brutal\geometry-check.log`
- `docs\design-packs\shots\brutal\round-1\phone-390-scale-1\dashboard.png`
- `docs\design-packs\shots\brutal\round-1\phone-390-scale-1\drives.png`
- `docs\design-packs\shots\brutal\round-1\phone-390-scale-1\energy.png`
- `docs\design-packs\shots\brutal\round-1\desktop-scale-1\dashboard.png`
- `docs\design-packs\shots\brutal\round-1\desktop-scale-1\drives.png`
- `docs\design-packs\shots\brutal\round-1\desktop-scale-1\energy.png`
- `docs\design-packs\shots\brutal\phone-390-scale-1\dashboard.png`
- `docs\design-packs\shots\brutal\phone-390-scale-1\drives.png`
- `docs\design-packs\shots\brutal\phone-390-scale-1\energy.png`
- `docs\design-packs\shots\brutal\desktop-scale-1\dashboard.png`
- `docs\design-packs\shots\brutal\desktop-scale-1\drives.png`
- `docs\design-packs\shots\brutal\desktop-scale-1\energy.png`

## Phone metric follow-up

Recent drives context measured 11.9px at scale 0.85 and 14px at scale 1.
The owned ordinary headline context and units now use the phone body token;
protected and specialized surfaces remain excluded. See `DECISIONS.md` for
the screenshot-free regression results and remaining limitations.
