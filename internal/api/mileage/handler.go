// Phase-43a / Prompt 0004 — Handler restores the
// /mileage/monthly + /mileage/stats endpoints deleted by Phase-42
// prompt 0077 (which dropped the daily_mileage table). Both shapes are
// now derived live from the SI-canonical drives table (mig 000185).
//
// Frontend hooks (still pointed at these URLs, currently 404ing):
//
//   - useMonthlyMileage (web/src/api/hooks/useAnalytics.ts)
//   - useMileageStats   (web/src/api/hooks/useAnalytics.ts)
//
// Response shapes follow the prompt-locked Decisions #1 + #2 (snake_case
// JSON keys). The legacy frontend types in web/src/types/analytics.ts
// (camelCase totalDistance / avgDaily / etc.) belong to the deleted
// handler and need a follow-up update outside this prompt's allowed-
// files boundary.
package mileage

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// mileageRepository is the minimal repo surface Handler needs.
// Defined as an interface so the handler tests can supply a fake
// without spinning up a database — the codebase has no pgxmock harness
// (see repo memories from earlier phases).
type mileageRepository interface {
	VehicleExists(ctx context.Context, vehicleID int64) (bool, error)
	Monthly(ctx context.Context, vehicleID int64, windowStart time.Time) ([]drivedb.MileageMonthlyRow, error)
	Stats(ctx context.Context, vehicleID int64, since7d, since30d, since365d time.Time) (drivedb.MileageStats, error)
	Daily(ctx context.Context, vehicleID int64, windowStart time.Time) ([]drivedb.MileageDailyRow, error)
}

// mileageClock is injected so handler tests can pin the window
// boundary; production wiring leaves it nil and falls through to
// time.Now().UTC().
type mileageClock func() time.Time

// Handler serves mileage endpoints with an injectable clock for tests.
type Handler struct {
	repo  mileageRepository
	clock mileageClock
}

// NewHandler binds the handler to the production repo.
func NewHandler(repo *drivedb.MileageRepo) *Handler {
	return &Handler{repo: repo}
}

const (
	// mileageDefaultMonths mirrors Decision #3 default (24 months).
	mileageDefaultMonths = 24
	// mileageMaxMonths caps the monthly window per Decision #3 (120
	// months = 10 years). drives is a regular table (not a hypertable)
	// with one row per trip, so 10 years of monthly aggregation is
	// bounded by trip frequency rather than telemetry tick rate.
	mileageMaxMonths = 120
	// mileageDefaultDays is the default per-day window for /mileage/daily
	// (Phase-43a / Prompt 0009 — fix/misc-fixes). MileagePage.tsx today
	// requests limit=90; 90 daily buckets renders cleanly on the
	// Odometer Over Time area chart and Daily Distance bar chart.
	mileageDefaultDays = 90
	// mileageMaxDays caps the per-day window. 730 days = 2 years —
	// plenty for the page's pagination patterns without unbounded
	// growth in the response payload.
	mileageMaxDays = 730
)

// parseMonthlyParams extracts and validates vehicle_id + months for
// /mileage/monthly. Returns ok=false after writing the appropriate 4xx
// response so the caller can early-return.
func (h *Handler) parseMonthlyParams(w http.ResponseWriter, r *http.Request) (vehicleID int64, months int, ok bool) {
	q := r.URL.Query()

	vidStr := q.Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, 0, false
	}
	vid, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vid <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, 0, false
	}

	months = mileageDefaultMonths
	if m := q.Get("months"); m != "" {
		v, err := strconv.Atoi(m)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "months must be an integer")
			return 0, 0, false
		}
		if v < 1 {
			httpx.WriteError(w, http.StatusBadRequest, "months must be >= 1")
			return 0, 0, false
		}
		if v > mileageMaxMonths {
			// Decision #3 requires a structured max field; httpx.WriteError cannot include it.
			httpx.WriteJSON(w, http.StatusBadRequest, map[string]any{
				"error": "months exceeds maximum",
				"max":   mileageMaxMonths,
				"code":  apiparams.HTTPStatusCode(http.StatusBadRequest),
			})
			return 0, 0, false
		}
		months = v
	}
	return vid, months, true
}

// parseStatsParams extracts and validates vehicle_id only — /mileage/stats
// has no window override (the lifetime + 7d/30d/365d rollups are
// hard-locked per Decision #2).
func (h *Handler) parseStatsParams(w http.ResponseWriter, r *http.Request) (vehicleID int64, ok bool) {
	q := r.URL.Query()
	vidStr := q.Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, false
	}
	vid, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vid <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, false
	}
	return vid, true
}

// MileageMonthlyBucket is one bucket in the /mileage/monthly response.
// Snake-case JSON tags so the frontend hooks can read either
// camelCaseKeys-transformed or original keys per project convention.
//
// total_wh_consumed and avg_efficiency_wh_per_km are pointers to
// preserve JSON null semantics: a month whose drives all had NULL
// energy_used_wh reports null for both energy fields rather than a
// fabricated zero.
type MileageMonthlyBucket struct {
	YearMonth            string   `json:"year_month"`
	DriveCount           int      `json:"drive_count"`
	TotalKm              float64  `json:"total_km"`
	TotalWhConsumed      *float64 `json:"total_wh_consumed"`
	AvgEfficiencyWhPerKm *float64 `json:"avg_efficiency_wh_per_km"`
}

// MileageMonthlyResponse is the envelope returned by Monthly.
type MileageMonthlyResponse struct {
	VehicleID int64                  `json:"vehicle_id"`
	Months    []MileageMonthlyBucket `json:"months"`
}

// MileageStatsResponse is the envelope returned by Stats. first_drive_at
// and last_drive_at are *time.Time so a vehicle with zero recorded
// drives reports JSON null — Go's zero time.Time would otherwise marshal
// to "0001-01-01T00:00:00Z", confusing downstream consumers.
type MileageStatsResponse struct {
	VehicleID          int64      `json:"vehicle_id"`
	LifetimeKm         float64    `json:"lifetime_km"`
	Last7dKm           float64    `json:"last_7d_km"`
	Last30dKm          float64    `json:"last_30d_km"`
	Last365dKm         float64    `json:"last_365d_km"`
	DriveCountLifetime int        `json:"drive_count_lifetime"`
	DriveCount30d      int        `json:"drive_count_30d"`
	FirstDriveAt       *time.Time `json:"first_drive_at"`
	LastDriveAt        *time.Time `json:"last_drive_at"`
}

// Monthly serves GET /mileage/monthly?vehicle_id=...&months=N.
//
// Returns 200 with {vehicle_id, months: []} for an existing vehicle
// even when no drives are recorded — operators need to distinguish
// "vehicle has no drive history yet" from "vehicle does not exist".
// The latter returns 404. Decision #6 holds: zero drives must NOT
// 404.
func (h *Handler) Monthly(w http.ResponseWriter, r *http.Request) {
	vehicleID, months, ok := h.parseMonthlyParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("mileage.monthly: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	now := h.now()
	windowStart := monthsAgo(now, months)
	rows, err := h.repo.Monthly(ctx, vehicleID, windowStart)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("months", months).Msg("mileage.monthly: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load monthly mileage")
		return
	}

	out := MileageMonthlyResponse{
		VehicleID: vehicleID,
		Months:    make([]MileageMonthlyBucket, 0, len(rows)),
	}
	for _, row := range rows {
		out.Months = append(out.Months, MileageMonthlyBucket{
			YearMonth:            row.Bucket.UTC().Format("2006-01"),
			DriveCount:           row.DriveCount,
			TotalKm:              row.TotalKm,
			TotalWhConsumed:      row.TotalWhConsumed,
			AvgEfficiencyWhPerKm: row.AvgEfficiencyWhPerKm,
		})
	}

	httpx.WriteJSON(w, http.StatusOK, out)
}

// Stats serves GET /mileage/stats?vehicle_id=... .
//
// 404/200/500 disambiguation matches Monthly. The three windowed
// cut-offs (now-7d / now-30d / now-365d) are computed once per request
// and shared with the SQL FILTER aggregates so the response cannot
// race the wall clock mid-query.
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, ok := h.parseStatsParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("mileage.stats: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	now := h.now()
	since7d := now.Add(-7 * 24 * time.Hour)
	since30d := now.Add(-30 * 24 * time.Hour)
	since365d := now.Add(-365 * 24 * time.Hour)

	stats, err := h.repo.Stats(ctx, vehicleID, since7d, since30d, since365d)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("mileage.stats: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load mileage stats")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, MileageStatsResponse{
		VehicleID:          vehicleID,
		LifetimeKm:         stats.LifetimeKm,
		Last7dKm:           stats.Last7dKm,
		Last30dKm:          stats.Last30dKm,
		Last365dKm:         stats.Last365dKm,
		DriveCountLifetime: stats.DriveCountLifetime,
		DriveCount30d:      stats.DriveCount30d,
		FirstDriveAt:       stats.FirstDriveAt,
		LastDriveAt:        stats.LastDriveAt,
	})
}

// parseDailyParams extracts and validates vehicle_id + days for
// /mileage/daily. Returns ok=false after writing the appropriate 4xx
// response so the caller can early-return.
//
// Phase-43a / Prompt 0009 (fix/misc-fixes). Mirrors parseMonthlyParams
// but with the days cap (Decision #3 of Prompt 0004 generalised to
// daily granularity).
func (h *Handler) parseDailyParams(w http.ResponseWriter, r *http.Request) (vehicleID int64, days int, ok bool) {
	q := r.URL.Query()

	vidStr := q.Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return 0, 0, false
	}
	vid, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vid <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, 0, false
	}

	days = mileageDefaultDays
	if d := q.Get("days"); d != "" {
		v, err := strconv.Atoi(d)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "days must be an integer")
			return 0, 0, false
		}
		if v < 1 {
			httpx.WriteError(w, http.StatusBadRequest, "days must be >= 1")
			return 0, 0, false
		}
		if v > mileageMaxDays {
			httpx.WriteJSON(w, http.StatusBadRequest, map[string]any{
				"error": "days exceeds maximum",
				"max":   mileageMaxDays,
				"code":  apiparams.HTTPStatusCode(http.StatusBadRequest),
			})
			return 0, 0, false
		}
		days = v
	}
	return vid, days, true
}

// MileageDailyBucket is one bucket in the /mileage/daily response.
// Date is rendered as YYYY-MM-DD so consumers can sort lexically or
// pass it directly into Date/dayjs constructors. end_odometer_km is
// a pointer so a day with non-null distance but all-null end_odometer_m
// (rare but possible when a drive ends abnormally) reports JSON null
// for the odometer field instead of a fabricated zero.
type MileageDailyBucket struct {
	Date          string   `json:"date"`
	DriveCount    int      `json:"drive_count"`
	TotalKm       float64  `json:"total_km"`
	EndOdometerKm *float64 `json:"end_odometer_km"`
}

// MileageDailyResponse is the envelope returned by Daily. Mirrors the
// MileageMonthlyResponse shape so the frontend hook layer can reuse
// the same envelope-unwrap pattern.
type MileageDailyResponse struct {
	VehicleID int64                `json:"vehicle_id"`
	Days      []MileageDailyBucket `json:"days"`
}

// Daily serves GET /mileage/daily?vehicle_id=...&days=N.
//
// Returns 200 with {vehicle_id, days: []} for an existing vehicle even
// when no drives are recorded — consistent with Monthly's Decision #6.
// 404 only when the vehicle id is unknown.
func (h *Handler) Daily(w http.ResponseWriter, r *http.Request) {
	vehicleID, days, ok := h.parseDailyParams(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	exists, err := h.repo.VehicleExists(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("mileage.daily: existence probe failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to verify vehicle")
		return
	}
	if !exists {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	now := h.now()
	windowStart := daysAgo(now, days)
	rows, err := h.repo.Daily(ctx, vehicleID, windowStart)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("days", days).Msg("mileage.daily: query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load daily mileage")
		return
	}

	out := MileageDailyResponse{
		VehicleID: vehicleID,
		Days:      make([]MileageDailyBucket, 0, len(rows)),
	}
	for _, row := range rows {
		out.Days = append(out.Days, MileageDailyBucket{
			Date:          row.Day.UTC().Format("2006-01-02"),
			DriveCount:    row.DriveCount,
			TotalKm:       row.TotalKm,
			EndOdometerKm: row.EndOdometerKm,
		})
	}

	httpx.WriteJSON(w, http.StatusOK, out)
}

// now returns the injected clock value or wall time if no clock is
// configured. Splitting it out keeps every time-derived computation in
// the handler reading from the same source.
func (h *Handler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now().UTC()
}

// monthsAgo subtracts `months` calendar months from `now`. We use
// time.AddDate (which respects month-end edge cases) rather than a
// fixed 30-day window so the monthly bucket includes the full earliest
// month even if `now` is mid-month.
//
// Caller-side correctness: the SQL filter is `started_at >= windowStart`
// so anything from the start of the windowStart's month onward is
// included; PostgreSQL's date_trunc handles the per-bucket rounding.
func monthsAgo(now time.Time, months int) time.Time {
	t := now.AddDate(0, -months, 0)
	// Snap to the first day of t's month so the earliest bucket
	// includes drives from the start of that month rather than from
	// `now.Day()` of that month (which would clip the earliest bucket).
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// daysAgo subtracts `days` calendar days from `now` and snaps to UTC
// midnight so the earliest bucket includes drives from the start of
// that day rather than from `now.Hour()` of that day (which would clip
// the earliest bucket exactly like monthsAgo's month-snap does).
//
// Phase-43a / Prompt 0009 (fix/misc-fixes).
func daysAgo(now time.Time, days int) time.Time {
	t := now.AddDate(0, 0, -days)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}
