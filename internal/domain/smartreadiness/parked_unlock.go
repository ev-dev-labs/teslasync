package smartreadiness

import "time"

type ParkedUnlockReason string

const (
	UnlockMonitoring   ParkedUnlockReason = "monitoring"
	UnlockPlaceChanged ParkedUnlockReason = "place_changed"
	UnlockUnknown      ParkedUnlockReason = "unknown_state"
	UnlockOutsidePlace ParkedUnlockReason = "outside_place"
	UnlockLocked       ParkedUnlockReason = "locked"
	UnlockGrace        ParkedUnlockReason = "grace_period"
	UnlockAtRisk       ParkedUnlockReason = "parked_unlocked"
)

type ParkedUnlockRisk struct {
	DriveID       int64     `json:"park_id"`
	ParkedAt      time.Time `json:"parked_at"`
	UnlockedSince time.Time `json:"unlocked_since"`
	LastObserved  time.Time `json:"last_observed_at"`
	ActionUntil   time.Time `json:"expires_at"`
}

type ParkedUnlockSetup struct {
	Confirmed     bool      `json:"confirmed"`
	PlaceID       int64     `json:"place_id"`
	PlaceRevision time.Time `json:"place_revision"`
	DeviceID      int64     `json:"device_id"`
	PushTitle     string    `json:"push_title"`
	PushBody      string    `json:"push_body"`
}

type ParkedUnlockPlan struct {
	ID            int64              `json:"id"`
	PlaceID       int64              `json:"place_id"`
	PlaceRevision time.Time          `json:"place_revision"`
	PlaceName     string             `json:"place_name,omitempty"`
	PlaceReady    bool               `json:"place_ready"`
	DeviceID      int64              `json:"-"`
	DeviceReady   bool               `json:"device_ready"`
	EvidenceFrom  time.Time          `json:"-"`
	Paused        bool               `json:"paused"`
	SnoozedUntil  *time.Time         `json:"snoozed_until,omitempty"`
	Reason        ParkedUnlockReason `json:"reason"`
	Risk          *ParkedUnlockRisk  `json:"risk,omitempty"`
}
