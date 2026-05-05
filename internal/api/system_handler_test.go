package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// TestVersionHandler_RequireCookieConsentDefaultsFalse verifies that the
// /system/version endpoint surfaces require_cookie_consent=false when
// the env knob is unset (the default for self-hosted installs).
//
// Phase-46 / Prompt 70 — guards against accidental flips of the default
// that would force every existing deployment to render a consent banner
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
