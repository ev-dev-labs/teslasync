package automation

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"
)

type historyStatsRow struct {
	total, succeeded, failed, partial, durationRuns int
	avgDuration                                     float64
	err                                             error
}

func (r historyStatsRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 6 {
		return errors.New("expected six history aggregate columns")
	}
	for i, value := range []int{r.total, r.succeeded, r.failed, r.partial} {
		*dest[i].(*int) = value
	}
	*dest[4].(*float64) = r.avgDuration
	*dest[5].(*int) = r.durationRuns
	return nil
}

func TestHistoryStatsDurationPopulation(t *testing.T) {
	for _, tt := range []struct {
		name string
		row  historyStatsRow
		rate float64
	}{
		{"populated completed runs", historyStatsRow{total: 4, succeeded: 3, failed: 1, avgDuration: 1250, durationRuns: 4}, 75},
		{"recorded durations beyond completed runs", historyStatsRow{total: 4, succeeded: 2, failed: 1, partial: 1, avgDuration: 875, durationRuns: 7}, 50},
		{"no completed runs but recorded durations", historyStatsRow{avgDuration: 250, durationRuns: 2}, 0},
		{"completed runs without recorded durations", historyStatsRow{total: 1, succeeded: 1}, 100},
		{"empty", historyStatsRow{}, 0},
		{"recorded zero duration", historyStatsRow{total: 1, succeeded: 1, durationRuns: 1}, 100},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := scanHistoryStats(tt.row)
			if err != nil {
				t.Fatal(err)
			}
			if got.TotalExecutions != tt.row.total || got.Succeeded != tt.row.succeeded ||
				got.Failed != tt.row.failed || got.Partial != tt.row.partial || got.SuccessRate != tt.rate {
				t.Fatalf("completed-run statistics changed: %+v", got)
			}
			if got.AvgDurationMs != tt.row.avgDuration || got.AvgDurationRuns != tt.row.durationRuns {
				t.Fatalf("recorded-duration aggregate changed: %+v", got)
			}
			payload, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			var response struct {
				Population string `json:"avg_duration_population"`
				Runs       int    `json:"avg_duration_runs"`
			}
			if err := json.Unmarshal(payload, &response); err != nil {
				t.Fatal(err)
			}
			if response.Population != "runs_with_recorded_duration_excluding_test_undo" || response.Runs != tt.row.durationRuns {
				t.Fatalf("duration population missing or incorrect in response: %s", payload)
			}
		})
	}
}

func TestHistoryStatsDurationQuery(t *testing.T) {
	for _, aggregate := range []string{"AVG(duration_ms)", "COUNT(*)"} {
		if !strings.Contains(historyStatsQuery, aggregate+" FILTER (WHERE "+historyDurationFilter+")") {
			t.Fatalf("%s does not use the recorded-duration population: %s", aggregate, historyStatsQuery)
		}
	}
	if historyDurationFilter != "duration_ms IS NOT NULL AND status NOT IN ('test','undo')" {
		t.Fatalf("existing duration population changed: %s", historyDurationFilter)
	}
	if strings.Contains(historyStatsQuery, "LIMIT") || strings.Contains(historyStatsQuery, "OFFSET") {
		t.Fatal("summary must not be calculated from a page")
	}
}

func TestHistoryStatsScanError(t *testing.T) {
	want := errors.New("aggregate unavailable")
	got, err := scanHistoryStats(historyStatsRow{err: want})
	if got != nil || !errors.Is(err, want) {
		t.Fatalf("scan error = (%+v, %v), want (nil, %v)", got, err, want)
	}
}

func TestActionResultsAvailability(t *testing.T) {
	for _, tt := range []struct {
		name      string
		payload   string
		status    string
		succeeded int
		want      HistorySectionAvailability
	}{
		{"missing", "", "success", 1, HistorySectionAvailability{Status: "unavailable"}},
		{"null", "null", "success", 1, HistorySectionAvailability{Status: "unavailable"}},
		{"invalid shape", `{}`, "success", 1, HistorySectionAvailability{Status: "failed"}},
		{"recorded empty", `[]`, "skipped", 0, HistorySectionAvailability{Status: "available", Complete: true}},
		{"missing completed results", `[]`, "success", 1, HistorySectionAvailability{Status: "available", Truncated: true}},
		{"populated", `[{"ok":true}]`, "success", 1, HistorySectionAvailability{Status: "available", Complete: true, Total: 1}},
		{"running", `[{"ok":true}]`, "running", 1, HistorySectionAvailability{Status: "available", Total: 1}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			h := &automationmodel.AutomationHistory{ActionsExecuted: json.RawMessage(tt.payload), Status: tt.status, ActionsSucceeded: tt.succeeded}
			got := ActionResultsAvailability(h)
			if got != tt.want {
				t.Fatalf("availability = %+v, want %+v", got, tt.want)
			}
			if string(h.ActionsExecuted) != tt.payload {
				t.Fatal("availability changed the record payload")
			}
		})
	}
}

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
	before := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	f := HistoryFilter{
		AutomationID: 42,
		Status:       "failed",
		Since:        since,
		Before:       before,
	}
	where, args := buildHistoryWhere(f)

	if where == "" {
		t.Fatal("expected non-empty WHERE clause")
	}

	if len(args) != 4 {
		t.Fatalf("expected 4 args, got %d", len(args))
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
	if args[3] != before {
		t.Errorf("expected before=%v, got %v", before, args[3])
	}

	if !containsSubstring(where, "automation_id = $1") {
		t.Errorf("WHERE clause missing automation_id filter: %s", where)
	}
	if !containsSubstring(where, "status = $2") {
		t.Errorf("WHERE clause missing status filter: %s", where)
	}
	if !containsSubstring(where, "triggered_at >= $3") {
		t.Errorf("WHERE clause missing since filter: %s", where)
	}
	if !containsSubstring(where, "triggered_at < $4") {
		t.Errorf("WHERE clause missing upper bound: %s", where)
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
