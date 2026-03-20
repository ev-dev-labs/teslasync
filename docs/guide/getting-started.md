# Getting Started

This guide walks you through setting up TeslaSync from scratch. By the end, you'll have a fully running instance tracking your Tesla fleet.

## Prerequisites

Before you begin, make sure you have the following installed on your machine:

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| [Docker](https://docs.docker.com/get-docker/) | 24.0+ | Container runtime |
| [Docker Compose](https://docs.docker.com/compose/install/) | 2.20+ | Multi-service orchestration |
| [Git](https://git-scm.com/) | 2.30+ | Clone the repository |

For local development without Docker, you'll also need:

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| [Go](https://go.dev/dl/) | 1.22+ | Backend compilation |
| [Node.js](https://nodejs.org/) | 20 LTS | Frontend build tooling |
| [PostgreSQL](https://www.postgresql.org/) | 16+ | Database (with TimescaleDB extension) |

### Tesla Developer Account

You **must** register a Tesla developer application to obtain API credentials:

1. Go to [developer.tesla.com](https://developer.tesla.com/) and sign in with your Tesla account.
2. Create a new application.
3. Note down your **Client ID** and **Client Secret**.
4. Set the **Redirect URI** to `http://localhost:8080/api/v1/auth/callback` (or your production URL).

::: warning
Tesla API access requires an active Tesla account with at least one vehicle linked. The Fleet API is rate-limited — TeslaSync includes a circuit breaker to handle this gracefully.
:::

## Clone the Repository

```bash
git clone https://github.com/your-org/TeslaSync.git
cd TeslaSync
```

## Configure Environment Variables

Copy the example environment file and fill in your Tesla API credentials:

```bash
cp .env.example .env
```

Open `.env` in your editor and set the required values:

```bash
# Tesla API (REQUIRED)
TESLA_CLIENT_ID=your-client-id-here
TESLA_CLIENT_SECRET=your-client-secret-here
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback

# Database (defaults work for Docker Compose)
POSTGRES_USER=teslasync
POSTGRES_PASSWORD=teslasync
POSTGRES_DB=teslasync
```

See the [Configuration](/guide/configuration) page for all available options.

## Start with Docker Compose

The fastest way to get TeslaSync running is with Docker Compose, which starts all 6 services:

```bash
docker compose up -d
```

This will start:

| Service | Port | Description |
|---------|------|-------------|
| **web** | [localhost:3000](http://localhost:3000) | React frontend (Nginx) |
| **teslasync** | [localhost:8080](http://localhost:8080) | Go API server |
| **postgres** | localhost:5432 | TimescaleDB database |
| **grafana** | [localhost:3001](http://localhost:3001) | Monitoring dashboards |
| **mosquitto** | localhost:1883 | MQTT broker |
| **redis** | localhost:6379 | Cache layer |

### Verify Services Are Running

```bash
# Check all containers are healthy
docker compose ps

# Check backend health
curl http://localhost:8080/healthz

# Check readiness (DB + Tesla API)
curl http://localhost:8080/readyz
```

## Authenticate with Tesla

Once the services are running, you need to link your Tesla account:

1. Open the TeslaSync web UI at [http://localhost:3000](http://localhost:3000).
2. Navigate to **Settings** or click the login prompt.
3. You'll be redirected to Tesla's OAuth2 login page.
4. Sign in with your Tesla account and authorize TeslaSync.
5. After authorization, you'll be redirected back to TeslaSync.

Alternatively, use the API directly:

```bash
# Get the Tesla OAuth login URL
curl http://localhost:8080/api/v1/auth/login

# Check authentication status
curl http://localhost:8080/api/v1/auth/status
```

## Sync Your Vehicles

After authentication, sync your fleet:

```bash
# Via API
curl -X POST http://localhost:8080/api/v1/vehicles/sync

# Or use the web UI's "Sync Vehicles" button on the Vehicles page
```

TeslaSync will begin polling your vehicles at the configured interval (default: every 15 seconds) and storing telemetry data.

## Explore the Dashboard

Open [http://localhost:3000](http://localhost:3000) to access the full web interface:

- **Dashboard** — Fleet overview with live stats
- **Live Map** — Real-time GPS tracking
- **Vehicles** — Vehicle details and current state
- **Drives** — Historical drive data
- **Charging** — Charging session history and costs
- **Analytics** — Fleet-wide metrics and charts

## Next Steps

- [Configuration](/guide/configuration) — Tune polling intervals, data retention, and more
- [Local Development](/guide/local-development) — Set up the dev environment
- [Architecture](/guide/architecture) — Understand how TeslaSync works under the hood
- [Docker Deployment](/deployment/docker) — Production Docker setup
