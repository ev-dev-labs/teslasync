package dashboard

import (
	"encoding/json"
	"time"
)

// DashboardLayout mirrors a row in the `dashboard_layouts` table introduced
// by migration 000156. It is the per-row "library" backing for the named
// layouts users can switch between in the LayoutSwitcher.
//
// Per-vehicle scope:
//
//	VehicleID == nil  → applies to any vehicle (user-global default)
//	VehicleID != nil  → pinned to a specific vehicle
//
// The `Layout` field carries the same `SavedDashboard` JSON the frontend
// already produces (widgets[], layouts{}, settings{}). It is stored verbatim
// after the handler validates it is a JSON object — schema evolution can
// happen entirely in the frontend without further migrations.
type DashboardLayout struct {
	ID        int64           `json:"id"            db:"id"`
	UserID    *int64          `json:"user_id,omitempty"    db:"user_id"`
	VehicleID *int64          `json:"vehicle_id,omitempty" db:"vehicle_id"`
	Name      string          `json:"name"          db:"name"`
	IsDefault bool            `json:"is_default"    db:"is_default"`
	Layout    json.RawMessage `json:"layout"        db:"layout"`
	CreatedAt time.Time       `json:"created_at"    db:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"    db:"updated_at"`
}
