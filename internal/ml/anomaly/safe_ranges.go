// Package anomaly keeps the canonical static safe-range envelope used
// as the deterministic FALLBACK by the learned-baseline trainer when
// a per-vehicle signal does not yet have enough samples for a
// statistical envelope (mean/stddev/p5/p95). The envelope is a
// vendor-agnostic per-signal lower/upper bound the existing static
// anomaly detector at internal/api/anomaly_handler.go already uses
// as the canonical baseline visible to every off-mode user.
//
// This map intentionally remains duplicated with internal/api/anomaly_handler.go.
// Moving it into internal/ml/anomaly would make the deterministic detector import
// this package; the parity test at
// internal/api/ai_ml_anomaly_safe_ranges_parity_test.go pins the two maps
// byte-for-byte so drift fails loudly.
//
// Importing direction:
//
//	internal/api ── (compile-time) ──▶ internal/ml/anomaly
//	                                       ▲
//	                                       └── internal/ai/tools
//
// The arrow only goes one way (api → ml/anomaly, ai/tools → ml/anomaly);
// internal/ml/anomaly imports nothing project-local. This keeps
// ml/anomaly safe to use from the AI tool layer without dragging the
// entire api package into the dependency graph of the eval harness
// or the dispatcher.
package anomaly

// SafeRanges is the canonical static lower/upper envelope per signal
// used by the deterministic detector AND as the learned-baseline
// trainer's per-signal fallback when fewer than [DefaultMinSamples]
// observations exist for a vehicle in the lookback window.
//
// Each entry is `[lower, upper]` in the signal's native unit:
//
//   - BatteryLevel:        % (0..100)
//   - PackVoltage:         V
//   - ModuleTempMax/Min:   °C
//   - TpmsPressureFl/Fr/Rl/Rr: bar
//   - InsideTemp/OutsideTemp:  °C
//   - DiStatorTempF/R:     °C
//   - IsolationResistance: kΩ
//
// The same units the deterministic detector at
// internal/api/anomaly_handler.go's `safeRanges` uses; the parity
// test at internal/api/ai_ml_anomaly_safe_ranges_parity_test.go
// asserts byte-equality so the two maps cannot drift.
//
// The map is intentionally a private package-level value so the
// learned-baseline trainer cannot accidentally mutate it via a
// tool-call path; readers consume it through [StaticEnvelope] /
// [StaticBound] which return value copies.
var safeRanges = map[string][2]float64{
	"BatteryLevel":        {0, 100},
	"PackVoltage":         {300, 420},
	"ModuleTempMax":       {-20, 55},
	"ModuleTempMin":       {-20, 55},
	"TpmsPressureFl":      {2.0, 3.5},
	"TpmsPressureFr":      {2.0, 3.5},
	"TpmsPressureRl":      {2.0, 3.5},
	"TpmsPressureRr":      {2.0, 3.5},
	"InsideTemp":          {-30, 60},
	"OutsideTemp":         {-40, 60},
	"DiStatorTempF":       {-20, 150},
	"DiStatorTempR":       {-20, 150},
	"IsolationResistance": {500, 99999},
}

// StaticEnvelope returns a defensive copy of the canonical safe-range
// map. Callers MUST treat the returned map as read-only conceptually;
// a copy is returned so a caller mutation cannot leak into other
// goroutines or future Train() calls.
//
// Deterministic iteration order is not guaranteed (Go map semantics);
// callers that need a stable order should sort by key or call
// [StaticSignals].
func StaticEnvelope() map[string][2]float64 {
	out := make(map[string][2]float64, len(safeRanges))
	for k, v := range safeRanges {
		out[k] = v
	}
	return out
}

// StaticBound returns the canonical static [lower, upper] bound for
// signal and a boolean ok flag. A missing signal returns (zero, false)
// so callers can distinguish "not tracked" from "tracked with bound
// {0,0}". This is the single accessor the trainer's per-signal
// fallback path uses.
func StaticBound(signal string) ([2]float64, bool) {
	b, ok := safeRanges[signal]
	return b, ok
}

// StaticSignals returns the deterministic alphabetic list of signal
// names tracked by the static envelope. The trainer iterates over
// this list (not the map directly) so the per-vehicle Train() output
// has stable ordering across calls — important for golden tests and
// for the AI tool's JSON envelope to be reproducible.
func StaticSignals() []string {
	out := make([]string, 0, len(safeRanges))
	for k := range safeRanges {
		out = append(out, k)
	}
	sortStrings(out)
	return out
}

// sortStrings is a tiny in-place sort to avoid pulling in the "sort"
// package for one call site. Same shape as cmd/ai-eval/main.go's
// helper.
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}
