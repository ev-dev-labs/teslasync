# ADR-008 — Authentication (Authentik forward-auth) + per-platform secure storage

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

The web app sits behind Authentik **ForwardAuth** (httpOnly cookies); the guideline is
"never store tokens in localStorage." Native apps cannot rely on a reverse-proxy cookie
the same way and must authenticate first-class, then call `/api/v1/*` with credentials,
and store secrets in OS-native secure storage.

## Decision

- **Auth flow:** native apps use **OAuth 2.0 / OIDC Authorization Code + PKCE** against
  Authentik, via the platform's system auth surface:
  - Windows: WebAuthenticationBroker / system browser + custom URI scheme.
  - Android: Chrome Custom Tabs + AppAuth, App Links redirect.
  - Apple: `ASWebAuthenticationSession`, associated-domain Universal Link redirect.
  Tokens are exchanged and **refreshed** by the shared core (KMP) / C# auth layer.
- **Secure storage** via `expect/actual` (KMP) + native C#:
  - Windows: Windows Credential Manager / DPAPI (`PasswordVault`).
  - Android: EncryptedSharedPreferences / Keystore-backed.
  - Apple: Keychain (with biometric `LAContext` gating option).
- **No tokens in plaintext prefs, files, or logs.** PII (VIN, location, tokens) is never logged.

## Consequences

- ✅ First-class native sign-in; secrets at rest in OS secure stores; biometric unlock available.
- ✅ One auth state machine in the shared core (Android+Apple); C# mirrors it (golden vectors, ADR-004).
- ⚠️ Authentik must register native OAuth clients + redirect URIs (associated domains, app links,
  custom schemes). P0/P1 includes the Authentik client-config runbook.
- ⚠️ Token refresh + 401 retry must be centralized in the networking layer; SSE reconnect must
  re-auth. Covered in ADR-009.

## Alternatives rejected

- **Embed forward-auth cookies in a hidden WebView:** brittle, un-native, fails ADR-002.
- **Long-lived API keys per device:** weaker security, no central revocation/refresh.
