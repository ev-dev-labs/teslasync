# Terminal visual review

## Interrupted first round

The Edge/scale-1 capture was stopped after its runner selected an
OS-temporary output directory. Its exit status and diagnostics are unavailable.
Only `phone-390-scale-1/dashboard.png` was produced and inspected; the other five
images are missing. This is not a visual or accessibility pass.

- **Truncated layout name:** the dashboard switcher displays
  “Implementation rev…” instead of the full selected layout name. The Terminal
  mobile menu-trigger treatment now permits the existing label to wrap rather
  than truncating it. This change has not yet been visually recaptured.

The remaining review findings cannot be established from one image. A second
round is pending the shared capture-output fix described in
`requests/terminal.md`; no additional defects are inferred.

## Screenshot-free checks

- Terminal native-composition and ordered-step preservation: 6 passed, 159
  skipped, exit 0.
- `cd web; npx tsc --noEmit`: exit 0.
- Scoped `.github/skills/audit-violations/audit.sh`: exit 0, with all six
  source-pattern counts 0 and TypeScript passing. The target is a CSS file, so
  the script's TypeScript/TSX pattern checks do not apply to its contents.
- Parsed 75 CSS selectors with PostCSS; all 75 had the final Terminal owner
  qualifier. A source-level DOM check confirmed the mobile label wrapping
  declarations and no match after removal of the owner marker.

## Second and final capture round

The shared capture-output fix unblocked the remaining round. The required
Edge/scale-1 wrapper exited **1**: dashboard, drives and energy passed at
desktop, but all three phone cases failed diagnostics. All six images were
inspected: `phone-390-scale-1/{dashboard,drives,energy}.png` and
`desktop-scale-1/{dashboard,drives,energy}.png`. The interrupted first-round
dashboard is retained as `phone-390-scale-1/dashboard--round1-interrupted.png`.
Full diagnostics are in `shots/terminal/terminal-round2-output.log`.

Most important findings:

1. **Phone metric labels split within words** on drives and energy, including
   “consumption” and “Efficiency”. Terminal now raises the existing responsive
   metric-column minimum so the ledger uses a single metric per row at phone
   widths. A synthetic real-CSS Edge check passed; the actual pages have not
   been recaptured.
2. **Dashboard layout name truncated**, and the first mobile wrapping change
   allowed the adjacent “Layout” label itself to split. The trigger now gives
   its caption a stable flex allocation and lets the name wrap on desktop and
   phone. Synthetic Edge checks passed; no post-fix capture is available.
3. **Dashboard widget headers had a redundant top rule and blank strip.**
   Terminal's generic section treatment was also applying to widget shells.
   Widget-pack subtrees are now excluded from that section rule. The exclusion
   was checked in synthetic DOM, not visually recaptured.
4. **Dashboard protected/widget controls and text remain undersized.** The
   capture measured “Open” at 36×36px, a freshness refresh target at 10×28px,
   Digital Twin heading at 14px, and other dashboard widget text/links at
   12–14px. The Digital Twin subtree is protected, and shared/widget sources
   are outside this worker's ownership. See `requests/terminal.md`.
5. **The phone navigation diagnostic reports 11px on all five buttons.**
   The shared stylesheet gives the rendered child labels a separate 16px-or-
   larger mobile size, so the parent-button result may not describe the
   visible glyphs; this needs shared investigation rather than a pack-local
   workaround. See `requests/terminal.md`.

Axe reported zero automated contrast violations in each case but **52 nodes
in total require manual contrast review**; that is not a contrast pass. No
third capture was taken, so none of the post-capture fixes has visual proof.

## Final screenshot-free checks

- Inline Edge DOM/CSS check, using real base/feedback/Terminal/mobile sheets:
  **36 synthetic scenarios passed** (360/390/400/401/430/1440px, scales
  0.85/1/1.35, LTR/RTL). It checked metric word splitting and overflow, menu
  text, widget section padding, and foreign-preview isolation; it took no
  screenshots.
- `cd web; npx tsc --noEmit`: exit 0, no output.
- PostCSS selector check: `Parsed 76 selectors; 0 missing final Terminal owner
  qualifiers`; `git diff --check` exited 0.
- A post-edit Vitest filter `-t 'terminal native'` exited 0 but selected
  **zero tests**: `Test Files 2 skipped (2); Tests 165 skipped (165)`.
  The corrected post-edit rerun used
  `npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx --testNamePattern terminal --reporter=dot`
  and reported `Test Files 2 passed (2); Tests 6 passed | 159 skipped (165)`,
  exit 0.
- The earlier scoped violations audit predates the final CSS edits, and its
  TS/TSX checks do not inspect CSS. No build was run.

The orchestrator subsequently built a snapshot containing the final Terminal,
Editorial, Quiet, Swiss and Warm stylesheets with `npm run build` (exit 0);
Terminal's SHA-256 matched the working stylesheet. A combined native
composition, ordered-step and DataTable selection reported 3 files passed,
35 tests passed and 165 skipped. These checks do not resolve the visual or
contrast findings above.

## Phone metric follow-up

Recent drives context measured 11.9px at scale 0.85 and 14px at scale 1.
The owned ordinary headline context and units now use the phone body token;
protected and specialized surfaces remain excluded. See `DECISIONS.md` for
the screenshot-free regression results and remaining limitations.
