// Tests for the enriched dev-tools redis-signals
// endpoint and the new redis-signals/keys companion. These exercise the
// branches the Redis Signal Viewer's structured empty-state diagnostic
// depends on (mode-local, hybrid+L1-only, hybrid+populated, missing
// vehicle_id, no Redis cache wired).
package devtools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/signal"
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
