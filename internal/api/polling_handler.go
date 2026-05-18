package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// PollEngineHandlers returns HTTP handlers for the adaptive polling engine
// dashboard endpoints.
func PollEngineHandlers(engine *polling.PollEngine) map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"status":      pollEngineStatus(engine),
		"decisions":   pollEngineDecisions(engine),
		"predictions": pollEnginePredictions(engine),
		"savings":     pollEngineSavings(engine),
		"config":      pollEngineConfig(engine),
		"demo":        pollEngineDemo(engine),
	}
}

// GET /api/v1/polling/status — per-vehicle engine state
func pollEngineStatus(engine *polling.PollEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if engine == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"enabled":  false,
				"vehicles": map[string]interface{}{},
			})
			return
		}

		vehicles := engine.GetAllVehicleStates()
		result := make(map[string]interface{}, len(vehicles))
		for vin, vs := range vehicles {
			result[vin] = map[string]interface{}{
				"activity":       vs.CurrentActivity.String(),
				"profile":        vs.CurrentProfile,
				"consec_idle":    vs.ConsecIdle,
				"last_poll_time": vs.LastPollTime,
				"next_poll_after": vs.NextPollAfter,
				"battery_level":  vs.LastBatteryLevel,
				"last_decision":  vs.LastDecision,
			}
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"enabled":  true,
			"vehicles": result,
		})
	}
}

// GET /api/v1/polling/decisions?vin=X&limit=50
func pollEngineDecisions(engine *polling.PollEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if engine == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{"decisions": []interface{}{}})
			return
		}

		vin := r.URL.Query().Get("vin")
		if vin == "" {
			writeError(w, http.StatusBadRequest, "vin query parameter is required")
			return
		}

		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}

		decisions := engine.GetDecisionHistory(vin, limit)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"vin":       vin,
			"decisions": decisions,
		})
	}
}

// GET /api/v1/polling/predictions?vin=X
func pollEnginePredictions(engine *polling.PollEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if engine == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{"predictions": nil})
			return
		}

		vin := r.URL.Query().Get("vin")
		if vin == "" {
			// Return all patterns
			states := engine.GetAllVehicleStates()
			result := make(map[string]interface{}, len(states))
			for v, vs := range states {
				if vs.LastDecision != nil && vs.LastDecision.Prediction != nil {
					result[v] = vs.LastDecision.Prediction
				}
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"predictions": result})
			return
		}

		vs, ok := engine.GetVehicleState(vin)
		if !ok {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"vin":        vin,
				"prediction": nil,
			})
			return
		}

		var prediction interface{}
		if vs.LastDecision != nil {
			prediction = vs.LastDecision.Prediction
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"vin":        vin,
			"prediction": prediction,
		})
	}
}

// GET /api/v1/polling/savings — cost savings breakdown
func pollEngineSavings(engine *polling.PollEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if engine == nil {
			writeJSON(w, http.StatusOK, polling.CostSnapshot{})
			return
		}
		writeJSON(w, http.StatusOK, engine.CostTracker().Snapshot())
	}
}

// GET /api/v1/polling/config — current engine configuration
func pollEngineConfig(engine *polling.PollEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if engine == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{"enabled": false})
			return
		}
		// Return the engine config (read-only view)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"enabled": true,
			"engine":  "adaptive_polling_v1",
			"evaluators": []string{
				"drive", "charge", "climate", "battery", "sentry",
			},
		})
	}
}

// writeJSON is a helper that writes JSON responses.
// If the api package already has one, this will be a duplicate — but it's
// defined here as a fallback to avoid import cycles.
//nolint:unused // pre-existing func retained pending follow-up cleanup
func writeJSONPolling(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data) //nolint:errcheck
}

// POST /api/v1/polling/demo — seeds the engine with realistic test data so
// the dashboard can be previewed without an authenticated Tesla account.
func pollEngineDemo(engine *polling.PollEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if engine == nil {
			writeError(w, http.StatusBadRequest, "polling engine not enabled")
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "POST required")
			return
		}

		demoVIN := "5YJ3E1EA7PF000001"

		// Simulate an idle vehicle with charger plugged in
		idleData := &tesla.VehicleDataResponse{
			VIN:         demoVIN,
			DisplayName: "Demo Model 3",
			State:       enums.StateOnline,
			ChargeState: tesla.ChargeState{
				BatteryLevel:       82,
				BatteryRange:       241.5,
				ChargingState:      enums.ChargeStateComplete,
				ChargePortDoorOpen: true,
				ChargePortLatch:    "Engaged",
				ChargeLimitSoc:     90,
			},
			ClimateState: tesla.ClimateState{
				InsideTemp:  22.5,
				OutsideTemp: 18.3,
			},
			DriveState: tesla.DriveState{
				Latitude:  37.7749,
				Longitude: -122.4194,
			},
			VehicleState: tesla.VehicleState{
				Odometer:   28450.3,
				Locked:     true,
				SentryMode: true,
			},
		}

		// Run 3 assessments to build up decision history and idle backoff
		engine.Assess(demoVIN, idleData)
		engine.Assess(demoVIN, idleData)
		engine.Assess(demoVIN, idleData)

		// Simulate some cost savings
		ct := engine.CostTracker()
		for i := 0; i < 50; i++ {
			ct.RecordBaselineTick()
		}
		for i := 0; i < 20; i++ {
			ct.RecordSkip("idle")
		}
		for i := 0; i < 15; i++ {
			ct.RecordSkip("fleet_telemetry")
		}
		for i := 0; i < 8; i++ {
			ct.RecordSkip("sleep")
		}
		for i := 0; i < 4; i++ {
			ct.RecordSkip("prediction")
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"message": "demo data seeded",
			"vin":     demoVIN,
		})
	}
}
