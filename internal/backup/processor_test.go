package backup

import "testing"

func TestSmoke_IsAllowedTable_ValidTables(t *testing.T) {
	for _, table := range backupTables {
		if !IsAllowedTable(table) {
			t.Errorf("IsAllowedTable(%q) = false, want true", table)
		}
	}
}

func TestSmoke_IsAllowedTable_RejectsInvalid(t *testing.T) {
	bad := []string{
		"nonexistent_table",
		"; DROP TABLE vehicles; --",
		"vehicles\" OR 1=1 --",
		"",
		"../../etc/passwd",
		"vehicles; SELECT pg_sleep(5)",
		"VEHICLES", // case-sensitive — must reject
	}
	for _, table := range bad {
		if IsAllowedTable(table) {
			t.Errorf("IsAllowedTable(%q) = true, want false", table)
		}
	}
}

func TestSmoke_IsAllowedTable_BackupTablesNotEmpty(t *testing.T) {
	if len(backupTables) == 0 {
		t.Fatal("backupTables is empty — allowlist would reject everything")
	}
}
