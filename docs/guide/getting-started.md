# Getting Started

This page takes you from "git clone" to "I can see my real vehicles on the dashboard". It assumes nothing about your platform background. The shortcuts are in **TL;DR** boxes; the prose around them explains every gotcha that has bitten someone before you.

If you only read one paragraph: **TeslaSync needs three external things to work end-to-end** — a Tesla Developer Fleet API application (yours), a way to authenticate the humans using the UI (defaults to an open passthrough on first run; production needs a forward-auth proxy), and — only if you want Fleet Telemetry streaming or signed commands — a publicly-reachable HTTPS domain so Tesla can call back into your install. None of those three are TeslaSync's code; all three are at least mentioned in the right order below.

## How long will this really take?

There is a wide range and the honest answer matters:

| Phase                                                                                                                        | Realistic time                                |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Clone, run `docker compose up`, log in to the UI, complete Tesla OAuth, see your vehicles                                    | 15–30 minutes                                 |
| Tesla Developer application approved                                                                                         | Hours to days (Tesla's queue, not ours)       |
| Public domain with valid TLS so Fleet Telemetry / signed commands work                                                       | Whatever your DNS + cert setup takes          |
| Partner-account registration with Tesla (only needed for Fleet Telemetry + signed commands)                                  | A few minutes once the public domain is live  |

If your only goal is "see my vehicles update every few minutes via polling", you can be done in the first row's time. Everything below row 1 is for the streaming + signed-commands path and is **optional for a first run**.

## Before you start

You need:

- **Docker** + Compose v2 — everything else is a container, including the database and the AI runtime
- **A Tesla Developer account** with a Fleet API application registered (start this immediately; approval is gated by Tesla)
- **Git** for the clone
- A shell — examples below show both `bash` and `PowerShell` because the Tesla developer-tools ecosystem still leans Unix-shaped

You do **not** need Go, Node, Helm, or any language runtime on the host. Those are only relevant if you want to develop against the codebase — see [Local Development](/guide/local-development).

## Step 1 — Get a Tesla Developer application

> **TL;DR** — Create an application at [developer.tesla.com](https://developer.tesla.com), select the five OAuth scopes listed below, set the redirect URI to `http://localhost:8080/api/v1/auth/callback` (or your public callback URL), copy the client ID and secret somewhere safe.

The Tesla Developer portal is the slowest step. There are things people miss here that turn into "why does the dashboard say 'no vehicles' forever?" questions a day later:

### 1a. Pick the OAuth scopes

TeslaSync requests **exactly five scopes** at OAuth time. The string is hard-coded in `internal/tesla/client_auth.go`:

| Scope                       | What it lets TeslaSync do                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| `openid`                    | Identify the Tesla account that authorised TeslaSync (subject + email)     |
| `offline_access`            | Receive a refresh token so the platform can rotate access tokens silently  |
| `vehicle_device_data`       | Read every signal the Fleet API exposes (state, climate, charge, drive)    |
| `vehicle_location`          | Read GPS position and heading (separate from `vehicle_device_data` since 2024) |
| `vehicle_cmds`              | Send non-charging remote commands (lock, climate, sentry, frunk, horn, …)  |
| `vehicle_charging_cmds`     | Send charging-specific commands (start/stop, set limit, schedule)          |

If your Tesla Developer app does **not** have these scopes selected, the OAuth flow will look like it succeeded but every subsequent API call will return `invalid_scope` and the dashboard will be empty. Tick all five in the developer-portal scope picker.

### 1b. Choose your region

Tesla operates three Fleet API regional bases. Pick the one your Tesla account is registered in:

| Region          | `TESLA_API_BASE_URL`                                  |
| --------------- | ----------------------------------------------------- |
| North America   | `https://fleet-api.prd.na.vn.cloud.tesla.com`         |
| Europe / EMEA   | `https://fleet-api.prd.eu.vn.cloud.tesla.com`         |
| China           | `https://fleet-api.prd.cn.vn.cloud.tesla.com`         |

The NA base also serves Asia-Pacific accounts at the time of writing — Tesla does not currently publish a separate AP base. All three regions share the same auth host (`fleet-auth.prd.vn.cloud.tesla.com`); the API base is the only thing that changes.

### 1c. Set the redirect URI

The redirect URI you register with Tesla **must match exactly** what TeslaSync presents at OAuth time. Mismatches are the most common cause of "Connect Tesla loops back to the login screen":

- For a local-only run: `http://localhost:8080/api/v1/auth/callback`
- For production: `https://your-domain.example.com/api/v1/auth/callback`

You can add multiple redirect URIs to the same Tesla application — register both `localhost` and your production URL upfront so you do not have to come back to the portal later.

### 1d. Save the secret immediately

The Tesla Developer portal shows the **client secret exactly once**. Save it to your password manager before closing the page. If you lose it, you have to rotate the application — and any vehicles already authorised against the old credentials need to re-authorise.

### 1e. Optional: enable Fleet Telemetry in the developer app

If you want streaming telemetry (recommended, but not required to get started), enable Fleet Telemetry in the developer-app configuration now. Fleet Telemetry also requires a publicly-reachable HTTPS hostname and a registered partner account; both come later in this guide.

### What you walk away with

- `TESLA_CLIENT_ID`
- `TESLA_CLIENT_SECRET`
- A redirect URI you have registered
- The regional Fleet API base for your account

## Step 2 — Clone and configure

> **TL;DR (bash)**
> ```bash
> git clone https://github.com/ev-dev-labs/teslasync.git
> cd teslasync
> cp .env.example .env
> # edit .env with the four TESLA_* values
> ```
>
> **TL;DR (PowerShell)**
> ```powershell
> git clone https://github.com/ev-dev-labs/teslasync.git
> Set-Location teslasync
> Copy-Item .env.example .env
> # edit .env with the four TESLA_* values
> ```

The `.env.example` file is the canonical list of every variable the platform reads. Most have sensible defaults; the minimum you must set on a fresh install is:

```dotenv
TESLA_CLIENT_ID=your-client-id
TESLA_CLIENT_SECRET=your-client-secret
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback
TESLA_API_BASE_URL=https://fleet-api.prd.na.vn.cloud.tesla.com
```

Two more variables matter on day one but are easy to miss — neither is uncommented in `.env.example` and the defaults are deliberate trade-offs you should be aware of before going further:

### `ENCRYPTION_KEY` — encrypts Tesla tokens at rest

| Environment                                                                | Behaviour when `ENCRYPTION_KEY` is unset                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Development (default, `APP_ENV` and `GO_ENV` unset or anything except `production`) | The API logs a warning at startup and stores Tesla access + refresh tokens in **plaintext** in Postgres |
| Production (`APP_ENV=production` or `GO_ENV=production`)                   | The API **refuses to start** (`log.Fatal`) — see `internal/crypto/crypto.go`                       |

For a local trial, the plaintext warning is acceptable as long as the database is not exposed. For anything you treat as production, set:

```bash
# bash / WSL / macOS
ENCRYPTION_KEY=$(openssl rand -base64 32)

# PowerShell
$ENCRYPTION_KEY = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Add the resulting value to `.env`. Rotating it later requires re-authorising every Tesla account because previously-encrypted tokens become unreadable.

### `FORWARD_AUTH_HEADER` — who is allowed to use the UI

This is covered in Step 3 below because it changes the deployment shape, not just an env var.

## Step 3 — Decide on the authentication model

This is the step that turns "I can poke around" into "this is safe to put on a hostname". TeslaSync deliberately does **not** ship a built-in username / password screen. Identity is delegated to whatever reverse-proxy auth provider you already run (Authentik, Authelia, oauth2-proxy, Keycloak with their proxy, Cloudflare Access, Tailscale Funnel + Tailscale identity headers, etc.). There are two modes the API runs in, decided by a single environment variable:

| `FORWARD_AUTH_HEADER` value                                  | Mode                            | What requests look like                                                                                                                                                                                            | When to use it                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Empty / unset (default)                                      | **Open mode**                   | Anonymous requests pass through middleware. Identity-required endpoints (settings export, audit log, RBAC, API keys, impersonation, TOTP, scheduled exports) return `501 Not Implemented` with code `AUTH_MODE_OPEN`. | Local trial on `localhost` only. Never expose this to the internet — there is no auth enforcement at all on read endpoints.            |
| Header name (e.g. `X-Forwarded-User`, `X-Authentik-Username`) | **Forward-auth mode**           | Every request that lands on `/api/v1/*` must carry the named header. Missing header → `401 Unauthorized` with code `MISSING_IDENTITY`. Present header → user is auto-recorded in `auth_subjects` on first hit.        | Any deployment a third party can reach. The named header is whatever your proxy injects after it authenticates the user.              |

Reference: `internal/api/forward_auth_middleware.go`, `internal/auth/subject.go`.

### Local trial — open mode

`docker compose up -d --build` works out of the box for a single user on `localhost`. You will land on the dashboard, you can complete the Tesla OAuth flow, you can browse vehicles. Some pages will display banners or empty states for the identity-required features (RBAC settings, API key management) — that is expected in open mode.

### Local with a working forward-auth shim

If you want to exercise the full identity path locally (or expose the install to other people on your LAN), drop a tiny forward-auth proxy in front of the web container. The shortest path is `oauth2-proxy` pointed at GitHub OAuth:

```yaml
# docker-compose.override.yml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:latest
    command:
      - --provider=github
      - --client-id=${GITHUB_CLIENT_ID}
      - --client-secret=${GITHUB_CLIENT_SECRET}
      - --cookie-secret=${OAUTH2_PROXY_COOKIE_SECRET}
      - --email-domain=*
      - --upstream=http://web:80
      - --http-address=0.0.0.0:4180
      - --set-xauthrequest=true
      - --pass-access-token=true
      - --pass-authorization-header=true
    ports:
      - "4180:4180"
    depends_on:
      - web
```

Set `FORWARD_AUTH_HEADER=X-Auth-Request-User` in `.env`, then visit `http://localhost:4180` instead of `http://localhost:3000`. Every request that reaches the API now carries the GitHub username your OAuth login produced.

The provider mapping for the four common forward-auth proxies is:

| Provider              | Header it injects               | `FORWARD_AUTH_HEADER` value     |
| --------------------- | ------------------------------- | ------------------------------- |
| Authentik (Outpost)   | `X-Authentik-Username`          | `X-Authentik-Username`          |
| Authelia              | `Remote-User`                   | `Remote-User`                   |
| oauth2-proxy          | `X-Auth-Request-User`           | `X-Auth-Request-User`           |
| Custom / Traefik plugin | `X-Forwarded-User`            | `X-Forwarded-User`              |

### Production

For any internet-reachable deployment, use a real forward-auth provider behind a real ingress. Kubernetes Helm chart wiring is covered in [Kubernetes deployment](/deployment/kubernetes); for Docker Compose, an Authentik or Authelia container in front of the web service is the canonical pattern.

## Step 4 — Start the stack

> **TL;DR**
> ```bash
> docker compose up -d --build
> ```

::: warning Use the TimescaleDB image, not upstream `postgres`
The compose file pins `timescale/timescaledb-ha:pg17`. Migration 1 installs the **TimescaleDB** and **pgvector** extensions and will fail outright on the upstream `postgres:17` image. If you have customised the compose file or are wiring up your own database, you need both extensions available before the API can apply migrations.
:::

The first boot does three things you will see in the logs:

1. **Pulls + builds images** — minutes on first run, near-instant afterwards
2. **Brings up data services** — `postgres` (Timescale), `redis`, `mosquitto`, `grafana`, `prometheus`
3. **Runs database migrations** — the API service waits for `postgres` to be ready, then runs all **197 numbered SQL migrations** in order. Migration 1 installs `timescaledb` and `vector`. Watch for `migrations applied` in the `teslasync-api` log.

Default endpoints after boot:

| Service           | URL                                                          |
| ----------------- | ------------------------------------------------------------ |
| Web UI            | http://localhost:3000                                        |
| API               | http://localhost:8080                                        |
| Grafana           | http://localhost:3001 (`admin` / `admin`)                    |
| Prometheus        | http://localhost:9099                                        |
| Mosquitto         | localhost:1883 (no auth on localhost)                        |
| Jaeger UI         | http://localhost:16686 (requires `--profile tracing`)        |
| Ollama            | http://localhost:11434 (requires `--profile ai`)             |

If the web UI does not load, the most common first-boot issue is `postgres` taking longer than the default health-check window — wait a minute and the API will retry. Persistent failures: `docker compose logs teslasync-api` and `docker compose logs web` will tell you which service is unhappy.

## Step 5 — Connect your Tesla account

> **TL;DR** — Open the web UI, click **Connect Tesla**, complete the OAuth flow on Tesla's site, wait for the first vehicle sync.

The onboarding flow walks through:

1. **Tesla OAuth** — opens Tesla's authorisation page (`auth.tesla.com`), you approve the five scopes from Step 1a, you are redirected back to `TESLA_REDIRECT_URI`
2. **Initial vehicle sync** — the platform pulls your fleet list from `/api/1/vehicles` and stores it
3. **Settings overview** — units (km/mi, °C/°F, locale, timezone, currency), notification channels, optional Helix AI

After OAuth, the API stores the access + refresh tokens **encrypted at rest** with AES-GCM (assuming you set `ENCRYPTION_KEY` per Step 2). The refresh worker handles token rotation automatically so you do not have to think about it.

### What gets recorded for the user

In **forward-auth mode**, the first authenticated request creates a row in `auth_subjects` (debounced to 60 seconds per subject) and links the Tesla OAuth result to that user. In **open mode**, there is no per-user binding — Tesla tokens are owned by "the install" rather than "your forward-auth subject".

## Step 6 — Verify health

> **TL;DR**
> ```bash
> docker compose ps
> curl http://localhost:8080/healthz
> curl http://localhost:8080/readyz
> ```

`/healthz` is liveness — does the process respond? `/readyz` is readiness — are dependencies (database, Redis, MQTT) reachable and is the schema at the expected version?

If both pass and you can see your vehicles on the dashboard, the core install is done. Everything below is optional.

## Optional — Register your partner account with Tesla

Required if you want **Fleet Telemetry streaming** or **signed commands** to work end-to-end. Not required for plain polling + reading state.

Tesla requires every Fleet API application to register its public key against a domain it controls before that application can stream telemetry or issue signed commands. TeslaSync handles the partner-token + registration call for you, but you have to trigger it once per public domain you are operating from. The flow:

1. Your install must be reachable at a **public HTTPS domain** with valid TLS — for example `https://teslasync.example.com`. Localhost cannot register because Tesla validates the public-key route on the same domain.
2. The platform serves the registered public key at `/.well-known/appspecific/com.tesla.3p.public-key.pem` automatically (this path bypasses forward-auth so Tesla can fetch it anonymously).
3. Trigger registration through the DevTools API or the **Settings → DevTools → Partner Registration** UI:

```bash
curl -X POST https://teslasync.example.com/api/v1/devtools/register-partner \
  -H 'Content-Type: application/json' \
  -d '{"domain": "teslasync.example.com"}'
```

Behind the scenes this calls Tesla's `POST /api/1/partner_accounts` with a `client_credentials` partner token. Success returns the public-key fingerprint Tesla now associates with your domain. Verify with:

```bash
curl 'https://teslasync.example.com/api/v1/devtools/partner-public-key?domain=teslasync.example.com'
```

The response includes a `verification.matches_local` field that is `true` when Tesla's registered key matches the key the platform is currently serving — which is what you want before turning on Fleet Telemetry. Source: `internal/api/devtools_handler.go`, `internal/tesla/client_partner_devtools.go`.

## Optional — Turn on Fleet Telemetry

Recommended for low-latency live state and lower Tesla API usage. Requires:

- The partner registration from the previous section
- A publicly-reachable HTTPS hostname with valid TLS
- The Tesla Developer app set up for Fleet Telemetry
- The platform's `/.well-known/appspecific/com.tesla.3p.public-key.pem` route reachable without auth

Bring up the telemetry profile:

```bash
docker compose --profile telemetry up -d
```

Then configure `FLEET_TELEMETRY_*` variables (see [Configuration](/guide/configuration#fleet-telemetry-settings)) and follow the [Fleet Telemetry guide](/guide/fleet-telemetry) for the full setup.

## Optional — Turn on the Vehicle Command Proxy

Required for newer vehicles that demand signed commands (Model 3 / Y from 2021+, Model S / X refresh, Cybertruck). Without it, those vehicles can read state but commands will fail. The proxy also requires the partner-account registration above.

```bash
docker compose --profile commands up -d
```

Set `TESLA_COMMAND_PROXY_URL` to the proxy's URL (the default Compose setup wires this for you). `wake_up` is intentionally never proxied — it always goes direct to Tesla, which makes it a useful diagnostic when the proxy is misconfigured.

## Optional — Turn on Helix AI

The AI layer ships **off per feature**. To try it:

1. Pick a provider. If you want everything to stay on your hardware:

   ```bash
   docker compose --profile ai up -d
   docker compose exec ollama ollama pull llama3.1:8b
   ```

   ::: warning CPU-only Ollama is slow
   Pulling and serving `llama3.1:8b` on CPU works but is painfully slow for interactive chat — first-token latency can run into double-digit seconds. If you do not have a GPU, either accept the latency or use a smaller model (`docker compose exec ollama ollama pull llama3.2:3b` and set `OLLAMA_MODEL=llama3.2:3b`), or use a cloud provider (`AI_PROVIDER=openai`, etc.) for a more responsive trial.
   :::

   For cloud providers, set the matching env vars (`OPENAI_API_KEY`, `AZURE_OPENAI_*`, or `ANTHROPIC_API_KEY`).

2. Open **Settings → Helix** in the web UI.
3. Toggle on the features you want. Each is independently controlled. The full list is in the [Helix AI guide](/guide/helix-ai).
4. Set a daily budget if you are on a cloud provider (`AI_DAILY_BUDGET_USD`).

Helix never sends data to a provider you have not configured, and the redaction decorator strips VINs / GPS / driver names / emails by default before any cloud call (`AI_REDACTION_ENABLED=true`).

## Optional — Install as a PWA

The web UI ships a PWA manifest. From a supported browser (Chrome, Edge, Safari) on HTTPS or localhost, the browser's install button puts TeslaSync on your home screen / dock. The PWA:

- Caches the app shell, fonts, and map tiles for fast subsequent loads
- Falls back to a friendly offline page when there is no network
- **Does not cache live API or SSE responses** — fresh data always needs the backend

## Where to go next

- [Tesla Fleet API setup](/guide/tesla-fleet-api) — the full Developer-portal + scopes + partner-key flow in one place
- [Helix AI](/guide/helix-ai) — full feature reference if you enabled the AI layer
- [Remote Commands](/guide/remote-commands) — all 65 supported commands with examples
- [Configuration](/guide/configuration) — every environment variable, including the auth section
- [Architecture](/guide/architecture) — how the pieces fit together
- [Troubleshooting](/guide/troubleshooting) — when something does not work
- [Kubernetes deployment](/deployment/kubernetes) — when you outgrow Compose

## Common first-run problems

- **"Connect Tesla" loops back to the login screen** — the redirect URI registered with Tesla does not match `TESLA_REDIRECT_URI` exactly. Update one of them so they match scheme, host, port, path, and trailing-slash exactly.
- **OAuth succeeds but every Fleet API call returns `invalid_scope`** — your Tesla Developer application is missing one of the five scopes from Step 1a. Re-tick all five in the portal and run `Connect Tesla` again.
- **Every API call returns 401 with code `MISSING_IDENTITY`** — `FORWARD_AUTH_HEADER` is set but no proxy is injecting that header. Either point a proxy at the web container or unset `FORWARD_AUTH_HEADER` for an open-mode local trial.
- **Settings page tabs return 501 with code `AUTH_MODE_OPEN`** — you are in open mode and asked for an identity-required feature. Set `FORWARD_AUTH_HEADER` and put a proxy in front (Step 3).
- **Dashboard shows "no vehicles"** — the initial sync has not run yet. Wait 30 seconds or click **Refresh from Tesla** in the Fleet page.
- **Migrations log says "dirty version"** — a previous boot died mid-migration. Roll the database back to the last known clean version (`UPDATE schema_migrations SET dirty=false, version=<last_clean>`) and restart the API; it will retry the failed migration.
- **TimescaleDB extension missing** — you are using the upstream `postgres` image instead of `timescale/timescaledb-ha:pg17`. Switch images and re-run migrations against a clean volume.
- **Partner registration returns `412` or `unauthorized_client`** — your public-key route is unreachable, your domain is not on HTTPS with a valid cert, or the Tesla developer application is not approved for Fleet Telemetry. Verify all three before retrying.
- **Web UI loads but API calls 404** — Nginx in the web container is not proxying `/api`. Check `nginx.conf` inside the web container; the proxy block must forward to `http://teslasync-api:8080` (or your configured `apiEndpoint`).
- **API refuses to start with `ENCRYPTION_KEY is required in production`** — `APP_ENV=production` (or `GO_ENV=production`) is set without `ENCRYPTION_KEY`. Either set the key (`openssl rand -base64 32`) or remove the production flag for the current run.
