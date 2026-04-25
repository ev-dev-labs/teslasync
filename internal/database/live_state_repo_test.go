package database

import (
	"context"
	"os"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// specialHandlerColumns lists columns written by FlushLiveState's special
// handlers (Location unpacking, computed power, enum conversions, charging
// power). These are NOT in SignalToColumn but still target vehicle_live_state.
var specialHandlerColumns = []string{
	"power_kw",        // computed: PackVoltage × PackCurrent / 1000
	"is_climate_on",   // enum: HvacPower → bool
	"charger_power_kw", // DC/AC ChargingPower
}

// TestSignalColumnMapMatchesSchema verifies that every column referenced by the
// SignalToColumn map (and FlushLiveState's special handlers) exists in the
// actual vehicle_live_state table. This test would have caught 700+ runtime
// failures from stale column names like hvac_power, driver_seat_belt, speed,
// and power.
func TestSignalColumnMapMatchesSchema(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://teslasync:teslasync@localhost:5432/teslasync?sslmode=disable"
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("skipping: cannot connect to DB: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		t.Skipf("skipping: cannot ping DB: %v", err)
	}

	// Get actual columns from vehicle_live_state
	rows, err := pool.Query(context.Background(),
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'vehicle_live_state'`)
	if err != nil {
		t.Fatalf("query information_schema: %v", err)
	}
	defer rows.Close()

	validColumns := make(map[string]bool)
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			t.Fatalf("scan column_name: %v", err)
		}
		validColumns[col] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterating rows: %v", err)
	}

	if len(validColumns) == 0 {
		t.Fatal("vehicle_live_state table has 0 columns — table may not exist")
	}

	// 1. Verify every SignalToColumn entry targets a real column.
	for signal, column := range SignalToColumn {
		if !validColumns[column] {
			t.Errorf("SignalToColumn[%q] → %q does NOT exist in vehicle_live_state (valid columns: %v)",
				signal, column, sortedBoolKeys(validColumns))
		}
	}

	// 2. Verify special handler columns also exist.
	for _, column := range specialHandlerColumns {
		if !validColumns[column] {
			t.Errorf("special handler column %q does NOT exist in vehicle_live_state (valid columns: %v)",
				column, sortedBoolKeys(validColumns))
		}
	}

	// 3. Verify varchar/timestamp metadata maps only reference mapped columns.
	allMappedCols := make(map[string]bool)
	for _, col := range SignalToColumn {
		allMappedCols[col] = true
	}
	for _, col := range specialHandlerColumns {
		allMappedCols[col] = true
	}

	for col := range IsVarcharCol {
		if !allMappedCols[col] {
			t.Errorf("IsVarcharCol contains %q which is not in SignalToColumn or specialHandlerColumns", col)
		}
	}
	for col := range IsTimestampCol {
		if !allMappedCols[col] {
			t.Errorf("IsTimestampCol contains %q which is not in SignalToColumn or specialHandlerColumns", col)
		}
	}

	t.Logf("validated %d signal→column mappings + %d special handler columns against %d DB columns",
		len(SignalToColumn), len(specialHandlerColumns), len(validColumns))
}

// sortedBoolKeys returns sorted keys of a map[string]bool.
func sortedBoolKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
