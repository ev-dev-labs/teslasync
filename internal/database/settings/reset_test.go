package settings

// settings_reset orchestrator unit tests.
//
// The DELETE statements themselves require a live PostgreSQL pool, so
// SQL coverage lives in the API handler tests (which use an in-memory
// stub TxRunner). These tests cover the parts that are pure-Go and
// easily verifiable without a database round-trip:
//
//   - CanonicalResetSection accepts whitelisted names + rejects denied
//     and unknown ones with the right sentinel errors.
//   - IsResetSectionDenied / SettingsResetDenyListReasons surface the
//     deny-list reasons for the SPA and don't share state across
//     callers (defensive copies).
//   - AllSettingsResetSections returns a defensive copy.
//   - ResetSections short-circuits on an empty slice (no transaction).
//   - ResetSections rejects unknown sections without opening a tx.
//   - ResetSections rejects quiet_hours when userID is empty.
//   - ResetSections returns an error when the runner is nil.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestCanonicalResetSection_AcceptsWhitelistedNames(t *testing.T) {
	for _, name := range []string{
		"general", "appearance", "alert_rules", "geofences",
		"notification_channels", "dashboard_layout", "automations",
		"quiet_hours",
	} {
		s, reason, err := CanonicalResetSection(name)
		if err != nil {
			t.Errorf("name=%q: unexpected error %v", name, err)
		}
		if reason != "" {
			t.Errorf("name=%q: reason should be empty, got %q", name, reason)
		}
		if string(s) != name {
			t.Errorf("name=%q: got section %q, want %q", name, s, name)
		}
	}
}

func TestCanonicalResetSection_NormalisesCaseAndWhitespace(t *testing.T) {
	cases := map[string]SettingsResetSection{
		"  Alert_Rules ":        ResetSectionAlertRules,
		"GENERAL":               ResetSectionGeneral,
		"\tquiet_hours\n":       ResetSectionQuietHours,
		"NOTIFICATION_CHANNELS": ResetSectionNotificationChannels,
	}
	for in, want := range cases {
		s, _, err := CanonicalResetSection(in)
		if err != nil {
			t.Errorf("input=%q: unexpected error %v", in, err)
		}
		if s != want {
			t.Errorf("input=%q: got %q, want %q", in, s, want)
		}
	}
}

func TestCanonicalResetSection_RejectsDeniedSections(t *testing.T) {
	for _, name := range []string{"tariffs", "sound_prefs", "  TARIFFS  "} {
		s, reason, err := CanonicalResetSection(name)
		if !errors.Is(err, ErrSettingsResetDenied) {
			t.Errorf("name=%q: want ErrSettingsResetDenied, got %v", name, err)
		}
		if s != "" {
			t.Errorf("name=%q: section should be empty on deny, got %q", name, s)
		}
		if reason == "" {
			t.Errorf("name=%q: deny reason should be non-empty", name)
		}
	}
}

func TestCanonicalResetSection_RejectsUnknown(t *testing.T) {
	for _, name := range []string{"", "  ", "bogus", "settings"} {
		_, reason, err := CanonicalResetSection(name)
		if !errors.Is(err, ErrSettingsResetUnknownSection) {
			t.Errorf("name=%q: want ErrSettingsResetUnknownSection, got %v", name, err)
		}
		if reason != "" {
			t.Errorf("name=%q: reason should be empty, got %q", name, reason)
		}
	}
}

func TestIsResetSectionDenied_MatchesDenyListEntries(t *testing.T) {
	if reason, ok := IsResetSectionDenied("tariffs"); !ok || reason == "" {
		t.Fatalf("tariffs should be denied; ok=%v reason=%q", ok, reason)
	}
	if reason, ok := IsResetSectionDenied("sound_prefs"); !ok || reason == "" {
		t.Fatalf("sound_prefs should be denied; ok=%v reason=%q", ok, reason)
	}
	if _, ok := IsResetSectionDenied("general"); ok {
		t.Fatalf("general must NOT be on deny-list")
	}
	if _, ok := IsResetSectionDenied(""); ok {
		t.Fatalf("empty name must NOT be denied")
	}
}

func TestSettingsResetDenyListReasons_ReturnsDefensiveCopy(t *testing.T) {
	first := SettingsResetDenyListReasons()
	if len(first) == 0 {
		t.Fatalf("expected at least one denied section")
	}
	first["bogus"] = "should not leak"
	second := SettingsResetDenyListReasons()
	if _, leaked := second["bogus"]; leaked {
		t.Fatalf("internal map leaked through to second caller")
	}
}

func TestAllSettingsResetSections_ReturnsDefensiveCopy(t *testing.T) {
	first := AllSettingsResetSections()
	if len(first) != 8 {
		t.Fatalf("expected 8 sections, got %d", len(first))
	}
	first[0] = "mutated"
	second := AllSettingsResetSections()
	if second[0] == "mutated" {
		t.Fatalf("internal slice leaked through to second caller")
	}
}

func TestAllSettingsResetSections_OrderIsStable(t *testing.T) {
	first := AllSettingsResetSections()
	second := AllSettingsResetSections()
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("section %d drifted between calls: %q vs %q", i, first[i], second[i])
		}
	}
}

// stubResetTxRunner records calls without touching pgx. Used to verify
// the orchestrator's flow without a live database.
type stubResetTxRunner struct {
	calls    int
	lastFn   func(ctx context.Context, tx pgx.Tx) error
	failWith error
}

func (s *stubResetTxRunner) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	s.calls++
	s.lastFn = fn
	return s.failWith
}

func TestResetSections_EmptyShortCircuits(t *testing.T) {
	stub := &stubResetTxRunner{}
	repo := NewSettingsResetRepoWithRunner(stub)
	got, err := repo.ResetSections(context.Background(), "alice", nil)
	if err != nil {
		t.Fatalf("ResetSections: %v", err)
	}
	if got == nil || got.Reset != 0 || len(got.Sections) != 0 {
		t.Fatalf("expected zero result, got %+v", got)
	}
	if stub.calls != 0 {
		t.Fatalf("runner should not be called for empty input; calls=%d", stub.calls)
	}
}

func TestResetSections_NilRepoReturnsError(t *testing.T) {
	var repo *SettingsResetRepo
	_, err := repo.ResetSections(context.Background(), "", nil)
	if err == nil {
		t.Fatalf("expected error from nil repo")
	}
}

func TestResetSections_NilRunnerReturnsError(t *testing.T) {
	repo := &SettingsResetRepo{runner: nil}
	_, err := repo.ResetSections(context.Background(), "", nil)
	if err == nil {
		t.Fatalf("expected error when runner is nil")
	}
}

func TestResetSections_RejectsUnknownSectionPreFlight(t *testing.T) {
	stub := &stubResetTxRunner{}
	repo := NewSettingsResetRepoWithRunner(stub)
	_, err := repo.ResetSections(context.Background(), "alice",
		[]SettingsResetSection{"bogus"})
	if !errors.Is(err, ErrSettingsResetUnknownSection) {
		t.Fatalf("want ErrSettingsResetUnknownSection, got %v", err)
	}
	if stub.calls != 0 {
		t.Fatalf("runner must not be called when a section is invalid; calls=%d", stub.calls)
	}
}

func TestResetSections_RejectsQuietHoursWithoutUser(t *testing.T) {
	stub := &stubResetTxRunner{}
	repo := NewSettingsResetRepoWithRunner(stub)
	_, err := repo.ResetSections(context.Background(), "  ",
		[]SettingsResetSection{ResetSectionQuietHours})
	if !errors.Is(err, ErrSettingsResetQuietHoursRequiresUser) {
		t.Fatalf("want ErrSettingsResetQuietHoursRequiresUser, got %v", err)
	}
	if stub.calls != 0 {
		t.Fatalf("runner must not be called when quiet_hours is missing user; calls=%d", stub.calls)
	}
}

func TestResetSections_PropagatesRunnerError(t *testing.T) {
	wantErr := errors.New("boom")
	stub := &stubResetTxRunner{failWith: wantErr}
	repo := NewSettingsResetRepoWithRunner(stub)
	_, err := repo.ResetSections(context.Background(), "alice",
		[]SettingsResetSection{ResetSectionAlertRules})
	if err == nil || !strings.Contains(err.Error(), wantErr.Error()) {
		// the orchestrator may wrap the error; we just need the
		// underlying message to surface so the handler logs are useful.
		// Checking by Is() is brittle when the runner returns the raw
		// error from fn (which the tx code wraps with %w deeper down).
		if !errors.Is(err, wantErr) {
			t.Fatalf("error not propagated; got %v", err)
		}
	}
	if stub.calls != 1 {
		t.Fatalf("runner should be called exactly once; calls=%d", stub.calls)
	}
}

func TestResetSections_NonQuietHoursWorksWithEmptyUser(t *testing.T) {
	// Other sections are install-global so pre-flight should not
	// trip the missing-user guard. We don't actually run the SQL —
	// the stub runner returns nil without invoking fn — so this test
	// confirms the pre-flight gate is correctly per-section.
	stub := &stubResetTxRunner{}
	repo := NewSettingsResetRepoWithRunner(stub)
	got, err := repo.ResetSections(context.Background(), "",
		[]SettingsResetSection{ResetSectionAlertRules, ResetSectionGeofences})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatalf("expected non-nil result")
	}
	if stub.calls != 1 {
		t.Fatalf("runner should be called exactly once; calls=%d", stub.calls)
	}
}

func TestNewSettingsResetRepo_NilDoesNotPanic(t *testing.T) {
	// Defensive: NewSettingsResetRepo(nil) constructs a repo whose
	// runner has a nil *database.DB. Calling ResetSections on it should fail
	// at the runner boundary, not panic, when actually used. We don't
	// invoke a section here (would need pgx.Tx) — just confirm
	// construction succeeds and the value is non-nil.
	repo := NewSettingsResetRepo(nil)
	if repo == nil {
		t.Fatalf("constructor returned nil")
	}
}
