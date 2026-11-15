# Design pack status

- `design-packs-v2` is based on `feature/app-design-themes`; all 27 stylesheets changed, but their reviews retain unresolved defects.
- Classic, Studio, Executive Concierge and Expressive Form each passed 1,014/1,016 matrix checks, Horizon 1,012/1,016, and Precision Ledger and Iconic Showroom 1,013/1,016 each. Concierge and Expressive charge units have passing phone retries; protected dashboard cases remain unresolved and the matrix is unfinished.
- Phase 1 remains incomplete: token coverage, protected dashboard twin hotspots and standalone routes remain unresolved.
- Dark and light Drives/Energy/Vehicles sweeps passed 162/162 scoped checks each; the light contrast scan had 64 incomplete nodes, 12 later resolved in Terminal. Cyber grid contrast and preview isolation have focused cross-browser checks; full-page accessibility remains unverified.
- Full Vitest on snapshot `243a4c3199` passed 2,947 files and 101,822 tests; the `98debceb5a8b` rerun was stopped after a Firefox axis defect was found.
- Draft PR #259 targets `feature/app-design-themes`; head `876619a52e` failed two frontend test shards and WebKit desktop isolation. Test-only timing fixes passed targeted checks and full lint; the isolation failure remains under investigation.
- Local WebKit 390px custom/dark isolation passed; a focused desktop custom probe passed, but the prior 0.5px desktop difference and the next CI run remain unresolved.
- Docker preview `f9c93755bfa2` is healthy at `localhost:3120`; the later Expressive phone fix awaits a fresh build. The existing backend health endpoint still returns 503.
