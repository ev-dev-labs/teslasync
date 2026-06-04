---
description: "P4/P6 — Apple APNs notifications and Live Activities"
---

# P4 · P6 · 0002 — APNs notifications and Live Activities

> **Severity:** Feature foundation · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode and Apple signing/APNs entitlements; if the gate can't run → STATUS=BLOCKED.
> Implement APNs registration, notification handling, foreground presentation, and appropriate
> Live Activities for charging/drive/command status per ADR-009.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Notifications/`, APNs entitlements, Live Activity extension if needed |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P5 auth, P4/P6-0001 live data, device-registration contract from shared core |
| Blocks | P8 widgets/settings, notification pages, P99 acceptance |
| ADR refs | ADR-002, ADR-004, ADR-008, ADR-009, ADR-010, ADR-011, ADR-014, ADR-015, ADR-016 |
| Log | `../logs/p4-p6-0002-push-notifications.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Deliver complete Apple push infrastructure: APNs token registration, device registration with
TeslaSync, foreground/background notification routing, settings, and Live Activities where apt.

## Spec

- **APNs registration:** request authorization with clear localized rationale; register/unregister
  device token; post token to shared `/devices` registration API through facade; refresh on token changes.
- **Notification routing:** handle alerts, charging events, command results, automation alerts, security
  events, quiet-hours, and deep-link navigation from notification payloads.
- **Foreground UX:** in-app banners/toasts integrate with feedback components; notification center state syncs
  with shared notification repositories.
- **Live Activities:** implement ActivityKit for ongoing charging, active drive/trip replay status, and command
  execution where available; graceful no-op on macOS/unsupported OS versions without placeholder UI.
- **Settings:** notification permission state, categories, quiet hours, critical alert eligibility (if configured),
  and privacy copy; all localized.
- **Security/observability:** no token/PII logging; redacted registration diagnostics.

## Implementation steps

1. Survey ADR-009 and notification-related web routes/components; log categories and deep links.
2. Add APNs entitlements/capabilities, registration coordinator, device API binding, and token lifecycle tests.
3. Implement notification payload parser, deep-link router integration, foreground presentation, and settings models.
4. Add ActivityKit extension/models for charging/drive/command activities with tests and availability guards.
5. Add XCUITest coverage for permission flows using test seams and notification deep-link routing.
6. Run the full Apple gate on iOS Simulator and macOS.

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

- [ ] APNs token lifecycle registers/unregisters with TeslaSync and handles permission changes.
- [ ] Notification payloads route to correct pages/deep links; foreground UI and settings are complete.
- [ ] Live Activities are implemented where supported and unavailable platforms degrade honestly.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no signing/APNs/macOS/Xcode runner).

## Out of Scope

Backend push provider implementation, store privacy submissions, and page parity work.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p6-0002-push-notifications.log
git commit -m "feat(apps/apple): add APNs notifications and Live Activities (P4/P6)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
