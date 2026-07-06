package dashboard

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// TestDashboardLayout_JSON_RawMessagePassthrough guards the single most
// important behaviour of this struct: the opaque `layout` column is persisted
// and re-emitted verbatim so schema evolution can live entirely in the
// frontend. This pins against the classic regression of switching Layout to
// `string`, which double-encodes it into a JSON string and breaks every
// consumer.
func TestDashboardLayout_JSON_RawMessagePassthrough(t *testing.T) {
	layout := json.RawMessage(`{"widgets":[{"i":"battery","x":0,"y":0,"w":6,"h":4}],"settings":{"theme":"dark"}}`)
	orig := DashboardLayout{
		ID:        7,
		Name:      "Road Trip",
		IsDefault: true,
		Layout:    layout,
		CreatedAt: time.Date(2026, 2, 2, 2, 2, 2, 0, time.UTC),
		UpdatedAt: time.Date(2026, 2, 3, 2, 2, 2, 0, time.UTC),
	}
	m := toKeyMap(t, orig)
	assertKeys(t, m,
		[]string{"id", "name", "is_default", "layout", "created_at", "updated_at"},
		[]string{"user_id", "vehicle_id", "isDefault", "createdAt"},
	)
	got := m["layout"]
	if len(got) == 0 || got[0] == '"' {
		t.Fatalf("layout serialized as %s; RawMessage must embed a verbatim JSON object, not a quoted string", got)
	}
	if !jsonEqual(t, got, layout) {
		t.Errorf("layout not preserved verbatim:\n got  %s\n want %s", got, layout)
	}
}

// TestDashboardLayout_JSON_RoundTrip verifies a fully-populated layout (with
// both optional scopes set) round-trips, comparing the opaque layout bytes
// separately from the typed fields.
func TestDashboardLayout_JSON_RoundTrip(t *testing.T) {
	uid := int64(2)
	vid := int64(88)
	orig := DashboardLayout{
		ID:        9,
		UserID:    &uid,
		VehicleID: &vid,
		Name:      "Garage",
		IsDefault: false,
		Layout:    json.RawMessage(`{"widgets":[]}`),
		CreatedAt: time.Date(2026, 6, 6, 6, 6, 6, 0, time.UTC),
		UpdatedAt: time.Date(2026, 6, 6, 6, 6, 6, 0, time.UTC),
	}
	raw, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got DashboardLayout
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !jsonEqual(t, got.Layout, orig.Layout) {
		t.Errorf("layout bytes changed: got %s want %s", got.Layout, orig.Layout)
	}
	got.Layout, orig.Layout = nil, nil
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("round trip mismatch:\n got  %+v\n want %+v", got, orig)
	}
}

// TestDashboardLayout_JSON_OmitsNilScope verifies omitempty on the nullable
// user_id/vehicle_id scopes and that the is_default flag serializes.
func TestDashboardLayout_JSON_OmitsNilScope(t *testing.T) {
	minimal := DashboardLayout{
		ID:        1,
		Name:      "Default",
		IsDefault: true,
		Layout:    json.RawMessage(`{}`),
		CreatedAt: time.Unix(0, 0).UTC(),
		UpdatedAt: time.Unix(0, 0).UTC(),
	}
	m := toKeyMap(t, minimal)
	assertKeys(t, m,
		[]string{"id", "name", "is_default", "layout"},
		[]string{"user_id", "vehicle_id"},
	)
	if got := string(m["is_default"]); got != "true" {
		t.Errorf("is_default = %s; want true", got)
	}
}
