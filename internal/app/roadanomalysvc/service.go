package roadanomalysvc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	MaxWindow           = 2 * time.Hour
	maxRows             = 20000
	maxEvents           = 100000
	maxCandidates       = 100
	maxGap              = 450 * time.Millisecond
	maxFreshness        = time.Second
	standardGravityMps2 = 9.80665
)

var ErrNotFound = errors.New("drive not found")
var ErrInvalidDrive = errors.New("invalid drive timestamps")
var ErrWindowTooLarge = errors.New("drive exceeds two-hour analysis limit")

// Status enumerates the only three possible analysis outcomes.
type Status string

const (
	StatusInsufficientData Status = "insufficient_data"
	StatusNoCandidates     Status = "no_candidates"
	StatusCandidates       Status = "candidates"
)

type DriveReader interface {
	GetByID(context.Context, int64) (*drivemodel.Drive, error)
}

type Service struct {
	drives DriveReader
	state  signal.StateReader
}

func New(drives DriveReader, state signal.StateReader) *Service {
	return &Service{drives: drives, state: state}
}

// Candidate is an unverified, localized possible road anomaly, NOT a
// confirmed pothole. Speed is SI; acceleration is converted from stored m/s² to g.
type Candidate struct {
	Timestamp          time.Time `json:"timestamp"`
	Latitude           float64   `json:"latitude"`
	Longitude          float64   `json:"longitude"`
	SpeedMps           float64   `json:"speed_mps"`
	PeakLongitudinalG  float64   `json:"peak_longitudinal_g"`
	DeltaLongitudinalG float64   `json:"delta_longitudinal_g"`
	JerkGPerS          float64   `json:"jerk_g_per_s"`
	SampleIntervalMs   int64     `json:"sample_interval_ms"`
	Classification     string    `json:"classification"`
}

// Result is drive-scoped. Status is exactly "insufficient_data",
// "no_candidates", or "candidates". The latter never confirms potholes;
// even an assessable window with no candidate cannot prove a smooth road.
type Result struct {
	DriveID           int64       `json:"drive_id"`
	VehicleID         int64       `json:"vehicle_id"`
	From              time.Time   `json:"from"`
	To                time.Time   `json:"to"`
	Status            Status      `json:"status"`
	Reasons           []string    `json:"reasons"`
	Limitations       []string    `json:"limitations"`
	AnalyzedSamples   int         `json:"analyzed_samples"`
	AssessableWindows int         `json:"assessable_windows"`
	Candidates        []Candidate `json:"candidates"`
}

var fields = []signal.FieldMapping{
	{Signal: "LongitudinalAcceleration", Field: "longitudinal"},
	{Signal: "LateralAcceleration", Field: "lateral"},
	{Signal: "VehicleSpeed", Field: "speed"},
	{Signal: "LocationLatitude", Field: "latitude"},
	{Signal: "LocationLongitude", Field: "longitude"},
	{Signal: "BrakePedal", Field: "brake"},
	{Signal: "BrakePedalPos", Field: "brake_position"},
}

// Analyze resolves the drive before reading signals: its stored VehicleID and
// timestamps, never client-supplied vehicle or window parameters, determine
// the bounded timeline. The extra row distinguishes exact-cap results from
// truncated results.
func (s *Service) Analyze(ctx context.Context, id int64) (Result, error) {
	drive, err := s.drives.GetByID(ctx, id)
	if err != nil {
		return Result{}, fmt.Errorf("load drive: %w", err)
	}
	if drive == nil {
		return Result{}, ErrNotFound
	}
	to := time.Now().UTC()
	if drive.EndTs != nil {
		to = *drive.EndTs
	}
	if drive.StartTs.IsZero() || !to.After(drive.StartTs) || drive.VehicleID <= 0 {
		return Result{}, ErrInvalidDrive
	}
	if to.Sub(drive.StartTs) > MaxWindow {
		return Result{}, ErrWindowTooLarge
	}
	// Timeline reads (from, to]; include an emission exactly at drive start
	// without treating older seed values as newly observed samples.
	rows, err := s.state.Timeline(ctx, drive.VehicleID, fields, drive.StartTs.Add(-time.Nanosecond), to, signal.TimelineOptions{MaxRows: maxRows + 1, MaxEvents: maxEvents})
	if errors.Is(err, signal.ErrTimelineEventLimit) {
		return Result{
			DriveID: drive.ID, VehicleID: drive.VehicleID, From: drive.StartTs, To: to,
			Status: StatusInsufficientData, Reasons: []string{"timeline_event_limit_exceeded"},
			Limitations: []string{
				"Possible road anomaly only; no vertical acceleration or road-surface sensor confirms potholes.",
				"Analysis is limited to 100000 raw signal emissions per drive.",
			},
			Candidates: []Candidate{},
		}, nil
	}
	if err != nil {
		return Result{}, fmt.Errorf("read drive signal timeline: %w", err)
	}
	result := Detect(rows)
	result.DriveID, result.VehicleID, result.From, result.To = drive.ID, drive.VehicleID, drive.StartTs, to
	if len(rows) > maxRows {
		result.Status = StatusInsufficientData
		result.Reasons = []string{"timeline_row_limit_exceeded"}
		result.Candidates = []Candidate{}
	}
	return result, nil
}

type sample struct {
	ts  time.Time
	g   float64
	row signal.TimelineRow
}

// Detect uses ONLY genuine longitudinal emissions, never forward-filled
// acceleration on another signal's row. Duplicate timestamps are ambiguous
// and excluded. No interpolation or probabilistic confidence is attempted.
func Detect(rows []signal.TimelineRow) Result {
	result := Result{
		Status:  StatusInsufficientData,
		Reasons: []string{}, Limitations: []string{
			"Possible road anomaly only; no vertical acceleration or road-surface sensor confirms potholes.",
			"Sparse change-feed sampling and GPS freshness limit detection; no candidate is not proof of a smooth road.",
		},
		Candidates: []Candidate{},
	}
	ordered := append([]signal.TimelineRow(nil), rows...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Timestamp.Before(ordered[j].Timestamp) })
	samples := make([]sample, 0, len(ordered))
	for i, r := range ordered {
		if r.Timestamp.IsZero() || !r.ObservedAt["longitudinal"].Equal(r.Timestamp) {
			continue
		}
		if (i > 0 && ordered[i-1].Timestamp.Equal(r.Timestamp)) ||
			(i+1 < len(ordered) && ordered[i+1].Timestamp.Equal(r.Timestamp)) {
			continue
		}
		v, ok := finite(r.Fields["longitudinal"])
		if !ok {
			continue
		}
		samples = append(samples, sample{r.Timestamp, v / standardGravityMps2, r})
	}
	result.AnalyzedSamples = len(samples)
	lastCandidate := time.Time{}
	for i := 1; i+1 < len(samples); i++ {
		pre, peak, post := samples[i-1], samples[i], samples[i+1]
		before, after := peak.ts.Sub(pre.ts), post.ts.Sub(peak.ts)
		if before < 40*time.Millisecond || after < 40*time.Millisecond || before > maxGap || after > maxGap {
			continue
		}
		speed, ok := fresh(peak.row, "speed", peak.ts, maxFreshness)
		if !ok || speed < 5 || speed > 70 {
			continue
		}
		lat, latOK := fresh(peak.row, "latitude", peak.ts, maxFreshness)
		lon, lonOK := fresh(peak.row, "longitude", peak.ts, maxFreshness)
		if !latOK || !lonOK || math.Abs(lat) > 90 || math.Abs(lon) > 180 ||
			(lat == 0 && lon == 0) ||
			absDuration(peak.row.ObservedAt["latitude"].Sub(peak.row.ObservedAt["longitude"])) > 500*time.Millisecond {
			continue
		}
		lateral, ok := fresh(peak.row, "lateral", peak.ts, maxFreshness)
		if !ok || math.Abs(lateral/standardGravityMps2) > .18 {
			continue
		}
		// Brake state is change-fed: an observed release remains the
		// prevailing state until another emission, including when seeded
		// before this drive. No brake state at all is insufficient context.
		brake, brakeKnown := peak.row.Fields["brake"].(bool)
		pedal, pedalKnown := finite(peak.row.Fields["brake_position"])
		if brakeKnown && brake {
			continue
		}
		if pedalKnown && (pedal < 0 || pedal > .01) {
			continue
		}
		if !brakeKnown && !pedalKnown {
			continue
		}
		result.AssessableWindows++
		if math.Abs(pre.g) > .12 || math.Abs(post.g) > .12 ||
			math.Abs(peak.g) < .45 || math.Abs(peak.g-pre.g) < .35 ||
			math.Abs(peak.g-post.g) < .35 {
			continue
		}
		// A fresh speed change consistent with a maneuver disqualifies
		// the event; absent fresh speed samples cannot prove constant speed.
		maneuver := false
		for _, neighbor := range []sample{pre, post} {
			if v, ok := fresh(neighbor.row, "speed", neighbor.ts, maxFreshness); ok && math.Abs(v-speed) > 1.5 {
				maneuver = true
			}
		}
		if maneuver || (!lastCandidate.IsZero() && peak.ts.Sub(lastCandidate) < 2*time.Second) {
			continue
		}
		if len(result.Candidates) == maxCandidates {
			result.Status = StatusInsufficientData
			result.Reasons = []string{"candidate_limit_exceeded"}
			result.Candidates = []Candidate{}
			return result
		}
		delta := math.Abs(peak.g - pre.g)
		result.Candidates = append(result.Candidates, Candidate{
			Timestamp: peak.ts, Latitude: round(lat, 4), Longitude: round(lon, 4), SpeedMps: round(speed, 1),
			PeakLongitudinalG: round(peak.g, 2), DeltaLongitudinalG: round(delta, 2),
			JerkGPerS: round(delta/before.Seconds(), 1), SampleIntervalMs: before.Milliseconds(),
			Classification: "possible_road_anomaly",
		})
		lastCandidate = peak.ts
	}
	if result.AssessableWindows == 0 {
		result.Reasons = append(result.Reasons, "no_near_time_acceleration_with_fresh_speed_gps_and_lateral_context")
	} else {
		result.Status = StatusNoCandidates
		if len(result.Candidates) > 0 {
			result.Status = StatusCandidates
		}
	}
	return result
}

func finite(v any) (float64, bool) {
	n, ok := signal.Float64(v)
	return n, ok && !math.IsNaN(n) && !math.IsInf(n, 0)
}

func fresh(r signal.TimelineRow, key string, at time.Time, maxAge time.Duration) (float64, bool) {
	t, ok := r.ObservedAt[key]
	if !ok || t.After(at) || at.Sub(t) > maxAge {
		return 0, false
	}
	return finite(r.Fields[key])
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func round(v float64, digits int) float64 {
	scale := math.Pow10(digits)
	return math.Round(v*scale) / scale
}
