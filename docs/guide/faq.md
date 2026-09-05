# Frequently Asked Questions

## What is TeslaSync?

Open-source Tesla intelligence on your infrastructure: recorded driving and
charging history, live vehicle views, analytics, alerts, automations, and optional
Helix AI. Start with [Getting Started](/guide/getting-started), not the AI setup.

## What does it cost?

The software is [MIT-licensed](https://github.com/ev-dev-labs/teslasync/blob/main/LICENSE).
Budget for hosting, storage, backups, a domain, Tesla API/telemetry usage under
[Tesla's current billing terms](https://developer.tesla.com/docs/fleet-api/billing-and-limits),
and any external integrations. Hosted AI providers may charge separately.
Local Ollama avoids hosted-model fees, not hardware and electricity costs.

## What hardware do I need?

Docker with Compose v2 is the installation path. Resource needs depend on vehicle
count, signal frequency, retention, enabled services, and local AI models. There
is no universal sizing guarantee; monitor disk, memory, CPU, and database growth
on your workload. Go and Node.js are only needed for source development.

## Which vehicles and signals are supported?

Availability depends on Tesla's Fleet API access, region, vehicle hardware,
firmware, owner permissions, and configured signals. Do not assume every model
exposes every field or command. Tesla's
[Fleet Telemetry compatibility notes](https://github.com/teslamotors/fleet-telemetry#vehicle-compatibility)
identify firmware requirements and older Model S/X exclusions. Check your vehicle's
reported configuration and errors during setup.

## Is connecting my Tesla account enough to enable streaming?

No. OAuth grants account access; it does not deploy a receiver or subscribe a
vehicle. Follow [Fleet API setup](/guide/tesla-fleet-api), then
[Fleet Telemetry](/guide/fleet-telemetry). Use **Settings → Fleet Setup**
(`/settings/fleet-setup`) to select the vehicle, signals, and intervals and submit
the configuration. Wait for synchronization and verify fresh incoming data.

## Are virtual keys only for remote commands?

No. Tesla's [official telemetry setup](https://github.com/teslamotors/fleet-telemetry#setup-steps)
includes pairing the application's virtual key and configuring the signing proxy
before sending the telemetry configuration. Application registration, pairing,
and a reachable mTLS receiver are separate prerequisites.

## Which OAuth scopes are requested?

Six: `openid`, `offline_access`, `vehicle_device_data`, `vehicle_location`,
`vehicle_cmds`, and `vehicle_charging_cmds`. Missing grants affect the corresponding
features. See the [scope reference](/guide/tesla-fleet-api#the-six-scopes-teslasync-requests)
and reauthorize after changing access.

## Can I expose the default Compose stack to the internet?

Not safely without additional configuration. Open mode does not authenticate
users, and Compose publishes several ports. Use a trusted authenticating proxy,
overwrite the configured identity header, block direct API access, configure TLS
and strong secrets, and test backups. See the
[production checklist](/deployment/docker#before-public-exposure).
The receiver's public mTLS endpoint and anonymous public-key URL need separate routing.

## Why did setting a variable in `.env` have no effect?

Compose uses `.env` for interpolation, not automatic forwarding. A variable must
be mapped into the service environment. See
[required overrides](/deployment/docker#required-environment-overrides), especially
for `ENCRYPTION_KEY` and `TESLA_COMMAND_PROXY_URL`.

## Does self-hosted mean my data never leaves my server?

No. Tesla connectivity uses Tesla services, and enabled integrations can send
data externally. Helix is optional; hosted providers receive request context.
Review [Helix privacy controls](/guide/helix-ai), configured destinations, and
provider terms. Redaction reduces exposure but is not a guarantee that no
sensitive information leaves the deployment.

## How long is history kept?

Retention depends on the deployed schema and retention jobs. Storage is not
unlimited, and aggregate data is not a replacement for raw history in every view.
Check your deployment's policies and disk growth, then establish and test
[backups](/features/backup-restore). Historical data before installation is not
automatically reconstructed.

## Why is live data missing or stale?

Check vehicle connectivity and configuration synchronization, then the Fleet Setup
error panel, receiver logs, MQTT, API ingest, and browser connectivity. A sleeping
vehicle or unchanged signal need not publish continuously. UI fallback polling
is not proof that new vehicle telemetry is arriving.
Continue with [Troubleshooting](/guide/troubleshooting).

## Can I run multiple API replicas?

Redis provides shared live reads and fanout, but does not by itself make
vehicle state machines and reconciliation active-active. Plan vehicle ownership,
leases, or affinity before scaling ingest processes. See
[Architecture](/guide/architecture) and [Kubernetes deployment](/deployment/kubernetes).

## How do I contribute or report a problem?

Use the [contributor entry guide](/CONTRIBUTING) for your first change.
For an issue, include the version, deployment method, reproduction steps, and
redacted diagnostics. Never post tokens, private keys, VINs, or precise locations.
Report vulnerabilities through the repository's
[security policy](https://github.com/ev-dev-labs/teslasync/blob/main/SECURITY.md).
