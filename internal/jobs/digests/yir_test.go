// Phase-50 / 0013 — U3 Year-in-review narration.
//
// Tests for RunYIR. The off-mode + per-feature gate
// tests are the slice's load-bearing ADR-015 §I12 evidence — they
// prove the cron is fail-closed even when the scheduler keeps
// ticking after an admin disables AI mid-cycle.

package digests

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeYIRSettings is a tiny in-memory implementation of
// YIRSettingsReader for the unit tests. The zero value
// returns ai_mode=” (which is NOT 'off' but ALSO not 'cloud'/'local'
// — the function treats anything other than 'off' as on, then
// re-checks the per-feature toggle).
type fakeYIRSettings struct {
	mode       string
	modeErr    error
	enabled    map[string]bool
	enabledErr error
}

func (f fakeYIRSettings) AIMode(_ context.Context) (string, error) {
	return f.mode, f.modeErr
}

func (f fakeYIRSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	if f.enabledErr != nil {
		return false, f.enabledErr
	}
	return f.enabled[id], nil
}

// TestRunAIYIRPregen_OffMode_NoFanout is the §I12 #3 evidence
// test: when ai_mode='off' the cron MUST NOT touch the LLM, the
// tools, or the push fan-out. Pure Go — no DB required because the
// off-mode branch returns before any LLM/SQL is issued.
func TestRunAIYIRPregen_OffMode_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeYIRSettings{
		mode: rag.AIModeOff,
		// Toggle on; mode trumps it.
		enabled: map[string]bool{"yir-narration": true},
	}
	res, err := RunYIR(context.Background(), &database.DB{}, settings)
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

// TestRunAIYIRPregen_FeatureToggleOff_NoFanout proves the
// per-feature gate trips even when ai_mode is on (§I7 + §I12 #3).
// An admin who flips just the yir-narration toggle off mid-cycle
// must see the next tick no-op immediately — no waiting for a mode
// flip.
func TestRunAIYIRPregen_FeatureToggleOff_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeYIRSettings{
		mode:    "cloud",
		enabled: map[string]bool{"yir-narration": false},
	}
	res, err := RunYIR(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("toggle off: unexpected err %v", err)
	}
	if res.Skipped != 1 {
		t.Errorf("toggle off: Skipped = %d, want 1", res.Skipped)
	}
}

// TestRunAIYIRPregen_OnMode_NoOp is the positive control. With
// both gates open the function returns a zeroed envelope (the
// fan-out implementation lands in a future slice). Pinning the
// shape today protects future slices from accidentally changing
// the contract.
func TestRunAIYIRPregen_OnMode_NoOp(t *testing.T) {
	t.Parallel()
	settings := fakeYIRSettings{
		mode:    "cloud",
		enabled: map[string]bool{"yir-narration": true},
	}
	res, err := RunYIR(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("on mode: unexpected err %v", err)
	}
	if res.Skipped != 0 {
		t.Errorf("on mode: Skipped = %d, want 0", res.Skipped)
	}
	// Stub slice: no narrations yet.
	if res.Narrated != 0 || res.Failed != 0 || res.VehiclesConsidered != 0 {
		t.Errorf("on mode (stub): any non-zero work counter unexpected: %+v", res)
	}
}

// TestRunAIYIRPregen_SettingsErrorIsFailClosed proves that
// settings-read failures do NOT cascade into a fan-out attempt —
// fail-closed semantics defend against a degraded settings table
// silently leaking narrations to off-mode users.
func TestRunAIYIRPregen_SettingsErrorIsFailClosed(t *testing.T) {
	t.Parallel()
	t.Run("ai_mode read error", func(t *testing.T) {
		settings := fakeYIRSettings{modeErr: errors.New("db unreachable")}
		res, err := RunYIR(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("settings ai_mode error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("settings ai_mode error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
	t.Run("feature toggle read error", func(t *testing.T) {
		settings := fakeYIRSettings{
			mode:       "cloud",
			enabledErr: errors.New("settings table degraded"),
		}
		res, err := RunYIR(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("toggle read error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("toggle read error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
}

// TestRunAIYIRPregen_NilDeps proves the function refuses
// programming-bug nil arguments. A nil DB or nil settings is a
// boot-time wiring error, not a runtime error, so the function
// returns it directly instead of pretending to skip.
func TestRunAIYIRPregen_NilDeps(t *testing.T) {
	t.Parallel()
	if _, err := RunYIR(context.Background(), nil, fakeYIRSettings{}); err == nil {
		t.Error("nil db: want error")
	}
	if _, err := RunYIR(context.Background(), &database.DB{}, nil); err == nil {
		t.Error("nil settings: want error")
	}
}
