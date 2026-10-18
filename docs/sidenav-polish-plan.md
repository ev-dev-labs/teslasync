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
