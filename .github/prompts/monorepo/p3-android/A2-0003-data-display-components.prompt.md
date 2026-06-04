---
description: "P3/A2 — Android data-display components mirroring web components/data-display"
---

# P3 · A2 · 0003 — Compose data-display components

> **Severity:** Foundation UI (blocks telemetry and analytics pages) · **Delegation:** FORBIDDEN
> Implement Android-native metrics, badges, timelines, freshness, playback, and visualization components matching the web data-display category.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**/components/datadisplay/**` |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1, P3/A2-0001, P3/A2-0002 for chart-adjacent widgets |
| Blocks | Android page prompts using metrics, status, timelines, playback, and car visualizations |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-010, ADR-011, ADR-013, ADR-015 |
| Log | `../logs/p3-a2-0003-data-display-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Provide complete Compose data-display primitives for page prompts to bind real KMP state without duplicating UI patterns.

## Spec

Implement equivalents for the web `components/data-display` inventory:
- Metrics: `StatCard`, `MetricCard`, `MetricBar`, `InlineMetric`, `KpiOverviewCard`, `UsageCard`, `ProgressRing`, `AnimatedNumber`, `BatteryDelta`, `Delta`.
- Identity/status: `Avatar`, `UserCell`, `StatusBadge`, `StatusDot`, `StatusBadge` variants, `SeverityBadge`, `ScoreBadge`, `FSMBadge`, `SourceLayerBadge`, `FreshnessIndicator`, `DataFreshness`, `LiveIndicator`, `ServiceStatus`.
- Lists/timelines/playback: `KVList`, `DateGroupedList`, `HistoryListRow`, `Timeline`, `TimelineItem`, `TimelineScrubber`, `PlaybackControls`, `PlaybackSpeedMenu`, `RecentActivityFeed`, `RouteDisplay`, `TransitionArrow`.
- Domain visuals/actions: `DriveScore`, `TeslaCarViz`, `ComparisonHeader`, `BulkActionToolbar`, `SavedViewMenu`, `PollingEngine` state display.
All components must support loading/empty/error where appropriate, `fetched_at` freshness, stale labels (>2 minutes), and TalkBack semantics.

## Implementation steps

1. Survey the web category and document every component mapping/merge in the log.
2. Implement stateless composables with stable data models and tokenized colors/typography.
3. Implement freshness and stale/offline indicators aligned to ADR-013.
4. Add tests/previews for nominal, loading, empty, error, stale, selected, and disabled states.
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

- [ ] Every listed data-display primitive is implemented or intentionally merged into a named Android equivalent with no loss of capability.
- [ ] Freshness and stale/offline states are visible and accessible.
- [ ] Tests cover metric, badge, timeline, playback, and freshness behavior.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Forms, maps, motion, page-specific business logic, and API calls.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a2-0003-data-display-components.log
git commit -m "feat(apps/android): add Compose data-display components (P3/A2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
