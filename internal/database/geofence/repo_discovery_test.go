package geofence

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Legacy charging-place startup backfill.
// ---------------------------------------------------------------------------

func TestListChargingPlaceBackfillCandidates(t *testing.T) {
	name := "Office Garage"
	startedAt := time.Date(2025, 8, 1, 9, 0, 0, 0, time.UTC)
	pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows([][]any{{
		int64(41), int64(7), startedAt, 37.7749, -122.4194, &name,
	}})}}}

	got, err := newRepo(pool).ListChargingPlaceBackfillCandidates(context.Background(), 30, 25)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d candidates, want 1", len(got))
	}
	if got[0].SessionID != 41 || got[0].VehicleID != 7 ||
		got[0].StartPlace == nil || *got[0].StartPlace != name {
		t.Fatalf("unexpected candidate: %+v", got[0])
	}
	call := pool.queryCalls[0]
	for _, sub := range []string{
		"geofence_id IS NULL",
		"ended_at IS NOT NULL",
		"start_lat IS NOT NULL",
		"start_lng IS NOT NULL",
		"NOT (start_lat = 0 AND start_lng = 0)",
		"ORDER BY id",
	} {
		if !strings.Contains(call.sql, sub) {
			t.Errorf("candidate SQL missing %q:\n%s", sub, call.sql)
		}
	}
	if call.args[0] != int64(30) || call.args[1] != 25 {
		t.Errorf("candidate args = %v, want [30 25]", call.args)
	}
}

func TestListChargingPlaceBackfillCandidates_QueryError(t *testing.T) {
	pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
	_, err := newRepo(pool).ListChargingPlaceBackfillCandidates(context.Background(), 0, 100)
	if !errors.Is(err, errBoom) {
		t.Fatalf("err=%v, want wrapped errBoom", err)
	}
}

func TestApplyCurrentRateEstimate(t *testing.T) {
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)

	t.Run("applies only an active current fallback", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(1)}}}
		applied, err := newRepo(pool).ApplyCurrentRateEstimate(context.Background(), 41, 5, 9, now)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if !applied {
			t.Fatal("want applied=true")
		}
		call := pool.execCalls[0]
		for _, sub := range []string{
			"cost_source   = 'default_estimate'",
			"rate.effective_from <= $4",
			"historical.effective_from <= cs.started_at",
			"cs.cost_source IS NULL AND cs.cost_decimal IS NULL",
			"cs.rate_id IS NULL OR cs.rate_id = rate.id",
		} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("estimate SQL missing %q:\n%s", sub, call.sql)
			}
		}
		if call.args[0] != int64(41) || call.args[1] != int64(5) ||
			call.args[2] != int64(9) || call.args[3] != now {
			t.Errorf("estimate args = %v", call.args)
		}
	})

	t.Run("protected or already covered session is skipped", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(0)}}}
		applied, err := newRepo(pool).ApplyCurrentRateEstimate(context.Background(), 41, 5, 9, now)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if applied {
			t.Fatal("want applied=false")
		}
	})

	t.Run("database error is wrapped", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{err: errBoom}}}
		_, err := newRepo(pool).ApplyCurrentRateEstimate(context.Background(), 41, 5, 9, now)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// validCoordinate — never create a (0,0) or out-of-range/NaN/Inf geofence.
// ---------------------------------------------------------------------------

func TestValidCoordinate(t *testing.T) {
	tests := []struct {
		name     string
		lat, lon float64
		want     bool
	}{
		{name: "typical valid point", lat: 37.7749, lon: -122.4194, want: true},
		{name: "boundary north pole", lat: 90, lon: 0, want: true},
		{name: "boundary south pole", lat: -90, lon: 0, want: true},
		{name: "boundary antimeridian east", lat: 0, lon: 180, want: true},
		{name: "boundary antimeridian west", lat: 0, lon: -180, want: true},
		{name: "null island (0,0) rejected", lat: 0, lon: 0, want: false},
		{name: "lat out of range high", lat: 90.0001, lon: 0, want: false},
		{name: "lat out of range low", lat: -90.0001, lon: 0, want: false},
		{name: "lon out of range high", lat: 0, lon: 180.0001, want: false},
		{name: "lon out of range low", lat: 0, lon: -180.0001, want: false},
		{name: "NaN lat", lat: math.NaN(), lon: 0, want: false},
		{name: "NaN lon", lat: 0, lon: math.NaN(), want: false},
		{name: "Inf lat", lat: math.Inf(1), lon: 0, want: false},
		{name: "Inf lon", lat: 0, lon: math.Inf(-1), want: false},
		{name: "zero lat non-zero lon is valid", lat: 0, lon: 45, want: true},
		{name: "zero lon non-zero lat is valid", lat: 45, lon: 0, want: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := validCoordinate(tc.lat, tc.lon); got != tc.want {
				t.Fatalf("validCoordinate(%v, %v) = %v, want %v", tc.lat, tc.lon, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// FindOrCreateForCharging
// ---------------------------------------------------------------------------

func TestFindOrCreateForCharging_InvalidCoordinatesNeverOpensTransaction(t *testing.T) {
	pool := &fakePool{}
	_, created, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 0, 0, "Somewhere")
	if err == nil {
		t.Fatal("want error for (0,0) coordinates")
	}
	if created {
		t.Fatal("must not report created=true on invalid coordinates")
	}
	if pool.beginCalls != 0 {
		t.Fatalf("invalid coordinates must never open a transaction, got %d Begin calls", pool.beginCalls)
	}
}

func TestFindOrCreateForCharging_MatchesExistingInsideLock(t *testing.T) {
	existing := &systemmodel.Geofence{ID: 7, Name: "Home", PolygonWKT: squareWKT(37.7749, -122.4194), Enabled: true, CreatedAt: fixedTime, UpdatedAt: fixedTime}
	tx := &fakeTx{
		execQueue:  []execResult{{tag: tag(0)}}, // pg_advisory_xact_lock
		queryQueue: []queryResult{{rows: newFakeRows([][]any{geofenceRowVals(existing)})}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}

	g, created, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "New Suggested Name")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if created {
		t.Fatal("want created=false when an existing geofence matches")
	}
	if g == nil || g.ID != 7 {
		t.Fatalf("want the matched geofence (id=7), got %+v", g)
	}
	if tx.commitCalls != 1 {
		t.Fatalf("want 1 commit, got %d", tx.commitCalls)
	}
	// Must never fall through to the INSERT path when a match is found.
	if len(tx.queryRowCalls) != 0 {
		t.Fatalf("must not INSERT when a match exists, got %d QueryRow calls", len(tx.queryRowCalls))
	}
	lockCall := tx.execCalls[0]
	if !strings.Contains(lockCall.sql, "pg_advisory_xact_lock") {
		t.Errorf("first Exec must acquire the advisory lock: %s", lockCall.sql)
	}
}

func TestFindOrCreateForCharging_CreatesProvisionalWhenNoMatch(t *testing.T) {
	tx := &fakeTx{
		execQueue:     []execResult{{tag: tag(0)}},             // advisory lock
		queryQueue:    []queryResult{{rows: newFakeRows(nil)}}, // no match
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(55)}}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}

	g, created, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "Joe's Diner")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !created {
		t.Fatal("want created=true when nothing matches")
	}
	if g == nil || g.ID != 55 {
		t.Fatalf("want new geofence id=55, got %+v", g)
	}
	if g.Name != "Joe's Diner" {
		t.Errorf("name: want suggested name, got %q", g.Name)
	}
	if g.Origin != systemmodel.GeofenceOriginChargingDiscovery {
		t.Errorf("origin: want charging_discovery, got %q", g.Origin)
	}
	if !g.NeedsReview {
		t.Error("want NeedsReview=true for a freshly discovered place")
	}
	if g.Enabled || g.AlertOnEntry || g.AlertOnExit {
		t.Errorf("want safe disabled defaults for a provisional place, got %+v", g)
	}
	insertCall := tx.queryRowCalls[0]
	for _, sub := range []string{"INSERT INTO geofences", "RETURNING id"} {
		if !strings.Contains(insertCall.sql, sub) {
			t.Errorf("insert SQL missing %q:\n%s", sub, insertCall.sql)
		}
	}
	if tx.commitCalls != 1 {
		t.Fatalf("want 1 commit, got %d", tx.commitCalls)
	}
}

func TestFindOrCreateForCharging_EmptySuggestedNameFallsBackToNeutralName(t *testing.T) {
	tx := &fakeTx{
		execQueue:     []execResult{{tag: tag(0)}},
		queryQueue:    []queryResult{{rows: newFakeRows(nil)}},
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(1)}}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}

	g, _, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "   ")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if g.Name == "" || strings.TrimSpace(g.Name) == "" {
		t.Fatalf("want a non-blank neutral fallback name, got %q", g.Name)
	}
}

func TestFindOrCreateForCharging_BeginError(t *testing.T) {
	pool := &fakePool{beginQueue: []beginResult{{err: errBoom}}}
	_, _, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "x")
	if !errors.Is(err, errBoom) {
		t.Fatalf("err=%v, want wrapped errBoom", err)
	}
}

func TestFindOrCreateForCharging_LockError(t *testing.T) {
	tx := &fakeTx{execQueue: []execResult{{err: errBoom}}}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	_, _, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "x")
	if !errors.Is(err, errBoom) {
		t.Fatalf("err=%v, want wrapped errBoom", err)
	}
}

func TestFindOrCreateForCharging_MatchQueryError(t *testing.T) {
	tx := &fakeTx{
		execQueue:  []execResult{{tag: tag(0)}},
		queryQueue: []queryResult{{err: errBoom}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	_, _, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "x")
	if !errors.Is(err, errBoom) {
		t.Fatalf("err=%v, want wrapped errBoom", err)
	}
}

func TestFindOrCreateForCharging_InsertError(t *testing.T) {
	tx := &fakeTx{
		execQueue:     []execResult{{tag: tag(0)}},
		queryQueue:    []queryResult{{rows: newFakeRows(nil)}},
		queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	_, _, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "x")
	if !errors.Is(err, errBoom) {
		t.Fatalf("err=%v, want wrapped errBoom", err)
	}
}

func TestFindOrCreateForCharging_CommitError(t *testing.T) {
	tx := &fakeTx{
		execQueue:     []execResult{{tag: tag(0)}},
		queryQueue:    []queryResult{{rows: newFakeRows(nil)}},
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(1)}}},
		commitErr:     errBoom,
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	_, _, err := newRepo(pool).FindOrCreateForCharging(context.Background(), 37.7749, -122.4194, "x")
	if !errors.Is(err, errBoom) {
		t.Fatalf("err=%v, want wrapped errBoom", err)
	}
}

// TestFindOrCreateForCharging_DiscoveryRadiusMatchesBusinessRule pins the
// documented 75m provisional-circle radius so an accidental future edit is
// caught immediately by a test failure rather than silently shrinking or
// growing every auto-discovered place's coverage.
func TestFindOrCreateForCharging_DiscoveryRadiusMatchesBusinessRule(t *testing.T) {
	if DiscoveryRadiusMeters != 75.0 {
		t.Fatalf("DiscoveryRadiusMeters=%v, want 75.0 per business rule", DiscoveryRadiusMeters)
	}
}

// ---------------------------------------------------------------------------
// ListNeedsReview
// ---------------------------------------------------------------------------

func TestListNeedsReview(t *testing.T) {
	pending := &systemmodel.Geofence{ID: 1, Name: "Unnamed Charging Place", PolygonWKT: squareWKT(1, 1), Origin: systemmodel.GeofenceOriginChargingDiscovery, NeedsReview: true, CreatedAt: fixedTime, UpdatedAt: fixedTime}

	t.Run("returns pending rows", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows([][]any{geofenceRowVals(pending)})}}}
		got, err := newRepo(pool).ListNeedsReview(context.Background())
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 1 || got[0].ID != 1 {
			t.Fatalf("unexpected result: %+v", got)
		}
		call := pool.queryCalls[0]
		for _, sub := range []string{"needs_review = true", "archived_at IS NULL", "ORDER BY created_at ASC"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).ListNeedsReview(context.Background())
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// MarkReviewed
// ---------------------------------------------------------------------------

func TestMarkReviewed(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(1)}}}
		if err := newRepo(pool).MarkReviewed(context.Background(), 1); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := pool.execCalls[0]
		if !strings.Contains(call.sql, "needs_review = false") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
	})

	t.Run("not found", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{tag: tag(0)}}}
		err := newRepo(pool).MarkReviewed(context.Background(), 999)
		if !errors.Is(err, ErrGeofenceNotFound) {
			t.Fatalf("err=%v, want ErrGeofenceNotFound", err)
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		pool := &fakePool{execQueue: []execResult{{err: errBoom}}}
		err := newRepo(pool).MarkReviewed(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}
