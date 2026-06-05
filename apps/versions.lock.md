# Version Lock (ADR-012) — verify each at execution time against vendor channels

| Area | Tool | Locked baseline |
|---|---|---|
| Shared | Kotlin | 2.4.0 |
| Shared | Gradle | 8.14.5 |
| Shared | Ktor | 3.5.0 |
| Shared | kotlinx.serialization / datetime | 1.11.0 / 0.7.0 |
| Shared | SQLDelight | 2.3.2 |
| Android | Compose BOM | 2026.04.01 |
| Android | Material 3 | 1.4.0 (Expressive) |
| Android | AGP | 8.9.2; minSdk 26; targetSdk 36 (KGP for Kotlin 2.4.0 requires AGP >= 8.5.2) |
| Android | Vico (charts) | 2.0.0 |
| Windows | Windows App SDK | 2.1.3 |
| Windows | .NET | 10 (LTS) |
| Windows | CommunityToolkit.Mvvm / WinUI | 8.2.1 / WinUI (Windows App SDK 2.1.3) |
| Apple | Xcode / SwiftUI | Xcode 26 (SwiftUI SDK-bundled) |
| Apple | Swift | 6.0.1 (strict concurrency) |
| Apple | Swift Charts / MapKit | SDK-bundled |
| Contract | OpenAPI | 3.1 |
| Contract | Generators | openapi-generator 7.6.0 (kotlin), NSwag 14.7.1 / Kiota 1.24.0 (c#), swift-openapi-generator 1.2.0 |

> Renovate keeps patch versions current; major bumps require a superseding ADR.
