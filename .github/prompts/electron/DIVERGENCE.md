# DIVERGENCE — Electron app vs ADR-002

> **Status:** Recorded · 2026-06 · Scope: `.github/prompts/electron/` only
> **Relationship to ADR-002:** This effort **knowingly diverges** from
> [ADR-002 — Fully native UI per platform; reject WebView and cross-platform-UI
> frameworks](../monorepo/adrs/ADR-002-native-per-platform.md).

## What ADR-002 says

ADR-002 is **Accepted** and explicitly lists **Electron** under *Alternatives
rejected → WebView wrappers*:

> "WebView wrappers: not native; ship a browser, not an app. Fails the mandate."

The monorepo README repeats this: "Not a WebView wrapper. Tauri / Electron /
Capacitor / Cordova are explicitly rejected (see ADR-002)."

## Why this directory exists anyway

This Electron prompt set was created on **explicit user instruction** to build an
Electron desktop app, with the user unavailable to answer the ADR-002 conflict in
real time. Rather than silently comply (Honesty Covenant rule 9 — "no silent
drift") or silently refuse, the divergence is recorded here so the decision is
auditable and reversible.

The defensible, non-contradictory framing of this work:

1. **Different target, not a replacement.** The native trio (WinUI / Compose /
   SwiftUI per ADR-002) covers Windows, Android, macOS, iOS. It does **not** cover
   **Linux desktop**, nor a single cross-desktop binary. Electron fills that gap
   without removing any native target. ADR-002's mandate ("platform-idiomatic on
   Windows, Android, macOS, iOS") is silent on Linux.
2. **Reuses the existing asset.** Electron embeds the already-built `web/` React
   SPA as its renderer. No third UI codebase is created; the desktop work is the
   shell + OS chrome + packaging, not a UI rewrite.
3. **Isolated + non-destructive.** All artifacts live under
   `.github/prompts/electron/` and a new `apps/electron/`. No native prompt, ADR,
   manifest, or ledger under `.github/prompts/monorepo/` or `apps/parity/` is
   modified. Progress ledgers are written under `electron/ledgers/`.

## What this divergence does NOT claim

- It does **not** supersede ADR-002. The native-per-platform decision stands for
  Windows/Android/macOS/iOS.
- It does **not** make Electron the recommended path for the platforms ADR-002
  already covers. If a user opens TeslaSync on Windows, the WinUI app (ADR-002) is
  still the intended first-class experience.

## To formalize or reverse

- **Formalize:** promote this to a real ADR (e.g. `ADR-017 — Electron for Linux /
  cross-desktop, as an addition to ADR-002`) with PA/PE sign-off, scoping it to
  Linux + dev/preview use.
- **Reverse:** delete `.github/prompts/electron/` and `apps/electron/`. Nothing
  else depends on them.
