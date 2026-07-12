package segments

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// segDataTimeout bounds each analytics read so a stalled connection cannot pin
// the request goroutine longer than the boundary rule allows. The pool's
// server-side statement_timeout is the backstop; this is the client-side
// deadline. A var (not const) so tests can shorten it (mirrors
// routeeff.routeEffDataTimeout / carbon.carbonDataTimeout).
var segDataTimeout = 15 * time.Second

// segMinDistanceM is the minimum drive distance (SI metres) that qualifies as a
// segment attempt. It filters out GPS-noise "micro-drives" (a car nudged in a
// driveway) that would otherwise cluster into a spurious segment. A var so
// tests can pin it.
var segMinDistanceM = 300.0

// segmentPersistFailures counts best-effort UPSERT failures over the process
// lifetime. The list read logs each failure AND increments this counter, but
// never fails the read — the computed segments are still returned. Exposed via
// SegmentPersistFailures for observability / tests.
var segmentPersistFailures atomic.Int64

// SegmentPersistFailures returns the number of best-effort segment persist
// failures observed since process start.
func SegmentPersistFailures() int64 { return segmentPersistFailures.Load() }

// segQuerier is the minimal pgx surface the handler needs. Declared locally so
// tests can drive every branch with scripted row/rows sources without a live
// database or a vendored pgxmock (mirrors routeeff.routeQuerier /
// carbon.carbonQuerier). *pgxpool.Pool satisfies it.
type segQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Handler serves the Ghost Racing / EV Segments endpoints.
type Handler struct {
	db segQuerier
}

// NewSegmentsHandler wires the handler to the pgx pool. Panics on a nil pool —
// a nil pool is a wiring bug, not a runtime condition, so it surfaces at
// construction rather than as a nil-deref on the first request (mirrors
// routeeff.NewRouteEfficiencyHandler / carbon.NewCarbonHandler).
func NewSegmentsHandler(db *database.DB) *Handler {
	if db == nil || db.Pool == nil {
		panic("segments.NewSegmentsHandler: db pool must not be nil")
	}
	return &Handler{db: db.Pool}
}

// --- SQL. Package-level constants so tests can pin the critical clauses
// without a live database. ---

// candidateDrivesSQL reads the completed, geolocated, non-trivial drives that
// can be clustered into segments. NOTE the source column suffix is `lng`
// (drives) — the handler maps it onto DrivePoint.*Lon. Ordered earliest-first
// so ClusterDrives seeds each cluster on its earliest drive (stable anchor).
const candidateDrivesSQL = `
SELECT id, started_at, start_lat, start_lng, end_lat, end_lng,
       start_place, end_place, distance_m, duration_s, energy_used_wh
FROM drives
WHERE vehicle_id = $1
  AND ended_at IS NOT NULL
  AND start_lat IS NOT NULL AND start_lng IS NOT NULL
  AND end_lat  IS NOT NULL AND end_lng  IS NOT NULL
  AND distance_m > $2
  AND duration_s > 0
ORDER BY started_at ASC`

// upsertSegmentSQL persists a detected segment idempotently per (vehicle,
// anchor endpoints). RETURNING id gives the stable identity the leaderboard /
// ghost routes are addressed by.
const upsertSegmentSQL = `
INSERT INTO route_segments
  (vehicle_id, name, start_lat, start_lon, end_lat, end_lon, radius_m, distance_m, attempt_count, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
ON CONFLICT (vehicle_id, start_lat, start_lon, end_lat, end_lon)
DO UPDATE SET
  name          = EXCLUDED.name,
  radius_m      = EXCLUDED.radius_m,
  distance_m    = EXCLUDED.distance_m,
  attempt_count = EXCLUDED.attempt_count,
  updated_at    = NOW()
RETURNING id`

// loadSegmentSQL fetches a persisted segment's anchor for the leaderboard /
// ghost reads.
const loadSegmentSQL = `
SELECT id, vehicle_id, name, start_lat, start_lon, end_lat, end_lon, radius_m
FROM route_segments
WHERE id = $1`

// loadDriveSQL fetches a single drive header scoped to a vehicle (so a caller
// cannot ghost-race a drive from another vehicle onto this segment).
const loadDriveSQL = `
SELECT started_at, duration_s, distance_m, energy_used_wh
FROM drives
WHERE id = $1 AND vehicle_id = $2`

// telemetrySQL reads a drive's per-tick speed track for the ghost progress
// series, oldest-first. drive_id is the indexed access path on drive_telemetry.
const telemetrySQL = `
SELECT ts, speed_mps
FROM drive_telemetry
WHERE drive_id = $1 AND speed_mps IS NOT NULL
ORDER BY ts ASC`

// List serves GET /vehicles/{vehicleID}/segments: it detects segments from the
// vehicle's drive history, best-effort persists each (so it earns a stable id),
// and returns them with their personal-best-by-time, best-by-efficiency, and
// latest attempt.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), segDataTimeout)
	defer cancel()

	drives, err := h.loadCandidateDrives(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("segments: failed to load drives")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load segments")
		return
	}

	clusters := ClusterDrives(drives, DefaultRadiusM)
	summaries := InterestingSegments(clusters, MinAttempts)
	// Most-attempted first; deterministic tie-break by name.
	sort.SliceStable(summaries, func(i, j int) bool {
		if summaries[i].AttemptCount != summaries[j].AttemptCount {
			return summaries[i].AttemptCount > summaries[j].AttemptCount
		}
		return summaries[i].Name < summaries[j].Name
	})

	out := make([]SegmentSummary, 0, len(summaries))
	var failures int
	for _, s := range summaries {
		id, perr := h.upsertSegment(ctx, vehicleID, s)
		if perr != nil {
			// Best-effort: a persist failure is logged + counted, never fatal.
			// The computed segment is still returned (with id 0).
			failures++
			segmentPersistFailures.Add(1)
			log.Warn().Err(perr).Int64("vehicleID", vehicleID).Str("segment", s.Name).
				Msg("segments: best-effort persist failed; returning computed segment without id")
		}
		out = append(out, toSegmentSummaryDTO(id, s))
	}
	if failures > 0 {
		log.Warn().Int64("vehicleID", vehicleID).Int("failures", failures).Int("segments", len(summaries)).
			Msg("segments: some segments could not be persisted")
	}

	httpx.WriteJSON(w, http.StatusOK, SegmentsResponse{Segments: out})
}

// Leaderboard serves GET /segments/{segmentID}/leaderboard: the ranked attempts
// on a segment, ordered both by time and by energy efficiency, each flagging
// which run is the personal record.
func (h *Handler) Leaderboard(w http.ResponseWriter, r *http.Request) {
	segmentID, err := apiparams.URLParamInt64(r, "segmentID")
	if err != nil || segmentID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid segment ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), segDataTimeout)
	defer cancel()

	seg, err := h.loadSegment(ctx, segmentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "segment not found")
			return
		}
		log.Error().Err(err).Int64("segmentID", segmentID).Msg("segments: failed to load segment")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load segment")
		return
	}

	matched, err := h.matchingDrives(ctx, seg)
	if err != nil {
		log.Error().Err(err).Int64("segmentID", segmentID).Msg("segments: failed to load leaderboard drives")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load leaderboard")
		return
	}

	byTime := toLeaderboardRows(RankByTime(matched))
	byEff := toLeaderboardRows(RankByEfficiency(matched))

	httpx.WriteJSON(w, http.StatusOK, LeaderboardResponse{
		Segment:      seg.info(matched),
		ByTime:       byTime,
		ByEfficiency: byEff,
	})
}

// Ghost serves GET /segments/{segmentID}/ghost?a=<driveID>&b=<driveID>: two
// drives on the same segment aligned onto a shared distance-fraction axis, with
// the per-fraction time split between them and the head-to-head result.
func (h *Handler) Ghost(w http.ResponseWriter, r *http.Request) {
	segmentID, err := apiparams.URLParamInt64(r, "segmentID")
	if err != nil || segmentID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid segment ID")
		return
	}
	aID, aErr := parseInt64Query(r, "a")
	bID, bErr := parseInt64Query(r, "b")
	if aErr != nil || bErr != nil || aID <= 0 || bID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "query parameters a and b must be positive drive IDs")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), segDataTimeout)
	defer cancel()

	seg, err := h.loadSegment(ctx, segmentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "segment not found")
			return
		}
		log.Error().Err(err).Int64("segmentID", segmentID).Msg("segments: ghost: failed to load segment")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load segment")
		return
	}

	ghostA, err := h.loadGhostDrive(ctx, aID, seg.VehicleID)
	if err != nil {
		h.writeGhostDriveErr(w, err, segmentID, aID)
		return
	}
	ghostB, err := h.loadGhostDrive(ctx, bID, seg.VehicleID)
	if err != nil {
		h.writeGhostDriveErr(w, err, segmentID, bID)
		return
	}

	// Split deltas from the FULL series (accuracy), then downsample the series
	// carried in the payload (bounded size).
	splits := SplitDeltas(ghostA.series, ghostB.series, SplitSamples)
	winner, margin := raceResult(aID, ghostA.durationS, bID, ghostB.durationS)

	httpx.WriteJSON(w, http.StatusOK, GhostResponse{
		Segment:       seg.info(nil),
		A:             ghostA.toDTO(),
		B:             ghostB.toDTO(),
		SplitDeltas:   toSplitDeltaDTO(splits),
		WinnerDriveID: winner,
		MarginS:       safeF(round2(margin)),
	})
}

// --- data access helpers ---

// loadCandidateDrives reads and projects the clusterable drives for a vehicle.
func (h *Handler) loadCandidateDrives(ctx context.Context, vehicleID int64) ([]DrivePoint, error) {
	rows, err := h.db.Query(ctx, candidateDrivesSQL, vehicleID, segMinDistanceM)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDrivePoints(rows)
}

// scanDrivePoints projects candidate-drive rows into DrivePoints, mapping the
// nullable place/energy columns to their zero + a HasEnergy flag.
func scanDrivePoints(rows pgx.Rows) ([]DrivePoint, error) {
	out := make([]DrivePoint, 0, 64)
	for rows.Next() {
		var (
			d          DrivePoint
			startedAt  time.Time
			durationS  int64
			startPlace *string
			endPlace   *string
			energyWh   *float64
		)
		if err := rows.Scan(&d.DriveID, &startedAt, &d.StartLat, &d.StartLon,
			&d.EndLat, &d.EndLon, &startPlace, &endPlace, &d.DistanceM, &durationS, &energyWh); err != nil {
			return nil, err
		}
		d.StartedAt = startedAt
		d.DurationS = float64(durationS)
		if startPlace != nil {
			d.StartPlace = *startPlace
		}
		if endPlace != nil {
			d.EndPlace = *endPlace
		}
		if energyWh != nil && *energyWh > 0 {
			d.EnergyWh = *energyWh
			d.HasEnergy = true
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// upsertSegment persists one detected segment and returns its stable id.
func (h *Handler) upsertSegment(ctx context.Context, vehicleID int64, s Summary) (int64, error) {
	var id int64
	err := h.db.QueryRow(ctx, upsertSegmentSQL,
		vehicleID, s.Name,
		s.Seed.StartLat, s.Seed.StartLon, s.Seed.EndLat, s.Seed.EndLon,
		DefaultRadiusM, s.DistanceM, s.AttemptCount,
	).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
}

// segmentRow is a loaded route_segments anchor.
type segmentRow struct {
	ID        int64
	VehicleID int64
	Name      string
	StartLat  float64
	StartLon  float64
	EndLat    float64
	EndLon    float64
	RadiusM   float64
}

// loadSegment reads a persisted segment by id.
func (h *Handler) loadSegment(ctx context.Context, segmentID int64) (segmentRow, error) {
	var (
		seg                                    segmentRow
		startLat, startLon, endLat, endLon     *float64
		radiusM                                *float64
	)
	err := h.db.QueryRow(ctx, loadSegmentSQL, segmentID).Scan(
		&seg.ID, &seg.VehicleID, &seg.Name, &startLat, &startLon, &endLat, &endLon, &radiusM)
	if err != nil {
		return segmentRow{}, err
	}
	if startLat != nil {
		seg.StartLat = *startLat
	}
	if startLon != nil {
		seg.StartLon = *startLon
	}
	if endLat != nil {
		seg.EndLat = *endLat
	}
	if endLon != nil {
		seg.EndLon = *endLon
	}
	if radiusM != nil && *radiusM > 0 {
		seg.RadiusM = *radiusM
	} else {
		seg.RadiusM = DefaultRadiusM
	}
	return seg, nil
}

// matchingDrives returns the vehicle's drives that fall inside the segment
// anchor's start AND end radius — the same pure predicate ClusterDrives used to
// detect membership, so the leaderboard re-finds exactly the cluster members.
func (h *Handler) matchingDrives(ctx context.Context, seg segmentRow) ([]DrivePoint, error) {
	all, err := h.loadCandidateDrives(ctx, seg.VehicleID)
	if err != nil {
		return nil, err
	}
	matched := make([]DrivePoint, 0, len(all))
	for _, d := range all {
		if WithinRadius(d.StartLat, d.StartLon, seg.StartLat, seg.StartLon, seg.RadiusM) &&
			WithinRadius(d.EndLat, d.EndLon, seg.EndLat, seg.EndLon, seg.RadiusM) {
			matched = append(matched, d)
		}
	}
	return matched, nil
}

// info builds the segment header echoed by the leaderboard / ghost responses,
// recomputing addresses/distance/attempt_count from the matched drives when
// available (nil ⇒ header without those derived fields, e.g. the ghost read).
func (s segmentRow) info(matched []DrivePoint) SegmentInfo {
	info := SegmentInfo{ID: s.ID, Name: s.Name}
	if len(matched) == 0 {
		return info
	}
	starts := make([]string, 0, len(matched))
	ends := make([]string, 0, len(matched))
	for _, d := range matched {
		starts = append(starts, d.StartPlace)
		ends = append(ends, d.EndPlace)
	}
	info.StartAddress = MostCommon(starts)
	info.EndAddress = MostCommon(ends)
	info.DistanceM = safeF(round1(MedianDistanceM(matched)))
	info.AttemptCount = len(matched)
	return info
}

// ghostDrive is a loaded, aligned ghost racer.
type ghostDrive struct {
	driveID   int64
	durationS float64
	series    []ProgressPoint
}

// loadGhostDrive loads a drive header (scoped to the segment's vehicle) and its
// telemetry, and builds the normalized progress series. A missing drive returns
// pgx.ErrNoRows for the caller to translate into a 404.
func (h *Handler) loadGhostDrive(ctx context.Context, driveID, vehicleID int64) (ghostDrive, error) {
	var (
		startedAt time.Time
		durationS *int64
		distanceM *float64
		energyWh  *float64
	)
	if err := h.db.QueryRow(ctx, loadDriveSQL, driveID, vehicleID).
		Scan(&startedAt, &durationS, &distanceM, &energyWh); err != nil {
		return ghostDrive{}, err
	}

	samples, err := h.loadTelemetry(ctx, driveID, startedAt)
	if err != nil {
		return ghostDrive{}, err
	}
	series := BuildProgressSeries(samples)

	dur := 0.0
	if durationS != nil {
		dur = float64(*durationS)
	}
	if dur <= 0 && len(series) > 0 {
		dur = series[len(series)-1].ElapsedS
	}

	return ghostDrive{driveID: driveID, durationS: dur, series: series}, nil
}

// loadTelemetry reads a drive's speed track and turns each tick into a
// TelemetrySample whose offset is seconds since the drive started.
func (h *Handler) loadTelemetry(ctx context.Context, driveID int64, startedAt time.Time) ([]TelemetrySample, error) {
	rows, err := h.db.Query(ctx, telemetrySQL, driveID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TelemetrySample, 0, 256)
	for rows.Next() {
		var (
			ts    time.Time
			speed float64
		)
		if err := rows.Scan(&ts, &speed); err != nil {
			return nil, err
		}
		out = append(out, TelemetrySample{
			OffsetS:  ts.Sub(startedAt).Seconds(),
			SpeedMps: speed,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// writeGhostDriveErr maps a ghost-drive load failure to the right envelope: a
// missing drive is a 404, anything else a logged 500.
func (h *Handler) writeGhostDriveErr(w http.ResponseWriter, err error, segmentID, driveID int64) {
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusNotFound, "drive not found on this segment's vehicle")
		return
	}
	log.Error().Err(err).Int64("segmentID", segmentID).Int64("driveID", driveID).
		Msg("segments: ghost: failed to load drive")
	httpx.WriteError(w, http.StatusInternalServerError, "failed to load ghost race")
}

// --- pure DTO mapping ---

// toSegmentSummaryDTO maps a computed Summary + persisted id onto the wire DTO.
func toSegmentSummaryDTO(id int64, s Summary) SegmentSummary {
	dto := SegmentSummary{
		ID:           id,
		Name:         s.Name,
		StartAddress: s.StartAddress,
		EndAddress:   s.EndAddress,
		DistanceM:    safeF(round1(s.DistanceM)),
		AttemptCount: s.AttemptCount,
		BestTime: &SegmentBest{
			DriveID:   s.BestTime.DriveID,
			DurationS: safeF(round1(s.BestTime.DurationS)),
			StartedAt: s.BestTime.StartedAt.UTC().Format(time.RFC3339),
		},
		Latest: &SegmentBest{
			DriveID:   s.Latest.DriveID,
			DurationS: safeF(round1(s.Latest.DurationS)),
			StartedAt: s.Latest.StartedAt.UTC().Format(time.RFC3339),
		},
	}
	if s.HasBestEff {
		dto.BestEfficiency = &SegmentBestEff{
			DriveID:   s.BestEff.DriveID,
			WhPerKm:   safeF(round1(s.BestEffWhPerKm)),
			StartedAt: s.BestEff.StartedAt.UTC().Format(time.RFC3339),
		}
	}
	return dto
}

// toLeaderboardRows maps ranked attempts onto wire rows. Always non-nil.
func toLeaderboardRows(ranked []Ranked) []LeaderboardRow {
	out := make([]LeaderboardRow, 0, len(ranked))
	for _, r := range ranked {
		row := LeaderboardRow{
			Rank:         r.Rank,
			DriveID:      r.Drive.DriveID,
			StartedAt:    r.Drive.StartedAt.UTC().Format(time.RFC3339),
			DurationS:    safeF(round1(r.Drive.DurationS)),
			DistanceM:    safeF(round1(r.Drive.DistanceM)),
			DeltaToBestS: safeF(round1(r.DeltaToBestS)),
			IsPR:         r.IsPR,
		}
		if r.HasWhPerKm {
			v := safeF(round1(r.WhPerKm))
			row.WhPerKm = &v
		}
		out = append(out, row)
	}
	return out
}

// toDTO maps a loaded ghost racer onto the wire DTO, downsampling and rounding
// its series at the boundary.
func (g ghostDrive) toDTO() GhostDrive {
	pts := DownsampleSeries(g.series, MaxSeriesPoints)
	series := make([]GhostSeriesPoint, 0, len(pts))
	for _, p := range pts {
		series = append(series, GhostSeriesPoint{
			FractionOfDistance: safeF(round4(p.FractionOfDistance)),
			ElapsedS:           safeF(round2(p.ElapsedS)),
			SpeedMps:           safeF(round2(p.SpeedMps)),
		})
	}
	return GhostDrive{
		DriveID:   g.driveID,
		DurationS: safeF(round1(g.durationS)),
		Series:    series,
	}
}

// toSplitDeltaDTO maps pure split deltas onto the wire DTO.
func toSplitDeltaDTO(splits []SplitDeltaPoint) []GhostSplitDelta {
	out := make([]GhostSplitDelta, 0, len(splits))
	for _, s := range splits {
		out = append(out, GhostSplitDelta{
			Fraction: safeF(round4(s.Fraction)),
			DeltaS:   safeF(round2(s.DeltaS)),
		})
	}
	return out
}

// raceResult decides the head-to-head winner by recorded duration (lower wins)
// and the margin between them. A non-positive duration for a drive means it has
// no usable finish time, so it cannot win. Equal (or indeterminate) times yield
// a nil winner (a tie).
func raceResult(aID int64, aDur float64, bID int64, bDur float64) (*int64, float64) {
	margin := aDur - bDur
	if margin < 0 {
		margin = -margin
	}
	switch {
	case aDur > 0 && (bDur <= 0 || aDur < bDur):
		id := aID
		return &id, margin
	case bDur > 0 && (aDur <= 0 || bDur < aDur):
		id := bID
		return &id, margin
	default:
		return nil, margin
	}
}

// parseInt64Query parses a required int64 query parameter. An empty or
// malformed value is an error; the caller additionally rejects non-positive IDs.
func parseInt64Query(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(r.URL.Query().Get(key), 10, 64)
}
