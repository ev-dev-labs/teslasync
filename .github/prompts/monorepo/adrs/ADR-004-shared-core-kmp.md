# ADR-004 — Kotlin Multiplatform shared core (Android + Apple); generated C# client for Windows

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

ADR-002 keeps UI native per platform. The non-UI logic — API/SSE clients, DTOs, SI unit
conversion, auth/token flow, caching/offline, and presentation (view-model) logic — is
identical across platforms and is the bug-prone part. We want to write it **once**.
KMP compiles Kotlin to JVM (Android), and to native frameworks consumable by Swift
(Apple). It cannot be consumed by C#/.NET (Windows).

## Decision

- **Android + Apple** share a **Kotlin Multiplatform** module `apps/shared/`:
  networking (Ktor), SSE, generated Kotlin models (ADR-003), SI unit conversion +
  formatting, auth + secure-storage *interfaces* (platform-implemented via `expect/actual`),
  cache/offline, and per-feature presentation logic (state holders).
  - Android consumes it as a Gradle module.
  - Apple consumes it as an **`.xcframework`** (exported via KMP, called from Swift).
- **Windows** cannot consume Kotlin, so it gets a **generated C# client** from the same
  OpenAPI spec (ADR-003) plus a thin hand-written C# layer that mirrors the *behavior*
  of the KMP core (units, auth, cache). The OpenAPI contract + a shared **behavior spec**
  (golden test vectors) keep C# and Kotlin in lockstep.

## Consequences

- ✅ ~60–70% of non-UI logic written once and shared by Android + Apple.
- ✅ Windows stays in idiomatic C#/.NET while guaranteed contract-identical via codegen +
  shared golden test vectors (e.g. SI-conversion fixtures both KMP and C# must pass).
- ⚠️ Windows logic is a second implementation (not literal code share). Mitigated by:
  (a) generated client, (b) a language-neutral `apps/shared/spec/` of golden fixtures both
  cores must satisfy, (c) a conformance gate in CI.
- ⚠️ KMP→Swift interop has ergonomic edges; P4 wraps the xcframework in a Swift-friendly facade.

## Alternatives rejected

- **KMP for Windows too:** not supported (no .NET target).
- **Compose Multiplatform incl. desktop for Windows:** rejected by ADR-002 (not Fluent).
- **One core in C# (.NET) shared via .NET MAUI-less bindings:** no first-class Kotlin/Swift
  consumption; worse Android/Apple ergonomics than KMP.
