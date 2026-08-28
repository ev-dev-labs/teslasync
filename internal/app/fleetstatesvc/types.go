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
	Counts OutcomeCounts `json:"counts"`
	// Summary is the server-derived Fleet Posture roll-up of THIS page. It is
	// computed from the same items, the same request-level Now and the same
	// trust precedence, so a client can paint the posture panel without
	// re-deriving anything — and cannot disagree with the list.
	Summary  Summary            `json:"summary"`
	Vehicles []VehicleStateItem `json:"vehicles"`
}

// OutcomeCounts rolls one batch up by outcome.
type OutcomeCounts struct {
	Resolved int `json:"resolved"`
	Missing  int `json:"missing"`
	Failed   int `json:"failed"`
}

// Summary is the server-derived Fleet Posture roll-up.
//
// # Taxonomy invariant
//
// Every item lands in EXACTLY ONE bucket:
//
//	sum(Operational) + sum(Attention) == Counted == len(Batch.Vehicles)
//
// An item is counted in Operational only when its status is TRUSTED — the
// same precedence the per-item verified_fields + freshness metadata expresses,
// applied here so the totals cannot drift from the items. Everything else is
// an Attention bucket describing OUR EVIDENCE, never the vehicle. In
// particular `offline` is reachable only from a trusted FSM state: a missing,
// stale, unverified or failed read is NEVER reported as offline.
type Summary struct {
	// Counted is the number of items in this page the summary describes. It
	// is len(Batch.Vehicles), not Batch.Total, because a summary can only
	// speak for the vehicles actually read.
	Counted int `json:"counted"`
	// VerifiedCount is the number of items carrying a trusted operational
	// status: the "N of M verified" coverage Fleet Posture renders.
	VerifiedCount int `json:"verified_count"`
	// AttentionCount is Counted - VerifiedCount.
	AttentionCount int `json:"attention_count"`
	// Operational totals the TRUSTED status claims only.
	Operational OperationalTotals `json:"operational"`
	// Attention totals the evidence problems.
	Attention AttentionTotals `json:"attention"`
	// OldestObservedAt is the oldest REAL live observation among items that
	// have one — a fleet summary is only as fresh as its stalest member.
	// Null when no item carries a real observation; never a fetch time.
	OldestObservedAt *time.Time `json:"oldest_observed_at"`
	// NewestObservedAt is the newest REAL live observation among items that
	// have one. Null when no item carries one.
	NewestObservedAt *time.Time `json:"newest_observed_at"`
	// ObservedCount is the number of items carrying a real observation
	// instant, so a client can tell "no observations at all" from "one very
	// old observation".
	ObservedCount int `json:"observed_count"`
}

// OperationalTotals counts TRUSTED operational statuses.
//
// The vocabulary is the backend FSM's (internal/enums): driving, charging,
// parked, asleep, online, offline. `updating` is a Tesla-API/front-end-only
// label with no FSM transition behind it, so it is deliberately absent rather
// than reported as a permanent zero; any trusted state outside the vocabulary
// is counted in Other so the taxonomy invariant still holds.
type OperationalTotals struct {
	Charging int `json:"charging"`
	Driving  int `json:"driving"`
	Parked   int `json:"parked"`
	Asleep   int `json:"asleep"`
	Online   int `json:"online"`
	Offline  int `json:"offline"`
	Other    int `json:"other"`
}

// AttentionTotals counts items with NO trusted operational status, split by
// the reason we cannot make a claim. These are statements about our evidence.
type AttentionTotals struct {
	// Unverified — state was returned and the stream IS fresh, but the field
	// that would establish the status is not backed by a real observation.
	Unverified int `json:"unverified"`
	// Stale — a real observation exists but it is outside the freshness
	// window. Old evidence, not absent evidence, and not offline.
	Stale int `json:"stale"`
	// Unknown — state was returned with NO real observation behind it at all
	// (durable fallback only, or legacy zero-timestamp values).
	Unknown int `json:"unknown"`
	// Missing — the read succeeded and there is authoritatively no state.
	Missing int `json:"missing"`
	// Failed — resolution failed for this vehicle. A fact about us.
	Failed int `json:"failed"`
}

// ScopeGlobalRoster is the default request scope.
//
// # Scope assumption (documented, not invented)
//
// This deployment has exactly ONE global vehicle roster: the roster read is
// vehicleRepo.GetAll(ctx) with no tenant/owner predicate, and authorization is
// an all-or-nothing ForwardAuth gate in front of /api/v1/* (ADR-005). There is
// therefore no per-caller vehicle visibility to leak BETWEEN callers, and
// every authenticated caller asking the same normalized question is entitled
// to the same answer.
//
// Query.Scope exists anyway, and is part of every cache key, so that the day a
// tenant/owner dimension is introduced it MUST be threaded through this field
// — a new scope simply cannot collide with the global one. Leaving it empty
// means the global roster; it is never silently mapped to some other tenant.
const ScopeGlobalRoster = "global"

// Query selects and pages the fleet.
type Query struct {
	// Scope names the roster the caller is entitled to. Empty means
	// ScopeGlobalRoster — see the constant for the deployment assumption.
	// It participates in the coalescing/micro-cache key so results can never
	// cross scopes.
	Scope string
	// VehicleIDs restricts the batch to a caller-supplied set. Empty means
	// the whole fleet. The SPA always sends its current fleet membership so
	// the response and its cache key describe the same set of cars.
	VehicleIDs []int64
	Limit      int
	Offset     int
}
