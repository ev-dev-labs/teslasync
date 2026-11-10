package postgres

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// This opt-in test only receives the URL of a disposable test database from
// the caller. Even there it uses its own schema, never an application's data.
func TestWidgetDesignPostgresIntegration(t *testing.T) {
	url := os.Getenv("WIDGET_DESIGN_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("WIDGET_DESIGN_TEST_DATABASE_URL not set; requires disposable PostgreSQL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "widget_preference_test_" + time.Now().UTC().Format("20060102150405_000000000")
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+identifier+" CASCADE"); err != nil {
			t.Errorf("clean test schema: %v", err)
		}
	}()
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	readMigration := func(direction string) string {
		t.Helper()
		data, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000257_widget_design_preferences."+direction+".sql"))
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	up, down := readMigration("up"), readMigration("down")
	for range 2 {
		if _, err := pool.Exec(ctx, up); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewWidgetDesignRepository(pool)
	id, err := repo.Get(ctx, "subject-a")
	if err != nil || id != nil {
		t.Fatalf("absent preference: %v %v", id, err)
	}
	if err := repo.Put(ctx, "subject-a", "v4"); err != nil {
		t.Fatal(err)
	}
	// A second independent connection pool observes the committed selection.
	otherCfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	otherCfg.ConnConfig.RuntimeParams["search_path"] = schema
	otherPool, err := pgxpool.NewWithConfig(ctx, otherCfg)
	if err != nil {
		t.Fatal(err)
	}
	defer otherPool.Close()
	other := NewWidgetDesignRepository(otherPool)
	if id, err := other.Get(ctx, "subject-a"); err != nil || id == nil || *id != "v4" {
		t.Fatalf("independent pool read: %v %v", id, err)
	}
	for _, scope := range []string{"subject-a", "subject-b", "open"} {
		if err := other.Put(ctx, scope, "memphis"); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var updated time.Time
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM widget_design_preferences").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("upsert created duplicate scopes: %d", count)
	}
	if err := pool.QueryRow(ctx, "SELECT updated_at FROM widget_design_preferences WHERE subject_scope = $1", "subject-a").Scan(&updated); err != nil || updated.IsZero() {
		t.Fatalf("updated_at not persisted: %v %v", updated, err)
	}
	for range 2 {
		if _, err := pool.Exec(ctx, down); err != nil {
			t.Fatal(err)
		}
	}
	// Verify clean reapplication after rollback too.
	if _, err := pool.Exec(ctx, up); err != nil {
		t.Fatal(err)
	}
}
