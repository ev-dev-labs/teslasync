# Navigation icon motion plan

## Setup
- Base origin/ui/ui-fixes-2 at 08c3d2d6e1, fetched before creating worktree.
- Worktree D:/repos/teslasync-nav-motion; branch ui/nav-motion only.
- Existing dependencies linked by junction; no installation.
- Own preview will use a free port in 3100–3110 and stop after checks.

## Decisions and checklist
- [x] Duplicate bell first: Notifications uses inbox tray everywhere, rail caption Inbox, accessible/header name Notifications. Bottom Alerts bell and unread badge unchanged.
- [x] Shared, static-by-default multipart SVG icons; preserve current Lucide outlines and ISC attribution, 1.8px stroke, no new dependencies/colors.
- [x] User-selection-only one-shot motion, no load/restore/route-triggered animation, replay on re-selection, reduced-motion and press feedback.
- [x] Unit, Edge motion/capture and existing navigation/status/i18n/route suites.
- [x] All gates, final report, cleanup, push and clean Git status.

## Findings
- Canonical navigation contains 22 sections, all already resolved through sidebarIcons.ts. Footer utilities and phone More currently use separate static glyphs.
- Current Home is Lucide LayoutTemplate (three outlined tiles), rather than four independent tiles. Preserve that resting silhouette; split the upper tile outline into two independently moving halves so four parts can stagger without adding an internal seam. Other requested pivots will follow actual Lucide geometry.
- Automation/Connect request stroke-dashoffset but the global motion rule allows transforms/opacity only. Use translating/fading connector parts and matching the data-flow intent without animating paint/layout properties.

## Verification
- Initial sidebar/phone suites: 212 passed, no failures. Added dedicated Inbox caption/full Notifications name/single pinned-bell test.
- SectionRail typed translation audit: 13 calls, zero errors. LF-normalized; generated source fingerprint and catalog checkpoints with existing scripts. Catalog keys preserved across languages; split catalog regenerated with zero known-missing keys.

## Shared icon and trigger implementation
- All 22 sections resolve through one factory/registry; static surfaces use identical SVG groups and paths. Added utility BellRing, Palette, User avatar and Ellipsis variants; retained their access and tooltips. Display injects the shared icon into its existing trigger without changing theme behavior.
- Native click capture covers mouse/touch/Enter/Space. Selection adds is-animating; the up-to-440ms container animation end clears it after the last staggered part. Re-selection restarts it. No route/state effects start animation. Reduced-motion/app low-bandwidth preference suppresses and clears playback.
- Every part uses transform-box:view-box and explicit source-coordinate origins. Animations/100ms press scale are entirely inside the no-preference media query. Only transforms and opacity animate; no new colors/dependencies. Existing accent treatment retained; inactive captions use muted text.
- Choreography: Home four outline parts dip/pop (40ms stagger); Vehicles body dip/wheels half-turn; Driving forward nudge/pulse; Charging prongs/body/cord compression (0/30/60ms); Battery case squeeze/bolt pulse; Energy hex ratchet/counter-pulse ring; Cabin frame flex/cushion compression; Reports stationary axis/three rising bars (45ms stagger); Service shaft pivot/jaw turn; Commands chevron punch/cursor slide and two stepped blinks; Automation node/flow/node (150ms final delay); Inbox tray dip/flap drop (60ms delay); Security shackle lift/slam/body compression; Advanced four star quadrants rotate/pulse outward; Ownership converge/two nods; Physics counter-spinning orbits/nucleus pulse; Data three spreading/compressing platters; Diagnostics tube flex/lub-dub chestpiece; Account head bounce/shoulders flex; Settings ratchet/counter-ring; Connect top pulse/connector flow/staggered child pop; About ring pulse/stem bounce/dot launch. Footer Bell dome/clapper/waves + badge pop, Palette four staggered dots, avatar gentle press bounce. More three sequential dot bounces.
- Geometry decisions: preserve the existing single Sparkle silhouette by splitting its quadrants, rather than adding new resting sparks. Wrench jaw represents the requested nut motion within the existing outline. Diagnostics chestpiece actually centers at (20,10), so use that precise pivot rather than the request's example (18,14). Physics orbits return from ±60 degrees to rest to prevent an end-frame jump. Symmetric Energy/gear/star rotations end on matching silhouettes.
- Part durations 250–400ms; final staggered part ends by 420ms; lifecycle ends at 440ms (avatar bounce ends at 400ms). Native transition press feedback scales the icon container to 0.90 over 100ms.
- Unit verification: 213 existing nav tests + 37 new motion tests pass. TypeScript noEmit and targeted ESLint pass. Existing tests now inspect the explicit caption span and require the specified 1.8px SVG stroke.
- LF translation audit: Layout 14 calls, BottomTabBar 6, SectionRail 13; keys/fallbacks/interpolations all verified, zero errors. Existing generators regenerated source/combined fingerprints (68 combined producers); hashes not hand-edited.
- Preview uses port 3102, PID 53648; other agents' occupied ports 3100/3101 left untouched.

## Edge-driven follow-up
- First browser pass exercised all 22 rail items and all phone tabs successfully, then exposed a live OS preference change leaving is-animating behind when CSS cancels playback. Added a direct media-query change listener and subscription cleanup; dedicated regression test passes (38 motion unit tests now).
- The default populated API harness has no legacy /alerts entries. The motion fixture explicitly supplies one unread alert so browser assertions and captures exercise the existing footer badge/pop rather than an empty badge state.
- Avatar deliberately animates its container only, matching the requested gentle press bounce; the browser assertion allows its one container animation while requiring multiple animations for all other controls.
- Full existing nav/status/i18n trio batch: 33 suites / 8,176 passed before the added live-preference regression; no failures. Catalog check passes. Full lint and Edge layout/regression checks running.

## Deferred icon loading
- Full build passed, but its report exposed startup JS at 401.5 KB against the existing 400 KB performance budget. Split unchanged destination glyphs into sidebarRouteIcons.ts and import that directly in Layout, so the shared animated section registry stays with lazy CommandDeck. Removed the now-unused duplicate Lucide Inbox import from SidebarGlyphs.
- Layout translation audit repeated after its import change: 14 calls, zero errors; source checkpoint regenerated. No routes or destination glyph assignments changed.
- Full final unit batch after this split: 33 suites, 8,177 tests passed (251 navigation/motion + 254 status + 7,672 i18n trio), zero failures.
- Full npm run lint including all audits passed. Catalog --check passed. Edge existing sidenav 22 tests + route guards 15 tests passed (dashboard, charging, battery, settings, live map at 375/414/768/1280/1920).

## Final verification and captures
- Dedicated Edge motion tests: 5 passed, zero failures. Both themes at 1280: every one of 22 rail sections and all three footer utilities, active-item replay, Enter/Space, same static header glyph, one pinned bell with unread badge/tooltip, reload without playback. Both themes at 375 with touch: all five tabs, More/section sheets static and identical, no horizontal overflow, reload closes sheets. Separate mouse press/release and live reduced-motion test passes.
- Capture helper waits for a real animationstart before pausing at a sampled frame, then resumes and verifies natural animationend cleanup. Timing assertions inspect every real CSS animation's duration plus delay (maximum 440ms including lifecycle; part maximum 420ms), one iteration and identity transforms at rest. This avoids short animations expiring during separate browser protocol calls under CPU load.
- Existing Edge sidenav suite: 22 passed. Existing route layout guard: 15 passed, 25 route/viewport combinations, zero violations at 375/414/768/1280/1920 for dashboard, charging, battery, settings and live map.
- Final unit batch: 33 suites / 8,177 passed, zero failures: 251 navigation/motion, 254 status bar and 7,672 across the three i18n trio suites. No tests skipped or deleted; old caption/stroke assertions updated to retain their intent.
- tsc --noEmit: passed. Build includes another app typecheck and service-worker typecheck: passed. Catalog split --check: passed, zero known-missing keys. LF/UTF-8 validated for changed covered shell files; source fingerprints came from verified repository generators.
- npm run build: passed, including PWA/cache/source-map contracts. Animated section code/CSS stays deferred in CommandDeck; startup JS 398.4 KB, within unchanged 400 KB budget. No dependencies installed and no performance thresholds changed.
- npm run lint with all audits: passed again after the route-glyph split.
- Captures: docs/nav-motion/ contains 18 PNGs, nine per theme: 1280 Home/Inbox/Diagnostics/Settings sampled frames, pinned Alerts badge/tooltip frame, Display palette frame and resting rail; 375 resting tabs/status bar and static Notifications section sheet. Lucide ISC attribution is included alongside them. Reviewed representative light/dark desktop and phone captures for alignment, clipping, spacing and correct static shapes. Phone sheets cover the tab bar by existing design, so phone resting/sheet captures are supplied rather than obscured animation frames.
- Owned preview PID 53648 on port 3102 stopped after checks. Temporary Playwright results, guard reports and Vite cache removed; other agents' services untouched.

## Final summary
- Duplicate bell resolved first: Notifications is the shared inbox-tray icon, visible rail caption Inbox, accessible name and panel/sheet heading Notifications. Pinned Alerts remains the bell with badge and right-side tooltip.
- Added static-by-default, shared 24x24 multipart SVGs for every section and utility, currentColor/1.8px rounded strokes, exact source pivots and documented choreography choices above. More uses three sequential bouncing dots. No route/data/calculation/backend changes.
- Motion starts only from user activation, supports repeated activation, stops within 440ms, preserves theme/accent tokens and is fully suppressed for reduced motion. Refresh/restored state and programmatic routing never start motion; static navigation surfaces stay identical.
- No product decisions or blockers remain. Final report/captures/tests committed and pushed on ui/nav-motion; Git cleanliness checked after push.

## Final asset and clipping checks
- Moving SVGs explicitly allow overflow so the lifted lock shackle, spreading database platter and forward arrow tips remain visible across the view-box boundary. All controls retain their existing dimensions. The Edge rail loop now checks visible SVG overflow on every section. Motion unit suite rechecked: 38 passed.
- Public and private npm run build passed. After the CSS-only overflow refinement, the production Vite build and all asset contracts passed again. Strict bundle/module-attribution check passed with private maps: startup JS 398.4 KB / 400 KB; 274 of 434 Lucide modules in startup (63%); 14 existing feature modules in startup. All original thresholds retained.
- The strict check requires module maps; a public build deliberately omits them. Used the documented private mode for attribution, then removed all 925 generated maps. Public source-map contract passes again with zero maps.

- Avatar container bounce is limited to 400ms because it has no stagger; its dedicated Edge timing assertion enforces the stricter limit. All other visible sequences settle within 400ms, with staggered Diagnostics/Connect parts finishing by 420ms and a 440ms selection lifecycle.

- Final Edge rerun after overflow/avatar timing refinement: all 5 motion cases passed again, including the 400ms avatar assertion. The second owned preview (PID 69640, port 3102) is stopped; its result/cache folder is removed. Final public npm run build passed on the exact final CSS: startup JS 398.3 KB, all PWA/cache/source-map contracts passed, zero maps in dist.
