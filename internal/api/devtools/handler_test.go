// Tests for the enriched dev-tools redis-signals
// endpoint and the new redis-signals/keys companion. These exercise the
// branches the Redis Signal Viewer's structured empty-state diagnostic
// depends on (mode-local, hybrid+L1-only, hybrid+populated, missing
// vehicle_id, no Redis cache wired).
package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func newTestDevToolsHandler(t *testing.T, mode string, withCache bool, withStore bool) (*DevToolsHandler, *miniredis.Miniredis, *signal.Store) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cfg := &config.Config{}
	cfg.FleetTelemetry.LiveSignalStoreMode = mode

	h := &DevToolsHandler{cfg: cfg}
	if withCache {
		h.redisCache = signal.NewRedisSignalCache(rdb)
	}
	var store *signal.Store
	if withStore {
		store = signal.New()
		h.signalStore = store
	}
	return h, mr, store
}

func TestFleetTelemetryFieldWithPolicyPreservesRequestedIntervalAndCounterPair(t *testing.T) {
	t.Parallel()

	field := fleetTelemetryFieldWithPolicy("MilesSinceReset", 37)
	if field.IntervalSeconds != 37 {
		t.Errorf("interval = %d, want requested 37 seconds", field.IntervalSeconds)
	}
	if field.MinimumDelta == nil || *field.MinimumDelta != 0.01 {
		t.Errorf("minimum_delta = %v, want 0.01", field.MinimumDelta)
	}
	if len(field.IncludeFields) != 1 || field.IncludeFields[0] != "SelfDrivingMilesSinceReset" {
		t.Errorf("include_fields = %v", field.IncludeFields)
	}
}

func TestRedisSignals_503WhenNoRedis(t *testing.T) {
	h, _, _ := newTestDevToolsHandler(t, "hybrid", false, false)

	req := httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=1", nil)
	w := httptest.NewRecorder()
	h.RedisSignals(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestRedisSignals_400OnBadVehicleID(t *testing.T) {
	tests := []struct {
		name  string
		query string
	}{
		{"missing", ""},
		{"non-numeric", "?vehicle_id=abc"},
		{"zero", "?vehicle_id=0"},
		{"negative", "?vehicle_id=-3"},
		{"fractional", "?vehicle_id=1.5"},
		{"overflow", "?vehicle_id=9223372036854775808"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h, _, _ := newTestDevToolsHandler(t, "hybrid", true, false)
			req := httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals"+tc.query, nil)
			w := httptest.NewRecorder()
			h.RedisSignals(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("%s: status = %d, want 400", tc.name, w.Code)
			}
		})
	}
}

func TestRedisSignals_UnknownL1DiffersFromMeasuredZero(t *testing.T) {
	for _, withStore := range []bool{false, true} {
		t.Run(strconv.FormatBool(withStore), func(t *testing.T) {
			h, _, _ := newTestDevToolsHandler(t, "hybrid", true, withStore)
			w := httptest.NewRecorder()
			h.RedisSignals(w, httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=7", nil))
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
			}
			var resp struct {
				Meta redisSignalsMeta `json:"meta"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
			if (resp.Meta.L1SignalCount != nil) != withStore {
				t.Fatalf("l1_signal_count = %v, withStore = %v", resp.Meta.L1SignalCount, withStore)
			}
			if withStore && *resp.Meta.L1SignalCount != 0 {
				t.Fatalf("measured L1 count = %d, want 0", *resp.Meta.L1SignalCount)
			}
			var wire struct {
				Meta map[string]json.RawMessage `json:"meta"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &wire); err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"l1_last_seen_at", "l2_last_seen_at"} {
				if string(wire.Meta[field]) != "null" {
					t.Errorf("%s = %s, want explicit null", field, wire.Meta[field])
				}
			}
			if string(wire.Meta["redis_field_count"]) != "0" {
				t.Errorf("measured Redis count = %s, want 0", wire.Meta["redis_field_count"])
			}
		})
	}
}

func TestRedisSignals_PreservesScalarValuesAndUnknownFreshness(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	values := map[string]string{
		"zero": "0", "negative": "-42", "signed": "+42",
		"fractional": "-0.125", "positive_fractional": "1.75",
		"empty": "", "invalid_number": "not-a-number",
	}
	for name, value := range values {
		mr.HSet("vehicle:7:signals", name, value)
	}
	w := httptest.NewRecorder()
	h.RedisSignals(w, httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=7", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Signals map[string]struct {
			Value interface{} `json:"value"`
			Type  string      `json:"type"`
		} `json:"signals"`
		Meta redisSignalsMeta `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]float64{
		"zero": 0, "negative": -42, "signed": 42,
		"fractional": -0.125, "positive_fractional": 1.75,
	} {
		got := resp.Signals[name]
		if got.Type != "number" || got.Value != want {
			t.Errorf("%s = %+v, want number %v", name, got, want)
		}
	}
	for _, name := range []string{"empty", "invalid_number"} {
		got := resp.Signals[name]
		if got.Type != "string" || got.Value != values[name] {
			t.Errorf("%s = %+v, want unchanged string %q", name, got, values[name])
		}
	}
	if _, exists := resp.Signals["missing"]; exists {
		t.Error("missing signal fabricated")
	}
	if resp.Meta.L2LastSeenAt != nil {
		t.Errorf("legacy freshness = %v, want unknown", resp.Meta.L2LastSeenAt)
	}
}

func TestRedisSignals_PreservesTypedNumericValues(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	tests := []struct {
		name  string
		kind  protomodel.ValueKind
		value interface{}
	}{
		{"int32_zero", protomodel.ValueKindInt32, int32(0)},
		{"int32_negative", protomodel.ValueKindInt32, int32(-42)},
		{"int32_positive", protomodel.ValueKindInt32, int32(42)},
		{"int64_zero", protomodel.ValueKindInt64, int64(0)},
		{"int64_negative", protomodel.ValueKindInt64, int64(-4294967296)},
		{"int64_positive", protomodel.ValueKindInt64, int64(4294967296)},
		{"float_zero", protomodel.ValueKindFloat, float32(0)},
		{"float_negative", protomodel.ValueKindFloat, float32(-0.125)},
		{"float_positive", protomodel.ValueKindFloat, float32(1.75)},
		{"double_zero", protomodel.ValueKindDouble, float64(0)},
		{"double_negative", protomodel.ValueKindDouble, float64(-0.125)},
		{"double_positive", protomodel.ValueKindDouble, float64(1.75)},
		{"boolean_false", protomodel.ValueKindBool, false},
		{"boolean_true", protomodel.ValueKindBool, true},
		{"string_zero", protomodel.ValueKindString, "0"},
		{"string_empty", protomodel.ValueKindString, ""},
		{"string_invalid", protomodel.ValueKindString, "not-a-number"},
		{"enum_numeric", protomodel.ValueKindEnum, "42"},
	}
	for _, tc := range tests {
		encoded, err := json.Marshal(struct {
			Kind protomodel.ValueKind `json:"kind"`
			V    interface{}          `json:"v"`
			TS   int64                `json:"ts"`
		}{tc.kind, tc.value, time.Now().UnixNano()})
		if err != nil {
			t.Fatal(err)
		}
		mr.HSet("vehicle:7:signals", tc.name, string(encoded))
	}
	w := httptest.NewRecorder()
	h.RedisSignals(w, httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=7", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Signals map[string]struct {
			Value json.RawMessage `json:"value"`
			Type  string          `json:"type"`
		} `json:"signals"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			wantType := "number"
			switch tc.kind {
			case protomodel.ValueKindBool:
				wantType = "boolean"
			case protomodel.ValueKindString, protomodel.ValueKindEnum:
				wantType = "string"
			}
			want, err := json.Marshal(tc.value)
			if err != nil {
				t.Fatal(err)
			}
			got, exists := resp.Signals[tc.name]
			if !exists || got.Type != wantType || string(got.Value) != string(want) {
				t.Errorf("%s = %+v (exists=%v), want %s %s", tc.name, got, exists, wantType, want)
			}
		})
	}
	if len(resp.Signals) != len(tests) {
		t.Errorf("signal count = %d, want %d", len(resp.Signals), len(tests))
	}
	if _, exists := resp.Signals["missing"]; exists {
		t.Error("missing signal fabricated")
	}
}

func TestRedisSignals_PerValueFreshnessPreservesStaleAndLegacyValues(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	now := time.Now().UTC()
	tests := []struct {
		name       string
		raw        string
		value      string
		observedAt *time.Time
		freshness  string
	}{
		{"fresh", "", "42", &now, "fresh"},
		{"stale", "", "0", nil, "stale"},
		{"legacy", "-42", "-42", nil, "unknown"},
		{"empty", "", `""`, nil, "unknown"},
		{"synthetic", "", "7", nil, "unknown"},
		{"old_envelope", "", "8", nil, "unknown"},
	}
	staleAt := now.Add(-signal.LiveSignalFreshnessThreshold - time.Hour)
	tests[1].observedAt = &staleAt
	for _, tc := range tests {
		raw := tc.raw
		switch tc.name {
		case "fresh", "stale":
			raw = `{"kind":` + strconv.Itoa(int(protomodel.ValueKindDouble)) +
				`,"v":` + tc.value + `,"ts":` + strconv.FormatInt(tc.observedAt.UnixNano(), 10) + `,"observed":true}`
		case "synthetic":
			raw = `{"kind":` + strconv.Itoa(int(protomodel.ValueKindDouble)) +
				`,"v":7,"ts":` + strconv.FormatInt(now.UnixNano(), 10) + `,"observed":false}`
		case "old_envelope":
			raw = `{"kind":` + strconv.Itoa(int(protomodel.ValueKindDouble)) +
				`,"v":8,"ts":` + strconv.FormatInt(now.UnixNano(), 10) + `}`
		}
		mr.HSet("vehicle:7:signals", tc.name, raw)
	}
	w := httptest.NewRecorder()
	h.RedisSignals(w, httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=7", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		SignalCount int `json:"signal_count"`
		Signals     map[string]struct {
			Value               json.RawMessage `json:"value"`
			ObservedAt          *time.Time      `json:"observed_at"`
			Source              string          `json:"source"`
			TimestampProvenance string          `json:"timestamp_provenance"`
			Freshness           string          `json:"freshness"`
			ReadAvailability    string          `json:"read_availability"`
		} `json:"signals"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.SignalCount != len(tests) || len(resp.Signals) != len(tests) {
		t.Fatalf("signal counts = %d/%d, want %d", resp.SignalCount, len(resp.Signals), len(tests))
	}
	for _, tc := range tests {
		got := resp.Signals[tc.name]
		if string(got.Value) != tc.value || got.Freshness != tc.freshness {
			t.Errorf("%s value/freshness = %s/%s, want %s/%s", tc.name, got.Value, got.Freshness, tc.value, tc.freshness)
		}
		if got.Source != "redis" || got.ReadAvailability != "available" {
			t.Errorf("%s source/availability = %s/%s", tc.name, got.Source, got.ReadAvailability)
		}
		if tc.observedAt == nil {
			if got.ObservedAt != nil || got.TimestampProvenance != "unknown" {
				t.Errorf("%s fabricated observation: %+v", tc.name, got)
			}
		} else if got.ObservedAt == nil || !got.ObservedAt.Equal(*tc.observedAt) || got.TimestampProvenance != "observation" {
			t.Errorf("%s observation = %+v, want %v", tc.name, got, tc.observedAt)
		}
	}
}

type failMetadataReadHook struct {
	hashReads int
}

func (h *failMetadataReadHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (h *failMetadataReadHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
func (h *failMetadataReadHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		if cmd.Name() == "hgetall" {
			h.hashReads++
			if h.hashReads == 2 {
				return errors.New("metadata read unavailable")
			}
		}
		return next(ctx, cmd)
	}
}

func TestRedisSignals_MetadataReadFailurePreservesValueWithUnknownFreshness(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	rdb.AddHook(&failMetadataReadHook{})
	h.redisCache = signal.NewRedisSignalCache(rdb)
	if err := h.redisCache.Update(context.Background(), 7, map[string]interface{}{"BatteryLevel": 0.0}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.RedisSignals(w, httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=7", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Signals map[string]struct {
			Value               float64    `json:"value"`
			ObservedAt          *time.Time `json:"observed_at"`
			TimestampProvenance string     `json:"timestamp_provenance"`
			Freshness           string     `json:"freshness"`
			ReadAvailability    string     `json:"read_availability"`
		} `json:"signals"`
		Meta redisSignalsMeta `json:"meta"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	got, exists := resp.Signals["BatteryLevel"]
	if !exists || got.Value != 0 || got.ObservedAt != nil || got.TimestampProvenance != "unknown" ||
		got.Freshness != "unknown" || got.ReadAvailability != "available" || resp.Meta.L2LastSeenAt != nil {
		t.Fatalf("metadata failure lost value or fabricated freshness: %+v, meta=%+v", got, resp.Meta)
	}
}

type failFieldCountHook struct{}

func (failFieldCountHook) DialHook(next redis.DialHook) redis.DialHook { return next }
func (failFieldCountHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}
func (failFieldCountHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		if cmd.Name() == "hlen" {
			return errors.New("field count diagnostic failed")
		}
		return next(ctx, cmd)
	}
}

func TestRedisDiagnostics_FieldCountFailureIsNotEmpty(t *testing.T) {
	for _, keys := range []bool{false, true} {
		t.Run(strconv.FormatBool(keys), func(t *testing.T) {
			h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
			mr.HSet("vehicle:7:signals", "zero", "0")
			rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
			t.Cleanup(func() { _ = rdb.Close() })
			rdb.AddHook(failFieldCountHook{})
			h.redisCache = signal.NewRedisSignalCache(rdb)
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=7", nil)
			if keys {
				h.RedisSignalKeys(w, req)
			} else {
				h.RedisSignals(w, req)
			}
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503, body=%s", w.Code, w.Body.String())
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if _, ok := body["error"]; !ok {
				t.Fatalf("missing explicit error: %s", w.Body.String())
			}
			if _, ok := body["meta"]; ok {
				t.Fatalf("failed measurement returned success diagnostics: %s", w.Body.String())
			}
		})
	}
}

func TestRedisSignals_MetaPermutations(t *testing.T) {
	tests := []struct {
		name              string
		mode              string
		l1Signals         map[string]interface{}
		l2Signals         map[string]interface{}
		wantSignalCount   int
		wantL1Count       int
		wantRawFieldCount int
		wantMode          string
		wantL1LastSeen    bool
		wantL2LastSeen    bool
	}{
		{
			name:           "mode=local, both empty",
			mode:           "local",
			wantMode:       "local",
			wantL1LastSeen: false,
			wantL2LastSeen: false,
		},
		{
			name:              "mode=hybrid, L1 only (mirror failed)",
			mode:              "hybrid",
			l1Signals:         map[string]interface{}{"VehicleSpeed": 42.0},
			wantL1Count:       1,
			wantRawFieldCount: 0,
			wantMode:          "hybrid",
			wantL1LastSeen:    true,
			wantL2LastSeen:    false,
		},
		{
			name:              "mode=hybrid, both populated",
			mode:              "hybrid",
			l1Signals:         map[string]interface{}{"VehicleSpeed": 42.0},
			l2Signals:         map[string]interface{}{"VehicleSpeed": 42.0},
			wantSignalCount:   1,
			wantL1Count:       1,
			wantRawFieldCount: 1,
			wantMode:          "hybrid",
			wantL1LastSeen:    true,
			wantL2LastSeen:    true,
		},
		{
			name:              "mode=hybrid, L2 only (L1 missing on this pod)",
			mode:              "hybrid",
			l2Signals:         map[string]interface{}{"BatteryLevel": 72.0, "Locked": true},
			wantSignalCount:   2,
			wantL1Count:       0,
			wantRawFieldCount: 2,
			wantMode:          "hybrid",
			wantL1LastSeen:    false,
			wantL2LastSeen:    true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h, _, store := newTestDevToolsHandler(t, tc.mode, true, true)
			vehicleID := int64(7)

			if len(tc.l1Signals) > 0 {
				store.Update(vehicleID, tc.l1Signals)
			}
			if len(tc.l2Signals) > 0 {
				if err := h.redisCache.Update(context.Background(), vehicleID, tc.l2Signals); err != nil {
					t.Fatalf("seed L2 error = %v", err)
				}
			}

			req := httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals?vehicle_id=7", nil)
			w := httptest.NewRecorder()
			h.RedisSignals(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d (body=%s), want 200", w.Code, w.Body.String())
			}

			var resp struct {
				VehicleID   int64 `json:"vehicle_id"`
				SignalCount int   `json:"signal_count"`
				Meta        struct {
					LiveSignalStoreMode string     `json:"live_signal_store_mode"`
					RedisKey            string     `json:"redis_key"`
					RedisFieldCount     int        `json:"redis_field_count"`
					L1SignalCount       int        `json:"l1_signal_count"`
					L1LastSeenAt        *time.Time `json:"l1_last_seen_at"`
					L2LastSeenAt        *time.Time `json:"l2_last_seen_at"`
					VehicleVIN          string     `json:"vehicle_vin"`
				} `json:"meta"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatalf("unmarshal error = %v (body=%s)", err, w.Body.String())
			}

			if resp.VehicleID != vehicleID {
				t.Errorf("vehicle_id = %d, want %d", resp.VehicleID, vehicleID)
			}
			if resp.SignalCount != tc.wantSignalCount {
				t.Errorf("signal_count = %d, want %d", resp.SignalCount, tc.wantSignalCount)
			}
			if resp.Meta.LiveSignalStoreMode != tc.wantMode {
				t.Errorf("meta.live_signal_store_mode = %q, want %q", resp.Meta.LiveSignalStoreMode, tc.wantMode)
			}
			if resp.Meta.RedisKey != "vehicle:7:signals" {
				t.Errorf("meta.redis_key = %q, want vehicle:7:signals", resp.Meta.RedisKey)
			}
			if resp.Meta.RedisFieldCount != tc.wantRawFieldCount {
				t.Errorf("meta.redis_field_count = %d, want %d", resp.Meta.RedisFieldCount, tc.wantRawFieldCount)
			}
			if resp.Meta.L1SignalCount != tc.wantL1Count {
				t.Errorf("meta.l1_signal_count = %d, want %d", resp.Meta.L1SignalCount, tc.wantL1Count)
			}
			if (resp.Meta.L1LastSeenAt != nil) != tc.wantL1LastSeen {
				t.Errorf("meta.l1_last_seen_at present = %v, want %v", resp.Meta.L1LastSeenAt != nil, tc.wantL1LastSeen)
			}
			if (resp.Meta.L2LastSeenAt != nil) != tc.wantL2LastSeen {
				t.Errorf("meta.l2_last_seen_at present = %v, want %v", resp.Meta.L2LastSeenAt != nil, tc.wantL2LastSeen)
			}
		})
	}
}

func TestRedisSignalKeys_503WhenNoRedis(t *testing.T) {
	h, _, _ := newTestDevToolsHandler(t, "hybrid", false, false)

	req := httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals/keys", nil)
	w := httptest.NewRecorder()
	h.RedisSignalKeys(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestRedisSignalKeys_FiltersMalformedKeys(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)

	// Seed Redis directly so we can plant deliberately malformed keys.
	mr.HSet("vehicle:1:signals", "x", "1")
	mr.HSet("vehicle:42:signals", "x", "1")
	mr.HSet("vehicle:abc:signals", "x", "1") // malformed: non-numeric id
	mr.HSet("vehicle::signals", "x", "1")    // malformed: empty id
	mr.HSet("other:1:signals", "x", "1")     // wrong prefix entirely

	req := httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals/keys?limit=50", nil)
	w := httptest.NewRecorder()
	h.RedisSignalKeys(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s), want 200", w.Code, w.Body.String())
	}

	var resp struct {
		Keys []struct {
			VehicleID  int64 `json:"vehicle_id"`
			FieldCount int   `json:"field_count"`
		} `json:"keys"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error = %v", err)
	}

	if resp.Total != 2 {
		t.Fatalf("total = %d, want 2 (got=%+v)", resp.Total, resp.Keys)
	}
	gotIDs := map[int64]bool{}
	for _, k := range resp.Keys {
		gotIDs[k.VehicleID] = true
		if k.FieldCount != 1 {
			t.Errorf("vehicle %d field_count = %d, want 1", k.VehicleID, k.FieldCount)
		}
	}
	for _, want := range []int64{1, 42} {
		if !gotIDs[want] {
			t.Errorf("missing expected vehicle_id %d in response %+v", want, resp.Keys)
		}
	}
}

func TestRedisSignalKeys_RespectsLimit(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	for i := 1; i <= 5; i++ {
		mr.HSet("vehicle:"+itoa(i)+":signals", "x", "1")
	}

	req := httptest.NewRequest(http.MethodGet, "/dev-tools/redis-signals/keys?limit=2", nil)
	w := httptest.NewRecorder()
	h.RedisSignalKeys(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var resp struct {
		Total int `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error = %v", err)
	}
	if resp.Total != 2 {
		t.Fatalf("total = %d, want 2 (limit=2 over 5 keys)", resp.Total)
	}
}

func TestRedisSignalsPurge_DeletesExistingKey(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	if err := h.redisCache.Update(context.Background(), 7, map[string]interface{}{
		"BatteryLevel": 72.0,
	}); err != nil {
		t.Fatalf("seed Update error = %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/dev-tools/redis-signals?vehicle_id=7", nil)
	w := httptest.NewRecorder()
	h.RedisSignalsPurge(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		VehicleID int64 `json:"vehicle_id"`
		Purged    bool  `json:"purged"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error = %v", err)
	}
	if resp.VehicleID != 7 || !resp.Purged {
		t.Fatalf("response = %+v, want {VehicleID:7, Purged:true}", resp)
	}
	if mr.Exists("vehicle:7:signals") {
		t.Fatalf("vehicle:7:signals still exists in redis after purge")
	}
}

func TestRedisSignalsPurge_NoOpWhenMissing(t *testing.T) {
	h, _, _ := newTestDevToolsHandler(t, "hybrid", true, false)

	req := httptest.NewRequest(http.MethodDelete, "/dev-tools/redis-signals?vehicle_id=999", nil)
	w := httptest.NewRecorder()
	h.RedisSignalsPurge(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp struct {
		VehicleID int64 `json:"vehicle_id"`
		Purged    bool  `json:"purged"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error = %v", err)
	}
	if resp.VehicleID != 999 || resp.Purged {
		t.Fatalf("response = %+v, want {VehicleID:999, Purged:false}", resp)
	}
}

func TestRedisSignalsPurge_503WhenNoCache(t *testing.T) {
	h, _, _ := newTestDevToolsHandler(t, "hybrid", false, false)
	req := httptest.NewRequest(http.MethodDelete, "/dev-tools/redis-signals?vehicle_id=1", nil)
	w := httptest.NewRecorder()
	h.RedisSignalsPurge(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func TestRedisSignalsPurge_400OnBadVehicleID(t *testing.T) {
	h, _, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	cases := []string{"", "abc", "0", "-1"}
	for _, vid := range cases {
		t.Run("vid="+vid, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/dev-tools/redis-signals?vehicle_id="+vid, nil)
			w := httptest.NewRecorder()
			h.RedisSignalsPurge(w, req)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", w.Code)
			}
		})
	}
}

func TestRedisSignalsPurgeAll_DeletesEveryVehicleKey(t *testing.T) {
	h, mr, _ := newTestDevToolsHandler(t, "hybrid", true, false)
	for _, vid := range []int64{1, 7, 42} {
		if err := h.redisCache.Update(context.Background(), vid, map[string]interface{}{"BatteryLevel": 50.0}); err != nil {
			t.Fatalf("Update(%d) error = %v", vid, err)
		}
	}
	mr.HSet("other:cache", "x", "1")

	req := httptest.NewRequest(http.MethodDelete, "/dev-tools/redis-signals/keys", nil)
	w := httptest.NewRecorder()
	h.RedisSignalsPurgeAll(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Purged  int  `json:"purged"`
		Scanned int  `json:"scanned"`
		Limit   int  `json:"limit"`
		HasMore bool `json:"has_more"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error = %v", err)
	}
	if resp.Purged != 3 {
		t.Fatalf("purged = %d, want 3", resp.Purged)
	}
	if resp.Scanned != 3 {
		t.Fatalf("scanned = %d, want 3", resp.Scanned)
	}
	if resp.Limit != 1000 {
		t.Fatalf("limit = %d, want 1000", resp.Limit)
	}
	if resp.HasMore {
		t.Fatalf("has_more = true, want false (3 < 1000 limit)")
	}
	for _, vid := range []int64{1, 7, 42} {
		if mr.Exists("vehicle:" + itoa(int(vid)) + ":signals") {
			t.Fatalf("vehicle:%d:signals still exists after PurgeAll", vid)
		}
	}
	if !mr.Exists("other:cache") {
		t.Fatalf("PurgeAll collateral-deleted other:cache (non-vehicle key)")
	}
}

func TestRedisSignalsPurgeAll_503WhenNoCache(t *testing.T) {
	h, _, _ := newTestDevToolsHandler(t, "hybrid", false, false)
	req := httptest.NewRequest(http.MethodDelete, "/dev-tools/redis-signals/keys", nil)
	w := httptest.NewRecorder()
	h.RedisSignalsPurgeAll(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

func itoa(i int) string {
	const digits = "0123456789"
	if i == 0 {
		return "0"
	}
	negative := false
	if i < 0 {
		negative = true
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = digits[i%10]
		i /= 10
	}
	if negative {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
