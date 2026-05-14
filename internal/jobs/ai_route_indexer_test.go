// Phase-50 / 0023 — D3 Route-efficiency suggestions.
//
// Tests for RunAIRouteIndexer. The off-mode + per-feature gate
// tests are the slice's load-bearing ADR-015 §I12 evidence — they
// prove the cron is fail-closed even when the scheduler keeps
// ticking after an admin disables AI mid-day.

package jobs

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeRouteIndexerSettings is a tiny in-memory implementation of
// AIRouteIndexerSettingsReader for the unit tests. The zero value
// returns ai_mode='' (which is NOT 'off' but ALSO not
// 'cloud'/'local' — the function treats anything other than 'off'
// as on, then re-checks the per-feature toggle).
type fakeRouteIndexerSettings struct {
	mode       string
	modeErr    error
	enabled    map[string]bool
	enabledErr error
}

func (f fakeRouteIndexerSettings) AIMode(_ context.Context) (string, error) {
	return f.mode, f.modeErr
}

func (f fakeRouteIndexerSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	if f.enabledErr != nil {
		return false, f.enabledErr
	}
	return f.enabled[id], nil
}

// TestRunAIRouteIndexer_OffMode_NoFanout is the §I12 #3 evidence
// test: when ai_mode='off' the cron MUST NOT touch the LLM, the
// embedder, or the vector DB. Pure Go — no DB required because
// the off-mode branch returns before any embed/SQL is issued.
func TestRunAIRouteIndexer_OffMode_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeRouteIndexerSettings{
		mode: rag.AIModeOff,
		// Toggle on; mode trumps it.
		enabled: map[string]bool{"route-efficiency-suggestions": true},
	}
	res, err := RunAIRouteIndexer(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("off mode: unexpected err %v", err)
	}
	if res.Skipped != 1 {
		t.Errorf("off mode: Skipped = %d, want 1", res.Skipped)
	}
	if res.Indexed != 0 || res.Failed != 0 || res.SourcesConsidered != 0 {
		t.Errorf("off mode: any non-zero work counter is a contract bug: %+v", res)
	}
}

// TestRunAIRouteIndexer_FeatureToggleOff_NoFanout proves the
// per-feature gate trips even when ai_mode is on (§I7 + §I12 #3).
// An admin who flips just the route-efficiency-suggestions toggle
// off mid-day must see the next tick no-op immediately — no
// waiting for a mode flip.
func TestRunAIRouteIndexer_FeatureToggleOff_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeRouteIndexerSettings{
		mode:    "cloud",
		enabled: map[string]bool{"route-efficiency-suggestions": false},
	}
	res, err := RunAIRouteIndexer(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("toggle off: unexpected err %v", err)
	}
	if res.Skipped != 1 {
		t.Errorf("toggle off: Skipped = %d, want 1", res.Skipped)
	}
}

// TestRunAIRouteIndexer_OnMode_NoOp is the positive control. With
// both gates open the function returns a zeroed envelope (the
// fan-out implementation lands in a future slice). Pinning the
// shape today protects future slices from accidentally changing
// the contract.
func TestRunAIRouteIndexer_OnMode_NoOp(t *testing.T) {
	t.Parallel()
	settings := fakeRouteIndexerSettings{
		mode:    "cloud",
		enabled: map[string]bool{"route-efficiency-suggestions": true},
	}
	res, err := RunAIRouteIndexer(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("on mode: unexpected err %v", err)
	}
	if res.Skipped != 0 {
		t.Errorf("on mode: Skipped = %d, want 0", res.Skipped)
	}
	if res.Indexed != 0 || res.Failed != 0 || res.SourcesConsidered != 0 {
		t.Errorf("on mode (stub): any non-zero work counter unexpected: %+v", res)
	}
}

// TestRunAIRouteIndexer_SettingsErrorIsFailClosed proves that
// settings-read failures do NOT cascade into a fan-out attempt —
// fail-closed semantics defend against a degraded settings table
// silently leaking embedding API calls to off-mode users.
func TestRunAIRouteIndexer_SettingsErrorIsFailClosed(t *testing.T) {
	t.Parallel()
	t.Run("ai_mode read error", func(t *testing.T) {
		settings := fakeRouteIndexerSettings{modeErr: errors.New("db unreachable")}
		res, err := RunAIRouteIndexer(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("settings ai_mode error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("settings ai_mode error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
	t.Run("feature toggle read error", func(t *testing.T) {
		settings := fakeRouteIndexerSettings{
			mode:       "cloud",
			enabledErr: errors.New("settings table degraded"),
		}
		res, err := RunAIRouteIndexer(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("toggle read error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("toggle read error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
}

// TestRunAIRouteIndexer_NilDeps proves the function refuses
// programming-bug nil arguments. A nil DB or nil settings is a
// boot-time wiring error, not a runtime error, so the function
// returns it directly instead of pretending to skip.
func TestRunAIRouteIndexer_NilDeps(t *testing.T) {
	t.Parallel()
	if _, err := RunAIRouteIndexer(context.Background(), nil, fakeRouteIndexerSettings{}); err == nil {
		t.Error("nil db: want error")
	}
	if _, err := RunAIRouteIndexer(context.Background(), &database.DB{}, nil); err == nil {
		t.Error("nil settings: want error")
	}
}
