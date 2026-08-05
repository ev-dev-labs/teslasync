package provider

import (
	"encoding/json"
	"testing"
)

func TestToolCallAccumulatorAssemblesFragmentsInFirstSeenOrder(t *testing.T) {
	t.Parallel()

	var accumulator ToolCallAccumulator
	accumulator.Add(1, "call_b", "query_", `{"vehicle`)
	accumulator.Add(0, "call_a", "query_battery_status", `{"vehicle_id":`)
	accumulator.Add(1, "", "drives_recent", `_id":2}`)
	accumulator.Add(0, "call_a", "", `1}`)

	got := accumulator.Calls()
	if len(got) != 2 {
		t.Fatalf("Calls() length = %d, want 2", len(got))
	}
	if got[0].ID != "call_b" || got[0].Name != "query_drives_recent" {
		t.Fatalf("first call metadata = %+v", got[0])
	}
	if got[1].ID != "call_a" || got[1].Name != "query_battery_status" {
		t.Fatalf("second call metadata = %+v", got[1])
	}
	for _, call := range got {
		if !json.Valid(call.Arguments) {
			t.Errorf("arguments for %s are invalid JSON: %s", call.Name, call.Arguments)
		}
	}
}

func TestToolCallAccumulatorNormalizesMissingArguments(t *testing.T) {
	t.Parallel()

	var accumulator ToolCallAccumulator
	accumulator.Add(0, "call_1", "query_vehicle_count", "")

	got := accumulator.Calls()
	if len(got) != 1 || string(got[0].Arguments) != "{}" {
		t.Fatalf("Calls() = %+v, want one call with empty object arguments", got)
	}
}
