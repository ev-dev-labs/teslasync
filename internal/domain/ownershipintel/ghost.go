package ownershipintel

import "time"

// GhostDrive is one drive flagged as plausibly driven by someone other
// than a known driver: unattributed to any named profile and behaviourally
// far from its cluster.
type GhostDrive struct {
	DriveID       int64     `json:"drive_id"`
	StartedAt     time.Time `json:"started_at"`
	DistanceM     float64   `json:"distance_m"`
	DurationS     int64     `json:"duration_s"`
	ClusterID     int       `json:"cluster_id"`
	Score         float64   `json:"score"`
	ConfidencePct float64   `json:"confidence_pct"`
	DistanceRatio float64   `json:"distance_ratio"`
	Reason        string    `json:"reason"`
}

// GhostReport is the ghost-driver scan over recent drives.
type GhostReport struct {
	VehicleID int64        `json:"vehicle_id"`
	Scanned   int          `json:"scanned"`
	Ghosts    []GhostDrive `json:"ghosts"`
}
