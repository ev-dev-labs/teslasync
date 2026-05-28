package dashboard

import "time"

// AnnotationCategory enumerates the supported annotation kinds. The set
// mirrors the AnnotationCategory union in web/src/types/annotations.ts so
// the wire shape between Go and TypeScript stays in lockstep.
type AnnotationCategory string

const (
	AnnotationCategoryMilestone   AnnotationCategory = "milestone"
	AnnotationCategoryMaintenance AnnotationCategory = "maintenance"
	AnnotationCategoryTrip        AnnotationCategory = "trip"
	AnnotationCategoryIssue       AnnotationCategory = "issue"
	AnnotationCategoryUpgrade     AnnotationCategory = "upgrade"
	AnnotationCategoryCustom      AnnotationCategory = "custom"
)

// Valid reports whether c is a recognised annotation category. Used by the
// HTTP handler before insert/update so an unknown value cannot reach the
// database CHECK constraint (which would surface as a 500).
func (c AnnotationCategory) Valid() bool {
	switch c {
	case AnnotationCategoryMilestone,
		AnnotationCategoryMaintenance,
		AnnotationCategoryTrip,
		AnnotationCategoryIssue,
		AnnotationCategoryUpgrade,
		AnnotationCategoryCustom:
		return true
	}
	return false
}

// ChartAnnotation mirrors a row in the `chart_annotations` table introduced
// by migration 000159. Annotations are user-authored event markers rendered
// on time-series charts (battery replacement, software update, tire change…).
//
// Per-vehicle scope:
//
//	VehicleID == nil  → applies to any vehicle (fleet-wide event)
//	VehicleID != nil  → pinned to a specific vehicle
//
// `Scope` is a list of chart "buckets" (battery, efficiency, cost, tire,
// energy, drivetrain, mileage, charging). Empty slice means the annotation
// shows on every chart that opts in.
type ChartAnnotation struct {
	ID          int64              `json:"id"                     db:"id"`
	UserID      *int64             `json:"user_id,omitempty"      db:"user_id"`
	VehicleID   *int64             `json:"vehicle_id,omitempty"   db:"vehicle_id"`
	OccurredAt  time.Time          `json:"occurred_at"            db:"occurred_at"`
	Category    AnnotationCategory `json:"category"               db:"category"`
	Title       string             `json:"title"                  db:"title"`
	Description *string            `json:"description,omitempty"  db:"description"`
	Scope       []string           `json:"scope"                  db:"scope"`
	Color       *string            `json:"color,omitempty"        db:"color"`
	CreatedAt   time.Time          `json:"created_at"             db:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"             db:"updated_at"`
}
