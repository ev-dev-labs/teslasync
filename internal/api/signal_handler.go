package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SignalHandler provides API endpoints for querying signal history
// (Postgres primary, MongoDB optional fallback).
type SignalHandler struct {
	signalLogRepo       *database.SignalLogRepo       // MongoDB (optional)
	signalHistoryWriter *database.SignalHistoryWriter  // Postgres (primary)
	db                  *database.DB
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
				p := map[string]interface{}{"timestamp": row.CreatedAt}
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

	// Fallback: query distinct signal columns from vehicle_live_state
	if h.db != nil {
		signals, err := h.getSignalNamesFromPG(r.Context(), vehicleID)
		if err == nil && len(signals) > 0 {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vehicle_id": vehicleID,
				"count":      len(signals),
				"signals":    signals,
				"source":     "postgresql",
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

// getSignalNamesFromPG queries column names from vehicle_live_state that contain data.
func (h *SignalHandler) getSignalNamesFromPG(ctx context.Context, vehicleID int64) ([]string, error) {
	query := `
		SELECT column_name FROM information_schema.columns
		WHERE table_name = 'vehicle_live_state'
		  AND column_name NOT IN ('id', 'vehicle_id', 'created_at', 'updated_at')
		ORDER BY column_name`
	rows, err := h.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var signals []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			signals = append(signals, name)
		}
	}
	return signals, rows.Err()
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
func (h *SignalHandler) LiveState(w http.ResponseWriter, r *http.Request) {
	// This will be set by the router when wiring — uses the telemetry handler's signal store
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "live state requires signal store"})
}
