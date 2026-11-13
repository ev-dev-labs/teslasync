# Precision Ledger (v3) review

## First round — 2026-11-13

Command: `cd web; node scripts\capture-design-packs.mjs --pack v3 --pages dashboard,drives,energy --viewports phone-390,desktop --base-url http://127.0.0.1:54872` with `DESIGN_PACK_BROWSER_CHANNEL=msedge`, `DESIGN_PACK_FONT_SCALE=1`, and `DESIGN_PACK_CHECK_CONTRAST=1`. Exit **1**.

Inspected the phone dashboard and drives images. The shared preview stopped responding during the run, so phone energy and all three desktop images were not produced. Dashboard and drives also failed their phone text-size checks; dashboard additionally failed touch-size checks. Axe reported zero contrast violations on each available route, but the drives scan had one incomplete node, which is not a contrast pass.

Five priority findings and changes:

1. **Phone header hierarchy:** “Drive history” wrapped beside its actions at 390px. Reduced the pack's horizontal title/header gaps without shrinking action targets; the final image shows the title on one line.
2. **Navigation text inheritance:** the phone tab buttons computed to 11px even though their child labels were larger. Set the owned tab button font to the shared, scale-aware body size.
3. **Dashboard readability:** the owned Vehicle Card heading and body were 14px, while “All drives” and “Open vehicle” were 12px. Applied the phone body-size floor to owned widget headings, body copy, context, units, and small text links; the links also receive 44px minimum targets. Only preserved-twin text remained in the final dashboard text-size failure. The first viewport showed two blank card outlines; the final dashboard image showed populated content.
4. **Sticky summary:** the drives “4 results” summary was 12px; Axe could not determine its background because of partial overlap. Raised owned sticky-summary text to the mobile body size. The final phone drives scan had no incomplete contrast nodes, but the scrolled summary was not visible in the viewport image for independent visual review.
5. **Protected Digital Twin:** the phone audit found a 36×36px “Open” link, a 10×28px freshness control, and 14px text inside the preserved twin. They cannot be changed by this pack; see `requests\v3.md`.

The phone drives capture otherwise showed the intended ruled rows and right-aligned figures. These two screenshots cover only the initial viewport, not every scrolled state.

## Final round

The same command was run after preview recovery. Exit **1**: Playwright reported five cases passed and phone dashboard failed for the protected-twin touch and text findings above. This is not a full accessibility pass.

Inspected all six final viewport images:

- `shots\v3\phone-390-scale-1\dashboard.png`, `drives.png`, `energy.png`
- `shots\v3\desktop-scale-1\dashboard.png`, `drives.png`, `energy.png`

The three phone scans each reported zero Axe contrast violations and zero incomplete nodes. Desktop dashboard, drives, and energy reported zero violations but respectively **2, 7, and 14 incomplete nodes**. The selected Home label is visibly readable in the desktop dashboard image; sampled light glyph/background pixels were approximately 15.90:1, not a substitute for a complete contrast audit. The remaining affected rail, scrolled link/table, and chart-axis/legend contexts were not all visible in these viewport images and still need manual review. See `requests\v3.md`.

The final images show aligned, ruled metrics on drives and energy, neutral surfaces and preserved vehicle imagery on the dashboard. No chart is visible in the initial desktop viewports; chart behavior and contrast beyond those images remain unverified.

## Other verification and limits

- `cd web; npx tsc --noEmit`: exit 0 (`TSC_EXIT=0`).
- The required guideline audit against `precision.css`: six category counts of 0; TypeScript passed; exit 0. Its TSX/API checks do not independently test CSS appearance.
- Focused Vitest run: 4 files passed, 15 tests passed, 200 skipped; exit 0. Recharts emitted zero-size warnings in the test DOM.
- A screenshot-free browser fixture passed with the required theme tokens: owned mobile text was 16px, the link target was 63.5×44px, the focused tab had a solid outline, and protected/nested-preview text was unaffected by v3's rules. Text scaled to 21.6px at 1.35×, including when forced colors and reduced motion were emulated. This is a scoped fixture, not a visual or complete accessibility pass. Earlier fixture attempts failed because the shared mobile rule also sizes another pack's paragraph, a synthetic Tab sequence missed the intended button, and a fixture omitted `--focus-ring`.
- No build was run. Light themes, other route/state combinations, actual 360px/430px pages, enlarged-font pages, scrolled chart contexts, and live Helix conversations were not visually captured in these two rounds.

## Contact-sheet refinement — 2026-11-13

The first-eight side-by-side review found v3 too close to Classic and Telemetry Studio's boxed instrument silhouette. The pack now emphasizes a single-column rhythm for ordinary metric grids without protected/native descendants and lower horizontal rules on neutral standalone surfaces, while retaining border widths and existing surface colors. Selected/semantic surfaces, explicitly bordered dashboard widgets, preserved content and native metric/map/chart targets are excluded from the new flattening rule. The page header uses tighter density-based spacing and a quieter semibold weight; the existing ledger category supplies aligned, tabular readings.

Screenshot-free focused test command: `cd web; npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\feedback\AppDesignNativeConsumers.test.tsx src\components\feedback\AppDesignWidgetConsumers.test.tsx src\components\ui\app-designs\categoryBrowserFloor.test.tsx -t v3`. Output: `Test Files  3 passed | 1 skipped (4)`, `Tests  6 passed | 165 skipped (171)`, `VITEST_REFINEMENT_EXIT=0`. The native-consumer file has no v3 cases and was entirely skipped.

After adding the native-descendant grid exclusion, `cd web; npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\feedback\AppDesignWidgetConsumers.test.tsx -t v3` reported `Test Files  2 passed (2)`, `Tests  5 passed | 134 skipped (139)`, and `VITEST_FINAL_EXIT=0`. `npx tsc --noEmit` reported `TSC_REFINEMENT_EXIT=0`. The scoped audit using Git Bash reported six `0 violations` counts, `TypeScript passes`, and `AUDIT_REFINEMENT_GIT_EXIT=0`; its TSX/API checks do not test CSS appearance. An earlier WSL Bash invocation failed to resolve its Windows-style path (`AUDIT_REFINEMENT_EXIT=127`).

A PostCSS/JSDOM selector fixture reported `PRECISION_SELECTOR_CHECK=0`: the one-column rule matched the ordinary grid but not protected/native-descendant grids, and the flattened-panel rule did not match selected, explicitly bordered widget, map, twin or nested-preview targets. Three earlier screenshot-free browser fixtures exited 1 because they sampled a font-size transition immediately after changing the scale or viewport; a separate diagnostic observed 16px immediately and 21.6px after 300ms at 1.35×.

The corrected screenshot-free Edge fixture reported `BROWSER_SETTLED_EXIT=0`. Its computed output included `desktopRows: "640px"`, `nativeBank: "314px 314px"`, `align: "end"`, `numeric: "lining-nums tabular-nums"`, and `fontAt135: "21.6px"`. The test panel retained its dimensions and background while its top/side borders became transparent; the fixture's twin and nested preview were unchanged. Forced colors restored a visible top border. These synthetic checks do not establish full-page accessibility or appearance.

No further screenshots were taken. The prior screenshots precede this refinement, so the new appearance has **not** received a visual pass; the protected-twin and incomplete-contrast requests above remain open.

The orchestrator subsequently ran `npm run build` in the isolated verification
worktree with the final Precision Ledger stylesheet: **exit 0**. Its SHA-256
matched the working stylesheet; the visual and accessibility gaps remain.
