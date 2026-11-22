package smartreadiness

import "time"

type ParkedClosurePosition string

const (
	ClosureDriverFront    ParkedClosurePosition = "driver_front_door"
	ClosurePassengerFront ParkedClosurePosition = "passenger_front_door"
	ClosureDriverRear     ParkedClosurePosition = "driver_rear_door"
	ClosurePassengerRear  ParkedClosurePosition = "passenger_rear_door"
	ClosureFrontTrunk     ParkedClosurePosition = "front_trunk"
	ClosureRearTrunk      ParkedClosurePosition = "rear_trunk"
)

type ParkedClosureReason string

const (
	ClosureMonitoring ParkedClosureReason = "monitoring"
	ClosureUnknown    ParkedClosureReason = "unknown_state"
	ClosureActive     ParkedClosureReason = "active_use"
	ClosureClosed     ParkedClosureReason = "all_closed"
	ClosureGrace      ParkedClosureReason = "grace_period"
	ClosureAtRisk     ParkedClosureReason = "parked_closure_open"
)

type ParkedClosureRisk struct {
	DriveID      int64                 `json:"park_id"`
	Position     ParkedClosurePosition `json:"position"`
	ParkedAt     time.Time             `json:"parked_at"`
	OpenSince    time.Time             `json:"open_since"`
	LastObserved time.Time             `json:"last_observed_at"`
	ActionUntil  time.Time             `json:"expires_at"`
}

type RecentPark struct {
	DriveID int64
	EndedAt time.Time
}

type ParkedClosurePlan struct {
	ID           int64               `json:"id"`
	GraceS       int                 `json:"grace_s"`
	Paused       bool                `json:"paused"`
	SnoozedUntil *time.Time          `json:"snoozed_until,omitempty"`
	Reason       ParkedClosureReason `json:"reason"`
	DeviceReady  bool                `json:"device_ready"`
	Risk         *ParkedClosureRisk  `json:"risk,omitempty"`
	EvidenceFrom time.Time           `json:"-"`
	DeviceID     int64               `json:"-"`
}

type ParkedClosureSetup struct {
	GraceS    int    `json:"grace_s"`
	DeviceID  int64  `json:"device_id"`
	Confirmed bool   `json:"confirmed"`
	PushTitle string `json:"push_title"`
	PushBody  string `json:"push_body"`
}
