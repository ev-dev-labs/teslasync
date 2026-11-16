# Design pack status

- Design work is accepted and frozen; all 27 existing packs and IDs are preserved.
- PR #259 now targets `main`; merging fetched main `b79759f9cc` reported already up to date, and the frontend build passed.
- Twin phone controls and body text are repaired without changing vehicle scenes; existing dashboard checks passed Classic dark and Pixel light at 360/430px (4 cases).
- Existing Firefox notification-axis tests passed dark, light and custom-font/locale cases (3 cases).
- Generated-artifact freshness passed all checks and verified 282 registered paths byte-identical; TypeScript and full frontend lint passed.
- CI rate-limit integration contracts are repaired without relaxing thresholds: 7 frontend files / 7,744 tests passed; the Guard package passed Linux race tests with 87.2% coverage.
- Docker preview at http://localhost:3120 is deployed. The one full test run completed; all 9 failed files passed focused reruns. Lifecycle/retry repairs passed targeted browser runs; current workflow results are tracked on PR #259, not inferred from older commits.
- Existing screenshots are preserved. Deferred matrix, contrast-incomplete, 0.5px desktop and token-coverage work is listed in FOLLOWUPS.md.
