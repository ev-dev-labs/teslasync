# Horizon Loft (`v2`) review

Both capture rounds used this command from `web`:

```powershell
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_CHECK_CONTRAST='1'
node scripts\capture-design-packs.mjs --pack v2 --pages dashboard,drives,energy --viewports phone-390,desktop --base-url http://127.0.0.1:54872
```

## First round

The prescribed Dashboard, Drives and Energy capture ran at `phone-390` and
`desktop` with scale 1, touch, text-size and contrast checks. The command
exited **1**. The phone Dashboard image was saved and inspected:
`shots/v2/round-1/phone-390-scale-1/dashboard.png`. Its test failed; Axe
reported zero contrast violations and zero incomplete nodes for that one
rendered route, not a contrast pass for the pack.

The shared preview server stopped accepting connections after that capture.
Phone Drives, phone Energy, and all three desktop images are missing; their
tests failed with `net::ERR_CONNECTION_REFUSED`. They were not visually
reviewed in this round.

### Findings and changes before the final round

1. **Clipped phone navigation.** The Dashboard capture showed Charging and
   More below their tab bounds, confirmed by the diagnostic (text bottom
   837px versus tab bottom 832px). Excluded the bottom bar from sidebar
   spacing and restored a 44px minimum row with safe-area-aware padding.
2. **Navigation text too small.** All five phone navigation buttons computed
   to 11px in the diagnostic even though their child labels were larger.
   The pack now applies the shared 16px-or-larger body scale to the buttons.
3. **Layout context was truncated.** The Dashboard layout selector displayed
   “Implementation rev…” despite available horizontal space. Its menu label
   can now wrap and use more of the phone width without changing the action.
4. **Dashboard secondary information was undersized.** The diagnostic found
   14px headline context, a 12px unit, and 12px “All drives” and “Open
   vehicle” footer links. App-owned widget headline context, units and footer
   links now use the shared phone body scale. The remaining stat-card unit
   required a further correction after the final capture, described below.
5. **Protected Digital Twin accessibility remains unresolved.** The
   diagnostic measured the Open control at 36×36px, refresh at 10×28px, and
   twin text at 14px. The pack cannot change this preserved subtree; see
   `requests/v2.md`.

## Final round

The same prescribed command exited **1**: **5 passed, 1 failed**. All six
available viewport images were opened and inspected:

- `shots/v2/phone-390-scale-1/dashboard.png`
- `shots/v2/phone-390-scale-1/drives.png`
- `shots/v2/phone-390-scale-1/energy.png`
- `shots/v2/desktop-scale-1/dashboard.png`
- `shots/v2/desktop-scale-1/drives.png`
- `shots/v2/desktop-scale-1/energy.png`

The phone Dashboard's navigation labels were no longer clipped or reported as
11px, the layout name wrapped instead of truncating, and the footer links and
headline context no longer appeared in the small-text findings. Phone Drives
and Energy passed the enabled capture diagnostics. Dashboard still failed:
the protected twin controls and text remain undersized, and a 12px `km` unit
in the unprotected Charge Status stat card was also reported.

The desktop Drives and Energy images showed the theme control wrapping onto a
second workspace-header row. After the final round, the pack was adjusted to
use equal side tracks around the centered search and to include the Charge
Status stat-card unit in the phone text floor. No third screenshot was taken:
the six final images therefore show the **pre-follow-up** stylesheet, and
neither follow-up has been verified on a rendered production route.

Axe reported **0 violated color-contrast rules** on each of the six captures,
but incomplete checks require manual review: phone Dashboard 0, phone Drives
1, phone Energy 0, desktop Dashboard 1, desktop Drives 5, desktop Energy 12.
These incomplete nodes include chart axis text and overlapping elements; they
are not contrast passes.

## Additional verification

- A screenshot-free synthetic Edge probe after the follow-up reported a
  1440px header with `392px 288px 392px` tracks, zero search-center offset
  and all four modeled controls on one row. It does not replace a production
  route capture.
- Screenshot-free synthetic checks at 360, 390 and 430px, at scales 1 and
  1.35 in normal and forced colors, measured the two targeted app-owned units
  at 16px and 21.6px respectively; preserved and differently owned preview
  units remained unchanged. A separate synthetic phone-navigation probe found
  no clipped or split labels and targets at least 44px across those widths
  and scales. These are isolated fixtures, not full-page acceptance.
- `& 'C:\Program Files\Git\bin\bash.exe' '.github\skills\audit-violations\audit.sh' 'web\src\components\ui\app-designs\packs\elevated.css'`
  exited 0 and printed `0 violations` in each of its six checks and
  `TypeScript passes` for `npx tsc --noEmit`. Its TS/TSX pattern checks do
  not assess CSS styling.
- `npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\AppDesignBridge.test.tsx -t "'v2' native composition preservation|nearest design boundary isolation"`:
  `Test Files 2 passed (2)`, `Tests 11 passed | 113 skipped (124)`.
- `npx vitest run src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx -t "'v2' native steps identity preservation"`:
  `Test Files 1 passed (1)`, `Tests 2 passed | 52 skipped (54)`.

The captures cover dark mode at scale 1 only. Real light/forced-color routes,
larger text, 360/430px routes, open menus and Helix states remain unverified.
No build was run. Page line/section comparisons and hook verification were not
applicable to this stylesheet-only implementation.

## Contact-sheet refinement — no new visual review

The coordinator's first-eight comparison found Horizon Loft too close to
Classic and Concierge: the desktop and phone silhouettes still read as generic
framed cards. The pack now separates its page-level groups using the saved
density gap, gives eligible standalone content and chart **frames** wider
corners and the existing e2 shadow, and opens the compact split header with
balanced desktop tracks and slightly more phone spacing. It does not change
colors, saved preferences, native metric or chart viewport dimensions, or
interactions. Embedded, metric, widget-internal, conversation, protected,
report and kiosk surfaces are excluded from the new island treatment.

Both permitted screenshot rounds were already spent. No further images were
captured; the six final images above predate this refinement. **There is no
visual pass or production-route visual verification for these changes.**

### Screenshot-free verification after refinement

- An isolated Edge fixture compared the preceding and refined CSS in 20
  combinations: 360, 390, 430, 1024 and 1440px; font-scale variables 1 and
  1.35; normal and forced colors. It found no modeled document or header
  overflow. At 390px the sample island radius changed from 20px to 24px and
  page gap from 22.4px to 24px; at 1440px they changed to 31.68px and 36px,
  with equal 689px header tracks. At 390px, density gaps of 8/12/16px yielded
  page gaps of 16/24/32px. Modeled metric, chart-plot and viewport sizes,
  internal positions and padding were unchanged, as were modeled colors and
  fonts; embedded and nested surfaces, widget-internal, protected,
  other-preview, report and kiosk surfaces were unchanged. This synthetic
  fixture is not a production-page accessibility or visual test.
- From `web`, the focused preservation and isolation command
  `npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx src\components\ui\AppDesignBridge.test.tsx -t "'v2' native composition preservation|'v2' native steps identity preservation|nearest design boundary isolation"`
  exited 0: `Test Files 3 passed (3)`, `Tests 13 passed | 165 skipped (178)`.
  An earlier invocation from the repository root exited 1 with three
  unresolved `@/` imports and no tests; the corrected run used the web
  workspace and its Vitest configuration.
- `bash .github/skills/audit-violations/audit.sh web/src/components/ui/app-designs/packs/elevated.css`
  exited 0 before the final nested-surface exclusion was tightened:

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

  ═══════════════════════════════════════════════════════════
    ✅ ALL CHECKS PASSED — 0 total violations
  ═══════════════════════════════════════════════════════════
  ```

  The audit's TS/TSX patterns do not inspect CSS; the final synthetic probe
  and focused tests above ran after that selector change.

The protected Digital Twin sizing request and the 19 incomplete Axe nodes
remain open. Phone 360/430, larger text, light/forced-color production routes,
menus and Helix still lack real-route visual review.

## Coordinator build

The coordinator ran `npm run build` in an isolated web snapshot containing
the committed shared foundation and the final Horizon Loft stylesheet. It
exited 0; the final checks reported:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```
