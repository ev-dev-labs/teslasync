package redactadapter_test

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

func TestWrap_SatisfiesStrategyInterface(t *testing.T) {
	t.Parallel()
	var rp strategy.RedactionPolicy = redactadapter.Wrap(redact.PolicyChatbot())
	_ = rp // compile-time check is the assertion.
}

func TestFrom_Wrapped(t *testing.T) {
	t.Parallel()
	want := redact.Policy{Allow: []redact.PIIClass{redact.ClassVehicleName}, Mode: redact.ModeRedactedTokens}
	sp := redactadapter.Wrap(want)
	got := redactadapter.From(sp)
	if got.Mode != want.Mode {
		t.Errorf("Mode = %v, want %v", got.Mode, want.Mode)
	}
	if len(got.Allow) != 1 || got.Allow[0] != redact.ClassVehicleName {
		t.Errorf("Allow = %v, want [vehname]", got.Allow)
	}
}

func TestFrom_PointerWrapped(t *testing.T) {
	t.Parallel()
	want := redact.Policy{Allow: []redact.PIIClass{redact.ClassVIN}}
	sp := &redactadapter.PolicyAdapter{Inner: want}
	got := redactadapter.From(sp)
	if len(got.Allow) != 1 || got.Allow[0] != redact.ClassVIN {
		t.Errorf("Allow = %v, want [vin]", got.Allow)
	}
}

func TestFrom_NilPointerFallsBack(t *testing.T) {
	t.Parallel()
	var nilPtr *redactadapter.PolicyAdapter
	got := redactadapter.From(nilPtr)
	if len(got.Allow) != 0 {
		t.Errorf("nil pointer must yield default, got %v", got.Allow)
	}
}

func TestFrom_NoRedactionFallsBack(t *testing.T) {
	t.Parallel()
	got := redactadapter.From(strategy.NoRedaction{})
	if len(got.Allow) != 0 {
		t.Errorf("NoRedaction must fall back to deny-all, got Allow=%v", got.Allow)
	}
	if got.Mode != redact.ModeRedactedTags {
		t.Errorf("Mode = %v, want default tags", got.Mode)
	}
}

func TestFrom_NilFallsBack(t *testing.T) {
	t.Parallel()
	got := redactadapter.From(nil)
	if len(got.Allow) != 0 || got.Mode != redact.ModeRedactedTags {
		t.Errorf("nil must yield DefaultPolicy, got %+v", got)
	}
}

// otherPolicy is an external implementation of strategy.RedactionPolicy
// (via embedding strategy.NoRedaction). From must reject unknown
// adapters and fall back to deny-all.
type otherPolicy struct {
	strategy.NoRedaction
}

func TestFrom_UnknownAdapterFallsBack(t *testing.T) {
	t.Parallel()
	got := redactadapter.From(otherPolicy{})
	if len(got.Allow) != 0 {
		t.Errorf("unknown adapter must fall back to deny-all, got %v", got.Allow)
	}
}
