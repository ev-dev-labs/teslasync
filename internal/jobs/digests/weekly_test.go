// Tests for RunWeekly. The off-mode and per-feature gate cases prove
// the cron is fail-closed even when the scheduler keeps ticking after
// an admin disables AI mid-week.

package digests

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeDigestSettings is a tiny in-memory implementation of
// WeeklySettingsReader for the unit tests. The zero value
// returns ai_mode=” (which is NOT 'off' but ALSO not 'cloud'/'local'
// — the function treats anything other than 'off' as on, then
// re-checks the per-feature toggle).
type fakeDigestSettings struct {
	mode       string
	modeErr    error
	enabled    map[string]bool
	enabledErr error
}

func (f fakeDigestSettings) AIMode(_ context.Context) (string, error) {
	return f.mode, f.modeErr
}

func (f fakeDigestSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	if f.enabledErr != nil {
		return false, f.enabledErr
	}
	return f.enabled[id], nil
}

// TestRunAIDigestWeekly_OffMode_NoFanout verifies that ai_mode='off'
// prevents LLM, tool, and push fan-out work. Pure Go is enough because
// the off-mode branch returns before any LLM or SQL work is issued.
func TestRunAIDigestWeekly_OffMode_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeDigestSettings{
		mode: rag.AIModeOff,
		// Toggle on; mode trumps it.
		enabled: map[string]bool{"digest-narration": true},
	}
	res, err := RunWeekly(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("off mode: unexpected err %v", err)
	}
	if res.Skipped != 1 {
		t.Errorf("off mode: Skipped = %d, want 1", res.Skipped)
	}
	if res.Narrated != 0 || res.Failed != 0 || res.VehiclesConsidered != 0 {
		t.Errorf("off mode: any non-zero work counter is a contract bug: %+v", res)
	}
}

// TestRunAIDigestWeekly_FeatureToggleOff_NoFanout proves the
// per-feature gate trips even when ai_mode is on.
// An admin who flips just the digest-narration toggle off mid-week
// must see the next tick no-op immediately — no waiting for a mode
// flip.
func TestRunAIDigestWeekly_FeatureToggleOff_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeDigestSettings{
		mode:    "cloud",
		enabled: map[string]bool{"digest-narration": false},
	}
	res, err := RunWeekly(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("toggle off: unexpected err %v", err)
	}
	if res.Skipped != 1 {
		t.Errorf("toggle off: Skipped = %d, want 1", res.Skipped)
	}
}

// TestRunAIDigestWeekly_OnMode_NoOp is the positive control. With
// both gates open the function returns a zeroed envelope (the
// fan-out implementation lands in a future slice). Pinning the
// shape today protects future slices from accidentally changing
// the contract.
func TestRunAIDigestWeekly_OnMode_NoOp(t *testing.T) {
	t.Parallel()
	settings := fakeDigestSettings{
		mode:    "cloud",
		enabled: map[string]bool{"digest-narration": true},
	}
	res, err := RunWeekly(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("on mode: unexpected err %v", err)
	}
	if res.Skipped != 0 {
		t.Errorf("on mode: Skipped = %d, want 0", res.Skipped)
	}
	// Narration fan-out is intentionally not wired yet.
	if res.Narrated != 0 || res.Failed != 0 || res.VehiclesConsidered != 0 {
		t.Errorf("on mode (stub): any non-zero work counter unexpected: %+v", res)
	}
}

// TestRunAIDigestWeekly_SettingsErrorIsFailClosed proves that
// settings-read failures do NOT cascade into a fan-out attempt —
// fail-closed semantics defend against a degraded settings table
// silently leaking narrations to off-mode users.
func TestRunAIDigestWeekly_SettingsErrorIsFailClosed(t *testing.T) {
	t.Parallel()
	t.Run("ai_mode read error", func(t *testing.T) {
		settings := fakeDigestSettings{modeErr: errors.New("db unreachable")}
		res, err := RunWeekly(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("settings ai_mode error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("settings ai_mode error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
	t.Run("feature toggle read error", func(t *testing.T) {
		settings := fakeDigestSettings{
			mode:       "cloud",
			enabledErr: errors.New("settings table degraded"),
		}
		res, err := RunWeekly(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("toggle read error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("toggle read error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
}

// TestRunAIDigestWeekly_NilDeps proves the function refuses
// programming-bug nil arguments. A nil DB or nil settings is a
// boot-time wiring error, not a runtime error, so the function
// returns it directly instead of pretending to skip.
func TestRunAIDigestWeekly_NilDeps(t *testing.T) {
	t.Parallel()
	if _, err := RunWeekly(context.Background(), nil, fakeDigestSettings{}); err == nil {
		t.Error("nil db: want error")
	}
	if _, err := RunWeekly(context.Background(), &database.DB{}, nil); err == nil {
		t.Error("nil settings: want error")
	}
}
