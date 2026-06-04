// Log and trace summarization indexer tests.
//
// Tests for RunLogTrace. The off-mode + per-feature gate
// tests are load-bearing ADR-015 §I12 evidence — they
// prove the cron is fail-closed even when the scheduler keeps
// ticking after an admin disables AI mid-day.

package indexers

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeLogTraceIndexerSettings is a tiny in-memory implementation
// of LogTraceSettingsReader for the unit tests. The zero
// value returns ai_mode=” (which is NOT 'off' but ALSO not
// 'cloud'/'local' — the function treats anything other than
// 'off' as on, then re-checks the per-feature toggle).
type fakeLogTraceIndexerSettings struct {
	mode       string
	modeErr    error
	enabled    map[string]bool
	enabledErr error
}

func (f fakeLogTraceIndexerSettings) AIMode(_ context.Context) (string, error) {
	return f.mode, f.modeErr
}

func (f fakeLogTraceIndexerSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	if f.enabledErr != nil {
		return false, f.enabledErr
	}
	return f.enabled[id], nil
}

// TestRunAILogTraceIndexer_OffMode_NoFanout is the §I12 #3
// evidence test: when ai_mode='off' the cron MUST NOT touch the
// LLM, the embedder, or the vector DB.
func TestRunAILogTraceIndexer_OffMode_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeLogTraceIndexerSettings{
		mode:    rag.AIModeOff,
		enabled: map[string]bool{"log-trace-summarization": true},
	}
	res, err := RunLogTrace(context.Background(), &database.DB{}, settings)
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

// TestRunAILogTraceIndexer_FeatureToggleOff_NoFanout proves the
// per-feature gate trips even when ai_mode is on (§I7 + §I12 #3).
func TestRunAILogTraceIndexer_FeatureToggleOff_NoFanout(t *testing.T) {
	t.Parallel()
	settings := fakeLogTraceIndexerSettings{
		mode:    "cloud",
		enabled: map[string]bool{"log-trace-summarization": false},
	}
	res, err := RunLogTrace(context.Background(), &database.DB{}, settings)
	if err != nil {
		t.Fatalf("toggle off: unexpected err %v", err)
	}
	if res.Skipped != 1 {
		t.Errorf("toggle off: Skipped = %d, want 1", res.Skipped)
	}
}

// TestRunAILogTraceIndexer_OnMode_NoOp is the positive control.
// With both gates open the function returns a zeroed envelope.
func TestRunAILogTraceIndexer_OnMode_NoOp(t *testing.T) {
	t.Parallel()
	settings := fakeLogTraceIndexerSettings{
		mode:    "cloud",
		enabled: map[string]bool{"log-trace-summarization": true},
	}
	res, err := RunLogTrace(context.Background(), &database.DB{}, settings)
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

// TestRunAILogTraceIndexer_SettingsErrorIsFailClosed proves
// settings-read failures do NOT cascade into a fan-out attempt.
func TestRunAILogTraceIndexer_SettingsErrorIsFailClosed(t *testing.T) {
	t.Parallel()
	t.Run("ai_mode read error", func(t *testing.T) {
		settings := fakeLogTraceIndexerSettings{modeErr: errors.New("db unreachable")}
		res, err := RunLogTrace(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("settings ai_mode error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("settings ai_mode error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
	t.Run("feature toggle read error", func(t *testing.T) {
		settings := fakeLogTraceIndexerSettings{
			mode:       "cloud",
			enabledErr: errors.New("settings table degraded"),
		}
		res, err := RunLogTrace(context.Background(), &database.DB{}, settings)
		if err != nil {
			t.Fatalf("toggle read error: want nil err (fail-closed), got %v", err)
		}
		if res.Skipped != 1 {
			t.Errorf("toggle read error: Skipped = %d, want 1 (fail-closed)", res.Skipped)
		}
	})
}

// TestRunAILogTraceIndexer_NilDeps proves the function refuses
// programming-bug nil arguments.
func TestRunAILogTraceIndexer_NilDeps(t *testing.T) {
	t.Parallel()
	if _, err := RunLogTrace(context.Background(), nil, fakeLogTraceIndexerSettings{}); err == nil {
		t.Error("nil db: want error")
	}
	if _, err := RunLogTrace(context.Background(), &database.DB{}, nil); err == nil {
		t.Error("nil settings: want error")
	}
}
