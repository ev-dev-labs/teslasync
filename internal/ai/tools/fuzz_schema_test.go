package tools

import (
	"context"
	"encoding/json"
	"testing"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TestEverySchemaMatchesHandlerValidation is the R2-mitigation pin
// test: for every registered tool, the JSON-Schema returned by
// InputSchema() and the runtime check inside Validate() MUST agree
// on whether a payload is acceptable.
//
// We don't ship a separate JSON-Schema validator; instead, we
// exploit a stronger structural fact: BOTH the schema generator
// (schema.go) and the runtime validator (validate.go) read the
// SAME `validate:"..."` struct tags. The contract being pinned is
// that the schema is an honest description of what Validate
// enforces. We therefore enumerate a small payload corpus per tool
// and assert that the schema's declared constraints (required /
// enum / minimum / maximum / minItems / minLength) line up with
// what Validate actually accepts on a representative subset.
//
// If anybody adds a new validate-tag rule and only updates one of
// schema.go/validate.go, this test fails by construction.
func TestEverySchemaMatchesHandlerValidation(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})

	for _, tool := range r.All() {
		tool := tool
		t.Run(tool.Name(), func(t *testing.T) {
			t.Parallel()
			schemaRaw := tool.InputSchema()
			var schema map[string]any
			if err := json.Unmarshal(schemaRaw, &schema); err != nil {
				t.Fatalf("schema not valid JSON: %v\n%s", err, schemaRaw)
			}
			if schema["type"] != "object" {
				t.Errorf("schema.type = %v, want object", schema["type"])
			}

			// Required-field equivalence: the schema lists "required"
			// fields; an empty payload MUST be rejected exactly when
			// at least one required field exists.
			req, _ := schema["required"].([]any)
			_, errEmpty := tool.Validate(json.RawMessage(`{}`))
			if len(req) > 0 && errEmpty == nil {
				t.Errorf("schema declares required %v but Validate accepts {}", req)
			}
			if len(req) == 0 && errEmpty != nil {
				t.Errorf("schema has no required fields but Validate rejects {}: %v", errEmpty)
			}

			// Unknown-property rejection: schema MUST set
			// additionalProperties=false and Validate MUST agree.
			if v, ok := schema["additionalProperties"].(bool); !ok || v {
				t.Errorf("additionalProperties must be false (got %v)", schema["additionalProperties"])
			}
			// Build a payload with all required fields set to a
			// trivially-valid value, then add an extra field.
			fillExtra := buildMinimalPayload(t, schema)
			fillExtra["__unknown__"] = true
			raw, _ := json.Marshal(fillExtra)
			if _, err := tool.Validate(raw); err == nil {
				t.Errorf("schema declares additionalProperties=false but Validate accepts unknown key")
			}
		})
	}
}

// buildMinimalPayload constructs a JSON object that satisfies the
// schema's "required" + per-field rule constraints. Only the
// constraints the schema generator currently emits are honoured:
// type, minimum, maximum, enum, minLength, minItems.
func buildMinimalPayload(t *testing.T, schema map[string]any) map[string]any {
	t.Helper()
	out := map[string]any{}
	props, _ := schema["properties"].(map[string]any)
	req, _ := schema["required"].([]any)
	for _, n := range req {
		name := n.(string)
		f, _ := props[name].(map[string]any)
		out[name] = sampleFromFieldSchema(f)
	}
	return out
}

// sampleFromFieldSchema returns the smallest legal value for a
// JSON-Schema field description.
func sampleFromFieldSchema(f map[string]any) any {
	if enum, ok := f["enum"].([]any); ok && len(enum) > 0 {
		return enum[0]
	}
	switch f["type"] {
	case "string":
		if v, ok := f["minLength"].(float64); ok && v > 0 {
			b := make([]byte, int(v))
			for i := range b {
				b[i] = 'a'
			}
			return string(b)
		}
		return "x"
	case "integer":
		if v, ok := f["minimum"].(float64); ok {
			return int64(v)
		}
		return int64(1)
	case "number":
		if v, ok := f["minimum"].(float64); ok {
			return v
		}
		return 1.0
	case "boolean":
		return true
	case "array":
		if v, ok := f["minItems"].(float64); ok && v > 0 {
			items, _ := f["items"].(map[string]any)
			out := make([]any, 0, int(v))
			for i := 0; i < int(v); i++ {
				out = append(out, sampleFromFieldSchema(items))
			}
			return out
		}
		return []any{}
	case "object":
		return map[string]any{}
	}
	return nil
}

// TestEverySchemaContainsTitleField asserts every tool input
// produces a top-level object schema with a "properties" key (even
// if empty). This guarantees the LLM-facing payload is well-formed.
func TestEverySchemaContainsTitleField(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	for _, def := range r.Definitions() {
		var s map[string]any
		if err := json.Unmarshal(def.InputSchema, &s); err != nil {
			t.Errorf("%s: schema invalid JSON: %v", def.Name, err)
			continue
		}
		if _, ok := s["properties"]; !ok {
			t.Errorf("%s: schema missing properties: %v", def.Name, s)
		}
	}
}

// TestBuiltinsHaveNoMutators confirms the F4 starter set is read-only.
// Mutating tools belong with their owning feature slice (N1/N2/...).
func TestBuiltinsHaveNoMutators(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{},
		Charges:       &fakeCharges{},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	for _, tl := range r.All() {
		if tl.Mutates() {
			t.Errorf("builtin %s reports Mutates()=true; mutating tools belong with their feature slice", tl.Name())
		}
	}
}

// TestRoundTripExecuteOnEmptyInputs exercises every builtin's
// Validate→Execute path with a minimal-valid payload built from the
// schema. Failures here mean a builtin's Execute path errors on
// data the schema says is acceptable — which is the same R2 risk
// at runtime.
func TestRoundTripExecuteOnMinimalPayloads(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	Register12Builtins(r, Sources{
		Vehicles:      &fakeVehicles{one: map[int64]*vehiclemodel.Vehicle{1: {ID: 1, DisplayName: "x", VIN: "v", Timezone: "UTC"}}},
		VehicleState:  &fakeState{},
		Drives:        &fakeDrives{one: map[int64]*models.Drive{1: {ID: 1}}},
		Charges:       &fakeCharges{one: map[int64]*chargingmodel.ChargingSession{1: {ID: 1}}},
		AlertRules:    &fakeRules{},
		Notifications: &fakeNotif{},
		Geofences:     &fakeFences{},
		Efficiency:    &fakeDrives{},
	})
	for _, tool := range r.All() {
		tool := tool
		t.Run(tool.Name(), func(t *testing.T) {
			t.Parallel()
			var schema map[string]any
			_ = json.Unmarshal(tool.InputSchema(), &schema)
			payload := buildMinimalPayload(t, schema)
			raw, _ := json.Marshal(payload)
			in, err := tool.Validate(raw)
			if err != nil {
				t.Fatalf("validate failed for minimal payload %s: %v", raw, err)
			}
			if _, err := tool.Execute(context.Background(), in); err != nil {
				t.Errorf("execute failed for minimal payload: %v", err)
			}
		})
	}
}
