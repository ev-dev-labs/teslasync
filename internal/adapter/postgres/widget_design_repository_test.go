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
	pool.row = fakeRow{vals: []any{"v4"}}
	id, err = repo.Get(ctx, "scope")
	if err != nil || id == nil || *id != "v4" || pool.queryRowArgs[0] != "scope" {
		t.Fatalf("read: %v %v", id, err)
	}
	if !strings.Contains(pool.queryRowSQL, "subject_scope = $1") {
		t.Fatal("read must be scoped and parameterized")
	}
	if err := repo.Put(ctx, "opaque'--scope", "v4"); err != nil {
		t.Fatal(err)
	}
	if len(pool.execArgs) != 2 || pool.execArgs[0] != "opaque'--scope" ||
		pool.execArgs[1] != "v4" || strings.Contains(pool.execSQL, "opaque") ||
		!strings.Contains(pool.execSQL, "ON CONFLICT (subject_scope)") {
		t.Fatal("upsert must bind values and conflict on the scope")
	}
	want := errors.New("db unavailable")
	pool.row = fakeRow{err: want}
	if _, err := repo.Get(ctx, "scope"); !errors.Is(err, want) {
		t.Fatal("read error lost")
	}
	pool.execErr = want
	if err := repo.Put(ctx, "scope", "v4"); !errors.Is(err, want) {
		t.Fatal("write error lost")
	}
}
