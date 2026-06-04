# ADR-010 — Testing strategy + quality gates per platform

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

"Proper work, no sloppy work" must be enforced mechanically. Four toolchains each have a
native test + lint + analyzer stack. Gates must be uniform in *intent* while native in *tooling*.

## Decision

Each platform prompt's gate (per methodology) runs the platform-native triad — **build +
analyzer/lint (strict) + tests** — and captures `EXIT=`:

| Layer | Shared (KMP) | Windows | Android | Apple |
|---|---|---|---|---|
| Build | `gradlew :shared:build` | `dotnet build -c Release` | `gradlew assembleDebug` | `xcodebuild build` |
| Lint/format | ktlint/detekt | `dotnet format --verify` + WinUI analyzers | ktlint/detekt + Android Lint | SwiftLint --strict + SwiftFormat --lint |
| Unit tests | `gradlew :shared:test` (kotlin.test) | `dotnet test` (xUnit) | `gradlew test` (JUnit) | `xcodebuild test` (XCTest) |
| UI tests | — | WinAppDriver / UI tests | Compose UI test / Espresso | XCUITest |
| Contract | generated-client ⇄ live API | same | same | same |
| Golden vectors | SI-conversion fixtures | must pass same fixtures (ADR-004) | shares KMP | shares KMP |

**Coverage target:** ≥80% on shared core + per-platform presentation/logic. Snapshot/UI
tests cover each parity unit's loading/empty/error states. A prompt that cannot run its
gate (missing SDK/device/runner) is **BLOCKED**, never DONE.

## Consequences

- ✅ Uniform quality bar; polish (lint strict) is part of the gate, not optional.
- ✅ Golden SI fixtures keep C# and Kotlin numeric behavior identical (ADR-004).
- ⚠️ Apple gates require **macOS CI runners**; Windows gates require Windows runners — the CI
  matrix (P0) provisions both; local-only authors mark device-bound gates BLOCKED with reason.
- ⚠️ UI tests are slower; P5 separates fast (PR) vs. full (nightly) suites.

## Alternatives rejected

- **Manual QA only:** not repeatable at this scale.
- **One cross-platform test framework:** none covers native WinUI+Compose+SwiftUI well.
