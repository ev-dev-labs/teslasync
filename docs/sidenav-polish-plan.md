# Sidenav polish plan

## Base and setup
- Base: origin/ui/simplification at 1f84906396. origin/ui/sidenav-redesign is an ancestor (merge-base exit 0).
- Worktree: D:/repos/teslasync-sidenav-polish; branch ui/sidenav-polish.
- Dependencies: junction to existing web/node_modules; no installation.

## Decisions
- Share the existing sidebar section icon registry across every surface.
- Keep persisted collapse choices authoritative; apply the large-section default only when no explicit choice exists.
- Use pointer-specific density on desktop/tablet; phone sheets always retain touch sizing.
- Reuse the existing translated Status title for the overflow label and accessible name.

## Checklist
- [x] Isolated setup and base selection.
- [x] Panel density, rail tooltips, default groups and shared icons.
- [x] Phone spacing, Status overflow and filtered More sheet.
- [x] Unit tests and verified i18n checkpoint regeneration.
- [ ] Edge interaction/layout checks and screenshots.
- [ ] TypeScript, lint/audits, catalog and build gates.
- [ ] Final summary, cleanup, commit and push.

## Verification
- Navigation/status unit suites: 381 passed, 0 failed (21 files). Includes 22-section glyph comparisons across all surfaces, absence of section tooltips/titles, right-side utility tooltips, default groups and explicit persisted choices. Existing reachability test opens collapsed groups before checking all unchanged routes.
- TypeScript --noEmit: passed.
- Typed i18n verification: BottomTabBar 6 calls, AtlasPanel 30, CommandDeck 1, SectionRail 13, SidebarRow 0, MoreSegment 9; no missing keys, mismatched defaults, variables or plural counts. Normalized changed sources to LF, regenerated producer and combined checkpoints using existing scripts.
- No English catalog wording changed. Reused statusBar.more.statusTitle (Status); regenerated split bundles for the changed source usage.
- Full lint/audits, trio and Edge gates are running/pending.
