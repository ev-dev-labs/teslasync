package trip

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// The production bug these tests cover: the Trips page listed every recent
// month as "(In Progress)" — May, Jun, Jul and Aug 2026 all at once — when only
// the current month can be in progress. Their durations were frozen too (Jul
// 2026 read "74h 44m" for a whole month) because ended_at kept whatever "now"
// was the last time the generator touched the row.
//
// Cause: GenerateMonthlyTrips only ever inserted months that had NO trip yet.
// A month first written while it was the current month therefore kept its
// in-progress name and its provisional ended_at forever — the month rolled
// over and nothing ever went back to close it.

func monthlyDSNOrSkip(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL/TESLASYNC_TEST_DSN not set; skipping monthly trip tests")
	}
	return dsn
}

// newMonthlyFixture returns a repo plus an isolated vehicle. Every trip the
// generator creates for that vehicle is removed on cleanup.
func newMonthlyFixture(t *testing.T) (*TripRepo, *database.DB, int64) {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), monthlyDSNOrSkip(t))
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot reach database: %v", err)
	}

	db := &database.DB{Pool: pool}

	unique := time.Now().UnixNano()
	var vehicleID int64
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO vehicles (tesla_id, vin, display_name) VALUES ($1, $2, $3) RETURNING id`,
		unique, fmt.Sprintf("TESTTRIP%09d", unique%1e9), "monthly trip fixture",
	).Scan(&vehicleID); err != nil {
		t.Fatalf("seed vehicle: %v", err)
	}

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM trip_drives WHERE trip_id IN (SELECT id FROM trips WHERE vehicle_id = $1)`, vehicleID)
		_, _ = pool.Exec(bg, `DELETE FROM trips WHERE vehicle_id = $1`, vehicleID)
		_, _ = pool.Exec(bg, `DELETE FROM drives WHERE vehicle_id = $1`, vehicleID)
		_, _ = pool.Exec(bg, `DELETE FROM vehicles WHERE id = $1`, vehicleID)
	})

	return NewTripRepo(db), db, vehicleID
}

func monthStartUTC(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func seedDrive(t *testing.T, db *database.DB, vehicleID int64, at time.Time) {
	t.Helper()
	if _, err := db.Pool.Exec(context.Background(),
		`INSERT INTO drives (vehicle_id, started_at, ended_at, distance_m)
		 VALUES ($1, $2, $3, 40000)`,
		vehicleID, at, at.Add(time.Hour)); err != nil {
		t.Fatalf("seed drive at %s: %v", at, err)
	}
}

type tripRow struct {
	name    string
	endedAt *time.Time
}

func readTrip(t *testing.T, db *database.DB, vehicleID int64, monthStart time.Time) tripRow {
	t.Helper()
	var r tripRow
	err := db.Pool.QueryRow(context.Background(),
		`SELECT name, ended_at FROM trips WHERE vehicle_id = $1 AND started_at = $2`,
		vehicleID, monthStart).Scan(&r.name, &r.endedAt)
	if err != nil {
		t.Fatalf("read trip for %s: %v", monthStart.Format("Jan 2006"), err)
	}
	return r
}

// TestGenerateMonthlyTrips_FinalizesPastInProgressMonth is the regression test
// for the reported bug. A month written while it was current must be closed out
// once it is over, rather than staying "(In Progress)" indefinitely.
func TestGenerateMonthlyTrips_FinalizesPastInProgressMonth(t *testing.T) {
	repo, db, vehicleID := newMonthlyFixture(t)
	ctx := context.Background()

	now := time.Now().UTC()
	thisMonth := monthStartUTC(now)
	lastMonth := thisMonth.AddDate(0, -1, 0)

	seedDrive(t, db, vehicleID, lastMonth.Add(72*time.Hour))
	seedDrive(t, db, vehicleID, thisMonth.Add(2*time.Hour))

	// Reproduce the state the generator leaves behind when it runs during a
	// month: an in-progress row whose ended_at is a provisional "now".
	if _, err := repo.UpsertMonthTrip(ctx, vehicleID, lastMonth, true); err != nil {
		t.Fatalf("seed in-progress month: %v", err)
	}

	// The month is over. A later run must close it.
	if _, err := repo.GenerateMonthlyTrips(ctx); err != nil {
		t.Fatalf("GenerateMonthlyTrips: %v", err)
	}

	got := readTrip(t, db, vehicleID, lastMonth)
	wantName := lastMonth.Format("Jan 2006") + " Summary"
	if got.name != wantName {
		t.Errorf("past month name = %q, want %q — a finished month must not read as in progress", got.name, wantName)
	}
	if got.endedAt == nil {
		t.Fatal("past month ended_at is NULL")
	}
	wantEnd := lastMonth.AddDate(0, 1, 0)
	if !got.endedAt.UTC().Equal(wantEnd) {
		t.Errorf("past month ended_at = %s, want the month boundary %s — a provisional end freezes the duration",
			got.endedAt.UTC().Format(time.RFC3339), wantEnd.Format(time.RFC3339))
	}
}

// TestGenerateMonthlyTrips_CurrentMonthStaysInProgress guards the other
// direction: finalizing past months must not close the month still running.
func TestGenerateMonthlyTrips_CurrentMonthStaysInProgress(t *testing.T) {
	repo, db, vehicleID := newMonthlyFixture(t)
	ctx := context.Background()

	now := time.Now().UTC()
	thisMonth := monthStartUTC(now)
	seedDrive(t, db, vehicleID, thisMonth.Add(3*time.Hour))

	if _, err := repo.GenerateMonthlyTrips(ctx); err != nil {
		t.Fatalf("GenerateMonthlyTrips: %v", err)
	}

	got := readTrip(t, db, vehicleID, thisMonth)
	wantName := thisMonth.Format("Jan 2006") + " (In Progress)"
	if got.name != wantName {
		t.Errorf("current month name = %q, want %q", got.name, wantName)
	}
	if got.endedAt == nil {
		t.Fatal("current month ended_at is NULL")
	}
	// The running month tracks "now", so it must stop short of the boundary.
	if !got.endedAt.UTC().Before(thisMonth.AddDate(0, 1, 0)) {
		t.Errorf("current month ended_at = %s, want a provisional end before the month boundary",
			got.endedAt.UTC().Format(time.RFC3339))
	}
}

// TestGenerateMonthlyTrips_FinalizeIsIdempotent proves a second run is a no-op
// for an already-closed month: the generator runs on a schedule, so a
// finalization that kept rewriting rows would churn trip_drives forever.
func TestGenerateMonthlyTrips_FinalizeIsIdempotent(t *testing.T) {
	repo, db, vehicleID := newMonthlyFixture(t)
	ctx := context.Background()

	now := time.Now().UTC()
	thisMonth := monthStartUTC(now)
	lastMonth := thisMonth.AddDate(0, -1, 0)
	seedDrive(t, db, vehicleID, lastMonth.Add(48*time.Hour))

	if _, err := repo.UpsertMonthTrip(ctx, vehicleID, lastMonth, true); err != nil {
		t.Fatalf("seed in-progress month: %v", err)
	}
	if _, err := repo.GenerateMonthlyTrips(ctx); err != nil {
		t.Fatalf("first run: %v", err)
	}
	first := readTrip(t, db, vehicleID, lastMonth)

	if _, err := repo.GenerateMonthlyTrips(ctx); err != nil {
		t.Fatalf("second run: %v", err)
	}
	second := readTrip(t, db, vehicleID, lastMonth)

	if first.name != second.name || !first.endedAt.Equal(*second.endedAt) {
		t.Errorf("second run changed the row: %+v → %+v", first, second)
	}

	// Exactly one trip per month, and its drives are linked once.
	var trips, links int
	if err := db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM trips WHERE vehicle_id = $1 AND started_at = $2`,
		vehicleID, lastMonth).Scan(&trips); err != nil {
		t.Fatalf("count trips: %v", err)
	}
	if trips != 1 {
		t.Errorf("trips for the month = %d, want 1", trips)
	}
	if err := db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM trip_drives td
		 JOIN trips t ON t.id = td.trip_id
		 WHERE t.vehicle_id = $1 AND t.started_at = $2`,
		vehicleID, lastMonth).Scan(&links); err != nil {
		t.Fatalf("count links: %v", err)
	}
	if links != 1 {
		t.Errorf("trip_drives rows = %d, want 1", links)
	}
}

// TestGenerateMonthlyTrips_MarksRowsAutoGenerated pins that generated summaries
// identify themselves. The finalize pass only rewrites rows the generator owns,
// so anything created by a user is never clobbered.
func TestGenerateMonthlyTrips_MarksRowsAutoGenerated(t *testing.T) {
	repo, db, vehicleID := newMonthlyFixture(t)
	ctx := context.Background()

	thisMonth := monthStartUTC(time.Now().UTC())
	seedDrive(t, db, vehicleID, thisMonth.Add(4*time.Hour))

	if _, err := repo.GenerateMonthlyTrips(ctx); err != nil {
		t.Fatalf("GenerateMonthlyTrips: %v", err)
	}

	var autoGenerated *bool
	if err := db.Pool.QueryRow(ctx,
		`SELECT auto_generated FROM trips WHERE vehicle_id = $1 AND started_at = $2`,
		vehicleID, thisMonth).Scan(&autoGenerated); err != nil {
		t.Fatalf("read auto_generated: %v", err)
	}
	if autoGenerated == nil || !*autoGenerated {
		t.Errorf("auto_generated = %v, want true for a generated monthly summary", autoGenerated)
	}
}

// TestGenerateMonthlyTrips_RepairsAccumulatedInProgressMonths reproduces the
// reported screenshot: four consecutive months every one of which read
// "(In Progress)". Only the running month may keep that name, and one pass
// must repair the whole backlog rather than the most recent month alone.
func TestGenerateMonthlyTrips_RepairsAccumulatedInProgressMonths(t *testing.T) {
	repo, db, vehicleID := newMonthlyFixture(t)
	ctx := context.Background()

	thisMonth := monthStartUTC(time.Now().UTC())
	months := []time.Time{
		thisMonth.AddDate(0, -3, 0),
		thisMonth.AddDate(0, -2, 0),
		thisMonth.AddDate(0, -1, 0),
		thisMonth,
	}

	// Every month was written while it was the current month and never closed.
	for _, m := range months {
		seedDrive(t, db, vehicleID, m.Add(26*time.Hour))
		if _, err := repo.UpsertMonthTrip(ctx, vehicleID, m, true); err != nil {
			t.Fatalf("seed in-progress %s: %v", m.Format("Jan 2006"), err)
		}
	}

	if _, err := repo.GenerateMonthlyTrips(ctx); err != nil {
		t.Fatalf("GenerateMonthlyTrips: %v", err)
	}

	for _, m := range months[:3] {
		got := readTrip(t, db, vehicleID, m)
		want := m.Format("Jan 2006") + " Summary"
		if got.name != want {
			t.Errorf("%s name = %q, want %q", m.Format("Jan 2006"), got.name, want)
		}
		if got.endedAt == nil || !got.endedAt.UTC().Equal(m.AddDate(0, 1, 0)) {
			t.Errorf("%s ended_at = %v, want %s", m.Format("Jan 2006"), got.endedAt,
				m.AddDate(0, 1, 0).Format(time.RFC3339))
		}
	}

	current := readTrip(t, db, vehicleID, thisMonth)
	if want := thisMonth.Format("Jan 2006") + " (In Progress)"; current.name != want {
		t.Errorf("current month name = %q, want %q", current.name, want)
	}

	// Exactly one month may be in progress at any time.
	var inProgress int
	if err := db.Pool.QueryRow(ctx,
		`SELECT count(*) FROM trips WHERE vehicle_id = $1 AND name LIKE '% (In Progress)'`,
		vehicleID).Scan(&inProgress); err != nil {
		t.Fatalf("count in-progress: %v", err)
	}
	if inProgress != 1 {
		t.Errorf("in-progress trips = %d, want exactly 1 (the running month)", inProgress)
	}
}

// user-owned trip that happens to start on a month boundary must never be
// renamed or re-dated by the finalize pass.
func TestGenerateMonthlyTrips_LeavesUserTripsAlone(t *testing.T) {
	repo, db, vehicleID := newMonthlyFixture(t)
	ctx := context.Background()

	thisMonth := monthStartUTC(time.Now().UTC())
	lastMonth := thisMonth.AddDate(0, -1, 0)
	seedDrive(t, db, vehicleID, lastMonth.Add(24*time.Hour))

	userEnd := lastMonth.Add(96 * time.Hour)
	if _, err := db.Pool.Exec(ctx,
		`INSERT INTO trips (vehicle_id, name, started_at, ended_at, auto_generated)
		 VALUES ($1, $2, $3, $4, false)`,
		vehicleID, "Road trip to Tahoe", lastMonth, userEnd); err != nil {
		t.Fatalf("seed user trip: %v", err)
	}

	if _, err := repo.GenerateMonthlyTrips(ctx); err != nil {
		t.Fatalf("GenerateMonthlyTrips: %v", err)
	}

	got := readTrip(t, db, vehicleID, lastMonth)
	if got.name != "Road trip to Tahoe" {
		t.Errorf("user trip was renamed to %q", got.name)
	}
	if got.endedAt == nil || !got.endedAt.UTC().Equal(userEnd) {
		t.Errorf("user trip ended_at was rewritten to %v, want %s", got.endedAt, userEnd.Format(time.RFC3339))
	}
}
