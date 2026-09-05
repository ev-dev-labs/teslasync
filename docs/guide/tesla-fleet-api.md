# Tesla Fleet API Setup

Every external thing TeslaSync needs from Tesla lives in this guide. If you have already worked through the [Getting Started](/guide/getting-started) page once, this is the deeper reference for the moments you hit "wait, why does Tesla want X?" The order below matches the order things have to happen — you cannot register a partner account before you have an approved developer application, you cannot stream Fleet Telemetry before you have registered a partner account, and so on.

If you only read one paragraph: TeslaSync talks to **three distinct Tesla surfaces** — the user-authorisation API at `auth.tesla.com`, the regional Fleet API at `fleet-api.prd.{na,eu,cn}.vn.cloud.tesla.com`, and (for partner-level operations) the partner-auth endpoint at `fleet-auth.prd.vn.cloud.tesla.com`. Everything below is variations on which credentials reach which surface in which order.

## The three credential types

| Credential                 | How you get it                                                                              | What it lets TeslaSync do                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Developer application**  | Created at [developer.tesla.com](https://developer.tesla.com); approved by Tesla            | Gives you a `TESLA_CLIENT_ID` + `TESLA_CLIENT_SECRET` that identify your install to Tesla          |
| **User OAuth tokens**      | Minted via the `auth.tesla.com/oauth2/v3/authorize` flow against a Tesla owner account      | Lets TeslaSync read + control that owner's vehicles. Stored encrypted (`ENCRYPTION_KEY`).          |
| **Partner token**          | `client_credentials` grant against `fleet-auth.prd.vn.cloud.tesla.com`                      | Used for partner-level operations: registering your public key, querying Fleet Telemetry errors    |

The developer application is one per install. User OAuth tokens are one per Tesla owner who logs in. The partner token is short-lived and minted on demand by `internal/tesla/client_auth.go::GetPartnerToken`.

## Step 1 — Create the developer application

The fields on the form, with the things that actually matter:

- **Application name** — shown to your users on the Tesla OAuth consent screen. Use something they will recognise (`TeslaSync at home`, `Acme Fleet Tracker`).
- **Redirect URIs** — exact match required. Both `http://localhost:8080/api/v1/auth/callback` (local trials) and `https://your-domain.example.com/api/v1/auth/callback` (production) can coexist on the same application.
- **Scopes** — configure the six requested scopes below. Missing permissions can prevent corresponding features from working.
- **Partner registration domains** — leave empty during creation; you register them after the application is approved using TeslaSync's DevTools API.

### The six scopes TeslaSync requests

`internal/tesla/client_auth.go` builds the authorisation URL with exactly this scope set:

```
openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds
```

| Scope                       | Drops if missing                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `openid`                    | Cannot identify the Tesla account — token exchange fails                                                        |
| `offline_access`            | No refresh token — tokens expire after their natural lifetime and the user has to re-authorise                  |
| `vehicle_device_data`       | No vehicle state, no climate, no charge — the dashboard shows a fleet list but every detail page is empty       |
| `vehicle_location`          | No GPS, no map, no geofences — separate scope since Tesla split location off in 2024                            |
| `vehicle_cmds`              | Lock, climate, sentry, frunk, trunk, horn, flash, navigate, and 30+ other commands all return `invalid_scope`   |
| `vehicle_charging_cmds`     | Start/stop/limit/schedule charging all return `invalid_scope`                                                   |

If you find yourself in production with a missing scope, the recovery is to re-tick the scope on the developer application and have every user re-run **Connect Tesla** to mint new tokens. Old refresh tokens minted under the previous scope set continue to work but never gain the new permission.

## Step 2 — Pick a region {#step-2-pick-a-region}

Tesla operates three Fleet API regional bases. The base must match the region of the Tesla account whose vehicles you want to control — not the region of the server running TeslaSync.

| Region          | `TESLA_API_BASE_URL`                                  | Notes                                                                                  |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| North America   | `https://fleet-api.prd.na.vn.cloud.tesla.com`         | Also serves Asia-Pacific accounts at present                                            |
| Europe / EMEA   | `https://fleet-api.prd.eu.vn.cloud.tesla.com`         | EU-registered Tesla accounts                                                            |
| China           | `https://fleet-api.prd.cn.vn.cloud.tesla.com`         | Mainland China accounts; requires Tesla's separate China developer-portal approval     |

All three regions share the same auth host. TeslaSync derives the auth URL from the base URL via `partnerAuthURL()` in `client_auth.go` — set the base correctly and auth follows. The mapping is:

```
fleet-api.prd.na.vn.cloud.tesla.com → fleet-auth.prd.vn.cloud.tesla.com
fleet-api.prd.eu.vn.cloud.tesla.com → fleet-auth.prd.vn.cloud.tesla.com
fleet-api.prd.cn.vn.cloud.tesla.com → fleet-auth.prd.vn.cloud.tesla.com
```

If you pick the wrong base, OAuth completes successfully but every vehicle request returns `404 Not Found` because the user's vehicles do not exist in that region's API.

## Step 3 — Configure TeslaSync with the developer credentials

Add these to `.env`:

```dotenv
TESLA_CLIENT_ID=...
TESLA_CLIENT_SECRET=...
TESLA_REDIRECT_URI=https://your-domain.example.com/api/v1/auth/callback
TESLA_API_BASE_URL=https://fleet-api.prd.eu.vn.cloud.tesla.com   # match your region
ENCRYPTION_KEY=...                                                # openssl rand -base64 32
```

Restart the API. The `auth_status` endpoint should now report the configured client ID:

```bash
curl http://localhost:8080/api/v1/devtools/fleet-api-info
```

Returns the base URL, client ID, the regional bases list, and a placeholder for the public-key URL.

## Step 4 — Complete the user OAuth flow

Open **Settings → Fleet Setup** (`/settings/fleet-setup`) and connect your account.
Tesla handles owner consent and redirects to `TESLA_REDIRECT_URI`. Configure
`ENCRYPTION_KEY` in the actual API container environment before authorizing;
see [Compose overrides](/deployment/docker#required-environment-overrides).
Without it, development mode may store tokens unencrypted.

The refresh worker watches for tokens that will expire within a configurable window and renews them silently. You do not have to touch the token lifecycle once the first authorisation succeeds.

### What success looks like

After OAuth:

- `auth_subjects` has a row for the forward-auth subject (in forward-auth mode) or the install-level synthetic user (in open mode)
- `users` has a row with non-null `tesla_token_encrypted` and `tesla_refresh_token_encrypted`
- The vehicle worker logs `synced N vehicles from fleet API`
- The dashboard shows your fleet

If the vehicle list or fresh data is missing, check scopes, callback, region,
and token encryption, then follow [Troubleshooting](/guide/troubleshooting).

## Step 5 — Register your partner account

Register your application in the Tesla region you use. Do not assume a
polling-only deployment bypasses Tesla's application onboarding requirements.
Follow [Tesla's application registration sequence](https://github.com/teslamotors/fleet-telemetry#setup-steps)
and current developer-portal requirements.

Publish the application's public key at a domain you control and register that
domain with Tesla. Verify that the served key matches the signing proxy's private
key; do not assume starting containers provisions or pairs the key automatically.

### Prerequisites

- The install is reachable at a **public HTTPS domain** with a publicly-trusted TLS certificate
- The path `/.well-known/appspecific/com.tesla.3p.public-key.pem` is reachable on that domain **without auth** (the path bypasses forward-auth in `internal/api/router.go` so Tesla can fetch it anonymously)
- The Tesla developer application has been approved for Fleet Telemetry (set on the application config in the portal)

### The registration call

The registration API accepts a domain. Use an authenticated administrative session
when forward-auth is enabled; the example intentionally contains no credentials:

```bash
curl -X POST https://teslasync.example.com/api/v1/devtools/register-partner \
  -H 'Content-Type: application/json' \
  -d '{"domain": "teslasync.example.com"}'
```

Under the hood (`internal/api/devtools_handler.go::RegisterPartner`):

1. The handler obtains a partner token via `client_credentials` grant against `fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`
2. It calls `POST https://<your-region-base>/api/1/partner_accounts` with `{"domain": "..."}` and the partner token as bearer auth
3. Tesla validates that the domain serves a `.well-known/appspecific/com.tesla.3p.public-key.pem` file and that the key matches what TeslaSync would sign with
4. Tesla returns the registered fingerprint

The raw Tesla response is returned to the caller so you can see exactly what Tesla said — including failures.

### Verify

After registration, confirm Tesla and TeslaSync agree on the public key:

```bash
curl 'https://teslasync.example.com/api/v1/devtools/partner-public-key?domain=teslasync.example.com'
```

`internal/api/devtools_handler.go::PartnerPublicKey` fetches the key Tesla has on file and compares it to the local key in `tesla_public_key`. The augmented response includes a `verification` block:

```json
{
  "response": { "public_key": "-----BEGIN PUBLIC KEY-----\n..." },
  "verification": {
    "remote_key_found": true,
    "matches_local": true,
    "local_key_configured": true
  }
}
```

`matches_local: true` is what you want before turning on Fleet Telemetry. `matches_local: false` means Tesla has a different key on file than the one TeslaSync is currently serving — usually because the install was redeployed and the key was rotated. Re-running the registration call replaces Tesla's record.

## Step 6 — Enable Fleet Telemetry

Vehicles connect to **your receiver**, not the other way around. Before subscribing,
pair the application's virtual key with each vehicle and configure the signing
proxy with the matching private key. Tesla's
[official setup sequence](https://github.com/teslamotors/fleet-telemetry#setup-steps)
requires these steps for telemetry configuration, not only remote controls.
Then deploy your receiver:

```bash
docker compose --profile telemetry up -d
```

And set the relevant `FLEET_TELEMETRY_*` variables (see [Configuration](/guide/configuration#fleet-telemetry-settings)). The [Fleet Telemetry guide](/guide/fleet-telemetry) walks through the per-vehicle subscription flow and the codec layer that translates Tesla's protobuf format into TeslaSync's typed signals.

## Step 7 — Configure the signing proxy

Newer Tesla vehicles (Model 3 / Y from 2021+, Model S / X refresh, Cybertruck) require commands to be cryptographically signed by the partner key. TeslaSync ships a Vehicle Command Proxy in the `commands` Compose profile that handles signing transparently:

```bash
docker compose --profile commands up -d
```

Set `TESLA_COMMAND_PROXY_URL=https://vehicle-command-proxy:4443` in the API
container using the [Compose override](/deployment/docker#required-environment-overrides).
The base Compose file does not forward this variable automatically. Provision the
proxy's TLS certificate and signing key at its configured mount, and ensure the
API trusts the certificate. Do not expose the signing proxy publicly or disable
certificate verification as a production workaround. Complete this step before
submitting the telemetry configuration in Step 6.

See [Remote Commands](/guide/remote-commands) for command setup. Availability
depends on vehicle capabilities and Tesla permissions, not simply the number of
endpoints implemented by TeslaSync.

## DevTools reference

`internal/api/devtools_handler.go` exposes a handful of partner-level utilities at `/api/v1/devtools/*` for first-run diagnostics:

| Endpoint                              | Purpose                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `GET /devtools/fleet-api-info`        | Show the configured base URL, client ID, regional bases, public-key URL  |
| `POST /devtools/register-partner`     | Register the partner account against a domain                            |
| `GET /devtools/partner-public-key`    | Fetch Tesla's recorded key + compare to the local key                    |
| `GET /devtools/test-connectivity`     | HEAD the Fleet API base URL to confirm the host is reachable             |
| `GET /devtools/user/region`           | Ask Tesla which region the authenticated user belongs to                 |

All of these are forward-auth-protected when `FORWARD_AUTH_HEADER` is set — they are administrative endpoints.

## Common Tesla-side failures

| Symptom                                                                                     | Cause                                                                                                       | Fix                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Tesla OAuth screen shows the wrong scopes / refuses the request | Application or owner grant lacks requested permissions | Review the six requested scopes, save, and reconnect in Fleet Setup |
| OAuth completes but `/api/1/vehicles` returns `404`                                         | `TESLA_API_BASE_URL` points at the wrong region for this account                                            | Match the base to the user's region (EU account → EU base, etc.)                                     |
| `register-partner` returns `412 Precondition Failed`                                        | Tesla cannot fetch `/.well-known/appspecific/com.tesla.3p.public-key.pem` on the registered domain          | Verify the route works anonymously over public HTTPS — forward-auth must not gate `.well-known`      |
| `register-partner` returns `400` with `unauthorized_client`                                 | Developer application is not approved for Fleet Telemetry                                                   | Wait for Tesla approval; check the portal application status                                         |
| Fleet Telemetry connection refused / no signals arriving                                    | Partner not registered, or registered key does not match the local key                                       | Re-run registration; verify with `partner-public-key` that `matches_local` is `true`                 |
| Signed commands return `vehicle requires signed commands`                                   | `TESLA_COMMAND_PROXY_URL` not set, or proxy not running                                                     | Bring up the `commands` profile, point the API at it; verify `wake_up` still works (it bypasses)     |
| `partner_accounts` returns `not_found` for `partner-public-key`                             | The current `TESLA_API_BASE_URL` does not have a registered partner account for this domain                  | Run `register-partner` again — the registration is region-scoped                                     |

## What lives where in the codebase

- `internal/tesla/client.go` — the HTTP client with shared auth, retries, tracing
- `internal/tesla/client_auth.go` — OAuth URL generation, partner-token flow, regional auth host derivation
- `internal/tesla/client_partner_devtools.go` — `RegisterPartner`, `GetPartnerPublicKey`
- `internal/tesla/client_commands.go` — all 65 command endpoints
- `internal/tesla/client_fleet_telemetry.go` — per-vehicle telemetry-subscription + error endpoints
- `internal/api/devtools_handler.go` — `/api/v1/devtools/*` HTTP handlers
- `internal/api/router.go` — wiring, including the `.well-known` public-key route bypass
- `internal/crypto/crypto.go` — `ENCRYPTION_KEY` handling and the production-startup guard

If something on the Tesla side is misbehaving, start in `client_auth.go` or `client_partner_devtools.go` — those modules log the exact upstream URL and status code for every request.
