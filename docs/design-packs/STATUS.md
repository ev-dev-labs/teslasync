# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Screenshot-free 360/430px sweeps passed 504/506 Classic cases and 500/508 Studio cases; protected dashboard twins remain unresolved. Security Access phone targets now have focused cross-browser checks; the final screenshot matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected dashboard twin hotspots and standalone routes remain unresolved.
- Dark and light Drives/Energy/Vehicles sweeps passed 162/162 scoped checks each; the light contrast scan had 64 incomplete nodes, 12 later resolved in Terminal. Charger metadata passed all packs at scale 1.35; full-page accessibility remains unverified.
- The eight Vitest shards and merged coverage passed in CI on `ced744f586c9`; a later local run had four failures. An immutable full run on `243a4c3199` is in progress.
- Draft PR #259 targets `feature/app-design-themes`; checks on head `2b2aef0093` are in progress.
- Surface fixes have all-pack browser and component coverage; a Firefox/WebKit preview repeat passed 4/6, with a missing preview and exact-restoration failure. Test synchronization changes remain unverified.
- Docker preview `fdcd380f40` is healthy at `localhost:3120`; the existing backend health endpoint still returns 503.
