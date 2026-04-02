# FAQ

Frequently asked questions about TeslaSync.

## General

### What is TeslaSync?
TeslaSync is a self-hosted Tesla fleet intelligence platform that collects, stores, and visualizes data from your Tesla vehicles. It provides real-time monitoring, advanced analytics, remote vehicle control, and smart notifications — all from a modern web interface.

### Is TeslaSync free?
Yes. TeslaSync is open-source and free to use. You host it on your own hardware.

### What Tesla models are supported?
Any Tesla vehicle accessible through the Tesla Fleet API, including Model S, 3, X, Y, Cybertruck, and Semi.

### Does TeslaSync affect my vehicle warranty?
No. TeslaSync uses the official Tesla Fleet API — the same interface Tesla's own app uses. It does not modify vehicle firmware or bypass any protections.

### How much data does TeslaSync collect?
TeslaSync uses Tesla's **Fleet Telemetry streaming** (not polling) — your vehicle pushes data in real time via MQTT. With **231 subscribed signals** across 11 subsystems, data is written to **15+ snapshot and telemetry tables**:

- **Positions**: ~1,440–2,880 rows/day per vehicle while driving (GPS streamed every 30s)
- **Snapshot tables**: Battery, climate, tire pressure, motor, media, safety, location, vehicle state, and more — updated on every state change
- **Drive telemetry**: High-frequency readings (~25 fields per row) during each drive session
- **Charge telemetry**: Detailed charge curves (~18 fields per row) during each charge session
- **Session summaries**: 1 row per drive, 1 row per charge session (with aggregated stats)
- **Storage estimate**: ~1–3 GB/year per vehicle (compressed, with default 365-day retention)

Data volume varies based on driving frequency and how often signals change. The 100ms batching window deduplicates rapid signal updates to reduce write load.

## Setup & Configuration

### What are the system requirements?
- **CPU**: 1+ cores (2 recommended)
- **RAM**: 1 GB minimum (2 GB recommended)
- **Storage**: 10 GB minimum (SSD recommended for database)
- **Docker**: Docker Engine 20+ with Docker Compose v2

### How do I get Tesla API credentials?
1. Visit [developer.tesla.com](https://developer.tesla.com)
2. Create a developer account
3. Register an application
4. Note your `Client ID` and `Client Secret`
5. Set the callback URL to match `TESLA_REDIRECT_URI` in your `.env`

### Can I run TeslaSync without Docker?
Yes, but it requires manual setup:
1. Install PostgreSQL 17
2. Install Redis 7
3. Install Mosquitto 2 (optional, for MQTT)
4. Build the Go backend: `go build -o teslasync ./cmd/server`
5. Build the frontend: `cd web && npm run build`
6. Serve the frontend with Nginx or another web server

### Can I use an external database?
Yes. Set `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` in your `.env` to point to your external PostgreSQL instance.

## Features

### What data can I visualize?
- Real-time vehicle location on a map
- Battery level, range, and degradation over time
- Drive history with speed, distance, efficiency, and route replay
- Charging sessions with cost tracking and charger type breakdown
- Monthly statistics with inline trend indicators
- Vehicle state timeline (driving, charging, sleeping, online)
- Tire pressure monitoring
- Software update history
- Vampire (phantom) drain analysis
- Fleet-wide analytics and comparisons

### What notifications does TeslaSync support?
TeslaSync can send alerts via 7 channels:
- Discord (webhook)
- Slack (webhook)
- Telegram (bot)
- Email (SMTP)
- Webhooks (custom HTTP)
- ntfy (push notification)
- Pushover

### Can I control my vehicle from TeslaSync?
Yes. Available commands include:
- Lock / Unlock
- Climate on / off
- Start / Stop charging
- Open charge port
- Open frunk / trunk
- Activate / deactivate Sentry Mode
- Honk horn
- Flash lights

### Does TeslaSync work with Home Assistant?
Yes, via MQTT. TeslaSync publishes vehicle telemetry to MQTT topics that Home Assistant can subscribe to. See the [Architecture](/guide/architecture) page for the topic structure.

### What are Smart Insights?
TeslaSync analyzes your driving and charging data to surface actionable insights, such as:
- Cost savings vs gasoline
- Efficiency trends over time
- Optimal charging habits for battery health
- Vampire drain patterns and recommendations
- Driving behavior analysis

## Privacy & Security

### Where is my data stored?
All data is stored locally on your server in PostgreSQL. No data is sent to third-party services (except Tesla's API for vehicle communication).

### Is the web interface secured?
The backend enforces security headers (HSTS, CSP, X-Frame-Options), rate limiting (100 req/min/IP), and CORS. For production deployments, we strongly recommend placing TeslaSync behind a reverse proxy with TLS.

### Are my Tesla tokens safe?
Tesla OAuth tokens are stored in the database. For production use, we recommend encrypting the database volume and using strong PostgreSQL passwords.

## Troubleshooting

### Why does my vehicle show as "asleep"?
Tesla vehicles enter a sleep state to conserve battery. TeslaSync polls sleeping vehicles less frequently (default: every 60 seconds) to avoid waking them unnecessarily. Use the "Wake" button on the Commands page if needed.

### Why are my charging costs wrong?
Set the base cost per kWh in Settings. For location-specific pricing, create geofences with custom electricity rates. Supercharger costs are estimated.

### See more
Visit the full [Troubleshooting](/guide/troubleshooting) guide for detailed solutions.
