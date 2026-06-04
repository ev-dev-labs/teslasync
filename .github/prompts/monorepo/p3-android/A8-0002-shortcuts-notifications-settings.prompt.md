---
description: "P3/A8 — Android app shortcuts, notification actions, settings polish"
---

# P3 · A8 · 0002 — Shortcuts, notifications, settings polish

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> Add Android app shortcuts, notification action/deep-link polish, edge-to-edge settings, per-app language, haptics, and Material 3 settings UX.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` shortcuts, notification actions, settings integration |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A3, P3/A4, P3/A6-0002, A7 generated settings pages where available |
| Blocks | Android release readiness and A99 acceptance |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-015, ADR-016 |
| Log | `../logs/p3-a8-0002-shortcuts-notifications-settings.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Finish Android platform integrations that make the app feel first-class: launcher shortcuts, actionable notifications, native settings, haptics, language, and privacy controls.

## Spec

- Static/dynamic app shortcuts for dashboard, vehicles, charging, live map, commands, notifications, search; each deep-links through A3 routes.
- Notification actions for alert acknowledge/open, charging session open, command history open, quiet-hours/settings open; obey auth/lock-state safeguards.
- Settings polish: Material 3 preferences for theme/dynamic color/density, notification permissions/channels, language, analytics/crash opt-in (ADR-016), secure sign-out, cache/offline controls, reduce motion, haptics.
- Edge-to-edge/system bars, keyboard insets, predictive back polish, app-update/release notes hooks, Play review-safe privacy text.
- Per-app language via AndroidX AppCompat/locales or platform-supported APIs while respecting shared string catalog.

## Implementation steps

1. Survey web settings/nav and existing Android shell/auth/push integration; log shortcut/action matrix.
2. Implement shortcuts with icons, labels, deep links, and tests for intents.
3. Implement notification actions and guarded deep-link routing.
4. Implement settings screens/sections using A2 forms/feedback components and platform APIs.
5. Add tests for shortcuts, notification actions, settings persistence, language/theme toggles, and privacy opt-out; run gate.

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

- [ ] Shortcuts and notification actions are complete, localized, accessible, and route correctly.
- [ ] Settings cover theme/dynamic color, density, notifications, language, privacy/telemetry opt-in, cache, sign-out, reduce motion, and haptics.
- [ ] Edge-to-edge/insets/predictive back polish is verified.
- [ ] Gate green; placeholder scanner clean; `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Widgets, Wear OS companion, backend push provider configuration, store listing assets.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a8-0002-shortcuts-notifications-settings.log
git commit -m "feat(apps/android): add shortcuts notifications and settings polish (P3/A8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
