package signal

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// noopStateReader is the smallest implementation needed to prove that
// StateReader is satisfiable.
type noopStateReader struct{}

func (noopStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (State, error) {
	return State{}, nil
}

func (noopStateReader) SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (SignalValue, error) {
	return nil, nil
}

func (noopStateReader) Timeline(ctx context.Context, vehicleID int64, fields []FieldMapping, from, to time.Time, opts TimelineOptions) ([]TimelineRow, error) {
	return nil, nil
}

// TestStateReader_InterfaceCompiles is a compile-time assertion that
// noopStateReader satisfies StateReader. If the interface signature drifts
// without updating the stub, this fails to build — which is exactly the
// signal we want.
func TestStateReader_InterfaceCompiles(t *testing.T) {
	var _ StateReader = (*noopStateReader)(nil)
	var _ StateReader = noopStateReader{}
}

// TestTimelineRow_MarshalJSON_FlattensToFlatShape verifies the legacy flat
// JSON shape required by existing frontend chart components: {ts, <field>: ...}
// at the top level, with no nested "fields" envelope.
func TestTimelineRow_MarshalJSON_FlattensToFlatShape(t *testing.T) {
	ts := time.Date(2026, time.April, 30, 12, 34, 56, 0, time.UTC)
	r := TimelineRow{
		Timestamp: ts,
		Fields: map[string]SignalValue{
			"speed_mph": 65.0,
		},
	}

	data, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if _, hasTs := out["ts"]; !hasTs {
		t.Errorf("expected top-level 'ts' key, got keys=%v raw=%s", keysOf(out), string(data))
	}
	if v, hasSpeed := out["speed_mph"]; !hasSpeed {
		t.Errorf("expected top-level 'speed_mph' key, got keys=%v raw=%s", keysOf(out), string(data))
	} else if v != 65.0 {
		t.Errorf("expected speed_mph=65, got %v (raw=%s)", v, string(data))
	}
	if _, hasNested := out["fields"]; hasNested {
		t.Errorf("did not expect nested 'fields' envelope, raw=%s", string(data))
	}
	if got := len(out); got != 2 {
		t.Errorf("expected exactly 2 top-level keys (ts, speed_mph), got %d (keys=%v raw=%s)", got, keysOf(out), string(data))
	}
}

// TestTimelineRow_MarshalJSON_TimestampWins documents the precedence rule:
// TimelineRow.Timestamp is authoritative, even if Fields happens to contain a
// signal projected as "ts". A future caller passing FieldMapping{Field: "ts"}
// must not be able to silently override the emission timestamp.
func TestTimelineRow_MarshalJSON_TimestampWins(t *testing.T) {
	ts := time.Date(2026, time.April, 30, 12, 34, 56, 0, time.UTC)
	r := TimelineRow{
		Timestamp: ts,
		Fields: map[string]SignalValue{
			"ts":        "should-be-ignored",
			"speed_mph": 65.0,
		},
	}

	data, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	tsValue, ok := out["ts"].(string)
	if !ok {
		t.Fatalf("expected 'ts' to be a string (RFC3339Nano), got %T %v (raw=%s)", out["ts"], out["ts"], string(data))
	}
	if tsValue == "should-be-ignored" {
		t.Errorf("Fields[ts] overrode the authoritative timestamp, raw=%s", string(data))
	}
	expected := ts.Format(time.RFC3339Nano)
	if tsValue != expected {
		t.Errorf("expected ts=%q, got %q (raw=%s)", expected, tsValue, string(data))
	}
	// speed_mph should still pass through unchanged.
	if v, ok := out["speed_mph"]; !ok || v != 65.0 {
		t.Errorf("expected speed_mph=65 to survive, got %v (raw=%s)", v, string(data))
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
