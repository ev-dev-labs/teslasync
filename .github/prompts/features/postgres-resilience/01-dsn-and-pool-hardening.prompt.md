---
description: "Postgres resilience: DSN connection timeouts and pool configuration hardening"
---

# Postgres Resilience: DSN & Pool Hardening

## Problem

When Postgres has a transient outage (e.g. kubelet restart, pod eviction, network blip),
the `teslasync-api` accumulates `context deadline exceeded` errors on every DB write.
There is no connection timeout on the DSN, and the health check period is hardcoded at 15s,
meaning stale connections sit in the pool for up to 15 seconds before detection.

Production incident: 12 API restarts in 3 hours caused by cascading Postgres connection failures.

## Current State

```
internal/config/config.go:75-94     — DatabaseConfig struct + DSN() builder
internal/database/database.go:32-63 — Pool creation with hardcoded HealthCheckPeriod
```

### DSN Builder (config.go:89-93)
```go
func (d DatabaseConfig) DSN() string {
    return fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s",
        d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
    )
}
```

**Issues:**
- No `connect_timeout` — new connections hang indefinitely on network issues
- No `statement_timeout` — long-running queries never get killed
- No `idle_in_transaction_session_timeout` — leaked transactions hold locks forever

### Pool Config (database.go:38-42)
```go
poolCfg.MaxConns = int32(cfg.MaxConns)         // 25
poolCfg.MinConns = int32(cfg.MinConns)         // 5
poolCfg.MaxConnLifetime = cfg.ConnMaxLifetime  // 5min
poolCfg.MaxConnIdleTime = cfg.ConnMaxIdleTime  // 1min
poolCfg.HealthCheckPeriod = 15 * time.Second   // HARDCODED
```

**Issues:**
- HealthCheckPeriod hardcoded — cannot tune for faster recovery
- No `ConnConfig.ConnectTimeout` override on pgx level

## Task

### Step 1: Add DSN Connection Parameters

In `internal/config/config.go`, add three new fields to `DatabaseConfig`:

```go
type DatabaseConfig struct {
    // ... existing fields ...
    ConnectTimeout   int // seconds, default 5
    StatementTimeout int // milliseconds, default 30000 (30s)
}
```

Add environment variable loading in `Load()`:
- `DATABASE_CONNECT_TIMEOUT` → `ConnectTimeout` (default: `5`)
- `DATABASE_STATEMENT_TIMEOUT` → `StatementTimeout` (default: `30000`)

Update `DSN()` to append these as query parameters:
```go
func (d DatabaseConfig) DSN() string {
    return fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s&connect_timeout=%d&statement_timeout=%d",
        d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
        d.ConnectTimeout, d.StatementTimeout,
    )
}
```

### Step 2: Make HealthCheckPeriod Configurable

In `DatabaseConfig`, add:
```go
HealthCheckPeriod time.Duration // default 5s (was hardcoded 15s)
```

Add environment variable: `DATABASE_HEALTH_CHECK_PERIOD` (default: `5s`)

In `database.go`, replace the hardcoded value:
```go
// Before:
poolCfg.HealthCheckPeriod = 15 * time.Second

// After:
poolCfg.HealthCheckPeriod = cfg.HealthCheckPeriod
```

### Step 3: Add AfterConnect Hook for Connection Validation

In `database.go`, add an `AfterConnect` callback to the pool config that validates
new connections are fully functional:

```go
poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
    // Set per-connection statement timeout as safety net
    _, err := conn.Exec(ctx, fmt.Sprintf("SET statement_timeout = '%dms'", cfg.StatementTimeout))
    if err != nil {
        log.Warn().Err(err).Msg("failed to set statement_timeout on new connection")
    }
    return nil
}
```

### Step 4: Enhanced Pool Stats Logging

Add a `PoolStats()` method to `DB` that returns pool health info:

```go
func (db *DB) PoolStats() map[string]interface{} {
    s := db.Pool.Stat()
    return map[string]interface{}{
        "total_conns":        s.TotalConns(),
        "idle_conns":         s.IdleConns(),
        "acquired_conns":     s.AcquiredConns(),
        "constructing_conns": s.ConstructingConns(),
        "max_conns":          s.MaxConns(),
        "empty_acquire_count": s.EmptyAcquireCount(),
        "canceled_acquire_count": s.CanceledAcquireCount(),
    }
}
```

Log pool stats on startup (after ping succeeds) and include in the existing
`/health/extended` endpoint response.

### Step 5: Update Configuration Sync

Per project conventions, update ALL THREE deployment targets:

1. **`docker-compose.yml`** — add under `teslasync` service environment:
   ```yaml
   DATABASE_CONNECT_TIMEOUT: 5
   DATABASE_STATEMENT_TIMEOUT: 30000
   DATABASE_HEALTH_CHECK_PERIOD: 5s
   ```

2. **`helm/teslasync/templates/configmap.yaml`** — add the three new env vars

3. **`helm/teslasync/values.yaml`** — add defaults with documentation comments

## Verification

```bash
# Build succeeds
CGO_ENABLED=0 go build ./cmd/teslasync

# Tests pass
go test -race ./internal/database/... ./internal/config/...

# Verify DSN includes new params
go test -run TestDSN ./internal/config/... -v
# Expected: postgres://...?sslmode=disable&connect_timeout=5&statement_timeout=30000

# Verify helm renders correctly
helm template test helm/teslasync | Select-String "CONNECT_TIMEOUT|STATEMENT_TIMEOUT|HEALTH_CHECK"
```

## Commit

After all verification passes, commit the changes:

```bash
git add -A
git commit -m "perf(db): add DSN connection timeouts and configurable health check period

- Add connect_timeout=5s and statement_timeout=30s to Postgres DSN
- Make HealthCheckPeriod configurable via DATABASE_HEALTH_CHECK_PERIOD (default 5s, was hardcoded 15s)
- Add AfterConnect hook to set per-connection statement_timeout
- Add PoolStats() method for enhanced observability
- Update docker-compose.yml, helm configmap, and values.yaml"
```

## What NOT To Change

- Do not modify the pool's `MaxConns`/`MinConns` defaults (25/5 is appropriate)
- Do not add retry logic here — that's a separate prompt (02-retry-on-flush)
- Do not change the `Health()` ping timeout (3s is fine)
- Do not add circuit breaker logic here — that's prompt 03
