package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestWidgetDesignRepository(t *testing.T) {
	ctx := context.Background()
	pool := &fakePool{row: fakeRow{err: pgx.ErrNoRows}}
	repo := &widgetDesignRepository{pool: pool}
	id, err := repo.Get(ctx, "scope")
	if id != nil || err != nil {
		t.Fatalf("absent: %v %v", id, err)
	}
	pool.row = fakeRow{vals: []any{"v4", true}}
	id, err = repo.Get(ctx, "scope")
	if err != nil || id == nil || id.PackID != "v4" || !id.AppWide || pool.queryRowArgs[0] != "scope" {
		t.Fatalf("read: %v %v", id, err)
	}
	if !strings.Contains(pool.queryRowSQL, "subject_scope = $1") {
		t.Fatal("read must be scoped and parameterized")
	}
	enabled := true
	saved, err := repo.Put(ctx, "opaque'--scope", "v4", &enabled)
	if err != nil || saved.PackID != "v4" || !saved.AppWide {
		t.Fatal(err)
	}
	if len(pool.queryRowArgs) != 3 || pool.queryRowArgs[0] != "opaque'--scope" ||
		pool.queryRowArgs[1] != "v4" || pool.queryRowArgs[2] != &enabled || strings.Contains(pool.queryRowSQL, "opaque") ||
		!strings.Contains(pool.queryRowSQL, "ON CONFLICT (subject_scope)") ||
		!strings.Contains(pool.queryRowSQL, "COALESCE($3, widget_design_preferences.app_wide)") {
		t.Fatal("upsert must bind values and conflict on the scope")
	}
	want := errors.New("db unavailable")
	pool.row = fakeRow{err: want}
	if _, err := repo.Get(ctx, "scope"); !errors.Is(err, want) {
		t.Fatal("read error lost")
	}
	if _, err := repo.Put(ctx, "scope", "v4", nil); !errors.Is(err, want) {
		t.Fatal("write error lost")
	}
}
