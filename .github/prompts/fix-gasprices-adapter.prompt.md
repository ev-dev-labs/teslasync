# Implement Gas Price Adapter — EIA API Integration

> **Context**: The `internal/adapter/gasprices/` directory is empty. The gas price
> feature currently works via `internal/worker/gas_price_worker.go` which calls the
> EIA API directly. The hexagonal architecture requires an adapter that implements
> the port interface defined in `internal/port/external/gasprices.go`.

---

## Current State

```
Port (interface):  internal/port/external/gasprices.go  — GasPriceProvider interface ✅
Adapter (impl):    internal/adapter/gasprices/          — EMPTY ❌
Worker:            internal/worker/gas_price_worker.go   — calls EIA API directly (bypasses adapter)
Handler:           internal/api/gas_price_handler.go     — wired to worker, works when API key is set
Config:            GasPriceConfig with APIKey, Enabled, PollInterval
```

The port interface:
```go
type GasPriceProvider interface {
    GetCurrentPrice(ctx context.Context, region string) (*EnergyPrice, error)
}

type EnergyPrice struct {
    PricePerKWh float64 `json:"pricePerKwh"`
    Currency    string  `json:"currency"`
    Region      string  `json:"region"`
}
```

## Task

### Step 1: Create EIA Adapter

Create `internal/adapter/gasprices/eia.go`:

```go
package gasprices

// EIAAdapter implements port/external.GasPriceProvider using the US Energy
// Information Administration (EIA) API for gasoline/electricity prices.
```

The adapter should:
1. Implement `GasPriceProvider` interface
2. Call the EIA open data API (`https://api.eia.gov/v2/petroleum/pri/gnd/data/`)
3. Accept API key via constructor
4. Convert gallon price → kWh equivalent using configurable efficiency factor
5. Support regions: `US` (national average), or state-level if available
6. Cache responses for configurable duration (default 1 hour) to avoid rate limits
7. Use `net/http` with timeout (10s) and proper error handling
8. Structured logging with zerolog

Reference the existing worker (`internal/worker/gas_price_worker.go`) for the
EIA API response format — it already parses `eiaResponse` struct.

### Step 2: Wire Adapter into Worker

Refactor `gas_price_worker.go` to use the adapter instead of calling EIA directly:

```go
// Before: worker has inline HTTP call to EIA
// After:  worker takes GasPriceProvider and calls provider.GetCurrentPrice()
```

Update constructor:
```go
func NewGasPriceWorker(db *database.DB, cfg config.GasPriceConfig, provider external.GasPriceProvider) *GasPriceWorker
```

Update `main.go` wiring (line ~351-355):
```go
if cfg.GasPrice.APIKey != "" {
    eiaAdapter := gasprices.NewEIAAdapter(cfg.GasPrice.APIKey)
    gasPriceWorker = worker.NewGasPriceWorker(db, cfg.GasPrice, eiaAdapter)
    ...
}
```

### Step 3: Add Tests

Create `internal/adapter/gasprices/eia_test.go`:
1. Test successful price fetch (mock HTTP server)
2. Test API error handling (500, timeout, invalid JSON)
3. Test caching — second call within TTL returns cached value
4. Test region parameter passed correctly

### Step 4: Add Documentation

Add a `internal/adapter/gasprices/doc.go`:
```go
// Package gasprices provides adapters for external energy/gas price APIs.
//
// Currently supported providers:
//   - EIA (US Energy Information Administration) — gasoline prices
//
// See ENGINEERING_GUIDELINES.md Section 7.4 for adapter patterns.
package gasprices
```

## Verification

```bash
# 1. Build passes
go build ./...

# 2. Tests pass
go test ./internal/adapter/gasprices/... -v

# 3. Worker still starts with API key
EIA_API_KEY=test go run ./cmd/teslasync --help

# 4. Existing gas price handler still works
# (start server, call GET /api/v1/gas-price/status)
```

## Do NOT:
- Remove or break the existing worker functionality
- Change the port interface (it's the contract)
- Hardcode API keys
- Skip error handling or logging
