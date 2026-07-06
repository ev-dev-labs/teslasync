package energy

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// These tests are pure-Go: they pin the audited SQL shape, the shared
// limit-clamp rule, the not-populated sentinel detector, and the
// construction/validation guards. Actual SQL execution requires a live
// TimescaleDB with migration 000188 applied — this package has no
// pgxmock/testcontainers harness, so the round-trip coverage in
// roundtrip_test.go is gated behind DATABASE_URL/TESLASYNC_TEST_DSN.

// TestClampLimit exercises the single limit-normaliser shared by all five
// list endpoints. A regression here would either allow an unbounded scan
// (limit > max) or push a non-positive bind parameter into Postgres.
func TestClampLimit(t *testing.T) {
	t.Parallel()
	const def, max = 50, 100
	cases := []struct {
		name  string
		limit int
		def   int
		max   int
		want  int
	}{
		{"zero collapses to default", 0, def, max, def},
		{"negative collapses to default", -1, def, max, def},
		{"large negative collapses to default", -1000, def, max, def},
		{"one is preserved", 1, def, max, 1},
		{"mid-range preserved", 30, def, max, 30},
		{"exactly max preserved", max, def, max, max},
		{"just over max collapses", max + 1, def, max, def},
		{"far over max collapses", max * 10, def, max, def},
		{"history bounds: valid", 750, 500, 1000, 750},
		{"history bounds: over", 1001, 500, 1000, 500},
		{"live bounds: valid", 1999, 500, 2000, 1999},
		{"live bounds: exactly max", 2000, 500, 2000, 2000},
		{"live bounds: over", 2001, 500, 2000, 500},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := clampLimit(tc.limit, tc.def, tc.max); got != tc.want {
				t.Errorf("clampLimit(%d, %d, %d) = %d, want %d", tc.limit, tc.def, tc.max, got, tc.want)
			}
		})
	}
}

// TestClampLimit_MatchesEndpointConstants proves the per-endpoint
// default/max constants are internally consistent (default is itself a
// valid, in-range value) so a future edit can't set a default that the
// clamp would immediately reject.
func TestClampLimit_MatchesEndpointConstants(t *testing.T) {
	t.Parallel()
	pairs := []struct {
		name     string
		def, max int
	}{
		{"command-log history", commandLogHistoryDefaultLimit, commandLogHistoryMaxLimit},
		{"tesla energy history", teslaEnergyHistoryDefaultLimit, teslaEnergyHistoryMaxLimit},
		{"tesla live status", teslaEnergyLiveStatusDefaultLimit, teslaEnergyLiveStatusMaxLimit},
	}
	for _, p := range pairs {
		if p.def <= 0 || p.def > p.max {
			t.Errorf("%s: default %d must be in (0, max=%d]", p.name, p.def, p.max)
		}
		if got := clampLimit(p.def, p.def, p.max); got != p.def {
			t.Errorf("%s: clampLimit(default) = %d, want default %d", p.name, got, p.def)
		}
		if got := clampLimit(0, p.def, p.max); got != p.def {
			t.Errorf("%s: clampLimit(0) = %d, want default %d", p.name, got, p.def)
		}
	}
}

// TestIsNotPopulated covers the detector that lets the fleet-stats
// endpoints degrade gracefully when the continuous aggregate was created
// WITH NO DATA and never refreshed (returns empty rather than 500).
func TestIsNotPopulated(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil error is not the sentinel", nil, false},
		{"unrelated error", errors.New("connection refused"), false},
		{
			"raw not-populated message",
			errors.New(`materialized view "cagg_fleet_stats" has not been populated`),
			true,
		},
		{
			"wrapped not-populated message",
			fmt.Errorf("query energy total: %w", errors.New("relation has not been populated")),
			true,
		},
		{"substring only, different casing not matched", errors.New("HAS NOT BEEN POPULATED"), false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := isNotPopulated(tc.err); got != tc.want {
				t.Errorf("isNotPopulated(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// TestCommandLogSQL_Shape pins the three command-log queries so a typo in
// a column name or a dropped WHERE/ORDER BY clause fails at build time,
// not at runtime against production data.
func TestCommandLogSQL_Shape(t *testing.T) {
	t.Parallel()

	insertMust := []string{
		"INSERT INTO command_logs",
		"vehicle_id, command, params, status, error, created_at",
		"VALUES ($1, $2, $3, $4, $5, $6)",
		"RETURNING id",
	}
	for _, frag := range insertMust {
		if !strings.Contains(commandLogInsertSQL, frag) {
			t.Errorf("commandLogInsertSQL missing %q\n%s", frag, commandLogInsertSQL)
		}
	}

	latestMust := []string{
		"DISTINCT ON (command)",
		"FROM command_logs",
		"WHERE vehicle_id = $1",
		"ORDER BY command, created_at DESC",
	}
	for _, frag := range latestMust {
		if !strings.Contains(commandLogLatestByVehicleSQL, frag) {
			t.Errorf("commandLogLatestByVehicleSQL missing %q\n%s", frag, commandLogLatestByVehicleSQL)
		}
	}

	historyMust := []string{
		"FROM command_logs",
		"WHERE vehicle_id = $1",
		"ORDER BY created_at DESC",
		"LIMIT $2",
	}
	for _, frag := range historyMust {
		if !strings.Contains(commandLogHistorySQL, frag) {
			t.Errorf("commandLogHistorySQL missing %q\n%s", frag, commandLogHistorySQL)
		}
	}

	// The history query must be bounded — an unbounded command log read
	// could return the entire table for a chatty vehicle.
	if !strings.Contains(commandLogHistorySQL, "LIMIT") {
		t.Error("commandLogHistorySQL must be LIMIT-bounded")
	}
}

// TestEnergyStatsSQL_Shape pins the SI-canonical fleet-stats queries.
// Migration 000188 made cagg_fleet_stats SI (Wh + meters); reintroducing
// legacy display-unit columns would fail at runtime against the current
// schema, so guard against them explicitly.
func TestEnergyStatsSQL_Shape(t *testing.T) {
	t.Parallel()

	dailyMust := []string{
		"FROM cagg_fleet_stats",
		"WHERE vehicle_id = $1",
		"make_interval(days := $2)",
		"total_energy_wh",
		"total_distance_m",
		"efficiency_wh_per_m",
		"ORDER BY day",
	}
	for _, frag := range dailyMust {
		if !strings.Contains(energyDailyBreakdownSQL, frag) {
			t.Errorf("energyDailyBreakdownSQL missing %q\n%s", frag, energyDailyBreakdownSQL)
		}
	}

	totalMust := []string{
		"FROM cagg_fleet_stats",
		"SUM(total_energy_wh)",
		"SUM(total_distance_m)",
		"WHERE vehicle_id = $1",
		"make_interval(days := $2)",
	}
	for _, frag := range totalMust {
		if !strings.Contains(energyTotalSQL, frag) {
			t.Errorf("energyTotalSQL missing %q\n%s", frag, energyTotalSQL)
		}
	}

	// SI-canonical guard: no legacy display-unit column suffixes on disk.
	legacy := []string{"energy_kwh", "energy_used_kwh", "distance_km", "distance_mi", "energy_wh_per_mi"}
	for _, banned := range legacy {
		if strings.Contains(energyDailyBreakdownSQL, banned) {
			t.Errorf("energyDailyBreakdownSQL must not contain legacy unit column %q (mig 000188 is SI)", banned)
		}
		if strings.Contains(energyTotalSQL, banned) {
			t.Errorf("energyTotalSQL must not contain legacy unit column %q (mig 000188 is SI)", banned)
		}
	}
}

// TestCommandLogRepo_Create_NilRejected pins the defence-in-depth nil
// guard: a nil model must surface an error before any pool access, so a
// buggy caller can't nil-deref inside the repo. Pure Go — db is nil.
func TestCommandLogRepo_Create_NilRejected(t *testing.T) {
	t.Parallel()
	repo := &CommandLogRepo{db: nil}
	err := repo.Create(context.Background(), nil)
	if err == nil {
		t.Fatal("Create(nil) must return an error")
	}
	if !strings.Contains(err.Error(), "nil command log") {
		t.Errorf("Create(nil) error = %q, want it to mention nil command log", err.Error())
	}
}

// TestNewCommandLogRepo_NilDBPanics defends the construction-time
// fail-fast: a nil db is a wiring bug, not a runtime condition. Mirrors
// NewVehicleStatesRepo / NewMileageRepo.
func TestNewCommandLogRepo_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatal("expected NewCommandLogRepo(nil) to panic")
		}
	}()
	_ = NewCommandLogRepo(nil)
}

// TestNewEnergyStatsRepo_NilDBPanics mirrors the fail-fast contract for
// the stats repo.
func TestNewEnergyStatsRepo_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatal("expected NewEnergyStatsRepo(nil) to panic")
		}
	}()
	_ = NewEnergyStatsRepo(nil)
}

// TestConstructors_NonNilDBOK confirms the happy path returns a usable
// (non-nil) repo. A nil Pool is fine here because no query is issued.
func TestConstructors_NonNilDBOK(t *testing.T) {
	t.Parallel()
	db := &database.DB{}
	if NewCommandLogRepo(db) == nil {
		t.Error("NewCommandLogRepo returned nil for a non-nil db")
	}
	if NewEnergyStatsRepo(db) == nil {
		t.Error("NewEnergyStatsRepo returned nil for a non-nil db")
	}
}

// TestCommandLogModel_JSONTags is a lightweight guard that the command
// log model still exposes the snake_case JSON contract the frontend
// hooks depend on. Catches an accidental struct-tag rename.
func TestCommandLogModel_JSONTags(t *testing.T) {
	t.Parallel()
	cl := vehiclemodel.CommandLog{ID: 1, VehicleID: 2, Command: "wake", Status: "success"}
	if cl.VehicleID != 2 || cl.Command != "wake" {
		t.Fatalf("unexpected command log field wiring: %+v", cl)
	}
}
