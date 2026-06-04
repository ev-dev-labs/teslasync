# ADR-002 — Fully native UI per platform; reject WebView and cross-platform-UI frameworks

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

The mandate is a *flawless, platform-idiomatic* experience on Windows, Android, macOS,
and iOS, optimized for the **long term**, resources no object. We evaluated four
families of approach for the **UI layer**:

1. **WebView wrappers** — Tauri 2, Electron, Capacitor, Cordova.
2. **Cross-platform UI frameworks** — Flutter, .NET MAUI, React Native, Compose
   Multiplatform (UI).
3. **Fully native per platform** — WinUI 3 (Fluent), Jetpack Compose (Material 3),
   SwiftUI (HIG).
4. Hybrid: native UI + a shared non-UI core.

## Decision

Build the **UI fully native on each platform** and share only non-UI logic (ADR-004):

| Platform | UI | Design language |
|---|---|---|
| Windows | WinUI 3 / Windows App SDK | Fluent |
| Android | Jetpack Compose | Material 3 (Expressive) |
| macOS / iOS / iPadOS | SwiftUI | Apple HIG |

The user explicitly required Windows→Microsoft guidelines, Android→Google guidelines,
iOS→Apple guidelines. That is only fully achievable with each platform's first-party
toolkit.

## Consequences

- ✅ Best-in-class UX, newest-OS features day one (live activities, App Intents, widgets,
  jump lists, Material You), real native charts/maps, native a11y.
- ✅ **Lowest long-term framework risk**: we depend only on Apple/Google/Microsoft
  maintaining their own toolkits — never on a single third-party framework's survival.
- ✅ Per-platform UI can evolve independently without collateral damage.
- ⚠️ Three UI codebases + three skill sets (C#, Kotlin, Swift). Mitigated by ADR-004
  (KMP shared core removes duplicated logic) and ADR-006 (one parity manifest drives all).
- ⚠️ More upfront effort — explicitly accepted by the mandate.

## Alternatives rejected

- **WebView wrappers:** not native; ship a browser, not an app. Fails the mandate.
- **Flutter / MAUI / RN / Compose-MP-UI:** each trades platform fidelity for code
  sharing and adds single-vendor framework risk (cf. Xamarin→MAUI churn). Compose
  Multiplatform UI is stable on iOS as of 1.8.0 but renders Skia, not Fluent/HIG —
  it cannot honor three native design languages simultaneously.
