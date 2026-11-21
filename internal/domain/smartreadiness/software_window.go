package smartreadiness

import "time"

type SoftwareWindowReason string

const (
	SoftwareWindowNoEvidence SoftwareWindowReason = "missing_evidence"
	SoftwareWindowNotReady   SoftwareWindowReason = "update_not_ready"
	SoftwareWindowNotIdle    SoftwareWindowReason = "not_observed_idle"
	SoftwareWindowTooShort   SoftwareWindowReason = "insufficient_margin"
	SoftwareWindowHeld       SoftwareWindowReason = "held"
	SoftwareWindowExpired    SoftwareWindowReason = "expired"
	SoftwareWindowFits       SoftwareWindowReason = "fits"
)

type SoftwareWindowPlan struct {
	ID                 int64                 `json:"id"`
	VehicleID          int64                 `json:"vehicle_id"`
	DepartureAt        time.Time             `json:"departure_at"`
	ConfirmedAt        time.Time             `json:"confirmed_at"`
	Version            string                `json:"version"`
	EstimatedDurationS int                   `json:"estimated_duration_s"`
	Paused             bool                  `json:"paused"`
	SnoozedUntil       *time.Time            `json:"snoozed_until,omitempty"`
	Reason             SoftwareWindowReason  `json:"reason"`
	Review             *SoftwareWindowReview `json:"review,omitempty"`
}

type SoftwareWindowSetup struct {
	DepartureAt             time.Time `json:"departure_at"`
	Version                 string    `json:"version"`
	EstimatedDurationS      int       `json:"estimated_duration_s"`
	CheckedReadyUnscheduled bool      `json:"checked_ready_unscheduled"`
}

type SoftwareWindowReview struct {
	MarginS            int       `json:"margin_s"`
	ParkedAt           time.Time `json:"parked_at"`
	IdleObservedFrom   time.Time `json:"idle_observed_from"`
	LastIdleObservedAt time.Time `json:"last_idle_observed_at"`
	UpdateObservedAt   time.Time `json:"update_observed_at"`
	ActionUntil        time.Time `json:"action_until"`
}
