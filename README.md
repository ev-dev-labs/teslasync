<p align="center">
  <img src="web/public/icons/icon-192.svg" width="80" height="80" alt="TeslaSync" />
</p>

<h1 align="center">TeslaSync</h1>

<p align="center">
  <strong>Self-hosted Tesla fleet intelligence — with Helix AI built in.</strong><br>
  Telemetry, analytics, automation, remote control, and an opt-in AI assistant for one car or a fleet — all on infrastructure you control.
</p>

<p align="center">
  <a href="#what-it-does">What it does</a> •
  <a href="#helix-ai">Helix AI</a> •
  <a href="#remote-vehicle-control">Remote control</a> •
  <a href="#quick-start">Quick start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white" alt="Go 1.25" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/TimescaleDB-PostgreSQL%2017-336791?logo=postgresql&logoColor=white" alt="TimescaleDB" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## What it does

TeslaSync is a self-hosted platform that turns your Tesla data into a real
product: ingestion, history, dashboards, alerts, automations, remote commands,
and an optional AI assistant called **Helix**. Everything runs in Docker or
Kubernetes on hardware you control. Your telemetry never leaves your network
unless you choose to send it somewhere.

### At a glance

| | |
|---|---|
| Backend | Go 1.25 · Chi v5 · pgx v5 · zerolog · Prometheus · OpenTelemetry |
| Frontend | React 18 + TypeScript · Vite 5 · TanStack Query 5 · Tailwind · Framer Motion · i18next |
| Storage | PostgreSQL 17 + TimescaleDB · pgvector · Redis 7 |
| Streaming | Tesla Fleet Telemetry (gRPC) · MQTT · SSE · polling fallback |
| Deployment | Docker Compose (13 services) · Helm chart |
| Vehicle control | 65+ Tesla command endpoints via Fleet API or Vehicle Command Proxy |
| AI | **Helix** — 54 opt-in user features powered by a pluggable provider chain |
| Schema | 197 numbered SQL migrations · TimescaleDB hypertable for `signal_log` |
| Frontend feature areas | 21 (admin, analytics, automations, battery, charging, dashboard, diagnostics, driving, exports, maps, notifications, onboarding, power-user, settings, sharing, system, telemetry, trips, vehicle-systems, vehicles, watch) |

---

## Helix AI

Helix is TeslaSync's optional AI layer. The brand mark (`HelixMark`) appears
anywhere AI is in play — sidebar nav, chatbot avatar, feature badges, AI
settings header.

> **Off by default, opt-in per feature.** There is no global "AI on" switch.
> Each Helix feature is individually enabled from **Settings → AI**. Disabled
> features are *invisible*: their HTTP routes return 404, their React routes
> mount no AI UI, their background jobs and push notifications never fire.

### Surfaces

| Surface | Route | What it is |
|---|---|---|
| **Helix Chat** | `/chatbot` | Evidence-first fleet agent with live tool use, cross-domain analysis, app knowledge, and visible provenance |
| **AI Settings** | `/settings/ai` | Per-feature toggles, provider config, usage card, redaction controls |
| **AI Usage Card** | `/settings/ai` | Per-call audit log + spend visualisation across providers |
| **AI Restore Panel** | `/settings/ai` | Re-issue a past AI answer from the audit log |
| **Inline AI components** | various pages | 55+ `AI*.tsx` widgets gated by `withAiFeature` |

### The 54 features (grouped)

**Narratives & summaries**
Weekly digest narration · Year-in-review narration · Period-compare narration ·
TCO narration · Cost-forecast narration · Battery-health forecast narrative ·
Cabin-temperature impact narrative · Vampire-drain explanation

**Natural-language builders**
NL alert rule builder · NL automation builder · NL dashboard composer ·
NL Grafana panel builder · NL SQL playground · NL drive search & replay ·
NL signal-explorer filter · NL search

**Predictions & ML**
Range prediction model · Predictive maintenance · Smart charge schedule ·
Preheat / precool recommender · Charging-curve fingerprint clustering ·
ML charging-curve clustering · Learned per-vehicle anomaly baselines

**Explainers & coaching**
Drive coaching · Safety-setting explainer · Anomaly explanations ·
MQTT / SSE inspector explanations · State-machine debugger narrator ·
Log / trace summarization · Software-update changelog summarizer ·
Incident timeline summarizer · Charging diagnosis · Speed-profile insights ·
Route-efficiency suggestions · Tire-pressure trend reasoning

**Automation & operations**
Alert-tuning suggestions · Cross-rule conflict detection · Quiet-hours
suggestion · Inbox auto-categorization · Feedback-queue triage ·
Data-repair suggestions · Geofence-aware automation suggestions ·
Suggest new geofences · Auto-name unnamed locations · Auto trip naming

**Multimodal & misc**
Voice mode · Watch-face NL response · Trip planner LLM agent ·
Trip postcard share-card image generation · Vehicle paint preview ·
PII redaction for shared exports · RAG help · Lifetime stats Q&A ·
Chatbot LLM

Plus 3 ops-only features: AI Usage Card, AI Provider Health, AI Redaction
Bypass Report — also off by default.

### How Helix stays trustworthy

- **Single source of truth** — every feature lives in
  `internal/ai/features/registry.go`. Adding a feature means adding an entry,
  not touching the form. The frontend mirror `web/src/ai/features.ts` is
  **generated** by `tools/aigen`; CI runs `go run ./tools/aigen --check` and
  blocks merge if the two drift.
- **Off-by-default contract** — verified by `tools/aivet` and a final-gate
  test suite. Every surface (HTTP route, React route, background job, push
  kind) is enumerated in the registry and walked in CI to assert that
  `ai_mode='off'` produces 404s, no DOM nodes carrying `data-ai-feature`,
  no job execution, and no push delivery.
- **Per-call audit log** — every invocation is recorded with feature ID,
  provider, latency, token counts, and redaction status. Visible in the
  AI Usage Card.
- **Evidence-first answers** — a shared intelligence contract requires
  fleet claims to come from current tool or context evidence, separates
  observations from inference, and surfaces sparse or conflicting data.
  Helix surfaces show the tools used and their completion state.
- **Real streaming tool use** — provider tokens and fragmented function calls
  stream end to end. OpenAI, Azure OpenAI, Anthropic, and Ollama tool calls are
  normalized before execution; incomplete streams fail instead of producing
  a success-shaped answer.
- **Outbound PII redaction** — every request passes through an F8 redact
  decorator before leaving the network. Per-(feature, provider) bypass
  events are surfaced in the Redaction Bypass Report.
- **Pluggable provider chain** — adapters for OpenAI, Azure OpenAI,
  Anthropic, and local Ollama; primary + fallback configurable per feature.
- **Strict per-feature gate** — `g.Wrap("<feature-id>", handler)` wraps every
  route; `withAiFeature("<feature-id>")` wraps every React component;
  `aivet` refuses to build if either is missing.

Full Helix documentation: [`docs/guide/helix-ai.md`](docs/guide/helix-ai.md).

---

## Remote vehicle control

TeslaSync exposes **65 unique Tesla Fleet API command endpoints** organised by
domain. Commands that require Tesla's signed-command envelope (Model 3/Y from
2021+, all Model S/X refresh, all Cybertruck) are routed automatically through
a [Vehicle Command Proxy](https://github.com/teslamotors/vehicle-command) when
one is configured; `wake_up` always goes direct to Fleet API.

| Category | Endpoints | Examples |
|---|---:|---|
| Wake | 1 | `wake_up` |
| Security & access | 10 | `door_lock`, `door_unlock`, `set_sentry_mode`, `speed_limit_activate/deactivate/set_limit/clear_pin/clear_pin_admin`, `guest_mode`, `erase_user_data` |
| Valet & PIN-to-drive | 5 | `set_valet_mode`, `reset_valet_pin`, `set_pin_to_drive`, `reset_pin_to_drive_pin`, `clear_pin_to_drive_admin` |
| Climate | 3 | `auto_conditioning_start/stop`, `set_temps` |
| Seat & steering heat | 6 | `remote_seat_heater_request`, `remote_seat_cooler_request`, `remote_auto_seat_climate_request`, `remote_steering_wheel_heater_request`, `remote_steering_wheel_heat_level_request`, `remote_auto_steering_wheel_heat_climate_request` |
| Climate protection | 7 | `set_bioweapon_mode`, `set_cabin_overheat_protection` (incl. fan-only), `set_cop_temp`, `set_climate_keeper_mode` (Off / Keep / Dog / Camp), `set_preconditioning_max` |
| Charging | 8 | `charge_port_door_open/close`, `charge_start`, `charge_stop`, `set_charge_limit`, `set_charging_amps`, `charge_max_range`, `charge_standard` |
| Trunk & frunk | 1 | `actuate_trunk` (`which_trunk=front` or `rear`) |
| Alerts | 2 | `honk_horn`, `flash_lights` |
| Boombox | 1 | `remote_boombox` (fart, ping, custom) |
| Windows & sunroof | 2 | `window_control` (vent / close), `sun_roof_control` (vent / close / stop) |
| HomeLink | 1 | `trigger_homelink` |
| Remote start | 1 | `remote_start_drive` |
| Media | 7 | `media_toggle_playback`, `media_next_track`, `media_prev_track`, `media_next_fav`, `media_prev_fav`, `media_volume_down`, `adjust_volume` |
| Charge & precondition schedules | 6 | `add_charge_schedule`, `remove_charge_schedule`, `add_precondition_schedule`, `remove_precondition_schedule`, `set_scheduled_charging`, `set_scheduled_departure` |
| Navigation | 3 | `navigation_request`, `navigation_gps_request`, `navigation_sc_request` |
| Software updates | 2 | `schedule_software_update`, `cancel_software_update` |
| Vehicle metadata | 1 | `set_vehicle_name` |

Full per-command reference (friendly aliases, parameters, signing
requirements): [`docs/guide/remote-commands.md`](docs/guide/remote-commands.md)
and source of truth `internal/tesla/client_commands.go`.

---

## Real-time telemetry

- **Tesla Fleet Telemetry** — gRPC streaming. The vendored `vehicle_data.proto`
  plus `go generate` keep the codec, signal metadata, and routing table in
  lock-step with upstream.
- **MQTT** — publish / subscribe to live signals; embedded Mosquitto in
  Docker Compose, any external broker via Helm.
- **SSE** — Server-Sent Events push live state to the browser. Singleton
  connection per tab, automatic reconnect, instant vehicle + alert updates.
- **Polling fallback** — `/api/1/vehicles/{id}/vehicle_data` on a schedule
  when streaming is unavailable.
- **Two-layer signal store**
  - L1: in-process `signal.Store` (nanosecond reads, FSM / sessions hot path)
  - L2: Redis `vehicle:{id}:signals` HSET + Pub/Sub (cross-pod, restart recovery)
  - Durable history: `signal_log` TimescaleDB hypertable (every signal kept
    forever for charts, replay, and point-in-time reconstruction)

---

## Features

### Operations & fleet
Dashboard · Live map with 5 tile layers (CARTO Dark default, Azure Maps,
Google Maps, Esri Satellite, OpenStreetMap, OpenTopoMap) · Vehicle detail ·
Command history · State-machine timeline · Command palette (Cmd/Ctrl+K) ·
PWA installable · 5 dynamic themes × 4 display modes

### Charging
Sessions · Charging curve · Cost analysis · Charging heatmap (7×24) ·
Tesla billing history · Charge limit & amp control · Schedules (legacy +
firmware 2024.26+) · Preconditioning

### Energy & battery
Battery health · Cell voltage spread (4×23 pack visualisation) ·
Pack voltage / current · BMS · Powershare · Vampire drain · Energy flow ·
Degradation projection with linear regression

### Driving
Drive list · Drive detail · Drive Score (0–100 efficiency) · Speed profile ·
Motor torque · G-forces · Pedal usage · Stator / inverter / heatsink temps ·
Trip replay (animated) · Route efficiency comparison · Regen ratio

### Analytics
Monthly statistics · True cost of ownership (EV vs gas) · Sleep efficiency ·
Temperature impact (efficiency vs ambient) · Weekly digest · Year-in-review ·
Projected range under different conditions (highway, city, cold, hot, sentry) ·
Fleet comparison

### Alerts & automation
**Alert Studio** at `/alert-studio` — visual rule builder over the full Tesla
signal catalog (230 entries). **CEP rule engine** with recursive AND/OR/NOT
condition trees, 11 operators, `for_seconds` temporal sustain,
`changed_to`/`changed_from` transition detection, per-rule cooldown,
multi-channel dispatch, server-side quiet hours, 50+ rule templates,
test-notification flow with signal-value interpolation
(`{{BatteryLevel}}` etc.).

### Diagnostics & developer tools
Live signal monitor · Signal log viewer · Signal explorer (chart any signal) ·
Signal diff · Signal gap detector · State-machine debugger · MQTT inspector ·
DB health dashboard · 25+ Tesla API developer tools (VIN decoder, JWT decoder,
partner registration, API playground, raw fleet-telemetry config / errors,
signal config modal, …)

### Backup & restore
Scheduled automated backups (daily to every 30 days) · Full + incremental ·
Multi-provider storage (Local, Amazon S3, Azure Blob, Google Cloud Storage) ·
Gzip + SHA-256 integrity verification · Configurable retention (last N,
max 100) · Download, verify, preview restore from UI · Complete run history ·
One-click manual quick backup

### Maps & geocoding
Multi-provider map tiles with auto-selection by API key · Layer switcher on
all 5 map pages · Geocoding priority: geofence name → places cache →
Google/Azure/Nominatim · Places cache (~90% API call reduction) ·
Reverse-geocoded drives and charging sessions

### Observability
Prometheus `/metrics` · 28 Grafana dashboards (deep analytics, CEP, SSE
real-time, infrastructure) · OpenTelemetry instrumentation (OTLP gRPC export) ·
Jaeger profile in Docker Compose · Structured zerolog JSON logs ·
Per-repo DB spans with semantic conventions

### Engineering invariants
- **SI canonical** — every DB column, API field, and Go/TS type stores SI
  units (m, m/s, °C, Pa, Wh). User display preference (mi/km, °F/°C, psi/bar)
  is applied **only at the React render boundary** by `useUnits()` /
  `useFormatting()`. No legacy unit converters downstream.
- **100% Tesla Fleet Telemetry coverage** — vendored proto + `go generate`.
- **Auto-generated AI feature mirror** — backend and frontend cannot drift
  on the set of Helix feature IDs.

---

## Quick start

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
# Edit .env with Tesla Developer credentials and your deployment URLs
docker compose up -d --build
```

Windows users: replace `cp .env.example .env` with `Copy-Item .env.example .env`.

Default ports:

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API | http://localhost:8080 |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9099 |
| Jaeger (optional, `--profile tracing`) | http://localhost:16686 |

### What the quick start actually gives you

`docker compose up -d --build` brings up the stack in **open mode** (no `FORWARD_AUTH_HEADER` set) — fine for a local trial on `localhost`, **not** safe to expose publicly. The Tesla OAuth flow needs all five scopes ticked on your Tesla Developer application (`openid offline_access vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds`); any missing scope produces a working-looking dashboard with empty vehicle pages. The compose file uses `timescale/timescaledb-ha:pg17` because migration 1 installs TimescaleDB + pgvector — upstream `postgres:17` will fail to start.

For Fleet Telemetry streaming or signed commands you also need:

- A publicly-reachable HTTPS domain with valid TLS
- A registered partner account with Tesla (one-time `POST /api/v1/devtools/register-partner` once the public domain is live)
- The `commands` and/or `telemetry` Compose profiles enabled

Full step-by-step setup including the auth model decision, partner-key flow, regional Fleet API bases, and Helix AI provider choices:
[`docs/guide/getting-started.md`](docs/guide/getting-started.md) · [`docs/guide/tesla-fleet-api.md`](docs/guide/tesla-fleet-api.md).

---

## Architecture

```
                ┌──────────────────────┐
                │      Browsers        │
                │  React SPA + PWA     │
                └─────────┬────────────┘
                          │  HTTPS / SSE
                          ▼
┌────────────────────────────────────────────────────┐
│              Go API (Chi v5)                       │
│  ┌────────────────┐   ┌───────────────────────┐    │
│  │ Vehicle ops    │   │ Helix AI router       │    │
│  │ Telemetry      │   │  • feature gate       │    │
│  │ Charging       │   │  • redact decorator   │    │
│  │ Alerts / CEP   │   │  • provider chain     │    │
│  │ Automations    │   │  • per-call audit     │    │
│  │ Backups        │   │  • tool registry      │    │
│  └────────────────┘   └───────────────────────┘    │
└─────┬───────────────────┬────────────────────┬─────┘
      │                   │                    │
      ▼                   ▼                    ▼
┌───────────┐      ┌─────────────┐       ┌──────────┐
│ Postgres  │      │ Redis 7     │       │ MQTT     │
│ Timescale │      │  • L2 store │       │ Mosquitto│
│  + signal │      │  • cache    │       └──────────┘
│   _log    │      │  • Pub/Sub  │
└───────────┘      └─────────────┘
      ▲                   ▲
      │                   │
┌─────┴───────────────────┴─────┐    ┌──────────────────────┐
│   Tesla Fleet Telemetry       │    │ Vehicle Command      │
│   gRPC subscriber + codec     │    │ Proxy (signs cmds)   │
└──────────────────────────────┬┘    └──────────┬───────────┘
                               │                │
                               ▼                ▼
                          ┌──────────────────────────┐
                          │     Tesla Fleet API      │
                          └──────────────────────────┘
```

Detail: [`docs/guide/architecture.md`](docs/guide/architecture.md).

---

## Documentation

| | |
|---|---|
| 🚀 [Getting started](docs/guide/getting-started.md) | Install, configure, first run |
| 🔑 [Tesla Fleet API setup](docs/guide/tesla-fleet-api.md) | Developer app, scopes, regions, partner registration |
| 🧠 [Helix AI](docs/guide/helix-ai.md) | Features, providers, audit, redaction |
| 🎮 [Remote commands](docs/guide/remote-commands.md) | All 65 Tesla commands |
| 🏛 [Architecture](docs/guide/architecture.md) | Services, data flow, schema |
| ⚙ [Configuration](docs/guide/configuration.md) | Environment variables |
| 📡 [Fleet Telemetry](docs/guide/fleet-telemetry.md) | gRPC streaming setup |
| 🗄 [Database](docs/guide/database.md) | Schema, hypertables, migrations |
| 🔌 [API endpoints](docs/guide/api-endpoints.md) | REST + SSE reference |
| 🐳 [Docker deployment](docs/deployment/docker.md) | Compose setup |
| ☸ [Kubernetes](docs/deployment/kubernetes.md) | Helm chart |
| 🛟 [Troubleshooting](docs/guide/troubleshooting.md) | Common issues |
| ❓ [FAQ](docs/guide/faq.md) | |
| 🛠 [Local development](docs/guide/local-development.md) | Dev loop |
| 🤝 [Contributing](docs/contributing/code-structure.md) | |

---

## Repository layout

```
.
├─ cmd/                       Go entry points (api, workers, tools)
├─ internal/
│  ├─ api/                    HTTP handlers (incl. 57 ai_*_handler.go files)
│  ├─ ai/
│  │  ├─ features/registry.go Source of truth for AI features
│  │  ├─ strategies/          Per-feature strategy.go + goldens.yaml (53 strategies)
│  │  └─ tools/               Tool registry the LLM can call (50+ tools)
│  ├─ tesla/                  Fleet API client, 65 command endpoints, proxy router
│  ├─ signal/                 L1 in-process store
│  ├─ fsm/                    Vehicle state machine
│  ├─ cep/                    Complex-event processing for alerts
│  └─ ...
├─ web/
│  └─ src/
│     ├─ ai/features.ts       Auto-generated from internal/ai/features
│     ├─ components/
│     │  ├─ ai/               55+ AI* components, gated by withAiFeature
│     │  └─ branding/         HelixMark — the Helix brand icon
│     ├─ features/            21 feature areas
│     └─ ...
├─ migrations/                197 numbered SQL migration files
├─ docs/                      User & contributor documentation
├─ helm/teslasync/            Production Helm chart
├─ tools/
│  ├─ aigen/                  Generates web/src/ai/features.ts from Go registry
│  └─ aivet/                  CI vet for AI feature contract
└─ docker-compose.yml         13 services
```

---

## Contributing

See [`docs/contributing/code-structure.md`](docs/contributing/code-structure.md)
and the topical instructions under [`.github/instructions/`](.github/instructions/)
(Go backend, React frontend, Tesla pipeline, telemetry pipeline, observability,
data modeling, i18n, prompt engineering, Helm / Docker).

Before opening a PR:

```bash
# backend
go test ./... -race
go vet ./...
go run ./tools/aivet          # AI feature contract check
go run ./tools/aigen --check  # ensure web/src/ai/features.ts is in sync

# frontend
cd web
npm install
npm run lint                  # ESLint + 25+ custom audit scripts
npm run test                  # Vitest
```

---

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

Built on Tesla's [Fleet API](https://developer.tesla.com/docs/fleet-api),
[Fleet Telemetry](https://github.com/teslamotors/fleet-telemetry), and the
[Vehicle Command Proxy](https://github.com/teslamotors/vehicle-command).
