# Navigation icon motion plan

## Setup
- Base origin/ui/ui-fixes-2 at 08c3d2d6e1, fetched before creating worktree.
- Worktree D:/repos/teslasync-nav-motion; branch ui/nav-motion only.
- Existing dependencies linked by junction; no installation.
- Own preview will use a free port in 3100–3110 and stop after checks.

## Decisions and checklist
- [x] Duplicate bell first: Notifications uses inbox tray everywhere, rail caption Inbox, accessible/header name Notifications. Bottom Alerts bell and unread badge unchanged.
- [ ] Shared, static-by-default multipart SVG icons; preserve current Lucide outlines and ISC attribution, 1.8px stroke, no new dependencies/colors.
- [ ] User-selection-only one-shot motion, no load/restore/route-triggered animation, replay on re-selection, reduced-motion and press feedback.
- [ ] Unit, Edge motion/capture and existing navigation/status/i18n/route suites.
- [ ] All gates, final report, cleanup, push and clean Git status.

## Findings
- Canonical navigation contains 22 sections, all already resolved through sidebarIcons.ts. Footer utilities and phone More currently use separate static glyphs.
- Current Home is Lucide LayoutTemplate (three outlined tiles), rather than four independent tiles. Preserve that resting silhouette; split the upper tile outline into two independently moving halves so four parts can stagger without adding an internal seam. Other requested pivots will follow actual Lucide geometry.
- Automation/Connect request stroke-dashoffset but the global motion rule allows transforms/opacity only. Use clipped connector fragments with translating/fading flow accents, retaining static connectors and matching the data-flow intent without animating paint/layout properties.

## Verification
- Initial sidebar/phone suites: 212 passed, no failures. Added dedicated Inbox caption/full Notifications name/single pinned-bell test.
- SectionRail typed translation audit: 13 calls, zero errors. LF-normalized; generated source fingerprint and catalog checkpoints with existing scripts. Catalog keys preserved across languages; split catalog regenerated with zero known-missing keys.
