package geofence

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
)

var errBoom = errors.New("boom")

// newRepo builds a GeofenceRepo backed by the in-memory fakePool so every
// method is exercised without a live DB.
func newRepo(pool geofencePool) *GeofenceRepo { return &GeofenceRepo{pool: pool} }

// squareWKT renders a small ~±0.001° axis-aligned polygon centred on
// (lat, lon). Centroid() therefore returns (lat, lon) and Radius() a small
// positive number (~140 m), which is exactly what FindByCoordinates needs to
// make its Haversine include/exclude decision.
func squareWKT(lat, lon float64) string {
	return fmt.Sprintf("POLYGON((%f %f, %f %f, %f %f, %f %f, %f %f))",
		lon-0.001, lat-0.001,
		lon+0.001, lat-0.001,
		lon+0.001, lat+0.001,
		lon-0.001, lat+0.001,
		lon-0.001, lat-0.001,
	)
}

func assertGeofenceEqual(t *testing.T, got, want *systemmodel.Geofence) {
	t.Helper()
	if got == nil {
		t.Fatalf("geofence is nil, want %+v", want)
	}
	if got.ID != want.ID || got.Name != want.Name || got.PolygonWKT != want.PolygonWKT ||
		got.Enabled != want.Enabled || got.AlertOnEntry != want.AlertOnEntry ||
		got.AlertOnExit != want.AlertOnExit ||
		!got.CreatedAt.Equal(want.CreatedAt) || !got.UpdatedAt.Equal(want.UpdatedAt) {
		t.Fatalf("geofence mismatch:\n got=%+v\nwant=%+v", got, want)
	}
	if (got.Category == nil) != (want.Category == nil) {
		t.Fatalf("category nil-ness mismatch: got=%v want=%v", got.Category, want.Category)
	}
	if got.Category != nil && *got.Category != *want.Category {
		t.Fatalf("category mismatch: got=%v want=%v", *got.Category, *want.Category)
	}
}

// ---------------------------------------------------------------------------
// NewGeofenceRepo
// ---------------------------------------------------------------------------

func TestNewGeofenceRepo_StoresPool(t *testing.T) {
	db := &database.DB{} // Pool is a nil *pgxpool.Pool; never dereferenced here.
	repo := NewGeofenceRepo(db)
	if repo == nil {
		t.Fatal("NewGeofenceRepo returned nil")
	}
	if repo.pool != db.Pool {
		t.Fatal("NewGeofenceRepo did not store db.Pool in the pool field")
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate(t *testing.T) {
	cat := catPtr(systemmodel.GeofenceCategoryHome)
	tests := []struct {
		name      string
		row       pgx.Row
		input     *systemmodel.Geofence
		wantID    int64
		wantErr   error
		wantErrIs bool
	}{
		{
			name:   "success assigns returned id",
			row:    fakeRow{vals: []any{int64(42)}},
			input:  &systemmodel.Geofence{Name: "Home", PolygonWKT: squareWKT(40, -75), Category: cat, Enabled: true, AlertOnEntry: true},
			wantID: 42,
		},
		{
			name:      "scan error is wrapped",
			row:       fakeRow{scanErr: errBoom},
			input:     &systemmodel.Geofence{Name: "Home"},
			wantErrIs: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pool := &fakePool{queryRowQueue: []pgx.Row{tc.row}}
			repo := newRepo(pool)

			err := repo.Create(context.Background(), tc.input)

			if tc.wantErrIs {
				if !errors.Is(err, errBoom) {
					t.Fatalf("want wrapped errBoom, got %v", err)
				}
				if tc.input.ID != 0 {
					t.Fatalf("id should stay 0 on error, got %d", tc.input.ID)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if tc.input.ID != tc.wantID {
				t.Fatalf("id: want %d got %d", tc.wantID, tc.input.ID)
			}
			if len(pool.queryRowCalls) != 1 {
				t.Fatalf("want 1 QueryRow call, got %d", len(pool.queryRowCalls))
			}
			got := pool.queryRowCalls[0]
			for _, sub := range []string{"INSERT INTO geofences", "RETURNING id", "$7, $7"} {
				if !strings.Contains(got.sql, sub) {
					t.Errorf("SQL missing %q:\n%s", sub, got.sql)
				}
			}
			if len(got.args) != 7 {
				t.Fatalf("want 7 args, got %d (%v)", len(got.args), got.args)
			}
			if got.args[0] != tc.input.Name {
				t.Errorf("args[0] name: want %q got %v", tc.input.Name, got.args[0])
			}
			if gotCat, ok := got.args[2].(*systemmodel.GeofenceCategory); !ok || gotCat == nil || *gotCat != *cat {
				t.Errorf("args[2] category: want %v got %v", *cat, got.args[2])
			}
			if got.args[3] != true {
				t.Errorf("args[3] enabled: want true got %v", got.args[3])
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetAll
// ---------------------------------------------------------------------------

func TestGetAll(t *testing.T) {
	g1 := &systemmodel.Geofence{ID: 1, Name: "Alpha", PolygonWKT: squareWKT(40, -75), Category: catPtr(systemmodel.GeofenceCategoryHome), Enabled: true, CreatedAt: fixedTime, UpdatedAt: fixedTime}
	g2 := &systemmodel.Geofence{ID: 2, Name: "Bravo", PolygonWKT: squareWKT(41, -76), Enabled: false, CreatedAt: fixedTime, UpdatedAt: fixedTime}

	t.Run("returns rows in order", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows([][]any{geofenceRowVals(g1), geofenceRowVals(g2)})}}}
		got, err := newRepo(pool).GetAll(context.Background())
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("want 2 rows, got %d", len(got))
		}
		assertGeofenceEqual(t, got[0], g1)
		assertGeofenceEqual(t, got[1], g2)
		if sql := pool.queryCalls[0].sql; !strings.Contains(sql, "FROM geofences") || !strings.Contains(sql, "ORDER BY name LIMIT 500") {
			t.Errorf("unexpected SQL: %s", sql)
		}
		if len(pool.queryCalls[0].args) != 0 {
			t.Errorf("GetAll should take no args, got %v", pool.queryCalls[0].args)
		}
	})

	t.Run("empty result is nil slice", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		got, err := newRepo(pool).GetAll(context.Background())
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("want empty, got %d", len(got))
		}
	})

	t.Run("query error is wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).GetAll(context.Background())
		if !errors.Is(err, errBoom) {
			t.Fatalf("want wrapped errBoom, got %v", err)
		}
	})

	t.Run("scan error is wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRowVals(g1)})
		rows.scanErrAt = 0
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).GetAll(context.Background())
		if err == nil || !strings.Contains(err.Error(), "get_all scan") {
			t.Fatalf("want get_all scan error, got %v", err)
		}
	})

	t.Run("iteration error is wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRowVals(g1)})
		rows.iterErr = errBoom
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).GetAll(context.Background())
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "iter") {
			t.Fatalf("want wrapped iter error, got %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// GetByID
// ---------------------------------------------------------------------------

func TestGetByID(t *testing.T) {
	want := &systemmodel.Geofence{ID: 7, Name: "Depot", PolygonWKT: squareWKT(40, -75), Category: catPtr(systemmodel.GeofenceCategoryWork), Enabled: true, AlertOnExit: true, CreatedAt: fixedTime, UpdatedAt: fixedTime}

	t.Run("found returns row", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(want)}}}
		got, err := newRepo(pool).GetByID(context.Background(), 7)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		assertGeofenceEqual(t, got, want)
		call := pool.queryRowCalls[0]
		if !strings.Contains(call.sql, "WHERE id=$1") {
			t.Errorf("SQL missing WHERE id=$1: %s", call.sql)
		}
		if len(call.args) != 1 || call.args[0] != int64(7) {
			t.Errorf("args: want [7], got %v", call.args)
		}
	})

	t.Run("no rows returns nil,nil", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{noRow()}}
		got, err := newRepo(pool).GetByID(context.Background(), 99)
		if err != nil {
			t.Fatalf("want nil err, got %v", err)
		}
		if got != nil {
			t.Fatalf("want nil geofence, got %+v", got)
		}
	})

	t.Run("real scan error is wrapped and returns nil", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}}}
		got, err := newRepo(pool).GetByID(context.Background(), 7)
		if !errors.Is(err, errBoom) {
			t.Fatalf("want wrapped errBoom, got %v", err)
		}
		if got != nil {
			t.Fatalf("want nil geofence on error, got %+v", got)
		}
	})
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func TestUpdate(t *testing.T) {
	cat := catPtr(systemmodel.GeofenceCategoryRestricted)
	g := &systemmodel.Geofence{ID: 5, Name: "Zone", PolygonWKT: squareWKT(40, -75), Category: cat, Enabled: false, AlertOnEntry: true, AlertOnExit: true}

	t.Run("success issues UPDATE with id first", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(1)}}}
		if err := newRepo(pool).Update(context.Background(), g); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(pool.execCalls) != 1 {
			t.Fatalf("want 1 Exec, got %d", len(pool.execCalls))
		}
		call := pool.execCalls[0]
		for _, sub := range []string{"UPDATE geofences", "WHERE id=$1", "updated_at=$8"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
		if len(call.args) != 8 {
			t.Fatalf("want 8 args, got %d (%v)", len(call.args), call.args)
		}
		if call.args[0] != int64(5) {
			t.Errorf("args[0] id: want 5 got %v", call.args[0])
		}
		if call.args[1] != "Zone" {
			t.Errorf("args[1] name: want Zone got %v", call.args[1])
		}
	})

	t.Run("exec error is wrapped", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{err: errBoom}}}
		err := newRepo(pool).Update(context.Background(), g)
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "geofences update") {
			t.Fatalf("want wrapped update error, got %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete(t *testing.T) {
	t.Run("success issues parameterised DELETE", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(1)}}}
		if err := newRepo(pool).Delete(context.Background(), 11); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := pool.execCalls[0]
		if call.sql != "DELETE FROM geofences WHERE id=$1" {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if len(call.args) != 1 || call.args[0] != int64(11) {
			t.Errorf("args: want [11], got %v", call.args)
		}
	})

	t.Run("exec error is wrapped", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{err: errBoom}}}
		err := newRepo(pool).Delete(context.Background(), 11)
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "geofences delete 11") {
			t.Fatalf("want wrapped delete error, got %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// FindByCoordinates
// ---------------------------------------------------------------------------

func TestFindByCoordinates_FiltersByRadiusNotEnabled(t *testing.T) {
	// A: enabled fence at the query point -> included.
	// B: enabled fence ~140 km away        -> excluded (outside radius).
	// C: DISABLED fence at the query point  -> still included (no enabled filter).
	// D: empty polygon (radius 0)           -> excluded (radius>0 guard).
	inRange := &systemmodel.Geofence{ID: 1, Name: "A", PolygonWKT: squareWKT(40, -75), Enabled: true, CreatedAt: fixedTime, UpdatedAt: fixedTime}
	farAway := &systemmodel.Geofence{ID: 2, Name: "B", PolygonWKT: squareWKT(41, -76), Enabled: true, CreatedAt: fixedTime, UpdatedAt: fixedTime}
	disabled := &systemmodel.Geofence{ID: 3, Name: "C", PolygonWKT: squareWKT(40, -75), Enabled: false, CreatedAt: fixedTime, UpdatedAt: fixedTime}
	empty := &systemmodel.Geofence{ID: 4, Name: "D", PolygonWKT: "", Enabled: true, CreatedAt: fixedTime, UpdatedAt: fixedTime}

	rows := newFakeRows([][]any{
		geofenceRowVals(inRange), geofenceRowVals(farAway),
		geofenceRowVals(disabled), geofenceRowVals(empty),
	})
	pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}

	got, err := newRepo(pool).FindByCoordinates(context.Background(), 40, -75)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	var ids []int64
	for _, g := range got {
		ids = append(ids, g.ID)
	}
	if len(ids) != 2 || ids[0] != 1 || ids[1] != 3 {
		t.Fatalf("want ids [1 3] (in-range + disabled-in-range), got %v", ids)
	}
	// Explicitly assert the disabled fence survived the filter.
	if got[1].Enabled {
		t.Fatalf("expected the second hit to be the DISABLED fence")
	}
	// FindByCoordinates loads every row: no WHERE clause, no bound args.
	call := pool.queryCalls[0]
	if strings.Contains(call.sql, "WHERE") || len(call.args) != 0 {
		t.Errorf("expected argument-free full scan, got sql=%q args=%v", call.sql, call.args)
	}
}

func TestFindByCoordinates_Errors(t *testing.T) {
	g := &systemmodel.Geofence{ID: 1, Name: "A", PolygonWKT: squareWKT(40, -75), CreatedAt: fixedTime, UpdatedAt: fixedTime}

	t.Run("query error", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).FindByCoordinates(context.Background(), 40, -75)
		if !errors.Is(err, errBoom) {
			t.Fatalf("want wrapped errBoom, got %v", err)
		}
	})

	t.Run("scan error", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRowVals(g)})
		rows.scanErrAt = 0
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).FindByCoordinates(context.Background(), 40, -75)
		if err == nil || !strings.Contains(err.Error(), "find_by_coordinates scan") {
			t.Fatalf("want scan error, got %v", err)
		}
	})

	t.Run("iteration error", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRowVals(g)})
		rows.iterErr = errBoom
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).FindByCoordinates(context.Background(), 40, -75)
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "iter") {
			t.Fatalf("want wrapped iter error, got %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// haversineMeters
// ---------------------------------------------------------------------------

func TestHaversineMeters(t *testing.T) {
	const degMeters = 111194.926 // one degree of arc on a 6371 km sphere

	tests := []struct {
		name                   string
		lat1, lon1, lat2, lon2 float64
		want                   float64
		tol                    float64
	}{
		{name: "identical points", lat1: 40, lon1: -75, lat2: 40, lon2: -75, want: 0, tol: 1e-6},
		{name: "one degree latitude", lat1: 0, lon1: 0, lat2: 1, lon2: 0, want: degMeters, tol: 1.0},
		{name: "one degree longitude at equator", lat1: 0, lon1: 0, lat2: 0, lon2: 1, want: degMeters, tol: 1.0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := haversineMeters(tc.lat1, tc.lon1, tc.lat2, tc.lon2)
			if math.Abs(got-tc.want) > tc.tol {
				t.Fatalf("haversineMeters=%f, want %f (±%f)", got, tc.want, tc.tol)
			}
		})
	}
}

func TestHaversineMeters_Symmetric(t *testing.T) {
	a := haversineMeters(40.0, -75.0, 34.05, -118.24)
	b := haversineMeters(34.05, -118.24, 40.0, -75.0)
	if math.Abs(a-b) > 1e-6 {
		t.Fatalf("haversine not symmetric: %f vs %f", a, b)
	}
	if a <= 0 {
		t.Fatalf("expected positive distance for distinct points, got %f", a)
	}
}
