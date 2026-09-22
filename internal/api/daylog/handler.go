package daylog

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	daylogdb "github.com/ev-dev-labs/teslasync/internal/database/daylog"
	"github.com/rs/zerolog/log"
)

// Input caps. signal_log rows feed edge detection, so the cap applies
// to raw rows, not events; hitting it sets truncated=true because
// later edges may be lost. Rows are periodic samples (5s–60s cadence
// per internal/tesla/config/intervals.go), so the cap scales with the
// queried field count: 53 fields across 10 optional layers. Typical
// days (a few streaming hours) fit comfortably; marathon streaming
// days can still exceed it, and truncated=true reports that honestly
// instead of silently dropping late-day edges. Gear ticks arrive at
// ~1 Hz while driving, hence the matching allowance.
const (
	dayLogSignalRowCap = 50000
	dayLogGearTickCap  = 50000
	// dayLogMaxSpan bounds explicit ?start=&end= windows. Local days
	// across DST are 23–25h; 48h admits any single day plus skew while
	// refusing week-long dumps through a day endpoint.
	dayLogMaxSpan = 48 * time.Hour
	// dayLogQueryTimeout bounds the whole read fan-out. Cold-path
	// timeline reads default to 15s per the Go conventions.
	dayLogQueryTimeout = 15 * time.Second
)

// dayLogRepository is the minimal repo surface Handler needs. Defined
// as an interface so handler tests can supply a fake without a
// database; *daylogdb.DayLogRepo satisfies it.
type dayLogRepository interface {
	VehicleExists(ctx context.Context, vehicleID int64) (bool, error)
	DrivesOverlapping(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]daylogdb.DayDrive, error)
	ChargesOverlapping(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]daylogdb.DayCharge, error)
	FSMTransitions(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]daylogdb.DayFSMTransition, error)
	SecurityEvents(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]daylogdb.DaySecurityEvent, error)
	SecurityPrevStates(ctx context.Context, vehicleID int64, windowStart time.Time) (map[string]*string, error)
	SignalRows(ctx context.Context, vehicleID int64, fields []string, windowStart, windowEnd time.Time, limit int) ([]daylogdb.DaySignalRow, error)
	GearTicks(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time, limit int) ([]daylogdb.DayGearTick, error)
	SoftwareUpdates(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]daylogdb.DaySoftwareUpdate, error)
}

// Handler serves GET /api/v1/day-log.
type Handler struct {
	repo dayLogRepository
}

// NewHandler binds the handler to a repo.
func NewHandler(repo *daylogdb.DayLogRepo) *Handler {
	return &Handler{repo: repo}
}

// dayLogParams is the validated request: one vehicle + one day window.
type dayLogParams struct {
	vehicleID int64
	date      string
	timezone  string
	start     time.Time
	end       time.Time
	layers    []string
	limit     int
	offset    int
}

// parseDayLogParams extracts vehicle_id, date/timezone (or explicit
// start/end), and layers. Returns ok=false after writing the 4xx so the
// caller can early-return.
func parseDayLogParams(w http.ResponseWriter, r *http.Request) (dayLogParams, bool) {
	var p dayLogParams
	q := r.URL.Query()

	vidStr := q.Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return p, false
	}
	vid, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vid <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return p, false
	}
	p.vehicleID = vid

	p.timezone = q.Get("timezone")
	if p.timezone == "" {
		p.timezone = "UTC"
	}

	// Explicit start/end override date/timezone when both are present.
	startRaw, endRaw := q.Get("start"), q.Get("end")
	if startRaw != "" || endRaw != "" {
		if startRaw == "" || endRaw == "" {
			httpx.WriteError(w, http.StatusBadRequest, "start and end must be provided together")
			return p, false
		}
		start, err := time.Parse(time.RFC3339, startRaw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "start must be RFC3339")
			return p, false
		}
		end, err := time.Parse(time.RFC3339, endRaw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "end must be RFC3339")
			return p, false
		}
		if !end.After(start) {
			httpx.WriteError(w, http.StatusBadRequest, "end must be after start")
			return p, false
		}
		if end.Sub(start) > dayLogMaxSpan {
			httpx.WriteError(w, http.StatusBadRequest, "window exceeds 48h maximum")
			return p, false
		}
		p.start, p.end = start.UTC(), end.UTC()
		p.date = start.UTC().Format("2006-01-02")
	} else {
		p.date = q.Get("date")
		loc, err := time.LoadLocation(p.timezone)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "unknown timezone")
			return p, false
		}
		if p.date == "" {
			p.date = time.Now().In(loc).Format("2006-01-02")
		}
		day, err := time.ParseInLocation("2006-01-02", p.date, loc)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
			return p, false
		}
		// AddDate in the location keeps DST days (23/25h) exact.
		p.start = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc).UTC()
		p.end = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1).UTC()
	}

	// Omitted or blank layers means the complete history: every
	// optional layer on. An explicit CSV narrows to that subset.
	if raw := strings.TrimSpace(q.Get("layers")); raw == "" {
		p.layers = append([]string{}, AllLayers...)
	} else {
		for _, l := range strings.Split(raw, ",") {
			l = strings.TrimSpace(l)
			if l == "" {
				continue
			}
			if !ValidLayers[l] {
				httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("unknown layer: %s", l))
				return p, false
			}
			p.layers = append(p.layers, l)
		}
		if len(p.layers) == 0 {
			p.layers = append([]string{}, AllLayers...)
		}
	}

	p.limit = dayLogDefaultLimit
	if raw := q.Get("limit"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			httpx.WriteError(w, http.StatusBadRequest, "limit must be a positive integer")
			return p, false
		}
		if v > dayLogMaxLimit {
			httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("limit exceeds maximum %d", dayLogMaxLimit))
			return p, false
		}
		p.limit = v
	}
	if raw := q.Get("offset"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 0 {
			httpx.WriteError(w, http.StatusBadRequest, "offset must be a non-negative integer")
			return p, false
		}
		p.offset = v
	}
	return p, true
}

// Get serves GET /api/v1/day-log?vehicle_id=…&date=…&timezone=…&layers=…&limit=…&offset=….
//
// Day boundaries are computed server-side from date+timezone so every
// client agrees on what "today" means; explicit ?start=&end= (RFC3339)
// override for callers that already resolved the day. Omitted layers
// means every layer: the default view is the complete history.
// Returns 200 with an empty events array for a quiet day, 404 for an
// unknown vehicle.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, ok := parseDayLogParams(w, r)
	if !ok {
		return
	}

	log.Info().
		Str("handler", "daylog.Get").
		Int64("vehicle_id", p.vehicleID).
		Str("date", p.date).
		Str("timezone", p.timezone).
		Strs("layers", p.layers).
		Msg("loading day timeline")

	ctx, cancel := context.WithTimeout(r.Context(), dayLogQueryTimeout)
	defer cancel()

	exists, err := h.repo.VehicleExists(ctx, p.vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	drives, err := h.repo.DrivesOverlapping(ctx, p.vehicleID, p.start, p.end)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: drives query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load drives")
		return
	}
	charges, err := h.repo.ChargesOverlapping(ctx, p.vehicleID, p.start, p.end)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: charges query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load charging sessions")
		return
	}
	fsm, err := h.repo.FSMTransitions(ctx, p.vehicleID, p.start, p.end)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: fsm query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load state transitions")
		return
	}
	security, err := h.repo.SecurityEvents(ctx, p.vehicleID, p.start, p.end)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: security query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load security events")
		return
	}
	prevSecurity, err := h.repo.SecurityPrevStates(ctx, p.vehicleID, p.start)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: security prev query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load security baseline")
		return
	}
	signalRows, err := h.repo.SignalRows(ctx, p.vehicleID, SignalFieldsForLayers(p.layers), p.start, p.end, dayLogSignalRowCap+1)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: signal query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load signal edges")
		return
	}
	signalOverflow := len(signalRows) > dayLogSignalRowCap
	if signalOverflow {
		signalRows = signalRows[:dayLogSignalRowCap]
	}
	var gears []daylogdb.DayGearTick
	var gearOverflow bool
	if WantsGear(p.layers) {
		gears, err = h.repo.GearTicks(ctx, p.vehicleID, p.start, p.end, dayLogGearTickCap+1)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: gear query failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load gear ticks")
			return
		}
		gearOverflow = len(gears) > dayLogGearTickCap
		if gearOverflow {
			gears = gears[:dayLogGearTickCap]
		}
	}
	software, err := h.repo.SoftwareUpdates(ctx, p.vehicleID, p.start, p.end)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.vehicleID).Msg("daylog: software query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load software updates")
		return
	}

	out := BuildTimeline(TimelineInput{
		VehicleID:      p.vehicleID,
		WindowStart:    p.start,
		WindowEnd:      p.end,
		Layers:         p.layers,
		FieldLayers:    FieldLayersForLayers(p.layers),
		PrevSecurity:   prevSecurity,
		Drives:         drives,
		Charges:        charges,
		FSM:            fsm,
		Security:       security,
		Signals:        signalRows,
		SignalOverflow: signalOverflow,
		Gears:          gears,
		GearOverflow:   gearOverflow,
		Software:       software,
		Limit:          p.limit,
		Offset:         p.offset,
	})

	log.Info().
		Str("handler", "daylog.Get").
		Int64("vehicle_id", p.vehicleID).
		Int("events", len(out.Events)).
		Int("total", out.Total).
		Bool("truncated", out.Truncated).
		Msg("day timeline loaded")

	httpx.WriteJSON(w, http.StatusOK, DayLogResponse{
		VehicleID:   p.vehicleID,
		Date:        p.date,
		Timezone:    p.timezone,
		DayStart:    p.start,
		DayEnd:      p.end,
		Truncated:   out.Truncated,
		TotalEvents: out.Total,
		Limit:       p.limit,
		Offset:      p.offset,
		Layers:      p.layers,
		Summary:     out.Summary,
		Sources:     out.Sources,
		Events:      out.Events,
	})
}
