---
description: "Add Tesla user profile endpoint: fetch from Tesla, persist to DB, display on Tesla Account page"
---

# Feature: Tesla User Profile (`/users/me`)

## Overview

Fetch the Tesla account owner's profile from `GET /api/1/users/me`, persist it to our
database, and serve it from our DB to the frontend. A "Refresh" action re-fetches from
Tesla and updates the DB. This ensures the data is available even when Tesla API is down.

## Tesla Fleet API

```
GET /api/1/users/me
```

**Response** (example):
```json
{
  "response": {
    "email": "user@example.com",
    "full_name": "John Doe",
    "profile_image_url": "https://...",
    "vault_uuid": "..."
  }
}
```

## Step 1 — Database Migration

Create `migrations/000099_add_tesla_user_profile.up.sql`:

```sql
CREATE TABLE IF NOT EXISTS tesla_user_profiles (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL DEFAULT '',
    full_name       TEXT NOT NULL DEFAULT '',
    profile_image_url TEXT,
    raw_json        JSONB NOT NULL DEFAULT '{}',
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

And `migrations/000099_add_tesla_user_profile.down.sql`:
```sql
DROP TABLE IF EXISTS tesla_user_profiles;
```

> **Note:** We use a single-row table (upsert pattern) since there's one Tesla account
> per TeslaSync instance. The `raw_json` column stores the full Tesla response for
> forward compatibility.

## Step 2 — Backend: Add model

In `internal/models/models.go`:

```go
// TeslaUserProfile represents the Tesla account owner's profile.
type TeslaUserProfile struct {
    ID              int64      `json:"id" db:"id"`
    Email           string     `json:"email" db:"email"`
    FullName        string     `json:"full_name" db:"full_name"`
    ProfileImageURL *string    `json:"profile_image_url" db:"profile_image_url"`
    RawJSON         string     `json:"raw_json,omitempty" db:"raw_json"`
    FetchedAt       time.Time  `json:"fetched_at" db:"fetched_at"`
    CreatedAt       time.Time  `json:"created_at" db:"created_at"`
    UpdatedAt       time.Time  `json:"updated_at" db:"updated_at"`
}
```

## Step 3 — Backend: Add Tesla client method

In `internal/tesla/client.go`:

```go
// GetUserProfile calls GET /api/1/users/me to fetch the Tesla account owner's profile.
func (c *Client) GetUserProfile(ctx context.Context) ([]byte, int, error) {
    return c.doRequest(ctx, http.MethodGet, "/api/1/users/me", nil)
}
```

## Step 4 — Backend: Add repository

Create `internal/database/tesla_user_profile_repo.go`:

```go
type TeslaUserProfileRepo struct { db *DB }

func NewTeslaUserProfileRepo(db *DB) *TeslaUserProfileRepo {
    return &TeslaUserProfileRepo{db: db}
}

// Get returns the stored Tesla user profile (single row).
func (r *TeslaUserProfileRepo) Get(ctx context.Context) (*models.TeslaUserProfile, error) {
    p := &models.TeslaUserProfile{}
    query := `SELECT id, email, full_name, profile_image_url, raw_json, fetched_at, created_at, updated_at
        FROM tesla_user_profiles ORDER BY updated_at DESC LIMIT 1`
    err := r.db.Pool.QueryRow(ctx, query).Scan(
        &p.ID, &p.Email, &p.FullName, &p.ProfileImageURL, &p.RawJSON,
        &p.FetchedAt, &p.CreatedAt, &p.UpdatedAt,
    )
    if err == pgx.ErrNoRows { return nil, nil }
    return p, err
}

// Upsert inserts or updates the Tesla user profile.
func (r *TeslaUserProfileRepo) Upsert(ctx context.Context, p *models.TeslaUserProfile) error {
    now := time.Now().UTC()
    query := `INSERT INTO tesla_user_profiles (email, full_name, profile_image_url, raw_json, fetched_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT ((TRUE)) DO UPDATE SET
            email = $1, full_name = $2, profile_image_url = $3,
            raw_json = $4, fetched_at = $5, updated_at = $6
        RETURNING id`
    // Note: ON CONFLICT needs a unique constraint. Alternative: DELETE + INSERT,
    // or use id=1 as a fixed row. Simplest approach: always delete then insert.
    _, err := r.db.Pool.Exec(ctx, `DELETE FROM tesla_user_profiles`)
    if err != nil { return err }
    return r.db.Pool.QueryRow(ctx, `INSERT INTO tesla_user_profiles
        (email, full_name, profile_image_url, raw_json, fetched_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        p.Email, p.FullName, p.ProfileImageURL, p.RawJSON, now, now,
    ).Scan(&p.ID)
}
```

## Step 5 — Backend: Add handler

Create `internal/api/tesla_user_handler.go`:

```go
type TeslaUserHandler struct {
    teslaClient *tesla.Client
    profileRepo *database.TeslaUserProfileRepo
}

func NewTeslaUserHandler(tc *tesla.Client, db *database.DB) *TeslaUserHandler {
    return &TeslaUserHandler{
        teslaClient: tc,
        profileRepo: database.NewTeslaUserProfileRepo(db),
    }
}

// Profile returns the stored Tesla user profile from DB.
func (h *TeslaUserHandler) Profile(w http.ResponseWriter, r *http.Request) {
    profile, err := h.profileRepo.Get(r.Context())
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to fetch profile")
        return
    }
    if profile == nil {
        writeJSON(w, http.StatusOK, nil)
        return
    }
    writeJSON(w, http.StatusOK, profile)
}

// RefreshProfile fetches from Tesla API and saves to DB.
func (h *TeslaUserHandler) RefreshProfile(w http.ResponseWriter, r *http.Request) {
    if !h.teslaClient.HasValidToken() {
        writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
        return
    }
    body, status, err := h.teslaClient.GetUserProfile(r.Context())
    if err != nil || status != http.StatusOK {
        writeError(w, http.StatusBadGateway, "failed to fetch from Tesla")
        return
    }

    var envelope struct {
        Response struct {
            Email           string  `json:"email"`
            FullName        string  `json:"full_name"`
            ProfileImageURL *string `json:"profile_image_url"`
        } `json:"response"`
    }
    if err := json.Unmarshal(body, &envelope); err != nil {
        writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
        return
    }

    profile := &models.TeslaUserProfile{
        Email:           envelope.Response.Email,
        FullName:        envelope.Response.FullName,
        ProfileImageURL: envelope.Response.ProfileImageURL,
        RawJSON:         string(body),
    }
    if err := h.profileRepo.Upsert(r.Context(), profile); err != nil {
        writeError(w, http.StatusInternalServerError, "failed to save profile")
        return
    }
    writeJSON(w, http.StatusOK, profile)
}
```

## Step 6 — Backend: Wire routes

In `internal/api/router.go`:

```go
teslaUserHandler := NewTeslaUserHandler(teslaClient, db)

r.Get("/tesla/user/profile", teslaUserHandler.Profile)
r.Post("/tesla/user/profile/refresh", teslaUserHandler.RefreshProfile)
```

## Step 7 — Frontend: Add hook

In `web/src/api/hooks/useUser.ts`:

```typescript
export interface TeslaUserProfile {
    id: number;
    email: string;
    full_name: string;
    profile_image_url: string | null;
    fetched_at: string;
}

export function useTeslaUserProfile() {
    return useQuery({
        queryKey: ['tesla-user-profile'],
        queryFn: () => request<TeslaUserProfile | null>('/tesla/user/profile'),
        staleTime: 5 * 60_000,
    });
}

export function useRefreshTeslaProfile() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => request<TeslaUserProfile>('/tesla/user/profile/refresh', { method: 'POST' }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['tesla-user-profile'] }),
    });
}
```

## Step 8 — Frontend: Tesla Account page

Create `web/src/features/system/pages/TeslaAccountPage.tsx`. Show profile with a
"Refresh from Tesla" button and "Last synced: 2h ago" timestamp from `fetched_at`.

Wire route in `App.tsx`:
```typescript
const TeslaAccountPage = lazy(() => import('./features/system/pages/TeslaAccountPage'));
<Route path="/tesla-account" element={<TeslaAccountPage />} />
```

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

# Migration exists
ls migrations/000099_add_tesla_user_profile.*

# Backend wired
grep -n "tesla/user/profile" internal/api/router.go

# Hook exists
grep -n "useTeslaUserProfile" web/src/api/hooks/useUser.ts
```
