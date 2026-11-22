package smartmedia

import "time"

type PlaylistSaveStatus string

const (
	PlaylistPreview     PlaylistSaveStatus = "preview"
	PlaylistSaving      PlaylistSaveStatus = "saving"
	PlaylistSaved       PlaylistSaveStatus = "saved"
	PlaylistRejected    PlaylistSaveStatus = "rejected"
	PlaylistCreatedOnly PlaylistSaveStatus = "created_only"
	PlaylistUnknown     PlaylistSaveStatus = "unknown"
)

type PlaylistCandidate struct {
	Position   int       `json:"position"`
	Title      string    `json:"title"`
	Artist     string    `json:"artist"`
	DurationS  int       `json:"duration_s"`
	ObservedAt time.Time `json:"observed_at"`
	Suggested  bool      `json:"suggested"`
}

type PlaylistDraft struct {
	FeatureCheckedAt time.Time           `json:"-"`
	ID               int64               `json:"id"`
	VehicleID        int64               `json:"vehicle_id"`
	DepartureAt      time.Time           `json:"departure_at"`
	TargetDurationS  int                 `json:"target_duration_s"`
	CreatedAt        time.Time           `json:"created_at"`
	ExpiresAt        time.Time           `json:"expires_at"`
	Paused           bool                `json:"paused"`
	SnoozedUntil     *time.Time          `json:"snoozed_until,omitempty"`
	Status           PlaylistSaveStatus  `json:"status"`
	PlaylistID       string              `json:"playlist_id,omitempty"`
	DispatchAt       *time.Time          `json:"-"`
	Candidates       []PlaylistCandidate `json:"candidates"`
}

type PlaylistSetup struct {
	DepartureAt     time.Time `json:"departure_at"`
	TargetDurationS int       `json:"target_duration_s"`
	Confirmed       bool      `json:"confirmed"`
}

type PlaylistReview struct {
	Draft     *PlaylistDraft `json:"draft"`
	Available bool           `json:"spotify_available"`
	Connected bool           `json:"spotify_connected"`
}

type PlaylistSelection struct {
	Position int    `json:"position"`
	Spotify  string `json:"spotify_track_link"`
}

type SavePlaylist struct {
	Name      string              `json:"name"`
	Selection []PlaylistSelection `json:"selection"`
	Confirmed bool                `json:"confirmed"`
}
