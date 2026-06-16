---
description: "Electron desktop app — loop-driven prompt set (foundation → integration → desktop parity → hardening) at full web parity"
---

# electron — TeslaSync Electron Desktop App (loop-driven)

## What this is

A **loop-based** execution plan that builds a TeslaSync **Electron desktop app**
(`apps/electron/`) to full parity with the web SPA. Unlike
`.github/prompts/monorepo/` (which has 879 one-shot prompts per native platform),
this effort is expressed as **a handful of loops**: a manifest/ledger is the source
of truth, and one fresh agent implements one unit per iteration until the ledger is
100% `done`. This survives context compaction and cannot fake completion.

> ⚠️ **Reads before you run:** [`DIVERGENCE.md`](./DIVERGENCE.md) — Electron is
> explicitly rejected by ADR-002. This directory diverges on explicit user
> instruction and records why. The native apps (WinUI / Compose / SwiftUI) remain
> the first-class experience per ADR-002.

## Why loops (vs one-shot prompts)

| One-shot (monorepo) | Loop (here) |
|---|---|
| 879 generated `.prompt.md` per platform | 4 loop prompts + 1 driver |
| Manifest↔prompt can drift | Loop reads the manifest live — zero drift |
| No built-in retry | `attempts` / `blocked` / circuit-breaker built in |
| Gates can't see pixels | Adds a **visual gate** (screenshot vs live web) |
| Re-derive progress from many logs | Re-derive from one ledger on disk |

The proven reference is `.github/prompts/monorepo/windows-parity-loop.ps1`; this set
generalizes that pattern to Electron and to **all phases**, not just UI parity.

## The Electron difference

Electron **embeds the existing `web/` React SPA** as its renderer. Page content
("panels", "charts", "strings") therefore comes for free from the web build, so the
parity loop runs at **route / surface** granularity, not the 1,754 panel-level units
the native apps need. The real work is the **desktop shell**:

- main process, preload (contextIsolation + sandbox), typed IPC, CSP/security
- desktop chrome: native menus, system tray, dock/taskbar badge, OS notifications,
  jump lists, auto-update UI, custom title bar, global shortcuts
- integration: load the SPA, OIDC desktop auth, secure token storage, SSE, deep links
- packaging/signing/notarization/auto-update per OS (Windows / macOS / Linux)

## Phases

| Phase | Loop prompt | Spec (units) | Target |
|---|---|---|---|
| **E0** Foundation | `e0-foundation-loop.prompt.md` | `units/e0-foundation-units.json` | scaffold `apps/electron`, main/preload/IPC, security, build, CI |
| **E1** Integration | `e1-integration-loop.prompt.md` | `units/e1-integration-units.json` | embed SPA, OIDC auth, token storage, SSE, deep links, window state |
| **E2** Desktop parity | `e2-desktop-parity-loop.prompt.md` | 143 page-units + 708 surface-units + 9 chrome + `units/e2-desktop-chrome-units.json` | every route renders in the desktop shell + desktop chrome |
| **E5** Hardening | `e5-hardening-loop.prompt.md` | `units/e5-hardening-units.json` | packaging, signing, auto-update, e2e, perf, a11y, security, GA |

> Build order: **E0 → E1 → E2 → E5**. Each phase's first iteration verifies the
> previous phase's ledger is complete (Honesty Covenant rule 7).

## Coverage ("all prompts")

The E2 loop's combined spec is assembled live from:

```
143  page-units            (.github/prompts/monorepo/parity/page-units.json)
708  surface-units         (.github/prompts/monorepo/parity/surface-units.json)
  9  web chrome-units      (apps/parity/parity-chrome-units.json)
 15  electron-desktop chrome (units/e2-desktop-chrome-units.json)
----
875  rows in → 865 unique units (the loop de-dupes 10 surfaces whose
     tier+slug repeat across feature dirs, e.g. LoadingSkeleton, ConfirmDialog,
     HeroGauges — implemented once, rendered everywhere by the embedded SPA)
```

Phase totals reported by `-CountOnly`: **E0 = 9, E1 = 9, E2 = 865, E5 = 12**
(895 units total — the entire web surface plus every desktop-native surface).

Verify the count any time without running an agent:

```powershell
pwsh .github/prompts/electron/electron-loop.ps1 -Phase e2 -CountOnly
```

## How to run

```powershell
# One phase, until its ledger is 100% done:
pwsh .github/prompts/electron/electron-loop.ps1 -Phase e0

# All phases in order (E0 → E1 → E2 → E5), gated:
pwsh .github/prompts/electron/run-electron-loops.ps1

# Smoke test (5 units of one phase):
pwsh .github/prompts/electron/electron-loop.ps1 -Phase e2 -MaxUnits 5

# Re-verify previously-"done" rows against the visual gate:
pwsh .github/prompts/electron/electron-loop.ps1 -Phase e2 -Audit

# Graceful stop:
New-Item .github/prompts/electron/ledgers/STOP-electron-loop
```

Alternatively, paste a phase's `*-loop.prompt.md` into a running Copilot session to
run the loop manually (same contract, no PowerShell driver).

## Files

```
electron/
  README.md                       ← you are here
  DIVERGENCE.md                   ← ADR-002 divergence record (read first)
  0000-methodology.prompt.md      ← Honesty Covenant + loop contract + log/gate/parity spec
  electron-loop.ps1               ← parametric loop driver (-Phase e0|e1|e2|e5)
  run-electron-loops.ps1          ← orchestrator: E0 → E1 → E2 → E5
  capture-window.ps1              ← screenshot helper (visual gate)
  e0-foundation-loop.prompt.md
  e1-integration-loop.prompt.md
  e2-desktop-parity-loop.prompt.md
  e5-hardening-loop.prompt.md
  units/                          ← authored unit specs (exact, not "figure it out")
    e0-foundation-units.json
    e1-integration-units.json
    e2-desktop-chrome-units.json
    e5-hardening-units.json
  ledgers/                        ← progress ledgers (written by the driver) + STOP sentinel
  logs/                           ← per-unit agent logs
```

## Honesty Covenant (binding — see `0000-methodology.prompt.md` for the full text)

`done` requires green gates **AND** `coveredCount == requiredCount` **AND** (for E2)
`visualScore >= 95` with a real screenshot on disk. A gate that cannot run on this
host (e.g. macOS notarization on a Windows runner) is `blocked`, never `done`. An
empty ledger is **not** "complete".
