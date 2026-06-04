# Apple Version Lock (ADR-012)

> Source of truth: `apps/versions.lock.md`. Placeholders below are finalized/wired
> by the first Apple build prompt (P0-0001-sln-scaffold equivalent). Swift Charts and
> MapKit are SDK-bundled and tracked by the Xcode/Swift toolchain rather than pinned
> independently. Renovate keeps patch versions current; major bumps require a
> superseding ADR.

| Tool | Locked baseline |
|---|---|
| Xcode | 26 |
| Swift | 6.0.1 (strict concurrency) |
| SwiftUI | SDK-bundled (Xcode 26) |
| Swift Charts | SDK-bundled (Xcode 26) |
| MapKit | SDK-bundled (Xcode 26) |
| swift-openapi-generator | 1.2.0 |
