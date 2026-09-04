package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	healthprobe "github.com/ev-dev-labs/teslasync/internal/health"
	"github.com/rs/zerolog"
)

// fakeHealthChecker is a test double for the healthChecker port. It returns a
// canned error and records the last context it was invoked with so tests can
// assert the request context is propagated to the dependency.
type fakeHealthChecker struct {
	err     error
	gotCtx  context.Context
	callCnt int
}

func (f *fakeHealthChecker) Health(ctx context.Context) error {
	f.callCnt++
	f.gotCtx = ctx
	return f.err
}

func TestResolveHealthPort(t *testing.T) {
	tests := []struct {
		name    string
		envVal  string
		wantVal string
	}{
		{"empty falls back to default", "", "8082"},
		{"explicit default", "8082", "8082"},
		{"custom numeric port", "9000", "9000"},
		{"named port passthrough", "http-alt", "http-alt"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("HEALTH_PORT", tt.envVal)
			if got := resolveHealthPort(); got != tt.wantVal {
				t.Fatalf("resolveHealthPort() = %q, want %q", got, tt.wantVal)
			}
		})
	}
}

func TestHealthcheckURL(t *testing.T) {
	tests := []struct {
		name string
		port string
		want string
	}{
		{"default port", "8082", "http://localhost:8082/healthz"},
		{"custom port", "9000", "http://localhost:9000/healthz"},
		{"empty port", "", "http://localhost:/healthz"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := healthcheckURL(tt.port); got != tt.want {
				t.Fatalf("healthcheckURL(%q) = %q, want %q", tt.port, got, tt.want)
			}
		})
	}
}

func TestHealthcheckExitCode(t *testing.T) {
	// A single configurable server drives the status-code cases: the ?code=
	// query selects the HTTP status it replies with.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code, err := strconv.Atoi(r.URL.Query().Get("code"))
		if err != nil || code == 0 {
			code = http.StatusOK
		}
		w.WriteHeader(code)
	}))
	defer srv.Close()

	// A server that is closed before use exercises the transport-error branch
	// (connection refused) deterministically without any sleeps.
	deadSrv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := deadSrv.URL
	deadSrv.Close()

	tests := []struct {
		name  string
		setup func(t *testing.T) (context.Context, string)
		want  int
	}{
		{
			name:  "200 OK returns 0",
			setup: func(*testing.T) (context.Context, string) { return context.Background(), srv.URL + "?code=200" },
			want:  0,
		},
		{
			name:  "201 Created is not 200 so returns 1",
			setup: func(*testing.T) (context.Context, string) { return context.Background(), srv.URL + "?code=201" },
			want:  1,
		},
		{
			name:  "404 returns 1",
			setup: func(*testing.T) (context.Context, string) { return context.Background(), srv.URL + "?code=404" },
			want:  1,
		},
		{
			name:  "503 unhealthy returns 1",
			setup: func(*testing.T) (context.Context, string) { return context.Background(), srv.URL + "?code=503" },
			want:  1,
		},
		{
			name:  "unreachable server returns 1",
			setup: func(*testing.T) (context.Context, string) { return context.Background(), deadURL },
			want:  1,
		},
		{
			name:  "malformed url returns 1",
			setup: func(*testing.T) (context.Context, string) { return context.Background(), "://no-scheme" },
			want:  1,
		},
		{
			name: "cancelled context returns 1",
			setup: func(*testing.T) (context.Context, string) {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx, srv.URL + "?code=200"
			},
			want: 1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, url := tt.setup(t)
			if got := healthcheckExitCode(ctx, http.DefaultClient, url); got != tt.want {
				t.Fatalf("healthcheckExitCode(%q) = %d, want %d", url, got, tt.want)
			}
		})
	}
}

func TestNewHealthHandler(t *testing.T) {
	tests := []struct {
		name           string
		healthErr      error
		wantStatus     int
		wantStatusJSON string
		wantErrJSON    string // "" means the error key must be absent
	}{
		{
			name:           "healthy returns 200 ok",
			healthErr:      nil,
			wantStatus:     http.StatusOK,
			wantStatusJSON: "ok",
			wantErrJSON:    "",
		},
		{
			name:           "unhealthy returns 503 with error",
			healthErr:      errors.New("database unreachable"),
			wantStatus:     http.StatusServiceUnavailable,
			wantStatusJSON: "unhealthy",
			wantErrJSON:    "database unreachable",
		},
		{
			// Error text containing quotes and a backslash would corrupt a
			// string-interpolated JSON body; json.Marshal must escape it so the
			// body still parses.
			name:           "error with quotes stays valid json",
			healthErr:      errors.New(`connection "primary" refused \ retry`),
			wantStatus:     http.StatusServiceUnavailable,
			wantStatusJSON: "unhealthy",
			wantErrJSON:    `connection "primary" refused \ retry`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := healthprobe.ReadinessHandler(&fakeHealthChecker{err: tt.healthErr})
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/healthz", nil)

			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json (must be set on both paths)", ct)
			}

			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("response body is not valid json: %v (body=%q)", err, rec.Body.String())
			}
			if body["status"] != tt.wantStatusJSON {
				t.Errorf("status field = %q, want %q", body["status"], tt.wantStatusJSON)
			}
			if tt.wantErrJSON == "" {
				if _, ok := body["error"]; ok {
					t.Errorf("expected no error key on healthy response, got %q", body["error"])
				}
			} else if body["error"] != tt.wantErrJSON {
				t.Errorf("error field = %q, want %q", body["error"], tt.wantErrJSON)
			}
		})
	}
}

func TestNewHealthHandler_PropagatesRequestContext(t *testing.T) {
	type ctxKey string
	const marker ctxKey = "marker"

	fake := &fakeHealthChecker{}
	handler := healthprobe.ReadinessHandler(fake)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req = req.WithContext(context.WithValue(req.Context(), marker, "present"))

	handler.ServeHTTP(rec, req)

	if fake.callCnt != 1 {
		t.Fatalf("Health called %d times, want 1", fake.callCnt)
	}
	if fake.gotCtx == nil {
		t.Fatal("handler did not pass a context to Health")
	}
	if v, _ := fake.gotCtx.Value(marker).(string); v != "present" {
		t.Errorf("request context not propagated to Health: got value %q", v)
	}
}

func TestNewScheduledBackupRun(t *testing.T) {
	tests := []struct {
		name string
		cfg  *backupmodel.BackupConfig
	}{
		{
			name: "full local backup",
			cfg:  &backupmodel.BackupConfig{ID: 7, BackupType: "full", Provider: "local"},
		},
		{
			name: "incremental s3 backup",
			cfg:  &backupmodel.BackupConfig{ID: 42, BackupType: "incremental", Provider: "s3"},
		},
		{
			name: "zero id still yields non-nil pointer",
			cfg:  &backupmodel.BackupConfig{ID: 0, BackupType: "full", Provider: "azure"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			run := newScheduledBackupRun(tt.cfg)

			if run == nil {
				t.Fatal("newScheduledBackupRun returned nil")
			}
			if run.ConfigID == nil {
				t.Fatal("ConfigID is nil, want pointer to config ID")
			}
			if *run.ConfigID != tt.cfg.ID {
				t.Errorf("*ConfigID = %d, want %d", *run.ConfigID, tt.cfg.ID)
			}
			if run.RunType != "backup" {
				t.Errorf("RunType = %q, want backup", run.RunType)
			}
			if run.Status != "queued" {
				t.Errorf("Status = %q, want queued", run.Status)
			}
			if run.BackupType != tt.cfg.BackupType {
				t.Errorf("BackupType = %q, want %q", run.BackupType, tt.cfg.BackupType)
			}
			if run.Provider != tt.cfg.Provider {
				t.Errorf("Provider = %q, want %q", run.Provider, tt.cfg.Provider)
			}
			if !json.Valid(run.Metadata) {
				t.Fatalf("Metadata is not valid json: %q", string(run.Metadata))
			}
			var meta map[string]string
			if err := json.Unmarshal(run.Metadata, &meta); err != nil {
				t.Fatalf("unmarshal metadata: %v", err)
			}
			if meta["trigger"] != "scheduled" {
				t.Errorf("metadata trigger = %q, want scheduled", meta["trigger"])
			}
		})
	}
}

func TestSetupLogger(t *testing.T) {
	// setupLogger mutates zerolog's global level; restore it afterwards so this
	// test cannot leak state into others.
	original := zerolog.GlobalLevel()
	t.Cleanup(func() { zerolog.SetGlobalLevel(original) })

	tests := []struct {
		name  string
		level string
		want  zerolog.Level
	}{
		{"trace", "trace", zerolog.TraceLevel},
		{"debug", "debug", zerolog.DebugLevel},
		{"info", "info", zerolog.InfoLevel},
		{"warn", "warn", zerolog.WarnLevel},
		{"error", "error", zerolog.ErrorLevel},
		{"unrecognized falls back to info", "not-a-real-level", zerolog.InfoLevel},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Keep the console-writer branch off so we don't swap the global
			// logger sink during the test run.
			t.Setenv("TESLASYNC_DEV", "")
			// Start from a distinct level so a no-op wouldn't accidentally pass.
			zerolog.SetGlobalLevel(zerolog.Disabled)

			setupLogger(tt.level)

			if got := zerolog.GlobalLevel(); got != tt.want {
				t.Fatalf("setupLogger(%q) set level %v, want %v", tt.level, got, tt.want)
			}
		})
	}
}

func TestWorkerTracer(t *testing.T) {
	tr := workerTracer()
	if tr == nil {
		t.Fatal("workerTracer() returned nil")
	}
	// The returned tracer must be usable without panicking even when no
	// TracerProvider is configured (the default no-op provider).
	_, span := tr.Start(context.Background(), "unit-test-span")
	if span == nil {
		t.Fatal("tracer.Start returned a nil span")
	}
	span.End()

	if second := workerTracer(); second == nil {
		t.Fatal("second workerTracer() call returned nil")
	}
}
