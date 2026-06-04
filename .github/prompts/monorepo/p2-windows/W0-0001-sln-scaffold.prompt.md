---
description: "P2/W0-0001 — WinUI 3 solution + app project on .NET 10"
---

# P2 · W0-0001 — WinUI 3 solution scaffold

> **Severity:** Foundational (P2 root) · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6 workload. If absent → STATUS=BLOCKED (rule 3).

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.sln`, `apps/windows/TeslaSync.App/` (WinUI3, .NET 10) |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | P1/S99 DONE |
| Blocks | all P2 prompts |
| ADR refs | ADR-002, ADR-012 (Windows App SDK 1.6+, .NET 10) |
| Instr refs | `.github/instructions/helm-docker.instructions.md` (n/a), version lock `apps/versions.lock.md` |
| Log | `../logs/p2-w0-0001-sln-scaffold.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create a buildable WinUI 3 app solution targeting .NET 10 + Windows App SDK 1.6+, packaged
(MSIX), with CommunityToolkit.Mvvm wired and the `apps-windows.yml` CI job green.

## Spec

- `dotnet new winui3` (or VS template) → `TeslaSync.App`; TFM `net10.0-windows10.0.<latest SDK>`.
- `Directory.Packages.props` (central package management) pins versions from `apps/versions.lock.md`:
  Microsoft.WindowsAppSDK 1.6+, CommunityToolkit.Mvvm, CommunityToolkit.WinUI.*, the chosen charts
  + map packages (placeholder refs OK if added in W3).
- Enable nullable, implicit usings, `TreatWarningsAsErrors=true`, analyzers (`Microsoft.CodeAnalysis.NetAnalyzers`).
- Native AOT publish profile where viable (note if a dependency blocks AOT).
- App boots to an empty `MainWindow` with a `NavigationView` placeholder (real shell = W4).
  This empty window is the *intended* deliverable here — not a forbidden stub.

## Gate

```powershell
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
"BUILD_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
"FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp *>$null
"PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
"EXIT=$([int]([bool]$LASTEXITCODE))" | Tee-Object $log -Append
```

## Acceptance Criteria

- [ ] Solution builds Release on .NET 10 + Windows App SDK 1.6+.
- [ ] Central package management pins versions from the lock file.
- [ ] Warnings-as-errors + analyzers enabled; `dotnet format --verify` clean.
- [ ] App launches to an empty NavigationView window.
- [ ] `EXIT=0` / `STATUS=DONE` (or BLOCKED with capability reason if SDK absent).

## Out of Scope (reject)

- No pages, no real navigation (W4/W7), no design tokens (W2), no API client (W1).

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w0-0001-sln-scaffold.log
git commit -m "feat(apps/windows): WinUI3 solution on .NET 10 (P2/W0-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
