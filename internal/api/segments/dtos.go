package segments

// DTOs for the Ghost Racing / EV Segments endpoints. All JSON tags are
// snake_case to match the frontend wire contract; nullable Go pointers map to
// `T | null` in TypeScript. SI-canonical: distance in metres, duration in
// seconds, efficiency in watt-hours per kilometre. Numeric fields are rounded
// at the handler boundary.

// SegmentBest is a personal-best-by-time (or the latest) attempt reference.
type SegmentBest struct {
	DriveID   int64   `json:"drive_id"`
	DurationS float64 `json:"duration_s"`
	StartedAt string  `json:"started_at"`
}

// SegmentBestEff is a personal-best-by-efficiency attempt reference.
type SegmentBestEff struct {
	DriveID   int64   `json:"drive_id"`
	WhPerKm   float64 `json:"wh_per_km"`
	StartedAt string  `json:"started_at"`
}

// SegmentSummary is one detected segment in the list response. BestTime and
// Latest are always present (a segment has >= 2 attempts); BestEfficiency is
// null when no attempt has a measured energy reading. Id is 0 when the
// best-effort persist failed (the segment is still returned, but cannot be
// drilled into).
type SegmentSummary struct {
	ID             int64           `json:"id"`
	Name           string          `json:"name"`
	StartAddress   string          `json:"start_address"`
	EndAddress     string          `json:"end_address"`
	DistanceM      float64         `json:"distance_m"`
	AttemptCount   int             `json:"attempt_count"`
	BestTime       *SegmentBest    `json:"best_time"`
	BestEfficiency *SegmentBestEff `json:"best_efficiency"`
	Latest         *SegmentBest    `json:"latest"`
}

// SegmentsResponse is the body of GET /vehicles/{vehicleID}/segments. Segments
// is always a non-nil (possibly empty) slice so the frontend never guards a
// null array.
type SegmentsResponse struct {
	Segments []SegmentSummary `json:"segments"`
}

// SegmentInfo is the segment header echoed by the leaderboard and ghost
// responses. Addresses/distance/attempt_count are recomputed from the matched
// drives at read time (route_segments persists only the anchor + name).
type SegmentInfo struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	StartAddress string  `json:"start_address"`
	EndAddress   string  `json:"end_address"`
	DistanceM    float64 `json:"distance_m"`
	AttemptCount int     `json:"attempt_count"`
}

// LeaderboardRow is one ranked attempt. WhPerKm is null when the attempt has no
// energy reading. DeltaToBestS is the time gap to the fastest run (the
// by-time PR), in both orderings. IsPR flags the rank-1 row of its own ordering.
type LeaderboardRow struct {
	Rank         int      `json:"rank"`
	DriveID      int64    `json:"drive_id"`
	StartedAt    string   `json:"started_at"`
	DurationS    float64  `json:"duration_s"`
	DistanceM    float64  `json:"distance_m"`
	WhPerKm      *float64 `json:"wh_per_km"`
	DeltaToBestS float64  `json:"delta_to_best_s"`
	IsPR         bool     `json:"is_pr"`
}

// LeaderboardResponse is the body of GET /segments/{segmentID}/leaderboard. It
// carries both a by-time and a by-efficiency ordering; each is a non-nil
// (possibly empty) slice.
type LeaderboardResponse struct {
	Segment      SegmentInfo      `json:"segment"`
	ByTime       []LeaderboardRow `json:"by_time"`
	ByEfficiency []LeaderboardRow `json:"by_efficiency"`
}

// GhostSeriesPoint is one point of a drive's normalized progress series.
type GhostSeriesPoint struct {
	FractionOfDistance float64 `json:"fraction_of_distance"`
	ElapsedS           float64 `json:"elapsed_s"`
	SpeedMps           float64 `json:"speed_mps"`
}

// GhostDrive is one racer in the ghost response: its id, recorded duration, and
// its progress series. Series is always a non-nil (possibly empty) slice.
type GhostDrive struct {
	DriveID   int64              `json:"drive_id"`
	DurationS float64            `json:"duration_s"`
	Series    []GhostSeriesPoint `json:"series"`
}

// GhostSplitDelta is the A-vs-B time gap at a shared distance fraction.
type GhostSplitDelta struct {
	Fraction float64 `json:"fraction"`
	DeltaS   float64 `json:"delta_s"`
}

// GhostResponse is the body of GET /segments/{segmentID}/ghost?a=&b=. A and B
// are the two aligned drives; SplitDeltas shows where A gained/lost against B;
// WinnerDriveID is the faster drive (null on a tie) and MarginS the gap in
// seconds between the two recorded durations.
type GhostResponse struct {
	Segment       SegmentInfo       `json:"segment"`
	A             GhostDrive        `json:"a"`
	B             GhostDrive        `json:"b"`
	SplitDeltas   []GhostSplitDelta `json:"split_deltas"`
	WinnerDriveID *int64            `json:"winner_drive_id"`
	MarginS       float64           `json:"margin_s"`
}
