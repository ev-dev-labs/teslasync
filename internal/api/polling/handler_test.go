package polling

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	enginepolling "github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// ── test helpers ──────────────────────────────────────────────────────────────

func newEngine() *enginepolling.PollEngine {
	return enginepolling.NewPollEngine(enginepolling.DefaultEngineConfig())
}

// doRequest drives a single handler and returns the recorder. Safe to call from
// goroutines: it never calls t.Fatal*.
func doRequest(t *testing.T, h http.HandlerFunc, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("invalid JSON response: %v; body=%q", err, rec.Body.String())
	}
	return m
}

func idleVehicleData(vin string) *tesla.VehicleDataResponse {
	return &tesla.VehicleDataResponse{
		VIN:          vin,
		State:        enums.StateOnline,
		ChargeState:  tesla.ChargeState{BatteryLevel: 80, ChargingState: "Disconnected"},
		ClimateState: tesla.ClimateState{},
		DriveState:   tesla.DriveState{},
		VehicleState: tesla.VehicleState{},
	}
}

func drivingVehicleData(vin string) *tesla.VehicleDataResponse {
	speed := 65
	return &tesla.VehicleDataResponse{
		VIN:         vin,
		State:       enums.StateOnline,
		DriveState:  tesla.DriveState{Speed: &speed, Power: 30},
		ChargeState: tesla.ChargeState{ChargingState: "Disconnected"},
	}
}

// ── PollEngineHandlers ────────────────────────────────────────────────────────

func TestPollEngineHandlers_ReturnsAllHandlers(t *testing.T) {
	wantKeys := []string{"status", "decisions", "predictions", "savings", "config", "demo"}

	cases := map[string]*enginepolling.PollEngine{
		"nil engine":  nil,
		"real engine": newEngine(),
	}
	for name, engine := range cases {
		t.Run(name, func(t *testing.T) {
			h := PollEngineHandlers(engine)
			if len(h) != len(wantKeys) {
				t.Errorf("handler count = %d, want %d", len(h), len(wantKeys))
			}
			for _, k := range wantKeys {
				fn, ok := h[k]
				if !ok {
					t.Errorf("missing handler %q", k)
					continue
				}
				if fn == nil {
					t.Errorf("handler %q is nil", k)
				}
			}
		})
	}
}

func TestPollEngineHandlers_NilEngineGracefulGET(t *testing.T) {
	h := PollEngineHandlers(nil)
	tests := []struct {
		name   string
		key    string
		target string
	}{
		{"status", "status", "/polling/status"},
		{"decisions", "decisions", "/polling/decisions?vin=X"},
		{"predictions", "predictions", "/polling/predictions"},
		{"savings", "savings", "/polling/savings"},
		{"config", "config", "/polling/config"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := doRequest(t, h[tt.key], http.MethodGet, tt.target)
			if rec.Code != http.StatusOK {
				t.Errorf("code = %d, want 200", rec.Code)
			}
			if !json.Valid(rec.Body.Bytes()) {
				t.Errorf("invalid JSON body: %q", rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
		})
	}
}

// ── status ────────────────────────────────────────────────────────────────────

func TestPollEngineStatus(t *testing.T) {
	t.Run("nil engine reports disabled with empty vehicles", func(t *testing.T) {
		rec := doRequest(t, pollEngineStatus(nil), http.MethodGet, "/polling/status")
		if rec.Code != http.StatusOK {
			t.Fatalf("code = %d, want 200", rec.Code)
		}
		body := decodeJSON(t, rec)
		if body["enabled"] != false {
			t.Errorf("enabled = %v, want false", body["enabled"])
		}
		vehicles, ok := body["vehicles"].(map[string]interface{})
		if !ok {
			t.Fatalf("vehicles not an object: %v", body["vehicles"])
		}
		if len(vehicles) != 0 {
			t.Errorf("vehicles len = %d, want 0", len(vehicles))
		}
	})

	t.Run("real engine with no vehicles reports enabled", func(t *testing.T) {
		rec := doRequest(t, pollEngineStatus(newEngine()), http.MethodGet, "/polling/status")
		body := decodeJSON(t, rec)
		if body["enabled"] != true {
			t.Errorf("enabled = %v, want true", body["enabled"])
		}
		vehicles, ok := body["vehicles"].(map[string]interface{})
		if !ok {
			t.Fatalf("vehicles not an object: %v", body["vehicles"])
		}
		if len(vehicles) != 0 {
			t.Errorf("vehicles len = %d, want 0", len(vehicles))
		}
	})

	t.Run("driving vehicle surfaces activity and profile", func(t *testing.T) {
		engine := newEngine()
		engine.Assess("VINDRV", drivingVehicleData("VINDRV"))

		rec := doRequest(t, pollEngineStatus(engine), http.MethodGet, "/polling/status")
		body := decodeJSON(t, rec)
		vehicles, ok := body["vehicles"].(map[string]interface{})
		if !ok {
			t.Fatalf("vehicles not an object: %v", body["vehicles"])
		}
		v, ok := vehicles["VINDRV"].(map[string]interface{})
		if !ok {
			t.Fatalf("VINDRV entry missing: %v", vehicles)
		}
		if v["activity"] != "active" {
			t.Errorf("activity = %v, want active", v["activity"])
		}
		if v["profile"] != "driving" {
			t.Errorf("profile = %v, want driving", v["profile"])
		}
		if _, ok := v["last_decision"].(map[string]interface{}); !ok {
			t.Errorf("last_decision should be an object, got %v", v["last_decision"])
		}
		if _, present := v["consec_idle"]; !present {
			t.Errorf("consec_idle field missing")
		}
	})
}

// ── decisions ─────────────────────────────────────────────────────────────────

func TestPollEngineDecisions_NilEngine(t *testing.T) {
	rec := doRequest(t, pollEngineDecisions(nil), http.MethodGet, "/polling/decisions?vin=ABC")
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	body := decodeJSON(t, rec)
	decs, ok := body["decisions"].([]interface{})
	if !ok {
		t.Fatalf("decisions should be an array, got %v", body["decisions"])
	}
	if len(decs) != 0 {
		t.Errorf("decisions len = %d, want 0", len(decs))
	}
}

func TestPollEngineDecisions_MissingVIN(t *testing.T) {
	rec := doRequest(t, pollEngineDecisions(newEngine()), http.MethodGet, "/polling/decisions")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	body := decodeJSON(t, rec)
	if msg, _ := body["error"].(string); msg == "" {
		t.Errorf("error message should be non-empty, got %v", body["error"])
	}
	if body["code"] != "BAD_REQUEST" {
		t.Errorf("code = %v, want BAD_REQUEST", body["code"])
	}
}

func TestPollEngineDecisions_LimitParsing(t *testing.T) {
	engine := newEngine()
	const vin = "VINDEC"
	for i := 0; i < 5; i++ {
		engine.Assess(vin, idleVehicleData(vin))
	}

	tests := []struct {
		name      string
		query     string
		wantCount int
	}{
		{"default limit returns all", "vin=" + vin, 5},
		{"limit larger than history returns all", "vin=" + vin + "&limit=100", 5},
		{"limit equal to history returns all", "vin=" + vin + "&limit=5", 5},
		{"limit two returns last two", "vin=" + vin + "&limit=2", 2},
		{"limit one returns last one", "vin=" + vin + "&limit=1", 1},
		{"zero limit falls back to default", "vin=" + vin + "&limit=0", 5},
		{"negative limit falls back to default", "vin=" + vin + "&limit=-3", 5},
		{"non-numeric limit falls back to default", "vin=" + vin + "&limit=abc", 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := doRequest(t, pollEngineDecisions(engine), http.MethodGet, "/polling/decisions?"+tt.query)
			if rec.Code != http.StatusOK {
				t.Fatalf("code = %d, want 200", rec.Code)
			}
			body := decodeJSON(t, rec)
			if body["vin"] != vin {
				t.Errorf("vin = %v, want %s", body["vin"], vin)
			}
			decs, ok := body["decisions"].([]interface{})
			if !ok {
				t.Fatalf("decisions should be an array, got %v", body["decisions"])
			}
			if len(decs) != tt.wantCount {
				t.Errorf("decisions len = %d, want %d", len(decs), tt.wantCount)
			}
		})
	}
}

func TestPollEngineDecisions_UnknownVINReturnsEmptyArray(t *testing.T) {
	rec := doRequest(t, pollEngineDecisions(newEngine()), http.MethodGet, "/polling/decisions?vin=GHOST")
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	body := decodeJSON(t, rec)
	if body["vin"] != "GHOST" {
		t.Errorf("vin = %v, want GHOST", body["vin"])
	}
	// Null-safety: unknown VIN must return [] (not null) so the SPA can .map() it.
	decs, ok := body["decisions"].([]interface{})
	if !ok {
		t.Fatalf("decisions should be an empty array, not null: %v", body["decisions"])
	}
	if len(decs) != 0 {
		t.Errorf("decisions len = %d, want 0", len(decs))
	}
}

// ── predictions ───────────────────────────────────────────────────────────────

func TestPollEnginePredictions_NilEngine(t *testing.T) {
	rec := doRequest(t, pollEnginePredictions(nil), http.MethodGet, "/polling/predictions")
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	body := decodeJSON(t, rec)
	v, present := body["predictions"]
	if !present {
		t.Errorf("predictions key should be present")
	}
	if v != nil {
		t.Errorf("predictions = %v, want null", v)
	}
}

func TestPollEnginePredictions_AggregateEmpty(t *testing.T) {
	rec := doRequest(t, pollEnginePredictions(newEngine()), http.MethodGet, "/polling/predictions")
	body := decodeJSON(t, rec)
	preds, ok := body["predictions"].(map[string]interface{})
	if !ok {
		t.Fatalf("predictions should be an object, got %v", body["predictions"])
	}
	if len(preds) != 0 {
		t.Errorf("predictions len = %d, want 0", len(preds))
	}
}

func TestPollEnginePredictions_AggregateExcludesNilPrediction(t *testing.T) {
	engine := newEngine()
	// A vehicle assessed without a predictor has a decision but no prediction,
	// so it must be excluded from the aggregate map.
	engine.Assess("VINP", idleVehicleData("VINP"))

	rec := doRequest(t, pollEnginePredictions(engine), http.MethodGet, "/polling/predictions")
	body := decodeJSON(t, rec)
	preds, ok := body["predictions"].(map[string]interface{})
	if !ok {
		t.Fatalf("predictions should be an object, got %v", body["predictions"])
	}
	if len(preds) != 0 {
		t.Errorf("predictions len = %d, want 0 (nil prediction excluded)", len(preds))
	}
}

func TestPollEnginePredictions_UnknownVIN(t *testing.T) {
	rec := doRequest(t, pollEnginePredictions(newEngine()), http.MethodGet, "/polling/predictions?vin=GHOST")
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	body := decodeJSON(t, rec)
	if body["vin"] != "GHOST" {
		t.Errorf("vin = %v, want GHOST", body["vin"])
	}
	v, present := body["prediction"]
	if !present {
		t.Errorf("prediction key should be present")
	}
	if v != nil {
		t.Errorf("prediction = %v, want null", v)
	}
}

func TestPollEnginePredictions_KnownVINWithoutPrediction(t *testing.T) {
	engine := newEngine()
	engine.Assess("VINF", idleVehicleData("VINF"))

	rec := doRequest(t, pollEnginePredictions(engine), http.MethodGet, "/polling/predictions?vin=VINF")
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	body := decodeJSON(t, rec)
	if body["vin"] != "VINF" {
		t.Errorf("vin = %v, want VINF", body["vin"])
	}
	v, present := body["prediction"]
	if !present {
		t.Errorf("prediction key should be present")
	}
	// No predictor is wired, so the last decision carries a nil prediction.
	if v != nil {
		t.Errorf("prediction = %v, want null", v)
	}
}

// ── savings ───────────────────────────────────────────────────────────────────

func TestPollEngineSavings_NilEngine(t *testing.T) {
	rec := doRequest(t, pollEngineSavings(nil), http.MethodGet, "/polling/savings")
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	body := decodeJSON(t, rec)
	if got, _ := body["polls_made"].(float64); got != 0 {
		t.Errorf("polls_made = %v, want 0", body["polls_made"])
	}
	if got, _ := body["savings_percent"].(float64); got != 0 {
		t.Errorf("savings_percent = %v, want 0", body["savings_percent"])
	}
}

func TestPollEngineSavings_WithRecordedData(t *testing.T) {
	engine := newEngine()
	ct := engine.CostTracker()
	ct.RecordPoll()
	ct.RecordPoll()
	ct.RecordSkip("idle")
	ct.RecordSkip("fleet_telemetry")
	for i := 0; i < 4; i++ {
		ct.RecordBaselineTick()
	}

	rec := doRequest(t, pollEngineSavings(engine), http.MethodGet, "/polling/savings")
	body := decodeJSON(t, rec)

	if got, _ := body["polls_made"].(float64); got != 2 {
		t.Errorf("polls_made = %v, want 2", body["polls_made"])
	}
	if got, _ := body["polls_saved"].(float64); got != 2 {
		t.Errorf("polls_saved = %v, want 2", body["polls_saved"])
	}
	if got, _ := body["savings_percent"].(float64); got != 50 {
		t.Errorf("savings_percent = %v, want 50", body["savings_percent"])
	}
	breakdown, ok := body["savings_breakdown"].(map[string]interface{})
	if !ok {
		t.Fatalf("savings_breakdown should be an object, got %v", body["savings_breakdown"])
	}
	if got, _ := breakdown["idle_detection"].(float64); got != 1 {
		t.Errorf("idle_detection = %v, want 1", breakdown["idle_detection"])
	}
	if got, _ := breakdown["fleet_telemetry"].(float64); got != 1 {
		t.Errorf("fleet_telemetry = %v, want 1", breakdown["fleet_telemetry"])
	}
}

// ── config ────────────────────────────────────────────────────────────────────

func TestPollEngineConfig(t *testing.T) {
	t.Run("nil engine reports disabled", func(t *testing.T) {
		rec := doRequest(t, pollEngineConfig(nil), http.MethodGet, "/polling/config")
		if rec.Code != http.StatusOK {
			t.Fatalf("code = %d, want 200", rec.Code)
		}
		body := decodeJSON(t, rec)
		if body["enabled"] != false {
			t.Errorf("enabled = %v, want false", body["enabled"])
		}
	})

	t.Run("real engine reports evaluators", func(t *testing.T) {
		rec := doRequest(t, pollEngineConfig(newEngine()), http.MethodGet, "/polling/config")
		body := decodeJSON(t, rec)
		if body["enabled"] != true {
			t.Errorf("enabled = %v, want true", body["enabled"])
		}
		if body["engine"] != "adaptive_polling_v1" {
			t.Errorf("engine = %v, want adaptive_polling_v1", body["engine"])
		}
		evals, ok := body["evaluators"].([]interface{})
		if !ok {
			t.Fatalf("evaluators should be an array, got %v", body["evaluators"])
		}
		if len(evals) != 5 {
			t.Errorf("evaluators len = %d, want 5", len(evals))
		}
	})
}

// ── demo ──────────────────────────────────────────────────────────────────────

func TestPollEngineDemo(t *testing.T) {
	t.Run("nil engine returns 400", func(t *testing.T) {
		rec := doRequest(t, pollEngineDemo(nil), http.MethodPost, "/polling/demo")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("code = %d, want 400", rec.Code)
		}
		body := decodeJSON(t, rec)
		if body["code"] != "BAD_REQUEST" {
			t.Errorf("code = %v, want BAD_REQUEST", body["code"])
		}
	})

	t.Run("non-POST method returns 405", func(t *testing.T) {
		rec := doRequest(t, pollEngineDemo(newEngine()), http.MethodGet, "/polling/demo")
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("code = %d, want 405", rec.Code)
		}
		body := decodeJSON(t, rec)
		if body["code"] != "METHOD_NOT_ALLOWED" {
			t.Errorf("code = %v, want METHOD_NOT_ALLOWED", body["code"])
		}
	})

	t.Run("POST seeds deterministic demo data", func(t *testing.T) {
		engine := newEngine()
		rec := doRequest(t, pollEngineDemo(engine), http.MethodPost, "/polling/demo")
		if rec.Code != http.StatusOK {
			t.Fatalf("code = %d, want 200", rec.Code)
		}
		body := decodeJSON(t, rec)
		if body["message"] != "demo data seeded" {
			t.Errorf("message = %v, want 'demo data seeded'", body["message"])
		}
		const wantVIN = "5YJ3E1EA7PF000001"
		if body["vin"] != wantVIN {
			t.Errorf("vin = %v, want %s", body["vin"], wantVIN)
		}

		// The endpoint must actually mutate engine state, not just echo a message.
		states := engine.GetAllVehicleStates()
		if _, ok := states[wantVIN]; !ok {
			t.Errorf("demo VIN %s not registered in engine state", wantVIN)
		}
		snap := engine.CostTracker().Snapshot()
		if snap.PollsMade != 3 {
			t.Errorf("polls_made = %d, want 3 (three Assess calls)", snap.PollsMade)
		}
		if snap.PollsSaved != 47 {
			t.Errorf("polls_saved = %d, want 47 (20+15+8+4 skips)", snap.PollsSaved)
		}
	})
}

// ── concurrency / race coverage ───────────────────────────────────────────────

// TestPollEngineStatus_ConcurrentAccess exercises the read handler against a
// live engine while other goroutines mutate it, validating thread-safety under
// -race. The engine guards its state with an RWMutex; the handler must not
// observe torn reads or panic.
func TestPollEngineStatus_ConcurrentAccess(t *testing.T) {
	engine := newEngine()
	handler := pollEngineStatus(engine)

	const workers = 16
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		vin := fmt.Sprintf("VIN%02d", i)
		wg.Add(2)
		go func(v string) {
			defer wg.Done()
			engine.Assess(v, idleVehicleData(v))
		}(vin)
		go func() {
			defer wg.Done()
			rec := doRequest(t, handler, http.MethodGet, "/polling/status")
			if rec.Code != http.StatusOK {
				t.Errorf("concurrent status code = %d, want 200", rec.Code)
			}
		}()
	}
	wg.Wait()

	rec := doRequest(t, handler, http.MethodGet, "/polling/status")
	body := decodeJSON(t, rec)
	vehicles, ok := body["vehicles"].(map[string]interface{})
	if !ok {
		t.Fatalf("vehicles not an object: %v", body["vehicles"])
	}
	if len(vehicles) != workers {
		t.Errorf("vehicles len = %d, want %d", len(vehicles), workers)
	}
}
