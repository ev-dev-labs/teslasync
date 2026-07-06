package postgres

import (
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
)

// SQL-shape guards. These pin the critical fragments of every query constant so
// a column/table/clause/placeholder typo is caught at test time rather than at
// runtime against a live database (the module's pure-Go SQL-shape precedent —
// see internal/database/achievement/unlock_repo_test.go).

func mustContain(t *testing.T, name, sql string, frags ...string) {
	t.Helper()
	for _, frag := range frags {
		if !strings.Contains(sql, frag) {
			t.Errorf("%s missing %q\nfull SQL:\n%s", name, frag, sql)
		}
	}
}

func mustNotContain(t *testing.T, name, sql string, frags ...string) {
	t.Helper()
	for _, frag := range frags {
		if strings.Contains(sql, frag) {
			t.Errorf("%s must NOT contain %q\nfull SQL:\n%s", name, frag, sql)
		}
	}
}

var placeholderRE = regexp.MustCompile(`\$(\d+)`)

// placeholderSet returns the sorted, de-duplicated set of positional parameter
// numbers referenced in sql (ignoring any ::type cast suffix).
func placeholderSet(sql string) []int {
	seen := map[int]bool{}
	for _, m := range placeholderRE.FindAllStringSubmatch(sql, -1) {
		n := 0
		for _, r := range m[1] {
			n = n*10 + int(r-'0')
		}
		seen[n] = true
	}
	out := make([]int, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Ints(out)
	return out
}

// TestWriteStatementsPlaceholdersAreContiguous is the anti-regression backstop
// for the class of bug fixed in phase-48's trip Save: a write statement executed
// with N positional args must reference exactly $1..$N with no gaps and no
// stragglers. A gap (e.g. UpsertTrip's old $14/$15 while $3..$13 were never
// referenced) makes Postgres reject the statement at parse time, and a straggler
// ($16 with a 15-param statement) fails Bind.
func TestWriteStatementsPlaceholdersAreContiguous(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		sql      string
		argCount int
	}{
		{"UpsertVehicle", queries.UpsertVehicle, 17},
		{"DeleteVehicle", queries.DeleteVehicle, 1},
		{"UpsertChargingSession", queries.UpsertChargingSession, 10},
		{"UpsertTrip", queries.UpsertTrip, 4},
		{"UpsertExportJob", queries.UpsertExportJob, 12},
		{"UpsertNotification", queries.UpsertNotification, 11},
		{"UpsertUser", queries.UpsertUser, 9},
		{"DeleteUser", queries.DeleteUser, 1},
		{"InsertFSMTransition", queries.InsertFSMTransition, 7},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := placeholderSet(c.sql)
			want := make([]int, c.argCount)
			for i := range want {
				want[i] = i + 1
			}
			if len(got) != len(want) {
				t.Fatalf("%s references %v, want exactly $1..$%d", c.name, got, c.argCount)
			}
			for i := range want {
				if got[i] != want[i] {
					t.Fatalf("%s references %v, want contiguous $1..$%d (gap or straggler at index %d)", c.name, got, c.argCount, i)
				}
			}
		})
	}
}

// TestUpsertTrip_BugFixPinned documents the exact fix: the trips table stores
// only its own four columns, ended_at is NULLIF'd against started_at, and none
// of the stale high-numbered placeholders survive.
func TestUpsertTrip_BugFixPinned(t *testing.T) {
	t.Parallel()
	mustContain(t, "UpsertTrip", queries.UpsertTrip,
		"INSERT INTO trips (",
		"id, vehicle_id, started_at, ended_at",
		"VALUES ($1::bigint, $2::bigint, $3, NULLIF($4, $3))",
		"ON CONFLICT (id) DO UPDATE SET",
		"ended_at = EXCLUDED.ended_at",
	)
	mustNotContain(t, "UpsertTrip", queries.UpsertTrip, "$14", "$15", "$16")
}

func TestVehicleQueries_Shape(t *testing.T) {
	t.Parallel()
	mustContain(t, "GetVehicleByID", queries.GetVehicleByID,
		"SELECT id, user_id, vin, display_name, model, year, color", "FROM vehicles", "WHERE id = $1")
	mustContain(t, "GetVehicleByVIN", queries.GetVehicleByVIN, "FROM vehicles", "WHERE vin = $1")
	mustContain(t, "GetVehiclesByUserID", queries.GetVehiclesByUserID, "WHERE user_id = $1", "ORDER BY display_name")
	mustContain(t, "GetVehicleByIDForUpdate", queries.GetVehicleByIDForUpdate, "WHERE id = $1", "FOR UPDATE")
	mustContain(t, "UpsertVehicle", queries.UpsertVehicle, "INSERT INTO vehicles", "ON CONFLICT (id) DO UPDATE SET")
	if queries.DeleteVehicle != "DELETE FROM vehicles WHERE id = $1" {
		t.Errorf("DeleteVehicle = %q, want DELETE FROM vehicles WHERE id = $1", queries.DeleteVehicle)
	}
}

func TestChargingQueries_Shape(t *testing.T) {
	t.Parallel()
	// The projected columns must match the charging.ChargingSession db tags.
	mustContain(t, "GetChargingSessionByID", queries.GetChargingSessionByID,
		"FROM charging_sessions", "WHERE id = $1::bigint",
		"start_battery_pct", "end_battery_pct", "energy_added_wh", "max_power_w", "cost_cents",
		"charger_connected", "completed_at")
	mustContain(t, "GetChargingSessionsByVehicleID", queries.GetChargingSessionsByVehicleID,
		"WHERE vehicle_id = $1::bigint", "ORDER BY started_at DESC")
	mustContain(t, "ListChargingSessionsByDateRange", queries.ListChargingSessionsByDateRange,
		"started_at >= $2 AND started_at <= $3")
	mustContain(t, "GetChargingSessionByIDForUpdate", queries.GetChargingSessionByIDForUpdate, "FOR UPDATE")
	mustContain(t, "UpsertChargingSession", queries.UpsertChargingSession,
		"INSERT INTO charging_sessions", "total_energy_added_wh", "peak_power_w", "cost_decimal",
		"ON CONFLICT (id) DO UPDATE SET")
}

func TestTripQueries_Shape(t *testing.T) {
	t.Parallel()
	mustContain(t, "GetTripByID", queries.GetTripByID,
		"FROM trips", "distance_m", "energy_used_wh", "efficiency_wh_per_m", "max_speed_mps",
		"LEFT JOIN LATERAL", "trip_drives", "WHERE t.id = $1::bigint")
	mustContain(t, "GetTripsByVehicleID", queries.GetTripsByVehicleID,
		"WHERE t.vehicle_id = $1::bigint", "ORDER BY t.started_at DESC")
	mustContain(t, "ListTripsByDateRange", queries.ListTripsByDateRange,
		"t.started_at >= $2 AND t.started_at <= $3")
	mustContain(t, "GetTripByIDForUpdate", queries.GetTripByIDForUpdate, "FOR UPDATE OF t")
}

func TestExportQueries_Shape(t *testing.T) {
	t.Parallel()
	mustContain(t, "GetExportJobByID", queries.GetExportJobByID,
		"FROM export_jobs", "WHERE id = $1", "file_path", "file_size", "failed_reason")
	mustContain(t, "GetExportJobsByUserID", queries.GetExportJobsByUserID, "WHERE user_id = $1", "ORDER BY created_at DESC")
	mustContain(t, "GetExportJobByIDForUpdate", queries.GetExportJobByIDForUpdate, "FOR UPDATE")
	mustContain(t, "UpsertExportJob", queries.UpsertExportJob, "INSERT INTO export_jobs", "ON CONFLICT (id) DO UPDATE SET")
}

func TestNotificationQueries_Shape(t *testing.T) {
	t.Parallel()
	mustContain(t, "GetNotificationByID", queries.GetNotificationByID,
		"FROM notifications", "WHERE id = $1", "retry_count", "failed_reason", "sent_at")
	mustContain(t, "GetNotificationsByUserID", queries.GetNotificationsByUserID, "WHERE user_id = $1", "ORDER BY created_at DESC")
	mustContain(t, "GetPendingNotifications", queries.GetPendingNotifications,
		"WHERE fsm_state = 'pending'", "ORDER BY created_at ASC", "LIMIT $1")
	mustContain(t, "GetNotificationByIDForUpdate", queries.GetNotificationByIDForUpdate, "FOR UPDATE")
	mustContain(t, "UpsertNotification", queries.UpsertNotification, "INSERT INTO notifications", "ON CONFLICT (id) DO UPDATE SET")
}

func TestUserQueries_Shape(t *testing.T) {
	t.Parallel()
	mustContain(t, "GetUserByID", queries.GetUserByID,
		"FROM users", "WHERE id = $1", "tesla_token_encrypted", "tesla_refresh_token_encrypted", "token_expires_at")
	mustContain(t, "GetUserByEmail", queries.GetUserByEmail, "WHERE email = $1")
	mustContain(t, "UpsertUser", queries.UpsertUser, "INSERT INTO users", "ON CONFLICT (id) DO UPDATE SET")
	if queries.DeleteUser != "DELETE FROM users WHERE id = $1" {
		t.Errorf("DeleteUser = %q, want DELETE FROM users WHERE id = $1", queries.DeleteUser)
	}
}

func TestFSMHistoryQueries_Shape(t *testing.T) {
	t.Parallel()
	mustContain(t, "InsertFSMTransition", queries.InsertFSMTransition,
		"INSERT INTO fsm_transitions (id, entity_id, fsm_name, from_state, event, to_state, created_at)",
		"VALUES ($1, $2, $3, $4, $5, $6, $7)")
	mustContain(t, "GetFSMHistory", queries.GetFSMHistory,
		"FROM fsm_transitions", "WHERE entity_id = $1", "ORDER BY created_at DESC", "LIMIT $2")
	mustContain(t, "GetFSMHistoryByEntityID", queries.GetFSMHistoryByEntityID,
		"WHERE entity_id = $1", "ORDER BY created_at ASC")
}
