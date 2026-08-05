package serviceintelligence

import (
	"strings"
	"testing"
)

func TestRecentObservationsQueryUsesCanonicalChangeFeed(t *testing.T) {
	t.Parallel()

	for _, token := range []string{
		"FROM signal_log",
		"field",
		"ts",
		"float_value",
		"int_value",
		"STDDEV_SAMP",
		"LIMIT $6",
	} {
		if !strings.Contains(recentObservationsQuery, token) {
			t.Fatalf("recent observations query missing %q", token)
		}
	}
	for _, forbidden := range []string{
		"positions",
		"snapshot",
		"vehicle_live_state",
		"SELECT *",
	} {
		if strings.Contains(recentObservationsQuery, forbidden) {
			t.Fatalf("recent observations query contains forbidden token %q", forbidden)
		}
	}
}
