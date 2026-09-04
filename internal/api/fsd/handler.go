package fsd

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

const (
	// defaultDays matches the period control's default selection.
	defaultDays = 30
	// maxDays caps the window at just over a calendar year. The dense daily
	// series is one JSON object per day, so 366 bounds the response size as
	// well as the signal_log scan.
	maxDays = 366
	// maxTimezoneLen rejects absurd `timezone` values before they reach
	// time.LoadLocation, which touches the filesystem zoneinfo database.
	maxTimezoneLen = 64
	// insightsQueryBudget is the SINGLE deadline covering every database read
	// this endpoint performs (baseline + window). It is deliberately a shared
	// request-level budget rather than a per-query one: two 15s per-query
	// timeouts would let a slow baseline burn its full budget and then hand
	// the window query a fresh one, so the endpoint's worst case would be
	// double what any single timeout advertises.
	//
	// 5s is chosen against the SLO: fsd_insights_latency_1s targets p99 under
	// one second, so a read still running at five seconds has already blown
	// the objective by 5x and is better failed fast than left to occupy a
	// pool connection. The pool's per-connection statement_timeout remains
	// the backstop underneath this.
	insightsQueryBudget = 5 * time.Second
)

type daysLimitError struct {
	Error string `json:"error"`
	Max   int    `json:"max"`
	Code  string `json:"code"`
}

// insightsRepository is the data surface Handler needs. Kept as an interface
// so handler tests can supply a fake without a live database, matching the
// mileage / tempimpact handler precedent.
type insightsRepository interface {
	WindowSamples(ctx context.Context, vehicleID int64, fields []string, from, to time.Time) ([]Sample, error)
	BaselineSamples(ctx context.Context, vehicleID int64, fields []string, before time.Time) ([]Sample, error)
}

type driveAnalyticsRepository interface {
	LoadAnalyticsInput(
		ctx context.Context,
		vehicleID int64,
		from, split, to time.Time,
	) (AnalyticsInput, error)
}

// clock is injected so handler tests can pin the period boundary;
// production wiring leaves it nil and falls through to time.Now().UTC().
type clock func() time.Time

// Handler serves GET /api/v1/analytics/fsd.
type Handler struct {
	repo  insightsRepository
	clock clock
}

// NewHandler binds the handler to the production signal_log repo.
func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: NewRepo(db)}
}

// newHandler is the test seam: it injects an arbitrary repository and clock
// so the HTTP surface can be exercised deterministically.
func newHandler(repo insightsRepository, c clock) *Handler {
	return &Handler{repo: repo, clock: c}
}

// counterFields is the exact set of signal_log fields this endpoint reads.
func counterFields() []string {
	return []string{SignalFSDDistance, SignalDrivingDistance}
}

// request is the validated query surface of GET /analytics/fsd.
type request struct {
	vehicleID       int64
	days            int
	loc             *time.Location
	startAt         *time.Time
	endAt           *time.Time
	explicitRange   bool
	includeEvidence bool
}

// parseRequest validates every query parameter. Returns ok=false after
// writing the appropriate 4xx response so the caller can early-return.
func parseRequest(w http.ResponseWriter, r *http.Request) (request, bool) {
	q := r.URL.Query()

	raw := q.Get("vehicle_id")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return request{}, false
	}
	vehicleID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return request{}, false
	}

	days := defaultDays
	if d := q.Get("days"); d != "" {
		v, err := strconv.Atoi(d)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "days must be an integer")
			return request{}, false
		}
		if v < 1 {
			httpx.WriteError(w, http.StatusBadRequest, "days must be >= 1")
			return request{}, false
		}
		if v > maxDays {
			// A structured `max` lets the frontend clamp its period control
			// instead of guessing; httpx.WriteError cannot carry extra keys.
			httpx.WriteJSON(w, http.StatusBadRequest, daysLimitError{
				Error: "days exceeds maximum",
				Max:   maxDays,
				Code:  apiparams.HTTPStatusCode(http.StatusBadRequest),
			})
			return request{}, false
		}
		days = v
	}

	loc := time.UTC
	if tz := q.Get("timezone"); tz != "" {
		if len(tz) > maxTimezoneLen {
			httpx.WriteError(w, http.StatusBadRequest, "timezone must be a valid IANA timezone")
			return request{}, false
		}
		parsed, err := time.LoadLocation(tz)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "timezone must be a valid IANA timezone")
			return request{}, false
		}
		loc = parsed
	}

	includeEvidence := false
	if raw := q.Get("include_evidence"); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "include_evidence must be a boolean")
			return request{}, false
		}
		includeEvidence = value
	}

	startRaw := q.Get("start")
	endRaw := q.Get("end")
	if startRaw != "" || endRaw != "" {
		if startRaw == "" || endRaw == "" {
			httpx.WriteError(w, http.StatusBadRequest, "start and end must be provided together")
			return request{}, false
		}
		if q.Get("days") != "" {
			httpx.WriteError(w, http.StatusBadRequest, "days cannot be combined with start and end")
			return request{}, false
		}
		startAt, err := time.Parse(time.RFC3339, startRaw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "start must be an RFC3339 timestamp")
			return request{}, false
		}
		endAt, err := time.Parse(time.RFC3339, endRaw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "end must be an RFC3339 timestamp")
			return request{}, false
		}
		if !startAt.Before(endAt) {
			httpx.WriteError(w, http.StatusBadRequest, "start must be before end")
			return request{}, false
		}
		days = inclusiveCivilDayCount(startAt, endAt.Add(-time.Nanosecond), loc)
		if days > maxDays {
			httpx.WriteJSON(w, http.StatusBadRequest, daysLimitError{
				Error: "date range exceeds maximum",
				Max:   maxDays,
				Code:  apiparams.HTTPStatusCode(http.StatusBadRequest),
			})
			return request{}, false
		}
		startAt = startAt.UTC()
		endAt = endAt.UTC()
		return request{
			vehicleID:       vehicleID,
			days:            days,
			loc:             loc,
			startAt:         &startAt,
			endAt:           &endAt,
			explicitRange:   true,
			includeEvidence: includeEvidence,
		}, true
	}

	return request{
		vehicleID:       vehicleID,
		days:            days,
		loc:             loc,
		includeEvidence: includeEvidence,
	}, true
}

// Insights serves GET /analytics/fsd?vehicle_id=…&days=…&timezone=….
//
// A vehicle with no relevant counter observations is a 200 with a dense
// null-valued series and `counter_observation_days: 0`, not a 404 or an empty
// body: operators need to see the window they asked for and be told nothing
// was reported in it.
func (h *Handler) Insights(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.fsd.insights")
	defer span.End()
	traceID := span.SpanContext().TraceID().String()

	req, ok := parseRequest(w, r)
	if !ok {
		span.RecordError(errors.New("invalid fsd insights request"))
		return
	}

	now := h.now()
	start := periodStart(now, req.days, req.loc)
	if req.explicitRange {
		start = *req.startAt
		now = *req.endAt
	}

	span.SetAttributes(
		attribute.Int64("vehicle_id", req.vehicleID),
		attribute.Int("fsd.days", req.days),
		attribute.String("fsd.timezone", req.loc.String()),
	)

	fields := counterFields()

	// ONE deadline for the whole read path. All queries share it, so the
	// endpoint's worst case is `insightsQueryBudget`, not N times it, and a
	// client that disconnects (or a request the server times out) cancels the
	// in-flight query rather than leaving it to finish against a dead
	// response writer. `ctx` already carries the request's cancellation, so
	// this only ever tightens it.
	readCtx, cancelReads := context.WithTimeout(ctx, insightsQueryBudget)
	defer cancelReads()

	var resp Response
	if analyticsRepo, ok := h.repo.(driveAnalyticsRepository); ok {
		previousEnd := start
		previousStart := start.Add(-now.Sub(start))
		input, err := analyticsRepo.LoadAnalyticsInput(
			readCtx,
			req.vehicleID,
			previousStart,
			start,
			now,
		)
		if err != nil {
			span.RecordError(err)
			log.Error().Err(err).
				Int64("vehicle_id", req.vehicleID).
				Int("days", req.days).
				Str("trace_id", traceID).
				Msg("fsd.insights: drive analytics query failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load FSD insights")
			return
		}

		resp = Aggregate(AggregateParams{
			VehicleID: req.vehicleID,
			Days:      req.days,
			Loc:       req.loc,
			Start:     start,
			End:       now,
			Samples:   input.CounterSamples,
		})
		previousDays := inclusiveCivilDayCount(
			previousStart,
			previousEnd.Add(-time.Nanosecond),
			req.loc,
		)
		previous := Aggregate(AggregateParams{
			VehicleID: req.vehicleID,
			Days:      previousDays,
			Loc:       req.loc,
			Start:     previousStart,
			End:       previousEnd,
			Samples:   input.PreviousCounterSamples,
		})
		resp.Analytics = BuildDriveAnalytics(resp, previous, input, req.loc, req.includeEvidence)
	} else {
		baselines, err := h.repo.BaselineSamples(readCtx, req.vehicleID, fields, start)
		if err != nil {
			span.RecordError(err)
			log.Error().Err(err).
				Int64("vehicle_id", req.vehicleID).
				Int("days", req.days).
				Str("trace_id", traceID).
				Msg("fsd.insights: baseline query failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load FSD insights")
			return
		}

		samples, err := h.repo.WindowSamples(readCtx, req.vehicleID, fields, start, now)
		if err != nil {
			span.RecordError(err)
			log.Error().Err(err).
				Int64("vehicle_id", req.vehicleID).
				Int("days", req.days).
				Str("trace_id", traceID).
				Msg("fsd.insights: window query failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load FSD insights")
			return
		}

		all := make([]Sample, 0, len(baselines)+len(samples))
		all = append(all, baselines...)
		all = append(all, samples...)

		resp = Aggregate(AggregateParams{
			VehicleID: req.vehicleID,
			Days:      req.days,
			Loc:       req.loc,
			Start:     start,
			End:       now,
			Samples:   all,
		})
	}

	span.SetAttributes(
		attribute.Int("fsd.samples", resp.Quality.FSDSampleCount+resp.Quality.DrivingSampleCount),
		attribute.Int("fsd.counter_observation_days", resp.Quality.CounterObservationDays),
		attribute.Int("fsd.measured_days", resp.Quality.FSDMeasuredDays),
		attribute.Int(
			"fsd.untrusted_samples",
			resp.Quality.FSDUntrustedSampleCount+resp.Quality.DrivingUntrustedSampleCount,
		),
		attribute.Bool("fsd.distance_derivable", resp.Quality.FSDDistanceDerivable),
		attribute.Bool("fsd.share_basis_available", resp.Quality.ShareBasisAvailable),
		attribute.Bool("fsd.historical_data_guarded", resp.Quality.HistoricalDataGuarded),
	)

	httpx.WriteJSON(w, http.StatusOK, resp)
}

func inclusiveCivilDayCount(start, end time.Time, loc *time.Location) int {
	first := civilDateAt(start, loc)
	last := civilDateAt(end, loc)
	days := 1
	for first.compare(last) < 0 && days <= maxDays {
		first = first.addDays(1)
		days++
	}
	return days
}

// periodStart resolves the first valid instant of the first requested local
// civil date. It deliberately avoids constructing local midnight because
// some zones move their clocks at 00:00 and that wall time does not exist.
func periodStart(now time.Time, days int, loc *time.Location) time.Time {
	if loc == nil {
		loc = time.UTC
	}
	return periodBoundary(now, days, loc)
}

// now returns the injected clock value or wall time if no clock is
// configured, so every time-derived computation in one request reads from
// the same source.
func (h *Handler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now().UTC()
}
