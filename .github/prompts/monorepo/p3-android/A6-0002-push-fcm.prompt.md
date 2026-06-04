---
description: "P3/A6 — Android FCM registration and notification channels"
---

# P3 · A6 · 0002 — Push notifications (FCM)

> **Severity:** Mobile platform integration · **Delegation:** FORBIDDEN
> Implement Android FCM device registration, token refresh, notification channels, and foreground/background notification handling per ADR-009.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` FCM service, notification channels, registration UI/state |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A4 auth, P3/A5 data layer, backend device-registration contract from shared core |
| Blocks | platform notification parity, widgets/shortcuts notification actions |
| ADR refs | ADR-002, ADR-004, ADR-008, ADR-009, ADR-010, ADR-011, ADR-015, ADR-016 |
| Log | `../logs/p3-a6-0002-push-fcm.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Deliver production-grade Android push plumbing that complements foreground SSE without pretending background streams are reliable.

## Spec

- Integrate Firebase Messaging from the locked version catalog; do not float plugin/library versions.
- Register/refresh FCM device tokens through the shared-core device-registration repository after auth; unregister on sign-out.
- Create Android notification channels for critical alerts, vehicle events, charging, automation, maintenance, system, and quiet/general channels with user-visible descriptions.
- Handle foreground messages with in-app banners/toasts, background messages with system notifications, and notification taps/deep links into the Navigation-Compose graph.
- Respect notification runtime permission (POST_NOTIFICATIONS), quiet-hours/settings state, redacted logs, no VIN/token/precise location in notification text unless the backend explicitly sends safe display text.
- Add tests/fakes for token registration, refresh, sign-out cleanup, channel creation, permission states, payload routing, and deep link intents.

## Implementation steps

1. Survey ADR-009 and shared device-registration contract; log channel taxonomy.
2. Wire FCM service, token registration lifecycle, and sign-out unregister behavior.
3. Implement notification channels, permission request flow, foreground display, background tap routing, and settings integration points.
4. Add unit/Robolectric tests for registration, channel creation, payload parsing, permission denied, and deep links.
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

- [ ] FCM registration/unregistration is tied to auth and shared-core device endpoint.
- [ ] Notification channels are complete, localized, user-visible, and tested.
- [ ] Foreground/background notification flows and deep links are implemented without background SSE.
- [ ] Permission denied/quiet-hour states are handled.
- [ ] Gate green; placeholder scanner clean; `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Backend push fan-out, Firebase project credential provisioning, page-specific notification UIs beyond plumbing.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a6-0002-push-fcm.log
git commit -m "feat(apps/android): add FCM push registration and channels (P3/A6)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
