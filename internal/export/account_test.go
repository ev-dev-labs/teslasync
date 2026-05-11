package export

import (
	"encoding/csv"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// jsonUnmarshal is a tiny adapter so the JSON round-trip test reads
// naturally without forcing a json import alias on the rest of the file.
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

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
	out, err := snapshotToCSV(snap, nil, nil, nil)
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

// ---------------------------------------------------------------------------
// Phase-46 / Prompt 62 — column allowlist on exports
// ---------------------------------------------------------------------------

// TestExport_NoColumns_BackwardsCompat is the canary the phase-46/62 gate
// asserts is present: an export request with no `columns` field MUST behave
// identically to today. Specifically:
//   - resolveColumnSelection returns the full catalog in catalog order
//   - snapshotToCSV with allowedColumns=nil emits sorted-alphabetic column
//     order matching the pre-Phase-46/62 byte-for-byte contract
//   - ValidateColumns([]) returns nil/nil (no-op)
func TestExport_NoColumns_BackwardsCompat(t *testing.T) {
	t.Run("resolveColumnSelection returns full catalog", func(t *testing.T) {
		cols, err := resolveColumnSelection("drives", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := AvailableColumns("drives")
		if len(cols) != len(want) {
			t.Fatalf("len = %d, want %d", len(cols), len(want))
		}
		for i := range cols {
			if cols[i].Name != want[i].Name {
				t.Errorf("cols[%d].Name = %q, want %q", i, cols[i].Name, want[i].Name)
			}
		}
	})

	t.Run("ValidateColumns nil returns nil", func(t *testing.T) {
		out, err := ValidateColumns("drives", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Empty request returns the whole catalog as a normalised name slice
		// (spec'd "byte-for-byte same default behaviour"), so we assert the
		// shape is the catalog rather than nil.
		if len(out) != len(AvailableColumns("drives")) {
			t.Errorf("len = %d, want catalog size", len(out))
		}
	})

	t.Run("snapshotToCSV nil columns matches legacy sorted order", func(t *testing.T) {
		snap := &database.ExportTableSnapshot{
			Table:   "vehicles",
			Columns: []string{"id", "name", "battery"},
			Rows: []database.ExportTableRow{
				{"id": 1.0, "name": "Model 3", "battery": 75.5},
			},
		}
		out, err := snapshotToCSV(snap, nil, nil, nil)
		if err != nil {
			t.Fatalf("snapshotToCSV: %v", err)
		}
		r := csv.NewReader(strings.NewReader(string(out)))
		records, err := r.ReadAll()
		if err != nil {
			t.Fatalf("parse csv: %v", err)
		}
		if got := records[0]; got[0] != "battery" || got[1] != "id" || got[2] != "name" {
			t.Errorf("header = %v, want sorted [battery id name]", got)
		}
	})
}

func TestAvailableColumns(t *testing.T) {
	t.Run("drives catalog has required always-included columns", func(t *testing.T) {
		cols := AvailableColumns("drives")
		if len(cols) == 0 {
			t.Fatal("drives catalog is empty")
		}
		var alwaysCount int
		for _, c := range cols {
			if c.AlwaysIncluded {
				alwaysCount++
			}
			if c.Name == "" || c.Label == "" {
				t.Errorf("column %+v has empty Name or Label", c)
			}
		}
		if alwaysCount < 1 {
			t.Error("drives catalog has zero AlwaysIncluded columns; primary key must be required")
		}
	})

	t.Run("charging catalog populated", func(t *testing.T) {
		cols := AvailableColumns("charging")
		if len(cols) == 0 {
			t.Fatal("charging catalog is empty")
		}
	})

	t.Run("unknown type returns nil", func(t *testing.T) {
		if got := AvailableColumns("does-not-exist"); got != nil {
			t.Errorf("AvailableColumns(unknown) = %v, want nil", got)
		}
	})

	t.Run("returned slice is a copy", func(t *testing.T) {
		// Mutating the returned slice MUST NOT mutate the catalog.
		first := AvailableColumns("drives")
		if len(first) == 0 {
			t.Skip("nothing to mutate")
		}
		first[0].Name = "MUTATED"
		second := AvailableColumns("drives")
		if second[0].Name == "MUTATED" {
			t.Error("AvailableColumns returns a shared slice; callers can mutate the catalog")
		}
	})
}

func TestSupportsColumnSelection(t *testing.T) {
	cases := []struct {
		jobType string
		want    bool
	}{
		{"drives", true},
		{"charging", true},
		{"account", false},
		{"backup", false},
		{"analytics", false},
		{"", false},
		{"unknown", false},
	}
	for _, c := range cases {
		t.Run(c.jobType, func(t *testing.T) {
			if got := SupportsColumnSelection(c.jobType); got != c.want {
				t.Errorf("SupportsColumnSelection(%q) = %v, want %v", c.jobType, got, c.want)
			}
		})
	}
}

func TestValidateColumns(t *testing.T) {
	cases := []struct {
		name      string
		jobType   string
		requested []string
		wantErr   bool
		// wantNames is checked only when wantErr is false.
		wantNames []string
	}{
		{
			name:      "subset preserves order",
			jobType:   "drives",
			requested: []string{"start_date", "distance_m"},
			// AlwaysIncluded (id, vehicle_id) get prepended in catalog order.
			wantNames: []string{"id", "vehicle_id", "start_date", "distance_m"},
		},
		{
			name:      "duplicates collapse to first occurrence",
			jobType:   "drives",
			requested: []string{"distance_m", "distance_m", "start_date"},
			wantNames: []string{"id", "vehicle_id", "distance_m", "start_date"},
		},
		{
			name:      "always-included columns survive when caller omits them",
			jobType:   "drives",
			requested: []string{"distance_m"},
			wantNames: []string{"id", "vehicle_id", "distance_m"},
		},
		{
			name:      "always-included columns kept in caller-supplied order when provided",
			jobType:   "drives",
			requested: []string{"distance_m", "id", "vehicle_id"},
			wantNames: []string{"distance_m", "id", "vehicle_id"},
		},
		{
			name:      "unknown column rejected",
			jobType:   "drives",
			requested: []string{"start_date", "weather"},
			wantErr:   true,
		},
		{
			name:      "empty request returns catalog",
			jobType:   "drives",
			requested: nil,
			wantNames: []string{"id", "vehicle_id", "start_date", "end_date", "distance_m", "duration_s", "max_speed_mps"},
		},
		{
			name:      "unknown type returns nil/nil (no validation)",
			jobType:   "totally-invalid",
			requested: []string{"x"},
			wantNames: nil,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ValidateColumns(c.jobType, c.requested)
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, c.wantErr)
			}
			if c.wantErr {
				return
			}
			if len(got) != len(c.wantNames) {
				t.Fatalf("got %v, want %v", got, c.wantNames)
			}
			for i := range got {
				if got[i] != c.wantNames[i] {
					t.Errorf("got[%d] = %q, want %q", i, got[i], c.wantNames[i])
				}
			}
		})
	}
}

func TestSnapshotToCSV_ColumnAllowlist(t *testing.T) {
	snap := &database.ExportTableSnapshot{
		Table:   "vehicles",
		Columns: []string{"id", "name", "battery", "weather"},
		Rows: []database.ExportTableRow{
			{"id": 1.0, "name": "Model 3", "battery": 75.5, "weather": "sunny"},
			{"id": 2.0, "name": "Model Y", "battery": 80.0, "weather": "cloudy"},
		},
	}

	t.Run("subset preserves caller order", func(t *testing.T) {
		out, err := snapshotToCSV(snap, nil, nil, []string{"name", "battery"})
		if err != nil {
			t.Fatalf("snapshotToCSV: %v", err)
		}
		records, err := csv.NewReader(strings.NewReader(string(out))).ReadAll()
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if got := records[0]; len(got) != 2 || got[0] != "name" || got[1] != "battery" {
			t.Errorf("header = %v, want [name battery]", got)
		}
		if got := records[1]; got[0] != "Model 3" || got[1] != "75.5" {
			t.Errorf("row[1] = %v, want [Model 3 75.5]", got)
		}
		// "weather" must be filtered out
		for _, row := range records {
			for _, cell := range row {
				if cell == "sunny" || cell == "cloudy" {
					t.Errorf("filtered column 'weather' leaked into output: %v", row)
				}
			}
		}
	})

	t.Run("unknown column silently skipped (account intersection rule)", func(t *testing.T) {
		out, err := snapshotToCSV(snap, nil, nil, []string{"name", "does_not_exist", "battery"})
		if err != nil {
			t.Fatalf("snapshotToCSV: %v", err)
		}
		records, err := csv.NewReader(strings.NewReader(string(out))).ReadAll()
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if got := records[0]; len(got) != 2 || got[0] != "name" || got[1] != "battery" {
			t.Errorf("header = %v, want [name battery] (unknown silently skipped)", got)
		}
	})

	t.Run("dedupe of repeated columns", func(t *testing.T) {
		out, err := snapshotToCSV(snap, nil, nil, []string{"name", "name", "battery"})
		if err != nil {
			t.Fatalf("snapshotToCSV: %v", err)
		}
		records, _ := csv.NewReader(strings.NewReader(string(out))).ReadAll()
		if got := records[0]; len(got) != 2 {
			t.Errorf("header has %d cols, want 2 (dedupe)", len(got))
		}
	})

	t.Run("empty intersection produces no data rows", func(t *testing.T) {
		out, err := snapshotToCSV(snap, nil, nil, []string{"only_unknown"})
		if err != nil {
			t.Fatalf("snapshotToCSV: %v", err)
		}
		records, _ := csv.NewReader(strings.NewReader(string(out))).ReadAll()
		// With zero columns the CSV writer produces no header line and
		// definitely no data rows; verify nothing leaked.
		if len(records) > 1 {
			t.Errorf("want at most a header row, got %d records", len(records))
		}
		for _, row := range records {
			if len(row) > 0 {
				t.Errorf("data leaked into output: %v", row)
			}
		}
	})
}

func TestJobRequest_JSONRoundTrip(t *testing.T) {
	// JobRequest embeds models.ExportJobRequest; encoding/json must
	// promote the embedded fields and emit `columns` flat at the top
	// level so MQTT publishers / consumers stay wire-compatible.
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{
			name: "no columns key (legacy publisher)",
			in:   `{"job_id":"x","type":"drives","format":"csv"}`,
			want: nil,
		},
		{
			name: "columns key present",
			in:   `{"job_id":"x","type":"drives","format":"csv","columns":["id","start_date"]}`,
			want: []string{"id", "start_date"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req JobRequest
			if err := jsonUnmarshal([]byte(tt.in), &req); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if req.Type != "drives" {
				t.Errorf("Type = %q, want drives (embedded promotion failed)", req.Type)
			}
			if len(req.Columns) != len(tt.want) {
				t.Errorf("Columns len = %d, want %d", len(req.Columns), len(tt.want))
			}
			for i := range req.Columns {
				if req.Columns[i] != tt.want[i] {
					t.Errorf("Columns[%d] = %q, want %q", i, req.Columns[i], tt.want[i])
				}
			}
		})
	}
}
