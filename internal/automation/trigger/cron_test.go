package trigger

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeCronRepo is a CronRepo test double.
type fakeCronRepo struct {
	automations []CronAutomation
	err         error
	calls       int
}

func (r *fakeCronRepo) LoadEnabledScheduleTriggers(_ context.Context) ([]CronAutomation, error) {
	r.calls++
	if r.err != nil {
		return nil, r.err
	}
	return r.automations, nil
}

func cronAutomation(id int64, name, expr, tz string) CronAutomation {
	return CronAutomation{
		Automation: models.Automation{ID: id, Name: name, Enabled: true},
		Trigger:    models.AutomationStepTriggerSchedule{CronExpr: expr, Timezone: tz},
	}
}

func TestLoadTimezone(t *testing.T) {
	tests := []struct {
		name    string
		tz      string
		want    string
		wantErr bool
	}{
		{"empty defaults UTC", "", "UTC", false},
		{"valid IANA", "America/New_York", "America/New_York", false},
		{"invalid", "Not/AZone", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			loc, err := loadTimezone(tt.tz)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q", tt.tz)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if loc.String() != tt.want {
				t.Fatalf("loc = %q, want %q", loc.String(), tt.want)
			}
		})
	}
}

func TestNewCronTrigger_Initialized(t *testing.T) {
	tr := NewCronTrigger(&fakeCronRepo{}, &fakeEngine{})
	defer tr.Stop()
	if tr.RegisteredCount() != 0 {
		t.Fatalf("expected 0 registered, got %d", tr.RegisteredCount())
	}
	if tr.entries == nil {
		t.Fatal("entries map not initialized")
	}
}

func TestRegister_Valid(t *testing.T) {
	tr := NewCronTrigger(&fakeCronRepo{}, &fakeEngine{})
	defer tr.Stop()

	if err := tr.Register(cronAutomation(1, "morning", "0 8 * * *", "UTC")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tr.RegisteredCount() != 1 {
		t.Fatalf("expected 1 registered, got %d", tr.RegisteredCount())
	}
	if !tr.IsRegistered(1) {
		t.Fatal("expected automation 1 registered")
	}
	if tr.IsRegistered(2) {
		t.Fatal("automation 2 should not be registered")
	}
}

func TestRegister_EmptyTimezoneDefaultsUTC(t *testing.T) {
	tr := NewCronTrigger(&fakeCronRepo{}, &fakeEngine{})
	defer tr.Stop()
	if err := tr.Register(cronAutomation(1, "n", "@hourly", "")); err != nil {
		t.Fatalf("unexpected error with empty tz: %v", err)
	}
	if !tr.IsRegistered(1) {
		t.Fatal("expected automation registered with default tz")
	}
}

func TestRegister_ErrorCases(t *testing.T) {
	tests := []struct {
		name string
		ca   CronAutomation
	}{
		{"empty expr", cronAutomation(1, "n", "", "UTC")},
		{"invalid tz", cronAutomation(1, "n", "0 8 * * *", "Mars/Base")},
		{"invalid expr", cronAutomation(1, "n", "not a cron", "UTC")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tr := NewCronTrigger(&fakeCronRepo{}, &fakeEngine{})
			defer tr.Stop()
			if err := tr.Register(tt.ca); err == nil {
				t.Fatal("expected error, got nil")
			}
			if tr.RegisteredCount() != 0 {
				t.Fatalf("expected 0 registered after error, got %d", tr.RegisteredCount())
			}
		})
	}
}

func TestRegister_ReplacesExisting(t *testing.T) {
	tr := NewCronTrigger(&fakeCronRepo{}, &fakeEngine{})
	defer tr.Stop()

	if err := tr.Register(cronAutomation(1, "n", "0 8 * * *", "UTC")); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if err := tr.Register(cronAutomation(1, "n", "0 9 * * *", "UTC")); err != nil {
		t.Fatalf("re-register: %v", err)
	}
	if tr.RegisteredCount() != 1 {
		t.Fatalf("expected 1 entry after replace, got %d", tr.RegisteredCount())
	}
}

func TestUnregister(t *testing.T) {
	tr := NewCronTrigger(&fakeCronRepo{}, &fakeEngine{})
	defer tr.Stop()

	if err := tr.Register(cronAutomation(1, "n", "0 8 * * *", "UTC")); err != nil {
		t.Fatalf("register: %v", err)
	}
	tr.Unregister(1)
	if tr.IsRegistered(1) {
		t.Fatal("automation should be unregistered")
	}
	if tr.RegisteredCount() != 0 {
		t.Fatalf("expected 0 registered, got %d", tr.RegisteredCount())
	}
	// Unregistering a missing automation is a no-op.
	tr.Unregister(999)
}

func TestStart_RegistersValidSkipsInvalid(t *testing.T) {
	repo := &fakeCronRepo{automations: []CronAutomation{
		cronAutomation(1, "ok", "0 8 * * *", "UTC"),
		cronAutomation(2, "bad-expr", "totally invalid", "UTC"),
		cronAutomation(3, "bad-tz", "0 8 * * *", "Nowhere/Land"),
		cronAutomation(4, "ok2", "@daily", "UTC"),
	}}
	tr := NewCronTrigger(repo, &fakeEngine{})
	defer tr.Stop()

	if err := tr.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tr.RegisteredCount() != 2 {
		t.Fatalf("expected 2 valid registrations, got %d", tr.RegisteredCount())
	}
	if !tr.IsRegistered(1) || !tr.IsRegistered(4) {
		t.Fatal("expected valid automations 1 and 4 registered")
	}
	if tr.IsRegistered(2) || tr.IsRegistered(3) {
		t.Fatal("invalid automations must be skipped")
	}
}

func TestStart_RepoError(t *testing.T) {
	repo := &fakeCronRepo{err: errors.New("db down")}
	tr := NewCronTrigger(repo, &fakeEngine{})
	defer tr.Stop()

	err := tr.Start(context.Background())
	if err == nil {
		t.Fatal("expected error when repo fails")
	}
	if !errors.Is(err, repo.err) {
		t.Fatalf("expected wrapped repo error, got %v", err)
	}
}

func TestReload_ReplacesEntries(t *testing.T) {
	repo := &fakeCronRepo{automations: []CronAutomation{
		cronAutomation(1, "a", "0 8 * * *", "UTC"),
		cronAutomation(2, "b", "0 9 * * *", "UTC"),
	}}
	tr := NewCronTrigger(repo, &fakeEngine{})
	defer tr.Stop()

	if err := tr.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	if tr.RegisteredCount() != 2 {
		t.Fatalf("expected 2 after start, got %d", tr.RegisteredCount())
	}

	// Reload with a different set: automation 2 removed, 3 added.
	repo.automations = []CronAutomation{
		cronAutomation(1, "a", "0 8 * * *", "UTC"),
		cronAutomation(3, "c", "0 10 * * *", "UTC"),
	}
	if err := tr.Reload(context.Background()); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if tr.RegisteredCount() != 2 {
		t.Fatalf("expected 2 after reload, got %d", tr.RegisteredCount())
	}
	if !tr.IsRegistered(1) || !tr.IsRegistered(3) {
		t.Fatal("expected automations 1 and 3 after reload")
	}
	if tr.IsRegistered(2) {
		t.Fatal("automation 2 should be gone after reload")
	}
}

func TestReload_RepoError(t *testing.T) {
	repo := &fakeCronRepo{automations: []CronAutomation{
		cronAutomation(1, "a", "0 8 * * *", "UTC"),
	}}
	tr := NewCronTrigger(repo, &fakeEngine{})
	defer tr.Stop()
	if err := tr.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}

	repo.err = errors.New("db down")
	err := tr.Reload(context.Background())
	if err == nil {
		t.Fatal("expected error on reload repo failure")
	}
	if !errors.Is(err, repo.err) {
		t.Fatalf("expected wrapped repo error, got %v", err)
	}
}

func TestReload_SkipsInvalid(t *testing.T) {
	repo := &fakeCronRepo{automations: []CronAutomation{
		cronAutomation(1, "ok", "0 8 * * *", "UTC"),
		cronAutomation(2, "bad", "nope", "UTC"),
	}}
	tr := NewCronTrigger(repo, &fakeEngine{})
	defer tr.Stop()

	if err := tr.Reload(context.Background()); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if tr.RegisteredCount() != 1 {
		t.Fatalf("expected 1 valid registration, got %d", tr.RegisteredCount())
	}
	if !tr.IsRegistered(1) {
		t.Fatal("expected valid automation registered on reload")
	}
}

func TestFire_InvokesEngineWithSnapshot(t *testing.T) {
	eng := &fakeEngine{}
	tr := NewCronTrigger(&fakeCronRepo{}, eng)
	defer tr.Stop()

	tr.fire(42, "morning routine", "0 8 * * *")

	if eng.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", eng.callCount())
	}
	call, _ := eng.lastCall()
	if call.automationID != 42 {
		t.Fatalf("engine called with automation %d, want 42", call.automationID)
	}
	var snap cronSnapshot
	if err := json.Unmarshal(call.snapshot, &snap); err != nil {
		t.Fatalf("snapshot unmarshal: %v", err)
	}
	if snap.CronExpr != "0 8 * * *" {
		t.Fatalf("snapshot cron_expr = %q, want '0 8 * * *'", snap.CronExpr)
	}
	if _, err := time.Parse(time.RFC3339, snap.FiredAt); err != nil {
		t.Fatalf("snapshot fired_at is not RFC3339: %q (%v)", snap.FiredAt, err)
	}
}

func TestFire_EngineErrorDoesNotPanic(t *testing.T) {
	eng := &fakeEngine{err: errors.New("boom")}
	tr := NewCronTrigger(&fakeCronRepo{}, eng)
	defer tr.Stop()

	// Must not panic even though the engine returns an error.
	tr.fire(1, "n", "@daily")
	if eng.callCount() != 1 {
		t.Fatalf("expected engine invoked once, got %d", eng.callCount())
	}
}

func TestStop_WithoutStartIsSafe(t *testing.T) {
	tr := NewCronTrigger(&fakeCronRepo{}, &fakeEngine{})
	// Stop before Start must not hang or panic.
	done := make(chan struct{})
	go func() {
		tr.Stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Stop() hung when called without Start()")
	}
}
