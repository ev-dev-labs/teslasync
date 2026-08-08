package drive

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// These exercise the place-label repair backlog against a live database, so the
// real SQL, the real scan path and the real partial index are covered rather
// than a hand-written approximation of them. They run only when
// DATABASE_URL/TESLASYNC_TEST_DSN points at an instance with migrations
// applied, mirroring energy/roundtrip_test.go.
//
// The backlog query is global, so every assertion below filters to this test's
// own seeded rows — a shared dev database usually has a backlog of its own and
// counting all of it would make the test flap.

func repairDSNOrSkip(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("TESLASYNC_TEST_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL/TESLASYNC_TEST_DSN not set; skipping place-label repair tests")
	}
	return dsn
}

func openRepairTestDB(t *testing.T, dsn string) *database.DB {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot reach database: %v", err)
	}
	return &database.DB{Pool: pool}
}

// seedRepairFixture creates one vehicle and returns its id, removing the
// vehicle and every drive attached to it when the test ends.
func seedRepairFixture(t *testing.T, db *database.DB) int64 {
	t.Helper()
	ctx := context.Background()

	if _, err := db.Pool.Exec(ctx,
		`SELECT 1 FROM drives WHERE place_label_version IS NOT NULL LIMIT 1`); err != nil {
		t.Skipf("drives.place_label_version missing; migration 000226 not applied: %v", err)
	}

	unique := time.Now().UnixNano()
	var vehicleID int64
	err := db.Pool.QueryRow(ctx,
		`INSERT INTO vehicles (tesla_id, vin, display_name) VALUES ($1, $2, $3) RETURNING id`,
		unique, fmt.Sprintf("TESTPLR%010d", unique%1e10), "place-label repair fixture",
	).Scan(&vehicleID)
	if err != nil {
		t.Fatalf("seed vehicle: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = db.Pool.Exec(bg, `DELETE FROM drives WHERE vehicle_id = $1`, vehicleID)
		_, _ = db.Pool.Exec(bg, `DELETE FROM vehicles WHERE id = $1`, vehicleID)
	})
	return vehicleID
}

func insertRepairDrive(t *testing.T, db *database.DB, vehicleID int64, version int, withCoords bool) int64 {
	t.Helper()
	var (
		id  int64
		err error
	)
	if withCoords {
		err = db.Pool.QueryRow(context.Background(),
			`INSERT INTO drives (vehicle_id, started_at, start_place, end_place,
			                     start_lat, start_lng, end_lat, end_lng, place_label_version)
			 VALUES ($1, now(), 'Bothell Everett Highway, Bothell',
			         'Bothell Everett Highway, Mill Creek',
			         47.8060, -122.2050, 47.8600, -122.2040, $2)
			 RETURNING id`, vehicleID, version).Scan(&id)
	} else {
		err = db.Pool.QueryRow(context.Background(),
			`INSERT INTO drives (vehicle_id, started_at, place_label_version)
			 VALUES ($1, now(), $2) RETURNING id`, vehicleID, version).Scan(&id)
	}
	if err != nil {
		t.Fatalf("seed drive (version=%d coords=%v): %v", version, withCoords, err)
	}
	return id
}

// TestFindStalePlaceLabels_SelectsOnlyRepairableRows pins the backlog contract:
// a drive is repairable only when it predates the current labelling revision
// AND still has coordinates to re-resolve from. Selecting a coordinate-less
// drive would make the repair loop spin forever on a row it can never fix.
func TestFindStalePlaceLabels_SelectsOnlyRepairableRows(t *testing.T) {
	db := openRepairTestDB(t, repairDSNOrSkip(t))
	repo := NewDriveRepo(db)
	vehicleID := seedRepairFixture(t, db)

	staleWithCoords := insertRepairDrive(t, db, vehicleID, 0, true)
	staleNoCoords := insertRepairDrive(t, db, vehicleID, 0, false)
	current := insertRepairDrive(t, db, vehicleID, PlaceLabelVersion, true)

	drives, err := repo.FindStalePlaceLabels(context.Background(), 500)
	if err != nil {
		t.Fatalf("FindStalePlaceLabels: %v", err)
	}
	got := map[int64]bool{}
	for _, d := range drives {
		got[d.ID] = true
	}

	if !got[staleWithCoords] {
		t.Errorf("stale drive with coordinates (id=%d) missing from backlog", staleWithCoords)
	}
	if got[staleNoCoords] {
		t.Errorf("stale drive without coordinates (id=%d) must not be selected — it can never be repaired", staleNoCoords)
	}
	if got[current] {
		t.Errorf("drive already at version %d (id=%d) must not be re-queued", PlaceLabelVersion, current)
	}
}

// TestFindStalePlaceLabels_RespectsLimit guards the bound that keeps one pass
// over a large production backlog predictable.
func TestFindStalePlaceLabels_RespectsLimit(t *testing.T) {
	db := openRepairTestDB(t, repairDSNOrSkip(t))
	repo := NewDriveRepo(db)
	vehicleID := seedRepairFixture(t, db)
	for i := 0; i < 3; i++ {
		insertRepairDrive(t, db, vehicleID, 0, true)
	}

	drives, err := repo.FindStalePlaceLabels(context.Background(), 2)
	if err != nil {
		t.Fatalf("FindStalePlaceLabels: %v", err)
	}
	if len(drives) > 2 {
		t.Fatalf("limit not honoured: want <= 2 rows, got %d", len(drives))
	}

	none, err := repo.FindStalePlaceLabels(context.Background(), 0)
	if err != nil {
		t.Fatalf("FindStalePlaceLabels(0): %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("limit 0 should query nothing, got %d rows", len(none))
	}
}

// TestMarkPlaceLabelVersion_DrainsBacklog is the idempotency guarantee: once a
// drive is marked it never returns to the backlog, so the startup repair
// re-geocodes each row exactly once instead of on every boot.
func TestMarkPlaceLabelVersion_DrainsBacklog(t *testing.T) {
	db := openRepairTestDB(t, repairDSNOrSkip(t))
	repo := NewDriveRepo(db)
	ctx := context.Background()
	vehicleID := seedRepairFixture(t, db)
	id := insertRepairDrive(t, db, vehicleID, 0, true)

	inBacklog := func() bool {
		t.Helper()
		drives, err := repo.FindStalePlaceLabels(ctx, 500)
		if err != nil {
			t.Fatalf("FindStalePlaceLabels: %v", err)
		}
		for _, d := range drives {
			if d.ID == id {
				return true
			}
		}
		return false
	}

	if !inBacklog() {
		t.Fatalf("seeded stale drive %d not in backlog before marking", id)
	}
	if err := repo.MarkPlaceLabelVersion(ctx, id); err != nil {
		t.Fatalf("MarkPlaceLabelVersion: %v", err)
	}
	if inBacklog() {
		t.Fatalf("drive %d still in backlog after marking — repair would re-run forever", id)
	}

	// Marking twice must stay a no-op; the repair may retry a drive whose
	// second endpoint failed on an earlier pass.
	if err := repo.MarkPlaceLabelVersion(ctx, id); err != nil {
		t.Fatalf("MarkPlaceLabelVersion (second call): %v", err)
	}

	var version int
	if err := db.Pool.QueryRow(ctx,
		`SELECT place_label_version FROM drives WHERE id = $1`, id).Scan(&version); err != nil {
		t.Fatalf("read back version: %v", err)
	}
	if version != PlaceLabelVersion {
		t.Fatalf("place_label_version: want %d, got %d", PlaceLabelVersion, version)
	}
}

// TestFindStalePlaceLabels_PreservesPlaceColumns ensures the backlog scan reads
// the same column list as every other drive query. A column-order drift here
// would hand the repair a drive whose coordinates belong to another field and
// silently geocode the wrong location.
func TestFindStalePlaceLabels_PreservesPlaceColumns(t *testing.T) {
	db := openRepairTestDB(t, repairDSNOrSkip(t))
	repo := NewDriveRepo(db)
	vehicleID := seedRepairFixture(t, db)
	id := insertRepairDrive(t, db, vehicleID, 0, true)

	drives, err := repo.FindStalePlaceLabels(context.Background(), 500)
	if err != nil {
		t.Fatalf("FindStalePlaceLabels: %v", err)
	}
	for _, d := range drives {
		if d.ID != id {
			continue
		}
		if d.StartAddress == nil || *d.StartAddress != "Bothell Everett Highway, Bothell" {
			t.Errorf("StartAddress: want seeded start_place, got %v", d.StartAddress)
		}
		if d.EndAddress == nil || *d.EndAddress != "Bothell Everett Highway, Mill Creek" {
			t.Errorf("EndAddress: want seeded end_place, got %v", d.EndAddress)
		}
		if d.StartLat == nil || d.StartLon == nil || d.EndLat == nil || d.EndLon == nil {
			t.Fatalf("coordinates not scanned: start=(%v,%v) end=(%v,%v)",
				d.StartLat, d.StartLon, d.EndLat, d.EndLon)
		}
		if *d.StartLat == *d.EndLat {
			t.Errorf("start/end latitude collapsed to %v — column mapping drifted", *d.StartLat)
		}
		return
	}
	t.Fatalf("seeded drive %d not returned by FindStalePlaceLabels", id)
}
