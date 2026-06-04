---
description: "P2/W2-0005 — WinUI maps and motion components"
---

# P2 · W2-0005 — Maps, layout, motion, and vehicle components

> **Severity:** Foundational component library · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Components/Maps/**`, `Motion/**`, `Layout/**`, `Vehicles/**`, `A11y/**` |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE, W2-0001 DONE, W2-0003 DONE, W2-0004 DONE |
| Blocks | W3 shell, W7 map/vehicle pages, W9 tests |
| ADR refs | ADR-002, ADR-005, ADR-011, ADR-012, ADR-015 |
| Instr refs | version lock `apps/versions.lock.md`; web sources `web/src/components/maps/`, `motion/`, `layout/`, `vehicles/`, `a11y/` |
| Log | `../logs/p2-w2-0005-maps-motion-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement native Windows map, motion, layout, vehicle, and accessibility primitives that complete the shared component library required by generated page prompts.

## Spec

Implement these concrete components:
- Maps: `TsMapControl` wrapper using a pinned native Windows map option from `apps/versions.lock.md` (MapControl/WebView2 only if explicitly pinned and justified), `TsMapLayerSwitcher`, `TsMapTileLayer`, `TsMapInvalidator`, `TsAnimatedMarker`, `TsMarkerCluster`, `TsGeofenceDrawer`, `TsRoutePlayback`, polyline/marker/circle/rectangle abstractions, accessible coordinate/route summaries.
- Motion: `TsFadeIn`, `TsRouteTransition`, `TsStaggerContainer`, `TsStaggerItem`, `TsCarAnimation`, all honoring Windows reduce-motion settings.
- Layout: `TsPageContainer`, `TsPageHeader`, `TsPageHeaderSticky`, `TsBreadcrumbs`, `TsStack`, `TsGrid`, `TsCopyLinkButton`, `TsPrefetchLink`, `TsVehiclePicker`, `TsStatusBar`.
- Vehicle: `TsVehicleHeroCard`, `TsVehicleTwin`, `TsVehiclePaintPicker` using real bound vehicle state and tokenized styling.
- Accessibility: `TsVisuallyHidden`, `TsAnnouncerRegion`, route-announcement helper for W3.
- Status surfaces if not already covered: `TsStatusHero`, `TsStickyChipBar`, `TsStickyCompactHero`, `TsHealthRow`, `TsActionItemsPanel`, `TsResourcesPanel`, `TsUptimeHeatmap`.

## Implementation steps

1. Verify predecessors are DONE.
2. Survey web category barrels and Windows package pins; choose only pinned native map/chart/motion dependencies.
3. Implement map abstractions with no API keys committed; keys/config must flow through existing settings/config surfaces.
4. Implement motion with `ConnectedAnimationService`/composition animations where appropriate, disabled when reduce-motion is on.
5. Implement layout primitives using WinUI panels and W1 typography/spacing tokens.
6. Add tests for route playback, map empty/error states, reduced-motion behavior, and a11y summaries.
7. Run the full gate.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w2-0005-maps-motion-components.log"
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
$required = @('TsMapControl','TsMapLayerSwitcher','TsRoutePlayback','TsFadeIn','TsPageContainer','TsPageHeader','TsVehicleHeroCard','TsVehicleTwin','TsAnnouncerRegion')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_MAP_MOTION_COMPONENTS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Maps, motion, layout, vehicle, a11y, and status primitives listed above exist.
- [ ] Maps use real data bindings and accessible summaries; no committed API keys.
- [ ] Motion honors reduce-motion settings.
- [ ] Layout/vehicle components use W1 tokens and native WinUI controls.
- [ ] Build, format, test, placeholder, and inventory gates are green.

## Out of Scope

- No page implementations.
- No unpinned map packages or web-only map code.
- No fake map screenshots or static vehicle drawings as final deliverables.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w2-0005-maps-motion-components.log
git commit -m "feat(apps/windows): add maps motion and layout components (P2/W2-0005)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
