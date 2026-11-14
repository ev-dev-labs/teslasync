# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Screenshot-free 360/430px sweeps passed 504/506 Classic cases and 500/508 Studio cases; protected twins remain unresolved. Quick Stats checks passed across 27 packs using two builds; the final screenshot matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected twin hotspots and standalone routes remain unresolved.
- Mocked Recent drives context and Command History axes have targeted all-27-pack phone checks; other mobile coverage remains incomplete.
- The eight Vitest shards and merged coverage passed in CI on `ced744f586c9`; later changes have focused local coverage.
- Draft PR #259 targets `feature/app-design-themes`; quality checks on `5f276d00fa` were cancelled after `8e784a91a5` was pushed, and replacement checks are running.
- Receipt, readiness, Quiet preview and heatmap fixes have focused coverage; WebKit SVG restoration and desktop isolation remain unresolved.
- Docker preview `d97ada73ed2b` is healthy at `localhost:3120`; existing backend health still reports Tesla API degraded.
