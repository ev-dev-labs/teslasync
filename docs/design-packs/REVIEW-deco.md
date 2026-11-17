# Deco Grand visual review

## Round 1

Captured dashboard, drives and energy at 390px and desktop with the shared
server and the default font scale. All six viewport images were opened and
inspected; copies are in `shots/deco/round-1/`. The command exited **1**:
four cases failed and two passed. These images are evidence, not acceptance.

Five priority findings and the owned corrections:

1. **Mobile metric readability:** Drives and Energy split ordinary words such
   as “Distance”, “Efficiency” and “consumption” into fragments because each
   half-width metric also divided its label and value into two columns.
   Stack the label and value within each phone metric, retaining the responsive
   outer bank and the original data.
2. **Desktop information density:** The two desktop briefs placed every fact
   in an individually full-width ledger row, consuming most of the viewport.
   Arrange the already-balanced metric banks into responsive, ruled columns
   while keeping the ledger treatment and source order.
3. **Mobile masthead proportion:** The dashboard title wrapped and the scope
   and command rows were visually off-centre. Shorten the side rules and
   scale the title for phone widths; centre the existing action zones without
   splitting or hiding their controls.
4. **Signature polish:** The fine masthead rules were nearly lost against the
   dark surface. Add a restrained accent-token tint and inset architectural
   frame, preserving the user's theme and accent and the forced-colors path.
5. **Phone text and targets:** The diagnostic reported 11px on the navigation
   buttons, 12–14px on non-protected dashboard widget context, units and footer
   links, and 14px text plus 36×36px/10×28px controls inside the protected
   Digital Twin. Raise the owned, non-protected phone text and button font
   floors. The twin is excluded from pack ownership and needs a shared fix.

Round 1 also reported a pending `/api/v1/pinned` request on desktop Energy.
The five Axe scans that ran reported zero violated contrast rules, with
3, 1, 0, 3 and 4 nodes respectively requiring manual review; desktop Energy
failed before its scan. No light-theme or forced-colors capture was requested.

## Round 2

The same six images were captured and inspected in
`shots/deco/phone-390-scale-1/` and `shots/deco/desktop-scale-1/`. The command
exited **1**: four cases passed and two failed. Phone Drives and Energy no
longer reported split metric words or undersized body text. The desktop
briefs now show their facts in balanced columns; the phone mastheads and
dashboard action groups are more compact and centred.

- Phone Dashboard still failed on the protected Digital Twin's 36×36px Open,
  10×28px refresh and three 14px text nodes. The earlier non-protected widget
  and navigation text findings no longer appeared in this run.
- Desktop Drives failed while `GET /api/v1/pinned` remained pending during
  mock API verification. Desktop Energy passed in this round; its matching
  Round 1 failure therefore remains an intermittent readiness concern.
- The five Axe scans that ran reported zero violated contrast rules and
  3, 1, 0, 3 and 19 nodes requiring manual review, respectively. Desktop
  Drives failed before its Axe scan. These incomplete nodes are not passes.

No third capture was taken. Dark, default-scale viewport images do not verify
light theme, forced colors, all content below the fold, or every saved setting.
The targeted no-screenshot geometry probe additionally exercised 360, 390 and
430px, font scales 0.85, 1 and 1.35, and forced colors on/off in a synthetic
brief; it did not replace real-page acceptance.

## Verification

Both capture rounds used `node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs deco`,
with `DESIGN_PACK_CAPTURE_OUTPUT_ROOT`, `TEMP`, `TMP` and `TMPDIR` set to the
owned shot directory. Round 1 exited 1 (`4 failed, 2 passed`); Round 2 exited
1 (`2 failed, 4 passed`). Full diagnostic output is in `round-1.log` and
`round-2.log`.

The Deco-filtered metric, composition, steps, feedback and operational-brief
Vitest run reported `Test Files 5 passed (5)` and `Tests 11 passed | 248
skipped (259)`. CSS parsing reported `PASS: 85 CSS rules parsed and
owner-qualified`; `git diff --check` exited 0. The scoped violations audit
exited 0 with six zero counts and `TypeScript passes`; its TSX-specific counts
are not substantive for this CSS-only target. No build was run, per the
worker brief. Page line/section comparisons and API-hook checks do not apply
to this stylesheet change.

### Standalone DataTable frame

From `web`, ran:

```text
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='deco binds only the painted frame' --reporter=dot

 RUN  v4.1.12 D:/repos/teslasync/web

----------------------·------------

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  13:19:49
   Duration  6.30s (transform 3.46s, setup 269ms, import 4.72s, tests 153ms, environment 961ms)

DATATABLE_TEST_EXIT=0
```

The focused test ran and passed; no stylesheet change or additional capture
was needed.

Repeated with the requested single-worker limit:

```text
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='deco binds only the painted frame' --reporter=dot --maxWorkers=1

 RUN  v4.1.12 D:/repos/teslasync/web

----------------------·------------

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  13:20:16
   Duration  5.70s (transform 2.91s, setup 256ms, import 4.10s, tests 171ms, environment 991ms)

DATATABLE_TEST_EXIT=0
```
