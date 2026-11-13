# Swiss Grid (`swiss`) review

## First round — 2026-11-13

Command, with `DESIGN_PACK_CAPTURE_OUTPUT_ROOT=D:\repos\teslasync\docs\design-packs\shots\swiss`:

```powershell
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs swiss
```

Exit **1**:

```text
Running 6 tests using 1 worker
  3 failed
    [phone-390] › capture dashboard (/)
    [phone-390] › capture drives (/drives)
    [phone-390] › capture energy (/energy)
  3 passed (3.0m)
```

All six initial viewport images were opened and inspected. They are preserved under `shots\swiss\round-1\phone-390-scale-1\` and `shots\swiss\round-1\desktop-scale-1\`, each containing `dashboard.png`, `drives.png`, and `energy.png`. The complete runner output is `shots\swiss\round-1.log`. These images do not show every scrolled state.

Five priority findings and subsequent stylesheet changes:

1. **Phone navigation typography and shape.** The five tab buttons computed to 11px on all three pages, despite larger child labels. The Swiss-owned button now uses the scale-aware mobile body size; selected-tab styling is specific enough to apply the square, ruled treatment over the shared shell.
2. **Dashboard secondary text and actions.** The diagnostic found 14px widget context and 12px units and links, including “All drives” and “Open vehicle”. Non-protected widget headings, context, headline units, and links now use the scale-aware mobile body size; the link rule declares 44px minimum dimensions.
3. **Protected Digital Twin.** The dashboard diagnostic found a 36×36px “Open” link, a 10×28px freshness control, and 14px twin text. This subtree is preserved and was not changed. The 14px “Aurora” span's ownership was not independently established. See `requests\swiss.md`.
4. **Phone header spacing.** Drives and energy reserved a full second row for their small action groups. The fixed 100% action basis was replaced with a flexible, wrapping intrinsic-width group so actions can share the title row when they fit.
5. **Desktop navigation hierarchy.** The contextual navigation occupied approximately 170px and used rounded, individually boxed groups, weakening the compact Swiss grid. The owned desktop panel cap was reduced and group boxes replaced by square, vertical rules; the existing overflow declaration remains, but scrolling has not been rechecked.

The changes above were made after the first capture and were included in the second capture below.

The three phone Axe scans and the desktop dashboard scan reported zero contrast violations and zero incomplete nodes. Desktop drives reported zero violations with **4** incomplete nodes, and desktop energy zero violations with **13** incomplete nodes, mainly chart text and legends. Playwright's desktop cases passed, but these incomplete nodes are not a complete contrast pass; charts were not visible in the initial viewport images.

## Final round — 2026-11-13

The same capture command and output-root setting were run once more. Exit **1**:

```text
Running 6 tests using 1 worker
  1 failed
    [phone-390] › e2e\design-packs-capture.spec.ts:72:3 › capture dashboard (/)
  5 passed (2.4m)
ROUND_2_EXIT=1
```

All six final viewport images were opened and inspected: `shots\swiss\phone-390-scale-1\` and `shots\swiss\desktop-scale-1\` each contain `dashboard.png`, `drives.png`, and `energy.png`. The complete runner output is `shots\swiss\round-2.log`.

The phone drives and energy cases passed. The dashboard case still failed its 44px touch check for the protected “Open” link (36×36px) and freshness button (10×28px). Its body-size check reported “Digital twin”, “—”, and “Aurora” at 14px, and “km” at 12px. Ownership of the latter two reported elements was not independently established. The previously reported 11px tab buttons, widget context, “All drives”, and “Open vehicle” did not appear in the final failure list.

All three phone scans reported `Contrast: 0 violated rules, 0 nodes require manual review`. Desktop dashboard, drives, and energy respectively reported **4, 31, and 17 incomplete nodes**, with zero reported violations. Many additional desktop findings were navigation links whose backgrounds Axe could not determine because they were partially obscured; chart axes and legends also need manual review. These are not complete contrast passes.

The final images revealed two regressions introduced by the first refinement: the phone drives title wrapped to two lines beside its actions, and the shorter desktop navigation panel clipped part of the dashboard's “Saved” row and other navigation content. After inspecting the images, the Swiss stylesheet was adjusted to give the phone title its intrinsic flex basis before wrapping actions, and the pack's reduced desktop panel-height override was removed while retaining square group rules. A scale-aware rule was also added for ordinary widget stat-card units, a possible source of the remaining 12px “km”. These three edits were **not** captured or tested again; their actual effect and the remaining unit's ownership are unverified. No third capture was run.

Verification after the first refinement, before the final capture and the three later edits:

```text
Test Files  3 passed (3)
Tests  8 passed | 158 skipped (166)
CSS parsed: src/components/ui/app-designs/packs/swiss.css
Scoped phone text, link target, and header actions: 6 matched
Protected twins, native gauge, and other preview: 4 untouched
Hardcoded color declarations: 0
DIFF_CHECK_EXIT=0
```

The focused selector fixture checks matching rather than rendered geometry. The scoped guideline audit returned `No violations found` for `swiss.css` before the final edits. Earlier, `npx tsc --noEmit --pretty false` exited 0; no build was run. Light themes, other sizes and font scales, Helix, the final adjustments, and scrolled chart contexts have not been visually reviewed.

An orchestrator-owned isolated snapshot subsequently passed `npm run build`
with the finished Swiss stylesheet; its hash matched the working tree:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
SWISS_SNAPSHOT_BUILD_EXIT=0
SWISS_HASH_MATCH=True
```
