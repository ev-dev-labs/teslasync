package database

import (
	"context"
	"os"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRepoColumnsMatchSchema connects to a live Postgres instance and verifies
// that every column name referenced in repo SQL strings exists in the actual
// DB schema. Skips if DATABASE_URL is not set (CI without DB).
//
// This test catches the class of bugs where Go code references renamed/deleted
// columns (e.g., "power" vs "power_kw", "end_date" vs "end_ts") that only
// surface at runtime.
func TestRepoColumnsMatchSchema(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://teslasync:teslasync@localhost:5432/teslasync?sslmode=disable"
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("skipping schema test: cannot connect to DB: %v", err)
	}
	defer pool.Close()

	// Verify connectivity before running assertions
	if err := pool.Ping(context.Background()); err != nil {
		t.Skipf("skipping schema test: cannot ping DB: %v", err)
	}

	// Load all columns for all tables from information_schema
	rows, err := pool.Query(context.Background(),
		`SELECT table_name, column_name FROM information_schema.columns
		 WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)
	if err != nil {
		t.Fatalf("query information_schema: %v", err)
	}
	defer rows.Close()

	schema := make(map[string]map[string]bool) // table → set of columns
	for rows.Next() {
		var table, col string
		if err := rows.Scan(&table, &col); err != nil {
			t.Fatalf("scan row: %v", err)
		}
		if schema[table] == nil {
			schema[table] = make(map[string]bool)
		}
		schema[table][col] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterating rows: %v", err)
	}

	if len(schema) == 0 {
		t.Fatal("information_schema returned 0 tables — is the DB migrated?")
	}

	// Define critical table↔column assertions.
	// These are the mappings that caused runtime errors in the db-refactor.
	criticalChecks := []struct {
		table  string
		column string
	}{
		// vehicle_live_state — signal flush targets
		{"vehicle_live_state", "vehicle_id"},
		{"vehicle_live_state", "power_kw"},
		{"vehicle_live_state", "speed_mph"},
		{"vehicle_live_state", "elevation_m"},
		{"vehicle_live_state", "inside_temp_c"},
		{"vehicle_live_state", "outside_temp_c"},
		{"vehicle_live_state", "battery_level"},
		{"vehicle_live_state", "shift_state"},
		{"vehicle_live_state", "locked"},
		{"vehicle_live_state", "sentry_mode"},
		{"vehicle_live_state", "charger_power_kw"},
		{"vehicle_live_state", "battery_range_mi"},
		{"vehicle_live_state", "charging_state"},
		{"vehicle_live_state", "latitude"},
		{"vehicle_live_state", "longitude"},
		{"vehicle_live_state", "heading"},
		{"vehicle_live_state", "hvac_state"},
		{"vehicle_live_state", "is_climate_on"},
		{"vehicle_live_state", "drive_state"},
		{"vehicle_live_state", "user_present"},
		{"vehicle_live_state", "software_version"},

		// drives — field renames from db-refactor
		{"drives", "id"},
		{"drives", "vehicle_id"},
		{"drives", "start_ts"},
		{"drives", "end_ts"},
		{"drives", "duration_min"},
		{"drives", "distance_mi"},
		{"drives", "avg_speed_mph"},
		{"drives", "max_speed_mph"},
		{"drives", "start_battery_pct"},
		{"drives", "end_battery_pct"},
		{"drives", "energy_used_kwh"},
		{"drives", "regen_kwh"},
		{"drives", "avg_power_kw"},
		{"drives", "outside_temp_avg_c"},
		{"drives", "inside_temp_avg_c"},
		{"drives", "score"},

		// charging_sessions
		{"charging_sessions", "id"},
		{"charging_sessions", "vehicle_id"},
		{"charging_sessions", "start_ts"},
		{"charging_sessions", "end_ts"},
		{"charging_sessions", "duration_min"},
		{"charging_sessions", "energy_added_kwh"},
		{"charging_sessions", "start_battery_pct"},
		{"charging_sessions", "end_battery_pct"},
		{"charging_sessions", "charger_power_kw_max"},
		{"charging_sessions", "charger_power_kw_avg"},
		{"charging_sessions", "charger_type"},
		{"charging_sessions", "cost"},

		// positions
		{"positions", "vehicle_id"},
		{"positions", "ts"},
		{"positions", "latitude"},
		{"positions", "longitude"},
		{"positions", "speed_mph"},
		{"positions", "elevation_m"},
		{"positions", "heading"},

		// fsm_transitions
		{"fsm_transitions", "id"},
		{"fsm_transitions", "ts"},
		{"fsm_transitions", "vehicle_id"},
		{"fsm_transitions", "from_state"},
		{"fsm_transitions", "to_state"},
		{"fsm_transitions", "trigger"},

		// security_events
		{"security_events", "vehicle_id"},
		{"security_events", "ts"},
		{"security_events", "event_type"},
		{"security_events", "locked"},
		{"security_events", "sentry_mode"},
		{"security_events", "doors_open"},
		{"security_events", "windows_open"},
		{"security_events", "user_present"},
	}

	// Also assert these columns do NOT exist (commonly confused old names).
	mustNotExist := []struct {
		table  string
		column string
	}{
		// vehicle_live_state — old ambiguous names
		{"vehicle_live_state", "power"},
		{"vehicle_live_state", "speed"},
		{"vehicle_live_state", "elevation"},
		{"vehicle_live_state", "hvac_power"},
		{"vehicle_live_state", "driver_seat_belt"},

		// drives — old date/ambiguous names
		{"drives", "start_date"},
		{"drives", "end_date"},
		{"drives", "distance"},
		{"drives", "speed_max"},

		// fsm_transitions — removed fields
		{"fsm_transitions", "fsm_type"},
		{"fsm_transitions", "fsm_instance_id"},
	}

	for _, check := range criticalChecks {
		cols, ok := schema[check.table]
		if !ok {
			t.Errorf("table %q does not exist in schema", check.table)
			continue
		}
		if !cols[check.column] {
			t.Errorf("column %q does not exist in table %q (available: %v)",
				check.column, check.table, sortedBoolMapKeys(cols))
		}
	}

	for _, check := range mustNotExist {
		if cols, ok := schema[check.table]; ok && cols[check.column] {
			t.Errorf("column %q should NOT exist in table %q (old name — was it renamed?)",
				check.column, check.table)
		}
	}
}

func sortedBoolMapKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
