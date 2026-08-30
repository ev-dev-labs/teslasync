// Package activity defines the read-only DTOs for the unified vehicle
// operations-intelligence timeline (GET /api/v1/activity). Items are
// computed at query time from existing domain tables (drives,
// charging_sessions, notification_logs, software_updates,
// chart_annotations) — there is no activity table of its own. See
// internal/database/activity for the composing query.
package activity

import "time"

// Kind enumerates the domains the activity timeline currently surfaces.
//
// Maintenance/service events are intentionally NOT included: the only
// existing maintenance surface (internal/api/maintenance) returns a
// synthetic default schedule from defaultItems() and an always-empty
// Records() response — there is no real dated service-history table to
// source from. Surfacing it here would fabricate activity, which the
// product spec explicitly forbids. This is a documented limitation, not
// an oversight; the frontend page surfaces it as a "not available yet"
// note rather than silently omitting the kind filter option.
type Kind string

const (
	KindDrive          Kind = "drive"
	KindCharging       Kind = "charging"
	KindAlert          Kind = "alert"
	KindSoftwareUpdate Kind = "software_update"
	KindAnnotation     Kind = "annotation"
)

// AllKinds is the full set of kinds accepted by the ?kind= filter, in the
// fixed order the repository composes their UNION ALL subqueries.
var AllKinds = []Kind{KindDrive, KindCharging, KindAlert, KindSoftwareUpdate, KindAnnotation}

// ParseKind validates a raw query-param value against AllKinds. Returns
// ("", false) for anything unrecognized so the handler can 400 rather than
// silently drop an unknown filter.
func ParseKind(raw string) (Kind, bool) {
	k := Kind(raw)
	for _, candidate := range AllKinds {
		if candidate == k {
			return k, true
		}
	}
	return "", false
}

// Item is one row of the unified activity timeline.
//
// Title/Summary carry source-authored text for alerts and annotations.
// Session measurements stay as typed SI fields so the frontend can localize
// the narrative and convert only at the display boundary. Items never include
// street addresses, coordinates, or the vehicle VIN.
type Item struct {
	// ID is a stable composite identifier: "<source_table>:<source_id>".
	ID         string    `json:"id"`
	Kind       Kind      `json:"kind"`
	OccurredAt time.Time `json:"occurred_at"`
	VehicleID  *int64    `json:"vehicle_id,omitempty"`
	Title      string    `json:"title"`
	Summary    string    `json:"summary"`
	// Severity is populated for kind=alert only ("info" | "warn" | "critical").
	Severity *string `json:"severity,omitempty"`
	// Status is domain-specific: drive/charging use "in_progress" |
	// "completed"; alert uses the notification delivery status
	// (pending/sent/failed/deferred_dnd); software_update uses its
	// lifecycle status (available/downloading/installing/installed);
	// annotation uses its category (milestone/maintenance/trip/issue/
	// upgrade/custom).
	Status string `json:"status"`
	// SourceTable / SourceID identify the underlying row this item was
	// computed from — explicit provenance for debugging and audit.
	SourceTable string `json:"source_table"`
	SourceID    int64  `json:"source_id"`
	// Path is a safe, existing frontend route the UI can navigate to for
	// more detail. Omitted (nil) when no such route exists.
	Path          *string  `json:"path,omitempty"`
	DurationS     *int64   `json:"duration_s,omitempty"`
	StartSocPct   *float64 `json:"start_soc_pct,omitempty"`
	EndSocPct     *float64 `json:"end_soc_pct,omitempty"`
	EnergyAddedWh *float64 `json:"energy_added_wh,omitempty"`
	Version       *string  `json:"version,omitempty"`
}

// ListResponse is the stable envelope returned by GET /api/v1/activity.
type ListResponse struct {
	Items       []Item    `json:"items"`
	Total       int64     `json:"total"`
	Limit       int       `json:"limit"`
	Offset      int       `json:"offset"`
	GeneratedAt time.Time `json:"generated_at"`
}
