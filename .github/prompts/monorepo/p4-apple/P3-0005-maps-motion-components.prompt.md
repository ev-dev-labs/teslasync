---
description: "P4/P3 — Apple MapKit and motion component library"
---

# P4 · P3 · 0005 — Maps and motion components

> **Severity:** Foundation (blocks map/replay Apple pages) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Implement MapKit wrappers and motion primitives mirroring web `components/maps` and
> `components/motion`, honoring Apple HIG, accessibility, and Reduce Motion.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Components/Maps/`, `apps/apple/TeslaSync/Components/Motion/` |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P3-0001 UI, P4/P3-0003 data-display, P4/P2 design tokens |
| Blocks | map pages, trip replay, vehicle location, P9 UI tests |
| ADR refs | ADR-002, ADR-005, ADR-010, ADR-011, ADR-013, ADR-015 |
| Log | `../logs/p4-p3-0005-maps-motion-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create native MapKit and motion primitives that cover every web maps/motion export without
falling back to web map behavior or custom animation hacks.

## Spec

Implement concrete components:

- **Maps:** `TSMapView`, `TSMapLayerSwitcher`, `TSMapTileLayer` equivalent using MapKit styles,
  `TSMapInvalidator` equivalent for camera refresh, `TSAnimatedMarker`, `TSVehicleAnnotation`,
  `TSMarkerCluster`, `TSGeofenceDrawer`, `TSRoutePlayback`, `TSPolyline`, `TSCircleMarker`,
  `TSCircle`, `TSRectangle`, `TSFeatureGroup`, `TSMapCallout`.
- **Geospatial helpers:** region/bounds fitting, coordinate validation, route coloring, geofence
  descriptions, route playback interpolation, current-vehicle tracking, stale-position indicator.
- **Motion:** `TSFadeIn`, `TSStaggerContainer`, `TSStaggerItem`, `TSRouteTransition`,
  `TSCarAnimation`; all honor Reduce Motion and use SwiftUI transactions/animations.
- **Accessibility:** maps have labels, callouts, list alternatives for pins/routes, and VoiceOver
  summaries of route distance/duration/status.
- **Platform behavior:** pointer hover/click on macOS, touch gestures on iOS, iPad split-screen safe sizing.

## Implementation steps

1. Survey `web/src/components/maps/index.ts` and `motion/index.ts`; log one-to-one mappings.
2. Implement MapKit wrappers with reusable typed annotations, overlays, geofence drawing, clustering,
   and route playback controls.
3. Implement motion primitives with tokenized durations/easing and Reduce Motion fallbacks.
4. Add previews and tests for camera fitting, coordinate validation, overlay generation, route playback,
   clustering grouping, and Reduce Motion behavior.
5. Run the full Apple gate on iOS Simulator and macOS.

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/LINT/FORMAT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] Every maps/motion export listed above has a native MapKit/SwiftUI equivalent.
- [ ] Routes, clusters, geofences, annotations, callouts, and playback are functional and accessible.
- [ ] Motion respects Reduce Motion and never blocks data/state rendering.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Page-specific map data binding and backend location changes.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p3-0005-maps-motion-components.log
git commit -m "feat(apps/apple): add MapKit and motion components (P4/P3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
