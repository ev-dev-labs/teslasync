# Adding Features

This guide walks you through adding a new feature to TeslaSync, covering both the Go backend and React frontend.

## Feature Development Workflow

1. **Plan** — Define the data model, API endpoints, and UI
2. **Database** — Create a migration for new tables/columns
3. **Repository** — Add data access methods in `internal/database/`
4. **Handler** — Add HTTP handlers in `internal/api/`
5. **Routes** — Register routes in `router.go`
6. **Frontend** — Create the page component and API client methods
7. **Test** — Write tests and verify everything works

## Step-by-Step Example: Adding a "Maintenance Log" Feature

Let's walk through adding a maintenance tracking feature (oil changes, tire rotations, etc.).

### 1. Create a Database Migration

Create a new migration file:

```bash
# Create migration files
touch migrations/000006_maintenance_log.up.sql
touch migrations/000006_maintenance_log.down.sql
```

Write the up migration (`000006_maintenance_log.up.sql`):

```sql
CREATE TABLE IF NOT EXISTS maintenance_logs (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,           -- oil_change, tire_rotation, brake_pad, etc.
    description TEXT,
    odometer DOUBLE PRECISION,
    cost DOUBLE PRECISION DEFAULT 0,
    performed_at TIMESTAMPTZ NOT NULL,
    next_due_at TIMESTAMPTZ,
    next_due_odometer DOUBLE PRECISION,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_maintenance_logs_vehicle ON maintenance_logs(vehicle_id, performed_at DESC);
```

Write the down migration (`000006_maintenance_log.down.sql`):

```sql
DROP TABLE IF EXISTS maintenance_logs;
```

### 2. Add the Domain Model

Add the model to `internal/models/models.go`:

```go
type MaintenanceLog struct {
    ID              int64      `json:"id"`
    VehicleID       int64      `json:"vehicle_id"`
    Type            string     `json:"type"`
    Description     string     `json:"description,omitempty"`
    Odometer        float64    `json:"odometer,omitempty"`
    Cost            float64    `json:"cost"`
    PerformedAt     time.Time  `json:"performed_at"`
    NextDueAt       *time.Time `json:"next_due_at,omitempty"`
    NextDueOdometer *float64   `json:"next_due_odometer,omitempty"`
    Notes           string     `json:"notes,omitempty"`
    CreatedAt       time.Time  `json:"created_at"`
    UpdatedAt       time.Time  `json:"updated_at"`
}
```

### 3. Create the Repository

Create `internal/database/maintenance_repo.go`:

```go
package database

import (
    "context"
    "github.com/ev-dev-labs/teslasync/internal/models"
)

func (db *DB) ListMaintenanceLogs(ctx context.Context, vehicleID int64) ([]models.MaintenanceLog, error) {
    rows, err := db.pool.Query(ctx,
        `SELECT id, vehicle_id, type, description, odometer, cost,
                performed_at, next_due_at, next_due_odometer, notes,
                created_at, updated_at
         FROM maintenance_logs
         WHERE vehicle_id = $1
         ORDER BY performed_at DESC`, vehicleID)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var logs []models.MaintenanceLog
    for rows.Next() {
        var log models.MaintenanceLog
        err := rows.Scan(
            &log.ID, &log.VehicleID, &log.Type, &log.Description,
            &log.Odometer, &log.Cost, &log.PerformedAt,
            &log.NextDueAt, &log.NextDueOdometer, &log.Notes,
            &log.CreatedAt, &log.UpdatedAt,
        )
        if err != nil {
            return nil, err
        }
        logs = append(logs, log)
    }
    return logs, nil
}

func (db *DB) CreateMaintenanceLog(ctx context.Context, log *models.MaintenanceLog) error {
    return db.pool.QueryRow(ctx,
        `INSERT INTO maintenance_logs
         (vehicle_id, type, description, odometer, cost, performed_at,
          next_due_at, next_due_odometer, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, created_at, updated_at`,
        log.VehicleID, log.Type, log.Description, log.Odometer,
        log.Cost, log.PerformedAt, log.NextDueAt,
        log.NextDueOdometer, log.Notes,
    ).Scan(&log.ID, &log.CreatedAt, &log.UpdatedAt)
}

func (db *DB) DeleteMaintenanceLog(ctx context.Context, id int64) error {
    _, err := db.pool.Exec(ctx,
        `DELETE FROM maintenance_logs WHERE id = $1`, id)
    return err
}
```

### 4. Create the Handler

Create `internal/api/maintenance_handler.go`:

```go
package api

import (
    "encoding/json"
    "net/http"
    "strconv"

    "github.com/go-chi/chi/v5"
    "github.com/ev-dev-labs/teslasync/internal/database"
    "github.com/ev-dev-labs/teslasync/internal/models"
)

type MaintenanceHandler struct {
    db *database.DB
}

func NewMaintenanceHandler(db *database.DB) *MaintenanceHandler {
    return &MaintenanceHandler{db: db}
}

func (h *MaintenanceHandler) List(w http.ResponseWriter, r *http.Request) {
    vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
    if err != nil {
        respondError(w, http.StatusBadRequest, "invalid vehicle_id")
        return
    }

    logs, err := h.db.ListMaintenanceLogs(r.Context(), vehicleID)
    if err != nil {
        respondError(w, http.StatusInternalServerError, err.Error())
        return
    }
    respondJSON(w, http.StatusOK, logs)
}

func (h *MaintenanceHandler) Create(w http.ResponseWriter, r *http.Request) {
    var log models.MaintenanceLog
    if err := json.NewDecoder(r.Body).Decode(&log); err != nil {
        respondError(w, http.StatusBadRequest, "invalid request body")
        return
    }

    if err := h.db.CreateMaintenanceLog(r.Context(), &log); err != nil {
        respondError(w, http.StatusInternalServerError, err.Error())
        return
    }
    respondJSON(w, http.StatusCreated, log)
}

func (h *MaintenanceHandler) Delete(w http.ResponseWriter, r *http.Request) {
    id, err := strconv.ParseInt(chi.URLParam(r, "logID"), 10, 64)
    if err != nil {
        respondError(w, http.StatusBadRequest, "invalid log ID")
        return
    }

    if err := h.db.DeleteMaintenanceLog(r.Context(), id); err != nil {
        respondError(w, http.StatusInternalServerError, err.Error())
        return
    }
    w.WriteHeader(http.StatusNoContent)
}
```

### 5. Register Routes

Add the routes to `internal/api/router.go`:

```go
// In the NewRouter function, add:
maintenanceHandler := NewMaintenanceHandler(db)

r.Route("/api/v1/maintenance", func(r chi.Router) {
    r.Get("/", maintenanceHandler.List)
    r.Post("/", maintenanceHandler.Create)
    r.Delete("/{logID}", maintenanceHandler.Delete)
})
```

### 6. Add Frontend API Client

Add to `web/src/api.ts`:

```typescript
maintenance: {
    list: (vehicleId: number) =>
        fetch(`/api/v1/maintenance?vehicle_id=${vehicleId}`).then(r => r.json()),
    create: (log: MaintenanceLog) =>
        fetch('/api/v1/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(log),
        }).then(r => r.json()),
    delete: (id: number) =>
        fetch(`/api/v1/maintenance/${id}`, { method: 'DELETE' }),
},
```

### 7. Create the Page Component

Create `web/src/pages/Maintenance.tsx`:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GlassPanel, Table, Button } from '../components/ui'
import { api } from '../api'

export default function Maintenance() {
  const queryClient = useQueryClient()
  const { data: logs, isLoading } = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => api.maintenance.list(vehicleId),
  })

  const createMutation = useMutation({
    mutationFn: api.maintenance.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maintenance'] }),
  })

  if (isLoading) return <PageLoader />

  return (
    <GlassPanel>
      <h1>Maintenance Log</h1>
      <Table
        columns={['Type', 'Description', 'Odometer', 'Cost', 'Date']}
        data={logs}
      />
    </GlassPanel>
  )
}
```

### 8. Add the Route

In `web/src/App.tsx`:

```tsx
const Maintenance = lazy(() => import('./pages/Maintenance'))

// In the router:
<Route path="maintenance" element={<SafeRoute name="Maintenance"><Maintenance /></SafeRoute>} />
```

### 9. Test Your Feature

```bash
# Run backend tests
make test

# Run frontend lint
make web-lint

# Start everything and test manually
make docker-up

# Test the API
curl -X POST http://localhost:8080/api/v1/maintenance \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": 1,
    "type": "tire_rotation",
    "description": "Rotated all 4 tires",
    "odometer": 25000,
    "cost": 50,
    "performed_at": "2024-01-20T10:00:00Z"
  }'

curl "http://localhost:8080/api/v1/maintenance?vehicle_id=1"
```

## Conventions

### Backend Conventions

- **File naming:** `{domain}_handler.go`, `{domain}_repo.go`
- **Error handling:** Return errors to the caller; handlers convert to HTTP status codes
- **JSON responses:** Use `respondJSON()` and `respondError()` helpers
- **Logging:** Use zerolog — `log.Info().Str("vehicle", vin).Msg("processed")`
- **Context:** Always pass `context.Context` through the call chain

### Frontend Conventions

- **Pages:** One file per page in `web/src/pages/`, default export, lazy-loaded
- **Data fetching:** TanStack Query for all server state
- **Styling:** Tailwind CSS utility classes, glass-morphism components
- **Types:** Define interfaces in `types.ts` or inline

### Database Conventions

- **Migration naming:** `000NNN_description.{up,down}.sql`
- **Primary keys:** `BIGSERIAL` named `id`
- **Foreign keys:** `ON DELETE CASCADE` for child tables
- **Timestamps:** `TIMESTAMPTZ` with `DEFAULT NOW()`
- **Indexes:** Always index `vehicle_id` and time columns
