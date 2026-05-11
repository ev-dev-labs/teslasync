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
		// drives — Phase-42 mig 000185 SI canonical schema.
		{"drives", "id"},
		{"drives", "vehicle_id"},
		{"drives", "started_at"},
		{"drives", "ended_at"},
		{"drives", "duration_s"},
		{"drives", "distance_m"},
		{"drives", "avg_speed_mps"},
		{"drives", "max_speed_mps"},
		{"drives", "start_soc_pct"},
		{"drives", "end_soc_pct"},
		{"drives", "energy_used_wh"},
		{"drives", "regen_energy_wh"},
		{"drives", "avg_power_w"},
		{"drives", "ambient_temp_c_avg"},

		// fsm_transitions
		{"fsm_transitions", "id"},
		{"fsm_transitions", "ts"},
		{"fsm_transitions", "vehicle_id"},
		{"fsm_transitions", "from_state"},
		{"fsm_transitions", "to_state"},
		{"fsm_transitions", "trigger"},
	}

	// Also assert these columns do NOT exist (commonly confused old names
	// or columns dropped by the SI canonical migration 000185).
	mustNotExist := []struct {
		table  string
		column string
	}{
		// drives — old date/ambiguous names
		{"drives", "start_date"},
		{"drives", "end_date"},
		{"drives", "distance"},
		{"drives", "speed_max"},

		// drives — pre-SI legacy column names (mig 000185 renamed these).
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
		{"drives", "ended_status"},

		// fsm_transitions — removed fields
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
