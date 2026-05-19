package codec

import (
	"testing"
	"time"
)

// FuzzDecode asserts that the proto Decode entry point NEVER panics no
// matter what bytes a hostile or buggy broker feeds it. This is the
// guard the architecture document calls out: malformed bytes must
// surface as an error, not a process crash that triggers MQTT
// redelivery of a poison pill.
//
// We do not assert on the parse result — for non-Payload bytes proto
// will return an error, for valid-looking-but-empty Payloads it will
// succeed with a nil/empty slice. Either is fine. The only failure
// mode this fuzz hunts is a panic.
func FuzzDecode(f *testing.F) {
	// Seed corpus: a handful of plausible shapes drawn from the
	// shipping protomodel tests so the fuzzer has a starting point
	// for byte-level mutations.
	f.Add([]byte(nil))
	f.Add([]byte{})
	f.Add([]byte{0x00})
	f.Add([]byte{0xff, 0xff, 0xff, 0xff})
	// Field 1 (vin), wire type 2 (length-delimited), len 5, "1HGCM"
	f.Add([]byte{0x0a, 0x05, '1', 'H', 'G', 'C', 'M'})
	// Field 3 (created_at timestamp), wire type 2, then short nested
	f.Add([]byte{0x1a, 0x02, 0x08, 0x01})

	f.Fuzz(func(t *testing.T, payload []byte) {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("Decode panicked on %d-byte payload: %v", len(payload), r)
			}
		}()
		// Result ignored — we only assert no panic.
		_, _ = Decode(payload)
	})
}

// FuzzDecodeJSONField guards the per-field MQTT JSON path the
// PipelineSubscriber takes when the broker delivers a v/<Field>
// payload. The contract is the same — codec failures must be returned
// as errors so the message is dropped (and counted) without crashing
// the consumer.
func FuzzDecodeJSONField(f *testing.F) {
	now := time.Date(2026, 5, 18, 12, 0, 0, 0, time.UTC)
	f.Add("BatteryLevel", []byte(`{"value":87.5}`), "5YJSA1E26HF000001")
	f.Add("Gear", []byte(`{"value":"D"}`), "5YJSA1E26HF000001")
	f.Add("ChargeState", []byte(`{"value":"Charging"}`), "")
	f.Add("Odometer", []byte(`null`), "5YJSA1E26HF000001")
	f.Add("BatteryLevel", []byte(`{"invalid":true}`), "5YJSA1E26HF000001")
	f.Add("BatteryLevel", []byte(`not-json`), "5YJSA1E26HF000001")
	f.Add("", []byte(`{}`), "")

	f.Fuzz(func(t *testing.T, field string, body []byte, vin string) {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("DecodeJSONField(%q, %d bytes, %q) panicked: %v", field, len(body), vin, r)
			}
		}()
		_, _ = DecodeJSONField(field, body, vin, now)
	})
}

// BenchmarkDecode covers the proto hot path the broker exercises on
// every Payload message — informs whether codec changes regress the
// nanoseconds-per-decode budget.
func BenchmarkDecode(b *testing.B) {
	// A canonical-looking but minimal Payload: vin field only. Real
	// Payloads carry a Data slice; this benchmark exists as a floor
	// so future heavier benchmarks can be compared against it.
	payload := []byte{0x0a, 0x11, '5', 'Y', 'J', 'S', 'A', '1', 'E', '2', '6', 'H', 'F', '0', '0', '0', '0', '0', '1'}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = Decode(payload)
	}
}

func BenchmarkDecodeJSONField(b *testing.B) {
	body := []byte(`{"value":87.5}`)
	now := time.Date(2026, 5, 18, 12, 0, 0, 0, time.UTC)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = DecodeJSONField("BatteryLevel", body, "5YJSA1E26HF000001", now)
	}
}
