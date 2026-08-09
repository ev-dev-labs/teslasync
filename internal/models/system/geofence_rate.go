package system

import (
	"time"
)

// =============================================================================
// geofence_rate.go — Go models for the charging-place pricing feature
// (migration 000228_geofence_charging_place_pricing).
//
// GeofenceRate is the single normalized, effective-dated source of truth for
// a geofence's electricity rate over time — there is no separate mutable
// "current rate" column anywhere. The "current" rate for a geofence is
// simply whichever row's [EffectiveFrom, EffectiveTo) interval contains the
// query instant (typically "now", or a charging session's StartedAt for
// historical pricing).
//
// RatePerWh is SI-canonical: currency units per **watt-hour**, never
// per-kWh. The UI converts to currency/kWh only at the render/request
// boundary (ADR-001 typed-by-default, ADR-005 frontend SI cutover).
// =============================================================================

// GeofenceRate mirrors one row of the `geofence_rates` table.
type GeofenceRate struct {
	ID            int64      `db:"id" json:"id"`
	GeofenceID    int64      `db:"geofence_id" json:"geofence_id"`
	RatePerWh     float64    `db:"rate_per_wh" json:"rate_per_wh"`
	Currency      string     `db:"currency" json:"currency"`
	EffectiveFrom time.Time  `db:"effective_from" json:"effective_from"`
	EffectiveTo   *time.Time `db:"effective_to" json:"effective_to,omitempty"`
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
}

// IsActiveAt reports whether this rate version was in force at instant t,
// using the canonical half-open [EffectiveFrom, EffectiveTo) interval.
func (r *GeofenceRate) IsActiveAt(t time.Time) bool {
	if r == nil {
		return false
	}
	if t.Before(r.EffectiveFrom) {
		return false
	}
	return r.EffectiveTo == nil || t.Before(*r.EffectiveTo)
}

// IsOpen reports whether this rate version has no end date yet (the
// currently-in-force version, absent a future-dated successor).
func (r *GeofenceRate) IsOpen() bool { return r != nil && r.EffectiveTo == nil }

// Charging-session cost provenance. Mirrors the values allowed by the
// charging_sessions.cost_source CHECK constraint (migration 000228).
//
// Precedence (highest to lowest confidence): manual actual costs entered by
// a user, then Tesla-reported actual costs, then geofence-tariff-derived
// costs, then a legacy/global default estimate, then unknown (unpriced).
const (
	CostSourceManual          = "manual"
	CostSourceTeslaActual     = "tesla_actual"
	CostSourceGeofenceTariff  = "geofence_tariff"
	CostSourceDefaultEstimate = "default_estimate"
	CostSourceUnknown         = "unknown"
)

// GeofenceRateApplyScope bounds a preview/apply operation to a geofence +
// rate version, optionally narrowed further by an explicit time window. The
// zero value (nil bounds) means "the rate's own effective interval".
//
// This is an internal argument bag passed between the handler and repo
// layers (never persisted or unmarshaled from a request body directly), but
// it still carries json tags per ADR-006's blanket models-package rule and
// so it serializes sensibly if ever logged or echoed back.
type GeofenceRateApplyScope struct {
	GeofenceID int64      `json:"geofence_id"`
	RateID     int64      `json:"rate_id"`
	From       *time.Time `json:"from,omitempty"`
	To         *time.Time `json:"to,omitempty"`
}

// GeofenceRateImpactPreview is the read-only "what would applying this rate
// do" response — no rows are written. EligibleSessions is the subset of
// MatchedSessions that repricing is actually allowed to touch (unpriced or
// previously geofence-derived); sessions already carrying a manual,
// Tesla-actual, or unknown-provenance cost are matched (in-scope by place +
// time) but never eligible, and are surfaced separately so the UI can
// explain why the preview total is smaller than the raw session count.
type GeofenceRateImpactPreview struct {
	GeofenceID           int64   `json:"geofence_id"`
	RateID               int64   `json:"rate_id"`
	Currency             string  `json:"currency"`
	MatchedSessions      int64   `json:"matched_sessions"`
	EligibleSessions     int64   `json:"eligible_sessions"`
	ProtectedSessions    int64   `json:"protected_sessions"`
	TotalEnergyWh        float64 `json:"total_energy_wh"`
	EstimatedCostDecimal float64 `json:"estimated_cost_decimal"`
}

// GeofenceRateApplyResult is the outcome of an explicit apply/backfill
// action — the write-performing counterpart of GeofenceRateImpactPreview.
type GeofenceRateApplyResult struct {
	GeofenceID       int64   `json:"geofence_id"`
	RateID           int64   `json:"rate_id"`
	Currency         string  `json:"currency"`
	MatchedSessions  int64   `json:"matched_sessions"`
	PricedSessions   int64   `json:"priced_sessions"`
	SkippedSessions  int64   `json:"skipped_sessions"`
	TotalEnergyWh    float64 `json:"total_energy_wh"`
	TotalCostDecimal float64 `json:"total_cost_decimal"`
}

// ChargingPlaceBackfillCandidate is the minimal completed-session projection
// needed by the startup Charging Places backfill. Only sessions with valid
// coordinates and no geofence attribution are returned by the repository.
type ChargingPlaceBackfillCandidate struct {
	SessionID  int64     `db:"id" json:"session_id"`
	VehicleID  int64     `db:"vehicle_id" json:"vehicle_id"`
	StartedAt  time.Time `db:"started_at" json:"started_at"`
	StartLat   float64   `db:"start_lat" json:"start_lat"`
	StartLng   float64   `db:"start_lng" json:"start_lng"`
	StartPlace *string   `db:"start_place" json:"start_place,omitempty"`
}

// GeofenceChargingSummary aggregates a geofence's priced charging activity
// for one currency. Different currencies are NEVER summed into one total —
// callers always receive a slice grouped by currency, even when a place has
// only ever seen one.
type GeofenceChargingSummary struct {
	GeofenceID       int64   `json:"geofence_id"`
	Currency         string  `json:"currency"`
	SessionCount     int64   `json:"session_count"`
	TotalEnergyWh    float64 `json:"total_energy_wh"`
	TotalCostDecimal float64 `json:"total_cost_decimal"`
}

// GeofenceChargingActivity is one line item in a geofence's charging session
// activity feed (used by the rate-history / affected-sessions UI panels).
type GeofenceChargingActivity struct {
	SessionID    int64      `json:"session_id"`
	VehicleID    int64      `json:"vehicle_id"`
	StartedAt    time.Time  `json:"started_at"`
	EndedAt      *time.Time `json:"ended_at,omitempty"`
	EnergyWh     *float64   `json:"energy_wh,omitempty"`
	CostDecimal  *float64   `json:"cost_decimal,omitempty"`
	CostCurrency *string    `json:"cost_currency,omitempty"`
	CostSource   *string    `json:"cost_source,omitempty"`
	RateID       *int64     `json:"rate_id,omitempty"`
}
