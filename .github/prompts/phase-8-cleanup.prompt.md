---
description: "Phase 8 — Final cleanup: delete dead code, fill test gaps, add dashboards and runbooks"
---

# Phase 8: Cleanup, Tests & Observability

**Branch:** `refactor/full-rewrite`
**Depends on:** ALL previous phases complete

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Do

### 1. Old Code Cleanup — Systematic Removal

**This is NOT optional. The whole point of the refactoring is replacing the old code.
If old code survives alongside new code, we've doubled the codebase instead of fixing it.**

#### 1.1 Find and remove old scattered SQL

```bash
# Find SQL outside the new adapter/postgres/queries/ location
grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/ --include="*.go" \
  | grep -v "adapter/postgres" \
  | grep -v "_test.go" \
  | grep -v "domain/fsm"
```
Every result is old code that must be deleted or migrated to `adapter/postgres/queries/`.

#### 1.2 Find and remove old ad-hoc state changes

```bash
# Find direct state assignments (should all be FSM engine now)
grep -rn '\.State\s*=\|\.Status\s*=\|"charging"\|"driving"\|"idle"\|"online"\|"offline"\|"asleep"' \
  internal/ --include="*.go" \
  | grep -v "domain/" \
  | grep -v "fsm" \
  | grep -v "_test.go" \
  | grep -v "const\|State ="
```
Every result is old ad-hoc state logic. Delete it — the FSM engine handles this now.

#### 1.3 Find and remove old HTTP handlers replaced by new ones

```bash
# List all handler files — compare against the new internal/handler/v1/ implementations
find internal/ -name "*handler*" -o -name "*route*" -o -name "*api*" | grep -v handler/v1 | grep -v handler/middleware | grep -v handler/dto
```
Any handler NOT in `internal/handler/v1/`, `internal/handler/middleware/`, or `internal/handler/dto/` is old code. Delete it after verifying its routes are covered by the new handlers.

#### 1.4 Find and remove old duplicate frontend components

```bash
# Find components in features/ that duplicate shared components
grep -rn "className=\".*rounded.*border\|className=\".*bg-white.*shadow" web/src/features/ --include="*.tsx" | head -30

# Find direct library imports that should use wrappers
grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'\|from 'leaflet'" web/src/features/ --include="*.tsx"

# Find raw fetch/axios calls
grep -rn "fetch(\|axios\.\|useEffect.*fetch" web/src/features/ --include="*.tsx" --include="*.ts"

# Find duplicate loading/error/empty patterns (should use PageContainer)
grep -rn "isLoading.*Spinner\|isLoading.*Loading\|loading.*return" web/src/features/ --include="*.tsx" | head -20
```
Replace ALL results with shared component imports.

#### 1.5 Find and remove old config/env patterns

```bash
# Find os.Getenv outside the config package
grep -rn "os\.Getenv\|os\.LookupEnv" internal/ --include="*.go" | grep -v "platform/config"

# Find hardcoded connection strings
grep -rn "localhost:5432\|localhost:6379\|127\.0\.0\.1" internal/ --include="*.go" | grep -v "_test.go"
```
Delete all — config comes from `internal/platform/config/` only.

#### 1.6 Find and remove old error handling patterns

```bash
# Find swallowed errors (log without return)
grep -rn "log.*Err.*err\|log.*Error.*err" internal/ --include="*.go" -A1 | grep -B1 -v "return"

# Find errors.New without wrapping
grep -rn 'errors\.New(' internal/ --include="*.go" | grep -v "domain/errors\|domain/fsm"
```
Fix: wrap errors with `fmt.Errorf("context: %w", err)` and return them.

#### 1.7 Find and remove orphan files

```bash
# Go: find files not imported by anything
# Build first to make sure everything compiles
go build ./...

# Then check for Go files that aren't in the import graph
# (files that compile but nothing references their exports)
for f in $(find internal/ -name "*.go" ! -name "*_test.go"); do
  pkg=$(head -1 "$f" | awk '{print $2}')
  exports=$(grep -c "^func [A-Z]\|^type [A-Z]\|^var [A-Z]" "$f")
  if [ "$exports" -gt 0 ]; then
    base=$(basename "$f" .go)
    refs=$(grep -rn "$base\|$pkg" internal/ --include="*.go" | grep -v "$f" | wc -l)
    if [ "$refs" -eq 0 ]; then
      echo "ORPHAN: $f (exports=$exports, references=$refs)"
    fi
  fi
done

# Frontend: find components not imported anywhere
for f in $(find web/src/ -name "*.tsx" -path "*/features/*"); do
  name=$(basename "$f" .tsx)
  refs=$(grep -rn "$name" web/src/ --include="*.tsx" --include="*.ts" | grep -v "$f" | wc -l)
  if [ "$refs" -eq 0 ]; then
    echo "ORPHAN: $f (references=$refs)"
  fi
done
```
Delete every orphan file. Verify build still succeeds after deletion.

#### 1.8 Final cleanup verification

```bash
# After all cleanup, these must ALL return zero results:
echo "=== SQL outside adapters ==="
grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/app/ internal/handler/ --include="*.go" | wc -l

echo "=== Direct state assignments ==="
grep -rn '\.State\s*=' internal/app/ internal/handler/ --include="*.go" | wc -l

echo "=== os.Getenv outside config ==="
grep -rn "os\.Getenv" internal/ --include="*.go" | grep -v "platform/config" | wc -l

echo "=== Raw fetch in frontend ==="
grep -rn "fetch(\|axios" web/src/features/ --include="*.tsx" --include="*.ts" | wc -l

echo "=== Direct library imports in features ==="
grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" web/src/features/ --include="*.tsx" | wc -l

echo "=== any types ==="
grep -rn ": any\b" web/src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | wc -l
```
**Every count must be 0. Paste output.**

### 2. Test Coverage Gaps
Fill coverage to meet targets:

| Layer | Target | Command |
|-------|--------|---------|
| `internal/domain/` | ≥90% | `go test ./internal/domain/... -cover` |
| `internal/app/` | ≥80% | `go test ./internal/app/... -cover` |
| `internal/adapter/` | ≥70% | `go test ./internal/adapter/... -cover -tags=integration` |
| `internal/handler/` | ≥70% | `go test ./internal/handler/... -cover` |
| `web/src/components/` | ≥70% | `cd web && npm run test -- --coverage` |
| `web/src/api/hooks/` | ≥80% | `cd web && npm run test -- --coverage` |

### 3. Observability Artifacts
- [ ] Grafana dashboard JSON: RED metrics (request rate, error rate, duration)
- [ ] Grafana dashboard JSON: FSM transitions (state changes over time, stuck states)
- [ ] Grafana dashboard JSON: Tesla API health (call rate, error rate, latency)
- [ ] Grafana dashboard JSON: Database health (connections, query duration, cache hit rate)

### 4. Runbooks in `docs/runbooks/`
- [ ] `high-error-rate.md` — symptoms, investigation, remediation
- [ ] `high-latency.md`
- [ ] `db-connections.md`
- [ ] `tesla-api-degraded.md`
- [ ] `cert-renewal.md`
- [ ] `resource-pressure.md`
- [ ] `fsm-stuck.md`
- [ ] `emergency-secret-rotation.md`

### 5. Documentation Updates
- [ ] Update `README.md` with new architecture overview
- [ ] Verify FSM Catalog (§8.11 of ENGINEERING_GUIDELINES.md) matches all implementations
- [ ] Generate/update OpenAPI spec from handlers
- [ ] Update Helm values documentation

### 6. Final Full Verification

```bash
# Backend — run ALL
go build ./cmd/...
go test ./... -count=1
golangci-lint run ./...
govulncheck ./...

# Frontend — run ALL
cd web && npx tsc --noEmit
cd web && npm run lint
cd web && npm run test -- --coverage
cd web && npm run build

# Cross-cutting
grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/app/ internal/handler/  # zero results
grep -rn "\.State\s*=" internal/app/ internal/handler/                      # zero results
grep -rn "os\.Getenv" internal/ --include="*.go" | grep -v platform/config  # zero results
grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" web/src/features/  # zero results
grep -rn ": any" web/src/ --include="*.ts" --include="*.tsx"                # zero results
```

## Acceptance Criteria

- [ ] ALL commands above pass. Paste EVERY output.
- [ ] Zero dead code (all files imported by something)
- [ ] All coverage targets met
- [ ] All Grafana dashboards created
- [ ] All runbooks created
- [ ] README updated
- [ ] OpenAPI spec matches handlers
- [ ] Docker builds succeed (Phase 8.7)
- [ ] Local Docker stack runs and responds (Phase 8.8)
- [ ] The `refactor/full-rewrite` branch is ready for final PR to `main`

### 7. Docker Build Verification

**All container images must build successfully from the refactored code.**

```bash
# Build all images
docker build -f deploy/docker/Dockerfile.api -t teslasync-api:refactor .
docker build -f deploy/docker/Dockerfile.worker -t teslasync-worker:refactor --build-arg BINARY=notification-worker .
docker build -f deploy/docker/Dockerfile.worker -t teslasync-export-worker:refactor --build-arg BINARY=export-worker .
docker build -f deploy/docker/Dockerfile.web -t teslasync-web:refactor ./web
```

If Dockerfiles don't exist yet or need updating, create/update them following §14.1:
- Multi-stage build (builder + distroless runtime)
- Inject build metadata via `--build-arg` → `-ldflags`
- Expose correct ports (8080, 8081, 8082)
- `ENTRYPOINT` pointing to the binary

**All 4 builds must succeed. Paste output.**

### 8. Local Docker Compose Smoke Test

Create or update `docker-compose.yml` in the repo root for local development:

```yaml
# docker-compose.yml — local development stack
version: "3.9"

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: teslasync
      POSTGRES_USER: teslasync
      POSTGRES_PASSWORD: localdev
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U teslasync"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  mosquitto:
    image: eclipse-mosquitto:2
    ports: ["1883:1883"]
    volumes: ["./deploy/mosquitto:/mosquitto/config:ro"]

  api:
    image: teslasync-api:refactor
    ports: ["8080:8080"]
    environment:
      SERVER_PORT: "8080"
      DATABASE_URL: "postgres://teslasync:localdev@postgres:5432/teslasync?sslmode=disable"
      REDIS_URL: "redis://redis:6379/0"
      MQTT_BROKER_URL: "tcp://mosquitto:1883"
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      mosquitto: { condition: service_started }

  notification-worker:
    image: teslasync-worker:refactor
    ports: ["8081:8081"]
    environment:
      SERVER_PORT: "8081"
      DATABASE_URL: "postgres://teslasync:localdev@postgres:5432/teslasync?sslmode=disable"
      REDIS_URL: "redis://redis:6379/0"
      MQTT_BROKER_URL: "tcp://mosquitto:1883"
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  export-worker:
    image: teslasync-export-worker:refactor
    ports: ["8082:8082"]
    environment:
      SERVER_PORT: "8082"
      DATABASE_URL: "postgres://teslasync:localdev@postgres:5432/teslasync?sslmode=disable"
      REDIS_URL: "redis://redis:6379/0"
    depends_on:
      postgres: { condition: service_healthy }

  web:
    image: teslasync-web:refactor
    ports: ["3000:80"]

volumes:
  pgdata:
```

**Run the stack and verify:**

```bash
# Start everything
docker compose up -d

# Wait for healthy
sleep 15

# Verify each service responds
curl -sf http://localhost:8080/healthz && echo " ✅ API alive" || echo " ❌ API failed"
curl -sf http://localhost:8080/readyz  && echo " ✅ API ready" || echo " ❌ API not ready"
curl -sf http://localhost:8080/version && echo " ✅ API version" || echo " ❌ API version failed"
curl -sf http://localhost:8081/healthz && echo " ✅ Notification worker alive" || echo " ❌ Notification worker failed"
curl -sf http://localhost:8082/healthz && echo " ✅ Export worker alive" || echo " ❌ Export worker failed"
curl -sf http://localhost:3000/        && echo " ✅ Web UI alive" || echo " ❌ Web UI failed"

# Check API returns valid JSON
curl -sf http://localhost:8080/api/v1/vehicles | head -c 200

# Cleanup
docker compose down
```

**All 6 health checks must pass. Paste output.**

If any service fails to start, check logs and fix:
```bash
docker compose logs api
docker compose logs notification-worker
docker compose logs export-worker
docker compose logs web
```
