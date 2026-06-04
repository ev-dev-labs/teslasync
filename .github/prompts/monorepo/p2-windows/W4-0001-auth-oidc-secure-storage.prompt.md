---
description: "P2/W4-0001 — Windows OIDC PKCE auth and secure token storage"
---

# P2 · W4-0001 — OIDC PKCE auth and secure storage

> **Severity:** Security foundational · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+ and Authentik test configuration; if no runner/test IdP exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Auth/**`, secure storage, networking auth handlers, onboarding sign-in surfaces |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE, W3-0001 DONE |
| Blocks | W5 data layer, W6 live/push, W7 authenticated pages |
| ADR refs | ADR-002, ADR-004, ADR-008, ADR-010, ADR-011, ADR-015, ADR-016 |
| Instr refs | version lock `apps/versions.lock.md`; Authentik native client runbook from apps docs |
| Log | `../logs/p2-w4-0001-auth-oidc-secure-storage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement first-class Windows native authentication using OIDC Authorization Code + PKCE, secure token storage, centralized refresh, and authenticated route gating per ADR-008.

## Spec

- Use Windows system browser/WebAuthenticationBroker-compatible flow (or `WebAuthenticator`/system browser pattern explicitly pinned for WinUI 3) with custom URI scheme redirect registered in the app package manifest.
- Generate PKCE verifier/challenge with cryptographically secure randomness; validate `state` and nonce.
- Exchange auth code for tokens through a typed Authentik/OIDC client; no tokens in logs, files, local settings, or SQLite cache.
- Store refresh/access token material in Windows Credential Locker/PasswordVault or DPAPI-protected credential storage; expose an `ISecureTokenStore` abstraction.
- Centralize token attach, refresh-before-expiry, 401 refresh-and-retry, sign-out/revoke, and auth state transitions in the C# auth layer that mirrors ADR-004 behavior vectors.
- Integrate route gating with W3 shell and W2 `RequiresAuth`/reauth banners.
- Add onboarding/sign-in/sign-out UI with loading/error/retry states and localized strings.
- Ensure SSE clients can request refreshed tokens and reconnect after 401 (contract for W6).

## Implementation steps

1. Verify W3 shell log is DONE.
2. Survey ADR-008 and existing web forward-auth assumptions; log rejected WebView/cookie approaches.
3. Implement auth models, PKCE generator, OIDC discovery/config, token exchange, secure storage, token refresh handler, and redacting logs.
4. Register custom URI scheme/package activation and handle auth callback activation.
5. Wire W3 route guards and sign-in/onboarding UI; no page body may silently render authenticated data while signed out.
6. Add unit tests for PKCE, state validation, token refresh, 401 retry, secure storage abstraction with a fake vault, and redaction.
7. Run gate; if no Authentik/native-client test config is available, BLOCKED with exact missing capability.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w4-0001-auth-oidc-secure-storage.log"
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
$forbidden = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml,*.json | Select-String -Pattern 'localStorage|TODO|NotImplementedException|access_token.*Console|refresh_token.*Console'
"AUTH_FORBIDDEN_MATCHES=$(@($forbidden).Count)" | Tee-Object $log -Append
$required = @('Pkce','PasswordVault','ISecureTokenStore','Refresh','Unauthorized','WebAuthentication')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_AUTH_MARKERS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or (@($forbidden).Count -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] OIDC Authorization Code + PKCE uses system auth surface and custom URI callback.
- [ ] Tokens are stored only in Credential Locker/DPAPI-backed storage and are redacted from logs.
- [ ] Central HTTP auth handler attaches tokens, refreshes, retries one 401, and signs out on terminal auth failure.
- [ ] Route gating and onboarding/sign-in UI are complete and localized.
- [ ] Build, format, test, placeholder, forbidden-pattern, and auth-marker gates are green.

## Out of Scope

- No backend Authentik configuration changes.
- No WebView cookie scraping.
- No page implementations beyond auth/onboarding surfaces needed for sign-in.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w4-0001-auth-oidc-secure-storage.log
git commit -m "feat(apps/windows): add OIDC PKCE auth (P2/W4-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
