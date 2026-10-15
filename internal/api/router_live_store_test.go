package api

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	apiclimate "github.com/ev-dev-labs/teslasync/internal/api/climate"
	apitelem "github.com/ev-dev-labs/teslasync/internal/api/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
)

func liveReadTestRouter(opt RouterOptions) http.Handler {
	r := chi.NewRouter()
	r.Route("/api/v1/signals/{vehicleID}", func(r chi.Router) {
		mountSignalInspectRoutes(r, nil, opt.TelemetryHandler, opt, routerLiveSignalStore(opt))
	})
	return r
}

type liveReadResponse struct {
	VehicleID int64 `json:"vehicle_id"`
	Count     int   `json:"count"`
	Signals   map[string]struct {
		Value     interface{} `json:"value"`
		Timestamp time.Time   `json:"timestamp"`
		TS        time.Time   `json:"ts"`
		Source    string      `json:"source"`
		Kind      string      `json:"kind"`
	} `json:"signals"`
}

func requestLiveRead(t *testing.T, h http.Handler) (*httptest.ResponseRecorder, liveReadResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/signals/8201/live", nil))
	var body liveReadResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
	}
	return rec, body
}

func TestRouterLiveReadBoundary(t *testing.T) {
	t.Run("disabledIngestRealL1", func(t *testing.T) {
		local := signal.New()
		ts := time.Now().UTC()
		local.Set(8201, "InsideTemp", float32(23.5), ts)
		live, err := signal.NewLiveSignalStore(local, nil, "hybrid")
		if err != nil {
			t.Fatal(err)
		}
		// No telemetry handler or subscriber is supplied.
		rec, body := requestLiveRead(t, liveReadTestRouter(RouterOptions{LiveSignalStore: live}))
		entry := body.Signals["InsideTemp"]
		if rec.Code != http.StatusOK || body.VehicleID != 8201 || body.Count != 1 ||
			entry.Value != float64(23.5) || !entry.Timestamp.Equal(ts) || !entry.TS.Equal(ts) || entry.Kind == "" {
			t.Fatalf("real nonempty live route = %d %s", rec.Code, rec.Body)
		}
	})
	t.Run("configuredEmpty", func(t *testing.T) {
		live, err := signal.NewLiveSignalStore(signal.New(), nil, "local")
		if err != nil {
			t.Fatal(err)
		}
		rec, body := requestLiveRead(t, liveReadTestRouter(RouterOptions{LiveSignalStore: live}))
		if rec.Code != http.StatusOK || body.Count != 0 || body.Signals == nil {
			t.Fatalf("real empty boundary = %d %s", rec.Code, rec.Body)
		}
	})
	t.Run("unconfiguredIs503NotFakeEmpty", func(t *testing.T) {
		rec, _ := requestLiveRead(t, liveReadTestRouter(RouterOptions{}))
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "live signal store not initialized") {
			t.Fatalf("unconfigured boundary = %d %s", rec.Code, rec.Body)
		}
	})
}

// liveReadRedisHook substitutes only Redis command transport. All decoding,
// merging, timestamps, errors, warmup, and local rollback use the real store.
type liveReadRedisHook struct {
	values map[string]string
	err    error
	reads  int
}

func (h *liveReadRedisHook) DialHook(redis.DialHook) redis.DialHook {
	return func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("unexpected network dial in live-read unit test")
	}
}

func (h *liveReadRedisHook) ProcessHook(redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		if cmd.Name() != "hgetall" {
			return errors.New("unexpected Redis command in live-read unit test")
		}
		h.reads++
		if cmd.Args()[1] != "vehicle:8201:signals" {
			return errors.New("unexpected Redis key in live-read unit test")
		}
		if h.err != nil {
			return h.err
		}
		copyValues := make(map[string]string, len(h.values))
		for k, v := range h.values {
			copyValues[k] = v
		}
		cmd.(*redis.MapStringStringCmd).SetVal(copyValues)
		return nil
	}
}

func (h *liveReadRedisHook) ProcessPipelineHook(redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(context.Context, []redis.Cmder) error {
		return errors.New("unexpected pipeline in live-read unit test")
	}
}

func newLiveReadHybrid(t *testing.T) (*signal.Store, *signal.HybridLiveSignalStore, *liveReadRedisHook) {
	t.Helper()
	ts := time.Now().UTC()
	encoded, err := json.Marshal(map[string]interface{}{
		"encoding": "teslasync.signal.v1", "value": float32(25),
		"timestamp": ts, "source": "redis_signal_cache",
	})
	if err != nil {
		t.Fatal(err)
	}
	hook := &liveReadRedisHook{values: map[string]string{"InsideTemp": string(encoded)}}
	rdb := redis.NewClient(&redis.Options{Addr: "unused.invalid:1"})
	rdb.AddHook(hook)
	t.Cleanup(func() { _ = rdb.Close() })
	local := signal.New()
	local.Set(8201, "InsideTemp", float32(20), ts.Add(-time.Minute))
	local.Set(8201, "OutsideTemp", float32(11), ts.Add(-time.Minute))
	live, err := signal.NewHybridLiveSignalStore(local, signal.NewRedisSignalCache(rdb), signal.LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatal(err)
	}
	return local, live, hook
}

func TestRouterLiveReadHybridRollback(t *testing.T) {
	local, live, hook := newLiveReadHybrid(t)
	router := liveReadTestRouter(RouterOptions{LiveSignalStore: live})
	rec, body := requestLiveRead(t, router)
	if rec.Code != http.StatusOK || body.Count != 2 || body.Signals["InsideTemp"].Value != float64(25) ||
		body.Signals["OutsideTemp"].Value != float64(11) || hook.reads != 1 {
		t.Fatalf("hybrid L1/L2 union = %d %s; reads %d", rec.Code, rec.Body, hook.reads)
	}
	// Distributed reads must not mutate L1's last-known-good observation.
	if local.Get(8201, "InsideTemp").Raw != float32(20) {
		t.Fatal("distributed read overwrote local hot-path observation")
	}
	hook.err = errors.New("synthetic cache unavailable")
	rec, _ = requestLiveRead(t, router)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "live signal store unavailable") {
		t.Fatalf("cache failure must surface = %d %s", rec.Code, rec.Body)
	}
	reads := hook.reads
	if err := live.SetMode(signal.LiveSignalStoreModeLocal); err != nil {
		t.Fatal(err)
	}
	rec, body = requestLiveRead(t, router)
	if rec.Code != http.StatusOK || body.Signals["InsideTemp"].Value != float64(20) || hook.reads != reads {
		t.Fatalf("local rollback must ignore broken L2/preserve L1 = %d %s; reads %d", rec.Code, rec.Body, hook.reads)
	}
}

func TestRouterLiveReadDependencySelection(t *testing.T) {
	explicit, err := signal.NewLiveSignalStore(signal.New(), nil, "local")
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := signal.NewLiveSignalStore(signal.New(), nil, "local")
	if err != nil {
		t.Fatal(err)
	}
	h := &apitelem.Handler{}
	h.SetLiveSignalStore(legacy)
	if routerLiveSignalStore(RouterOptions{LiveSignalStore: explicit, TelemetryHandler: h}) != explicit {
		t.Fatal("explicit reader dependency must win")
	}
	if routerLiveSignalStore(RouterOptions{TelemetryHandler: h}) != legacy {
		t.Fatal("existing handler callers must reuse the actual handler boundary")
	}
	if routerLiveSignalStore(RouterOptions{TelemetryHandler: &apitelem.Handler{}}) != nil {
		t.Fatal("unconfigured handler must not produce a no-op read dependency")
	}
}

type liveReadColdState struct{}

func (liveReadColdState) State(context.Context, int64, time.Time) (signal.State, error) {
	return signal.State{"InsideTemp": float32(-1), "OutsideTemp": float32(9), "HvacFanSpeed": float32(3)}, nil
}
func (liveReadColdState) SignalAt(context.Context, int64, string, time.Time) (signal.SignalValue, error) {
	return nil, nil
}
func (liveReadColdState) Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

func TestRouterLiveReadCurrentConsumer(t *testing.T) {
	_, live, hook := newLiveReadHybrid(t)
	boundary := routerLiveSignalStore(RouterOptions{LiveSignalStore: live})
	reader, err := signal.NewLiveStateReader(boundary, liveReadColdState{})
	if err != nil {
		t.Fatal(err)
	}
	h := apiclimate.NewClimateHandler(liveReadColdState{}, reader)
	rec := httptest.NewRecorder()
	h.Latest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/climate/latest?vehicle_id=8201", nil))
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || body["inside_temp"] != float64(25) || body["outside_temp"] != float64(11) || body["fan_speed"] != float64(3) {
		t.Fatalf("current consumer must use shared distributed boundary over cold values = %d %s", rec.Code, rec.Body)
	}
	// Missing keys still use the existing signal_log StateReader fallback.
	state, err := reader.LiveState(context.Background(), 8201)
	if err != nil || state["InsideTemp"] == float32(-1) || state["HvacFanSpeed"] != float32(3) {
		t.Fatalf("live-state reader precedence = %#v, %v", state, err)
	}
	hook.err = errors.New("synthetic cache unavailable")
	rec = httptest.NewRecorder()
	h.Latest(rec, httptest.NewRequest(http.MethodGet, "/api/v1/climate/latest?vehicle_id=8201", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("current consumer cache error = %d %s", rec.Code, rec.Body)
	}
}
