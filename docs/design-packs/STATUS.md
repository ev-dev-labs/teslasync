# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Classic phone diagnostics cover selected routes only; the final screenshot matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected twin hotspots and standalone routes remain unresolved.
- Local frontend/E2E/service-worker TypeScript, full lint, and focused legend tests passed on `2376cb5786df`.
- The eight Vitest shards and merged coverage passed in CI on `ced744f586c9`; later changes have focused local coverage.
- Draft PR #259 had eight Windows visual-baseline failures on `ced744f586c9`; the reviewed baseline repairs require current-head CI.
- Local Firefox/WebKit verification is blocked by browser-download timeouts; CI verification is pending.
- Docker preview is available at `localhost:3120`; the existing backend health still reports Tesla API degraded.
