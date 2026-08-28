package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func at() time.Time { return time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC) }

func env(vals map[string]string) func(string) string {
	return func(k string) string { return vals[k] }
}

func TestBuildAnnotation_CarriesBuildIdentityAndFlags(t *testing.T) {
	opt := &options{
		action:      "deploy",
		version:     "1.4.2",
		commit:      "0123456789abcdef0123456789abcdef01234567",
		environment: "production",
		stage:       "canary",
		flags:       "ai-provider-live-calls, tesla-command-writes",
	}
	a := buildAnnotation(opt, at())

	wantTags := []string{
		"release",
		"action:deploy",
		"version:1.4.2",
		"sha:0123456789ab",
		"env:production",
		"stage:canary",
		"flag:ai-provider-live-calls",
		"flag:tesla-command-writes",
	}
	got := strings.Join(a.Tags, " ")
	for _, want := range wantTags {
		if !strings.Contains(got, want) {
			t.Errorf("tags missing %q; got %s", want, got)
		}
	}
	if a.Time != at().UnixMilli() {
		t.Errorf("time = %d, want %d", a.Time, at().UnixMilli())
	}
	for _, want := range []string{"DEPLOY", "1.4.2", "production", "0123456789ab", "canary", "high-risk flags enabled"} {
		if !strings.Contains(a.Text, want) {
			t.Errorf("text missing %q; got %s", want, a.Text)
		}
	}
}

func TestRun_PostsToGrafana(t *testing.T) {
	var received annotation
	var authHeader string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/annotations" {
			t.Errorf("path = %s", r.URL.Path)
		}
		authHeader = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":1,"message":"Annotation added"}`))
	}))
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-action", "deploy", "-version", "1.4.2", "-commit", "abcdef1234567890", "-environment", "staging"},
		&stdout, &stderr,
		env(map[string]string{"GRAFANA_URL": srv.URL, "GRAFANA_TOKEN": "tok"}),
		at,
	)
	if code != 0 {
		t.Fatalf("exit = %d: %s", code, stderr.String())
	}
	if authHeader != "Bearer tok" {
		t.Fatalf("Authorization = %q", authHeader)
	}
	if !strings.Contains(strings.Join(received.Tags, " "), "sha:abcdef123456") {
		t.Fatalf("build SHA not in tags: %v", received.Tags)
	}
}

// TestRun_MissingGrafanaIsANoOp: annotations are observability metadata.
// A deploy must never fail because Grafana is not configured.
func TestRun_MissingGrafanaIsANoOp(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-version", "1.0.0", "-commit", "abc123"},
		&stdout, &stderr, env(nil), at,
	)
	if code != 0 {
		t.Fatalf("exit = %d, want 0 (a missing Grafana must not fail a deploy): %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "GRAFANA_URL is unset") {
		t.Fatalf("stdout = %s", stdout.String())
	}
}

func TestRun_RequiresVersionAndCommit(t *testing.T) {
	tests := [][]string{
		{"-version", "1.0.0"},
		{"-commit", "abc123"},
		{},
	}
	for _, args := range tests {
		var stdout, stderr bytes.Buffer
		if code := run(args, &stdout, &stderr, env(nil), at); code != 1 {
			t.Fatalf("args %v: exit = %d, want 1", args, code)
		}
		if !strings.Contains(stderr.String(), "required") {
			t.Fatalf("args %v: stderr = %s", args, stderr.String())
		}
	}
}

func TestRun_RejectsUnknownAction(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"-action", "yolo", "-version", "1", "-commit", "a"}, &stdout, &stderr, env(nil), at)
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "must be one of") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRun_FailsWhenTokenMissingButURLSet(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-version", "1", "-commit", "a"},
		&stdout, &stderr,
		env(map[string]string{"GRAFANA_URL": "https://grafana.example"}),
		at,
	)
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "GRAFANA_TOKEN") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRun_PropagatesGrafanaError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"permission denied"}`))
	}))
	defer srv.Close()

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-version", "1", "-commit", "a"},
		&stdout, &stderr,
		env(map[string]string{"GRAFANA_URL": srv.URL, "GRAFANA_TOKEN": "tok"}),
		at,
	)
	if code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "403") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRun_DryRunPrintsPayload(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"-version", "1.0.0", "-commit", "abc123", "-dry-run"},
		&stdout, &stderr,
		env(map[string]string{"GRAFANA_URL": "https://grafana.example", "GRAFANA_TOKEN": "tok"}),
		at,
	)
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(stdout.String(), `"tags"`) {
		t.Fatalf("dry run did not print the payload: %s", stdout.String())
	}
}

func TestShortSHA(t *testing.T) {
	tests := map[string]string{
		"0123456789abcdef0123456789abcdef01234567": "0123456789ab",
		"abc123":  "abc123",
		"":        "",
		"  abc  ": "abc",
	}
	for in, want := range tests {
		if got := shortSHA(in); got != want {
			t.Errorf("shortSHA(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSplitFlags(t *testing.T) {
	if got := splitFlags(" a , b ,, c "); len(got) != 3 || got[0] != "a" || got[2] != "c" {
		t.Fatalf("splitFlags = %v", got)
	}
	if got := splitFlags(""); got != nil {
		t.Fatalf("splitFlags(\"\") = %v, want nil", got)
	}
}
