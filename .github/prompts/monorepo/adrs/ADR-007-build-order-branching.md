# ADR-007 — Build/release order (Shared → Windows → Android → Apple) + branch strategy

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

Four platforms, one shared core. We need an order that de-risks the contract before any
UI is built, and a branch model that keeps a multi-month effort reviewable.

## Decision

**Program order:** P0 Foundation → **P1 Shared** → **P2 Windows** → **P3 Android** →
**P4 Apple** → P5 Hardening. Rationale:

- P1 first: freeze the OpenAPI contract + shared core so all UIs build on stable ground.
- Windows next (user choice): exercises the generated **C# client** path early — the only
  platform *not* on KMP — surfacing contract gaps before two KMP UIs are built.
- Android, then Apple: both ride the KMP core; Apple last bundles macOS + iOS via SwiftUI.

P2/P3/P4 **may overlap** once P1 is `STATUS=DONE`, but each platform's first prompt has a
hard `Depends on: P1 frozen`.

**Branch strategy:** fork all work from `main`.

| Branch | Scope |
|---|---|
| `feat/monorepo-foundation` | P0 (ADRs already merged as docs; scaffold + CI) |
| `feat/apps-shared` | P1 shared core + OpenAPI |
| `feat/apps-windows` | P2 (forks from `feat/apps-shared` once frozen) |
| `feat/apps-android` | P3 |
| `feat/apps-apple` | P4 |

Each program merges to `main` behind path-filtered CI before the next depends on it.
Per-platform release tags: `windows-vX`, `android-vX`, `apple-vX`.

## Consequences

- ✅ Contract risk retired first; the non-KMP platform validates the contract early.
- ✅ Clear review boundaries; path-filtered CI keeps PRs fast.
- ⚠️ Apple ships last — acceptable; macOS+iOS share the SwiftUI codebase so P4 is efficient.
- ⚠️ Overlapping P2–P4 needs the P1 contract truly frozen; contract changes after freeze
  require a superseding ADR + coordinated regen across started platforms.

## Alternatives rejected

- **All platforms in parallel from day one:** thrash on an unfrozen contract.
- **Mobile-first (Android/iOS before Windows):** delays validating the only non-KMP client.
