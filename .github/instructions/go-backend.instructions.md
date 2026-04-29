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

## API Design Standards (REST)

### URL Conventions
```
GET    /api/v1/vehicles                    # List all (with pagination)
GET    /api/v1/vehicles/{vehicleID}        # Get one by ID
POST   /api/v1/vehicles                    # Create
PUT    /api/v1/vehicles/{vehicleID}        # Update
DELETE /api/v1/vehicles/{vehicleID}        # Delete

GET    /api/v1/vehicles/{vehicleID}/drives # Nested resource
GET    /api/v1/analytics/fleet             # Flat for cross-cutting analytics
```

- Use **nouns** for resources, **HTTP verbs** for actions
- Path parameters for required identifiers: `/{vehicleID}`
- Query parameters for optional filters: `?vehicle_id=1&limit=50&offset=0`
- **snake_case** for all query/JSON field names

### Pagination
All list endpoints MUST support pagination:
```go
func (h *DriveHandler) ListByVehicle(w http.ResponseWriter, r *http.Request) {
    vehicleID, _ := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
    limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
    offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
    
    if limit <= 0 || limit > 100 { limit = 50 }  // sensible default, max cap
    if offset < 0 { offset = 0 }
    
    items, err := h.repo.ListByVehicle(ctx, vehicleID, limit, offset)
    // ...
}
```

### Error Response Format
Standardized JSON error responses:
```go
// writeError produces: {"error": "message"}
writeError(w, http.StatusNotFound, "vehicle not found")
writeError(w, http.StatusBadRequest, "vehicle_id is required")
writeError(w, http.StatusInternalServerError, "internal server error") // never expose internals
```

**HTTP Status Codes:**
- `200` — Success
- `201` — Created (POST)
- `204` — No Content (DELETE)
- `400` — Bad Request (missing/invalid params)
- `401` — Unauthorized (no/invalid auth)
- `403` — Forbidden (valid auth, insufficient permission)
- `404` — Not Found
- `429` — Rate Limited
- `500` — Internal Server Error (log details, return generic message)

### Input Validation
Validate all inputs at the handler level:
```go
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid request body")
        return
    }
    
    // Validate required fields
    if req.Name == "" {
        writeError(w, http.StatusBadRequest, "name is required")
        return
    }
    
    // Validate ranges
    if req.Threshold < 0 || req.Threshold > 100 {
        writeError(w, http.StatusBadRequest, "threshold must be 0-100")
        return
    }
    
    // Sanitize strings
    req.Name = strings.TrimSpace(req.Name)
    if len(req.Name) > 255 {
        writeError(w, http.StatusBadRequest, "name too long (max 255 chars)")
        return
    }
}
```

## Concurrency Patterns

### Goroutine Safety
```go
// ✅ Use SafeGoLoop for long-running goroutines (auto-recovers from panics)
resilience.SafeGoLoop(ctx, "vehicle-poller", func() error {
    return w.pollVehicle(ctx, vehicle)
})

// ✅ Use sync.RWMutex for shared state
type TokenStore struct {
    mu    sync.RWMutex
    token string
}
func (s *TokenStore) Get() string {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.token
}

// ❌ Never share state between goroutines without synchronization
// ❌ Never use goroutines in HTTP handlers without timeout/context
```

### Context Propagation
```go
// Always derive contexts from the request/parent
ctx := r.Context()
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()

// Pass context to all downstream calls
result, err := h.teslaClient.GetVehicle(ctx, vehicleID)
```

## Caching Strategy

### Redis Cache Pattern

General read-through cache rules apply to ordinary cached API data. **Live vehicle
signals are different**: they follow the SignalStore L1 + RedisSignalCache L2 +
signal_log history contract in `.github/ARCHITECTURE.md` and
`.github/instructions/telemetry-pipeline.instructions.md`.

```go
// Check cache first, fall back to DB
cached, err := h.cache.Get(ctx, cacheKey)
if err == nil && cached != nil {
    writeJSON(w, http.StatusOK, cached)
    return
}

// Fetch from DB
data, err := h.repo.GetByID(ctx, id)
if err != nil { ... }

// Cache with TTL
h.cache.Set(ctx, cacheKey, data, 5*time.Minute)
writeJSON(w, http.StatusOK, data)
```

**Cache TTLs:**
- Vehicle state: 30s (changes frequently)
- Drive list: 2min (changes on new drives)
- Analytics: 5min (computed aggregates)
- Static config: 15min

### Cache Invalidation
- Invalidate on writes: after CREATE/UPDATE/DELETE, delete related cache keys
- Never cache user-specific data without user-scoped keys
- Redis fallback: if Redis is down, serve from DB (never fail on cache miss)
- Live signal exception: if Redis is down, keep telemetry/FSM on local SignalStore
  and use signal_log for historical fallback. Do not make Redis a synchronous
  blocker for telemetry ingest.

## Structured Logging Standards

```go
// ✅ Handler entry — Info level with request context
log.Info().
    Str("handler", "ListDrives").
    Int64("vehicle_id", vehicleID).
    Int("limit", limit).
    Msg("listing drives")

// ✅ Error — Error level with full context
log.Error().Err(err).
    Str("handler", "ListDrives").
    Int64("vehicle_id", vehicleID).
    Msg("failed to list drives")

// ✅ External API call — Info with duration
log.Info().
    Str("service", "tesla-api").
    Str("method", "GET").
    Str("endpoint", "/vehicles").
    Dur("duration", elapsed).
    Int("status", resp.StatusCode).
    Msg("tesla API call")

// ❌ Never log sensitive data
log.Info().Str("token", token).Msg("auth")     // NEVER
log.Info().Str("vin", vin).Msg("vehicle")       // PII — use vehicle_id instead
```

**What to log:**
- Handler entry/exit with key parameters
- External API calls with duration and status
- Errors with full context chain
- Business events (drive started, charge complete, alert triggered)

**What NOT to log:**
- Request/response bodies (use middleware for debug-level body logging)
- Tokens, passwords, VINs, or other PII
- Successful cache hits (too noisy)

## Database Best Practices

### Query Optimization
```go
// ✅ Select only needed columns
query := `SELECT id, vehicle_id, distance, duration_min FROM drives WHERE vehicle_id = $1`

// ❌ Never SELECT *
query := `SELECT * FROM drives WHERE vehicle_id = $1`

// ✅ Use indexes for frequently-filtered columns
// CREATE INDEX idx_drives_vehicle_id ON drives(vehicle_id);
// CREATE INDEX idx_drives_start_date ON drives(start_date);

// ✅ Use EXPLAIN ANALYZE for slow queries (in development)
// EXPLAIN ANALYZE SELECT ... FROM drives WHERE vehicle_id = 1 ORDER BY start_date DESC LIMIT 50;
```

### Connection Pool Management
```go
// Pool is configured once at startup
pool, _ := pgxpool.NewWithConfig(ctx, &pgxpool.Config{
    MaxConns:          25,   // max concurrent connections
    MinConns:          5,    // warm connections
    HealthCheckPeriod: 15 * time.Second,
    MaxConnLifetime:   30 * time.Minute,
    MaxConnIdleTime:   5 * time.Minute,
})

// ✅ Always use pool from context — never create new connections
rows, err := h.db.Pool.Query(ctx, query, args...)

// ✅ Always close rows
defer rows.Close()
```

### Transaction Pattern
```go
tx, err := h.db.Pool.Begin(ctx)
if err != nil { return fmt.Errorf("begin tx: %w", err) }
defer tx.Rollback(ctx) // no-op if committed

// Multiple operations in transaction
_, err = tx.Exec(ctx, insertQuery, args...)
if err != nil { return fmt.Errorf("insert: %w", err) }

_, err = tx.Exec(ctx, updateQuery, args...)
if err != nil { return fmt.Errorf("update: %w", err) }

return tx.Commit(ctx)
```

## Testing Patterns

### Table-Driven Tests
```go
func TestParseVehicleID(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    int64
        wantErr bool
    }{
        {"valid", "123", 123, false},
        {"zero", "0", 0, true},
        {"negative", "-1", 0, true},
        {"non-numeric", "abc", 0, true},
        {"empty", "", 0, true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := parseVehicleID(tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("parseVehicleID(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
            }
            if got != tt.want {
                t.Errorf("parseVehicleID(%q) = %v, want %v", tt.input, got, tt.want)
            }
        })
    }
}
```

### Handler Tests
```go
func TestListDrives(t *testing.T) {
    // Setup test DB/mock
    handler := NewDriveHandler(testDB)
    
    req := httptest.NewRequest("GET", "/drives?vehicle_id=1&limit=10", nil)
    rec := httptest.NewRecorder()
    
    handler.ListByVehicle(rec, req)
    
    if rec.Code != http.StatusOK {
        t.Errorf("status = %d, want 200", rec.Code)
    }
    
    var result []models.Drive
    json.NewDecoder(rec.Body).Decode(&result)
    // assert on result...
}
```

### Race Detection
Always run tests with race detection:
```bash
go test -race -count=1 ./...
```

## Graceful Shutdown

```go
// Standard shutdown pattern in cmd/teslasync/main.go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// Signal handler
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

go func() {
    <-sigCh
    log.Info().Msg("shutdown signal received")
    cancel() // propagates to all goroutines
}()

// HTTP server with graceful shutdown
srv := &http.Server{Addr: ":8080", Handler: router}
go srv.ListenAndServe()

<-ctx.Done()
shutdownCtx, _ := context.WithTimeout(context.Background(), 30*time.Second)
srv.Shutdown(shutdownCtx)
pool.Close() // close DB pool
```

## Hexagonal Architecture (Ports & Adapters)

External integrations follow the port/adapter pattern:

```
internal/
  port/external/          # Interfaces (ports)
    gasprices.go          # GasPriceProvider interface
    geocoding.go          # Geocoder interface
  adapter/                # Implementations (adapters)
    gasprices/eia/        # EIA API adapter
    geocoding/google/     # Google Maps adapter
    geocoding/nominatim/  # Nominatim fallback
```

When adding external integrations:
1. Define the interface in `internal/port/external/`
2. Implement the adapter in `internal/adapter/{service}/`
3. Wire in `cmd/teslasync/main.go` via constructor injection

## HTTP Utility Package (`internal/platform/httputil/`)

Shared resilience primitives for HTTP clients:
- `CircuitBreaker` — wraps gobreaker with standard config
- `RetryableTransport` — http.RoundTripper with configurable retry
- `WriteJSON/WriteError` — response helpers
- `DecodeAndValidate[T]` — generic request body decoder

Use these in all new handlers and adapters instead of rolling your own.

## Tesla API Client

Located in `internal/tesla/client.go`:
- All Fleet API calls go through `doRequest()` which enforces rate limiting (10 req/s) and circuit breaker (gobreaker)
- Circuit breaker opens after 10 consecutive failures, closes after 60s
- Token management is thread-safe via `sync.RWMutex`
- API calls are logged via callback to `api_call_logs` table
- Vehicle commands use `commandMap` for mapping friendly names to Tesla API endpoints

## Model ↔ Repo ↔ Handler Alignment (CRITICAL)

Every model struct, its repo SQL, and its handler must stay in sync. This is the
#1 source of build breakage — a field rename in models that isn't propagated to
repos and handlers causes cascading compile errors across 20+ files.

### The Alignment Checklist

When adding, renaming, or removing a field on ANY model struct:

```
❌ DO NOT rename a model field without grep-verifying ALL consumers
✅ ALWAYS search across ALL layers before committing:
   1. grep for the old field name in internal/database/*_repo.go
   2. grep for the old field name in internal/api/*_handler.go
   3. grep for the old field name in internal/service/*.go
   4. grep for the old field name in internal/export/*.go
   5. grep for the old field name in internal/worker/*.go
   6. grep for the old field name in internal/automation/**/*.go
   7. Update SQL column names in ALL repo queries (SELECT, INSERT, UPDATE, Scan)
   8. Update $N placeholder numbering after column additions/removals
   9. Verify: column count = $N count = Scan target count = Exec arg count
```

### SQL ↔ Scan ↔ Args Alignment

The most common repo bug: column count doesn't match Scan targets or `$N` args.

```go
// ❌ BAD — 4 columns but 3 scan targets
query := `SELECT id, name, distance_mi, start_ts FROM drives WHERE id = $1`
rows.Scan(&d.ID, &d.Name, &d.DistanceMi) // missing &d.StartTs → runtime panic

// ✅ GOOD — counts match exactly
query := `SELECT id, name, distance_mi, start_ts FROM drives WHERE id = $1`
rows.Scan(&d.ID, &d.Name, &d.DistanceMi, &d.StartTs) // 4 = 4
```

When editing repo SQL:
1. Count columns in SELECT/INSERT
2. Count `$N` placeholders in VALUES
3. Count `&x.Field` targets in Scan()
4. Count arguments in Exec/QueryRow call
5. All four numbers MUST match

### Naming Conventions (model → DB)

Model fields use Go PascalCase. DB columns use snake_case. The `db:` tag is
the source of truth for the column name.

```go
// ✅ Field name describes the unit in the name itself
StartTs         time.Time  `db:"start_ts"`       // not StartDate
DistanceMi      float64    `db:"distance_mi"`    // not Distance (ambiguous unit)
MaxSpeedMph     *float64   `db:"max_speed_mph"`  // not SpeedMax
StartBatteryPct *int16     `db:"start_battery_pct"` // not StartBatteryLvl
EnergyAddedKwh  *float64   `db:"energy_added_kwh"`  // not ChargeEnergyAdded

// ❌ Ambiguous field names (what unit? what does "level" mean?)
Distance    float64  // miles? km? meters?
SpeedMax    float64  // mph? km/h?
TempAvg     float64  // celsius? fahrenheit?
```

**Rule:** Numeric measurement fields MUST include the unit suffix in both the Go
field name AND the db tag: `_mi`, `_km`, `_mph`, `_kmh`, `_c`, `_f`, `_pct`,
`_kwh`, `_kw`, `_m` (meters), `_psi`, `_bar`.

## Unit-Aware Data Storage (ADR-020)

Tesla Fleet Telemetry sends values in the car's GUI unit (miles/km, F/C, PSI/bar).
The unit preference arrives as a separate signal (`SettingDistanceUnit`, etc.)
and is cached in the `vehicle_units` table.

### Per-Row Unit Tags

Every table that stores unit-sensitive measurements has a `smallint` unit column
matching the Tesla proto enum:

```go
// models/units.go — unit enums matching Tesla proto
type DistanceUnit    int16  // 0=Unknown, 1=Miles, 2=Kilometers
type TemperatureUnit int16  // 0=Unknown, 1=Fahrenheit, 2=Celsius
type PressureUnit    int16  // 0=Unknown, 1=PSI, 2=Bar
```

```go
// On the model struct:
type Drive struct {
    DistanceMi   float64      `db:"distance_mi"`
    DistanceUnit DistanceUnit `db:"distance_unit"` // what unit distance_mi is actually in
    // ...
}
```

### Write Path — stamp unit at INSERT

```go
// In repo Create/Insert methods:
// 1. Read cached car preference
var distPref string
_ = r.db.Pool.QueryRow(ctx,
    `SELECT car_distance_pref FROM vehicle_units WHERE vehicle_id = $1`,
    d.VehicleID).Scan(&distPref)
d.DistanceUnit = models.ParseDistanceUnit(distPref)

// 2. Include in INSERT
query := `INSERT INTO drives (..., distance_unit) VALUES (..., $N)`
```

### Unknown (0) handling

If `vehicle_units` has no row (first boot, no preference signal yet), default
to `0` (Unknown). Consumers should interpret Unknown as the Tesla US default
(Miles, Fahrenheit, PSI).

## No JSONB for Typed Data (ADR-001)

```
❌ DO NOT store structured data as JSONB when the schema is known at design time
❌ DO NOT add a `raw_json jsonb` column to "store the full API response"
❌ DO NOT use `json.RawMessage` fields on models for typed data

✅ DO define explicit typed columns for every field
✅ DO use the Class-Table-Inheritance (CTI) pattern for polymorphic entities
✅ DO keep JSONB only for truly dynamic/opaque payloads (user-provided webhook bodies)
```

### CTI Pattern (ADR-004)

For polymorphic entities (automations with different trigger/condition/action types):

```
automations (parent)
  └── automation_steps (discriminator: kind enum)
        ├── automation_step_trigger_signal (child)
        ├── automation_step_trigger_geofence (child)
        ├── automation_step_condition_time_window (child)
        └── automation_step_action_command (child)
```

- Parent table has common fields only
- Discriminator row (automation_steps) has a `kind` enum column
- Each kind has its own typed child table with kind-specific columns
- Loaders join parent → discriminator → child to hydrate the full aggregate

## Migrations

- Path: `migrations/000NNN_description.{up,down}.sql`
- Runner: golang-migrate/migrate/v4 with PostgreSQL driver
- Auto-applied on startup in `db.Migrate(cfg.Database.MigrationsPath)`
- Always provide both up and down migrations
- **Naming:** Use descriptive snake_case: `000143_add_unit_columns`, not `000143_fix`
- **Check latest:** `Get-ChildItem migrations -Filter "*.up.sql" | Sort-Object Name | Select-Object -Last 3`
- **TimescaleDB:** Tables with time-series data use hypertables. Do NOT add foreign keys TO hypertables.
- **Column additions:** Always `ADD COLUMN IF NOT EXISTS` with a `DEFAULT` for backcompat
- **Column renames:** Prefer adding a new column + backfill + dropping old, over `ALTER COLUMN RENAME`

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
