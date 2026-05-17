# Frequently Asked Questions

Short answers to the questions that come up over and over. Things that need more than a paragraph live on their own page; this is the shortcut.

## About the platform

### What is TeslaSync, in one sentence?

A self-hosted Tesla fleet platform that ingests every signal Tesla emits, stores the history forever in TimescaleDB, sends the 65 supported remote commands, fires typed alerts, runs automations, and — if you opt in — adds an AI layer called Helix on top.

### How is it different from TeslaMate / TeslaFi / Tessie?

It's self-hosted, broader in scope (commands + alerts + automations + AI + analytics rather than mostly logging), and uses Fleet Telemetry as a first-class data path rather than only Tesla API polling.

### What does it cost?

The software is open source, MIT-licensed. The real costs are the infrastructure you run it on, the Tesla Developer account (free at time of writing, subject to Tesla's terms), and — if you opt in to a cloud Helix provider — the AI tokens you consume. Ollama (local) eliminates the AI cost in exchange for hardware.

### Do I need a beefy server?

No. A small VPS (2 vCPU / 4 GB RAM / 40 GB disk) handles a few vehicles comfortably. The data grows over years rather than days; budget disk based on how long you want to keep signal history. Add a GPU only if you want local Helix inference at low latency.

### What Tesla vehicles are supported?

Everything Tesla exposes through the Fleet API — that's the current modern fleet (Model S / 3 / X / Y / Cybertruck). Older pre-Fleet-API vehicles are not supported because Tesla itself has deprecated the legacy API path.

## Setup & connectivity

### Does TeslaSync require Fleet Telemetry?

No. After OAuth, the polling worker keeps state current. [Fleet Telemetry](/guide/fleet-telemetry) is recommended for lower-latency live state and lower API usage but it needs a publicly-reachable HTTPS endpoint and Tesla Developer setup.

### Do I have to expose the API to the public internet?

No. The recommended deployment exposes only the web service publicly. Nginx in the web container proxies `/api/*` to the internal API service over the cluster network. The API service stays `ClusterIP`.

### Can I put it behind Authentik / Authelia / oauth2-proxy?

Yes — that's the recommended path for any multi-user install. Set `FORWARD_AUTH_HEADER` (Helm: `config.forwardAuthHeader`) to the header your proxy injects:

| Provider                | Header                          |
| ----------------------- | ------------------------------- |
| Authentik               | `X-Authentik-Username`          |
| Authelia                | `Remote-User`                   |
| oauth2-proxy            | `X-Auth-Request-User`           |
| Custom proxy            | `X-Forwarded-User`              |

Public token routes (drive sharing, automation webhooks, Tesla's `/.well-known` path) bypass auth and use token + rate-limit protection instead.

### What happens if I don't set `FORWARD_AUTH_HEADER`?

The API runs in **open mode**: anonymous traffic passes through middleware on read paths, while identity-required endpoints (settings export, audit log, RBAC, API keys, impersonation, TOTP, scheduled exports) return `501 Not Implemented` with code `AUTH_MODE_OPEN`. This is intended for local trials on `localhost`. **Do not expose an open-mode install to the public internet** — there is no enforcement of who can read vehicle state.

### What OAuth scopes does TeslaSync request from Tesla?

Exactly five, hard-coded in `internal/tesla/client_auth.go`:

```
openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds
```

Your Tesla Developer application must have all five enabled. If any one is missing, OAuth completes but every Fleet API call returns `invalid_scope`. The [Tesla Fleet API guide](/guide/tesla-fleet-api#the-five-scopes-teslasync-requests) explains what each scope drops if missing.

### Do I have to register a partner account with Tesla?

Only if you want **Fleet Telemetry streaming** or **signed commands** (Model 3 / Y from 2021+, Model S / X refresh, Cybertruck). Polling-only installs that just read state and send unsigned commands work without partner registration.

Registration is a single `POST /api/v1/devtools/register-partner` call once the install is reachable at a public HTTPS domain. Full flow in [Tesla Fleet API setup](/guide/tesla-fleet-api#step-5-register-your-partner-account).

### Why does my browser ask me to install the app?

The web UI ships a PWA manifest. If you don't want PWA install prompts, your browser's settings let you disable them. The manifest is harmless if you ignore it.

## Data & storage

### What database does it use?

PostgreSQL 17 with the **TimescaleDB** and **pgvector** extensions. The bundled Compose image is `timescale/timescaledb-ha:pg17` which has both pre-installed.

### Why TimescaleDB rather than InfluxDB / VictoriaMetrics?

Because the platform is mostly relational and partly time-series. TimescaleDB lets the same query plan touch a `vehicles` row, a `drives` row, and a million `signal_log` rows in one statement. Splitting into two stores would be premature optimisation and would make joins painful.

### Is Redis required?

It's in the default stack and used as the L2 live-signal cache, the Pub/Sub fanout layer, and the rate-limit counter for Helix AI. You can disable it (`REDIS_ENABLED=false` / `LIVE_SIGNAL_STORE_MODE=local`) but then the live store is per-process only — fine for single-pod deployments, problematic the moment you scale horizontally.

### Is MongoDB required?

No. It's optional and only enabled for raw-signal capture during debugging. Most production deployments leave it disabled.

### How much data does it generate?

Roughly 1–5 GB per vehicle per year of telemetry, depending on how much you drive and whether you use Fleet Telemetry. Continuous aggregates collapse old data into rollups so chart queries stay fast even after years.

### Can I delete old data?

Yes — the platform has retention policies for the hypertables (`signal_log`, `positions`, raw telemetry) configured per environment. The default is "keep raw forever, keep aggregates forever, drop nothing". Tune via `RETENTION_*_DAYS` env vars.

## Helix AI

### What is Helix?

The opt-in AI layer. 54 user-facing features (chatbot, NL alert builder, narration, anomaly explanations, predictions, multimodal, automation suggestions, etc.) + 3 ops-only features. Off by default per feature. Providers: Ollama (local), OpenAI, Azure OpenAI / Foundry, Anthropic. Full reference at [Helix AI](/guide/helix-ai).

### Do I have to use Helix?

No. The entire AI layer ships disabled. None of the core features (telemetry, commands, alerts, analytics, exports, automations) require it. If you never flip a toggle, Helix is invisible.

### Will my data go to OpenAI / Anthropic / Azure?

Only if you (a) choose one of those as your active provider, AND (b) enable a Helix feature. If you stay on the default `ollama` provider, your data never leaves your server. If you use a cloud provider, the redaction decorator strips VINs / GPS / driver names / emails before the payload leaves your network (default-on, controlled by `AI_REDACTION_ENABLED`).

### How much will Helix cost me?

If you use Ollama, nothing per call (you pay for the hardware). If you use a cloud provider, set `AI_DAILY_BUDGET_USD` to a number you're comfortable with and Helix will refuse new calls once that day's spend would exceed it. The **Settings → Helix → Usage today** card shows live spend by feature.

### Why is the chatbot in the sidebar called "Helix"?

Because the chatbot is one Helix feature among many. Naming it "Chat" or "Assistant" would imply Helix == chat. The double-helix brand mark makes the AI surfaces visually consistent across the product.

## Day-to-day operation

### Why are my API calls doubled as `/api/v1/api/v1`?

The frontend hook included the prefix in error. Hooks must call `request('/vehicles')`, not `request('/api/v1/vehicles')`. The request client adds `/api/v1`.

### Why is the live data stale?

Walk this list in order: Fleet Telemetry server logs → MQTT broker connectivity → Redis L2 state → SSE connection in browser devtools → adaptive-polling fallback. Full walkthrough in [Troubleshooting](/guide/troubleshooting#live-data-is-stale).

### A remote command failed with "vehicle requires signed commands". What now?

Newer Tesla vehicles (Model 3/Y from 2021+, Model S/X refresh, Cybertruck) need the Vehicle Command Proxy. Set `TESLA_COMMAND_PROXY_URL` (Helm: `commandProxy.enabled`) and verify the proxy is reachable. `wake_up` is intentionally never proxied — it always goes direct.

### How many remote commands are supported, really?

**65** unique Tesla Fleet API endpoints across 17 categories. The full per-category breakdown is in [Remote Commands](/guide/remote-commands).

### Why does the dashboard sometimes flash "Polling"?

The SSE connection dropped — network blip, proxy timeout, server restart. The frontend transparently falls back to polling so data keeps updating, just slower. When the stream recovers, the indicator goes back to "Live". No action required.

### Can I run multiple replicas of `teslasync-api`?

Yes. Make sure `LIVE_SIGNAL_STORE_MODE=hybrid` so the L2 Redis cache is shared. Workers are stateless and scale horizontally too.

## Where things are

### Where are API routes defined?

Backend routes in `internal/api/router.go`. Helix AI routes in `internal/api/ai_routes.go`. Frontend hooks in `web/src/api/hooks/`.

### Where do I add a new feature?

[Adding Features](/contributing/adding-features) walks through the vertical-slice template. For Helix features specifically, the same page has the registry → strategy → wrapped route → aigen → withAiFeature workflow.

### Where is the schema diagram?

[Database](/guide/database) — the embedded interactive diagram covers every table.

### Where is the brand mark?

`web/src/components/branding/HelixMark.tsx` for the Helix double-helix glyph. The TeslaSync logo lives in `docs/public/logo.svg`.
