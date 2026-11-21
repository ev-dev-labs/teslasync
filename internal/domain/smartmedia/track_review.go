package smartmedia

import "time"

type TrackSaveStatus string

const (
	TrackReview   TrackSaveStatus = "review"
	TrackSaving   TrackSaveStatus = "saving"
	TrackSaved    TrackSaveStatus = "saved"
	TrackRejected TrackSaveStatus = "rejected"
	TrackUnknown  TrackSaveStatus = "unknown"
)

type DriveTrackReview struct {
	ID               int64           `json:"id"`
	DriveID          int64           `json:"drive_id"`
	VehicleID        int64           `json:"vehicle_id"`
	StartedAt        time.Time       `json:"started_at"`
	EndedAt          *time.Time      `json:"ended_at"`
	SelectedAt       *time.Time      `json:"selected_at,omitempty"`
	ExpiresAt        *time.Time      `json:"expires_at,omitempty"`
	Reason           string          `json:"reason"`
	Track            *TrackPlay      `json:"track"`
	EvidenceKey      string          `json:"evidence_key,omitempty"`
	Status           TrackSaveStatus `json:"save_status,omitempty"`
	LibraryAvailable bool            `json:"library_available"`
	LibraryConnected bool            `json:"library_connected"`
}

type SaveDriveTrack struct {
	Confirmed   bool   `json:"confirmed"`
	EvidenceKey string `json:"evidence_key"`
	Spotify     string `json:"spotify_track"`
}

type DriveTrackConfirmation struct {
	ExpectedID *int64    `json:"expected_review_id"`
	Confirmed  bool      `json:"confirmed"`
	StartedAt  time.Time `json:"started_at"`
	EndedAt    time.Time `json:"ended_at"`
	OffsetS    *int      `json:"offset_s"`
}

type DriveTrackSource struct {
	Review  DriveTrackReview
	Samples []PlaybackSample
}
