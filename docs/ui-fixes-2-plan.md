# UI fixes batch 2

## Setup
- Base: origin/ui/sidenav-polish at 23c23fc49b, fetched before creating worktree.
- Worktree D:/repos/teslasync-ui-fixes, branch ui/ui-fixes-2 only.
- web/node_modules is a junction to the existing installation; no npm install.
- Own preview will use an available port in 3100–3110 and be stopped after checks.

## Findings and decisions
1. Template icon stacking: wrapLabel wraps all children in a normal span. An inline child SVG renders as a block, above its label. An AST scan across application TSX (excluding tests) found 54 wrapLabel call sites with direct component/icon children. Fix the shared label layout to align child icons and text in a row with gap-2, preserving multiline text and icon-prop support. Intentional vertical navigation/card controls remain vertical.
2. Navigation defaults: remove the >25-page exception and version the collapse-storage key. Explicit choices in the new version remain authoritative after remount/refresh.
3. Customize: remove the filled-style exception from the freshness/actions audit and use the shared ghost IconButton variant.
4. Repair drawer: diagnosis and verification pending.

## Checklist
- [x] Shared icon/label layout and app-wide scan.
- [ ] Expanded navigation defaults and new persistence version.
- [ ] Ghost Customize and stricter action audit.
- [ ] Repair drawer alignment, footer, resolve feedback and permanent structural notice.
- [ ] Unit/i18n/audit checks, gates, Edge checks and screenshots.
- [ ] Final summary, cleanup, commits/pushes and stopped preview.

## Results
Pending.

### Fix 1: shared icon/label row
- Before: 54 source call sites exposed to the shared wrapLabel child-icon stacking defect, plus one explicit vertical command-button map in CommandQuickActionsWidget: **55 affected source call sites**. After shared wrapper and command-row fixes: **0 unintended stacked action call sites**.
- Whole-app AST scan also reviewed 14 explicit flex-col button/anchor declarations. One was the command map fixed above; the other 13 are multi-line card/preview/choice surfaces or labels without an icon, not ordinary icon+label actions. Existing vertical sidenav tabs/rail/section grid are intentional navigation surfaces. Glance command children now align through the shared wrapper.
- Regression: shared Button test covers child SVG + label, translated multiline labels, 8px gap, centering and no icon shrink. Existing icon-prop/loading/empty-child coverage retained. Command widget test now guards horizontal command rows.
- Shared Button + notification studio/source-closure suites: 69 passed, 0 failed. Additional command-widget checks running before commit.
