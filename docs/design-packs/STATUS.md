# Design pack status

- Design work is accepted and frozen; all 27 existing packs and IDs are preserved.
- PR #259 targets `main`, is ready, mergeable and unmerged. Refreshed local ancestry at `c572eedc0d` is `249 0`; the frontend build passed.
- Twin phone controls and body text are repaired without changing vehicle scenes; existing dashboard checks passed Classic dark and Pixel light at 360/430px (4 cases).
- Existing Firefox notification-axis tests passed dark, light and custom-font/locale cases (3 cases).
- Generated-artifact freshness passed all checks and verified 282 registered paths byte-identical; TypeScript and full frontend lint passed.
- CI rate-limit integration contracts are repaired without relaxing thresholds: 7 frontend files / 7,744 tests passed; the Guard package passed Linux race tests with 87.2% coverage.
- `f2a7691240` repairs phone stat units, actual patterned contrast, radial-label overlap, light chart ticks and shared chart/heatmap tokens. All 1,593 reviewed incomplete contrast nodes are accounted for without Axe exclusions.
- `cc80591ddb` repairs CI workflow/source-history contracts, reports lazy recovery failures and awaits the backup success transition. Seven affected files pass 831 tests; strict startup size is 399.4 KB against the unchanged 400 KB budget. Latest-head CI lint, shard 2 and freshness pass; remaining gates are running.
- `5e23bbb1ca` passes the bounded Firefox scaled-containment phases, all six Chromium containment variants and four-worker Firefox/WebKit isolation checks. It also repairs shared grid composition, listener fanout, lifecycle fixtures, gas-gradient keys and the sidebar JSX diagnostic. Bounded unit receipts include 2,004, 1,393 and a final 305 passing cases. Latest-head CI remains required.
- Docker preview at http://localhost:3120 serves the healthy `5e23bbb1ca` image, with verified entry identity and readiness. The prior container is preserved for rollback. The shared backend has no live Tesla token; FOLLOWUPS.md records this external prerequisite.
- Existing screenshots are preserved; only ten existing repaired-dashboard images were replaced. Exact desktop restoration, the observed WebKit font wait, final review reconciliation and latest-head workflow acceptance remain active FIXLIST.md work, not deferrals.
