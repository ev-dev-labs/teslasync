package database

import (
	"testing"
	"time"
)

func TestBuildHistoryWhere_NoFilters(t *testing.T) {
	where, args := buildHistoryWhere(HistoryFilter{})
	if where != "" {
		t.Errorf("expected empty WHERE, got %q", where)
	}
	if len(args) != 0 {
		t.Errorf("expected 0 args, got %d", len(args))
	}
}

func TestBuildHistoryWhere_AllFilters(t *testing.T) {
	since := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	f := HistoryFilter{
		AutomationID: 42,
		Status:       "failed",
		Since:        since,
	}
	where, args := buildHistoryWhere(f)

	if where == "" {
		t.Fatal("expected non-empty WHERE clause")
	}

	// Should have 3 positional parameters.
	if len(args) != 3 {
		t.Fatalf("expected 3 args, got %d", len(args))
	}
	if args[0] != int64(42) {
		t.Errorf("expected automation_id=42, got %v", args[0])
	}
	if args[1] != "failed" {
		t.Errorf("expected status=failed, got %v", args[1])
	}
	if args[2] != since {
		t.Errorf("expected since=%v, got %v", since, args[2])
	}

	// Check that clause contains all three conditions.
	if !containsSubstring(where, "automation_id = $1") {
		t.Errorf("WHERE clause missing automation_id filter: %s", where)
	}
	if !containsSubstring(where, "status = $2") {
		t.Errorf("WHERE clause missing status filter: %s", where)
	}
	if !containsSubstring(where, "triggered_at >= $3") {
		t.Errorf("WHERE clause missing since filter: %s", where)
	}
}

func TestBuildHistoryWhere_StatusOnly(t *testing.T) {
	f := HistoryFilter{Status: "success"}
	where, args := buildHistoryWhere(f)

	if len(args) != 1 {
		t.Fatalf("expected 1 arg, got %d", len(args))
	}
	if args[0] != "success" {
		t.Errorf("expected status=success, got %v", args[0])
	}
	if !containsSubstring(where, "status = $1") {
		t.Errorf("WHERE clause missing status filter: %s", where)
	}
}

func TestBuildHistoryWhere_SinceOnly(t *testing.T) {
	since := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	f := HistoryFilter{Since: since}
	where, args := buildHistoryWhere(f)

	if len(args) != 1 {
		t.Fatalf("expected 1 arg, got %d", len(args))
	}
	if args[0] != since {
		t.Errorf("expected since=%v, got %v", since, args[0])
	}
	if !containsSubstring(where, "triggered_at >= $1") {
		t.Errorf("WHERE clause missing since filter: %s", where)
	}
}

func TestBuildHistoryWhere_AutomationIDOnly(t *testing.T) {
	f := HistoryFilter{AutomationID: 7}
	where, args := buildHistoryWhere(f)

	if len(args) != 1 {
		t.Fatalf("expected 1 arg, got %d", len(args))
	}
	if args[0] != int64(7) {
		t.Errorf("expected automation_id=7, got %v", args[0])
	}
	if !containsSubstring(where, "automation_id = $1") {
		t.Errorf("WHERE clause missing automation_id filter: %s", where)
	}
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && stringContains(s, sub))
}

func stringContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
