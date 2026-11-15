# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Screenshot-free 360/430px sweeps passed 504/506 Classic cases and 500/508 Studio cases; protected dashboard twins remain unresolved. Security Access phone targets now have focused cross-browser checks; the final screenshot matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected dashboard twin hotspots and standalone routes remain unresolved.
- Mocked Recent drives, Command History axes and Helix content have targeted all-27-pack phone checks; other mobile coverage remains incomplete.
- The eight Vitest shards and merged coverage passed in CI on `ced744f586c9`; a later full local run had four failures, and a fresh immutable run is in progress.
- Draft PR #259 targets `feature/app-design-themes`; workflows on `3b65d101b4` are running after Chromium shard and WebKit interaction fixes.
- Helix history, Horizon freshness, readiness and heatmap fixes have focused coverage; exact WebKit owner restoration and desktop isolation remain unresolved.
- Docker preview `3b65d101b4` is healthy at `localhost:3120`; the existing backend health endpoint still returns 503.
