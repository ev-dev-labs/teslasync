---
description: "Template for building a new end-to-end feature (backend + frontend). Follow every step."
---

# New Feature Template

Use this template when adding a feature that spans backend and frontend.

## Planning Phase

### 1. Define the feature scope
- What data does this feature show/manage?
- What backend endpoints are needed?
- What frontend pages/components are needed?
- What existing infrastructure can be reused?

### 2. Check what already exists
```bash
# Backend: existing handlers, repos, models
grep -rn "relevant_keyword" internal/api/ internal/database/ internal/models/

# Frontend: existing hooks, pages, types
grep -rn "relevant_keyword" web/src/api/hooks/ web/src/features/ web/src/types/

# Routes: existing endpoints
grep -n "relevant_keyword" internal/api/router.go
```

## Backend Implementation

### Step 1: Model (if new entity)

Create or update in `internal/models/models.go`:
```go
type NewEntity struct {
    ID        int64      `json:"id" db:"id"`
    VehicleID int64      `json:"vehicle_id" db:"vehicle_id"`
    Value     float64    `json:"value" db:"value"`
    CreatedAt time.Time  `json:"created_at" db:"created_at"`
}
```

Rules:
- JSON tags use snake_case
- Nullable fields use pointers: `*float64`, `*string`
- Both `json` and `db` tags on every field

### Step 2: Database Migration (if new table)

Create `internal/database/migrations/000NNN_description.up.sql`:
```sql
CREATE TABLE IF NOT EXISTS new_entities (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id),
    value DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_new_entities_vehicle_id ON new_entities(vehicle_id);
```

And matching `.down.sql`:
```sql
DROP TABLE IF EXISTS new_entities;
```

### Step 3: Repository

Create `internal/database/new_entity_repo.go`:
```go
type NewEntityRepo struct { db *DB }

func NewNewEntityRepo(db *DB) *NewEntityRepo {
    return &NewEntityRepo{db: db}
}

func (r *NewEntityRepo) GetByVehicleID(ctx context.Context, vehicleID int64) ([]*models.NewEntity, error) {
    query := `SELECT id, vehicle_id, value, created_at FROM new_entities WHERE vehicle_id = $1 ORDER BY created_at DESC`
    rows, err := r.db.Pool.Query(ctx, query, vehicleID)
    if err != nil { return nil, err }
    defer rows.Close()
    // ... scan rows
}
```

Rules:
- Parameterized queries only (`$1`, `$2`)
- Return `(nil, nil)` for `pgx.ErrNoRows`
- Always `defer rows.Close()`

### Step 4: Handler

Create `internal/api/new_entity_handler.go`:
```go
type NewEntityHandler struct {
    db *database.DB
}

func NewNewEntityHandler(db *database.DB) *NewEntityHandler {
    return &NewEntityHandler{db: db}
}

func (h *NewEntityHandler) List(w http.ResponseWriter, r *http.Request) {
    vehicleID, _ := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
    ctx := r.Context()
    
    repo := database.NewNewEntityRepo(h.db)
    items, err := repo.GetByVehicleID(ctx, vehicleID)
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to fetch data")
        return
    }
    writeJSON(w, http.StatusOK, items)
}
```

Rules:
- Use `writeJSON`/`writeError` helpers
- Parse query params with `r.URL.Query().Get()`, not from path for optional filters
- Use `context.Context` from request

### Step 5: Wire route in router.go

In `internal/api/router.go`:
```go
newEntityHandler := NewNewEntityHandler(db)
// Inside r.Route("/api/v1", ...)
r.Get("/new-entities", newEntityHandler.List)
```

### Step 6: Verify backend
```bash
go build ./...                    # Must compile
go test ./internal/api/... -run TestNewEntity  # If tests exist
```

## Frontend Implementation

### Step 7: TypeScript types

In `web/src/types/` or `web/src/api/types.ts`:
```typescript
export interface NewEntity {
  id: number;
  vehicle_id: number;
  value: number | null;  // nullable Go pointer → number | null
  created_at: string;
}
```

### Step 8: API Hook

In the appropriate `web/src/api/hooks/useXxx.ts`:
```typescript
export function useNewEntities(vehicleId?: string) {
  return useQuery({
    queryKey: ['new-entities', vehicleId],
    queryFn: () => request<NewEntity[]>(
      vehicleId ? `/new-entities?vehicle_id=${vehicleId}` : '/new-entities'
    ),
    enabled: !!vehicleId,
  });
}
```

**CRITICAL:** No `/api/v1/` prefix — `request()` adds it automatically.

### Step 9: Page

Follow the `new-page.prompt.md` template for the full page scaffold.

### Step 10: Wire route in App.tsx
```typescript
const NewPage = lazy(() => import('./features/{domain}/pages/NewPage'));
<Route path="/new-feature" element={<NewPage />} />
```

## Verification Checklist

```bash
# Backend
go build ./...
go vet ./...

# Frontend
cd web && npx tsc --noEmit

# Audit (if code-guardian extension is active)
# The agent can call: audit_code({ path: "web/src/features/{domain}/pages/NewPage.tsx" })
```

**ALL must be true:**
- [ ] Backend compiles clean
- [ ] Frontend TypeScript passes
- [ ] Hook calls correct endpoint (matches router.go, no /api/v1/ prefix)
- [ ] Page uses PageContainer + shared components only
- [ ] All strings use useTranslation()
- [ ] All sections always render (EmptyState for no data)
- [ ] Zero inline styles with var(--)
- [ ] Zero raw HTML elements
- [ ] Zero direct recharts/leaflet imports
- [ ] snake_case query params only
