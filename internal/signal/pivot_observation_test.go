package signal

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestTimelineFieldObservationProvenance(t *testing.T) {
	at := time.Now().UTC()
	rows := forwardFold(map[string]SignalValue{"PackVoltage": 400.0}, []rawEvent{
		{Ts: at, Signal: "PackCurrent", Value: 5.0},
		{Ts: at.Add(time.Second), Signal: "PackVoltage", Value: 402.0},
		{Ts: at.Add(2 * time.Second), Signal: "PackCurrent", Value: 6.0},
	}, []FieldMapping{{Signal: "PackVoltage", Field: "v"}, {Signal: "PackCurrent", Field: "i"}}, at, at.Add(time.Minute))
	if len(rows) != 3 {
		t.Fatalf("rows = %d", len(rows))
	}
	if !rows[0].ObservedAt["v"].IsZero() {
		t.Fatal("seed freshness must be unknown")
	}
	if rows[1].ObservedAt["i"] != at || rows[2].ObservedAt["v"] != at.Add(time.Second) {
		t.Fatal("forward fill must preserve original per-field observation time")
	}
	if rows[0].ObservedAt["i"] != at {
		t.Fatal("provenance maps aliased across rows")
	}
	raw, err := json.Marshal(rows[2])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "ObservedAt") {
		t.Fatal("internal provenance leaked into chart contract")
	}
}
