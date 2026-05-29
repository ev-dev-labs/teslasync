package aiusage

// Phase-50 / 0009 — F8 AI Admin Handler tests.
//
// Pure handler-layer coverage that mirrors ai_usage_handler_test.go's
// structure: fake settings + parseAdminSince validators, no DB.
//
// What we DON'T test here:
//   - Repo SQL (covered by ai_call_log_repo_test.go).
//   - guard.Wrap behaviour (covered by internal/ai/guard tests in F0).
// What we DO test here:
//   - adminGuardSettings carve-out: __redaction_bypass__ tracks AIMode;
//     everything else passes through to the inner Settings.
//   - parseAdminSince accepts RFC3339, duration, and default.
//   - Construction-time guard for nil repo.

import (
	"context"
	"errors"
	"testing"
	"time"
)

// TestAdminGuardSettings_RedactionBypassTracksMode pins the special-case
// carve-out: __redaction_bypass__'s "feature enabled" derives from
// AIMode rather than from the per-feature toggle.
func TestAdminGuardSettings_RedactionBypassTracksMode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		mode string
		want bool
	}{
		{"off", false},
		{"local", true},
		{"cloud", true},
		{"unknown-future-mode", true},
	}
	for _, tc := range tests {
		inner := fakeGuardSettings{mode: tc.mode}
		w := adminGuardSettings{inner: inner}
		got, err := w.AIFeatureEnabled(context.Background(), AIAdminRedactionBypassFeatureID)
		if err != nil {
			t.Fatalf("mode=%s err=%v", tc.mode, err)
		}
		if got != tc.want {
			t.Errorf("mode=%s AIFeatureEnabled(__redaction_bypass__) = %v, want %v", tc.mode, got, tc.want)
		}
	}
}

// TestAdminGuardSettings_PassThroughForOtherFeatures pins the symmetry:
// every non-meta feature ID delegates to the inner settings.
func TestAdminGuardSettings_PassThroughForOtherFeatures(t *testing.T) {
	t.Parallel()
	inner := fakeGuardSettings{
		mode:     "local",
		features: map[string]bool{"chatbot-llm": true, "ai-provider-health": false},
	}
	w := adminGuardSettings{inner: inner}

	for id, want := range inner.features {
		got, err := w.AIFeatureEnabled(context.Background(), id)
		if err != nil {
			t.Fatalf("id=%s err=%v", id, err)
		}
		if got != want {
			t.Errorf("id=%s AIFeatureEnabled = %v, want %v", id, got, want)
		}
	}
}

// TestAdminGuardSettings_AIModeError pins fail-closed on the inner
// AIMode error path: __redaction_bypass__ MUST NOT report enabled
// when we cannot even read the mode (ADR-015 §I1 default-off).
func TestAdminGuardSettings_AIModeError(t *testing.T) {
	t.Parallel()
	want := errors.New("settings explosion")
	inner := fakeGuardSettings{modeErr: want}
	w := adminGuardSettings{inner: inner}
	got, err := w.AIFeatureEnabled(context.Background(), AIAdminRedactionBypassFeatureID)
	if !errors.Is(err, want) {
		t.Errorf("expected wrapped error, got %v", err)
	}
	if got {
		t.Error("AIFeatureEnabled must be false on AIMode error")
	}
}

// TestParseAdminSince_DefaultsToSevenDays pins the empty-input fallback.
func TestParseAdminSince_DefaultsToSevenDays(t *testing.T) {
	t.Parallel()
	got, err := parseAdminSince("")
	if err != nil {
		t.Fatalf("parseAdminSince(): %v", err)
	}
	delta := time.Now().UTC().Sub(got)
	if delta < adminDefaultBypassWindow-time.Second || delta > adminDefaultBypassWindow+time.Second {
		t.Errorf("default window delta = %v, want ~%v", delta, adminDefaultBypassWindow)
	}
}

func TestParseAdminSince_AcceptsRFC3339(t *testing.T) {
	t.Parallel()
	want := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	got, err := parseAdminSince(want.Format(time.RFC3339))
	if err != nil {
		t.Fatalf("parseAdminSince RFC3339: %v", err)
	}
	if !got.Equal(want) {
		t.Errorf("parsed = %v, want %v", got, want)
	}
}

func TestParseAdminSince_AcceptsDuration(t *testing.T) {
	t.Parallel()
	got, err := parseAdminSince("48h")
	if err != nil {
		t.Fatalf("parseAdminSince duration: %v", err)
	}
	delta := time.Now().UTC().Sub(got)
	if delta < 47*time.Hour || delta > 49*time.Hour {
		t.Errorf("duration delta = %v, want ~48h", delta)
	}
}

func TestParseAdminSince_RejectsNegativeDuration(t *testing.T) {
	t.Parallel()
	if _, err := parseAdminSince("-1h"); err == nil {
		t.Fatal("expected error for negative duration")
	}
}

func TestParseAdminSince_RejectsGarbage(t *testing.T) {
	t.Parallel()
	if _, err := parseAdminSince("not-a-time"); err == nil {
		t.Fatal("expected error for garbage input")
	}
}

func TestNewAdminHandler_NilRepoPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic on nil repo")
		}
	}()
	NewAdminHandler(nil)
}
