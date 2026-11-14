# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Classic phone diagnostics cover selected routes only, including five repaired routes at 360/430px; the final screenshot matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected twin hotspots and standalone routes remain unresolved.
- Frontend and E2E TypeScript, full lint, focused contracts and an isolated build passed for the Expressive heading follow-up.
- The eight Vitest shards and merged coverage passed in CI on `ced744f586c9`; later changes have focused local coverage.
- Draft PR #259 targets `feature/app-design-themes`; its checks are the source for current CI status.
- Local Firefox/WebKit verification is blocked by browser-download timeouts; CI provides separate browser coverage.
- The Docker preview is healthy at `localhost:3120`; the existing backend health still reports Tesla API degraded.
