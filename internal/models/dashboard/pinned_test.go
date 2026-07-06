package dashboard

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// TestPinnedItemType_Valid exhaustively pins the closed enum the pinned-items
// handler validates before insert. Every declared type passes; unknown, empty,
// case, hyphen, and whitespace variants (which the model deliberately does not
// normalise — the handler trims) fail so they never hit the DB CHECK.
func TestPinnedItemType_Valid(t *testing.T) {
	tests := []struct {
		name string
		typ  PinnedItemType
		want bool
	}{
		{"vehicle", PinnedItemTypeVehicle, true},
		{"widget", PinnedItemTypeWidget, true},
		{"alert_rule", PinnedItemTypeAlertRule, true},
		{"location", PinnedItemTypeLocation, true},
		{"geofence", PinnedItemTypeGeofence, true},
		{"automation", PinnedItemTypeAutomation, true},
		{"dashboard", PinnedItemTypeDashboard, true},
		{"command", PinnedItemTypeCommand, true},
		{"empty", PinnedItemType(""), false},
		{"unknown", PinnedItemType("spaceship"), false},
		{"uppercased", PinnedItemType("Vehicle"), false},
		{"hyphen variant of alert_rule", PinnedItemType("alert-rule"), false},
		{"whitespace padded", PinnedItemType(" vehicle "), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.typ.Valid(); got != tt.want {
				t.Fatalf("PinnedItemType(%q).Valid() = %v; want %v", string(tt.typ), got, tt.want)
			}
		})
	}
}

// TestPinnedItemType_ConstantValues pins the literal values shared with the DB
// CHECK constraint (migration 000162) and the frontend PinnedItemType union
// (web/src/api/types.ts), and confirms each declared constant is Valid().
func TestPinnedItemType_ConstantValues(t *testing.T) {
	want := map[PinnedItemType]string{
		PinnedItemTypeVehicle:    "vehicle",
		PinnedItemTypeWidget:     "widget",
		PinnedItemTypeAlertRule:  "alert_rule",
		PinnedItemTypeLocation:   "location",
		PinnedItemTypeGeofence:   "geofence",
		PinnedItemTypeAutomation: "automation",
		PinnedItemTypeDashboard:  "dashboard",
		PinnedItemTypeCommand:    "command",
	}
	for tp, s := range want {
		if string(tp) != s {
			t.Errorf("constant literal = %q; want %q", string(tp), s)
		}
		if !tp.Valid() {
			t.Errorf("declared type %q must satisfy Valid()", string(tp))
		}
	}
}

// TestPinnedItem_JSON_FullyPopulated locks the outbound wire shape and a clean
// round-trip for a fully-populated pin.
func TestPinnedItem_JSON_FullyPopulated(t *testing.T) {
	uid := int64(3)
	ctx := "dashboard:home"
	orig := PinnedItem{
		ID:       11,
		UserID:   &uid,
		ItemType: PinnedItemTypeWidget,
		ItemID:   "battery-health",
		Position: 4,
		PinnedAt: time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC),
		Context:  &ctx,
	}
	m := toKeyMap(t, orig)
	assertKeys(t, m,
		[]string{"id", "user_id", "item_type", "item_id", "position", "pinned_at", "context"},
		[]string{"itemType", "itemId", "pinnedAt", "userId"},
	)
	raw, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got PinnedItem
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("round-trip unmarshal: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("round trip mismatch:\n got  %+v\n want %+v", got, orig)
	}
}

// TestPinnedItem_JSON_OmitsNilOptionals verifies omitempty on user_id/context,
// and that position 0 (a meaningful "top of list" sort key with no omitempty)
// still serializes.
func TestPinnedItem_JSON_OmitsNilOptionals(t *testing.T) {
	minimal := PinnedItem{
		ID:       1,
		ItemType: PinnedItemTypeVehicle,
		ItemID:   "17",
		Position: 0,
		PinnedAt: time.Unix(0, 0).UTC(),
	}
	m := toKeyMap(t, minimal)
	assertKeys(t, m,
		[]string{"id", "item_type", "item_id", "position", "pinned_at"},
		[]string{"user_id", "context"},
	)
	if got := string(m["position"]); got != "0" {
		t.Errorf("position = %s; zero position must still serialize (top of list)", got)
	}
}
