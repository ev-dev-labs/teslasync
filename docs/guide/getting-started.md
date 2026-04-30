# Getting Started

This guide gets a local TeslaSync stack running with Docker Compose. Use the Kubernetes guide when you are ready for a production-style install.

## Prerequisites

- Docker and Docker Compose
- Tesla Developer account and Fleet API application credentials
- Git
- Optional: `make`, `go` 1.25, Node 20 for local development outside containers

## 1. Clone and configure

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
```

Edit `.env` and set at minimum:

```txt
TESLA_CLIENT_ID=your-client-id
TESLA_CLIENT_SECRET=your-client-secret
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback
TESLA_API_BASE_URL=https://fleet-api.prd.na.vn.cloud.tesla.com
```

For production, the redirect URI must use your public HTTPS domain.

## 2. Start the stack

```bash
docker compose up -d --build
```

Default local endpoints:

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API | http://localhost:8080 |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9099 |
| MQTT | localhost:1883 |

## 3. Connect Tesla

Open the web UI, start the Tesla OAuth flow, and authorize the app. TeslaSync stores tokens encrypted in the database and uses them for vehicle sync, commands, and Fleet Telemetry setup.

## 4. Verify health

```bash
docker compose ps
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

The web app should load the dashboard, and the API should report healthy/readiness JSON responses.

## 5. Install as a PWA

In a supported browser, open the app from HTTPS or localhost and use the browser install action. TeslaSync includes a standalone manifest, app icons, update prompt, and offline app-shell/map-tile caching. Live API data still requires the backend network path.

## Next steps

- [Configuration](/guide/configuration)
- [Docker deployment](/deployment/docker)
- [Kubernetes deployment](/deployment/kubernetes)
- [Fleet Telemetry](/guide/fleet-telemetry)
