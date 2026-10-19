# UI fixes batch 2

## Setup
- Base: origin/ui/sidenav-polish at 23c23fc49b, fetched before creating worktree.
- Worktree D:/repos/teslasync-ui-fixes, branch ui/ui-fixes-2 only.
- web/node_modules is a junction to the existing installation; no npm install.
- Own preview used free port 3101 (3100 was occupied); stopped PID 7312 after Edge checks.

## Findings and decisions
1. Template icon stacking: wrapLabel wraps all children in a normal span. An inline child SVG renders as a block, above its label. An AST scan across application TSX (excluding tests) found 54 wrapLabel call sites with direct component/icon children. Fix the shared label layout to align child icons and text in a row with gap-2, preserving multiline text and icon-prop support. Intentional vertical navigation/card controls remain vertical.
2. Navigation defaults: remove the >25-page exception and version the collapse-storage key. Explicit choices in the new version remain authoritative after remount/refresh.
3. Customize: remove the filled-style exception from the freshness/actions audit and use the shared ghost IconButton variant.
4. Repair drawer: assignment wrapper alignment, footer clearance, permanent structural notice, immediate cache updates and single-attempt resolution; definitive API replay diagnosis recorded below.

## Checklist
- [x] Shared icon/label layout and app-wide scan.
- [x] Expanded navigation defaults and new persistence version.
- [x] Ghost Customize and stricter action audit.
- [x] Repair drawer alignment, footer, resolve feedback and permanent structural notice.
- [x] Unit/i18n/audit checks, gates, Edge checks and screenshots.
- [x] Final summary, cleanup, commits/pushes and stopped preview.

## Results
All fixes implemented and all required checks passed; final results and summary below.

### Fix 1: shared icon/label row
- Before: 54 source call sites exposed to the shared wrapLabel child-icon stacking defect, plus one explicit vertical command-button map in CommandQuickActionsWidget: **56 affected source call sites**. After shared wrapper and command-row fixes: **0 unintended stacked action call sites**.
- Whole-app AST scan also reviewed 14 explicit flex-col button/anchor declarations. Two were ordinary commands: the widget map and Glance QuickAction (conditional child icon, counted separately in the final expanded scan). The other 12 are multi-line card/preview/choice surfaces or labels without an icon, not ordinary icon+label actions. Existing vertical sidenav tabs/rail/section grid are intentional navigation surfaces. Glance command children now align through the shared wrapper.
- Regression: shared Button test covers child SVG + label, translated multiline labels, 8px gap, centering and no icon shrink. Existing icon-prop/loading/empty-child coverage retained. Command widget test now guards horizontal command rows.
- Shared Button + notification studio/source-closure suites: 69 passed, 0 failed. Command-widget suites: 19 passed, 0 failed.

### Fix 2: always-expanded navigation defaults
- All groups now default expanded regardless of section page count. Pinned/Recent behavior and filtering remain intact.
- New local-storage key: teslasync-sidenav-collapsed-groups-v2. Old unversioned values are ignored without deleting unrelated state. Explicit v2 collapse/open values persist.
- Updated large-section expectation and added migration/remount coverage. All sidebar + BottomTabBar suites: **212 passed, 0 failed**.
- AtlasPanel typed translation verification: 30 calls, zero errors; source normalized to LF and existing producer/combined checkpoint generators run.

### Fix 3: ghost Customize
- App-wide source search found one filled icon-only Customize action, in DashboardPage. Changed it to ghost; shared IconButton supplies transparent rest state, subtle hover and token focus outline.
- Removed only the Customize exemption from the freshness/actions audit; other action, confirmation and freshness checks are unchanged. Audit tests now reject filled Customize and accept ghost Customize.
- Header/PageActions/IconButton/Dashboard suites: **73 passed, 0 failed**. Freshness/actions audit tests: **8 passed, 0 failed**; audit passes.
- DashboardPage typed i18n verification: 68 calls, zero errors; LF-normalized and regenerated its existing fingerprint.

### Fix 1 verification follow-up
- Finite-registry verification found eight pre-existing missing widget.quickActions command-label keys. Reused existing catalog keys for all eight commands; Flash now uses the existing complete label “Flash Lights”. Verified every key/default pair from the real COMMANDS declaration, with no interpolation. Updated command-label expectations without changing dispatched commands.
- Combined affected suites now pass: **517 tests, 33 files, 0 failures** (studio, shared Button, command widget, sidenav, header/actions, repair components/workspace and API hooks).

### Fix 4: repair drawer
- Ownership: Input's className applies to the native input, not its label wrapper. Wrapped it in a flexible full-width container; wide rows bottom-align the input and equal-height button, narrow rows stack full width.
- Footer: added 96px bottom space inside the repair content so the final Controlled actions section can scroll fully clear of the persistent footer. Edge verified geometry and clickability at all four requested widths in both themes.
- Resolve diagnosis: source inspection found the correct existing POST /data-repair/cases/{id}/transition and correct case id/timestamp/note wiring. The first click opens a confirmation; the required operator note intentionally disables confirmation until nonblank. Failures previously surfaced only in a transient toast, and successful mutations invalidated caches without applying the response immediately. No missing endpoint or swallowed request handler was found.
- Resolve fix: synchronous in-flight guard prevents duplicate requests; confirmation/footer expose pending state; persistent inline errors retain the note for retry; the successful API response updates the detail and cached lists immediately (removing the row from status filters it no longer matches), followed by existing invalidation/broadcast. Success closes confirmation and changes the drawer badge.
- Backend/product decision: internal/api/datarepair/cases.go permits open/in_review → resolved as a metadata lifecycle transition with an operator note and optimistic concurrency. It does NOT require applicable=true for this transition. Structural corrections remain separate, safety-checked operations. UI explicitly states that resolution records review and does not correct source data; the operator note should document the manual correction. No backend rule or calculation changed.
- Manual notice cause: previously rendered only when blocked_reason was present. Structural rule identity now also keeps it in the Integrity finding card even if a refresh/action response omits or clears that optional reason. Status and loading/error state do not gate the notice.
- New tests: existing API payload and live-mode flag, pending state, success/detail/list updates, filtered-list removal, duplicate-click suppression, persistent conflict error + retained note, notice at first load/during refresh/after refresh error/metadata update/resolve/reopen. Three new integration tests pass; all affected 517 tests pass.
- Translation verification: Drawer 19 calls, EvidencePanel 18, Collaboration 8, presentation helpers 8; zero errors after aligning three stale fallbacks to current catalog wording (confidence high/medium and overlap warning). API hook/shared Button contain no t() calls. Added two complete repair explanation/error strings. Existing catalog/source/combined generators used after LF normalization; all 7,672 trio checks pass.
- Catalog checkpoint verified 42,175 known source keys and preserved language keys. No catalog keys deleted. Split catalog regeneration reports zero known-missing keys.

### Final horizontal-layout follow-up
- Removed Glance QuickAction's outer flex-col as well, so its loading spinner stays beside the caption. Its ordinary child icon already benefits from the shared wrapper; this is a conditional-icon caller missed by the initial direct-child scan; the corrected final count is 56 (54 direct-child callers plus Glance plus the command widget map).
- Glance typed translation verification: 90 calls, zero errors. Glance/client/resolve focused run: 166 passed, zero failures (includes three previously counted resolve tests).

### Resolve browser diagnosis: automatic replay
- Edge reproduced an additional concrete wiring defect hidden by unit-level API mocks: request() first tries directRequest, then automatically replays non-sudo failures through resilientFetch. A 409 transition conflict was therefore retried without another click, hiding the first failure when the second attempt succeeded.
- useTransitionRepairCase now uses the client's existing skipAuthRefresh=true single-attempt path and retry=false on the mutation. This preserves the existing sudo challenge path and makes ordinary conflicts/errors final until the operator explicitly retries. No shared client/backend policy changed.
- Real Edge pilot now passes: conflict remains visible with the operator note intact; a second explicit click succeeds; exactly two network POSTs occur for those two clicks. Success/pending/duplicate-click unit coverage still passes.
- Existing sidenav Edge suite: 22 passed. Route layout guard: 15 passed, checking six routes (dashboard, studio, repair, system-status, db-health, anomaly-detection) at 375/414/768/1280/1920: 30 route/width combinations, no violations.
- Full lint/audits passed before the final tiny single-attempt/Glance follow-ups; the final full lint run also passed with those follow-ups.

## Final verification results
- Final app-wide stacked-action inventory: **56 unsafe source call sites before → 0 after**: 54 direct child-icon wrapLabel callers, one conditional Glance action caller, and one explicit command-widget action map. Initial preliminary count was 55; the conditional-icon scan identified Glance separately. Two other conditional candidates are an existing inline-flex Onboarding row and an AI thinking indicator, already safe. Reviewed 32 native/link candidates: all use shared BUTTON_BASE, an existing horizontal base class or the rail's grid utility class; no additional stacked actions found. Twelve remaining explicit vertical declarations are card/preview/choice layouts or labels without ordinary action icons. Intentional sidenav icon/label stacks retained.
- Affected unit run: **517 passed** across 33 files. Additional Glance/API-client/sudo/offline/resolve run: **166 passed** across 5 files, including the same 3 resolve tests; **680 distinct tests across 37 files**, zero failures/skips.
- Freshness/actions audit tests: **8 passed**, audit passed; no Customize exception remains.
- i18n trio: **7,672 passed**, zero failures/skips. Generated source fingerprints and catalog checkpoints used only after translation verification and LF normalization.
- Standalone `tsc --noEmit`: passed. Split catalog `--check`: passed. Final full `npm run lint` including audits: passed.
- Production `npm run build`: passed at source commit **0c8590c4c3**, including app/service-worker typechecks, bundle budgets, PWA precache/identity contracts and source-map checks. No app-source or HEAD changes occurred during the completed build. Nonfatal existing CSS-minifier warning: `Unexpected "$"` in `hue.bg-$`; build/postchecks still succeeded.
- Edge/msedge on own port **3101** (3100 was occupied): existing sidenav suite **22 passed**; route layout guard **15 passed**, 30 route/width combinations over /, /notifications/studio, /data-repair, /system-status, /db-health and /anomaly-detection, at 375/414/768/1280/1920; no layout violations.
- New batch Edge matrix: **8 passed**, light/dark at 375/768/1280/1920. Confirms real 8px template icon/text gap and vertical centering, fresh expanded Diagnostics despite old stored state, transparent Customize, equal-height/bottom-aligned Ownership on wide screens and stacked full-width controls on phones, both Controlled actions clickable above the footer, required resolution note, persistent error + explicit retry, exact POST counts, resolved badge and persistent structural notice.
- Screenshot QA recapture adds a trial click after centering the template button above fixed phone chrome; implementation is unchanged.

## Final summary
- Completed all four requested UI fixes. Ordinary icon/label actions now stay horizontal across the shared Button, command widget and Glance; final source inventory is **56 before / 0 after**, with shared-unit and real Edge geometry/clickability guards.
- Every panel group defaults expanded, including large Diagnostics sections; v2 persistence ignores old-design collapse state while preserving new explicit choices and reload behavior.
- Customize is ghost app-wide; freshness/actions audit rejects filled Customize while retaining all other checks.
- Repair Ownership controls align with the input on wide screens and stack full-width on phones. Controlled actions remain visible/clickable above the footer. Structural correction notices persist across refresh, errors, state changes and reopen.
- Resolve root cause/outcome: the existing client replayed failed transition requests. Case transitions now use the existing single-attempt client path and disable mutation retries, expose pending/inline failure states, suppress duplicate submissions and immediately update detail/list caches. Verified conflict followed by explicit operator retry and successful resolution.
- Product decision: backend permits resolving the case record with a note, including structural cases; this does not repair source data. The UI states this distinction and asks the note to document the manual correction. No backend rules, routes or calculations changed.
- Final unified affected-unit run: **680 passed / 0 failed / 0 skipped**, 37 files. i18n trio: **7,672 passed / 0 failed / 0 skipped**. Freshness/actions audit: **8 passed**. Edge: **45 passed / 0 failed / 0 skipped** (22 existing sidenav, 15 route guard, 8 new matrix cases). Screenshot-framing recapture reran the same 8 cases successfully.
- Gates all passed: standalone TypeScript, full lint/audits, split catalog check, production build and its bundle/PWA/source-map postchecks. Build source commit: **0c8590c4c3**. Subsequent changes contain only report/screenshot framing and artifacts.
- **58 PNG screenshots** in `docs/ui-fixes-2/`, light/dark at 375/768/1280/1920: inline template cards, fresh expanded Diagnostics, ghost Customize, repair Integrity notice, aligned Ownership, bottom actions clear of footer, and post-resolution notice; conflict/error screenshots at 1280 in both themes.
- Visual review confirmed template buttons fully above phone chrome, readable icon/label rows, matched input/button alignment and clear footer action access.
- Deleted owned generated Playwright report directories, guard reports and temporary sidenav gallery after validating all cleanup paths remain within this worktree. No temporary logs/reports staged or committed. Dependency cache/build output remain ignored build artifacts.
- Own server stopped; port 3101 has no listener. No forbidden Muse/previous-plan files changed. No blockers remain. Final commit/push leaves Git status clean.
