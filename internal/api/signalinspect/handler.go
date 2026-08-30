package signalinspect

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal/agreement"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/go-chi/chi/v5"
)

// Handler serves the per-vehicle signal-inspector endpoints
// (/available, /live, /{signalName}/history, /snapshot, /diff, /stats).
//
// Typed envelope rewrite:
//   - /available is sourced from protomodel.Signals (the vendored proto
//     is the catalog source of truth).
//   - /live returns each signal as the typed `{kind, value, ts}` envelope
//     so the frontend can switch on `kind` instead of string-parsing
//     `value`. The legacy `timestamp`, `source`, and `age_ms` fields are
//     retained alongside the typed triplet for FSM-debugger and
//     compatibility-test consumers.
//   - /{signalName}/history queries the new typed signal_log schema
//     (vehicle_id, ts, field, value_kind, str_value, bool_value,
//     int_value, float_value, time_value) directly via *database.DB so
//     it does not depend on the legacy SignalHistoryWriter (which still
//     reads the legacy column layout).
//
// The /snapshot, /diff, and /stats endpoints continue to use
// SignalHistoryWriter. They are wired here only so the chi route
// registration in router.go keeps the same shape.
type Handler struct {
	signalLogRepo       *signaldb.SignalLogRepo       // legacy MongoDB (optional fallback)
	signalHistoryWriter *signaldb.SignalHistoryWriter // legacy Postgres writer (snapshot/diff/stats only)
	db                  *database.DB                  // primary Postgres for typed signal_log queries
	redisCache          *signal.RedisSignalCache
	liveSignals         signal.LiveSignalStore
	transportAgreement  transportAgreementReader
}

type transportAgreementReader interface {
	AgreementEvidence(
		ctx context.Context,
		vehicleID int64,
		from, to time.Time,
		limit int,
	) ([]agreement.Sample, bool, error)
}

// NewHandler creates a new Handler. The MongoDB repo is
// retained as an optional cold-path fallback for /snapshot only; the
// typed live and history paths do not depend on it.
func NewHandler(repo *signaldb.SignalLogRepo) *Handler {
	return &Handler{signalLogRepo: repo}
}

// WithDB adds the primary Postgres handle. Required for /history; the
// typed signal_log query routes through this.
func (h *Handler) WithDB(db *database.DB) *Handler {
	h.db = db
	if db != nil && db.Pool != nil {
		h.transportAgreement = signaldb.NewTransportAgreementRepo(db)
	}
	return h
}

// WithSignalHistory adds the legacy SignalHistoryWriter. Used only by
// snapshot/diff/stats; the typed /history endpoint queries signal_log
// directly via h.db.Pool.
func (h *Handler) WithSignalHistory(w *signaldb.SignalHistoryWriter) *Handler {
	h.signalHistoryWriter = w
	return h
}

// WithRedisCache sets the Redis signal cache for live signal-keys
// discovery (legacy fallback path; no longer wired into /available).
func (h *Handler) WithRedisCache(cache *signal.RedisSignalCache) *Handler {
	h.redisCache = cache
	return h
}

// WithLiveSignalStore sets the live signal boundary (L1+L2) used by
// /live and /snapshot.
func (h *Handler) WithLiveSignalStore(store signal.LiveSignalStore) *Handler {
	h.liveSignals = store
	return h
}

// historyMaxLimit caps the number of signal_log rows a single /history
// call may return. Mirrors the cap the legacy SignalHistoryWriter used
// before this rewrite so a malicious or buggy client cannot scan an
// entire vehicle's history into one response.
const historyMaxLimit = 10000

// historyDefaultLimit is the row count used when the caller omits the
// `limit` query parameter.
const historyDefaultLimit = 1000

const (
	transportAgreementDefaultHours = 24
	transportAgreementMaxHours     = 168
	transportAgreementRowLimit     = 10000
	transportAgreementTolerance    = 2 * time.Second
)

// signalHistoryPoint is a single row in a /history response. The `kind`
// field echoes the row's stored protomodel.ValueKind discriminator so
// the frontend can switch on it; `value` is the typed Go scalar that
// the kind selects from the typed signal_log columns.
type signalHistoryPoint struct {
	Ts                   time.Time   `json:"ts"`
	Kind                 string      `json:"kind"`
	Value                interface{} `json:"value"`
	IngestOrigin         *string     `json:"ingest_origin"`
	SourceEmittedAt      *time.Time  `json:"source_emitted_at"`
	ReceivedAt           *time.Time  `json:"received_at"`
	NormalizationVersion *int16      `json:"normalization_version"`
}

type transportAgreementResponse struct {
	VehicleID       int64     `json:"vehicle_id"`
	From            time.Time `json:"from"`
	To              time.Time `json:"to"`
	PairToleranceMS int64     `json:"pair_tolerance_ms"`
	RowLimit        int       `json:"row_limit"`
	Truncated       bool      `json:"truncated"`
	SourceTimeOnly  bool      `json:"source_time_only"`
	GeneratedAt     time.Time `json:"generated_at"`
	agreement.Report
}

// TransportAgreement compares independently attested HTTP and MQTT samples
// over a bounded source-time window. Samples without producer timestamps are
// deliberately excluded instead of being aligned by receipt time.
func (h *Handler) TransportAgreement(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.signals.transport_agreement")
	defer span.End()

	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil || vehicleID <= 0 {
		validationErr := errors.New("vehicle ID must be a positive integer")
		span.RecordError(validationErr)
		httpx.WriteError(w, http.StatusBadRequest, validationErr.Error())
		return
	}

	from, to, err := parseTransportAgreementRange(r, time.Now().UTC())
	if err != nil {
		span.RecordError(err)
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if h.transportAgreement == nil {
		configErr := errors.New("transport agreement evidence is unavailable")
		span.RecordError(configErr)
		httpx.WriteError(w, http.StatusServiceUnavailable, configErr.Error())
		return
	}

	samples, truncated, err := h.transportAgreement.AgreementEvidence(
		ctx,
		vehicleID,
		from,
		to,
		transportAgreementRowLimit,
	)
	if err != nil {
		span.RecordError(err)
		log.Error().
			Err(err).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Int64("vehicle_id", vehicleID).
			Msg("signal transport agreement evidence query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to evaluate transport agreement")
		return
	}

	report := agreement.Analyze(samples, transportAgreementTolerance)
	httpx.WriteJSON(w, http.StatusOK, transportAgreementResponse{
		VehicleID:       vehicleID,
		From:            from,
		To:              to,
		PairToleranceMS: transportAgreementTolerance.Milliseconds(),
		RowLimit:        transportAgreementRowLimit,
		Truncated:       truncated,
		SourceTimeOnly:  true,
		GeneratedAt:     time.Now().UTC(),
		Report:          report,
	})
}

func parseTransportAgreementRange(r *http.Request, now time.Time) (time.Time, time.Time, error) {
	query := r.URL.Query()
	rawFrom := strings.TrimSpace(query.Get("from"))
	rawTo := strings.TrimSpace(query.Get("to"))
	if rawFrom != "" || rawTo != "" {
		if rawFrom == "" || rawTo == "" {
			return time.Time{}, time.Time{}, errors.New("from and to must be supplied together")
		}
		from, err := time.Parse(time.RFC3339, rawFrom)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("from must be an RFC3339 timestamp")
		}
		to, err := time.Parse(time.RFC3339, rawTo)
		if err != nil {
			return time.Time{}, time.Time{}, errors.New("to must be an RFC3339 timestamp")
		}
		if !from.Before(to) {
			return time.Time{}, time.Time{}, errors.New("from must be before to")
		}
		if to.Sub(from) > transportAgreementMaxHours*time.Hour {
			return time.Time{}, time.Time{}, fmt.Errorf("time range must not exceed %d hours", transportAgreementMaxHours)
		}
		return from.UTC(), to.UTC(), nil
	}

	hours := transportAgreementDefaultHours
	if rawHours := strings.TrimSpace(query.Get("hours")); rawHours != "" {
		parsed, err := strconv.Atoi(rawHours)
		if err != nil || parsed <= 0 {
			return time.Time{}, time.Time{}, errors.New("hours must be a positive integer")
		}
		hours = min(parsed, transportAgreementMaxHours)
	}
	to := now.UTC()
	return to.Add(-time.Duration(hours) * time.Hour), to, nil
}

// History returns the typed time-series for one signal on one vehicle.
// GET /api/v1/signals/{vehicleID}/{signalName}/history?from=...&to=...&limit=...&hours=...
//
// Each row is decoded by switching on the row's `value_kind` column
// (the source-of-truth discriminator written by the cold-path writer
// after normalize.toSI). protomodel.SignalsByName is consulted only for
// the response-level `expected_kind` and to short-circuit on an unknown
// signal name.
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	signalName := chi.URLParam(r, "signalName")
	if signalName == "" {
		httpx.WriteError(w, http.StatusBadRequest, "signal name required")
		return
	}

	from, to := parseHistoryRange(r)
	limit := parseHistoryLimit(r)

	expectedKind := ""
	if meta, ok := protomodel.SignalsByName[signalName]; ok && meta != nil {
		expectedKind = meta.ValueKind.String()
	}

	if h.db == nil || h.db.Pool == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"vehicle_id":    vehicleID,
			"signal":        signalName,
			"expected_kind": expectedKind,
			"from":          from,
			"to":            to,
			"count":         0,
			"data":          []signalHistoryPoint{},
		})
		return
	}

	points, err := h.queryHistory(r.Context(), vehicleID, signalName, from, to, limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "query failed: "+err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":    vehicleID,
		"signal":        signalName,
		"expected_kind": expectedKind,
		"from":          from,
		"to":            to,
		"count":         len(points),
		"data":          points,
	})
}

// queryHistory executes the typed signal_log query and decodes each row
// per the row's value_kind. Forward-only typed signal_log schema:
//
//	signal_log(vehicle_id, ts, field, value_kind,
//	           str_value, bool_value, int_value, float_value, time_value,
//	           ingest_origin, source_emitted_at, received_at,
//	           normalization_version)
func (h *Handler) queryHistory(ctx context.Context, vehicleID int64, signalName string, from, to time.Time, limit int) ([]signalHistoryPoint, error) {
	const q = `
		SELECT ts, value_kind, str_value, bool_value, int_value, float_value, time_value,
		       ingest_origin, source_emitted_at, received_at, normalization_version
		  FROM signal_log
		 WHERE vehicle_id = $1
		   AND field      = $2
		   AND ts BETWEEN $3 AND $4
		 ORDER BY ts ASC
		 LIMIT $5`
	rows, err := h.db.Pool.Query(ctx, q, vehicleID, signalName, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]signalHistoryPoint, 0)
	for rows.Next() {
		var (
			ts                   time.Time
			valueKind            int16
			strVal               *string
			boolVal              *bool
			intVal               *int64
			floatVal             *float64
			timeVal              *time.Time
			ingestOrigin         *string
			sourceEmittedAt      *time.Time
			receivedAt           *time.Time
			normalizationVersion *int16
		)
		if err := rows.Scan(
			&ts, &valueKind, &strVal, &boolVal, &intVal, &floatVal, &timeVal,
			&ingestOrigin, &sourceEmittedAt, &receivedAt, &normalizationVersion,
		); err != nil {
			return nil, err
		}
		out = append(out, signalHistoryPoint{
			Ts:                   ts,
			Kind:                 protomodel.ValueKind(valueKind).String(),
			Value:                decodeTypedRow(protomodel.ValueKind(valueKind), strVal, boolVal, intVal, floatVal, timeVal),
			IngestOrigin:         ingestOrigin,
			SourceEmittedAt:      sourceEmittedAt,
			ReceivedAt:           receivedAt,
			NormalizationVersion: normalizationVersion,
		})
	}
	return out, rows.Err()
}

// decodeTypedRow returns the typed scalar dictated by the row's
// value_kind. The row's discriminator is the source of truth: per the
// 000186 schema comment, exactly one typed column is non-null per row,
// and the writer is expected to keep value_kind in sync with the
// populated column. If the discriminator is one we don't recognise
// (forward-compat with future ValueKind additions), we fall back to
// the first non-null typed column so the value still surfaces.
func decodeTypedRow(kind protomodel.ValueKind, strVal *string, boolVal *bool, intVal *int64, floatVal *float64, timeVal *time.Time) interface{} {
	switch kind {
	case protomodel.ValueKindString:
		if strVal != nil {
			return *strVal
		}
	case protomodel.ValueKindBool:
		if boolVal != nil {
			return *boolVal
		}
	case protomodel.ValueKindInt32, protomodel.ValueKindInt64, protomodel.ValueKindEnum:
		if intVal != nil {
			return *intVal
		}
	case protomodel.ValueKindFloat, protomodel.ValueKindDouble:
		if floatVal != nil {
			return *floatVal
		}
	case protomodel.ValueKindTime:
		if timeVal != nil {
			return *timeVal
		}
	default:
		switch {
		case strVal != nil:
			return *strVal
		case boolVal != nil:
			return *boolVal
		case intVal != nil:
			return *intVal
		case floatVal != nil:
			return *floatVal
		case timeVal != nil:
			return *timeVal
		}
	}
	return nil
}

func parseHistoryRange(r *http.Request) (time.Time, time.Time) {
	to := time.Now().UTC()
	from := to.Add(-24 * time.Hour)

	if hoursStr := r.URL.Query().Get("hours"); hoursStr != "" {
		if hrs, err := strconv.Atoi(hoursStr); err == nil && hrs > 0 {
			from = to.Add(-time.Duration(hrs) * time.Hour)
		}
	}
	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			from = t
		}
	}
	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			to = t
		}
	}
	return from, to
}

func parseHistoryLimit(r *http.Request) int {
	limit := historyDefaultLimit
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}
	if limit > historyMaxLimit {
		limit = historyMaxLimit
	}
	return limit
}

// AvailableSignals returns the Tesla telemetry signal catalog for a
// vehicle. The catalog itself is global (every vehicle subscribes to
// the same fields); the {vehicleID} URL param is preserved for routing
// symmetry and so a future per-vehicle subscription override could
// filter the response without breaking the URL contract.
//
// GET /api/v1/signals/{vehicleID}/available
func (h *Handler) AvailableSignals(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	signals := AvailableSignals()
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      len(signals),
		"signals":    signals,
		"source":     "protomodel",
	})
}

// Stats returns signal log row counts and date range for a vehicle.
// GET /api/v1/signals/{vehicleID}/stats
//
// Kept compiling against SignalHistoryWriter for backwards compatibility
// with existing route wiring.
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	if h.signalHistoryWriter != nil {
		count, oldest, newest, err := h.signalHistoryWriter.GetGlobalStats(r.Context(), vehicleID)
		if err == nil {
			httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      count,
				"oldest":     oldest,
				"newest":     newest,
			})
			return
		}
	}

	if h.signalLogRepo != nil {
		count, oldest, newest, err := h.signalLogRepo.GetStats(r.Context(), vehicleID)
		if err == nil {
			httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      count,
				"oldest":     oldest,
				"newest":     newest,
			})
			return
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      0,
		"oldest":     nil,
		"newest":     nil,
	})
}

// LiveState returns the current in-memory signal state for a vehicle
// as the typed `{kind, value, ts}` envelope. The envelope is augmented
// with `timestamp`, `source` ("l1" | "l2" | "stale"), and `age_ms` so
// the FSM debugger can keep surfacing which layer satisfied each read.
//
// GET /api/v1/signals/{vehicleID}/live
func (h *Handler) LiveState(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	if h.liveSignals == nil {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store not initialized"})
		return
	}

	raw, err := h.liveSignals.GetAll(r.Context(), vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store unavailable"})
		return
	}
	now := time.Now().UTC()
	signals := make(map[string]interface{}, len(raw))
	for k, v := range raw {
		if v == nil {
			continue
		}
		signals[k] = buildLiveEntry(k, v, now)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      len(signals),
		"signals":    signals,
		"at":         now,
	})
}

// buildLiveEntry constructs the per-signal JSON envelope for /live and
// /snapshot. The envelope superset-of-old-shape design lets the typed
// rewrite ship without touching any existing test:
//
//	{
//	  "kind":      "ValueKindFloat",         // typed
//	  "value":     73.0,                     // typed
//	  "ts":        "2024-01-01T00:00:00Z",   // typed
//	  "timestamp": "2024-01-01T00:00:00Z",   // legacy (FSM debugger)
//	  "source":    "l1",                     // legacy (FSM debugger)
//	  "age_ms":    1234                      // legacy (FSM debugger)
//	}
func buildLiveEntry(name string, v *signal.Value, now time.Time) map[string]interface{} {
	entry := map[string]interface{}{
		"kind":      resolveLiveKind(name, v.Raw),
		"value":     v.Raw,
		"ts":        v.Timestamp,
		"timestamp": v.Timestamp,
		"source":    classifyLiveSource(v, now),
	}
	if !v.Timestamp.IsZero() {
		entry["age_ms"] = now.Sub(v.Timestamp).Milliseconds()
	}
	return entry
}

// resolveLiveKind picks the canonical protomodel.ValueKind name for a
// signal observed in the live store. The vendored proto is the
// authority for any field present in protomodel.SignalsByName; for
// codec-flattened compound children (e.g. Latitude / Longitude), which
// are NOT in SignalsByName, the kind is inferred from the Go type of
// the raw value because the codec emits them as typed primitives.
func resolveLiveKind(name string, raw interface{}) string {
	if meta, ok := protomodel.SignalsByName[name]; ok && meta != nil {
		return meta.ValueKind.String()
	}
	switch raw.(type) {
	case bool:
		return protomodel.ValueKindBool.String()
	case string:
		return protomodel.ValueKindString.String()
	case int, int32:
		return protomodel.ValueKindInt32.String()
	case int64:
		return protomodel.ValueKindInt64.String()
	case float32, float64:
		return protomodel.ValueKindFloat.String()
	case time.Time:
		return protomodel.ValueKindTime.String()
	}
	return protomodel.ValueKindUnknown.String()
}

// classifyLiveSource maps a live signal Value into the L1/L2/STALE
// bucket the debugger UI uses (ADR-002 / "Signal Data — Layered
// Live-State Contract"):
//
//   - zero timestamp        → "l2" (legacy unknown-freshness Redis entry)
//   - age >  freshness      → "stale"
//   - age <= freshness      → "l1"
//
// Strictly distinguishing L1 vs L2 would require the boundary to expose
// its per-signal source; today we treat "fresh" as L1-equivalent because
// the L1 hot path is what the debugger primarily cares about.
func classifyLiveSource(v *signal.Value, now time.Time) string {
	if v == nil {
		return "unknown"
	}
	if v.Timestamp.IsZero() {
		return "l2"
	}
	if now.Sub(v.Timestamp) > signal.LiveSignalFreshnessThreshold {
		return "stale"
	}
	return "l1"
}

// Snapshot returns a point-in-time signal snapshot. When `at` is
// omitted (or equals "now"), the response mirrors LiveState. When `at`
// is in the past, the handler reconstructs the snapshot from the
// legacy SignalHistoryWriter.
//
// GET /api/v1/signals/{vehicleID}/snapshot?at=...&signals=BatteryLevel,Gear
func (h *Handler) Snapshot(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	now := time.Now().UTC()
	at := now
	if atStr := r.URL.Query().Get("at"); atStr != "" {
		parsed, perr := time.Parse(time.RFC3339, atStr)
		if perr != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid at timestamp; expect RFC3339")
			return
		}
		at = parsed.UTC()
	}

	requested := parseSignalNames(r.URL.Query().Get("signals"))

	if !at.Before(now.Add(-30 * time.Second)) {
		h.snapshotLive(w, r, vehicleID, requested, now)
		return
	}

	h.snapshotFromLog(w, r, vehicleID, requested, at)
}

// parseSignalNames trims and splits a comma-separated signal name list,
// dropping empty entries.
func parseSignalNames(csv string) []string {
	if csv == "" {
		return nil
	}
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func (h *Handler) snapshotLive(w http.ResponseWriter, r *http.Request, vehicleID int64, requested []string, now time.Time) {
	if h.liveSignals == nil {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store not initialized"})
		return
	}
	raw, err := h.liveSignals.GetAll(r.Context(), vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store unavailable"})
		return
	}

	wanted := signalSet(requested)
	signals := make(map[string]interface{}, len(raw))
	for k, v := range raw {
		if v == nil {
			continue
		}
		if wanted != nil {
			if _, ok := wanted[k]; !ok {
				continue
			}
		}
		signals[k] = buildLiveEntry(k, v, now)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"at":         now,
		"count":      len(signals),
		"signals":    signals,
	})
}

func (h *Handler) snapshotFromLog(w http.ResponseWriter, r *http.Request, vehicleID int64, requested []string, at time.Time) {
	if h.signalHistoryWriter == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"vehicle_id": vehicleID,
			"at":         at,
			"count":      0,
			"signals":    map[string]interface{}{},
		})
		return
	}

	names := requested
	if len(names) == 0 {
		all, err := h.signalHistoryWriter.AvailableSignals(r.Context(), vehicleID)
		if err == nil {
			names = all
		}
	}

	signals := map[string]interface{}{}
	for _, name := range names {
		val, ts, ok := lastSignalAt(r.Context(), h.signalHistoryWriter, vehicleID, name, at)
		if !ok {
			continue
		}
		entry := map[string]interface{}{
			"kind":      resolveLiveKind(name, val),
			"value":     val,
			"ts":        ts,
			"timestamp": ts,
			"source":    "log",
		}
		if !ts.IsZero() {
			entry["age_ms"] = at.Sub(ts).Milliseconds()
		}
		signals[name] = entry
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"at":         at,
		"count":      len(signals),
		"signals":    signals,
	})
}

// lastSignalAt fetches the most recent legacy signal_history value at
// or before `at` for one signal. Used only by the out-of-scope
// /snapshot path. The lookback window is bounded so the page query
// stays fast even when a vehicle has decades of history.
func lastSignalAt(ctx context.Context, w *signaldb.SignalHistoryWriter, vehicleID int64, signalName string, at time.Time) (interface{}, time.Time, bool) {
	from := at.Add(-snapshotLookback)
	rows, err := w.GetHistory(ctx, vehicleID, signalName, from, at, 1)
	if err != nil || len(rows) == 0 {
		return nil, time.Time{}, false
	}
	row := rows[len(rows)-1]
	return signalRowValue(row), row.CreatedAt, true
}

const snapshotLookback = 30 * 24 * time.Hour

func signalRowValue(row signaldb.SignalHistoryRow) interface{} {
	switch {
	case row.ValueNum != nil:
		return *row.ValueNum
	case row.ValueBool != nil:
		return *row.ValueBool
	case row.ValueStr != nil:
		return *row.ValueStr
	}
	return nil
}

func signalSet(names []string) map[string]struct{} {
	if len(names) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(names))
	for _, n := range names {
		out[n] = struct{}{}
	}
	return out
}

// Diff returns one row per signal that changed between two snapshots.
// Both snapshots use the same point-in-time logic as Snapshot and continue
// compiling against the existing helpers.
//
// GET /api/v1/signals/{vehicleID}/diff?at_a=...&at_b=...&signals=...
type signalDiffRow struct {
	Name     string      `json:"name"`
	ValueA   interface{} `json:"value_a"`
	ValueB   interface{} `json:"value_b"`
	SourceA  string      `json:"source_a"`
	SourceB  string      `json:"source_b"`
	Changed  bool        `json:"changed"`
	AgeMSA   *int64      `json:"age_ms_a,omitempty"`
	AgeMSB   *int64      `json:"age_ms_b,omitempty"`
	Category string      `json:"category,omitempty"`
}

func (h *Handler) Diff(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	atA, err := parseAtParam(r, "at_a", time.Now().UTC().Add(-1*time.Hour))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid at_a timestamp; expect RFC3339")
		return
	}
	atB, err := parseAtParam(r, "at_b", time.Now().UTC())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid at_b timestamp; expect RFC3339")
		return
	}

	requested := parseSignalNames(r.URL.Query().Get("signals"))

	snapA, err := h.collectSnapshot(r.Context(), vehicleID, requested, atA)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "snapshot a failed: "+err.Error())
		return
	}
	snapB, err := h.collectSnapshot(r.Context(), vehicleID, requested, atB)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "snapshot b failed: "+err.Error())
		return
	}

	names := mergeSignalKeys(snapA, snapB)
	rows := make([]signalDiffRow, 0, len(names))
	for _, name := range names {
		a, hasA := snapA[name]
		b, hasB := snapB[name]
		changed := !valuesEqual(a.value, b.value) || hasA != hasB
		if !changed {
			continue
		}
		row := signalDiffRow{
			Name:    name,
			ValueA:  a.value,
			ValueB:  b.value,
			SourceA: a.source,
			SourceB: b.source,
			Changed: true,
		}
		if a.ageMS != nil {
			row.AgeMSA = a.ageMS
		}
		if b.ageMS != nil {
			row.AgeMSB = b.ageMS
		}
		rows = append(rows, row)
	}

	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"at_a":       atA,
		"at_b":       atB,
		"count":      len(rows),
		"data":       rows,
	})
}

type signalSnapshotEntry struct {
	value  interface{}
	source string
	ageMS  *int64
}

func (h *Handler) collectSnapshot(ctx context.Context, vehicleID int64, requested []string, at time.Time) (map[string]signalSnapshotEntry, error) {
	now := time.Now().UTC()
	out := map[string]signalSnapshotEntry{}

	if !at.Before(now.Add(-30*time.Second)) && h.liveSignals != nil {
		raw, err := h.liveSignals.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
		if err == nil {
			wanted := signalSet(requested)
			for name, v := range raw {
				if v == nil {
					continue
				}
				if wanted != nil {
					if _, ok := wanted[name]; !ok {
						continue
					}
				}
				entry := signalSnapshotEntry{value: v.Raw, source: classifyLiveSource(v, now)}
				if !v.Timestamp.IsZero() {
					age := now.Sub(v.Timestamp).Milliseconds()
					entry.ageMS = &age
				}
				out[name] = entry
			}
			return out, nil
		}
	}

	if h.signalHistoryWriter == nil {
		return out, nil
	}
	names := requested
	if len(names) == 0 {
		all, err := h.signalHistoryWriter.AvailableSignals(ctx, vehicleID)
		if err != nil {
			return nil, err
		}
		names = all
	}
	for _, name := range names {
		val, ts, ok := lastSignalAt(ctx, h.signalHistoryWriter, vehicleID, name, at)
		if !ok {
			continue
		}
		entry := signalSnapshotEntry{value: val, source: "log"}
		if !ts.IsZero() {
			age := at.Sub(ts).Milliseconds()
			entry.ageMS = &age
		}
		out[name] = entry
	}
	return out, nil
}

func parseAtParam(r *http.Request, key string, def time.Time) (time.Time, error) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def, nil
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func mergeSignalKeys(a, b map[string]signalSnapshotEntry) []string {
	seen := make(map[string]struct{}, len(a)+len(b))
	for k := range a {
		seen[k] = struct{}{}
	}
	for k := range b {
		seen[k] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out
}

// valuesEqual treats numeric and string comparisons consistently with
// how the upstream signal store coerces values. Pointer wrappers were
// already unboxed when we built the snapshot entries, so we only deal
// with raw scalars.
func valuesEqual(a, b interface{}) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if af, aok := signalToFloat(a); aok {
		if bf, bok := signalToFloat(b); bok {
			return af == bf
		}
		return false
	}
	if ab, aok := a.(bool); aok {
		if bb, bok := b.(bool); bok {
			return ab == bb
		}
		return false
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}

func signalToFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}

// LiveSignalValuesToRaw flattens a *signal.Value snapshot into a plain
// {name -> raw} map. Used by alert_handler_rules.go and
// vehicle_handler.go for template rendering and BuildStateFromSignalStore
// hydration; preserved here so the typed rewrite does not require
// touching those callers.
//
// Exported so the parent api package can call into the subpackage after
// the package split.
func LiveSignalValuesToRaw(values map[string]*signal.Value) map[string]interface{} {
	raw := make(map[string]interface{}, len(values))
	for name, value := range values {
		if value != nil {
			raw[name] = value.Raw
		}
	}
	return raw
}
