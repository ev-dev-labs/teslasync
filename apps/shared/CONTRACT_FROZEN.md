# CONTRACT_FROZEN — P1 shared program

> **Status:** FROZEN at the P1/S99 shared acceptance gate.
> Certified by `.github/prompts/monorepo/p1-shared/S99-0001-shared-gate.prompt.md`.
> Gate log: `.github/prompts/monorepo/logs/p1-s99-0001-shared-gate.log` (`EXIT=0 / STATUS=DONE`).
> ADR refs: ADR-003, ADR-004, ADR-006, ADR-010.

This document is the immutable base that platforms **P2 (Windows)**, **P3 (Android)**,
and **P4 (Apple)** build on. Any later change to a frozen artifact requires a
**superseding ADR** plus a **coordinated regeneration** of every dependent client,
theme, i18n catalog, and golden vector — see "Change control" below.

## Freeze coordinates

| Frozen artifact | Path | SHA-256 | Version / size |
|---|---|---|---|
| OpenAPI 3.1 contract | `api/openapi/teslasync.openapi.json` | `D5A43C129ECA946F2234310ECA2835EA702D7FBA3DB593BA84D9E29572DA8BF8` | info.version `1.0.0`, 533 routes |
| Design tokens | `apps/design/tokens.json` | `757C670C11EE90F82D2296C8A131EDB5DFBB1634C7D82685554BB83B49BE54D2` | P1/S9 neutral tokens (ADR-005) |
| Units golden vectors | `apps/shared/spec/units-golden.json` | `AF2DFA0A19B34FBEA2833FD9FF88AE5597EBE9A4BA2D3A31763161033E61A0D7` | 92 vectors |
| i18n catalog index | `apps/shared/i18n/catalog/_index.json` | `EC183627C1BFBB30180C3F5FEA890EA9558B44BC55B93C0EA5981BC2466D0F23` | en base, 7772 entries, ar/he RTL |
| Parity manifest | `apps/parity/parity-manifest.json` | `10311392C8D568136BED4F78D1C51031DF3C32806E052B570598F0EE28A1FA8F` | 1754 units (153 pages) |

Frozen at commit `cbaba1d5231ac9369289a4bcbf359706423bdfd7` on branch `feature/apps`.

## What the gate verified (each green)

| Check | Result |
|---|---|
| `:core:allTests` + `koverVerify` (Android/JVM host) | **2680 tests, 0 failures, 0 errors, 0 skipped**; coverage floor met |
| OpenAPI conformance (`go test ./internal/api -run OpenAPI`) | green; spec regen byte-identical (no drift) |
| Typed client drift (`gen-clients.ps1 -Check`) | green — 20 generated files match the spec |
| Parity manifest drift (`gen-parity-manifest.ps1 -Check`) | green — manifest up to date (1754 units) |
| Design themes drift (`gen-themes.ps1 -Check`) | green — windows/android/apple in sync |
| i18n completeness (`gen-i18n.ps1 -Check`) | green — 7772 grouped entries, en complete, ar/he fallback |
| Placeholder gate (`check-placeholders.ps1` over `apps/shared`, `apps/design`) | `PLACEHOLDER_COUNT=0` |
| S5 units golden + S8 derivation golden suites | present and passing (`UnitsGoldenTest`, `*GoldenTest`, `*DerivationGoldenTest`) |
| S11 redaction/consent | present and passing (`RedactionTest`, `DiagnosticsTest`, `BufferedDiagnosticsSinkTest`) |

### Host limitation (disclosed, not hidden)

Apple native test tasks (`iosSimulatorArm64Test`, `macosArm64Test`) are **SKIPPED** on the
Windows gate host because Kotlin/Native links Apple frameworks on macOS only. All shared
behavior lives in `commonTest` and executes fully on the Android/JVM target (the 2680-test
suite above). The Apple framework *packaging* acceptance (`Shared.xcframework`) is the one
deferred item, owned by macOS CI per the S3 scaffold log. No shared *logic* is unverified.

## Change control

A frozen artifact may only change via:

1. A new ADR that supersedes the relevant decision (ADR-003/004/006/010), and
2. A coordinated regeneration in the same change set:
   - OpenAPI → re-run `gen-clients.ps1` (Kotlin + C#) and `go test ./internal/api -run OpenAPI`.
   - `tokens.json` → re-run `gen-themes.ps1` (Fluent/Material3/HIG).
   - `units-golden.json` → re-run unit golden tests on every platform.
   - i18n catalog → re-run `gen-i18n.ps1 --check`.
   - parity manifest → re-run `gen-parity-manifest.ps1 --check`.
3. Updating the SHA-256 table above and re-running the S99 gate to `STATUS=DONE`.

Until then, P2/P3/P4 treat these coordinates as constants.
