# Local Development

This guide covers setting up TeslaSync for local development, running the backend and frontend independently, and using the Makefile for common tasks.

## Development Architecture

In development, you typically run:

- **Backend (Go)** — Directly with `go run` or `make run` on port 8080
- **Frontend (React)** — Vite dev server on port 5173 with API proxy to the backend
- **PostgreSQL + TimescaleDB** — Via Docker (or local install)
- **Mosquitto** — Via Docker (or local install)
- **Redis** — Optional, via Docker

## Prerequisites

Install the development dependencies:

```bash
# Go 1.22+
go version

# Node.js 20 LTS
node --version

# Docker (for database and other services)
docker --version
```

## Start Infrastructure Services

Use Docker Compose to run only the infrastructure services (database, MQTT, Redis):

```bash
# Start only the supporting services
docker compose up -d postgres mosquitto redis

# Verify PostgreSQL is ready
docker compose exec postgres pg_isready -U teslasync
```

Alternatively, you can run PostgreSQL with TimescaleDB locally:

```bash
# Install TimescaleDB extension
# See: https://docs.timescale.com/self-hosted/latest/install/

# Create the database
createdb teslasync
psql teslasync -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
```

## Backend Development

### Install Go Dependencies

```bash
go mod download
```

### Run the Backend

```bash
# Using Make (recommended)
make run

# Or directly with Go
go run ./cmd/teslasync/...
```

The backend starts on `http://localhost:8080` by default. It will automatically:
- Connect to PostgreSQL and run migrations
- Connect to MQTT (if enabled)
- Start the vehicle polling worker
- Start the health watchdog

### Backend Make Targets

```bash
make build        # Compile Go binary to ./bin/teslasync
make run          # Run the backend directly
make test         # Run all Go tests with race detection
make lint         # Run golangci-lint
make clean        # Remove build artifacts
make help         # Show all available targets
```

### Running Tests

```bash
# Run all tests
make test

# Run tests with verbose output
go test -v ./...

# Run tests for a specific package
go test -v ./internal/api/...

# Run tests with coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Hot Reload

For automatic restart on code changes, use a tool like [air](https://github.com/cosmtrek/air):

```bash
# Install air
go install github.com/cosmtrek/air@latest

# Run with hot reload
air
```

## Frontend Development

### Install Dependencies

```bash
cd web
npm install
```

### Start the Dev Server

```bash
# Using Make (from project root)
make web-dev

# Or directly with npm (from web/ directory)
cd web
npm run dev
```

The Vite dev server starts on `http://localhost:5173` with:
- **Hot Module Replacement (HMR)** — Instant updates on file save
- **API Proxy** — Requests to `/api` are proxied to `http://localhost:8080`
- **TypeScript checking** — Real-time type errors in the terminal

### Frontend Make Targets

```bash
make web-install  # npm ci (clean install)
make web-dev      # Start Vite dev server (port 5173)
make web-build    # Production build to web/dist/
make web-lint     # Run ESLint
```

### Building for Production

```bash
cd web
npm run build
```

This outputs the optimized SPA to `web/dist/`, ready to be served by Nginx.

### Linting & Formatting

```bash
cd web
npm run lint
```

## Full-Stack Development Workflow

A typical development session looks like this:

```bash
# Terminal 1: Start infrastructure
docker compose up -d postgres mosquitto redis

# Terminal 2: Start the Go backend
make run

# Terminal 3: Start the React frontend
make web-dev
```

Now you can:
- Access the frontend at `http://localhost:5173`
- The frontend proxies API calls to `http://localhost:8080`
- Edit Go files → restart backend manually (or use `air` for hot reload)
- Edit React files → browser updates automatically via HMR

## Database Management

### Running Migrations

Migrations run automatically when the backend starts. To run them manually:

```bash
# Using golang-migrate CLI
migrate -source file://migrations -database "postgres://teslasync:teslasync@localhost:5432/teslasync?sslmode=disable" up

# Roll back the last migration
migrate -source file://migrations -database "postgres://teslasync:teslasync@localhost:5432/teslasync?sslmode=disable" down 1
```

### Connecting to the Database

```bash
# Via Docker
docker compose exec postgres psql -U teslasync -d teslasync

# Or locally
psql -h localhost -U teslasync -d teslasync
```

### Useful SQL Queries

```sql
-- Check all tables
\dt

-- Count vehicles
SELECT COUNT(*) FROM vehicles;

-- Recent positions
SELECT * FROM positions ORDER BY created_at DESC LIMIT 10;

-- Drive summary
SELECT id, vehicle_id, distance, duration_min, start_date
FROM drives ORDER BY start_date DESC LIMIT 10;

-- Check TimescaleDB hypertables
SELECT * FROM timescaledb_information.hypertables;
```

## MQTT Debugging

Monitor MQTT messages in real time:

```bash
# Subscribe to all TeslaSync topics
docker compose exec mosquitto mosquitto_sub -t "teslasync/#" -v

# Or install mosquitto-clients locally
mosquitto_sub -h localhost -p 1883 -t "teslasync/#" -v
```

You'll see messages like:

```
teslasync/vehicles/5YJ3E1EA5KF123456/battery_level 85
teslasync/vehicles/5YJ3E1EA5KF123456/latitude 37.7749
teslasync/vehicles/5YJ3E1EA5KF123456/longitude -122.4194
teslasync/vehicles/5YJ3E1EA5KF123456/speed 0
```

## Grafana Development

Grafana is pre-configured with dashboards and a TimescaleDB datasource:

```bash
# Start Grafana
docker compose up -d grafana

# Access at http://localhost:3001
# Login: admin / teslasync
```

Dashboard JSON files are in `grafana/dashboards/`. Edit them in the Grafana UI and export the updated JSON back to the repo.

## Environment Variables for Development

Create a `.env` file in the project root (or set environment variables):

```bash
# Minimal development config
TESLA_CLIENT_ID=your-dev-client-id
TESLA_CLIENT_SECRET=your-dev-client-secret
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback

DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=teslasync
DATABASE_PASSWORD=teslasync
DATABASE_NAME=teslasync

TESLASYNC_PORT=8080
TESLASYNC_LOG_LEVEL=debug
TESLASYNC_DEV=true

MQTT_HOST=localhost
MQTT_PORT=1883

WORKER_POLL_INTERVAL=30s
```

## Troubleshooting

### Backend won't start

```bash
# Check database connectivity
psql -h localhost -U teslasync -d teslasync -c "SELECT 1"

# Check if the port is in use
lsof -i :8080  # macOS/Linux
netstat -ano | findstr :8080  # Windows
```

### Frontend can't reach the API

Ensure the backend is running on port 8080 and the Vite proxy is configured correctly in `web/vite.config.ts`:

```ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
```

### TimescaleDB extension not found

```sql
-- Enable the extension manually
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

### MQTT connection refused

```bash
# Check if Mosquitto is running
docker compose ps mosquitto

# Check the Mosquitto logs
docker compose logs mosquitto
```
