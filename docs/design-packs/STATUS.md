# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Screenshot-free 360/430px sweeps passed 504/506 Classic cases and 500/508 Studio cases; protected dashboard twins remain unresolved. Security Access phone targets now have focused cross-browser checks; the final screenshot matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected dashboard twin hotspots and standalone routes remain unresolved.
- Dark and light Drives/Energy/Vehicles sweeps passed 162/162 scoped checks each; the light contrast scan had 64 incomplete nodes, 12 later resolved in Terminal. Cyber grid contrast and preview isolation have focused cross-browser checks; full-page accessibility remains unverified.
- Full Vitest on snapshot `243a4c3199` passed 2,947 files and 101,822 tests; later CSS and browser-test changes require separate validation.
- Draft PR #259 targets `feature/app-design-themes`; five WebKit design jobs and three dependent browser aggregate checks failed on head `2b2aef0093`.
- Local WebKit 390px custom/dark isolation passed; a focused desktop custom probe passed, but the prior 0.5px desktop difference and the next CI run remain unresolved.
- Docker preview `87afae094c6e` is healthy at `localhost:3120` but predates the heatmap fix; the existing backend health endpoint still returns 503.
