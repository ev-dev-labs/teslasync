package smartmedia

import "time"

type EpisodeProgress struct {
	ID        string
	Title     string
	DurationS int
	PositionS *int
	Completed *bool
}

type EpisodeFit struct {
	Reason     string
	RemainingS *int
}

type EpisodeReview struct {
	ID               int64      `json:"id"`
	VehicleID        int64      `json:"vehicle_id"`
	DepartureAt      *time.Time `json:"departure_at,omitempty"`
	DriveDurationS   *int       `json:"drive_duration_s,omitempty"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	Reason           string     `json:"reason"`
	RemainingS       *int       `json:"remaining_s,omitempty"`
	Title            string     `json:"title,omitempty"`
	SpotifyEpisode   string     `json:"spotify_episode,omitempty"`
	SpotifyStartS    *int       `json:"spotify_start_s,omitempty"`
	SpotifyAvailable bool       `json:"spotify_available"`
}

type EpisodeConfirmation struct {
	ExpectedID     *int64         `json:"expected_review_id"`
	Confirmed      bool           `json:"confirmed"`
	DepartureAt    time.Time      `json:"departure_at"`
	DriveDurationS int            `json:"drive_duration_s"`
	SpotifyEpisode string         `json:"spotify_episode"`
	Manual         *ManualEpisode `json:"manual"`
}

type ManualEpisode struct {
	Title     string `json:"title"`
	DurationS int    `json:"duration_s"`
	PositionS *int   `json:"position_s"`
}

type StoredEpisodeReview struct {
	FeaturePaused bool
	Review        EpisodeReview
	EpisodeID     string
	Progress      *EpisodeProgress
}
