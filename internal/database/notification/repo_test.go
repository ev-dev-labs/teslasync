package notification

import (
	"context"
	"strings"
	"testing"
	"time"
)

// helper for *int64 literals.
func i64Ptr(v int64) *int64 { return &v }

func TestExistsTitleSince_NilPool(t *testing.T) {
	r := &NotificationRepo{}
	_, err := r.ExistsTitleSince(context.Background(), "Weekly FSD digest (#7 · 2026-03-02)", time.Now().UTC())
	if err == nil {
		t.Fatal("nil pool must error rather than scanning")
	}
}

func TestDeriveNotificationLogGroupKey_NilAlertID(t *testing.T) {
	if got := deriveNotificationLogGroupKey(nil, "warn"); got != nil {
		t.Fatalf("nil alert_id should yield nil group_key, got %q", *got)
	}
}

func TestDeriveNotificationLogGroupKey_EmptySeverity(t *testing.T) {
	cases := []string{"", "  ", "\t", "\n"}
	for _, sev := range cases {
		sev := sev
		t.Run("severity="+sev, func(t *testing.T) {
			if got := deriveNotificationLogGroupKey(i64Ptr(7), sev); got != nil {
				t.Fatalf("blank severity should yield nil group_key, got %q", *got)
			}
		})
	}
}

func TestDeriveNotificationLogGroupKey_DeterministicAcrossCallers(t *testing.T) {
	a := deriveNotificationLogGroupKey(i64Ptr(42), "warn")
	b := deriveNotificationLogGroupKey(i64Ptr(42), "warn")
	if a == nil || b == nil {
		t.Fatalf("expected non-nil group_keys, got %v / %v", a, b)
	}
	if *a != *b {
		t.Fatalf("derivation should be stable, got %q != %q", *a, *b)
	}
}

func TestDeriveNotificationLogGroupKey_CaseAndWhitespaceInsensitive(t *testing.T) {
	canonical := deriveNotificationLogGroupKey(i64Ptr(42), "warn")
	if canonical == nil {
		t.Fatalf("expected canonical group_key, got nil")
	}
	cases := []string{"WARN", " warn ", "Warn", "WaRn", "warn\n"}
	for _, sev := range cases {
		sev := sev
		t.Run("severity="+sev, func(t *testing.T) {
			got := deriveNotificationLogGroupKey(i64Ptr(42), sev)
			if got == nil {
				t.Fatalf("expected non-nil group_key for %q", sev)
			}
			if *got != *canonical {
				t.Fatalf("severity %q should map to canonical key %q, got %q", sev, *canonical, *got)
			}
		})
	}
}

func TestDeriveNotificationLogGroupKey_DistinctRulesProduceDistinctKeys(t *testing.T) {
	a := deriveNotificationLogGroupKey(i64Ptr(1), "warn")
	b := deriveNotificationLogGroupKey(i64Ptr(2), "warn")
	if a == nil || b == nil || *a == *b {
		t.Fatalf("different alert_ids should yield distinct keys (%v / %v)", a, b)
	}
}

func TestDeriveNotificationLogGroupKey_DistinctSeveritiesProduceDistinctKeys(t *testing.T) {
	w := deriveNotificationLogGroupKey(i64Ptr(99), "warn")
	c := deriveNotificationLogGroupKey(i64Ptr(99), "critical")
	i := deriveNotificationLogGroupKey(i64Ptr(99), "info")
	if w == nil || c == nil || i == nil {
		t.Fatalf("expected non-nil group_keys: %v / %v / %v", w, c, i)
	}
	if *w == *c || *w == *i || *c == *i {
		t.Fatalf("severities should never collide: warn=%q critical=%q info=%q", *w, *c, *i)
	}
}

func TestDeriveNotificationLogGroupKey_LowerHexFormat(t *testing.T) {
	got := deriveNotificationLogGroupKey(i64Ptr(123), "info")
	if got == nil {
		t.Fatalf("expected non-nil group_key")
	}
	if len(*got) != 64 {
		t.Fatalf("expected 64-char (sha256 lower-hex) key, got len=%d (%q)", len(*got), *got)
	}
	for i, c := range *got {
		ok := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')
		if !ok {
			t.Fatalf("char at %d (%q) is not lower-hex in %q", i, string(c), *got)
		}
	}
}

func TestIsValidNotificationGroupKey(t *testing.T) {
	good := deriveNotificationLogGroupKey(i64Ptr(1), "warn")
	if good == nil {
		t.Fatalf("expected non-nil canonical key")
	}
	if !IsValidNotificationGroupKey(*good) {
		t.Fatalf("derived key %q should pass IsValidNotificationGroupKey", *good)
	}

	bad := []string{
		"",
		"deadbeef",              // too short
		strings.Repeat("a", 63), // 63 chars
		strings.Repeat("a", 65), // 65 chars
		strings.Repeat("g", 64), // out-of-range hex char
		strings.ToUpper(*good),  // uppercase rejected — derived form is lower
		strings.Repeat("0", 32) + " " + strings.Repeat("0", 31), // embedded space
	}
	for _, b := range bad {
		b := b
		t.Run("bad="+b, func(t *testing.T) {
			if IsValidNotificationGroupKey(b) {
				t.Fatalf("expected IsValidNotificationGroupKey(%q) = false", b)
			}
		})
	}
}

func TestBuildNotificationLogWhere_Empty(t *testing.T) {
	w := buildNotificationLogWhere(NotificationLogFilters{})
	if len(w.clauses) != 0 || len(w.args) != 0 {
		t.Fatalf("empty filter should produce no clauses/args, got %v / %v", w.clauses, w.args)
	}
	if w.needsRuleJoin {
		t.Fatalf("no severity/vehicle filter should not require rule join")
	}
}

func TestBuildNotificationLogWhere_GroupKey(t *testing.T) {
	gk := strings.Repeat("a", 64)
	w := buildNotificationLogWhere(NotificationLogFilters{GroupKey: " " + gk + " "})
	// The builder trims the value before matching.
	if len(w.clauses) != 1 {
		t.Fatalf("expected exactly one clause, got %v", w.clauses)
	}
	if !strings.Contains(w.clauses[0], "nl.group_key = $1") {
		t.Fatalf("expected group_key clause, got %q", w.clauses[0])
	}
	if len(w.args) != 1 || w.args[0] != gk {
		t.Fatalf("expected trimmed group_key in args, got %v", w.args)
	}
	if w.needsRuleJoin {
		t.Fatalf("group_key alone should not need rule join")
	}
}

func TestBuildNotificationLogWhere_RuleJoinFlagSetByVehicleOrSeverity(t *testing.T) {
	cases := map[string]NotificationLogFilters{
		"severity": {Severities: []string{"warn"}},
		"vehicle":  {VehicleIDs: []int64{1}},
		"both":     {Severities: []string{"warn"}, VehicleIDs: []int64{1}},
	}
	for name, f := range cases {
		f := f
		t.Run(name, func(t *testing.T) {
			w := buildNotificationLogWhere(f)
			if !w.needsRuleJoin {
				t.Fatalf("expected needsRuleJoin=true")
			}
		})
	}
}

func TestBuildNotificationLogWhere_UsesCanonicalVehicleScope(t *testing.T) {
	w := buildNotificationLogWhere(NotificationLogFilters{
		VehicleIDs: []int64{7, 9},
	})
	if len(w.clauses) != 1 {
		t.Fatalf("vehicle clauses = %v, want one clause", w.clauses)
	}
	clause := w.clauses[0]
	for _, expected := range []string{
		"nl.alert_id IS NULL",
		"ar.all_vehicles",
		"alert_rule_vehicles",
		"arv.vehicle_id = ANY($1)",
	} {
		if !strings.Contains(clause, expected) {
			t.Fatalf("vehicle clause = %q, missing %q", clause, expected)
		}
	}
	if strings.Contains(clause, "ar.vehicle_id") {
		t.Fatalf("vehicle clause still uses deprecated alert_rules.vehicle_id: %q", clause)
	}
	if len(w.args) != 1 {
		t.Fatalf("vehicle args = %v, want one canonical vehicle array", w.args)
	}
}

func TestBuildNotificationLogWhere_UsesStableKeysetCursor(t *testing.T) {
	before := time.Date(2025, time.January, 2, 12, 30, 0, 0, time.UTC)
	w := buildNotificationLogWhere(NotificationLogFilters{
		BeforeCreatedAt: before,
		BeforeID:        123,
	})
	if len(w.clauses) != 1 {
		t.Fatalf("cursor clauses = %v, want one clause", w.clauses)
	}
	clause := w.clauses[0]
	for _, expected := range []string{
		"nl.created_at < $1",
		"nl.created_at = $1",
		"nl.id < $2",
	} {
		if !strings.Contains(clause, expected) {
			t.Fatalf("cursor clause = %q, missing %q", clause, expected)
		}
	}
	if len(w.args) != 2 || w.args[0] != before || w.args[1] != int64(123) {
		t.Fatalf("cursor args = %v, want [%v 123]", w.args, before)
	}
}

func TestBuildNotificationLogWhere_UsesEffectiveAlertWarningSeverity(t *testing.T) {
	effective := buildNotificationLogWhere(NotificationLogFilters{
		Severities:                 []string{"warn"},
		IncludeFailedInfoAsWarning: true,
	})
	if len(effective.clauses) != 1 {
		t.Fatalf("effective severity clauses = %v, want one clause", effective.clauses)
	}
	if !strings.Contains(effective.clauses[0], "nl.status = 'failed'") {
		t.Fatalf("effective warning clause = %q, want failed-delivery promotion", effective.clauses[0])
	}
	if !strings.Contains(effective.clauses[0], "CASE WHEN") {
		t.Fatalf("effective warning clause = %q, want computed DTO severity", effective.clauses[0])
	}
	if len(effective.args) != 1 {
		t.Fatalf("effective warning args = %v, want one severity array", effective.args)
	}

	effectiveInfo := buildNotificationLogWhere(NotificationLogFilters{
		Severities:                 []string{"info"},
		IncludeFailedInfoAsWarning: true,
	})
	if len(effectiveInfo.clauses) != 1 ||
		!strings.Contains(effectiveInfo.clauses[0], "CASE WHEN") {
		t.Fatalf("effective info clause = %v, want computed DTO severity", effectiveInfo.clauses)
	}

	raw := buildNotificationLogWhere(NotificationLogFilters{
		Severities: []string{"warn"},
	})
	if len(raw.clauses) != 1 {
		t.Fatalf("raw severity clauses = %v, want one clause", raw.clauses)
	}
	if strings.Contains(raw.clauses[0], "nl.status = 'failed'") {
		t.Fatalf("raw notification severity unexpectedly promoted failures: %q", raw.clauses[0])
	}
}

func TestBuildNotificationLogWhere_PlaceholderOrdering(t *testing.T) {
	// All clauses below add at least one placeholder; verify the
	// numbering walks $1..$N in clause-emit order so the bind values
	// match what the database expects.
	tru := true
	w := buildNotificationLogWhere(NotificationLogFilters{
		RuleIDs:    []int64{1},
		Read:       &tru,
		Query:      "battery",
		GroupKey:   strings.Repeat("a", 64),
		Severities: []string{"warn"},
	})
	joined := strings.Join(w.clauses, " | ")
	// Expect: $1 (RuleIDs), no placeholder for Read, $2 ILIKE pair, $3 group_key, $4 severity
	for i, marker := range []string{"$1", "$2", "$3", "$4"} {
		if !strings.Contains(joined, marker) {
			t.Fatalf("expected placeholder %s in clauses (index %d): %s", marker, i, joined)
		}
	}
	// Number of bind args should equal: RuleIDs(1) + ILIKE(1) + GroupKey(1) + Severities(1) = 4
	if len(w.args) != 4 {
		t.Fatalf("expected 4 bind args, got %d (%v)", len(w.args), w.args)
	}
}
