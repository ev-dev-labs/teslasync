# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Screenshot-free 360/430px sweeps passed 504/506 Classic cases and 500/508 Studio cases; protected dashboard twins remain unresolved. Security Access phone targets now have focused cross-browser checks; the final screenshot matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected dashboard twin hotspots and standalone routes remain unresolved.
- Dark and light Drives/Energy/Vehicles sweeps passed 162/162 scoped checks each; the light contrast scan had 64 incomplete nodes, 12 later resolved in Terminal. Cyber grid contrast and preview isolation have focused cross-browser checks; full-page accessibility remains unverified.
- Full Vitest on snapshot `243a4c3199` passed 2,947 files and 101,822 tests; later CSS and browser-test changes require separate validation.
- Draft PR #259 targets `feature/app-design-themes`; required checks on head `2b2aef0093` passed, while browser jobs remain in progress.
- Surface fixes have all-pack browser and component coverage; a Firefox/WebKit preview repeat passed 4/6, with a missing preview and exact-restoration failure. Test synchronization changes remain unverified.
- Docker preview `0fae1a58ab` is healthy at `localhost:3120`; the existing backend health endpoint still returns 503.
