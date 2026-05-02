package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
)

// SignalHandler provides API endpoints for querying signal history
// (Postgres primary, MongoDB optional fallback).
type SignalHandler struct {
	signalLogRepo       *database.SignalLogRepo       // MongoDB (optional)
	signalHistoryWriter *database.SignalHistoryWriter // Postgres (primary)
	db                  *database.DB
	redisCache          *signal.RedisSignalCache
	liveSignals         signal.LiveSignalStore
}

// NewSignalHandler creates a new SignalHandler.
func NewSignalHandler(repo *database.SignalLogRepo) *SignalHandler {
	return &SignalHandler{signalLogRepo: repo}
}

// WithDB adds PostgreSQL access for fallback signal discovery.
func (h *SignalHandler) WithDB(db *database.DB) *SignalHandler {
	h.db = db
	return h
}

// WithSignalHistory adds the Postgres signal_history writer for primary queries.
func (h *SignalHandler) WithSignalHistory(w *database.SignalHistoryWriter) *SignalHandler {
	h.signalHistoryWriter = w
	return h
}

// WithRedisCache sets the Redis signal cache for reading live signal keys.
func (h *SignalHandler) WithRedisCache(cache *signal.RedisSignalCache) *SignalHandler {
	h.redisCache = cache
	return h
}

// WithLiveSignalStore sets the live signal boundary for cross-pod live reads.
func (h *SignalHandler) WithLiveSignalStore(store signal.LiveSignalStore) *SignalHandler {
	h.liveSignals = store
	return h
}

// History returns signal history for a vehicle and signal name.
// GET /api/v1/signals/{vehicleID}/{signalName}/history?from=...&to=...&limit=...&hours=...
func (h *SignalHandler) History(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	signalName := chi.URLParam(r, "signalName")
	if signalName == "" {
		writeError(w, http.StatusBadRequest, "signal name required")
		return
	}

	// Parse time range (defaults to last 24 hours)
	to := time.Now().UTC()
	from := to.Add(-24 * time.Hour)

	// Support "hours" shorthand (e.g. ?hours=6)
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

	limit := int64(1000)
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.ParseInt(limitStr, 10, 64); err == nil && l > 0 {
			limit = l
		}
	}

	// Try Postgres signal_history first
	if h.signalHistoryWriter != nil {
		rows, err := h.signalHistoryWriter.GetHistory(r.Context(), vehicleID, signalName, from, to, int(limit))
		if err == nil && len(rows) > 0 {
			points := make([]map[string]interface{}, len(rows))
			for i, row := range rows {
				p := map[string]interface{}{"created_at": row.CreatedAt}
				if row.ValueNum != nil {
					p["value_num"] = *row.ValueNum
				}
				if row.ValueStr != nil {
					p["value_str"] = *row.ValueStr
				}
				if row.ValueBool != nil {
					p["value_bool"] = *row.ValueBool
				}
				points[i] = p
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"signal":     signalName,
				"from":       from,
				"to":         to,
				"count":      len(points),
				"data":       points,
			})
			return
		}
	}

	// Fallback to MongoDB
	if h.signalLogRepo != nil {
		points, err := h.signalLogRepo.GetHistory(r.Context(), database.SignalHistoryQuery{
			VehicleID: vehicleID,
			Signal:    signalName,
			From:      from,
			To:        to,
			Limit:     limit,
		})
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"signal":     signalName,
				"from":       from,
				"to":         to,
				"count":      len(points),
				"data":       points,
			})
			return
		}
	}

	// No data from either source — return empty result (not 503)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"signal":     signalName,
		"from":       from,
		"to":         to,
		"count":      0,
		"data":       []interface{}{},
	})
}

// AvailableSignals returns the list of signal names with data for a vehicle.
// GET /api/v1/signals/{vehicleID}/available
func (h *SignalHandler) AvailableSignals(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	// Try Postgres signal_history first (most accurate — actual observed signals)
	if h.signalHistoryWriter != nil {
		signals, err := h.signalHistoryWriter.AvailableSignals(r.Context(), vehicleID)
		if err == nil && len(signals) > 0 {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      len(signals),
				"signals":    signals,
				"source":     "signal_history",
			})
			return
		}
	}

	// Try MongoDB
	if h.signalLogRepo != nil {
		signals, err := h.signalLogRepo.GetAvailableSignals(r.Context(), vehicleID)
		if err == nil && len(signals) > 0 {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      len(signals),
				"signals":    signals,
			})
			return
		}
	}

	// Fallback: query signal keys from Redis HSET
	if h.redisCache != nil {
		signals, err := h.getSignalNamesFromRedis(r.Context(), vehicleID)
		if err == nil && len(signals) > 0 {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      len(signals),
				"signals":    signals,
				"source":     "redis",
			})
			return
		}
	}

	// Last resort: return well-known Fleet Telemetry signal names
	fallback := getKnownSignalNames()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      len(fallback),
		"signals":    fallback,
		"source":     "static",
	})
}

// getSignalNamesFromRedis returns sorted signal names from the Redis HSET for a vehicle.
func (h *SignalHandler) getSignalNamesFromRedis(ctx context.Context, vehicleID int64) ([]string, error) {
	signals, err := h.redisCache.GetAll(ctx, vehicleID)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(signals))
	for name := range signals {
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

// getKnownSignalNames returns a static list of commonly available Fleet Telemetry signals.
func getKnownSignalNames() []string {
	return []string{
		"ACChargingEnergyIn", "ACChargingPower", "BatteryLevel",
		"BatteryHeaterOn", "ChargeAmps", "ChargeCurrentRequest",
		"ChargeEnableRequest", "ChargeLimitSoc", "ChargePort",
		"ChargeState", "ChargerActualCurrent", "ChargerPhases",
		"ChargerPilotCurrent", "ChargerVoltage", "DCChargingEnergyIn",
		"DCChargingPower", "DetailedChargeState", "DoorState",
		"DriveState", "EnergyRemaining", "EstBatteryRange",
		"FastChargerPresent", "FastChargerType", "GearSelection",
		"GpsHeading", "GpsState", "IdealBatteryRange",
		"InsideTemp", "Location", "Locked",
		"Odometer", "OutsideTemp", "PackCurrent",
		"PackVoltage", "PreconditioningEnabled", "Soc",
		"Speed", "TimeToFullCharge", "TpmsFl", "TpmsFr",
		"TpmsRl", "TpmsRr", "VehicleName", "VehicleSpeed",
	}
}

// Stats returns signal log statistics for a vehicle.
// GET /api/v1/signals/{vehicleID}/stats
func (h *SignalHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	// Try Postgres signal_history first
	if h.signalHistoryWriter != nil {
		count, oldest, newest, err := h.signalHistoryWriter.GetGlobalStats(r.Context(), vehicleID)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      count,
				"oldest":     oldest,
				"newest":     newest,
			})
			return
		}
	}

	// Fallback to MongoDB
	if h.signalLogRepo != nil {
		count, oldest, newest, err := h.signalLogRepo.GetStats(r.Context(), vehicleID)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      count,
				"oldest":     oldest,
				"newest":     newest,
			})
			return
		}
	}

	// No source available — return zeros (not 503)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      0,
		"oldest":     nil,
		"newest":     nil,
	})
}

// LiveState returns the current in-memory signal state for a vehicle.
// GET /api/v1/signals/{vehicleID}/live
//
// Each signal entry includes `source` ("l1", "l2", "stale") and `age_ms` so
// the FSM debugger can surface which layer satisfied the read. The shape is a
// non-breaking extension — old clients that only read `value`/`timestamp` keep
// working. Phase-40 / Prompt 58.
func (h *SignalHandler) LiveState(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	if h.liveSignals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store not initialized"})
		return
	}

	raw, err := h.liveSignals.GetAll(r.Context(), vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store unavailable"})
		return
	}
	now := time.Now().UTC()
	signals := make(map[string]interface{}, len(raw))
	for k, v := range raw {
		if v == nil {
			continue
		}
		entry := map[string]interface{}{
			"value":     v.Raw,
			"timestamp": v.Timestamp,
			"source":    classifyLiveSource(v, now),
		}
		if !v.Timestamp.IsZero() {
			entry["age_ms"] = now.Sub(v.Timestamp).Milliseconds()
		}
		signals[k] = entry
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      len(signals),
		"signals":    signals,
		"at":         now,
	})
}

// classifyLiveSource maps a live signal Value into the L1/L2/STALE bucket the
// debugger UI uses. The boundary already merges L1 + L2 by the freshness rule
// described in ADR-002 / "Signal Data — Layered Live-State Contract", so we
// classify by age:
//   - zero timestamp        → "l2" (legacy unknown-freshness Redis entry)
//   - age >  freshness      → "stale"
//   - age <= freshness      → "l1"
//
// Strictly distinguishing L1 vs L2 would require the boundary to expose its
// per-signal source; today we treat "fresh" as L1-equivalent because the L1
// hot path is what the debugger primarily cares about.
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

// Snapshot returns a point-in-time signal snapshot. When `at` is omitted (or
// equals "now"), the response mirrors LiveState. When `at` is in the past, the
// handler reconstructs the snapshot from signal_log: for each requested signal
// (or the vehicle's full known signal set when none requested) it returns the
// last value at-or-before `at`. Phase-40 / Prompt 58.
//
// GET /api/v1/signals/{vehicleID}/snapshot?at=...&signals=BatteryLevel,Gear
func (h *SignalHandler) Snapshot(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	now := time.Now().UTC()
	at := now
	if atStr := r.URL.Query().Get("at"); atStr != "" {
		parsed, perr := time.Parse(time.RFC3339, atStr)
		if perr != nil {
			writeError(w, http.StatusBadRequest, "invalid at timestamp; expect RFC3339")
			return
		}
		at = parsed.UTC()
	}

	requested := parseSignalNames(r.URL.Query().Get("signals"))

	// Recent / present-time → live store path.
	if !at.Before(now.Add(-30 * time.Second)) {
		h.snapshotLive(w, r, vehicleID, requested, now)
		return
	}

	// Past → reconstruct from signal_log.
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

func (h *SignalHandler) snapshotLive(w http.ResponseWriter, r *http.Request, vehicleID int64, requested []string, now time.Time) {
	if h.liveSignals == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store not initialized"})
		return
	}
	raw, err := h.liveSignals.GetAll(r.Context(), vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "live signal store unavailable"})
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
		entry := map[string]interface{}{
			"value":     v.Raw,
			"timestamp": v.Timestamp,
			"source":    classifyLiveSource(v, now),
		}
		if !v.Timestamp.IsZero() {
			entry["age_ms"] = now.Sub(v.Timestamp).Milliseconds()
		}
		signals[k] = entry
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"at":         now,
		"count":      len(signals),
		"signals":    signals,
	})
}

func (h *SignalHandler) snapshotFromLog(w http.ResponseWriter, r *http.Request, vehicleID int64, requested []string, at time.Time) {
	if h.signalHistoryWriter == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
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
			"value":     val,
			"timestamp": ts,
			"source":    "log",
		}
		if !ts.IsZero() {
			entry["age_ms"] = at.Sub(ts).Milliseconds()
		}
		signals[name] = entry
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"at":         at,
		"count":      len(signals),
		"signals":    signals,
	})
}

// lastSignalAt fetches the most recent signal_history value at or before `at`
// for one signal. Returns (value, ts, true) on success, (nil, zero, false)
// otherwise. The lookback window is bounded so the page query stays fast even
// when a vehicle has decades of history.
func lastSignalAt(ctx context.Context, w *database.SignalHistoryWriter, vehicleID int64, signalName string, at time.Time) (interface{}, time.Time, bool) {
	from := at.Add(-snapshotLookback)
	rows, err := w.GetHistory(ctx, vehicleID, signalName, from, at, 1)
	if err != nil || len(rows) == 0 {
		return nil, time.Time{}, false
	}
	// GetHistory returns rows ASC; for "last value at-or-before at" we want
	// the newest within [from, at] which is the last element.
	row := rows[len(rows)-1]
	return signalRowValue(row), row.CreatedAt, true
}

// snapshotLookback bounds how far back snapshotFromLog will search for the
// last value of a signal at-or-before `at`. 30 days is generous enough for a
// debugger snapshot (signals that haven't changed in 30 days are effectively
// static) while keeping the per-signal index lookup cheap.
const snapshotLookback = 30 * 24 * time.Hour

func signalRowValue(row database.SignalHistoryRow) interface{} {
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

// Diff returns one row per signal that changed between two snapshots. Both
// snapshots use the same point-in-time logic as Snapshot. Unchanged signals
// are omitted server-side so the wire payload stays compact even when the
// vehicle reports thousands of signals. Phase-40 / Prompt 58.
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

func (h *SignalHandler) Diff(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	atA, err := parseAtParam(r, "at_a", time.Now().UTC().Add(-1*time.Hour))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid at_a timestamp; expect RFC3339")
		return
	}
	atB, err := parseAtParam(r, "at_b", time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid at_b timestamp; expect RFC3339")
		return
	}

	requested := parseSignalNames(r.URL.Query().Get("signals"))

	snapA, err := h.collectSnapshot(r.Context(), vehicleID, requested, atA)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "snapshot a failed: "+err.Error())
		return
	}
	snapB, err := h.collectSnapshot(r.Context(), vehicleID, requested, atB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "snapshot b failed: "+err.Error())
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

	writeJSON(w, http.StatusOK, map[string]interface{}{
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

func (h *SignalHandler) collectSnapshot(ctx context.Context, vehicleID int64, requested []string, at time.Time) (map[string]signalSnapshotEntry, error) {
	now := time.Now().UTC()
	out := map[string]signalSnapshotEntry{}

	// Live path: when at is within ~30s of now, read the live store.
	if !at.Before(now.Add(-30 * time.Second)) && h.liveSignals != nil {
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

	// Past path: reconstruct from signal_log.
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

// valuesEqual treats numeric and string comparisons consistently with how the
// upstream signal store coerces values. Pointer wrappers were already unboxed
// when we built the snapshot entries, so we only have to deal with raw scalars.
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

func liveSignalValuesToRaw(values map[string]*signal.Value) map[string]interface{} {
	raw := make(map[string]interface{}, len(values))
	for name, value := range values {
		if value != nil {
			raw[name] = value.Raw
		}
	}
	return raw
}
