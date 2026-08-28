package fleetstatesvc

import (
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// Per-item outcome vocabulary. These are the THREE operationally distinct
// answers a fleet reader needs, and collapsing any two of them is exactly how
// "the API pod is restarting" previously rendered as "every car is offline".
const (
	// OutcomeResolved — a state was assembled for this vehicle. The only
	// outcome from which an operational status may be derived.
	OutcomeResolved = "resolved"
	// OutcomeMissing — the read succeeded and there is authoritatively no
	// state. Unknown, NOT offline.
	OutcomeMissing = "missing"
	// OutcomeFailed — resolution failed for this vehicle. A fact about us,
	// not about the car.
	OutcomeFailed = "failed"
)

// ErrCodeStateUnavailable is the stable machine code returned for a failed
// item. Driver/context error text stays server-side (logs + span) so the wire
// contract never leaks internals.
const ErrCodeStateUnavailable = "state_unavailable"

// DataSourceUnavailable is explicit provenance for items that have no
// readable state. An empty string would violate the published API enum and
// force generated clients to treat an otherwise valid partial batch as
// malformed.
const DataSourceUnavailable = "unavailable"

// VehicleStateItem is one vehicle's slot in a batch response.
//
// Resolved-item provenance is byte-identical to
// GET /api/v1/vehicles/{id}/state because both are projected from the same
// service.CurrentState. Missing and failed items use DataSourceUnavailable.
type VehicleStateItem struct {
	VehicleID int64  `json:"vehicle_id"`
	Outcome   string `json:"outcome"`
	// State is nil for missing/failed items. A nil state is NEVER an
	// offline classification — read Outcome first.
	State      *vehiclemodel.VehicleState `json:"state"`
	Live       bool                       `json:"live"`
	DataSource string                     `json:"data_source"`
	ObservedAt *time.Time                 `json:"observed_at,omitempty"`
	Freshness  string                     `json:"freshness"`
	// VerifiedFields is always an array (never null) so clients can iterate
	// without a null guard.
	VerifiedFields []string `json:"verified_fields"`
	// Error carries ErrCodeStateUnavailable for failed items and is omitted
	// otherwise.
	Error string `json:"error,omitempty"`
}

// Batch is the wire shape of GET /api/v1/vehicles/states.
type Batch struct {
	// Now is the single request-level instant every item was classified
	// against. Clients render observation AGE relative to their own clock,
	// but Now lets them detect clock skew rather than silently absorb it.
	Now time.Time `json:"now"`
	// Total is the number of vehicles matching the query BEFORE pagination.
	Total int `json:"total"`
	Limit int `json:"limit"`
	// Offset is the applied offset. Always present so a paging client never
	// has to infer it.
	Offset int `json:"offset"`
	// Counts is the per-outcome roll-up of Vehicles, so a caller can size an
	// alert without walking the array.
	Counts   OutcomeCounts      `json:"counts"`
	Vehicles []VehicleStateItem `json:"vehicles"`
}

// OutcomeCounts rolls one batch up by outcome.
type OutcomeCounts struct {
	Resolved int `json:"resolved"`
	Missing  int `json:"missing"`
	Failed   int `json:"failed"`
}

// Query selects and pages the fleet.
type Query struct {
	// VehicleIDs restricts the batch to a caller-supplied set. Empty means
	// the whole fleet. The SPA always sends its current fleet membership so
	// the response and its cache key describe the same set of cars.
	VehicleIDs []int64
	Limit      int
	Offset     int
}
