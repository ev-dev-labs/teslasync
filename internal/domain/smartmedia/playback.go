package smartmedia

import "time"

const FavoriteContextHorizon = 2 * time.Hour

// PlaybackSample is one source-attested group, without values carried from previous media.
type PlaybackSample struct {
	At        time.Time
	Attested  bool
	Title     *string
	Artist    *string
	Source    *string
	Status    *string
	DurationS *float64
	ElapsedS  *float64
}

type TrackPlay struct {
	Title          string    `json:"title"`
	Artist         string    `json:"artist"`
	Source         string    `json:"source"`
	IdentityAt     time.Time `json:"identity_at"`
	ObservedFrom   time.Time `json:"observed_from"`
	LastObservedAt time.Time `json:"last_observed_at"`
	DurationS      *int      `json:"duration_s,omitempty"`
	LastElapsedS   float64   `json:"last_elapsed_s"`
}

type PlaylistSuggestion struct {
	TargetDurationS int         `json:"target_duration_s"`
	TotalDurationS  int         `json:"total_duration_s"`
	Tracks          []TrackPlay `json:"tracks"`
	Alternatives    []TrackPlay `json:"alternatives"`
}
