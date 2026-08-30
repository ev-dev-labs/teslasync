package datarepair

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"
)

// This package has no practical DB-mocking seam (no pgxmock dependency; see
// repo_test.go / case_repo_test.go for the established precedent of testing
// pure logic + the nil-pool contract instead of a live PostgreSQL). These
// tests pin:
//   - the nil-pool / nil-receiver degradation contract for the new method
//   - SQL shape: column lists, placeholder counts/positions, and the
//     canonicalization guard (d2.id > d1.id) that dedupes overlap pairs
//   - that every query is bounded by a LIMIT tied to the caller's argument
//   - that tiny non-identical overlaps are suppressed without hiding exact
//     duplicate windows

var placeholderRe = regexp.MustCompile(`\$(\d+)`)

// maxPlaceholder returns the highest $N placeholder used in a query, which
// must equal the number of arguments passed to Query for the call to be
// well-formed.
func maxPlaceholder(t *testing.T, query string) int {
	t.Helper()
	matches := placeholderRe.FindAllStringSubmatch(query, -1)
	if len(matches) == 0 {
		t.Fatalf("query has no placeholders: %s", query)
	}
	max := 0
	for _, m := range matches {
		n := 0
		for _, r := range m[1] {
			n = n*10 + int(r-'0')
		}
		if n > max {
			max = n
		}
	}
	return max
}

// ---------------------------------------------------------------------------
// Nil-pool / nil-receiver degradation
// ---------------------------------------------------------------------------

func TestListSessionAnomalies_NilPoolReturnsErrNoDatabase(t *testing.T) {
	t.Parallel()

	repo := NewRepo(nil)
	since := time.Now().UTC().Add(-24 * time.Hour)

	_, err := repo.ListSessionAnomalies(context.Background(), since, nil, 50)
	if !errors.Is(err, ErrNoDatabase) {
		t.Errorf("err = %v, want ErrNoDatabase", err)
	}
}

func TestListSessionAnomalies_NilReceiverIsSafe(t *testing.T) {
	t.Parallel()

	var repo *Repo
	_, err := repo.ListSessionAnomalies(context.Background(), time.Now(), nil, 50)
	if !errors.Is(err, ErrNoDatabase) {
		t.Errorf("nil receiver: err = %v, want ErrNoDatabase", err)
	}
}

func TestAnySourceAtLimitReportsPotentialSQLTruncation(t *testing.T) {
	t.Parallel()

	if !anySourceAtLimit(100, 2, 100, 0) {
		t.Error("a source returning exactly its SQL LIMIT must mark the scan truncated")
	}
	if anySourceAtLimit(100, 2, 99, 0) {
		t.Error("sources below the SQL LIMIT must not imply truncation")
	}
}

// ---------------------------------------------------------------------------
// SQL shape: single-session queries
// ---------------------------------------------------------------------------

func TestDriveAnomalyRowsQuery_Shape(t *testing.T) {
	t.Parallel()

	q := driveAnomalyRowsQuery
	if !strings.Contains(q, "FROM drives") {
		t.Error("query must read from drives")
	}
	for _, col := range []string{
		"id", "vehicle_id", "started_at", "ended_at", "duration_s", "distance_m",
		"start_odometer_m", "end_odometer_m", "start_soc_pct", "end_soc_pct",
		"energy_used_wh", "regen_energy_wh",
	} {
		if !strings.Contains(q, col) {
			t.Errorf("query missing expected column %q", col)
		}
	}
	if !strings.Contains(q, "LIMIT $6") {
		t.Error("query must terminate with a caller-supplied LIMIT $6")
	}
	if got, want := maxPlaceholder(t, q), 6; got != want {
		t.Errorf("max placeholder = $%d, want $%d (since, vehicle, duration tol, odometer tol, soc tol, limit)", got, want)
	}
	// vehicle filter must use the interface-typed-nil guard, not a bare
	// equality, or it would silently match vehicle 0 for a fleet-wide scan.
	if !strings.Contains(q, "$2::bigint IS NULL OR vehicle_id = $2") {
		t.Error("query must guard the optional vehicle filter with ($2::bigint IS NULL OR vehicle_id = $2)")
	}
}

func TestChargingAnomalyRowsQuery_Shape(t *testing.T) {
	t.Parallel()

	q := chargingAnomalyRowsQuery
	if !strings.Contains(q, "FROM charging_sessions") {
		t.Error("query must read from charging_sessions")
	}
	for _, col := range []string{
		"id", "vehicle_id", "started_at", "ended_at",
		"start_odometer_m", "end_odometer_m", "start_soc_pct", "end_soc_pct",
		"total_energy_added_wh",
	} {
		if !strings.Contains(q, col) {
			t.Errorf("query missing expected column %q", col)
		}
	}
	if strings.Contains(q, "duration_s") {
		t.Error("charging_sessions has no stored duration column; query must not reference duration_s")
	}
	if got, want := maxPlaceholder(t, q), 5; got != want {
		t.Errorf("max placeholder = $%d, want $%d (since, vehicle, odometer tol, soc tol, limit)", got, want)
	}
	if !strings.Contains(q, "LIMIT $5") {
		t.Error("query must terminate with a caller-supplied LIMIT $5")
	}
}

// ---------------------------------------------------------------------------
// SQL shape: overlap queries
// ---------------------------------------------------------------------------

func TestOverlapQueries_Shape(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		query string
		table string
		alias string
	}{
		{"drive-drive", driveDriveOverlapQuery, "drives d1", "d2.id > d1.id"},
		{"charging-charging", chargingChargingOverlapQuery, "charging_sessions c1", "c2.id > c1.id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if !strings.Contains(tt.query, tt.table) {
				t.Errorf("query must self-join %s", tt.table)
			}
			// The strict id-ordering guard is what canonicalizes each pair to
			// exactly one direction (SessionID is always the lower id),
			// which is both the dedup mechanism and the determinism source.
			if !strings.Contains(tt.query, tt.alias) {
				t.Errorf("query must canonicalize pairs with %q to avoid double-counting each overlap", tt.alias)
			}
			if !strings.Contains(tt.query, "started_at >= $1 OR") {
				t.Error("query must include a pair when either side starts inside the lookback")
			}
			if !strings.Contains(tt.query, "ended_at IS NOT NULL") {
				t.Error("overlap queries must exclude open (NULL ended_at) sessions — that is the open-boundary diagnosis's territory")
			}
			if strings.Count(tt.query, "ended_at >= $1") < 2 {
				t.Error("overlap query must range-bound both sides by ended_at for indexable lookback scans")
			}
			if got, want := maxPlaceholder(t, tt.query), 4; got != want {
				t.Errorf("max placeholder = $%d, want $%d (since, vehicle, overlap tolerance, limit)", got, want)
			}
			if !strings.Contains(tt.query, "LIMIT $4") {
				t.Error("query must terminate with a caller-supplied LIMIT $4")
			}
			if !strings.Contains(tt.query, "> $3") {
				t.Error("query must suppress non-identical overlaps at or below the configured tolerance")
			}
			if !strings.Contains(tt.query, "started_at =") || !strings.Contains(tt.query, "ended_at =") {
				t.Error("same-kind query must preserve exact duplicate-window detection regardless of overlap duration")
			}
		})
	}
}

func TestCrossKindOverlapQuery_Shape(t *testing.T) {
	t.Parallel()

	q := crossKindOverlapQuery
	if !strings.Contains(q, "FROM drives d") || !strings.Contains(q, "JOIN charging_sessions c") {
		t.Error("cross-kind query must join drives (primary) with charging_sessions (related)")
	}
	if !strings.Contains(q, "d.ended_at IS NOT NULL") || !strings.Contains(q, "c.ended_at IS NOT NULL") {
		t.Error("cross-kind query must require both sides to be closed sessions")
	}
	if !strings.Contains(q, "d.started_at >= $1 OR c.started_at >= $1") {
		t.Error("cross-kind query must include a pair when either side starts inside the lookback")
	}
	if !strings.Contains(q, "d.ended_at >= $1") || !strings.Contains(q, "c.ended_at >= $1") {
		t.Error("cross-kind query must range-bound both sides by ended_at")
	}
	if !strings.Contains(q, "> $3") {
		t.Error("cross-kind query must suppress overlaps at or below the configured tolerance")
	}
	if got, want := maxPlaceholder(t, q), 4; got != want {
		t.Errorf("max placeholder = %d, want %d (since, vehicle, overlap tolerance, limit)", got, want)
	}
}
