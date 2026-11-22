package smartmedia

import "time"

type SoundtrackReview struct {
	ID             int64       `json:"id"`
	JourneyID      int64       `json:"journey_id"`
	VehicleID      int64       `json:"vehicle_id"`
	StartedAt      *time.Time  `json:"started_at"`
	EndedAt        *time.Time  `json:"ended_at"`
	ExpiresAt      *time.Time  `json:"expires_at,omitempty"`
	Paused         bool        `json:"paused"`
	SnoozedUntil   *time.Time  `json:"snoozed_until,omitempty"`
	Reason         string      `json:"reason"`
	MatchedDrives  int         `json:"matched_drives"`
	ObservedDrives int         `json:"observed_drives"`
	Plays          []TrackPlay `json:"plays"`
}

type SoundtrackConfirmation struct {
	ExpectedID *int64    `json:"expected_review_id"`
	Confirmed  bool      `json:"confirmed"`
	StartedAt  time.Time `json:"started_at"`
	EndedAt    time.Time `json:"ended_at"`
}

type DriveWindow struct {
	ID        int64
	StartedAt time.Time
	EndedAt   time.Time
}

type SoundtrackSource struct {
	Review  SoundtrackReview
	Drives  []DriveWindow
	Samples []PlaybackSample
}
