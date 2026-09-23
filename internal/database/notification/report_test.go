package notification

import (
	"strings"
	"testing"
)

func TestReportSQLCountsCorrelatedTriggersOnly(t *testing.T) {
	// The trigger CTE is keyed by the producer UUID, not by delivery ID,
	// alert rule ID, or channel ID. A two-channel fan-out yields one row.
	for _, clause := range []string{
		"FROM events GROUP BY trigger_id",
		"FROM classified",
		"WHERE trigger_id IS NULL",
		"nl.status = 'triggered'",
		"nl.status <> 'triggered'",
		"UNION ALL SELECT 'deliveries', '', '', COUNT(*)::bigint FROM deliveries",
		"SELECT 'triggered' AS dimension",
	} {
		if !strings.Contains(reportSQL, clause) {
			t.Fatalf("report lost anti-double-count/history predicate %q", clause)
		}
	}
	if strings.Contains(reportSQL, "COALESCE(trigger_id,") {
		t.Fatal("legacy rows cannot be counted as distinct triggers")
	}
	for _, family := range []string{"alert.%", "system.%", "schedule.%", "automation.%", "test.%"} {
		if !strings.Contains(reportSQL, family) {
			t.Fatalf("source classification missing %s", family)
		}
	}
}
