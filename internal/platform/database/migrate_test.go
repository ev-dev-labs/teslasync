package database

import (
	"strings"
	"testing"
)

// validConnStr is a parseable postgres connection string. In every migrate test
// below the migration source is deliberately invalid, so migrate.New fails at
// the source stage (before the database driver is opened) and this connection
// string is never actually dialed.
const validConnStr = "postgres://u:p@127.0.0.1:59999/db?sslmode=disable"

// TestRunMigrations_ErrorPaths covers the migrate-instance construction failure
// branch of RunMigrations. Each case supplies an invalid source URL so the
// error is raised deterministically without contacting a database.
func TestRunMigrations_ErrorPaths(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		migrationsPath string
		wantErr        string
	}{
		{
			name:           "empty source url",
			migrationsPath: "",
			wantErr:        "creating migrate instance",
		},
		{
			name:           "unknown source driver",
			migrationsPath: "nosuchscheme://definitely-not-a-driver",
			wantErr:        "creating migrate instance",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := RunMigrations(validConnStr, tt.migrationsPath)
			if err == nil {
				t.Fatalf("RunMigrations() error = nil, want error containing %q", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("RunMigrations() error = %q, want substring %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestMigrate_ErrorPath verifies the DB.Migrate method reads the pool's
// connection string and delegates to RunMigrations, surfacing the wrapped
// error. An empty migrations path fails migrate.New at the source stage, so the
// lazy pool is never dialed.
func TestMigrate_ErrorPath(t *testing.T) {
	db := &DB{Pool: newLazyPool(t)}

	err := db.Migrate("")
	if err == nil {
		t.Fatal("Migrate() error = nil, want a migrate-instance error")
	}
	if !strings.Contains(err.Error(), "creating migrate instance") {
		t.Errorf("Migrate() error = %q, want substring %q", err.Error(), "creating migrate instance")
	}
}
