# Docker Deployment

This guide covers deploying TeslaSync with Docker Compose for production use.

## Docker Compose Overview

TeslaSync's `docker-compose.yml` orchestrates 8 services:

| Service | Image | Port | Memory | Purpose |
|---------|-------|------|--------|---------|
| **teslasync-api** | Custom (Dockerfile) | 8080 | 128M–512M | Go API server + worker |
| **teslasync-notification-worker** | Custom (Dockerfile.notification) | 8081 | 32M–128M | Async notification delivery |
| **teslasync-export-worker** | Custom (Dockerfile.export-worker) | 8082 | 64M–512M | Async data export & backup processing |
| **web** | Custom (Dockerfile.web) | 3000 | 32M–128M | React SPA via Nginx |
| **postgres** | postgres:17-alpine | 5432 | 256M–1G | PostgreSQL database |
| **grafana** | grafana/grafana:10.4.0 | 3001 | 64M–256M | Monitoring dashboards |
| **mosquitto** | eclipse-mosquitto:2 | 1883, 9001 | 16M–64M | MQTT broker |
| **redis** | redis:7-alpine | 6379 | 32M–192M | Cache layer |

## Quick Start

```bash
# Clone and configure
git clone https://github.com/ev-dev-labs/TeslaSync.git
cd TeslaSync
cp .env.example .env
# Edit .env with your Tesla credentials

# Build and start all services
docker compose up -d --build

# Verify everything is running
docker compose ps
```

## Service Details

### Backend (teslasync)

The backend is built using a multi-stage Dockerfile:

```dockerfile
# Build stage: Go 1.22 on Alpine
FROM golang:1.22-alpine AS builder
RUN CGO_ENABLED=0 go build -ldflags "-s -w ..." -o /bin/teslasync ./cmd/teslasync

# Runtime stage: Minimal Alpine
FROM alpine:3.19
RUN adduser -D teslasync
COPY --from=builder /bin/teslasync /bin/teslasync
COPY migrations/ /migrations/
USER teslasync
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:8080/healthz || exit 1
```

**Key features:**
- Non-root user (`teslasync`) for security
- CGO disabled for a fully static binary
- Version, commit, and build time injected via ldflags
- Health check endpoint at `/healthz`
- Migrations copied into the image and run on startup

### Frontend (web)

```dockerfile
# Build stage: Node 20
FROM node:20-alpine AS builder
RUN npm ci && npm run build

# Runtime stage: Nginx
FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

The Nginx configuration handles SPA routing (all non-file routes serve `index.html`).

### PostgreSQL

```yaml
postgres:
  image: postgres:17-alpine
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-teslasync}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-teslasync}
    POSTGRES_DB: ${POSTGRES_DB:-teslasync}
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U teslasync"]
```

::: warning Data Persistence
The `postgres_data` volume ensures your data survives container restarts. **Never** use `docker compose down -v` unless you want to delete all data.
:::

### Grafana

Pre-configured with 5 dashboards and a PostgreSQL datasource:

```yaml
grafana:
  image: grafana/grafana:10.4.0
  environment:
    GF_SECURITY_ADMIN_USER: ${GRAFANA_USER:-admin}
    GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-teslasync}
  volumes:
    - ./grafana/provisioning:/etc/grafana/provisioning
    - ./grafana/dashboards:/var/lib/grafana/dashboards
```

**Available dashboards:**
1. Vehicle Overview — Battery, range, speed, temperature trends
2. Charging — Session count, energy added, cost tracking
3. Drives — Distance, speed, efficiency per drive
4. Battery Health — Degradation, charge cycles, SOC distribution
5. Fleet Overview — Cross-vehicle comparison, fleet totals

### Mosquitto (MQTT)

```yaml
mosquitto:
  image: eclipse-mosquitto:2
  ports:
    - "${MQTT_PORT:-1883}:1883"    # MQTT
    - "9001:9001"                   # WebSocket
  volumes:
    - ./mosquitto.conf:/mosquitto/config/mosquitto.conf
    - mosquitto_data:/mosquitto/data
```

### Redis

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
  volumes:
    - redis_data:/data
```

## Production Hardening

### 1. Use Strong Passwords

```bash
# Generate secure passwords
openssl rand -base64 32  # For POSTGRES_PASSWORD
openssl rand -base64 32  # For GRAFANA_PASSWORD
openssl rand -base64 32  # For AUTH_JWT_SECRET
```

### 2. Enable HTTPS with a Reverse Proxy

Place TeslaSync behind a reverse proxy like Traefik, Caddy, or Nginx:

```yaml
# Example: Add Traefik labels to docker-compose.yml
services:
  web:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.teslasync.rule=Host(`teslasync.example.com`)"
      - "traefik.http.routers.teslasync.tls.certresolver=letsencrypt"
```

### 3. Secure MQTT

Edit `mosquitto.conf` to require authentication:

```conf
listener 1883
allow_anonymous false
password_file /mosquitto/config/passwd

listener 9001
protocol websockets
allow_anonymous false
password_file /mosquitto/config/passwd
```

Create the password file:

```bash
docker compose exec mosquitto mosquitto_passwd -c /mosquitto/config/passwd teslasync
```

### 4. Enable Database SSL

```bash
DATABASE_SSLMODE=require
```

### 5. Resource Limits

The Docker Compose file includes memory limits. Adjust based on your hardware:

```yaml
services:
  teslasync:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 128M
```

## Management Commands

```bash
# View logs for all services
docker compose logs -f

# View logs for a specific service
docker compose logs -f teslasync

# Restart a specific service
docker compose restart teslasync

# Scale the web frontend (if needed)
docker compose up -d --scale web=2

# Rebuild after code changes
docker compose up -d --build

# Stop all services (preserves data)
docker compose down

# Stop and remove all data (DESTRUCTIVE)
docker compose down -v
```

## Monitoring & Health Checks

### Backend Health

```bash
# Liveness probe
curl http://localhost:8080/healthz

# Readiness probe (checks DB + Tesla API)
curl http://localhost:8080/readyz

# Detailed system status
curl http://localhost:8080/api/v1/system/status
```

### Prometheus Metrics

The backend exposes Prometheus metrics at `/metrics`:

```bash
curl http://localhost:8080/metrics
```

Grafana is pre-configured to scrape these metrics.

## Backup & Restore

### Database Backup

```bash
# Create a backup
docker compose exec postgres pg_dump -U teslasync teslasync > backup_$(date +%Y%m%d).sql

# Restore from backup
cat backup_20240120.sql | docker compose exec -T postgres psql -U teslasync teslasync
```

### Automated Backups

Add a cron job for periodic backups:

```bash
# Daily backup at 2 AM
0 2 * * * cd /path/to/TeslaSync && docker compose exec -T postgres pg_dump -U teslasync teslasync | gzip > /backups/teslasync_$(date +\%Y\%m\%d).sql.gz
```

## Updating

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose up -d --build

# Check that migrations ran successfully
docker compose logs teslasync | grep -i migration
```

The backend automatically runs pending database migrations on startup, so updates are generally seamless.
