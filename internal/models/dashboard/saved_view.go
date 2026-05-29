package dashboard

import "time"

// SavedView mirrors a row in the `saved_views` table introduced by
// migration 000164. It is the durable form of a
// "named URL querystring" — the user gives a memorable name to a filter
// combination on a list page and recalls it later from the
// SavedViewMenu component.
//
// Per-user scope:
//
//	UserID == nil → unscoped view (single-user install: every view)
//	UserID != nil → owned by the referenced user (reserved for future
//	                multi-tenancy)
//
// JSON shape is snake_case to match the rest of the API; the frontend
// camelCaseKeys transform produces matching camelCase keys so consumers
// can pick either naming convention.
type SavedView struct {
	ID        int64     `json:"id"                db:"id"`
	UserID    *int64    `json:"user_id,omitempty" db:"user_id"`
	Name      string    `json:"name"              db:"name"`
	Route     string    `json:"route"             db:"route"`
	Query     string    `json:"query"             db:"query"`
	IsDefault bool      `json:"is_default"        db:"is_default"`
	IsPinned  bool      `json:"is_pinned"         db:"is_pinned"`
	SortOrder int       `json:"sort_order"        db:"sort_order"`
	CreatedAt time.Time `json:"created_at"        db:"created_at"`
	UpdatedAt time.Time `json:"updated_at"        db:"updated_at"`
}
