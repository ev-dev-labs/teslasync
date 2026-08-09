package geofence

import (
	"context"
	"errors"
	"strings"
	"testing"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

func TestArchive(t *testing.T) {
	t.Run("success stamps archived_at", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(1)}}}
		if err := newRepo(pool).Archive(context.Background(), 1); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := pool.execCalls[0]
		for _, sub := range []string{"archived_at = now()", "archived_at IS NULL"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
		// Idempotency check must not fire a second round trip on success.
		if len(pool.queryRowCalls) != 0 {
			t.Errorf("successful archive must not issue a GetByID lookup, got %d", len(pool.queryRowCalls))
		}
	})

	t.Run("already archived is idempotent success", func(t *testing.T) {
		// 0 rows affected (already archived) but the id genuinely exists —
		// GetByID must be consulted and return non-nil, and Archive must
		// still report success (not an error).
		pool := &fakePool{
			execQueue:     []execResult{{tag: tag(0)}},
			queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(&archivedFixture)}},
		}
		if err := newRepo(pool).Archive(context.Background(), 1); err != nil {
			t.Fatalf("want idempotent success, got err: %v", err)
		}
	})

	t.Run("nonexistent id returns ErrGeofenceNotFound", func(t *testing.T) {
		pool := &fakePool{
			execQueue:     []execResult{{tag: tag(0)}},
			queryRowQueue: []pgx.Row{noRow()},
		}
		err := newRepo(pool).Archive(context.Background(), 999)
		if !errors.Is(err, ErrGeofenceNotFound) {
			t.Fatalf("err=%v, want ErrGeofenceNotFound", err)
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{err: errBoom}}}
		err := newRepo(pool).Archive(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})

	t.Run("existence-check error wrapped", func(t *testing.T) {
		pool := &fakePool{
			execQueue:     []execResult{{tag: tag(0)}},
			queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}},
		}
		err := newRepo(pool).Archive(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// Unarchive
// ---------------------------------------------------------------------------

func TestUnarchive(t *testing.T) {
	t.Run("success clears archived_at", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(1)}}}
		if err := newRepo(pool).Unarchive(context.Background(), 1); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := pool.execCalls[0]
		for _, sub := range []string{"archived_at = NULL", "archived_at IS NOT NULL"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
	})

	t.Run("already active is idempotent success", func(t *testing.T) {
		pool := &fakePool{
			execQueue:     []execResult{{tag: tag(0)}},
			queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(&activeFixture)}},
		}
		if err := newRepo(pool).Unarchive(context.Background(), 1); err != nil {
			t.Fatalf("want idempotent success, got err: %v", err)
		}
	})

	t.Run("nonexistent id returns ErrGeofenceNotFound", func(t *testing.T) {
		pool := &fakePool{
			execQueue:     []execResult{{tag: tag(0)}},
			queryRowQueue: []pgx.Row{noRow()},
		}
		err := newRepo(pool).Unarchive(context.Background(), 999)
		if !errors.Is(err, ErrGeofenceNotFound) {
			t.Fatalf("err=%v, want ErrGeofenceNotFound", err)
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{err: errBoom}}}
		err := newRepo(pool).Unarchive(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// HasChargingHistory
// ---------------------------------------------------------------------------

func TestHasChargingHistory(t *testing.T) {
	t.Run("true when referenced", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: []any{true}}}}
		got, err := newRepo(pool).HasChargingHistory(context.Background(), 1)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if !got {
			t.Fatal("want true")
		}
		call := pool.queryRowCalls[0]
		for _, sub := range []string{"charging_sessions WHERE geofence_id", "geofence_rates WHERE geofence_id", "start_geofence_id = $1 OR end_geofence_id = $1"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
	})

	t.Run("false when unreferenced", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: []any{false}}}}
		got, err := newRepo(pool).HasChargingHistory(context.Background(), 1)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if got {
			t.Fatal("want false")
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}}}
		_, err := newRepo(pool).HasChargingHistory(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

var archivedFixture = mustArchivedGeofence()
var activeFixture = mustActiveGeofence()

func mustArchivedGeofence() systemmodel.Geofence {
	g := systemmodel.Geofence{ID: 1, Name: "Retired Place", PolygonWKT: squareWKT(1, 1), CreatedAt: fixedTime, UpdatedAt: fixedTime}
	t := fixedTime
	g.ArchivedAt = &t
	return g
}

func mustActiveGeofence() systemmodel.Geofence {
	return systemmodel.Geofence{ID: 1, Name: "Active Place", PolygonWKT: squareWKT(1, 1), CreatedAt: fixedTime, UpdatedAt: fixedTime}
}
