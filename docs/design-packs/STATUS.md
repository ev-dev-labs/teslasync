# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- The resumed Classic matrix passed 1,014/1,016 checks; two protected dashboard twin phone cases failed. Its preserved images span builds, and the remaining pack matrix is unfinished. Studio's earlier screenshot-free sweep passed 500/508 phone cases.
- Phase 1 remains incomplete: token coverage, protected dashboard twin hotspots and standalone routes remain unresolved.
- Dark and light Drives/Energy/Vehicles sweeps passed 162/162 scoped checks each; the light contrast scan had 64 incomplete nodes, 12 later resolved in Terminal. Cyber grid contrast and preview isolation have focused cross-browser checks; full-page accessibility remains unverified.
- Full Vitest on snapshot `243a4c3199` passed 2,947 files and 101,822 tests; later CSS and browser-test changes require separate validation.
- Draft PR #259 targets `feature/app-design-themes`; head `876619a52e` passed the catalog shards but failed two unrelated frontend tests. Test-only timing fixes passed targeted checks and full lint, and await a new CI run.
- Local WebKit 390px custom/dark isolation passed; a focused desktop custom probe passed, but the prior 0.5px desktop difference and the next CI run remain unresolved.
- Docker preview `445e5bb317b1` is healthy at `localhost:3120` and includes the heatmap fix; the existing backend health endpoint still returns 503.
