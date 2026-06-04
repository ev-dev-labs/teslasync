// ScheduledExportRepo coverage is split by dependency. SQL-touching tests
// require a live PostgreSQL pool and run against $DATABASE_URL when set,
// skipping cleanly otherwise. Pure-Go validators run without a pool so CI
// environments without DB access still prove the input boundary contracts.
package export

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ----------------------------------------------------------------------------
// Pure-Go validators
// ----------------------------------------------------------------------------

func TestValidateScheduledExportType_Whitelist(t *testing.T) {
	for _, in := range []string{"drives", "Charging", "  TRIPS ", "positions", "signals"} {
		got, err := ValidateScheduledExportType(in)
		if err != nil {
			t.Errorf("type=%q: unexpected error %v", in, err)
		}
		if got != strings.ToLower(strings.TrimSpace(in)) {
			t.Errorf("type=%q: got %q, want canonicalised", in, got)
		}
	}
	for _, bad := range []string{"", "  ", "exports", "drive", "tesla"} {
		if _, err := ValidateScheduledExportType(bad); !errors.Is(err, ErrScheduledExportInvalidType) {
			t.Errorf("type=%q: want ErrScheduledExportInvalidType, got %v", bad, err)
		}
	}
}

func TestValidateScheduledExportFormat_Whitelist(t *testing.T) {
	for _, in := range []string{"csv", "JSON", "  json  "} {
		got, err := ValidateScheduledExportFormat(in)
		if err != nil {
			t.Errorf("format=%q: unexpected error %v", in, err)
		}
		if got != strings.ToLower(strings.TrimSpace(in)) {
			t.Errorf("format=%q: got %q, want canonicalised", in, got)
		}
	}
	for _, bad := range []string{"", "xml", "zip", "yaml"} {
		if _, err := ValidateScheduledExportFormat(bad); !errors.Is(err, ErrScheduledExportInvalidFormat) {
			t.Errorf("format=%q: want ErrScheduledExportInvalidFormat, got %v", bad, err)
		}
	}
}

func TestValidateScheduledExportDelivery_KindWhitelistAndTargets(t *testing.T) {
	cases := []struct {
		name    string
		in      ScheduledExportDelivery
		wantErr bool
	}{
		{"download ok", ScheduledExportDelivery{Kind: DeliveryKindDownload}, false},
		{"download drops target", ScheduledExportDelivery{Kind: DeliveryKindDownload, Target: "ignored"}, false},
		{"email ok", ScheduledExportDelivery{Kind: DeliveryKindEmail, Target: "alice@example.com"}, false},
		{"email no target", ScheduledExportDelivery{Kind: DeliveryKindEmail}, true},
		{"webhook ok", ScheduledExportDelivery{Kind: DeliveryKindWebhook, Target: "https://example.com/hook"}, false},
		{"webhook empty target", ScheduledExportDelivery{Kind: DeliveryKindWebhook, Target: "  "}, true},
		{"unknown kind", ScheduledExportDelivery{Kind: "ftp"}, true},
		{"empty kind", ScheduledExportDelivery{Kind: ""}, true},
		{"case + whitespace tolerated", ScheduledExportDelivery{Kind: " Email ", Target: "bob@example.com"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ValidateScheduledExportDelivery(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.in.Kind == DeliveryKindDownload && got.Target != "" {
				t.Errorf("download must drop target, got %q", got.Target)
			}
			if got.Kind != ScheduledExportDeliveryKind(strings.ToLower(strings.TrimSpace(string(tc.in.Kind)))) {
				t.Errorf("kind not canonicalised: got %q", got.Kind)
			}
		})
	}
}

func TestValidateScheduledExportCron_AcceptsStandardExpressions(t *testing.T) {
	for _, expr := range []string{
		"0 9 * * 0",    // weekly Sunday 09:00
		"*/15 * * * *", // every 15 min
		"0 */6 * * *",  // every 6 hours
		"@daily",       // descriptor
		"0 0 1 * *",    // monthly
	} {
		if _, err := ValidateScheduledExportCron(expr); err != nil {
			t.Errorf("cron=%q: unexpected error %v", expr, err)
		}
	}
}

func TestValidateScheduledExportCron_RejectsBadExpressions(t *testing.T) {
	for _, expr := range []string{"", "   ", "not a cron", "60 0 * * *", "* * *"} {
		if _, err := ValidateScheduledExportCron(expr); !errors.Is(err, ErrScheduledExportInvalidCron) {
			t.Errorf("cron=%q: want ErrScheduledExportInvalidCron, got %v", expr, err)
		}
	}
}

func TestParseRangeWindow_HandlesAllUnits(t *testing.T) {
	cases := map[string]time.Duration{
		"":      7 * 24 * time.Hour, // default
		"7d":    7 * 24 * time.Hour,
		"24h":   24 * time.Hour,
		"30m":   30 * time.Minute,
		"  1d ": 24 * time.Hour,
	}
	for in, want := range cases {
		got, err := ParseRangeWindow(in)
		if err != nil {
			t.Errorf("range=%q: unexpected error %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("range=%q: got %v, want %v", in, got, want)
		}
	}
}

func TestParseRangeWindow_RejectsBadInputs(t *testing.T) {
	for _, bad := range []string{"7", "abc", "0d", "-1h", "7w", "x", "1"} {
		if _, err := ParseRangeWindow(bad); !errors.Is(err, ErrScheduledExportInvalidWindow) {
			t.Errorf("range=%q: want ErrScheduledExportInvalidWindow, got %v", bad, err)
		}
	}
}

func TestCanonicalRangeWindow_Lowercases(t *testing.T) {
	got, err := CanonicalRangeWindow("  24H ")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got != "24h" {
		t.Errorf("got %q, want 24h", got)
	}
}

func TestNormalizeScheduledExportInput_AcceptsValidPayload(t *testing.T) {
	in := ScheduledExportInput{
		Name:         "  Weekly drives ",
		ExportType:   " DRIVES ",
		Format:       "CSV",
		ScheduleCron: " 0 9 * * 0 ",
		Delivery:     ScheduledExportDelivery{Kind: DeliveryKindDownload},
		RangeWindow:  "",
		Enabled:      true,
		Columns:      []string{"id", "  ", "vehicle_id"},
	}
	out, err := NormalizeScheduledExportInput(in)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Name != "Weekly drives" {
		t.Errorf("name not trimmed: %q", out.Name)
	}
	if out.ExportType != "drives" || out.Format != "csv" {
		t.Errorf("type/format not canonicalised: %+v", out)
	}
	if out.RangeWindow != "7d" {
		t.Errorf("default window not applied: %q", out.RangeWindow)
	}
	if len(out.Columns) != 2 || out.Columns[0] != "id" || out.Columns[1] != "vehicle_id" {
		t.Errorf("columns not deblanked: %#v", out.Columns)
	}
}

func TestNormalizeScheduledExportInput_RejectsEmptyName(t *testing.T) {
	_, err := NormalizeScheduledExportInput(ScheduledExportInput{
		Name:         "  ",
		ExportType:   "drives",
		Format:       "csv",
		ScheduleCron: "@daily",
		Delivery:     ScheduledExportDelivery{Kind: DeliveryKindDownload},
	})
	if !errors.Is(err, ErrScheduledExportEmptyName) {
		t.Fatalf("want ErrScheduledExportEmptyName, got %v", err)
	}
}

func TestComputeNextRun_AdvancesPastNow(t *testing.T) {
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	next, err := ComputeNextRun("0 13 * * *", now)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	want := time.Date(2026, 5, 5, 13, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Errorf("got %v, want %v", next, want)
	}
}

func TestScheduledExportRepo_NilPoolGuards(t *testing.T) {
	repo := NewScheduledExportRepo(nil)
	ctx := context.Background()
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)

	if _, err := repo.Create(ctx, "alice", ScheduledExportInput{Name: "x", ExportType: "drives", Format: "csv", ScheduleCron: "@daily", Delivery: ScheduledExportDelivery{Kind: DeliveryKindDownload}}, now); !errors.Is(err, ErrScheduledExportNotConfigured) {
		t.Errorf("Create: want ErrScheduledExportNotConfigured, got %v", err)
	}
	if _, err := repo.Get(ctx, 1); !errors.Is(err, ErrScheduledExportNotConfigured) {
		t.Errorf("Get: want ErrScheduledExportNotConfigured, got %v", err)
	}
	if _, err := repo.ListByOwner(ctx, "alice"); !errors.Is(err, ErrScheduledExportNotConfigured) {
		t.Errorf("ListByOwner: want ErrScheduledExportNotConfigured, got %v", err)
	}
	if err := repo.Delete(ctx, 1, "alice"); !errors.Is(err, ErrScheduledExportNotConfigured) {
		t.Errorf("Delete: want ErrScheduledExportNotConfigured, got %v", err)
	}
	if _, err := repo.DueBefore(ctx, now); !errors.Is(err, ErrScheduledExportNotConfigured) {
		t.Errorf("DueBefore: want ErrScheduledExportNotConfigured, got %v", err)
	}
}

func TestScheduledExportRepo_RejectsEmptyOwner(t *testing.T) {
	repo := NewScheduledExportRepo(&database.DB{})
	ctx := context.Background()
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)

	in := ScheduledExportInput{Name: "x", ExportType: "drives", Format: "csv", ScheduleCron: "@daily", Delivery: ScheduledExportDelivery{Kind: DeliveryKindDownload}}
	if _, err := repo.Create(ctx, "  ", in, now); !errors.Is(err, ErrScheduledExportEmptyOwner) {
		t.Errorf("Create: want ErrScheduledExportEmptyOwner, got %v", err)
	}
	if _, err := repo.ListByOwner(ctx, ""); !errors.Is(err, ErrScheduledExportEmptyOwner) {
		t.Errorf("ListByOwner: want ErrScheduledExportEmptyOwner, got %v", err)
	}
	if err := repo.Delete(ctx, 1, "\t"); !errors.Is(err, ErrScheduledExportEmptyOwner) {
		t.Errorf("Delete: want ErrScheduledExportEmptyOwner, got %v", err)
	}
}

// ----------------------------------------------------------------------------
// Migration smoke — gate's TestMigrations_ScheduledExports_UpDown
// ----------------------------------------------------------------------------

// TestMigrations_ScheduledExports_UpDown brings the live database up to
// the head migration, verifies scheduled_exports + its indexes exist,
// rolls back one step, and confirms the table is gone. Skips when no
// reachable DATABASE_URL is configured (mirrors schema_test.go).
func TestMigrations_ScheduledExports_UpDown(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping live migration smoke")
	}

	migrationsPath, err := resolveMigrationsURL(t)
	if err != nil {
		t.Skipf("cannot resolve migrations directory: %v", err)
	}

	m, err := migrate.New(migrationsPath, dsn)
	if err != nil {
		t.Skipf("cannot construct migrator (DB likely unreachable): %v", err)
	}
	defer func() { _, _ = m.Close() }()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate up: %v", err)
	}

	// Confirm the table + both indexes exist after the head migration.
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open verification pool: %v", err)
	}
	defer pool.Close()

	var hasTable bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_schema = 'public' AND table_name = 'scheduled_exports')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("check scheduled_exports: %v", err)
	}
	if !hasTable {
		t.Fatal("scheduled_exports table missing after migrate up")
	}
	for _, idx := range []string{"idx_scheduled_exports_next_run", "idx_scheduled_exports_owner"} {
		var hasIdx bool
		if err := pool.QueryRow(context.Background(),
			`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1)`,
			idx,
		).Scan(&hasIdx); err != nil {
			t.Fatalf("check index %s: %v", idx, err)
		}
		if !hasIdx {
			t.Fatalf("index %s missing after migrate up", idx)
		}
	}

	// Roll back exactly the scheduled_exports migration and confirm
	// the table is gone. We use Steps(-1) so we leave every other
	// migration in place — this test is colocated with the rest of
	// the suite and a full down-migrate would corrupt sibling tests.
	if err := m.Steps(-1); err != nil {
		t.Fatalf("migrate down -1: %v", err)
	}
	var stillExists bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables
		                WHERE table_schema = 'public' AND table_name = 'scheduled_exports')`,
	).Scan(&stillExists); err != nil {
		t.Fatalf("re-check scheduled_exports: %v", err)
	}
	if stillExists {
		t.Fatal("scheduled_exports table still present after rollback")
	}

	// Bring the schema back up so subsequent tests see the head schema.
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		t.Fatalf("migrate re-up: %v", err)
	}
}

// resolveMigrationsURL finds the migrations/ directory relative to
// the package's GOROOT-anchored test binary location. The migrate
// library expects a `file://` URL with forward slashes, even on
// Windows, so we normalise the separator before formatting.
func resolveMigrationsURL(t *testing.T) (string, error) {
	t.Helper()
	candidates := []string{
		filepath.Join("..", "..", "migrations"),
		filepath.Join("..", "..", "..", "migrations"),
		"migrations",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			return "file://" + filepath.ToSlash(abs), nil
		}
	}
	return "", errors.New("migrations directory not found in expected locations")
}
