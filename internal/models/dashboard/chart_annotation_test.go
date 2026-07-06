package dashboard

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// TestAnnotationCategory_Valid exhaustively pins the closed enum used by the
// chart-annotation handler before insert/update. Every declared category must
// pass; anything else (unknown, empty, or a case/whitespace variant the model
// deliberately does NOT normalise — the handler trims) must fail so it never
// reaches the DB CHECK constraint as a 500.
func TestAnnotationCategory_Valid(t *testing.T) {
	tests := []struct {
		name string
		cat  AnnotationCategory
		want bool
	}{
		{"milestone", AnnotationCategoryMilestone, true},
		{"maintenance", AnnotationCategoryMaintenance, true},
		{"trip", AnnotationCategoryTrip, true},
		{"issue", AnnotationCategoryIssue, true},
		{"upgrade", AnnotationCategoryUpgrade, true},
		{"custom", AnnotationCategoryCustom, true},
		{"empty", AnnotationCategory(""), false},
		{"unknown token", AnnotationCategory("unknown"), false},
		{"uppercased not normalised", AnnotationCategory("Milestone"), false},
		{"leading space not trimmed", AnnotationCategory(" milestone"), false},
		{"trailing space not trimmed", AnnotationCategory("milestone "), false},
		{"numeric", AnnotationCategory("0"), false},
		{"prefix substring is not a match", AnnotationCategory("mile"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cat.Valid(); got != tt.want {
				t.Fatalf("AnnotationCategory(%q).Valid() = %v; want %v", string(tt.cat), got, tt.want)
			}
		})
	}
}

// TestAnnotationCategory_ConstantValues pins the literal values. They are a
// three-way wire contract: the frontend AnnotationCategory union
// (web/src/types/annotations.ts), the database CHECK constraint (migration
// 000159), and this Go enum. Drift in any one silently surfaces as a 500 at
// insert, so every declared constant is checked for both spelling and Valid().
func TestAnnotationCategory_ConstantValues(t *testing.T) {
	want := map[AnnotationCategory]string{
		AnnotationCategoryMilestone:   "milestone",
		AnnotationCategoryMaintenance: "maintenance",
		AnnotationCategoryTrip:        "trip",
		AnnotationCategoryIssue:       "issue",
		AnnotationCategoryUpgrade:     "upgrade",
		AnnotationCategoryCustom:      "custom",
	}
	for c, s := range want {
		if string(c) != s {
			t.Errorf("constant literal = %q; want %q", string(c), s)
		}
		if !c.Valid() {
			t.Errorf("declared category %q must satisfy Valid()", string(c))
		}
	}
}

// TestChartAnnotation_JSON_FullyPopulated locks the outbound wire shape (the
// handler serialises this struct directly) and asserts a clean round-trip.
func TestChartAnnotation_JSON_FullyPopulated(t *testing.T) {
	uid := int64(7)
	vid := int64(42)
	desc := "battery pack swapped under warranty"
	color := "#22d3ee"
	orig := ChartAnnotation{
		ID:          101,
		UserID:      &uid,
		VehicleID:   &vid,
		OccurredAt:  time.Date(2026, 3, 14, 9, 26, 53, 0, time.UTC),
		Category:    AnnotationCategoryMaintenance,
		Title:       "HV battery replacement",
		Description: &desc,
		Scope:       []string{"battery", "cost"},
		Color:       &color,
		CreatedAt:   time.Date(2026, 3, 14, 10, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2026, 3, 15, 11, 30, 0, 0, time.UTC),
	}

	m := toKeyMap(t, orig)
	assertKeys(t, m,
		[]string{"id", "user_id", "vehicle_id", "occurred_at", "category", "title", "description", "scope", "color", "created_at", "updated_at"},
		[]string{"userId", "vehicleId", "occurredAt", "createdAt", "updatedAt"},
	)

	raw, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got ChartAnnotation
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("round-trip unmarshal: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("round trip mismatch:\n got  %+v\n want %+v", got, orig)
	}
}

// TestChartAnnotation_JSON_OmitsNilOptionals verifies omitempty on the nullable
// pointer fields, and that scope (no omitempty) always emits an array so the
// frontend can distinguish "shows on every chart" ([]) from "absent".
func TestChartAnnotation_JSON_OmitsNilOptionals(t *testing.T) {
	minimal := ChartAnnotation{
		ID:         1,
		OccurredAt: time.Unix(0, 0).UTC(),
		Category:   AnnotationCategoryCustom,
		Title:      "note",
		Scope:      []string{},
		CreatedAt:  time.Unix(0, 0).UTC(),
		UpdatedAt:  time.Unix(0, 0).UTC(),
	}
	m := toKeyMap(t, minimal)
	assertKeys(t, m,
		[]string{"id", "occurred_at", "category", "title", "scope", "created_at", "updated_at"},
		[]string{"user_id", "vehicle_id", "description", "color"},
	)
	if got := string(m["scope"]); got != "[]" {
		t.Errorf("scope = %s; empty scope must serialize as [] (no omitempty) for the wire contract", got)
	}
}

// TestChartAnnotation_JSON_DecodeSnakeCase pins the inbound direction: a
// snake_case payload (a serialized DB row / API body) decodes into the struct,
// including a null vehicle_id (fleet-wide) and null description.
func TestChartAnnotation_JSON_DecodeSnakeCase(t *testing.T) {
	payload := []byte(`{
		"id": 5,
		"user_id": 9,
		"vehicle_id": null,
		"occurred_at": "2026-01-02T03:04:05Z",
		"category": "trip",
		"title": "Road trip to coast",
		"description": null,
		"scope": ["mileage", "efficiency"],
		"color": "#f59e0b",
		"created_at": "2026-01-02T03:04:05Z",
		"updated_at": "2026-01-02T03:04:05Z"
	}`)
	var a ChartAnnotation
	if err := json.Unmarshal(payload, &a); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if a.ID != 5 {
		t.Errorf("id = %d; want 5", a.ID)
	}
	if a.UserID == nil || *a.UserID != 9 {
		t.Errorf("user_id = %v; want 9", a.UserID)
	}
	if a.VehicleID != nil {
		t.Errorf("vehicle_id = %v; want nil (fleet-wide)", a.VehicleID)
	}
	if a.Category != AnnotationCategoryTrip || !a.Category.Valid() {
		t.Errorf("category = %q (valid=%v); want trip/valid", a.Category, a.Category.Valid())
	}
	if a.Description != nil {
		t.Errorf("description = %v; want nil", a.Description)
	}
	if len(a.Scope) != 2 || a.Scope[0] != "mileage" || a.Scope[1] != "efficiency" {
		t.Errorf("scope = %v; want [mileage efficiency]", a.Scope)
	}
	if !a.OccurredAt.Equal(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)) {
		t.Errorf("occurred_at = %v; want 2026-01-02T03:04:05Z", a.OccurredAt)
	}
}
