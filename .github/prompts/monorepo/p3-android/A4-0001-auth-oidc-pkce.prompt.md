---
description: "P3/A4 — Android OIDC PKCE auth via AppAuth and secure token storage"
---

# P3 · A4 · 0001 — Auth + onboarding (OIDC PKCE)

> **Severity:** Security foundation · **Delegation:** FORBIDDEN
> Implement Android-native Authentik OIDC PKCE sign-in with AppAuth/Custom Tabs, EncryptedSharedPreferences/Keystore token storage, and centralized 401 refresh per ADR-008.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` auth, secure storage actuals, auth UI/onboarding hooks |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P1/S4 networking, P1 auth interfaces/state holders, P3/A2-0004, P3/A3 |
| Blocks | authenticated Android pages, SSE reconnect auth, push registration |
| ADR refs | ADR-002, ADR-004, ADR-008, ADR-009, ADR-010, ADR-011, ADR-015, ADR-016 |
| Log | `../logs/p3-a4-0001-auth-oidc-pkce.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Deliver a secure, production-ready Android authentication integration that the KMP shared core can use without storing tokens insecurely or duplicating auth logic in pages.

## Spec

- Use AppAuth for OAuth 2.0/OIDC Authorization Code + PKCE via Chrome Custom Tabs and App Links/custom scheme redirect registered in AndroidManifest.
- Implement the Android `actual` secure storage for shared-core token interfaces using EncryptedSharedPreferences backed by Android Keystore; no plaintext prefs/files/logs.
- Wire the shared-core auth state machine to Compose auth state: signed-out, authorizing, authenticated, refreshing, expired, error, reauth-required.
- Centralize 401 refresh/retry through the networking token provider; ensure SSE reconnect can re-auth without page code.
- Implement onboarding/sign-in surfaces using A2 feedback/forms components, accessibility semantics, and redacted diagnostic logging only.
- Add tests with fake AppAuth responses/token store; never hit real Authentik in unit tests.

## Implementation steps

1. Verify predecessor logs and survey ADR-008 plus shared-core auth interfaces.
2. Configure manifest intent filters, AppAuth service config, redirect validation, and secure storage actuals.
3. Wire auth state to the app shell/onboarding gate and KMP token provider.
4. Implement sign-in, sign-out, refresh, expired-session, and reauth UI states with retry.
5. Add tests for PKCE launch, callback success/error, secure storage, 401 refresh once, sign-out clearing tokens; run gate.

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

- [ ] OIDC PKCE sign-in uses AppAuth/Custom Tabs and registered redirect URIs.
- [ ] Tokens are stored only via EncryptedSharedPreferences/Keystore and never logged.
- [ ] 401 refresh/retry is centralized and covered by tests; pages do not handle tokens manually.
- [ ] Auth UI covers loading/error/expired/reauth states and is accessible.
- [ ] Gate green; placeholder scanner clean; `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Backend Authentik setup, Helm secrets, adding new auth endpoints, page content, and push provider credentials.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a4-0001-auth-oidc-pkce.log
git commit -m "feat(apps/android): add OIDC PKCE auth and secure storage (P3/A4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
