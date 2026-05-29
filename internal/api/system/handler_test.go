package system

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// TestVersionHandler_RequireCookieConsentDefaultsFalse verifies that the
// /system/version endpoint surfaces require_cookie_consent=false when
// the env knob is unset (the default for self-hosted installs).
//
// Guards against accidental flips of the default that would force every
// existing deployment to render a consent banner
// on next reload.
func TestVersionHandler_RequireCookieConsentDefaultsFalse(t *testing.T) {
	cfg := &config.Config{}
	h := VersionHandler("test-1.0.0", cfg)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/system/version", nil)
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	got, ok := resp["require_cookie_consent"]
	if !ok {
		t.Fatalf("response missing require_cookie_consent key; body=%s", rec.Body.String())
	}
	if got != false {
		t.Fatalf("require_cookie_consent: got %v want false", got)
	}
}

// TestVersionHandler_RequireCookieConsentTrue verifies that the env-on
// case propagates to the wire response so the SPA can mount its banner.
func TestVersionHandler_RequireCookieConsentTrue(t *testing.T) {
	cfg := &config.Config{RequireCookieConsent: true}
	h := VersionHandler("test-1.0.0", cfg)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/system/version", nil)
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	got, ok := resp["require_cookie_consent"]
	if !ok {
		t.Fatalf("response missing require_cookie_consent key; body=%s", rec.Body.String())
	}
	if got != true {
		t.Fatalf("require_cookie_consent: got %v want true", got)
	}
}

// TestLoadConfig_RequireCookieConsentDefault confirms that Load() reads
// TESLASYNC_REQUIRE_COOKIE_CONSENT and defaults it to false. We exercise
// the env-on case by setting the var, the env-off case via t.Setenv("",
// "") which clears any inherited value.
func TestLoadConfig_RequireCookieConsentDefault(t *testing.T) {
	t.Setenv("TESLASYNC_REQUIRE_COOKIE_CONSENT", "")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	if cfg.RequireCookieConsent {
		t.Fatalf("RequireCookieConsent should default to false; got true")
	}

	t.Setenv("TESLASYNC_REQUIRE_COOKIE_CONSENT", "true")
	cfg2, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	if !cfg2.RequireCookieConsent {
		t.Fatalf("RequireCookieConsent should be true when env=true; got false")
	}
}

// TestWorkersHealthHandler_PluralHostsExpandsToMultipleProbes verifies that
// when *_HOSTS is set, the handler emits one row per host with the same
// worker name. This is the "horizontally scaled worker" path the operator
// needs to monitor each replica.
func TestWorkersHealthHandler_PluralHostsExpandsToMultipleProbes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	t.Setenv("NOTIFICATION_WORKER_HOSTS", u.Hostname()+","+u.Hostname())
	t.Setenv("NOTIFICATION_WORKER_PORT", u.Port())
	// Force the other workers to a single unreachable host so they don't
	// dominate the assertion. We only care about the notification group here.
	t.Setenv("EXPORT_WORKER_HOST", "127.0.0.1")
	t.Setenv("EXPORT_WORKER_PORT", "1")
	t.Setenv("AUTOMATION_WORKER_HOST", "127.0.0.1")
	t.Setenv("AUTOMATION_WORKER_PORT", "1")

	rec := httptest.NewRecorder()
	WorkersHealthHandler()(rec, httptest.NewRequest(http.MethodGet, "/system/workers", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	var resp struct {
		Workers []struct {
			Name   string `json:"name"`
			Host   string `json:"host"`
			Status string `json:"status"`
		} `json:"workers"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// HOSTS dedupes identical entries — we passed the same hostname twice
	// on purpose to exercise the dedupe path. So we expect 1 notification
	// row + 1 export row + 1 automation row = 3 total.
	if resp.Total != 3 {
		t.Fatalf("total: got %d want 3 (dedupe should collapse the duplicate notification host)", resp.Total)
	}
	notifs := 0
	for _, w := range resp.Workers {
		if w.Name == "notification-worker" {
			notifs++
			if w.Status != "healthy" {
				t.Fatalf("notification-worker status: got %q want healthy", w.Status)
			}
		}
	}
	if notifs != 1 {
		t.Fatalf("notification-worker rows: got %d want 1 (deduped)", notifs)
	}
}

// TestWorkersHealthHandler_BackwardCompatSingleHost confirms the legacy
// *_HOST (singular) path still works with a single value.
func TestWorkersHealthHandler_BackwardCompatSingleHost(t *testing.T) {
	t.Setenv("NOTIFICATION_WORKER_HOSTS", "")
	t.Setenv("EXPORT_WORKER_HOSTS", "")
	t.Setenv("AUTOMATION_WORKER_HOSTS", "")
	t.Setenv("NOTIFICATION_WORKER_HOST", "127.0.0.1")
	t.Setenv("NOTIFICATION_WORKER_PORT", "1")
	t.Setenv("EXPORT_WORKER_HOST", "127.0.0.1")
	t.Setenv("EXPORT_WORKER_PORT", "1")
	t.Setenv("AUTOMATION_WORKER_HOST", "127.0.0.1")
	t.Setenv("AUTOMATION_WORKER_PORT", "1")

	rec := httptest.NewRecorder()
	WorkersHealthHandler()(rec, httptest.NewRequest(http.MethodGet, "/system/workers", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	var resp struct {
		Workers []struct {
			Name string `json:"name"`
		} `json:"workers"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Total != 3 {
		t.Fatalf("total: got %d want 3 (one per worker name)", resp.Total)
	}
}

// TestWorkersHealthHandler_SingleHostCommaExpands verifies that operators
// can list multiple hosts in the singular *_HOST var without renaming —
// the handler treats a comma-separated singular value as plural.
func TestWorkersHealthHandler_SingleHostCommaExpands(t *testing.T) {
	t.Setenv("NOTIFICATION_WORKER_HOSTS", "")
	t.Setenv("NOTIFICATION_WORKER_HOST", "127.0.0.1,localhost")
	t.Setenv("NOTIFICATION_WORKER_PORT", "1")
	t.Setenv("EXPORT_WORKER_HOST", "127.0.0.1")
	t.Setenv("EXPORT_WORKER_PORT", "1")
	t.Setenv("AUTOMATION_WORKER_HOST", "127.0.0.1")
	t.Setenv("AUTOMATION_WORKER_PORT", "1")

	rec := httptest.NewRecorder()
	WorkersHealthHandler()(rec, httptest.NewRequest(http.MethodGet, "/system/workers", nil))

	var resp struct {
		Workers []struct {
			Name string `json:"name"`
			Host string `json:"host"`
		} `json:"workers"`
		Total int `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	notifs := 0
	for _, w := range resp.Workers {
		if w.Name == "notification-worker" {
			notifs++
		}
	}
	if notifs != 2 {
		t.Fatalf("notification-worker rows: got %d want 2 (singular var split on comma)", notifs)
	}
}
