package datarepair

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// GetSuggestions serves the READ-ONLY evidence-based repair diagnosis.
//
// GET /api/v1/data-repair/suggestions
//
//	?vehicle_id=<int64>     optional scope to one vehicle
//	&lookback_days=<int>    optional, default 30, max 365
//	&limit=<int>            optional candidates per kind, default 20, max 100
//
// This endpoint NEVER writes. It returns proposals that the operator must
// explicitly apply one at a time through the sudo-gated close endpoints.
func (h *DataRepairHandler) GetSuggestions(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "suggestions")
	defer span.End()

	opts, errMsg := parseDiagnosisParams(r)
	if errMsg != "" {
		httpx.WriteError(w, http.StatusBadRequest, errMsg)
		return
	}

	if h.diagnosis == nil {
		// Honest 503 rather than an empty report that would read as "your data
		// is clean" when in fact nothing was inspected.
		recordHandlerError(r.Context(), errors.New("data-repair diagnosis source not configured"))
		httpx.WriteError(w, http.StatusServiceUnavailable,
			"repair diagnosis is unavailable: no evidence source configured")
		return
	}

	report, err := h.buildReport(r.Context(), opts)
	if err != nil {
		recordHandlerError(r.Context(), err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(r.Context())).
			Int("lookback_days", opts.lookbackDays).
			Int("limit", opts.limit).
			Msg("data-repair: failed to build repair suggestions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to build repair suggestions")
		return
	}

	log.Info().
		Str("handler", "GetSuggestions").
		Int("lookback_days", opts.lookbackDays).
		Int("scanned_drives", report.ScannedDrives).
		Int("scanned_charging_sessions", report.ScannedChargingSessions).
		Int("drive_suggestions", len(report.DriveSuggestions)).
		Int("charging_suggestions", len(report.ChargingSuggestions)).
		Msg("data-repair: diagnosis complete")

	httpx.WriteJSON(w, http.StatusOK, report)
}

// parseDiagnosisParams validates the query string. Returns a non-empty error
// message when the caller supplied something unusable — bad input is a 400,
// not a silently-substituted default, because a mistyped vehicle_id would
// otherwise return another vehicle's worklist.
func parseDiagnosisParams(r *http.Request) (diagnosisOptions, string) {
	opts := diagnosisOptions{
		lookbackDays: defaultLookbackDays,
		limit:        defaultCandidateLimit,
	}

	q := r.URL.Query()

	if raw := q.Get("vehicle_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			return opts, "vehicle_id must be a positive integer"
		}
		opts.vehicleID = &id
	}

	if raw := q.Get("lookback_days"); raw != "" {
		days, err := strconv.Atoi(raw)
		if err != nil || days <= 0 {
			return opts, "lookback_days must be a positive integer"
		}
		if days > maxLookbackDays {
			days = maxLookbackDays
		}
		opts.lookbackDays = days
	}

	if raw := q.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit <= 0 {
			return opts, "limit must be a positive integer"
		}
		if limit > maxCandidateLimit {
			limit = maxCandidateLimit
		}
		opts.limit = limit
	}

	return opts, ""
}
