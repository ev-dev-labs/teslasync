package dashboard

import "time"

// PinnedItemType enumerates the surfaces that may be pinned. The set must
// stay in lockstep with the CHECK constraint on the `pinned_items` table
// (migration 000162) and the `PinnedItemType` union in
// `web/src/api/types.ts`.
type PinnedItemType string

const (
	PinnedItemTypeVehicle    PinnedItemType = "vehicle"
	PinnedItemTypeWidget     PinnedItemType = "widget"
	PinnedItemTypeAlertRule  PinnedItemType = "alert_rule"
	PinnedItemTypeLocation   PinnedItemType = "location"
	PinnedItemTypeGeofence   PinnedItemType = "geofence"
	PinnedItemTypeAutomation PinnedItemType = "automation"
	PinnedItemTypeDashboard  PinnedItemType = "dashboard"
	PinnedItemTypeCommand    PinnedItemType = "command"
)

// Valid reports whether t is a recognised pin item type. Used by the HTTP
// handler before insert so an unknown value can never reach the database
// CHECK constraint (which would surface as a 500).
func (t PinnedItemType) Valid() bool {
	switch t {
	case PinnedItemTypeVehicle,
		PinnedItemTypeWidget,
		PinnedItemTypeAlertRule,
		PinnedItemTypeLocation,
		PinnedItemTypeGeofence,
		PinnedItemTypeAutomation,
		PinnedItemTypeDashboard,
		PinnedItemTypeCommand:
		return true
	}
	return false
}

// PinnedItem mirrors a row in the `pinned_items` table introduced by
// migration 000162. The frontend uses these rows to render pinned-first
// lists across vehicles, dashboard widgets, alert rules, geofences,
// automations, etc.
//
// Per-user scope:
//
//	UserID == nil → unscoped pin (single-user install: every pin)
//	UserID != nil → owned by the referenced user (reserved for future
//	                multi-tenancy)
//
// Context narrows a pin to a sub-surface (e.g. a specific dashboard ID
// when pinning a widget). NULL context means "global within the
// (user, item_type) scope".
type PinnedItem struct {
	ID       int64          `json:"id"                 db:"id"`
	UserID   *int64         `json:"user_id,omitempty"  db:"user_id"`
	ItemType PinnedItemType `json:"item_type"          db:"item_type"`
	ItemID   string         `json:"item_id"            db:"item_id"`
	Position int            `json:"position"           db:"position"`
	PinnedAt time.Time      `json:"pinned_at"          db:"pinned_at"`
	Context  *string        `json:"context,omitempty"  db:"context"`
}
