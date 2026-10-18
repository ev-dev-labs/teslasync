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
- [x] Edge interaction/layout checks and screenshots.
- [x] TypeScript, lint/audits, catalog and build gates.
- [x] Final summary, commit/push and clean Git status.
- [ ] Delete ignored temporary artifacts: blocked by automatic approval review (details below).

## Verification
- Navigation/status unit suites: 381 passed, 0 failed (21 files). Includes 22-section glyph comparisons across all surfaces, absence of section tooltips/titles, right-side utility tooltips, default groups and explicit persisted choices. Existing reachability test opens collapsed groups before checking all unchanged routes.
- TypeScript --noEmit: passed.
- Typed i18n verification: BottomTabBar 6 calls, AtlasPanel 30, CommandDeck 1, SectionRail 13, SidebarRow 0, MoreSegment 9; no missing keys, mismatched defaults, variables or plural counts. Normalized changed sources to LF, regenerated producer and combined checkpoints using existing scripts.
- No English catalog wording changed. Reused statusBar.more.statusTitle (Status); regenerated split bundles for the changed source usage.
- Full lint/audits, trio and Edge gates are running/pending.

## Edge verification decisions
- Port 3100 is occupied by pre-existing PID 5804 (`vite preview --port 3100 --strictPort --host 127.0.0.1`, started 09:48). Left that process untouched. Own dev server uses 3101; SIDENAV_BASE_URL overrides only the check endpoint (default remains 3100). This is the sole requested-port deviation.
- Edge channel msedge, real touch contexts at 375/414/768, mouse at 1280/1920. Existing redesign interactions and reload checks retained; added density/hover/status/More checks and light/dark screenshots.
- Extended existing route guard to 414px with the same measurements and thresholds. Requested routes: /, /charging, /battery, /settings, /live.
- Trio suites: 7,672 passed, 0 failed (3 files).

## Visual review correction
- Phone screenshots exposed the shared Button's fixed height compressing SVGs despite the tab bar's reserved height. Set tab height to fill the bar, minimum 60px, 14px caption line height, and non-shrinking 22px icons. Added real SVG bounding-box assertions.
- The fetched base defaults tablet panels closed on a fresh visit; Edge checks explicitly open the section before measuring the drawer, preserving that existing behavior.
- Full lint including audits passed. The first build was intentionally stopped before bundling while correcting the observed phone sizing; final build will run after the correction commit.

## Gate results
- Expanded unit run (all sidebar helpers, legacy Sidebar, BottomTabBar, ThemeQuickSwitcherPopover, StatusBar and status-bar suites): **478 passed / 0 failed / 0 skipped**, 30 files.
- Three i18n trio suites: **7,672 passed / 0 failed / 0 skipped**.
- TypeScript `tsc --noEmit`: passed; production build also completed both app and service-worker typechecks.
- `npm run lint`: passed, including the complete audit chain and release-identity check. Existing thresholded help-tooltip coverage remains 8/9; unchanged.
- `node scripts/split-i18n-catalog.mjs --check`: passed (57 bundles, 181 fallbacks, 1,272 shell keys, zero known-missing keys).
- `npm run build`: passed at source commit **41a8824660**, including bundle budgets, PWA precache/contract and source-map postchecks. HEAD and app sources stayed fixed throughout the completed build.
- Committed-byte verification: all six regenerated producer SHA256 values match the exact committed LF source bytes; no hashes edited manually.
- Edge route guard: **15 passed / 0 failed / 0 skipped**, covering 25 requested route/width combinations (5 routes × 5 widths); zero narrow-card, per-character wrapping or horizontal-overflow violations.

## Final summary
1. Panel density: 34px page/pin rows, 28px group headers and 34px filters for fine pointers at desktop/tablet widths; 12px group spacing. Coarse pointers and phone sheets retain 44px targets. Inset row/header focus outlines remain visible.
2. Rail: removed section Tooltip wrappers and native titles; full accessible names retained, including shortened captions. Alerts, Display and account retain right-side tooltips outside the scrolling section list.
3. Groups: small sections start expanded, including Pinned/Recent. Above 25 unique pages, only the active-page group plus Pinned/Recent start expanded. Explicit persisted booleans override these defaults, including an explicit open of a default-collapsed group.
4. Icons: one resolveSectionIcon helper backed by the existing registry supplies every rail item, phone section tab, More item and contextual header (including section sheets). All 22 canonical sections compared across their actual rendered surfaces.
5. Phone: 64px bar with 22px non-shrinking icons, 11px labels and 4px gaps; indicator inset 4px from the status boundary; safe-area padding remains on the lowest bar. Overflow now displays Status with an idle Activity glyph and keeps existing contents/state indicators. More excludes the four primary phone sections, highlights the current route's section and centers labels within two lines. Existing shared modal focus trap, Escape and backdrop behavior retained and exercised.
6. No routes, calculations, backend behavior or canonical navigation destinations changed. Original reachability contract and reload/persistence checks pass. No tests deleted, skipped or weakened; changed old tooltip/More assertions preserve accessible labeling and interaction intent.

### Final verification and artifacts
- Navigation/theme/status units: **478 pass, 0 fail, 0 skip**.
- i18n trio: **7,672 pass, 0 fail, 0 skip**.
- Edge sidenav redesign + polish: **22 pass, 0 fail, 0 skip** (reload, navigation, keyboard/focus, sheets, drawer, actual pointer density, measured icons, status separation and utility menus).
- Edge route guard: **15 pass, 0 fail, 0 skip**, 25 route/viewport combinations.
- All four gates passed: TypeScript, full lint/audits, split catalog check, production build/postchecks. Build source: 41a8824660; subsequent commits contain documentation/screenshots only.
- **62 PNG screenshots** in `docs/sidenav-polish/`: light/dark mouse views at 1280/1920 (Charging density, section hover without tooltip, Alerts tooltip); touch views at 375/414 (tabs/status, More and selected-section sheet, expanded Status); touch drawer at 768. Additional collapsed/scrolled/reload gallery and footer utility captures retained.
- Visual inspection confirmed full phone icon sizing, section grid wrapping/current selection, compact desktop Charging groups and readable light/dark token colors.
- Own preview server PID 55252 stopped after verification; port 3101 has no listener. Pre-existing port 3100 server left untouched.

### Blocked cleanup and deviation
- Requested port 3100 unavailable (pre-existing preview PID 5804). All Edge checks used this worktree's own port 3101, with the same msedge channel and routes/widths. Default Playwright endpoint remains 3100 unless SIDENAV_BASE_URL is set.
- Automatic approval review rejected both bounded recursive cleanup and the narrower explicit seven-log removal with the exact reason **"blocked by policy"**. No permission was requested. As a reversible cleanup, moved logs and Playwright result directories into ignored `.sidenav-vite-cache/reports/`; the worktree-local dependency cache and guard results also remain ignored under `.sidenav-vite-cache/`. These temporary artifacts were never staged or committed. Their physical deletion remains blocked.
- Git tracked/untracked status will be clean after the final documentation/screenshot commit; no implementation or test blockers remain.
