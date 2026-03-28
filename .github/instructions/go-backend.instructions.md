---
applyTo: "internal/**,cmd/**,*.go,go.mod,go.sum"
---

# Go Backend Instructions

## Package Layout

```
cmd/
  teslasync/main.go           # API server — config.Load(), DB, MQTT, Redis, Tesla client, HTTP server
  notification-worker/main.go # MQTT queue consumer for notifications
  export-worker/main.go       # Background export job processor
internal/
  api/          # HTTP handlers, router, middleware, SSE EventHub
  cache/        # Redis wrapper with in-memory fallback
  config/       # Env-based config (config.Load() reads os.Getenv)
  crypto/       # AES encryption for tokens at rest
  database/     # pgxpool, 27 repo files, migration runner
  events/       # Domain event bus backed by MQTT
  models/       # Structs with json + db tags
  mqtt/         # paho.mqtt wrapper (Publish, PublishJSON, PublishVehicleData)
  notification/ # 7-channel dispatch (Discord, Slack, Telegram, Email, Webhook, ntfy, Pushover)
  resilience/   # ConnectWithRetry, SafeGoLoop, HealthMonitor
  tesla/        # Fleet API client with gobreaker circuit breaker
  worker/       # Vehicle polling loop with adaptive sleep backoff
  export/       # CSV/JSON export logic
```

## Handler Pattern

Handlers are struct-based with constructor + functional options:

```go
type DevToolsHandler struct {
    teslaClient *tesla.Client
    db          *database.DB
    mqttClient  *mqtt.Client
    cfg         *config.Config
}

func NewDevToolsHandler(tc *tesla.Client, opts ...DevToolsOption) *DevToolsHandler {
    h := &DevToolsHandler{teslaClient: tc}
    for _, opt := range opts {
        opt(h)
    }
    return h
}

func WithDB(db *database.DB) DevToolsOption {
    return func(h *DevToolsHandler) { h.db = db }
}
```

Mount handlers on chi router with `r.Route()` groups:
```go
r.Route("/api/v1", func(r chi.Router) {
    r.Route("/vehicles", func(r chi.Router) {
        r.Get("/", vehicleHandler.List)
        r.Route("/{vehicleID}", func(r chi.Router) {
            r.Get("/", vehicleHandler.Get)
            r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/command", commandHandler.SendCommand)
        })
    })
})
```

## Database Repository Pattern

One repo per entity, all in `internal/database/`:

```go
type VehicleRepo struct {
    db *DB
}

func NewVehicleRepo(db *DB) *VehicleRepo {
    return &VehicleRepo{db: db}
}

// Create — use RETURNING for auto-assigned IDs
func (r *VehicleRepo) Create(ctx context.Context, v *models.Vehicle) error {
    query := `INSERT INTO vehicles (...) VALUES ($1, $2, ...) RETURNING id`
    return r.db.Pool.QueryRow(ctx, query, v.VIN, ...).Scan(&v.ID)
}

// GetByID — return (nil, nil) for not found
func (r *VehicleRepo) GetByID(ctx context.Context, id int64) (*models.Vehicle, error) {
    v := &models.Vehicle{}
    err := r.db.Pool.QueryRow(ctx, query, id).Scan(&v.ID, ...)
    if err == pgx.ErrNoRows {
        return nil, nil
    }
    return v, err
}

// GetAll — iterate rows, always defer Close
func (r *VehicleRepo) GetAll(ctx context.Context) ([]*models.Vehicle, error) {
    rows, err := r.db.Pool.Query(ctx, query)
    if err != nil { return nil, err }
    defer rows.Close()
    var results []*models.Vehicle
    for rows.Next() {
        v := &models.Vehicle{}
        rows.Scan(&v.ID, ...)
        results = append(results, v)
    }
    return results, rows.Err()
}
```

## Key Rules

- **Queries:** Always parameterized (`$1`, `$2`) — never `fmt.Sprintf` into SQL
- **Timestamps:** Always `time.Now().UTC()`
- **Logging:** `log.Info().Str("key", val).Msg("message")` — zerolog only
- **Errors:** Wrap with context: `fmt.Errorf("create vehicle: %w", err)`
- **Context:** Every DB/HTTP/API call takes `context.Context` as first parameter
- **HTTP responses:** Use `writeJSON(w, status, data)` and `writeError(w, status, msg)` helpers
- **Nil safety:** Nullable fields are pointers (`*float64`, `*string`, `*time.Time`)
- **Build:** `CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/teslasync ./cmd/teslasync`

## Tesla API Client

Located in `internal/tesla/client.go`:
- All Fleet API calls go through `doRequest()` which enforces rate limiting (10 req/s) and circuit breaker (gobreaker)
- Circuit breaker opens after 10 consecutive failures, closes after 60s
- Token management is thread-safe via `sync.RWMutex`
- API calls are logged via callback to `api_call_logs` table
- Vehicle commands use `commandMap` for mapping friendly names to Tesla API endpoints

## Migrations

- Path: `migrations/000NNN_description.{up,down}.sql`
- Runner: golang-migrate/migrate/v4 with PostgreSQL driver
- Auto-applied on startup in `db.Migrate(cfg.Database.MigrationsPath)`
- Current: 16 migrations (000001–000016)
- Always provide both up and down migrations

## MQTT Publishing

```go
// Simple value
c.Publish(vin+"/battery_level", fmt.Sprintf("%d", level))

// JSON object
c.PublishJSON(vin+"/vehicle_data", data)

// Full vehicle telemetry (20+ individual topics)
c.PublishVehicleData(vin, vehicleData)
```

Topic format: `{prefix}/{vin}/{metric}` — default prefix is `teslasync`
