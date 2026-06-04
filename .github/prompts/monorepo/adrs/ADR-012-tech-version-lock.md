# ADR-012 — Technology + version lock (latest stable, as of 2026-06)

**Status:** Accepted · 2026-06 · Supersedes: none (revisit quarterly)

## Context

"Use the latest technologies." Versions must be pinned so thousands of prompts build
reproducibly, while staying current. Verified against vendor release channels 2026-06.

## Decision

Pin the following baselines (exact patch versions live in `apps/*/gradle/libs.versions.toml`,
`Directory.Packages.props`, and `Package.swift` / project settings; bumped via Renovate):

| Area | Locked baseline |
|---|---|
| **Shared (KMP)** | Kotlin **2.2.x**; Gradle 8.x; Ktor 3.x (client + SSE); kotlinx.serialization; kotlinx-datetime; SQLDelight (cache); Koin/manual DI |
| **Android** | Jetpack Compose (BOM, latest stable) + **Material 3 (Expressive)**; AGP latest; minSdk 26+, targetSdk = latest; Compose Navigation; Coil; MapLibre/Google Maps Compose; Vico (charts) |
| **Windows** | **Windows App SDK 1.6+** / WinUI 3; **.NET 10 LTS**; C# 13/14; CommunityToolkit (MVVM, WinUI controls); Native AOT where viable; LiveCharts2 / WinUI charts |
| **Apple** | **SwiftUI** (current Xcode); Swift 6 (strict concurrency); **Swift Charts**; **MapKit**; swift-openapi-generator; The Composable-free, plain SwiftUI + Observation (`@Observable`) |
| **Contract** | **OpenAPI 3.1**; generators: OpenAPI Generator (Kotlin), NSwag or Kiota (C#), swift-openapi-generator (Swift) |
| **Compose MP** | NOT used for UI (ADR-002). Noted: CMP 1.11.1 iOS-stable — considered, rejected for UI. |

CI runners: Windows (windows-latest), macOS (macos-latest, Apple-silicon), Linux (KMP/Go).

## Consequences

- ✅ Reproducible, modern builds; one place per platform to bump.
- ✅ Latest design systems (Material 3 Expressive, Fluent, current HIG) available.
- ⚠️ Quarterly review required; major bumps (e.g. .NET 11, Kotlin 2.3) get a superseding ADR.
- ⚠️ Generator choice per language is pinned; swapping a generator is an ADR change.

## Alternatives rejected

- **Floating "latest" with no pin:** non-reproducible across a multi-month effort.
- **Conservative LTS-only everywhere:** misses the "latest tech" mandate.
