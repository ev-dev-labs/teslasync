# Upgrade Notes

This page replaces the old v0.25-specific notes with current upgrade guidance. Treat older release notes as historical only; the active codebase has moved to the Go 1.25 + React 18 + Vite 5 + TimescaleDB/pgvector architecture.

## Before upgrading

1. Back up the database and any mounted volumes.
2. Read the migration list in `migrations/` and confirm your deployment can run every pending migration in order.
3. If moving from a plain PostgreSQL image to `timescale/timescaledb-ha:pg17`, test in staging first. Existing Docker volumes from incompatible images may need a clean restore path.
4. Check Helm values for renamed configuration keys, especially `config.apiEndpoint`, `config.browserApiBase`, and `config.forwardAuthHeader`.
5. Confirm the Tesla OAuth redirect URI matches the public URL that users actually visit.

## Current deployment-sensitive changes

| Area | What to verify |
|---|---|
| Database image | Docker Compose uses `timescale/timescaledb-ha:pg17`; Helm defaults to TimescaleDB/Postgres 17 compatible images. |
| API proxying | Web/Nginx proxies `/api/` to `config.apiEndpoint`; browsers should use same-origin relative URLs unless split-origin deployment is intentional. |
| Auth | ForwardAuth is supported through `FORWARD_AUTH_HEADER` / `config.forwardAuthHeader`. |
| PWA | Service worker updates are prompt-based; clear stale localhost service workers if testing older dev builds. |
| Telemetry | Fleet Telemetry can run through MQTT and optional MongoDB raw signal capture. |

## Validation after upgrade

```bash
docker compose ps
docker compose logs -f teslasync-api
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
cd web && npx tsc --noEmit && npm run build
cd docs && npm run docs:build
```

For Kubernetes:

```bash
helm lint helm/teslasync
helm template teslasync helm/teslasync -f values.yaml
kubectl rollout status deployment/teslasync-dev-api
kubectl rollout status deployment/teslasync-dev-web
```