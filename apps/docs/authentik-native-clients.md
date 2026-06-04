# Authentik Native OAuth Client Runbook (ADR-008)

> **Scope:** How to register the three TeslaSync native applications (Windows,
> Android, Apple) as OAuth 2.0 / OIDC **public** clients in Authentik using the
> **Authorization Code flow with PKCE (S256)**. This document is the
> authoritative sign-in specification consumed by the P1 auth module and every
> platform sign-in prompt (P1/P2/P3/P4).
>
> **Status:** Specification. Items that imply a backend code change are flagged
> inline as **`TODO-for-ADR`** and routed to **ADR-009** for review — this
> runbook does not authorize backend edits.

---

## Conventions

- `<host>` — the public Authentik / TeslaSync host (e.g. `auth.teslasync.example`).
- All native apps are **public clients**: they ship **no client secret** and rely
  on **PKCE S256** to protect the authorization code exchange.
- The **Implicit** and **Hybrid** flows are **disabled** for every client.
- "App registration" below assumes Authentik **Applications → Providers →
  Create → OAuth2/OpenID Provider**, then an **Application** bound to that
  provider.

---

## 1. Provider config (per app)

Create **one OAuth2/OpenID Provider per platform** so redirect URIs and token
lifetimes can be tuned independently. Shared settings for all three:

| Setting | Value |
|---|---|
| Client type | **Public** (no secret) |
| Grant type | **Authorization Code** |
| PKCE | **Required**, method **S256** only |
| Implicit / Hybrid | **Disabled** |
| Subject mode | `Based on the User's hashed ID` (stable `sub`) |
| Signing key | Tenant default RS256 key (so `/api/v1/*` can verify JWTs) |
| Redirect URI matching | **Strict** (exact match, no wildcards except scheme/host as noted) |

### 1.1 Windows app

- **Client ID:** `teslasync-windows`
- **Allowed redirect URIs** (register both; prefer loopback for MSIX-unpackaged):
  - Protocol activation (packaged/MSIX): `ms-app://<package-SID>`
    - `<package-SID>` is obtained from the signed MSIX identity
      (`Get-AppxPackage`/`PackageFamilyName` → derived SID); pin the exact value
      in the test tenant before release.
  - Loopback (development & unpackaged): `http://127.0.0.1:<port>/callback`
    - Use an **ephemeral high port** (OS-assigned) bound to `127.0.0.1` only;
      Authentik must allow the **loopback exception** (any port on
      `127.0.0.1`). Do **not** use `localhost` — bind to the IP literal.
- **Secure storage target:** Windows **Credential Manager** (DPAPI-backed) — see §4.

### 1.2 Android app

- **Client ID:** `teslasync-android`
- **Allowed redirect URIs** (register both):
  - **App Link** (verified HTTPS, preferred): `https://<host>/oauth/android/callback`
    - Requires a published Digital Asset Links file at
      `https://<host>/.well-known/assetlinks.json` binding the app's package
      name + signing-cert SHA-256. **`TODO-for-ADR` (ADR-009):** confirm who
      serves `assetlinks.json` (web edge vs. backend route).
  - **Custom scheme** (fallback): `teslasync://oauth`
- **Secure storage target:** Android **Keystore**-backed `EncryptedSharedPreferences`
  (or DataStore with a Keystore master key) — see §4.

### 1.3 Apple app (iOS / macOS)

- **Client ID:** `teslasync-apple`
- **Allowed redirect URIs** (register both):
  - **Universal Link** (verified HTTPS, preferred): `https://<host>/oauth/apple/callback`
    - Requires an Apple App Site Association file at
      `https://<host>/.well-known/apple-app-site-association` (served as JSON,
      no extension, `Content-Type: application/json`) listing the app's
      `<TeamID>.<BundleID>`. **`TODO-for-ADR` (ADR-009):** confirm AASA hosting
      owner.
  - **Custom scheme** (fallback): `teslasync://oauth`
- Use `ASWebAuthenticationSession` for the in-app browser round-trip.
- **Secure storage target:** Apple **Keychain** (with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) — see §4.

---

## 2. Scopes & claims

Request the following scopes on every native client:

| Scope | Why |
|---|---|
| `openid` | Mandatory for OIDC; yields the ID token + `sub`. |
| `profile` | Display name / username for the signed-in UI. |
| `email` | Account identity / support correlation. |
| `offline_access` | Issues a **refresh token** so the app can renew silently. |

Map these scopes in the provider's **Scope mappings**. Required ID-token claims:
`sub` (stable), `preferred_username`, `email`, `email_verified`, `exp`, `iat`,
`aud` (= the platform client ID), `iss` (= `https://<host>/application/o/<slug>/`).

**`TODO-for-ADR` (ADR-009):** if `/api/v1/*` needs a role/group claim for
authorization parity with the web ForwardAuth path, add a `groups` claim mapping
— flagged for ADR review, not implemented here.

---

## 3. Token lifetimes, refresh policy & API bearer acceptance

### 3.1 Lifetimes (set per provider)

| Token | Lifetime | Notes |
|---|---|---|
| Authorization code | 60 s, single-use | PKCE-bound; rejected on replay. |
| Access token | **10 minutes** | Short-lived; carried as the API bearer. |
| ID token | 10 minutes | Used for the signed-in identity only. |
| Refresh token | **30 days, sliding** | Rotated on each use (see §3.2). |

### 3.2 Refresh policy

- **Refresh-token rotation ON:** each refresh issues a new refresh token and
  invalidates the prior one (replay → revoke the chain).
- Apps refresh **proactively** ~60 s before access-token `exp`.
- On `invalid_grant` (rotation/replay/expiry), the app must **discard stored
  tokens and restart the PKCE auth-code flow** (full sign-in).

### 3.3 How `/api/v1/*` accepts the token vs. the web ForwardAuth cookie

- **Web SPA:** unchanged — authenticates via Authentik **ForwardAuth** at the
  proxy edge, which injects the session cookie / trusted headers. Native apps do
  **not** use this path.
- **Native apps:** send `Authorization: Bearer <access_token>` on every
  `/api/v1/*` request.
- **Backend gap — `TODO-for-ADR` (ADR-009):** the current `/api/v1/*` middleware
  trusts ForwardAuth headers/cookie only. Accepting and **verifying a bearer
  JWT** (validate `iss`, `aud`, `exp`, signature against Authentik's JWKS) is a
  **backend-additive** requirement. This runbook only specifies the contract;
  the middleware change is **deferred to ADR-009** and must not be coded as part
  of P0/0009.
- **Device/session listing — `TODO-for-ADR` (ADR-009):** a `/api/v1/devices`
  endpoint to enumerate/revoke native sessions is implied by per-device refresh
  tokens. Flagged for ADR review; not implemented here.

---

## 4. Secret storage (per platform)

Native apps store **only the refresh token** (and optionally the cached access
token) — never a client secret (there is none). Storage targets:

| Platform | Target | Pointer |
|---|---|---|
| Windows | **Credential Manager** (DPAPI per-user) | `PasswordVault` / `CredWrite`; key by client ID + `sub`. |
| Android | **Keystore**-backed `EncryptedSharedPreferences` | AES-GCM master key in Keystore; biometric-gated unlock optional. |
| Apple | **Keychain** | `kSecClassGenericPassword`, `...AfterFirstUnlockThisDeviceOnly`, no iCloud sync. |

Rules: tokens are **per-device, non-exportable**; wipe on sign-out and on
`invalid_grant`; never log token material (observability redaction applies).

---

## 5. Verification checklist (test tenant)

Run once per platform in a throwaway Authentik tenant before shipping:

- [ ] Provider created as **public** client, **PKCE S256 required**, implicit/hybrid disabled.
- [ ] All redirect URIs registered exactly as in §1 (loopback/App Link/Universal Link + scheme).
- [ ] Auth-code flow launches the system browser / `ASWebAuthenticationSession` and returns to the app.
- [ ] PKCE `code_verifier`/`code_challenge` (S256) round-trips; token endpoint returns access + ID + refresh tokens.
- [ ] ID token validates: `iss`, `aud` (= platform client ID), `exp`, signature (RS256 via JWKS).
- [ ] `offline_access` yields a refresh token; manual refresh succeeds and **rotates** the refresh token.
- [ ] Reusing an old (rotated) refresh token is **rejected** (`invalid_grant`).
- [ ] Tampered/expired access token is rejected by the bearer path (once ADR-009 backend support lands).
- [ ] Refresh token persists in the platform secure store and survives app restart; sign-out wipes it.
- [ ] Web SPA ForwardAuth sign-in still works unchanged (no regression).

---

## 6. Security notes

- **No client secret** in any native app — public clients only.
- **PKCE S256 mandatory**; reject `plain` challenge method.
- **Reject the Implicit flow** (and Hybrid) at the provider; Authorization Code only.
- **Strict, exact redirect-URI matching**; loopback limited to `127.0.0.1` (not `localhost`), HTTPS App/Universal Links verified via asset-links/AASA.
- **Refresh-token rotation** with replay detection; short access-token TTL (10 min).
- Validate `iss`/`aud`/`exp`/signature on every token; never trust unverified JWTs.
- Store tokens **only** in the platform secure enclave (§4); never in plaintext files, logs, or app preferences.
- Treat the `state` parameter as CSRF protection; verify it on the callback.

---

## ADR cross-references

- **ADR-008** — Authentication + secure storage (this runbook implements its native-client guidance).
- **ADR-009** — Backend bearer-token acceptance for `/api/v1/*` and `/api/v1/devices` (all `TODO-for-ADR` items above are routed here for review).
