package export

import (
	"encoding/csv"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

func TestStringifyCell(t *testing.T) {
	tests := []struct {
		name string
		in   any
		want string
	}{
		{"nil", nil, ""},
		{"string", "hello", "hello"},
		{"bool true", true, "true"},
		{"bool false", false, "false"},
		{"int-like float", 42.0, "42"},
		{"float", 3.14, "3.14"},
		{"map", map[string]any{"a": 1}, `{"a":1}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stringifyCell(tt.in); got != tt.want {
				t.Errorf("stringifyCell(%v) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestPickTimestampKey(t *testing.T) {
	cases := []struct {
		cols []string
		want string
	}{
		{[]string{"id", "ts", "value"}, "ts"},
		{[]string{"id", "value"}, ""},
		{[]string{"start_ts", "end_ts"}, "start_ts"},
		{[]string{"created_at", "id"}, "created_at"},
	}
	for _, c := range cases {
		if got := pickTimestampKey(c.cols); got != c.want {
			t.Errorf("pickTimestampKey(%v) = %q, want %q", c.cols, got, c.want)
		}
	}
}

func TestRowInDateRange(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC)
	cases := []struct {
		name string
		cell any
		want bool
	}{
		{"in range", "2026-06-15T12:00:00Z", true},
		{"before start", "2025-12-31T23:59:59Z", false},
		{"after end", "2027-01-01T00:00:00Z", false},
		{"non-string passes", 123.0, true},
		{"unparsable passes", "not-a-date", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := rowInDateRange(c.cell, &start, &end); got != c.want {
				t.Errorf("rowInDateRange(%v) = %v, want %v", c.cell, got, c.want)
			}
		})
	}
}

func TestSnapshotToCSV(t *testing.T) {
	snap := &database.ExportTableSnapshot{
		Table:   "vehicles",
		Columns: []string{"id", "name", "battery"},
		Rows: []database.ExportTableRow{
			{"id": 1.0, "name": "Model 3", "battery": 75.5},
			{"id": 2.0, "name": "Model Y", "battery": nil},
		},
	}
	out, err := snapshotToCSV(snap, nil, nil)
	if err != nil {
		t.Fatalf("snapshotToCSV: %v", err)
	}
	r := csv.NewReader(strings.NewReader(string(out)))
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("want 3 rows (incl header), got %d", len(records))
	}
	// Sorted column order: battery, id, name
	if got := records[0]; got[0] != "battery" || got[1] != "id" || got[2] != "name" {
		t.Errorf("header = %v, want sorted [battery id name]", got)
	}
	// Empty cell for nil
	if records[2][0] != "" {
		t.Errorf("nil battery cell = %q, want empty", records[2][0])
	}
}

func TestAllowedAccountTablesIncludesCoreEntities(t *testing.T) {
	required := []string{"vehicles", "drives", "charging_sessions", "settings"}
	for _, table := range required {
		found := false
		for _, allowed := range database.AllowedAccountTables {
			if allowed == table {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("AllowedAccountTables missing required table %q", table)
		}
	}
}
