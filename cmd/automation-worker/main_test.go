package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	action "github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbauto "github.com/ev-dev-labs/teslasync/internal/database/automation"
	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"
	healthprobe "github.com/ev-dev-labs/teslasync/internal/health"
)

// ── compile-time contracts ────────────────────────────────────────────────
// These guard the production wiring: if the concrete repo, the DB, or the
// adapter ever drift from the ports the worker depends on, the package stops
// compiling instead of failing at runtime.
var (
	_ action.VariableRepo = (*variableRepoAdapter)(nil)
	_ variableStore       = (*dbauto.AutomationVariableRepo)(nil)
	_ healthprobe.Checker = (*database.DB)(nil)
)

// ── healthPort ─────────────────────────────────────────────────────────────

func TestHealthPort(t *testing.T) {
	tests := []struct {
		name string
		set  bool
		env  string
		want string
	}{
		{name: "unset falls back to default", set: false, want: "8083"},
		{name: "empty falls back to default", set: true, env: "", want: "8083"},
		{name: "explicit override", set: true, env: "9090", want: "9090"},
		{name: "non-numeric override is returned verbatim", set: true, env: "abc", want: "abc"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.set {
				t.Setenv("HEALTH_PORT", tc.env)
			} else {
				// Ensure a value leaking from the outer environment does not
				// mask the "unset" branch.
				t.Setenv("HEALTH_PORT", "")
			}
			if got := healthPort(); got != tc.want {
				t.Fatalf("healthPort() = %q, want %q", got, tc.want)
			}
		})
	}
}

// ── safePrefix ───────────────────────────────────────────────────────────────

func TestSafePrefix(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  string
	}{
		{name: "empty", token: "", want: "***"},
		{name: "single char shows nothing", token: "a", want: "***"},
		{name: "two chars shows half", token: "ab", want: "a***"},
		{name: "four chars shows half", token: "abcd", want: "ab***"},
		{name: "boundary eight shows half", token: "abcdefgh", want: "abcd***"},
		{name: "nine shows first eight", token: "abcdefghi", want: "abcdefgh***"},
		{name: "long shows first eight", token: "0123456789abcdef", want: "01234567***"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := safePrefix(tc.token)
			if got != tc.want {
				t.Fatalf("safePrefix(%q) = %q, want %q", tc.token, got, tc.want)
			}
			// A masked prefix must never echo the full token back.
			if tc.token != "" && got == tc.token {
				t.Fatalf("safePrefix(%q) leaked the full token", tc.token)
			}
		})
	}
}

// ── setupLogger ──────────────────────────────────────────────────────────────

func TestSetupLogger(t *testing.T) {
	// setupLogger mutates process-global zerolog state; snapshot & restore so
	// the rest of the suite (and -count=N reruns) stay deterministic.
	orig := zerolog.GlobalLevel()
	t.Cleanup(func() { zerolog.SetGlobalLevel(orig) })
	// Keep the console-writer branch out of the picture so we only exercise
	// level parsing.
	t.Setenv("TESLASYNC_DEV", "false")

	tests := []struct {
		name  string
		level string
		want  zerolog.Level
	}{
		{name: "trace", level: "trace", want: zerolog.TraceLevel},
		{name: "debug", level: "debug", want: zerolog.DebugLevel},
		{name: "info", level: "info", want: zerolog.InfoLevel},
		{name: "warn", level: "warn", want: zerolog.WarnLevel},
		{name: "error", level: "error", want: zerolog.ErrorLevel},
		{name: "unrecognized defaults to info", level: "not-a-level", want: zerolog.InfoLevel},
		{name: "uppercase is unrecognized and defaults to info", level: "INFO", want: zerolog.InfoLevel},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Reset to a sentinel that differs from the expected value so a
			// no-op setupLogger cannot accidentally pass the assertion.
			zerolog.SetGlobalLevel(zerolog.Disabled)
			setupLogger(tc.level)
			if got := zerolog.GlobalLevel(); got != tc.want {
				t.Fatalf("setupLogger(%q) set level %v, want %v", tc.level, got, tc.want)
			}
		})
	}
}

// ── healthHandler ────────────────────────────────────────────────────────────

// fakeHealthChecker is a test double for the database health probe.
type fakeHealthChecker struct {
	err    error
	called bool
	gotCtx context.Context
}

func (f *fakeHealthChecker) Health(ctx context.Context) error {
	f.called = true
	f.gotCtx = ctx
	return f.err
}

func TestHealthHandler(t *testing.T) {
	tests := []struct {
		name        string
		healthErr   error
		wantStatus  int
		wantBody    string // exact body when non-empty
		wantErrText string // decoded "error" field when the response is an error
	}{
		{
			name:       "healthy returns 200 ok",
			healthErr:  nil,
			wantStatus: http.StatusOK,
			wantBody:   `{"status":"ok"}`,
		},
		{
			name:        "unhealthy returns 503 with error",
			healthErr:   errors.New("pool exhausted"),
			wantStatus:  http.StatusServiceUnavailable,
			wantErrText: "pool exhausted",
		},
		{
			name: "unhealthy error with quotes stays valid json",
			// A naive fmt.Fprintf into a JSON string literal would corrupt the
			// payload here; the marshalled handler must escape it.
			healthErr:   errors.New(`bad "quoted" value` + "\nsecond line"),
			wantStatus:  http.StatusServiceUnavailable,
			wantErrText: `bad "quoted" value` + "\nsecond line",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeHealthChecker{err: tc.healthErr}
			handler := healthprobe.ReadinessHandler(fake)

			req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			res := rec.Result()
			defer res.Body.Close()

			if !fake.called {
				t.Fatal("handler did not invoke the health checker")
			}
			if fake.gotCtx == nil {
				t.Fatal("handler did not pass the request context to the checker")
			}
			if res.StatusCode != tc.wantStatus {
				t.Fatalf("status = %d, want %d", res.StatusCode, tc.wantStatus)
			}
			if ct := res.Header.Get("Content-Type"); ct != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json (must be set on every path)", ct)
			}

			body := rec.Body.Bytes()
			if !json.Valid(body) {
				t.Fatalf("response body is not valid JSON: %q", body)
			}

			if tc.wantBody != "" {
				if got := strings.TrimSpace(string(body)); got != tc.wantBody {
					t.Fatalf("body = %q, want %q", got, tc.wantBody)
				}
			}
			if tc.wantErrText != "" {
				var decoded struct {
					Status string `json:"status"`
					Error  string `json:"error"`
				}
				if err := json.Unmarshal(body, &decoded); err != nil {
					t.Fatalf("decode error body: %v (body=%q)", err, body)
				}
				if decoded.Status != "unhealthy" {
					t.Fatalf("status field = %q, want unhealthy", decoded.Status)
				}
				if decoded.Error != tc.wantErrText {
					t.Fatalf("error field = %q, want %q", decoded.Error, tc.wantErrText)
				}
			}
		})
	}
}

// ── variableRepoAdapter ──────────────────────────────────────────────────────

// fakeVariableStore records calls and returns canned results so the adapter's
// translation + error-wrapping logic can be exercised without a database.
type fakeVariableStore struct {
	getEntry *automationmodel.AutomationVariable
	getErr   error
	setErr   error

	gotGetKey string
	getCalls  int

	gotSetKey string
	gotSetVal string
	gotSetVeh *int64
	setCalls  int
}

func (f *fakeVariableStore) Get(_ context.Context, key string) (*automationmodel.AutomationVariable, error) {
	f.getCalls++
	f.gotGetKey = key
	return f.getEntry, f.getErr
}

func (f *fakeVariableStore) Set(_ context.Context, key, value string, vehicleID *int64) error {
	f.setCalls++
	f.gotSetKey = key
	f.gotSetVal = value
	f.gotSetVeh = vehicleID
	return f.setErr
}

func TestVariableRepoAdapterGet(t *testing.T) {
	sentinel := errors.New("db down")

	tests := []struct {
		name      string
		store     *fakeVariableStore
		key       string
		wantEntry *action.VariableEntry
		wantErr   error // sentinel wrapped, checked with errors.Is
	}{
		{
			name:      "found maps to entry",
			store:     &fakeVariableStore{getEntry: &automationmodel.AutomationVariable{Key: "charge_limit", Value: "80"}},
			key:       "charge_limit",
			wantEntry: &action.VariableEntry{Key: "charge_limit", Value: "80"},
		},
		{
			name:      "not found returns nil entry and nil error",
			store:     &fakeVariableStore{getEntry: nil, getErr: nil},
			key:       "missing",
			wantEntry: nil,
		},
		{
			name:    "store error is wrapped with context",
			store:   &fakeVariableStore{getErr: sentinel},
			key:     "boom",
			wantErr: sentinel,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := &variableRepoAdapter{repo: tc.store}
			got, err := a.Get(context.Background(), tc.key)

			if tc.store.gotGetKey != tc.key {
				t.Fatalf("store.Get key = %q, want %q", tc.store.gotGetKey, tc.key)
			}
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want wrapping %v", err, tc.wantErr)
				}
				if !strings.Contains(err.Error(), tc.key) {
					t.Fatalf("err %q should mention key %q for context", err.Error(), tc.key)
				}
				if got != nil {
					t.Fatalf("entry = %+v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.wantEntry == nil {
				if got != nil {
					t.Fatalf("entry = %+v, want nil", got)
				}
				return
			}
			if got == nil || *got != *tc.wantEntry {
				t.Fatalf("entry = %+v, want %+v", got, tc.wantEntry)
			}
		})
	}
}

func TestVariableRepoAdapterSet(t *testing.T) {
	sentinel := errors.New("write conflict")
	vid := int64(7)

	tests := []struct {
		name    string
		store   *fakeVariableStore
		key     string
		value   string
		veh     *int64
		wantErr error
	}{
		{
			name:  "success forwards all args",
			store: &fakeVariableStore{},
			key:   "last_seen",
			value: "2026-01-01",
			veh:   &vid,
		},
		{
			name:  "nil vehicle id is forwarded as nil",
			store: &fakeVariableStore{},
			key:   "global_flag",
			value: "on",
			veh:   nil,
		},
		{
			name:    "store error is wrapped with context",
			store:   &fakeVariableStore{setErr: sentinel},
			key:     "conflicting",
			value:   "x",
			veh:     &vid,
			wantErr: sentinel,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := &variableRepoAdapter{repo: tc.store}
			err := a.Set(context.Background(), tc.key, tc.value, tc.veh)

			if tc.store.setCalls != 1 {
				t.Fatalf("store.Set called %d times, want 1", tc.store.setCalls)
			}
			if tc.store.gotSetKey != tc.key || tc.store.gotSetVal != tc.value {
				t.Fatalf("store.Set(%q,%q), want (%q,%q)", tc.store.gotSetKey, tc.store.gotSetVal, tc.key, tc.value)
			}
			if tc.store.gotSetVeh != tc.veh {
				t.Fatalf("store.Set vehicleID pointer = %v, want %v", tc.store.gotSetVeh, tc.veh)
			}
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want wrapping %v", err, tc.wantErr)
				}
				if !strings.Contains(err.Error(), tc.key) {
					t.Fatalf("err %q should mention key %q for context", err.Error(), tc.key)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
