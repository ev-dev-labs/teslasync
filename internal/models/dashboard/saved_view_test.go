package dashboard

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// TestSavedView_JSON_FullyPopulated locks the outbound snake_case wire shape
// and asserts a clean round-trip for a fully-populated saved view.
func TestSavedView_JSON_FullyPopulated(t *testing.T) {
	uid := int64(4)
	orig := SavedView{
		ID:        21,
		UserID:    &uid,
		Name:      "Last 30 days, supercharger only",
		Route:     "/charging",
		Query:     "range=30d&connector=supercharger",
		IsDefault: true,
		IsPinned:  true,
		SortOrder: 2,
		CreatedAt: time.Date(2026, 7, 7, 7, 7, 7, 0, time.UTC),
		UpdatedAt: time.Date(2026, 7, 8, 7, 7, 7, 0, time.UTC),
	}
	m := toKeyMap(t, orig)
	assertKeys(t, m,
		[]string{"id", "user_id", "name", "route", "query", "is_default", "is_pinned", "sort_order", "created_at", "updated_at"},
		[]string{"userId", "isDefault", "isPinned", "sortOrder", "createdAt"},
	)
	raw, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got SavedView
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("round-trip unmarshal: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("round trip mismatch:\n got  %+v\n want %+v", got, orig)
	}
}

// TestSavedView_JSON_OmitsNilUserAndKeepsZeroFlags verifies omitempty on
// user_id while the zero-valued flags/order/query still serialize — the
// frontend must be able to tell "false/0/empty" from "absent".
func TestSavedView_JSON_OmitsNilUserAndKeepsZeroFlags(t *testing.T) {
	minimal := SavedView{
		ID:        1,
		Name:      "All drives",
		Route:     "/drives",
		Query:     "",
		IsDefault: false,
		IsPinned:  false,
		SortOrder: 0,
		CreatedAt: time.Unix(0, 0).UTC(),
		UpdatedAt: time.Unix(0, 0).UTC(),
	}
	m := toKeyMap(t, minimal)
	assertKeys(t, m,
		[]string{"id", "name", "route", "query", "is_default", "is_pinned", "sort_order", "created_at", "updated_at"},
		[]string{"user_id"},
	)
	for k, want := range map[string]string{
		"is_default": "false",
		"is_pinned":  "false",
		"sort_order": "0",
		"query":      `""`,
	} {
		if got := string(m[k]); got != want {
			t.Errorf("%s = %s; want %s (zero value must still serialize)", k, got, want)
		}
	}
}
