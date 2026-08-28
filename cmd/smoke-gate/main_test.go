package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeDeployment stands in for a deployed TeslaSync stack. It records
// whether the authenticated routes actually received the identity
// header, which is the whole point of an *authenticated* smoke gate.
type fakeDeployment struct {
	sawAuthHeader   map[string]string
	failReadyz      bool
	reportDraining  bool
	drainStatusHits int
	// flushHits counts hits on the MUTATING drain endpoint. The smoke
	// gate must never touch it; a non-zero value is a test failure.
	flushHits int
}

func newFakeDeployment() (*fakeDeployment, *httptest.Server) {
	d := &fakeDeployment{sawAuthHeader: map[string]string{}}
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if d.failReadyz {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"draining"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"database":"ok"}`))
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("# HELP teslasync_up\nteslasync_up 1\n"))
	})
	// The READ-ONLY drain contract. The mutating /internal/flush endpoint
	// is deliberately absent from this fake: it lives on the isolated
	// drain listener that no Service publishes, so a smoke gate could not
	// reach it even if someone re-added the probe.
	mux.HandleFunc("/internal/drain-status", func(w http.ResponseWriter, r *http.Request) {
		d.drainStatusHits++
		w.Header().Set("Content-Type", "application/json")
		if d.reportDraining {
			_, _ = w.Write([]byte(`{"draining":true,"drain_endpoint":"/internal/flush","internal_port":8090,"propagation_delay_seconds":5}`))
			return
		}
		_, _ = w.Write([]byte(`{"draining":false,"drain_endpoint":"/internal/flush","internal_port":8090,"propagation_delay_seconds":5}`))
	})
	mux.HandleFunc("/internal/flush", func(w http.ResponseWriter, _ *http.Request) {
		d.flushHits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"flushed"}`))
	})
	mux.HandleFunc("/api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		d.sawAuthHeader["sse-stream-headers"] = r.Header.Get("X-Forwarded-User")
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			_, _ = w.Write([]byte("event: connected\ndata: {}\n\n"))
			f.Flush()
		}
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			d.sawAuthHeader[r.URL.Path] = r.Header.Get("X-Forwarded-User")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[]}`))
		default:
			_, _ = w.Write([]byte(`<!doctype html><html><body><div id="root"></div></body></html>`))
		}
	})
	return d, httptest.NewServer(mux)
}

func env(vals map[string]string) func(string) string {
	return func(k string) string { return vals[k] }
}

func TestRun_PassesAgainstAHealthyDeployment(t *testing.T) {
	dep, srv := newFakeDeployment()
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-root", "../..", "-base-url", srv.URL},
		&stdout, &stderr,
		env(map[string]string{"SMOKE_FORWARD_AUTH_USER": "smoke@example.test"}),
	)
	if code != 0 {
		t.Fatalf("exit = %d\nstdout:\n%s\nstderr:\n%s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "post-deploy smoke gate passed") {
		t.Fatalf("unexpected report:\n%s", stdout.String())
	}
	// The gate must actually authenticate, not just fetch public routes.
	if got := dep.sawAuthHeader["/api/v1/vehicles"]; got != "smoke@example.test" {
		t.Fatalf("authenticated check did not send the identity header (got %q)", got)
	}
	if got := dep.sawAuthHeader["sse-stream-headers"]; got != "smoke@example.test" {
		t.Fatalf("SSE check did not send the identity header (got %q)", got)
	}
}

// TestRun_RefusesToRunWithoutCredentials is the honesty guarantee: an
// unauthenticated run must never be reported as a passing gate.
func TestRun_RefusesToRunWithoutCredentials(t *testing.T) {
	_, srv := newFakeDeployment()
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", "../..", "-base-url", srv.URL}, &stdout, &stderr, env(nil))
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "SMOKE_FORWARD_AUTH_USER") {
		t.Fatalf("error should name the missing variable: %s", stderr.String())
	}
	if strings.Contains(stdout.String(), "passed") {
		t.Fatal("a credential-less run must never print a pass")
	}
}

func TestRun_FailsWhenACriticalCheckFails(t *testing.T) {
	dep, srv := newFakeDeployment()
	defer srv.Close()
	dep.failReadyz = true

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-root", "../..", "-base-url", srv.URL},
		&stdout, &stderr,
		env(map[string]string{"SMOKE_FORWARD_AUTH_USER": "smoke@example.test"}),
	)
	if code != 1 {
		t.Fatalf("exit = %d, want 1\n%s", code, stdout.String())
	}
	if !strings.Contains(stdout.String(), "FAIL readiness") {
		t.Fatalf("failing check not reported:\n%s", stdout.String())
	}
}

// TestRun_NeverTouchesTheMutatingDrainEndpoint is the review-finding-1
// regression. The old manifest probed /internal/flush, which drained the
// pod the gate had just verified, released its SSE streams, left
// readiness at 503 forever, and then failed the check on its own latency
// budget because the handler sleeps for the propagation delay.
func TestRun_NeverTouchesTheMutatingDrainEndpoint(t *testing.T) {
	dep, srv := newFakeDeployment()
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-root", "../..", "-base-url", srv.URL},
		&stdout, &stderr,
		env(map[string]string{"SMOKE_FORWARD_AUTH_USER": "smoke@example.test"}),
	)
	if code != 0 {
		t.Fatalf("exit = %d\n%s\n%s", code, stdout.String(), stderr.String())
	}
	if dep.flushHits != 0 {
		t.Fatalf("the smoke gate hit the pod-fatal drain endpoint %d time(s); it must only read %s", dep.flushHits, "/internal/drain-status")
	}
	if dep.drainStatusHits == 0 {
		t.Fatal("the smoke gate no longer asserts the drain contract at all")
	}
}

// TestRun_FailsWhenThePodIsAlreadyDraining: the read-only contract still
// has to be able to fail, or it is decoration.
func TestRun_FailsWhenThePodIsAlreadyDraining(t *testing.T) {
	dep, srv := newFakeDeployment()
	defer srv.Close()
	dep.reportDraining = true

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-root", "../..", "-base-url", srv.URL},
		&stdout, &stderr,
		env(map[string]string{"SMOKE_FORWARD_AUTH_USER": "smoke@example.test"}),
	)
	if code != 1 {
		t.Fatalf("exit = %d, want 1\n%s", code, stdout.String())
	}
	if !strings.Contains(stdout.String(), "drain-contract") {
		t.Fatalf("a draining pod was not reported:\n%s", stdout.String())
	}
	if dep.flushHits != 0 {
		t.Fatalf("the failing path still hit the mutating drain endpoint %d time(s)", dep.flushHits)
	}
}

func TestRun_RequiresBaseURL(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-root", "../.."}, &stdout, &stderr, env(nil)); code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "-base-url is required") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRun_RejectsAnInvalidManifest(t *testing.T) {
	dir := t.TempDir()
	manifest := filepath.Join(dir, "checks.yaml")
	if err := os.WriteFile(manifest, []byte("version: 1\ndefaults:\n  timeout: 1s\n  max_latency: 1s\n  expect_status: [200]\nauth:\n  mode: nonsense\n  header: X\n  value_env: Y\nchecks: []\n"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	var stdout, stderr bytes.Buffer
	code := run([]string{"-root", dir, "-manifest", "checks.yaml", "-base-url", "http://localhost:1"}, &stdout, &stderr, env(nil))
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "invalid manifest") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRun_WritesJSONAndSummary(t *testing.T) {
	_, srv := newFakeDeployment()
	defer srv.Close()
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "report.json")
	summaryPath := filepath.Join(dir, "summary.md")

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-root", "../..", "-base-url", srv.URL, "-json", jsonPath, "-summary", summaryPath},
		&stdout, &stderr,
		env(map[string]string{"SMOKE_FORWARD_AUTH_USER": "smoke@example.test"}),
	)
	if code != 0 {
		t.Fatalf("exit = %d: %s", code, stdout.String())
	}

	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatalf("read json: %v", err)
	}
	var report struct {
		Passed   bool `json:"passed"`
		Outcomes []struct {
			ID     string `json:"id"`
			Passed bool   `json:"passed"`
		} `json:"outcomes"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if !report.Passed || len(report.Outcomes) == 0 {
		t.Fatalf("unexpected report: %+v", report)
	}

	summary, err := os.ReadFile(summaryPath)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	if !strings.Contains(string(summary), "Post-deploy smoke gate") {
		t.Fatalf("summary = %s", summary)
	}
}
