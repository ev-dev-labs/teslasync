---
description: "P2/W6-0002 — Windows WNS push registration and notification binding"
---

# P2 · W6-0002 — WNS push registration and notification binding

> **Severity:** Push foundational · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+ and WNS-capable package identity; if no runner/package identity exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Push/**`, notification registration services, package manifest capabilities/tests |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W4-0001 DONE, W5-0001 DONE, W6-0001 DONE; backend `/api/v1/devices` contract available from P1 |
| Blocks | W8 notifications/platform polish, W7 notification pages |
| ADR refs | ADR-003, ADR-008, ADR-009, ADR-010, ADR-011, ADR-016 |
| Instr refs | version lock `apps/versions.lock.md`; Microsoft WNS guidelines |
| Log | `../logs/p2-w6-0002-push-wns.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement Windows Push Notification Services registration, device registration with TeslaSync, foreground notification handling, and secure unregister/sign-out cleanup per ADR-009.

## Spec

- Request/create a WNS channel using Windows notification APIs appropriate for packaged WinUI 3 apps.
- Register the channel/device token with the generated client `/api/v1/devices` endpoint, including platform, app version, locale, notification capability flags, and redacted device identifier.
- Refresh/renew channel before expiration and after auth/user changes; unregister on sign-out and revoke failures.
- Handle foreground push payloads and route them into the notifications repository, toast service contract, and W2 banners without relying on background SSE.
- Store only non-secret registration metadata locally; no tokens or channel URIs in plaintext logs.
- Add tests with a fake WNS channel provider and fake generated client for register/renew/unregister/error cases.
- Update package manifest capabilities required by WNS; no store credentials or secrets committed.

## Implementation steps

1. Verify W4/W5/W6-0001 logs are DONE.
2. Survey ADR-009, generated `/devices` contract, and Windows package manifest.
3. Implement `IPushChannelProvider`, `IPushRegistrationService`, device registration DTO mapping, and sign-out cleanup.
4. Wire foreground push payloads to notification repository and UI state.
5. Add fake-provider tests and package identity checks.
6. Run gate; if the local machine lacks WNS/package identity, mark only the live WNS integration sub-step BLOCKED with precise reason, never claim DONE for that sub-step.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w6-0002-push-wns.log"
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
$required = @('PushNotificationChannel','IPushRegistrationService','/devices','Unregister','ChannelUri','Package.appxmanifest')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml,*.xml,*.appxmanifest | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch [regex]::Escape($_) })
"MISSING_WNS_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] WNS channel registration, renewal, unregister, and sign-out cleanup are implemented.
- [ ] Device registration uses generated client `/api/v1/devices` contract.
- [ ] Foreground push payloads update notification state and toast contracts.
- [ ] No channel URIs, tokens, or PII are logged.
- [ ] Build, format, test, placeholder, and WNS-marker gates are green or BLOCKED only for missing WNS/package identity.

## Out of Scope

- No backend push worker implementation.
- No mobile FCM/APNs work.
- No background SSE polling workaround.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w6-0002-push-wns.log
git commit -m "feat(apps/windows): add WNS push registration (P2/W6-0002)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
