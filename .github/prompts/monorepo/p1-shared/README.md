---
description: "P1 Shared — phase index (parity scan, OpenAPI contract, codegen, KMP core, design tokens, tests)"
---

# P1 — Shared Core, Contract & Parity Spec

The foundation **all four apps** build on. Produces: the **parity manifest** (canonical
web spec), the **OpenAPI 3.1 contract** + generated clients, the **Kotlin Multiplatform
shared core**, the **design tokens**, the **i18n catalog**, and the **golden test
vectors** that keep Windows (C#) in lockstep with KMP.

> Prereqs: P0 `STATUS=DONE`. Read `../README.md`, `../0000-methodology.prompt.md`, and
> ADR-003/004/005/006/008/013/014. Branch `feat/apps-shared` (ADR-007).

## Phases

| Phase | Theme | Prompts | Output |
|---|---|---|---|
| **S0** | Parity inventory | `S0-0001..S0-00NN` | `apps/parity/parity-manifest.json` (every route/page/panel/chart/api/string) + the **manifest generator** + drift check |
| **S1** | OpenAPI contract | `S1-0001..` | annotate Go handlers → emit `api/openapi/teslasync.openapi.json` + conformance test |
| **S2** | Client codegen | `S2-0001..` | generated Kotlin / C# / Swift clients + drift gate |
| **S3** | KMP project setup | `S3-0001..` | `apps/shared` Gradle/KMP module, targets (android/jvm/ios), DI, Ktor engine wiring |
| **S4** | Networking + SSE | `S4-0001..` | resilient HTTP client, auth interceptor, SSE client, retry/backoff/circuit-breaker |
| **S5** | SI units + formatting | `S5-0001..` | SI converters/formatters (port `web/src/lib/unitConversion.ts` SI block) + golden vectors |
| **S6** | Auth + secure storage | `S6-0001..` | OIDC PKCE flow, token store `expect/actual`, 401-refresh (ADR-008) |
| **S7** | Offline cache | `S7-0001..` | SQLDelight schema + cache-then-network repos + freshness stamping (ADR-013) |
| **S8** | Presentation/state | `S8-0001..` | per-feature state holders (one per web hook domain) consumed by all UIs |
| **S9** | Design tokens | `S9-0001..` | extract web tokens → `apps/design/tokens.json` + generators → Fluent/Material/HIG |
| **S10** | i18n catalog | `S10-0001..` | neutral catalog from web locales + per-platform resource generators (ADR-014) |
| **S11** | Diagnostics/logging | `S11-0001..` | redacting logger + crash/analytics abstraction (ADR-016) |
| **S12** | Shared tests + CI | `S12-0001..` | unit + contract + golden-vector suites green in CI |
| **S99** | Shared acceptance gate | `S99-0001` | freeze the contract + core; ledger of shared modules; STATUS=DONE unlocks P2 |

> Phase **S0 is special**: it not only produces the manifest, it produces the **prompt
> generator** that emits one UI prompt per manifest unit for P2/P3/P4 (ADR-006). This is
> how "thousands of prompts" are produced modularly instead of hand-writing each.

## Binding rules for P1

1. Allowed files are scoped to `apps/shared/**`, `apps/design/**`, `apps/parity/**`,
   `apps/shared/i18n/**`, and `api/openapi/**` + (S1 only) Go handler annotation files.
   S1 may touch `internal/**` ONLY to add OpenAPI annotations/spec emission — no logic changes.
2. The shared core is **UI-free**: no Compose, no SwiftUI, no XAML. Logic + models only.
3. Golden vectors (S5) are language-neutral fixtures both KMP and the future C# core must pass.
4. Contract freeze at S99: after freeze, any contract change needs a superseding ADR + coordinated regen.

## Exit criteria

- `parity-manifest.json` covers 100% of `web/src` routes/pages/panels/charts/apis/strings;
  drift check green.
- OpenAPI spec conforms to the live API (conformance test green); clients generate clean.
- KMP `:shared:build` + `:shared:test` green; golden vectors pass.
- Design tokens generate all three theme files; i18n catalog generates all three resource sets.
- `S99` log `STATUS=DONE` → contract + core frozen → P2 may begin.
