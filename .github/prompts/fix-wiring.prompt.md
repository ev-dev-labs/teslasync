---
description: "Fix dead handlers — wire ALL new internal/handler/v1/ into main.go + fix Vite proxy"
---

# Wire New Handlers Into main.go — They Are Currently Dead Code

## ⛔ CRITICAL: The new handlers EXIST but are NEVER CALLED

The audit found that `cmd/teslasync/main.go` still imports the OLD `internal/api` package.
The new handlers in `internal/handler/v1/` are files sitting on disk that nothing imports.
They are dead code. This is why most API endpoints return 404.

**Evidence:**
```
curl http://localhost:8080/api/v1/vehicles         → 200 (served by OLD internal/api)
curl http://localhost:8080/api/v1/dashboard/stats   → 404 (new handler, NOT wired)
curl http://localhost:8080/api/v1/charging-sessions → 404 (new handler, NOT wired)
curl http://localhost:8080/api/v1/exports           → 404 (new handler, NOT wired)
curl http://localhost:8080/api/v1/users/me          → 404 (new handler, NOT wired)
```

**Branch:** `refactor/full-rewrite`

---

## Step 1: Understand the current wiring

```bash
echo "=== What main.go currently imports ==="
grep "internal/" cmd/teslasync/main.go

echo ""
echo "=== New handlers that exist but aren't imported ==="
ls internal/handler/v1/*_handler.go

echo ""
echo "=== New middleware that exists but isn't imported ==="
ls internal/handler/middleware/*.go

echo ""
echo "=== New services that should be wired ==="
ls -d internal/app/*/
```

## Step 2: Wire the new handlers into main.go

Open `cmd/teslasync/main.go` and make these changes:

### 2.1 Add new imports

```go
import (
    // ... existing imports ...

    // NEW: handler and middleware packages
    v1 "github.com/ev-dev-labs/teslasync/internal/handler/v1"
    "github.com/ev-dev-labs/teslasync/internal/handler/middleware"

    // NEW: application services
    "github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
    "github.com/ev-dev-labs/teslasync/internal/app/chargingsvc"
    "github.com/ev-dev-labs/teslasync/internal/app/tripsvc"
    "github.com/ev-dev-labs/teslasync/internal/app/exportsvc"
    "github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
    "github.com/ev-dev-labs/teslasync/internal/app/notificationsvc"

    // NEW: adapters (if not already imported)
    "github.com/ev-dev-labs/teslasync/internal/adapter/postgres"
    "github.com/ev-dev-labs/teslasync/internal/adapter/redis"
)
```

### 2.2 Instantiate adapters, services, and handlers

Add this AFTER the database/redis connections are established in main():

```go
// ========================================
// NEW ARCHITECTURE: Adapters → Services → Handlers
// ========================================

// Adapters (implement port interfaces)
vehicleRepo := postgres.NewVehicleRepository(db)
chargingRepo := postgres.NewChargingSessionRepository(db)
tripRepo := postgres.NewTripRepository(db)
exportRepo := postgres.NewExportJobRepository(db)
notificationRepo := postgres.NewNotificationRepository(db)
userRepo := postgres.NewUserRepository(db)
fsmHistoryRepo := postgres.NewFSMHistoryRepository(db)
vehicleCache := rediscache.NewVehicleCache(redisClient)

// Application services (depend on port interfaces)
vehicleSvc := vehiclesvc.New(vehicleRepo, vehicleCache, fsmHistoryRepo)
chargingSvc := chargingsvc.New(chargingRepo, fsmHistoryRepo)
tripSvc := tripsvc.New(tripRepo, fsmHistoryRepo)
exportSvc := exportsvc.New(exportRepo, fsmHistoryRepo)
notificationSvc := notificationsvc.New(notificationRepo, fsmHistoryRepo)
dashboardSvc := dashboardsvc.New(vehicleRepo, chargingRepo, tripRepo)

// HTTP handlers
vehicleHandler := v1.NewVehicleHandler(vehicleSvc)
chargingHandler := v1.NewChargingHandler(chargingSvc)
tripHandler := v1.NewTripHandler(tripSvc)
exportHandler := v1.NewExportHandler(exportSvc)
dashboardHandler := v1.NewDashboardHandler(dashboardSvc)
userHandler := v1.NewUserHandler(userRepo)
```

**NOTE:** The constructor signatures above are examples. Read the actual `New()` functions in
each service and handler to match the correct parameters. Do NOT guess — open each file and
check what the constructor accepts.

### 2.3 Register new routes on the Chi router

Find where the Chi router is set up and add the new route group:

```go
// NEW: Register refactored handlers under /api/v1/
r.Route("/api/v1", func(r chi.Router) {
    // Middleware for all v1 routes
    r.Use(middleware.Auth(jwksKeyFunc))
    r.Use(middleware.RateLimit(redisClient))

    // Register each handler
    vehicleHandler.Register(r)
    chargingHandler.Register(r)
    tripHandler.Register(r)
    exportHandler.Register(r)
    dashboardHandler.Register(r)
    userHandler.Register(r)
})
```

**IMPORTANT:** If the OLD `internal/api` package already registers routes under `/api/v1/`,
you need to either:
- Replace the old routes with new ones (preferred), OR
- Register new handlers on a sub-path and migrate gradually

Check for conflicts:
```bash
grep -n "api/v1\|/api/" cmd/teslasync/main.go
```

### 2.4 Wire new middleware

Make sure these middleware are applied (check if they already exist in the chain):

```go
r.Use(middleware.Recovery())
r.Use(middleware.SecurityHeaders())
r.Use(middleware.CORS())
r.Use(middleware.Logging())
r.Use(middleware.Metrics())
```

## Step 3: Fix Vite proxy target

The frontend dev server proxies API calls. It currently points to the WRONG port.

```bash
echo "=== Current proxy target ==="
grep -A2 "proxy" web/vite.config.ts
```

Update `web/vite.config.ts`:

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',  // ← Fix: must match the Go API server port
      changeOrigin: true,
    },
    '/ws': {
      target: 'ws://localhost:8080',    // ← Fix: same port
      ws: true,
    },
  },
},
```

## Step 4: Build and verify

```bash
# Backend must compile
go build ./cmd/teslasync/...
echo "Go build: $?"

# Restart the API server (or rebuild Docker)
# Then test EVERY new endpoint:

echo "=== Testing ALL endpoints ==="
for ep in \
  /healthz \
  /readyz \
  /api/v1/vehicles \
  /api/v1/charging-sessions \
  /api/v1/trips \
  /api/v1/exports \
  /api/v1/dashboard/stats \
  /api/v1/users/me
do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080$ep")
  if [ "$STATUS" = "404" ]; then
    echo "❌ $STATUS $ep — NOT WIRED"
  elif [ "$STATUS" = "401" ]; then
    echo "✅ $STATUS $ep — wired (needs auth, which is correct)"
  else
    echo "✅ $STATUS $ep"
  fi
done
```

**Expected results:**
```
✅ 200 /healthz
✅ 200 /readyz
✅ 200 or 401 /api/v1/vehicles
✅ 200 or 401 /api/v1/charging-sessions     ← was 404, must be fixed
✅ 200 or 401 /api/v1/trips
✅ 200 or 401 /api/v1/exports               ← was 404, must be fixed
✅ 200 or 401 /api/v1/dashboard/stats       ← was 404, must be fixed
✅ 200 or 401 /api/v1/users/me              ← was 404, must be fixed
```

**ZERO 404s on any endpoint. A 401 (unauthorized) is fine — it means the route exists
but needs auth. A 404 means the route is NOT registered.**

## Step 5: Test frontend connection

```bash
# Restart vite dev server after proxy fix, then:
curl -sf http://localhost:3000/api/v1/vehicles | head -c 100
# Should return JSON, not "Not Found"

# Or open browser to http://localhost:3000 — Dashboard should load data, not show "Not Found"
```

## Step 6: Commit

```bash
git add -A
git commit -m "fix: wire new v1 handlers into main.go + fix vite proxy target

- Import and register all 6 handlers from internal/handler/v1/
- Instantiate adapters and services with proper DI
- Fix vite proxy from port 4000 to 8080
- All endpoints now respond (zero 404s on new routes)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

**Paste the endpoint test output as proof. ZERO 404s required.**
