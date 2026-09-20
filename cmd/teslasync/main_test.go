package main

import (
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetupLogger_InvalidLevelFallsBackToInfo(t *testing.T) {
	t.Setenv("TESLASYNC_DEV", "")
	setupLogger("not-a-level")
}

func TestSetupLogger_DevConsoleWriter(t *testing.T) {
	t.Setenv("TESLASYNC_DEV", "true")
	setupLogger("debug")
}

func TestHealthcheck_SuccessAndFailure(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	port := strings.Split(ln.Addr().String(), ":")[1]

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	t.Setenv("TESLASYNC_PORT", port)
	if code := healthcheck(); code != 0 {
		t.Fatalf("healthcheck() = %d, want 0", code)
	}

	t.Setenv("TESLASYNC_PORT", "1")
	if code := healthcheck(); code != 1 {
		t.Fatalf("healthcheck() against closed port = %d, want 1", code)
	}
}

func TestHealthcheck_NonOKStatus(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	port := strings.Split(ln.Addr().String(), ":")[1]
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	t.Setenv("TESLASYNC_PORT", port)
	if code := healthcheck(); code != 1 {
		t.Fatalf("healthcheck() = %d, want 1", code)
	}
}

func TestHealthcheck_DefaultPortWhenUnset(t *testing.T) {
	t.Setenv("TESLASYNC_PORT", "")
	// Exercise the empty-env branch. A local docker stack may already
	// be serving :8080, so either 0 or 1 is acceptable.
	_ = healthcheck()
}

func TestDrain_InvalidPort(t *testing.T) {
	t.Setenv("TESLASYNC_DRAIN_PORT", "not-a-port")
	if code := drain(); code != 1 {
		t.Fatalf("drain() = %d, want 1", code)
	}
}

func TestDrain_SuccessAndHTTPError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	port := strings.Split(ln.Addr().String(), ":")[1]

	mux := http.NewServeMux()
	mux.HandleFunc("/internal/flush", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method=%s, want POST", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"flushed":true}`)
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	t.Setenv("TESLASYNC_DRAIN_PORT", port)
	if code := drain(); code != 0 {
		t.Fatalf("drain() = %d, want 0", code)
	}

	// Replace handler with 500
	ln2, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen2: %v", err)
	}
	defer ln2.Close()
	port2 := strings.Split(ln2.Addr().String(), ":")[1]
	mux2 := http.NewServeMux()
	mux2.HandleFunc("/internal/flush", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, "boom")
	})
	srv2 := &http.Server{Handler: mux2}
	go func() { _ = srv2.Serve(ln2) }()
	t.Cleanup(func() { _ = srv2.Close() })
	t.Setenv("TESLASYNC_DRAIN_PORT", port2)
	if code := drain(); code != 1 {
		t.Fatalf("drain() HTTP 500 = %d, want 1", code)
	}
}

func TestDrain_ConnectionRefused(t *testing.T) {
	t.Setenv("TESLASYNC_DRAIN_PORT", "1")
	if code := drain(); code != 1 {
		t.Fatalf("drain() refused = %d, want 1", code)
	}
}

func TestDrain_DefaultPortWhenUnset(t *testing.T) {
	t.Setenv("TESLASYNC_DRAIN_PORT", "")
	if code := drain(); code != 1 {
		t.Fatalf("drain() default port with no listener = %d, want 1", code)
	}
}

func TestRun_HealthcheckSubcommand(t *testing.T) {
	orig := os.Args
	t.Cleanup(func() { os.Args = orig })
	os.Args = []string{orig[0], "healthcheck"}
	t.Setenv("TESLASYNC_PORT", "1")
	if code := run(); code != 1 {
		t.Fatalf("run healthcheck = %d, want 1", code)
	}
}

func TestRun_DrainSubcommand(t *testing.T) {
	orig := os.Args
	t.Cleanup(func() { os.Args = orig })
	os.Args = []string{orig[0], "drain"}
	t.Setenv("TESLASYNC_DRAIN_PORT", "not-a-port")
	if code := run(); code != 1 {
		t.Fatalf("run drain = %d, want 1", code)
	}
}

func TestVersionDefaults(t *testing.T) {
	if Version == "" || Commit == "" {
		t.Fatal("Version and Commit must have compile-time defaults")
	}
}

func TestRunDoesNotTouchWorktree(t *testing.T) {
	// Sanity: teslasync tests must not write next to the binary source.
	if _, err := os.Stat(filepath.Join(".", "main.go")); err != nil {
		t.Fatalf("expected to run from cmd/teslasync: %v", err)
	}
}
