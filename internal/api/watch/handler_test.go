package watch

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiauthctx"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/redis/go-redis/v9"
)

// ---------------------------------------------------------------------------
// Test doubles for the narrow port interfaces the watch handlers depend on.
// ---------------------------------------------------------------------------

type fakeVehicleRepo struct {
	byID       map[int64]*vehiclemodel.Vehicle
	all        []*vehiclemodel.Vehicle
	getByIDErr error
	getAllErr  error
}

func (f *fakeVehicleRepo) GetByID(_ context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	if f.getByIDErr != nil {
		return nil, f.getByIDErr
	}
	return f.byID[id], nil
}

func (f *fakeVehicleRepo) GetAll(_ context.Context) ([]*vehiclemodel.Vehicle, error) {
	if f.getAllErr != nil {
		return nil, f.getAllErr
	}
	return f.all, nil
}

type fakeSettings struct {
	suspended bool
	err       error
}

func (f *fakeSettings) IsAPISuspended(_ context.Context) (bool, error) {
	return f.suspended, f.err
}

type fakeTesla struct {
	validToken  bool
	sendErr     error
	sentVIN     string
	sentCommand string
	sentCount   int
}

func (f *fakeTesla) HasValidToken() bool { return f.validToken }

func (f *fakeTesla) SendCommand(_ context.Context, vin, command string, _ map[string]interface{}) error {
	f.sentCount++
	f.sentVIN = vin
	f.sentCommand = command
	return f.sendErr
}

type fakeSignal struct {
	signals map[string]interface{}
	err     error
}

func (f *fakeSignal) GetAll(_ context.Context, _ int64) (map[string]interface{}, error) {
	return f.signals, f.err
}

func newTestHandler(vr vehicleReader, sr settingsReader, tc teslaCommander, rc signalReader) *Handler {
	return &Handler{vehicleRepo: vr, settingsRepo: sr, teslaClient: tc, redisCache: rc}
}

func almostEqual(a, b float64) bool { return math.Abs(a-b) < 0.001 }

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

func TestStateEmoji(t *testing.T) {
	tests := []struct {
		name  string
		state string
		want  string
	}{
		{"online", "online", "🟢"},
		{"asleep", "asleep", "😴"},
		{"driving", "driving", "🚗"},
		{"charging", "charging", "⚡"},
		{"unknown", "unknown", "⚫"},
		{"empty", "", "⚫"},
		{"garbage", "not-a-state", "⚫"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stateEmoji(tt.state); got != tt.want {
				t.Errorf("stateEmoji(%q) = %q, want %q", tt.state, got, tt.want)
			}
		})
	}
}

func TestToFloatOk(t *testing.T) {
	tests := []struct {
		name   string
		in     interface{}
		want   float64
		wantOk bool
	}{
		{"float64", float64(3.5), 3.5, true},
		{"float32", float32(2.5), 2.5, true},
		{"int", 7, 7, true},
		{"int64", int64(9), 9, true},
		{"numeric string", "12.25", 12.25, true},
		{"bool true", true, 1, true},
		{"bool false", false, 0, true},
		{"nil", nil, 0, false},
		{"empty string", "", 0, false},
		{"non-numeric string", "abc", 0, false},
		{"unsupported struct", struct{}{}, 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := toFloatOk(tt.in)
			if ok != tt.wantOk || (ok && !almostEqual(got, tt.want)) {
				t.Errorf("toFloatOk(%v) = (%v, %v), want (%v, %v)", tt.in, got, ok, tt.want, tt.wantOk)
			}
		})
	}
}

func TestSignalFloat(t *testing.T) {
	tests := []struct {
		name    string
		signals map[string]interface{}
		keys    []string
		want    float64
		wantOk  bool
	}{
		{"present numeric", map[string]interface{}{"a": float64(4)}, []string{"a"}, 4, true},
		{"missing key", map[string]interface{}{"a": float64(4)}, []string{"b"}, 0, false},
		{"second key wins when first absent", map[string]interface{}{"b": float64(9)}, []string{"a", "b"}, 9, true},
		// signalFloat returns as soon as a key EXISTS, even if unparseable — it
		// does NOT fall through to the next key.
		{"first existing but unparseable stops search", map[string]interface{}{"a": "x", "b": float64(9)}, []string{"a", "b"}, 0, false},
		{"numeric string", map[string]interface{}{"a": "3.5"}, []string{"a"}, 3.5, true},
		{"no keys", map[string]interface{}{"a": float64(4)}, nil, 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := signalFloat(tt.signals, tt.keys...)
			if ok != tt.wantOk || (ok && !almostEqual(got, tt.want)) {
				t.Errorf("signalFloat(%v) = (%v, %v), want (%v, %v)", tt.keys, got, ok, tt.want, tt.wantOk)
			}
		})
	}
}

func TestSignalInt(t *testing.T) {
	tests := []struct {
		name    string
		signals map[string]interface{}
		keys    []string
		want    int
		wantOk  bool
	}{
		{"present float", map[string]interface{}{"a": float64(85)}, []string{"a"}, 85, true},
		{"truncates", map[string]interface{}{"a": float64(85.9)}, []string{"a"}, 85, true},
		{"missing", map[string]interface{}{}, []string{"a"}, 0, false},
		// signalInt DOES fall through: a present-but-unparseable first key is
		// skipped in favour of a later numeric key.
		{"skips unparseable and uses next", map[string]interface{}{"a": "x", "b": float64(5)}, []string{"a", "b"}, 5, true},
		{"numeric string", map[string]interface{}{"a": "42"}, []string{"a"}, 42, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := signalInt(tt.signals, tt.keys...)
			if got != tt.want || ok != tt.wantOk {
				t.Errorf("signalInt(%v) = (%v, %v), want (%v, %v)", tt.keys, got, ok, tt.want, tt.wantOk)
			}
		})
	}
}

func TestSignalStr(t *testing.T) {
	tests := []struct {
		name    string
		signals map[string]interface{}
		keys    []string
		want    string
		wantOk  bool
	}{
		{"present non-empty", map[string]interface{}{"a": "hi"}, []string{"a"}, "hi", true},
		{"empty string skipped", map[string]interface{}{"a": ""}, []string{"a"}, "", false},
		{"non-string skipped", map[string]interface{}{"a": float64(1)}, []string{"a"}, "", false},
		{"first non-empty wins", map[string]interface{}{"a": "", "b": "yes"}, []string{"a", "b"}, "yes", true},
		{"missing", map[string]interface{}{}, []string{"a"}, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := signalStr(tt.signals, tt.keys...)
			if got != tt.want || ok != tt.wantOk {
				t.Errorf("signalStr(%v) = (%q, %v), want (%q, %v)", tt.keys, got, ok, tt.want, tt.wantOk)
			}
		})
	}
}

func TestWatchCommandsWhitelist(t *testing.T) {
	allowed := []string{"lock", "unlock", "climate_on", "climate_off",
		"charge_start", "charge_stop", "flash_lights", "honk_horn"}
	for _, cmd := range allowed {
		if !watchCommands[cmd] {
			t.Errorf("command %q should be allowed from a watch", cmd)
		}
	}
	if len(watchCommands) != 8 {
		t.Errorf("watchCommands has %d entries, want 8", len(watchCommands))
	}
	// Dangerous / non-watch commands must never be in the reduced whitelist.
	rejected := []string{"wake_up", "erase_user_data", "remote_start_drive", "set_charge_limit", "sudo", ""}
	for _, cmd := range rejected {
		if watchCommands[cmd] {
			t.Errorf("command %q should NOT be allowed from a watch", cmd)
		}
	}
}

// ---------------------------------------------------------------------------
// resolveWatchVehicleID
// ---------------------------------------------------------------------------

func TestResolveWatchVehicleID(t *testing.T) {
	tests := []struct {
		name    string
		query   string
		repo    *fakeVehicleRepo
		want    int64
		wantErr string
	}{
		{"explicit valid id", "vehicle_id=42", &fakeVehicleRepo{}, 42, ""},
		{"invalid non-numeric", "vehicle_id=abc", &fakeVehicleRepo{}, 0, "invalid vehicle_id"},
		{"zero rejected", "vehicle_id=0", &fakeVehicleRepo{}, 0, "invalid vehicle_id"},
		{"negative rejected", "vehicle_id=-3", &fakeVehicleRepo{}, 0, "invalid vehicle_id"},
		{"fallback to first vehicle", "", &fakeVehicleRepo{all: []*vehiclemodel.Vehicle{{ID: 7}, {ID: 8}}}, 7, ""},
		{"no vehicles", "", &fakeVehicleRepo{all: nil}, 0, "no vehicles found"},
		{"repo error", "", &fakeVehicleRepo{getAllErr: errors.New("db down")}, 0, "no vehicles found"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/watch/summary?"+tt.query, nil)
			got, err := resolveWatchVehicleID(req, tt.repo)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("want error containing %q, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("got id %d, want %d", got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// queryWatchSummary
// ---------------------------------------------------------------------------

func TestQueryWatchSummary_ErrorPaths(t *testing.T) {
	tests := []struct {
		name    string
		cache   signalReader
		wantErr string
	}{
		{"nil cache", nil, "redis signal cache not available"},
		{"cache error", &fakeSignal{err: errors.New("boom")}, "read redis signals"},
		{"nil signals", &fakeSignal{signals: nil}, "no signals for vehicle"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(nil, nil, nil, tt.cache)
			_, err := h.queryWatchSummary(context.Background(), 1)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("want error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestQueryWatchSummary_Fields(t *testing.T) {
	signals := map[string]interface{}{
		"BatteryLevel":          float64(85),
		"RatedRange":            float64(100), // miles → 160.934 km
		"InsideTemp":            float64(21.5),
		"OutsideTemp":           float64(15),
		"ChargeRateMilePerHour": float64(30),
		"TimeToFullCharge":      float64(2), // hours → 120 minutes
		"Locked":                false,
		"SentryMode":            true,
		"HvacPower":             "On",
		"ChargeState":           "Charging",
	}
	h := newTestHandler(nil, nil, nil, &fakeSignal{signals: signals})
	got, err := h.queryWatchSummary(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.BatteryLevel != 85 {
		t.Errorf("BatteryLevel = %d, want 85", got.BatteryLevel)
	}
	if !almostEqual(got.RangeKm, 160.934) {
		t.Errorf("RangeKm = %v, want ~160.934", got.RangeKm)
	}
	if !almostEqual(got.InsideTemp, 21.5) {
		t.Errorf("InsideTemp = %v, want 21.5", got.InsideTemp)
	}
	if !almostEqual(got.OutsideTemp, 15) {
		t.Errorf("OutsideTemp = %v, want 15", got.OutsideTemp)
	}
	if !almostEqual(got.ChargeRate, 30) {
		t.Errorf("ChargeRate = %v, want 30", got.ChargeRate)
	}
	if !almostEqual(got.TimeToFull, 120) {
		t.Errorf("TimeToFull = %v, want 120 (minutes)", got.TimeToFull)
	}
	if got.IsLocked {
		t.Error("IsLocked = true, want false")
	}
	if !got.SentryMode {
		t.Error("SentryMode = false, want true")
	}
	if !got.IsClimateOn {
		t.Error("IsClimateOn = false, want true")
	}
	if !got.IsCharging {
		t.Error("IsCharging = false, want true")
	}
	if got.LastUpdated == "" {
		t.Error("LastUpdated should be populated")
	}
}

func TestQueryWatchSummary_TypeVariants(t *testing.T) {
	tests := []struct {
		name    string
		signals map[string]interface{}
		check   func(*testing.T, *WatchSummary)
	}{
		{
			"locked as string true",
			map[string]interface{}{"Locked": "true"},
			func(t *testing.T, s *WatchSummary) {
				if !s.IsLocked {
					t.Error("locked string 'true' should map to IsLocked=true")
				}
			},
		},
		{
			"locked as float positive",
			map[string]interface{}{"Locked": float64(1)},
			func(t *testing.T, s *WatchSummary) {
				if !s.IsLocked {
					t.Error("locked float 1 should map to IsLocked=true")
				}
			},
		},
		{
			"locked default true when absent",
			map[string]interface{}{"BatteryLevel": float64(10)},
			func(t *testing.T, s *WatchSummary) {
				if !s.IsLocked {
					t.Error("IsLocked should default to true when Locked signal absent")
				}
			},
		},
		{
			"sentry as string On",
			map[string]interface{}{"SentryMode": "On"},
			func(t *testing.T, s *WatchSummary) {
				if !s.SentryMode {
					t.Error("sentry string 'On' should map to SentryMode=true")
				}
			},
		},
		{
			"hvac as bool",
			map[string]interface{}{"HvacPower": true},
			func(t *testing.T, s *WatchSummary) {
				if !s.IsClimateOn {
					t.Error("HvacPower bool true should map to IsClimateOn=true")
				}
			},
		},
		{
			"hvac as float",
			map[string]interface{}{"HvacPower": float64(1)},
			func(t *testing.T, s *WatchSummary) {
				if !s.IsClimateOn {
					t.Error("HvacPower float 1 should map to IsClimateOn=true")
				}
			},
		},
		{
			"charge state lowercase",
			map[string]interface{}{"ChargeState": "charging"},
			func(t *testing.T, s *WatchSummary) {
				if !s.IsCharging {
					t.Error("ChargeState 'charging' should map to IsCharging=true")
				}
			},
		},
		{
			"empty signals map yields zeros and locked default",
			map[string]interface{}{},
			func(t *testing.T, s *WatchSummary) {
				if s.BatteryLevel != 0 || s.IsCharging || !s.IsLocked {
					t.Errorf("empty map: got %+v, want zeros with IsLocked=true", s)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(nil, nil, nil, &fakeSignal{signals: tt.signals})
			got, err := h.queryWatchSummary(context.Background(), 1)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			tt.check(t, got)
		})
	}
}

// ---------------------------------------------------------------------------
// Summary handler
// ---------------------------------------------------------------------------

func TestHandlerSummary(t *testing.T) {
	updated := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	veh := &vehiclemodel.Vehicle{ID: 1, VIN: "VIN1", DisplayName: "My Tesla", UpdatedAt: updated}

	tests := []struct {
		name       string
		url        string
		repo       *fakeVehicleRepo
		cache      signalReader
		wantStatus int
		assert     func(*testing.T, *httptest.ResponseRecorder)
	}{
		{
			name:       "invalid vehicle id",
			url:        "/watch/summary?vehicle_id=abc",
			repo:       &fakeVehicleRepo{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "no vehicles found",
			url:        "/watch/summary",
			repo:       &fakeVehicleRepo{all: nil},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "vehicle not found",
			url:        "/watch/summary?vehicle_id=99",
			repo:       &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{}},
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "degraded fallback when no live state",
			url:        "/watch/summary?vehicle_id=1",
			repo:       &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{1: veh}},
			cache:      nil, // queryWatchSummary fails → fallback path
			wantStatus: http.StatusOK,
			assert: func(t *testing.T, rr *httptest.ResponseRecorder) {
				var s WatchSummary
				mustJSON(t, rr, &s)
				if s.VehicleName != "My Tesla" {
					t.Errorf("VehicleName = %q, want My Tesla", s.VehicleName)
				}
				if s.State != "unknown" {
					t.Errorf("State = %q, want unknown", s.State)
				}
				if !s.IsLocked {
					t.Error("degraded fallback should report IsLocked=true")
				}
				if s.LastUpdated != updated.Format(time.RFC3339) {
					t.Errorf("LastUpdated = %q, want %q", s.LastUpdated, updated.Format(time.RFC3339))
				}
			},
		},
		{
			name: "success with live state",
			url:  "/watch/summary?vehicle_id=1",
			repo: &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{1: veh}},
			cache: &fakeSignal{signals: map[string]interface{}{
				"BatteryLevel": float64(72),
				"RatedRange":   float64(50),
				"ChargeState":  "Charging",
			}},
			wantStatus: http.StatusOK,
			assert: func(t *testing.T, rr *httptest.ResponseRecorder) {
				var s WatchSummary
				mustJSON(t, rr, &s)
				if s.VehicleName != "My Tesla" {
					t.Errorf("VehicleName = %q, want My Tesla", s.VehicleName)
				}
				if s.BatteryLevel != 72 {
					t.Errorf("BatteryLevel = %d, want 72", s.BatteryLevel)
				}
				if !s.IsCharging {
					t.Error("IsCharging should be true")
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(tt.repo, &fakeSettings{}, &fakeTesla{}, tt.cache)
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			rr := httptest.NewRecorder()
			h.Summary(rr, req)
			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rr.Code, tt.wantStatus, rr.Body.String())
			}
			if tt.assert != nil {
				tt.assert(t, rr)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Complication handler
// ---------------------------------------------------------------------------

func TestHandlerComplication(t *testing.T) {
	veh := &vehiclemodel.Vehicle{ID: 1, VIN: "VIN1", DisplayName: "My Tesla"}

	tests := []struct {
		name       string
		url        string
		repo       *fakeVehicleRepo
		cache      signalReader
		wantStatus int
		assert     func(*testing.T, *httptest.ResponseRecorder)
	}{
		{
			name:       "invalid vehicle id",
			url:        "/watch/complication?vehicle_id=abc",
			repo:       &fakeVehicleRepo{},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "no live state and vehicle missing -> 404",
			url:        "/watch/complication?vehicle_id=5",
			repo:       &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{}},
			cache:      nil,
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "no live state but vehicle exists -> placeholder",
			url:        "/watch/complication?vehicle_id=1",
			repo:       &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{1: veh}},
			cache:      nil,
			wantStatus: http.StatusOK,
			assert: func(t *testing.T, rr *httptest.ResponseRecorder) {
				var c WatchComplication
				mustJSON(t, rr, &c)
				if c.Battery != "—" || c.Range != "—" {
					t.Errorf("placeholder battery/range = %q/%q, want —/—", c.Battery, c.Range)
				}
				if c.Charging {
					t.Error("placeholder Charging should be false")
				}
				if c.State != stateEmoji("unknown") {
					t.Errorf("placeholder State = %q, want %q", c.State, stateEmoji("unknown"))
				}
			},
		},
		{
			name: "success formats battery and range",
			url:  "/watch/complication?vehicle_id=1",
			repo: &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{1: veh}},
			cache: &fakeSignal{signals: map[string]interface{}{
				"BatteryLevel": float64(64),
				"RatedRange":   float64(100), // → 160 km (int-truncated)
				"ChargeState":  "Charging",
			}},
			wantStatus: http.StatusOK,
			assert: func(t *testing.T, rr *httptest.ResponseRecorder) {
				var c WatchComplication
				mustJSON(t, rr, &c)
				if c.Battery != "64%" {
					t.Errorf("Battery = %q, want 64%%", c.Battery)
				}
				if c.Range != "160km" {
					t.Errorf("Range = %q, want 160km", c.Range)
				}
				if !c.Charging {
					t.Error("Charging should be true")
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(tt.repo, &fakeSettings{}, &fakeTesla{}, tt.cache)
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			rr := httptest.NewRecorder()
			h.Complication(rr, req)
			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rr.Code, tt.wantStatus, rr.Body.String())
			}
			if tt.assert != nil {
				tt.assert(t, rr)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

func TestHandlerCommand(t *testing.T) {
	veh := &vehiclemodel.Vehicle{ID: 1, VIN: "VIN1", DisplayName: "My Tesla"}
	oneVehicleRepo := func() *fakeVehicleRepo {
		return &fakeVehicleRepo{
			byID: map[int64]*vehiclemodel.Vehicle{1: veh},
			all:  []*vehiclemodel.Vehicle{veh},
		}
	}

	tests := []struct {
		name        string
		perms       string // "" means no perms in context
		setPerms    bool
		body        string
		repo        *fakeVehicleRepo
		settings    *fakeSettings
		tesla       *fakeTesla
		wantStatus  int
		wantSuccess *bool
		wantSent    bool
		wantVIN     string
	}{
		{
			name:       "no permissions in context -> 403",
			setPerms:   false,
			body:       `{"vehicle_id":1,"command":"lock"}`,
			repo:       oneVehicleRepo(),
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "read-only permissions -> 403",
			setPerms:   true,
			perms:      "read",
			body:       `{"vehicle_id":1,"command":"lock"}`,
			repo:       oneVehicleRepo(),
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "api suspended -> 409",
			setPerms:   true,
			perms:      "admin",
			body:       `{"vehicle_id":1,"command":"lock"}`,
			repo:       oneVehicleRepo(),
			settings:   &fakeSettings{suspended: true},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusConflict,
		},
		{
			name:       "invalid json -> 400",
			setPerms:   true,
			perms:      "admin",
			body:       `{not-json`,
			repo:       oneVehicleRepo(),
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "empty command -> 400",
			setPerms:   true,
			perms:      "admin",
			body:       `{"vehicle_id":1,"command":""}`,
			repo:       oneVehicleRepo(),
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "unsupported command -> 400",
			setPerms:   true,
			perms:      "admin",
			body:       `{"vehicle_id":1,"command":"self_destruct"}`,
			repo:       oneVehicleRepo(),
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "vehicle_id 0 with no vehicles -> 400",
			setPerms:   true,
			perms:      "admin",
			body:       `{"command":"lock"}`,
			repo:       &fakeVehicleRepo{all: nil},
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "vehicle not found -> 404",
			setPerms:   true,
			perms:      "admin",
			body:       `{"vehicle_id":42,"command":"lock"}`,
			repo:       &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{}},
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: true},
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "not authenticated with tesla -> 401",
			setPerms:   true,
			perms:      "admin",
			body:       `{"vehicle_id":1,"command":"lock"}`,
			repo:       oneVehicleRepo(),
			settings:   &fakeSettings{},
			tesla:      &fakeTesla{validToken: false},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:        "command send failure -> 200 success=false",
			setPerms:    true,
			perms:       "admin",
			body:        `{"vehicle_id":1,"command":"lock"}`,
			repo:        oneVehicleRepo(),
			settings:    &fakeSettings{},
			tesla:       &fakeTesla{validToken: true, sendErr: errors.New("tesla offline")},
			wantStatus:  http.StatusOK,
			wantSuccess: boolPtr(false),
			wantSent:    true,
			wantVIN:     "VIN1",
		},
		{
			name:        "command success -> 200 success=true",
			setPerms:    true,
			perms:       "admin",
			body:        `{"vehicle_id":1,"command":"lock"}`,
			repo:        oneVehicleRepo(),
			settings:    &fakeSettings{},
			tesla:       &fakeTesla{validToken: true},
			wantStatus:  http.StatusOK,
			wantSuccess: boolPtr(true),
			wantSent:    true,
			wantVIN:     "VIN1",
		},
		{
			name:        "vehicle_id 0 resolves to first vehicle",
			setPerms:    true,
			perms:       "read-write",
			body:        `{"command":"climate_on"}`,
			repo:        oneVehicleRepo(),
			settings:    &fakeSettings{},
			tesla:       &fakeTesla{validToken: true},
			wantStatus:  http.StatusOK,
			wantSuccess: boolPtr(true),
			wantSent:    true,
			wantVIN:     "VIN1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(tt.repo, tt.settings, tt.tesla, nil)
			req := httptest.NewRequest(http.MethodPost, "/watch/command", strings.NewReader(tt.body))
			if tt.setPerms {
				req = req.WithContext(apiauthctx.WithPermissions(req.Context(), tt.perms))
			}
			rr := httptest.NewRecorder()
			h.Command(rr, req)

			if rr.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rr.Code, tt.wantStatus, rr.Body.String())
			}
			if tt.wantSuccess != nil {
				var resp map[string]interface{}
				mustJSON(t, rr, &resp)
				success, _ := resp["success"].(bool)
				if success != *tt.wantSuccess {
					t.Errorf("success = %v, want %v (body: %s)", success, *tt.wantSuccess, rr.Body.String())
				}
				if _, ok := resp["message"].(string); !ok {
					t.Error("response should carry a message string")
				}
			}
			if tt.wantSent && tt.tesla.sentCount != 1 {
				t.Errorf("SendCommand called %d times, want 1", tt.tesla.sentCount)
			}
			if !tt.wantSent && tt.tesla != nil && tt.tesla.sentCount != 0 {
				t.Errorf("SendCommand should NOT be called, called %d times", tt.tesla.sentCount)
			}
			if tt.wantVIN != "" && tt.tesla.sentVIN != tt.wantVIN {
				t.Errorf("sent VIN = %q, want %q", tt.tesla.sentVIN, tt.wantVIN)
			}
		})
	}
}

// TestCommand_AuthorizesViaSharedContextKey is a regression guard for the bug
// where the watch handler read the API-key permission scope with its own local
// context key type, which never matched the value the api middleware wrote —
// making every command 403. It must now be readable via the shared
// apiauthctx helpers.
func TestCommand_AuthorizesViaSharedContextKey(t *testing.T) {
	veh := &vehiclemodel.Vehicle{ID: 1, VIN: "VIN1"}
	repo := &fakeVehicleRepo{byID: map[int64]*vehiclemodel.Vehicle{1: veh}, all: []*vehiclemodel.Vehicle{veh}}
	tc := &fakeTesla{validToken: true}
	h := newTestHandler(repo, &fakeSettings{}, tc, nil)

	req := httptest.NewRequest(http.MethodPost, "/watch/command", strings.NewReader(`{"vehicle_id":1,"command":"lock"}`))
	req = req.WithContext(apiauthctx.WithPermissions(req.Context(), "admin"))
	rr := httptest.NewRecorder()
	h.Command(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("authorized admin key should reach the command path, got %d (body: %s)", rr.Code, rr.Body.String())
	}
	if tc.sentCount != 1 {
		t.Errorf("command should have been dispatched, sentCount=%d", tc.sentCount)
	}
}

// ---------------------------------------------------------------------------
// Construction / fluent setter
// ---------------------------------------------------------------------------

func TestNewHandlerWiring(t *testing.T) {
	h := NewHandler(nil, nil)
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.vehicleRepo == nil {
		t.Error("vehicleRepo should be wired")
	}
	if h.settingsRepo == nil {
		t.Error("settingsRepo should be wired")
	}
	if h.redisCache != nil {
		t.Error("redisCache should be nil until WithRedisCache is called")
	}
}

func TestWithRedisCache(t *testing.T) {
	t.Run("nil cache is ignored (graceful degrade preserved)", func(t *testing.T) {
		h := &Handler{}
		got := h.WithRedisCache(nil)
		if got != h {
			t.Error("WithRedisCache should return the receiver for chaining")
		}
		if h.redisCache != nil {
			t.Error("nil cache must leave redisCache as a nil interface")
		}
		// The graceful path must still trigger.
		if _, err := h.queryWatchSummary(context.Background(), 1); err == nil ||
			!strings.Contains(err.Error(), "not available") {
			t.Errorf("expected 'not available' error with nil cache, got %v", err)
		}
	})

	t.Run("non-nil cache is stored", func(t *testing.T) {
		h := &Handler{}
		cache := signal.NewRedisSignalCache(redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"}))
		h.WithRedisCache(cache)
		if h.redisCache == nil {
			t.Error("non-nil cache should be stored")
		}
	})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func mustJSON(t *testing.T, rr *httptest.ResponseRecorder, v interface{}) {
	t.Helper()
	if ct := rr.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if err := json.Unmarshal(rr.Body.Bytes(), v); err != nil {
		t.Fatalf("decode response: %v (body: %s)", err, rr.Body.String())
	}
}

func boolPtr(b bool) *bool { return &b }
