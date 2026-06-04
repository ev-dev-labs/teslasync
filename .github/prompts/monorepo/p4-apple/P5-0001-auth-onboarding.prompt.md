---
description: "P4/P5 — Apple OIDC PKCE auth, Keychain storage, onboarding"
---

# P4 · P5 · 0001 — Auth, secure storage, and onboarding

> **Severity:** Foundation (blocks authenticated Apple app use) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Implement Apple-native OIDC Authorization Code + PKCE using `ASWebAuthenticationSession`,
> Keychain storage, optional biometrics, and centralized 401 refresh per ADR-008.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Auth/`, onboarding/auth UI wiring |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P1 facade, P4/P4 navigation, shared auth state from P1/S6 |
| Blocks | authenticated page parity, P6 SSE re-auth, P8 settings/privacy |
| ADR refs | ADR-002, ADR-004, ADR-008, ADR-010, ADR-011, ADR-014, ADR-015, ADR-016 |
| Log | `../logs/p4-p5-0001-auth-onboarding.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Deliver complete Apple auth infrastructure: secure first-run sign-in, token refresh, Keychain
storage, optional biometric unlock, authenticated networking/SSE integration, and no token leakage.

## Spec

- **OIDC PKCE:** use `ASWebAuthenticationSession` with Universal Link redirect (and documented
  custom-scheme fallback only if the locked config requires it); generate/verifier/challenge safely.
- **Keychain:** store refresh/access token metadata in Keychain with access group and accessibility
  class suitable for iOS/macOS; no tokens in UserDefaults, files, cache, crash logs, or analytics.
- **Biometrics:** optional Face ID/Touch ID/App Password gating via `LocalAuthentication` and `LAContext`;
  include disable/recovery flow.
- **401 refresh:** centralize refresh-and-retry through shared facade/networking; exactly one refresh
  in flight; failed refresh returns to sign-in and clears invalid secrets.
- **Session UI:** onboarding/sign-in, signed-out, reauth-required, token-expiring, and error states;
  all localized and accessible.
- **Security:** redact VIN/location/token fields from auth logs; ATT/privacy-copy ready for later P8/P99.

## Implementation steps

1. Survey ADR-008, shared auth APIs, and Apple app entitlements/associated-domain requirements.
2. Implement `AppleAuthSession`, PKCE helper, Keychain store, biometric gate, and auth coordinator.
3. Wire auth coordinator into the facade token provider, 401 refresh path, SSE re-auth seam, and onboarding gate.
4. Add unit tests for PKCE, Keychain roundtrip (using test keychain), refresh de-duplication, logout/clear,
   biometric enabled/disabled states, and 401 retry behavior.
5. Add XCUITest coverage for first-run sign-in shell, cancelled auth, signed-out state, and biometric prompt seam.
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

- [ ] OIDC PKCE flow uses `ASWebAuthenticationSession`; redirects and cancellation are handled.
- [ ] Tokens are stored only in Keychain; optional biometrics work; logout clears secrets.
- [ ] 401 refresh is centralized, single-flight, redacted, and connected to networking/SSE.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Backend Authentik client provisioning, APNs, widgets, and page-specific authorization rules.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p5-0001-auth-onboarding.log
git commit -m "feat(apps/apple): add OIDC PKCE auth and Keychain storage (P4/P5)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
