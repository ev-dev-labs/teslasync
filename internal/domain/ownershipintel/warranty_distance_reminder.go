package ownershipintel

import "time"

const LegacyOpenSubject = "open-mode"

type WarrantyDistanceReminder struct {
	WarrantyID        int64     `json:"warranty_id"`
	VehicleID         int64     `json:"vehicle_id"`
	RecordedAt        time.Time `json:"recorded_at"`
	EvidenceFrom      time.Time `json:"evidence_from"`
	ObservedDays      int       `json:"observed_days"`
	RemainingM        float64   `json:"remaining_m"`
	PaceMps           float64   `json:"pace_mps"`
	EarliestLimitAt   time.Time `json:"earliest_limit_at"`
	LatestLimitAt     time.Time `json:"latest_limit_at"`
	DocumentedTermEnd time.Time `json:"documented_term_end"`
	ExpiresAt         time.Time `json:"expires_at"`
}

type WarrantyReminderSettings struct {
	Enabled            bool                      `json:"enabled"`
	StartOdometerKnown bool                      `json:"start_odometer_known"`
	Projection         *WarrantyDistanceReminder `json:"projection"`
}

type WarrantyReminderOutcome string

const (
	WarrantyEligible             WarrantyReminderOutcome = "eligible"
	WarrantyInvalidTerm          WarrantyReminderOutcome = "invalid_term"
	WarrantyInsufficientEvidence WarrantyReminderOutcome = "insufficient_evidence"
	WarrantyStaleEvidence        WarrantyReminderOutcome = "stale_evidence"
	WarrantyInconsistentEvidence WarrantyReminderOutcome = "inconsistent_evidence"
	WarrantyLimitReached         WarrantyReminderOutcome = "limit_reached"
	WarrantyCalendarFirst        WarrantyReminderOutcome = "calendar_first_or_overlapping"
	WarrantyNotActionable        WarrantyReminderOutcome = "not_actionable"
	WarrantyClaimInvalidated     WarrantyReminderOutcome = "claim_invalidated"
)
