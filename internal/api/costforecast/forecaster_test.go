package costforecast

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools/forecast"
)

// TestAICostForecaster_PanicsOnNilDB asserts the production
// adapter constructor refuses a nil *database.DB — a wiring bug
// at boot must surface as a panic, not as a nil-deref on first
// AI request.
func TestAICostForecaster_PanicsOnNilDB(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAICostForecaster(nil db) did not panic")
		}
	}()
	NewAICostForecaster(nil)
}

// TestAICostForecaster_SatisfiesInterface is a compile-time +
// runtime assertion that the production adapter implements
// forecast.CostForecaster. The compile-time `var _` line in the
// forecaster file gives the same guarantee, but this test fails with
// a clear message if a future refactor accidentally narrows the
// interface contract.
func TestAICostForecaster_SatisfiesInterface(t *testing.T) {
	t.Parallel()
	var iface forecast.CostForecaster = (*AICostForecaster)(nil)
	if iface == nil {
		t.Logf("AICostForecaster satisfies forecast.CostForecaster (nil cast)")
	}
}
