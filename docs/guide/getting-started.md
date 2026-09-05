# Getting Started

Your first milestone is a connected Tesla account, fresh data from a selected
vehicle, and a recorded drive or charging session you can inspect. This guide
separates installing TeslaSync from enabling Tesla connectivity.

## Before you begin

- Git and Docker with Compose v2. Container installation does not require Go or Node.js.
- A Tesla Developer Fleet API application, credentials, and appropriate permissions.
  Approval, regional availability, and billing are controlled by Tesla.
- A trusted, firewalled host for a local trial. A public deployment also needs TLS,
  an authenticating reverse proxy, strong secrets, and backups.
- For streaming: a compatible vehicle, reachable Fleet Telemetry receiver,
  registered application key, paired virtual key, and signed configuration.
  See [Fleet Telemetry](/guide/fleet-telemetry).

There is no guaranteed setup time or vehicle coverage. Check Tesla's current
requirements before buying hosting or exposing services. Helix AI is optional.

## 1. Prepare Tesla access

Follow [Tesla Fleet API setup](/guide/tesla-fleet-api) to create the application,
choose the region, and register the application with Tesla.

TeslaSync's authorization request contains **six scopes**:

```text
openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds
```

Grant the corresponding permissions in the developer portal and owner consent
flow. Missing permissions can prevent individual features from working.

Register the exact callback configured in `TESLA_REDIRECT_URI`. The repository's
local example is `http://localhost:8080/api/v1/auth/callback`; use
`https://your-domain.example/api/v1/auth/callback` for a public deployment.
Tesla's current portal rules determine which redirect URIs it accepts.

## 2. Clone and configure

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
```

On PowerShell, replace the last command with `Copy-Item .env.example .env`.
Edit these values; never commit `.env`:

```dotenv
TESLA_CLIENT_ID=your-client-id
TESLA_CLIENT_SECRET=your-client-secret
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback
TESLA_API_BASE_URL=https://fleet-api.prd.na.vn.cloud.tesla.com
```

Choose the regional base from the [Fleet API guide](/guide/tesla-fleet-api#step-2-pick-a-region).
Set `WEB_PORT` if the default `3000` is occupied. If changing the API's published
port, update the callback accordingly.

::: warning Environment files are not automatically container environments
Compose uses `.env` for interpolation. It only forwards variables declared in
`environment` or `env_file`. In particular, the current base Compose file does not
forward `ENCRYPTION_KEY` or `TESLA_COMMAND_PROXY_URL` to the API. Follow the
[explicit override instructions](/deployment/docker#required-environment-overrides)
before connecting an account or configuring signed telemetry.
:::

Use [Configuration](/guide/configuration) to choose authentication, encryption,
and storage settings. Generate a strong encryption key before first authorization
and back it up securely; losing it makes encrypted tokens unreadable.

## 3. Start a local trial

```bash
docker compose up -d --build
docker compose ps
```

Open **http://localhost:3000**, or your configured web port.
To inspect startup without exposing credentials in a shared terminal:

```bash
docker compose logs --tail=100 teslasync-api
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

In Windows PowerShell, use `curl.exe` for these HTTP checks.
Liveness means the process is running; readiness checks its dependencies.
Neither proves that Tesla authorization or telemetry works.

::: danger Local trial is not public deployment
The default stack can run without application authentication, and published
ports are not necessarily bound to localhost. Firewall the host. Before exposing
it, follow the [Docker production checklist](/deployment/docker#before-public-exposure).
Setting an identity header alone is not authentication: a trusted proxy must
authenticate users, overwrite that header, and be the only route to the API.
:::

## 4. Connect and configure a vehicle

Open **Settings → Fleet Setup** (`/settings/fleet-setup`) and connect your Tesla
account. Approve the requested access on Tesla's consent screen, return to
TeslaSync, and select a vehicle.

For Fleet Telemetry, complete the [receiver and key prerequisites](/guide/fleet-telemetry)
before choosing signals and intervals and submitting the subscription on this
page. It also provides wake, configuration removal, and Tesla-reported errors.
**A successful OAuth connection is not a telemetry subscription.**

Start with the signals you need; availability depends on vehicle hardware,
firmware, permissions, and Tesla's current API. Signals are sent on change subject
to configured minimum intervals, not guaranteed at a fixed sampling rate.

## 5. Verify your first useful data

1. Confirm your account is connected and the intended vehicle is selected.
2. Confirm the vehicle's telemetry configuration is synchronized, not merely submitted.
3. Check fresh timestamps in the live view while the vehicle is online and sending
   configured signals. Sleeping vehicles need not continuously update.
4. After a drive or charge, inspect its recorded detail and charts. Missing history
   from before installation is not automatically recovered.

If this fails, inspect receiver and API logs and the Fleet Setup error panel,
then follow [Troubleshooting](/guide/troubleshooting). Redact tokens, VINs,
locations, and account identifiers before sharing diagnostics.

## Next steps

- [Docker operations](/deployment/docker): profiles, updates, health checks, persistence.
- [Dashboard](/features/dashboard) and [analytics](/features/analytics): explore received data.
- [Backups](/features/backup-restore): test recovery before relying on stored history.
- [Helix AI](/guide/helix-ai): optional providers, privacy, and cost controls.
- [FAQ](/guide/faq): compatibility and deployment questions.
- [Contributing](/CONTRIBUTING): a separate path for local development and your first PR.
