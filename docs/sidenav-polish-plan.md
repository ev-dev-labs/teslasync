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
- [ ] Panel density, rail tooltips, default groups and shared icons.
- [ ] Phone spacing, Status overflow and filtered More sheet.
- [ ] Unit tests and verified i18n checkpoint regeneration.
- [ ] Edge interaction/layout checks and screenshots.
- [ ] TypeScript, lint/audits, catalog and build gates.
- [ ] Final summary, cleanup, commit and push.

## Verification
Pending.
