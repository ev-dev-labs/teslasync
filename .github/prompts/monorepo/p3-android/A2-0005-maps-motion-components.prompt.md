---
description: "P3/A2 — Android Maps Compose and motion component libraries"
---

# P3 · A2 · 0005 — Maps + motion components

> **Severity:** Foundation UI (blocks map, route, and animated page prompts) · **Delegation:** FORBIDDEN
> Build Google Maps Compose wrappers and Material motion primitives corresponding to web `components/maps` and `components/motion`.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**/components/maps/**`, `apps/android/**/components/motion/**` |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1, P3/A2-0001, P3/A2-0003 |
| Blocks | map/location/driving pages, transitions, page animations |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-009, ADR-010, ADR-011, ADR-015 |
| Log | `../logs/p3-a2-0005-maps-motion-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Provide complete native maps and motion primitives for Android pages with accessible fallbacks and reduced-motion support.

## Spec

Maps via Google Maps Compose:
- `MapTileLayer` equivalent with selectable map styles/layers, Google Maps style JSON from tokens, traffic/transit toggles where available.
- `MapLayerSwitcher`, `MarkerCluster`, `AnimatedMarker`, `RoutePlayback`, `GeofenceDrawer`, vehicle icon rendering, route polylines, bounds fitting, camera state restoration.
- Accessible map summary/list alternative for markers/routes/geofences and content descriptions for controls.
Motion via Compose Animation / Material motion:
- `FadeIn`, `StaggerContainer`, `StaggerItem`, `RouteTransition`, `CarAnimation` equivalent.
- Honor system animator scale / reduced motion; provide deterministic test clocks and no infinite battery-draining animations.
No Leaflet/web artifacts; use Maps Compose from the locked catalog.

## Implementation steps

1. Survey web maps and motion components and record mapping decisions.
2. Implement stateless map wrappers with hoisted camera/selection/layer state and tokenized styling.
3. Implement motion primitives using Compose animation APIs and reduced-motion checks.
4. Add tests/previews/fakes for map controls, route playback state, marker lists, and motion toggles.
5. Run the gate.

## Gate

```powershell
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug 2>&1 | Tee-Object $log -Append; "ASM_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:lintDebug ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if all *_EXIT values are 0 and the placeholder scanner is clean
```

## Acceptance Criteria

- [ ] Maps Compose wrappers cover layers, clusters, markers, routes, geofences, playback, icons, and accessible summaries.
- [ ] Motion components honor reduced motion and use native Compose animation primitives.
- [ ] No direct map/chart imports required from pages; component library owns them.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Page-specific map data, backend geocoding, live data subscriptions, and Wear widgets.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a2-0005-maps-motion-components.log
git commit -m "feat(apps/android): add Maps Compose and motion components (P3/A2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
