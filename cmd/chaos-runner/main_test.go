package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/chaos"
)

// TestMain silences the global zerolog logger for the whole package so
// run()'s boundary logging doesn't spam test output. It is set once,
// before any test goroutine starts, so it is race-safe.
func TestMain(m *testing.M) {
	log.Logger = zerolog.Nop()
	os.Exit(m.Run())
}

func TestEnvOr(t *testing.T) {
	const key = "CHAOS_RUNNER_TEST_ENVOR"

	tests := []struct {
		name   string
		setEnv bool
		value  string
		def    string
		want   string
	}{
		{"unset returns default", false, "", "fallback", "fallback"},
		{"empty value returns default", true, "", "fallback", "fallback"},
		{"set value is returned", true, "custom", "fallback", "custom"},
		{"value is not trimmed", true, "  spaced  ", "fallback", "  spaced  "},
		{"empty default with unset", false, "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setEnv {
				t.Setenv(key, tt.value)
			} else {
				os.Unsetenv(key)
			}
			if got := envOr(key, tt.def); got != tt.want {
				t.Errorf("envOr(%q, %q) = %q, want %q", key, tt.def, got, tt.want)
			}
		})
	}
}

func TestSelectScenarios(t *testing.T) {
	verify := func(context.Context) error { return nil }

	var allNames []string
	for _, s := range chaos.DefaultScenarios() {
		allNames = append(allNames, s.Name)
	}
	if len(allNames) < 3 {
		t.Fatalf("DefaultScenarios must expose >=3 scenarios for this test, got %d", len(allNames))
	}

	tests := []struct {
		name      string
		want      string
		wantNames []string
	}{
		{"all keyword returns every scenario", "all", allNames},
		{"empty string means all", "", allNames},
		{"single name filters to one", allNames[0], []string{allNames[0]}},
		{"multiple names preserve order", allNames[0] + "," + allNames[1], []string{allNames[0], allNames[1]}},
		{"whitespace around names is trimmed", " " + allNames[0] + " , " + allNames[2] + " ", []string{allNames[0], allNames[2]}},
		{"unknown name yields empty selection", "does-not-exist", []string{}},
		{"known plus unknown keeps only known", allNames[1] + ",does-not-exist", []string{allNames[1]}},
		{"empty tokens are ignored", allNames[0] + ",,", []string{allNames[0]}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := selectScenarios(tt.want, verify)

			gotNames := []string{}
			for _, s := range got {
				gotNames = append(gotNames, s.Name)
				if s.Verify == nil {
					t.Errorf("scenario %q was not wired with the verify hook", s.Name)
				}
			}
			if !reflect.DeepEqual(gotNames, tt.wantNames) {
				t.Errorf("selectScenarios(%q) names = %v, want %v", tt.want, gotNames, tt.wantNames)
			}
		})
	}
}

func TestSelectScenarios_DoesNotMutateDefaults(t *testing.T) {
	// DefaultScenarios must return nil Verify hooks; selectScenarios wires
	// them on its own copy without leaking back into the library defaults.
	verify := func(context.Context) error { return nil }
	_ = selectScenarios("all", verify)
	for _, s := range chaos.DefaultScenarios() {
		if s.Verify != nil {
			t.Errorf("DefaultScenarios()[%q].Verify leaked a non-nil hook", s.Name)
		}
	}
}

func TestDefaultProbeConfig(t *testing.T) {
	cfg := defaultProbeConfig()
	if cfg.httpTimeout != 5*time.Second {
		t.Errorf("httpTimeout = %v, want 5s", cfg.httpTimeout)
	}
	if cfg.deadline != 30*time.Second {
		t.Errorf("deadline = %v, want 30s", cfg.deadline)
	}
	if cfg.interval != 2*time.Second {
		t.Errorf("interval = %v, want 2s", cfg.interval)
	}
}

func TestMakeAPIProbe_HitsHealthzWithGet(t *testing.T) {
	var (
		mu         sync.Mutex
		gotPath    string
		gotMethod  string
		callCount  int
		requireGet = http.MethodGet
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotPath, gotMethod, callCount = r.URL.Path, r.Method, callCount+1
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	// The exported default wrapper must also succeed immediately on a 200.
	probe := makeAPIProbe(srv.URL)
	if err := probe(context.Background()); err != nil {
		t.Fatalf("probe returned %v, want nil", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if gotPath != "/healthz" {
		t.Errorf("path = %q, want /healthz", gotPath)
	}
	if gotMethod != requireGet {
		t.Errorf("method = %q, want %q", gotMethod, requireGet)
	}
	if callCount != 1 {
		t.Errorf("callCount = %d, want 1 (should stop after first 200)", callCount)
	}
}

func TestMakeAPIProbeWithConfig(t *testing.T) {
	// recoveringHandler returns 503 for the first two calls, then 200.
	recoveringHandler := func() http.HandlerFunc {
		var n atomic.Int32
		return func(w http.ResponseWriter, _ *http.Request) {
			if n.Add(1) < 3 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
		}
	}()
	unhealthy := func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	healthy := func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}

	tests := []struct {
		name        string
		handler     http.HandlerFunc // nil => no server started
		apiURL      string           // used when handler is nil
		closeServer bool             // simulate an unreachable endpoint
		cfg         probeConfig
		ctxTimeout  time.Duration // >0 => derive a WithTimeout context
		check       func(t *testing.T, err error)
	}{
		{
			name:    "healthy on first attempt",
			handler: healthy,
			cfg:     probeConfig{httpTimeout: time.Second, deadline: time.Second, interval: 10 * time.Millisecond},
			check: func(t *testing.T, err error) {
				if err != nil {
					t.Fatalf("want nil, got %v", err)
				}
			},
		},
		{
			name:    "recovers after retries",
			handler: recoveringHandler,
			cfg:     probeConfig{httpTimeout: 500 * time.Millisecond, deadline: 3 * time.Second, interval: 10 * time.Millisecond},
			check: func(t *testing.T, err error) {
				if err != nil {
					t.Fatalf("want recovery (nil), got %v", err)
				}
			},
		},
		{
			name:    "never recovers reports last status",
			handler: unhealthy,
			cfg:     probeConfig{httpTimeout: 500 * time.Millisecond, deadline: 120 * time.Millisecond, interval: 20 * time.Millisecond},
			check: func(t *testing.T, err error) {
				if err == nil {
					t.Fatal("want error, got nil")
				}
				if !strings.Contains(err.Error(), "api never recovered") {
					t.Errorf("error = %q, want it to contain 'api never recovered'", err.Error())
				}
				if !strings.Contains(err.Error(), "503") {
					t.Errorf("error = %q, want it to surface the 503 status", err.Error())
				}
			},
		},
		{
			name:        "unreachable endpoint bubbles up dial error",
			handler:     healthy,
			closeServer: true,
			cfg:         probeConfig{httpTimeout: 200 * time.Millisecond, deadline: 120 * time.Millisecond, interval: 20 * time.Millisecond},
			check: func(t *testing.T, err error) {
				if err == nil {
					t.Fatal("want error against a closed server, got nil")
				}
				if !strings.Contains(err.Error(), "api never recovered") {
					t.Errorf("error = %q, want it to contain 'api never recovered'", err.Error())
				}
			},
		},
		{
			name:       "context cancellation aborts the retry loop",
			handler:    unhealthy,
			cfg:        probeConfig{httpTimeout: time.Second, deadline: 10 * time.Second, interval: time.Second},
			ctxTimeout: 50 * time.Millisecond,
			check: func(t *testing.T, err error) {
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("want context.DeadlineExceeded, got %v", err)
				}
			},
		},
		{
			name:   "malformed url fails fast building the request",
			apiURL: "http://localhost\x7f",
			cfg:    probeConfig{httpTimeout: time.Second, deadline: time.Second, interval: 10 * time.Millisecond},
			check: func(t *testing.T, err error) {
				if err == nil {
					t.Fatal("want build error, got nil")
				}
				if !strings.Contains(err.Error(), "build probe request") {
					t.Errorf("error = %q, want it to contain 'build probe request'", err.Error())
				}
			},
		},
		{
			name:   "non-positive deadline recovers to a bare error",
			apiURL: "http://127.0.0.1:0",
			cfg:    probeConfig{httpTimeout: time.Second, deadline: 0, interval: 10 * time.Millisecond},
			check: func(t *testing.T, err error) {
				if err == nil || err.Error() != "api never recovered" {
					t.Fatalf("want bare 'api never recovered', got %v", err)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			apiURL := tt.apiURL
			if tt.handler != nil {
				srv := httptest.NewServer(tt.handler)
				if tt.closeServer {
					srv.Close()
				} else {
					t.Cleanup(srv.Close)
				}
				apiURL = srv.URL
			}

			ctx := context.Background()
			if tt.ctxTimeout > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.ctxTimeout)
				t.Cleanup(cancel)
			}

			err := makeAPIProbeWithConfig(apiURL, tt.cfg)(ctx)
			tt.check(t, err)
		})
	}
}

func TestRun(t *testing.T) {
	// A permissive Toxiproxy fake: every add/remove succeeds so the loop's
	// aggregation + emission logic is what's under test.
	okServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(okServer.Close)
	client := chaos.NewClient(okServer.URL)

	pass := func(context.Context) error { return nil }
	fail := func(context.Context) error { return errors.New("verify boom") }
	mk := func(name string, v func(context.Context) error) chaos.Scenario {
		return chaos.Scenario{
			Name:        name,
			Proxy:       "mqtt",
			Duration:    time.Millisecond,
			SettleDelay: time.Millisecond,
			Toxic:       chaos.Toxic{Name: name + "-toxic", Type: "latency"},
			Verify:      v,
		}
	}
	// Duration <= 0 makes Scenario.Run fail validation before touching the network.
	invalid := chaos.Scenario{Name: "invalid", Proxy: "mqtt", Toxic: chaos.Toxic{Name: "t"}}

	type expect struct {
		name string
		ok   bool
	}
	tests := []struct {
		name       string
		scenarios  []chaos.Scenario
		wantFailed int
		want       []expect
	}{
		{"empty scenario set", nil, 0, nil},
		{"all pass (nil and passing verify)", []chaos.Scenario{mk("a", nil), mk("b", pass)}, 0, []expect{{"a", true}, {"b", true}}},
		{"single verify failure", []chaos.Scenario{mk("a", fail)}, 1, []expect{{"a", false}}},
		{"mixed pass and fail preserves order", []chaos.Scenario{mk("a", pass), mk("b", fail), mk("c", nil)}, 1, []expect{{"a", true}, {"b", false}, {"c", true}}},
		{"invalid config counts as failure", []chaos.Scenario{invalid}, 1, []expect{{"invalid", false}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			failed := run(context.Background(), client, tt.scenarios, &buf)

			if failed != tt.wantFailed {
				t.Errorf("run failed count = %d, want %d", failed, tt.wantFailed)
			}

			var lines []string
			if s := strings.TrimSpace(buf.String()); s != "" {
				lines = strings.Split(s, "\n")
			}
			if len(lines) != len(tt.want) {
				t.Fatalf("emitted %d result lines, want %d (output=%q)", len(lines), len(tt.want), buf.String())
			}
			for i, exp := range tt.want {
				var res runResult
				if err := json.Unmarshal([]byte(lines[i]), &res); err != nil {
					t.Fatalf("line %d is not valid JSON: %v (%q)", i, err, lines[i])
				}
				if res.Name != exp.name {
					t.Errorf("line %d name = %q, want %q", i, res.Name, exp.name)
				}
				if res.OK != exp.ok {
					t.Errorf("line %d ok = %v, want %v", i, res.OK, exp.ok)
				}
				if exp.ok && res.Error != "" {
					t.Errorf("line %d: passing result should not carry an error, got %q", i, res.Error)
				}
				if !exp.ok && res.Error == "" {
					t.Errorf("line %d: failing result must carry an error", i)
				}
				if res.DurationMs < 0 {
					t.Errorf("line %d: negative duration %d", i, res.DurationMs)
				}
			}
		})
	}
}

func TestRun_InstallToxicErrorIsReported(t *testing.T) {
	// POST (AddToxic) fails with 500; DELETE (cleanup) still succeeds.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	client := chaos.NewClient(srv.URL)

	s := chaos.Scenario{
		Name:        "boom",
		Proxy:       "mqtt",
		Duration:    time.Millisecond,
		SettleDelay: time.Millisecond,
		Toxic:       chaos.Toxic{Name: "t", Type: "latency"},
	}

	var buf bytes.Buffer
	failed := run(context.Background(), client, []chaos.Scenario{s}, &buf)
	if failed != 1 {
		t.Fatalf("failed = %d, want 1", failed)
	}

	var res runResult
	if err := json.Unmarshal([]byte(strings.TrimSpace(buf.String())), &res); err != nil {
		t.Fatalf("parse result: %v", err)
	}
	if res.OK {
		t.Error("want ok=false when AddToxic fails")
	}
	if !strings.Contains(res.Error, "install toxic") {
		t.Errorf("error = %q, want it to mention 'install toxic'", res.Error)
	}
}

func TestRunResult_JSONShape(t *testing.T) {
	tests := []struct {
		name       string
		res        runResult
		wantKeys   []string
		absentKeys []string
	}{
		{
			name:       "successful result omits error",
			res:        runResult{Name: "x", OK: true, DurationMs: 12},
			wantKeys:   []string{"name", "ok", "duration_ms"},
			absentKeys: []string{"error"},
		},
		{
			name:     "failed result includes error",
			res:      runResult{Name: "y", OK: false, DurationMs: 0, Error: "boom"},
			wantKeys: []string{"name", "ok", "duration_ms", "error"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(tt.res)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var m map[string]json.RawMessage
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatalf("unmarshal into map: %v", err)
			}
			for _, k := range tt.wantKeys {
				if _, ok := m[k]; !ok {
					t.Errorf("missing key %q in %s", k, b)
				}
			}
			for _, k := range tt.absentKeys {
				if _, ok := m[k]; ok {
					t.Errorf("unexpected key %q in %s (omitempty broken)", k, b)
				}
			}
		})
	}
}
