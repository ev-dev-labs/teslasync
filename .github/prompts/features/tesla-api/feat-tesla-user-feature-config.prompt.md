---
description: "Add Tesla feature config endpoint: fetch from Tesla, persist to DB, display feature flags on Tesla Account page"
---

# Feature: Tesla Feature Config (`/users/feature_config`)

## Overview

Fetch the Tesla Fleet API `GET /api/1/users/feature_config` endpoint, persist feature flags
to our database, and serve from DB to the frontend. A "Refresh" action re-fetches from Tesla.
Also proxy `/users/region` (already implemented in Tesla client) with DB persistence.

## Tesla Fleet API

```
GET /api/1/users/feature_config
```

**Response** (example):
```json
{
  "response": {
    "signaling": {
      "enabled": true,
      "allowed_keys": ["LocationOne", "LocationTwo"]
    }
  }
}
```

```
GET /api/1/users/region
```

**Response** (example):
```json
{
  "response": {
    "region": "NA",
    "fleet_api_base_url": "https://fleet-api.prd.na.vn.cloud.tesla.com"
  }
}
```

## Step 1 — Database Migration

Create `migrations/000101_add_tesla_user_config.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_user_config (
    id              BIGSERIAL PRIMARY KEY,
    config_type     TEXT NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(config_type)
);
```

- `config_type = 'feature_config'` → stores feature flags JSON
- `config_type = 'region'` → stores region + fleet_api_base_url JSON

And `migrations/000101_add_tesla_user_config.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_user_config;
```

## Step 2 — Backend: Add model

In `internal/models/models.go`:

```go
// TeslaUserConfig stores a Tesla user configuration blob (feature_config, region, etc.)
type TeslaUserConfig struct {
    ID         int64     `json:"id" db:"id"`
    ConfigType string    `json:"config_type" db:"config_type"`
    Data       string    `json:"data" db:"data"`       // JSONB stored as string
    FetchedAt  time.Time `json:"fetched_at" db:"fetched_at"`
    CreatedAt  time.Time `json:"created_at" db:"created_at"`
    UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`
}
```

## Step 3 — Backend: Add Tesla client method

In `internal/tesla/client.go`:

```go
// GetUserFeatureConfig calls GET /api/1/users/feature_config to fetch account feature flags.
func (c *Client) GetUserFeatureConfig(ctx context.Context) ([]byte, int, error) {
    return c.doRequest(ctx, http.MethodGet, "/api/1/users/feature_config", nil)
}
```

> **Note:** `GetUserRegion` already exists in `client.go`.

## Step 4 — Backend: Add repository

Create `internal/database/tesla_user_config_repo.go`:

```go
type TeslaUserConfigRepo struct { db *DB }

func NewTeslaUserConfigRepo(db *DB) *TeslaUserConfigRepo {
    return &TeslaUserConfigRepo{db: db}
}

// GetByType returns the stored config for a given type.
func (r *TeslaUserConfigRepo) GetByType(ctx context.Context, configType string) (*models.TeslaUserConfig, error) {
    c := &models.TeslaUserConfig{}
    query := `SELECT id, config_type, data, fetched_at, created_at, updated_at
        FROM tesla_user_config WHERE config_type = $1`
    err := r.db.Pool.QueryRow(ctx, query, configType).Scan(
        &c.ID, &c.ConfigType, &c.Data, &c.FetchedAt, &c.CreatedAt, &c.UpdatedAt,
    )
    if err == pgx.ErrNoRows { return nil, nil }
    return c, err
}

// Upsert inserts or updates a config entry by type.
func (r *TeslaUserConfigRepo) Upsert(ctx context.Context, configType string, data string) error {
    now := time.Now().UTC()
    _, err := r.db.Pool.Exec(ctx, `INSERT INTO tesla_user_config (config_type, data, fetched_at, created_at, updated_at)
        VALUES ($1, $2, $3, $3, $3)
        ON CONFLICT (config_type) DO UPDATE SET data = $2, fetched_at = $3, updated_at = $3`,
        configType, data, now)
    return err
}
```

## Step 5 — Backend: Add handler methods

In `internal/api/tesla_user_handler.go`, add `configRepo` field and methods:

```go
// FeatureConfig returns stored feature config from DB.
func (h *TeslaUserHandler) FeatureConfig(w http.ResponseWriter, r *http.Request) {
    cfg, err := h.configRepo.GetByType(r.Context(), "feature_config")
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to fetch feature config")
        return
    }
    if cfg == nil {
        writeJSON(w, http.StatusOK, map[string]interface{}{})
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(cfg.Data))
}

// RefreshFeatureConfig fetches from Tesla and saves to DB.
func (h *TeslaUserHandler) RefreshFeatureConfig(w http.ResponseWriter, r *http.Request) {
    if !h.teslaClient.HasValidToken() {
        writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
        return
    }
    body, status, err := h.teslaClient.GetUserFeatureConfig(r.Context())
    if err != nil || status != http.StatusOK {
        writeError(w, http.StatusBadGateway, "failed to fetch from Tesla")
        return
    }
    var envelope struct { Response json.RawMessage `json:"response"` }
    if err := json.Unmarshal(body, &envelope); err != nil {
        writeError(w, http.StatusInternalServerError, "failed to parse response")
        return
    }
    data := string(envelope.Response)
    if err := h.configRepo.Upsert(r.Context(), "feature_config", data); err != nil {
        writeError(w, http.StatusInternalServerError, "failed to save feature config")
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write(envelope.Response)
}

// Region returns stored region from DB.
func (h *TeslaUserHandler) Region(w http.ResponseWriter, r *http.Request) {
    cfg, err := h.configRepo.GetByType(r.Context(), "region")
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to fetch region")
        return
    }
    if cfg == nil {
        writeJSON(w, http.StatusOK, map[string]interface{}{})
        return
    }
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(cfg.Data))
}

// RefreshRegion fetches from Tesla and saves to DB.
func (h *TeslaUserHandler) RefreshRegion(w http.ResponseWriter, r *http.Request) {
    // Same pattern — call h.teslaClient.GetUserRegion(), unwrap envelope, upsert "region"
}
```

## Step 6 — Backend: Wire routes

```go
r.Get("/tesla/user/feature-config", teslaUserHandler.FeatureConfig)
r.Post("/tesla/user/feature-config/refresh", teslaUserHandler.RefreshFeatureConfig)
r.Get("/tesla/user/region", teslaUserHandler.Region)
r.Post("/tesla/user/region/refresh", teslaUserHandler.RefreshRegion)
```

## Step 7 — Frontend: Add hooks

In `web/src/api/hooks/useUser.ts`:

```typescript
export function useTeslaFeatureConfig() {
    return useQuery({
        queryKey: ['tesla-feature-config'],
        queryFn: () => request<Record<string, unknown>>('/tesla/user/feature-config'),
        staleTime: 10 * 60_000,
    });
}

export function useRefreshTeslaFeatureConfig() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request<Record<string, unknown>>('/tesla/user/feature-config/refresh', { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-feature-config'] }),
    });
}

export function useTeslaUserRegion() {
    return useQuery({
        queryKey: ['tesla-user-region'],
        queryFn: () => request<{ region: string; fleet_api_base_url: string }>('/tesla/user/region'),
        staleTime: Infinity,
    });
}

export function useRefreshTeslaRegion() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request<{ region: string; fleet_api_base_url: string }>('/tesla/user/region/refresh', { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-user-region'] }),
    });
}
```

## Step 8 — Frontend: Display on Tesla Account page

Add "Feature Flags" and "Region & API" sections on `TeslaAccountPage.tsx`.
Each section shows a "Refresh from Tesla" button and "Last synced" from `fetched_at`.

Feature flags: render as a table with feature name, enabled badge, and details.
Region: show region code (NA, EU, CN) and Fleet API base URL.

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

ls migrations/000101_add_tesla_user_config.*
grep -n "tesla/user/feature-config" internal/api/router.go
grep -n "tesla/user/region" internal/api/router.go
grep -n "useTeslaFeatureConfig" web/src/api/hooks/useUser.ts
```
