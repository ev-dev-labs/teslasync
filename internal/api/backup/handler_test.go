package backup_test

import (
	"testing"

	apibackup "github.com/ev-dev-labs/teslasync/internal/api/backup"
)

// TestAllowedTables_RequiredAndForbiddenEntries was relocated from
// internal/api/handlers_test.go::TestAllowedBackupTables in Phase R2a
// (2026-05-28) alongside the canonical apibackup.AllowedTables symbol.
//
// The test pins the whitelist on two axes:
//
//  1. Required-present: a representative spread of expected production
//     tables MUST be in the map. Catches an accidental delete.
//  2. Required-absent: a list of explicitly dangerous tables (pg_*
//     system catalogs, auth credential stores) MUST NOT be in the map.
//     Catches an accidental add that would expose secrets through the
//     admin /system/backup export endpoint.
func TestAllowedTables_RequiredAndForbiddenEntries(t *testing.T) {
	t.Parallel()

	expected := []string{"vehicles", "drives", "charging_sessions", "positions", "alerts"}
	for _, table := range expected {
		if !apibackup.AllowedTables[table] {
			t.Errorf("table %q should be in apibackup.AllowedTables", table)
		}
	}

	rejected := []string{"pg_shadow", "pg_authid", "tokens", "api_keys"}
	for _, table := range rejected {
		if apibackup.AllowedTables[table] {
			t.Errorf("table %q should NOT be in apibackup.AllowedTables", table)
		}
	}
}
