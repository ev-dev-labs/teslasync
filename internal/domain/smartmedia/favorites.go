package smartmedia

import "time"

type FavoriteRecording struct {
	Key       string `json:"key"`
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Source    string `json:"source"`
	DurationS int    `json:"duration_s"`
}

type FavoriteCandidate struct {
	FavoriteRecording
	ObservedDrives int `json:"observed_drives"`
	ObservedDates  int `json:"observed_dates"`
}

type FavoriteDigest struct {
	From       time.Time           `json:"from"`
	Until      time.Time           `json:"until"`
	ExpiresAt  time.Time           `json:"expires_at"`
	Candidates []FavoriteCandidate `json:"candidates"`
}

type FavoriteDigestSettings struct {
	VehicleID int64               `json:"vehicle_id"`
	Revision  int64               `json:"revision"`
	TimeZone  string              `json:"time_zone,omitempty"`
	NextAt    *time.Time          `json:"next_at,omitempty"`
	Digest    *FavoriteDigest     `json:"digest,omitempty"`
	Favorites []FavoriteRecording `json:"favorites"`
}

type FavoriteDigestSetup struct {
	ExpectedRevision *int64 `json:"expected_revision"`
	Confirmed        bool   `json:"confirmed"`
	TimeZone         string `json:"time_zone"`
	Paused           bool   `json:"paused"`
}

type FavoriteDigestAction struct {
	Revision    int64     `json:"revision"`
	DigestUntil time.Time `json:"digest_until"`
	Key         string    `json:"key"`
	Action      string    `json:"action"`
}
