---
description: "P2/W8-0003 — Windows widgets and live tile applicability"
---

# P2 · W8-0003 — Widgets and Live Tiles applicability

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+ and widget/tile capable package identity; if APIs are unavailable on the runner, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Platform/Widgets/**`, widget/tile manifests/services/tests if applicable |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W5-0001 DONE, W6-0001 DONE, W8-0002 DONE |
| Blocks | W99 acceptance |
| ADR refs | ADR-002, ADR-005, ADR-009, ADR-011, ADR-013, ADR-015, ADR-016 |
| Instr refs | Microsoft Windows Widgets and tile guidelines; version lock `apps/versions.lock.md` |
| Log | `../logs/p2-w8-0003-widgets-live-tiles.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Evaluate and implement applicable Windows ambient surfaces (Widgets and Live Tiles where supported) using real cached/live TeslaSync data, or produce a BLOCKED/NOT-APPLICABLE log only when the current Windows App SDK/store APIs make them unavailable.

## Spec

- Implement Windows Widgets if supported by the pinned Windows App SDK/package model: vehicle status, charge state, range, live/stale marker, last update, and quick actions/deep links.
- Implement Live Tile updates only if applicable to the target Windows packaging/API baseline; Windows 11 Start no longer supports classic Live Tiles for most apps, so do not invent unsupported features. If unsupported, log the Microsoft API reason and keep status BLOCKED/NOT-APPLICABLE for tile sub-scope while completing widget work.
- Use W5 cache for instant widget content and W6 live freshness when foreground-capable; never keep background SSE for widget updates.
- Respect privacy settings: hide VIN/location by default, honor analytics/notification toggles, and show stale/offline labels.
- Add package manifest extensions/capabilities only when supported and required.
- Add tests/fakes for widget data projection, stale/offline rendering, deep links, and privacy redaction.

## Implementation steps

1. Verify W5/W6/W8-0002 are DONE.
2. Survey current Microsoft widget/tile API availability for packaged WinUI 3 under the pinned Windows App SDK.
3. Log an explicit applicability decision for Widgets and Live Tiles before coding.
4. Implement supported ambient surfaces using real repository/cache data and route deep links.
5. If Live Tiles are unsupported, do not stub them; record the API limitation and gate that sub-scope as not applicable/BLOCKED while preserving complete widget implementation.
6. Run gate and include `WIDGETS_STATUS` and `LIVE_TILES_STATUS` markers.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w8-0003-widgets-live-tiles.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('Widget','Stale','DeepLink','Privacy','WIDGETS_STATUS','LIVE_TILES_STATUS')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml,*.xml,*.appxmanifest | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_WIDGET_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$widgetsStatus = if ($missing.Count -eq 0) { 'DONE' } else { 'BLOCKED' }
$liveTilesStatus = if ($all -match 'LiveTileUnsupportedByWindows11') { 'NOT_APPLICABLE' } elseif ($all -match 'LiveTile') { 'DONE' } else { 'BLOCKED' }
"WIDGETS_STATUS=$widgetsStatus" | Tee-Object $log -Append
"LIVE_TILES_STATUS=$liveTilesStatus" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0) -or ($widgetsStatus -eq 'BLOCKED') -or ($liveTilesStatus -eq 'BLOCKED'))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Applicability decision for Widgets and Live Tiles is logged with API evidence.
- [ ] Supported ambient surfaces use real cache/repository data with stale/offline/privacy states.
- [ ] Deep links route through W3 registry.
- [ ] No unsupported Live Tile feature is faked or stubbed.
- [ ] Build, format, test, placeholder, and widget-marker gates are green or BLOCKED only for missing platform capability.

## Out of Scope

- No background SSE workaround.
- No backend push changes.
- No store submission assets beyond package manifest entries needed for supported APIs.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w8-0003-widgets-live-tiles.log
git commit -m "feat(apps/windows): add widget ambient surfaces (P2/W8-0003)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
