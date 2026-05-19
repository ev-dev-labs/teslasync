package signal

import (
	"encoding/json"
	"math"
	"testing"
)

// FuzzFloat64 asserts that the coercion helper never panics regardless
// of the (untyped) value it is fed — important because Float64 is
// called from every API /latest handler over signal store payloads
// that may carry arbitrary legacy envelope shapes.
//
// The fuzz engine only natively fuzzes a small set of primitive types,
// so we feed it a string + selector and dispatch to a representative
// value of each branch. The contract being defended is: no panic, and
// any returned float64 is finite (not NaN/Inf) when ok=true.
func FuzzFloat64(f *testing.F) {
	f.Add("number", "42")
	f.Add("number", "3.14")
	f.Add("number", "-0.0")
	f.Add("number", "1e308")
	f.Add("number", "NaN")
	f.Add("string", "42")
	f.Add("string", "not-a-number")
	f.Add("bool", "true")
	f.Add("envelope", `{"value":42}`)
	f.Add("envelope", `{"invalid":true}`)
	f.Add("envelope", `{"value":"42.5"}`)
	f.Add("nil", "")
	f.Add("json.Number", "9999999999999999")

	f.Fuzz(func(t *testing.T, kind, raw string) {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("Float64 panicked on kind=%q raw=%q: %v", kind, raw, r)
			}
		}()
		var v any
		switch kind {
		case "number":
			// Parse via json so we exercise the json.Number branch too.
			var n float64
			_ = json.Unmarshal([]byte(raw), &n)
			v = n
		case "string":
			v = raw
		case "bool":
			v = raw == "true"
		case "envelope":
			var m map[string]any
			_ = json.Unmarshal([]byte(raw), &m)
			v = m
		case "nil":
			v = nil
		case "json.Number":
			v = json.Number(raw)
		default:
			v = raw
		}

		got, ok := Float64(v)
		// Invariant: when ok=true, the returned float must be a real
		// number — the API handler downstream multiplies/divides it
		// freely and a NaN/Inf would propagate silently.
		if ok && (math.IsNaN(got) || math.IsInf(got, 0)) {
			t.Fatalf("Float64 returned non-finite %v (ok=true) for kind=%q raw=%q", got, kind, raw)
		}
	})
}

func BenchmarkFloat64_Native(b *testing.B) {
	var v any = 87.5
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = Float64(v)
	}
}

func BenchmarkFloat64_Envelope(b *testing.B) {
	var v any = map[string]any{"value": 87.5}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = Float64(v)
	}
}

func BenchmarkFloat64_JSONNumber(b *testing.B) {
	var v any = json.Number("87.5")
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = Float64(v)
	}
}
