package telemetry

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

// RepairStalePlaceLabels is the pass that heals drives geocoded before the
// place-label rewrite, when every provider adapter discarded the house number
// and the point-of-interest name and both ends of a drive along one road
// collapsed to the same string in Journey Details.
//
// The loop is exercised against a live database because its whole job is
// database state transitions — which rows are selected, which get marked, and
// whether the backlog converges. Only the geocoder is stubbed, so provider
// failure and cache-bypass behaviour are reproducible without network access.
//
// Runs only when DATABASE_URL/TESLASYNC_TEST_DSN points at an instance with
// migrations applied, mirroring database/energy/roundtrip_test.go.

// stubGeocoder returns a canned result per coordinate and records every lookup
// so tests can assert the places cache was actually bypassed.
type stubGeocoder struct {
	mu      sync.Mutex
	results map[string]*geocoding.GeoResult
	err     error
	calls   []string
}

func coordKey(lat, lon float64) string { return fmt.Sprintf("%.4f,%.4f", lat, lon) }

func (s *stubGeocoder) ReverseGeocode(_ context.Context, lat, lon float64) (*geocoding.GeoResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, coordKey(lat, lon))
	if s.err != nil {
		return nil, s.err
	}
	return s.results[coordKey(lat, lon)], nil
}

func (s *stubGeocoder) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

var _ geocoding.Geocoder = (*stubGeocoder)(nil)

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

func openRepairDB(t *testing.T) *database.DB {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), repairDSNOrSkip(t))
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
	if _, err := pool.Exec(ctx, `SELECT place_label_version FROM drives LIMIT 0`); err != nil {
		t.Skipf("drives.place_label_version missing; migration 000226 not applied: %v", err)
	}
	return db
}

// The two endpoints below sit on one road in different cities — the exact shape
// of the reported bug. The old labeller produced "Bothell Everett Highway,
// Bothell" and "Bothell Everett Highway, Mill Creek", which read as the same
// place; the rewritten labeller keeps the house number and POI name.
const (
	repairStartLat, repairStartLon = 47.8060, -122.2050
	repairEndLat, repairEndLon     = 47.8600, -122.2040
	oldStartLabel                  = "Bothell Everett Highway, Bothell"
	oldEndLabel                    = "Bothell Everett Highway, Mill Creek"
	newStartLabel                  = "19205 Bothell Everett Hwy, Bothell"
	newEndLabel                    = "Costco Wholesale, Mill Creek"
)

func repairFixtureGeocoder() *stubGeocoder {
	return &stubGeocoder{results: map[string]*geocoding.GeoResult{
		coordKey(repairStartLat, repairStartLon): {
			DisplayName: "19205 Bothell Everett Hwy, Bothell, WA 98012",
			HouseNumber: "19205",
			Road:        "Bothell Everett Hwy",
			City:        "Bothell",
		},
		coordKey(repairEndLat, repairEndLon): {
			DisplayName: "Costco Wholesale, Bothell Everett Hwy, Mill Creek, WA",
			Name:        "Costco Wholesale",
			Road:        "Bothell Everett Hwy",
			City:        "Mill Creek",
		},
	}}
}

// newRepairTracker builds a tracker wired to the live DB with a stubbed
// geocoder, and seeds one vehicle that is removed with all of its drives when
// the test ends.
func newRepairTracker(t *testing.T, geo geocoding.Geocoder) (*TelemetrySessionTracker, *database.DB, int64) {
	t.Helper()
	db := openRepairDB(t)
	tracker := NewTelemetrySessionTracker(db, nil, geo, nil)

	unique := time.Now().UnixNano()
	var vehicleID int64
	err := db.Pool.QueryRow(context.Background(),
		`INSERT INTO vehicles (tesla_id, vin, display_name) VALUES ($1, $2, $3) RETURNING id`,
		unique, fmt.Sprintf("TESTRPR%010d", unique%1e10), "place-label repair fixture",
	).Scan(&vehicleID)
	if err != nil {
		t.Fatalf("seed vehicle: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = db.Pool.Exec(bg, `DELETE FROM drives WHERE vehicle_id = $1`, vehicleID)
		_, _ = db.Pool.Exec(bg, `DELETE FROM vehicles WHERE id = $1`, vehicleID)
	})
	return tracker, db, vehicleID
}

func seedStaleDrive(t *testing.T, db *database.DB, vehicleID int64) int64 {
	t.Helper()
	var id int64
	err := db.Pool.QueryRow(context.Background(),
		`INSERT INTO drives (vehicle_id, started_at, start_place, end_place,
		                     start_lat, start_lng, end_lat, end_lng, place_label_version)
		 VALUES ($1, now(), $2, $3, $4, $5, $6, $7, 0) RETURNING id`,
		vehicleID, oldStartLabel, oldEndLabel,
		repairStartLat, repairStartLon, repairEndLat, repairEndLon).Scan(&id)
	if err != nil {
		t.Fatalf("seed stale drive: %v", err)
	}
	return id
}

func readPlaces(t *testing.T, db *database.DB, id int64) (start, end string, version int) {
	t.Helper()
	var s, e *string
	err := db.Pool.QueryRow(context.Background(),
		`SELECT start_place, end_place, place_label_version FROM drives WHERE id = $1`, id).
		Scan(&s, &e, &version)
	if err != nil {
		t.Fatalf("read drive %d: %v", id, err)
	}
	if s != nil {
		start = *s
	}
	if e != nil {
		end = *e
	}
	return start, end, version
}

// TestRepairStalePlaceLabels_MakesEndpointsDistinct is the regression test for
// the reported production bug: a drive whose stored Start and Destination read
// as the same place must come out of the repair with two concretely different
// labels, and must not be queued again.
func TestRepairStalePlaceLabels_MakesEndpointsDistinct(t *testing.T) {
	geo := repairFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)
	id := seedStaleDrive(t, db, vehicleID)

	tracker.RepairStalePlaceLabels(context.Background())

	start, end, version := readPlaces(t, db, id)
	if start == oldStartLabel {
		t.Errorf("start_place still carries the old road-level label %q", start)
	}
	if end == oldEndLabel {
		t.Errorf("end_place still carries the old road-level label %q", end)
	}
	if start != newStartLabel {
		t.Errorf("start_place: want house-numbered label, got %q", start)
	}
	if end != newEndLabel {
		t.Errorf("end_place: want POI label, got %q", end)
	}
	if start == end {
		t.Errorf("endpoints collapsed to one label %q — this is the reported bug", start)
	}
	if version != drivedb.PlaceLabelVersion {
		t.Errorf("place_label_version: want %d, got %d", drivedb.PlaceLabelVersion, version)
	}
}

// TestRepairStalePlaceLabels_IsIdempotent guarantees the pass costs nothing on
// the second boot. Re-geocoding the whole table on every start would burn the
// provider quota and, on Nominatim's 1 req/s policy, never finish.
func TestRepairStalePlaceLabels_IsIdempotent(t *testing.T) {
	geo := repairFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)
	seedStaleDrive(t, db, vehicleID)

	tracker.RepairStalePlaceLabels(context.Background())
	afterFirst := geo.callCount()
	if afterFirst == 0 {
		t.Fatalf("first pass made no geocoder calls")
	}

	tracker.RepairStalePlaceLabels(context.Background())
	if got := geo.callCount(); got != afterFirst {
		t.Fatalf("second pass re-geocoded: calls went %d → %d", afterFirst, got)
	}
}

// TestRepairStalePlaceLabels_KeepsFailedDrivesQueued pins the reason
// resolveAndUpdateAddress reports success: a provider outage must defer a drive
// to the next run rather than mark it repaired and strand it on the old label
// forever.
func TestRepairStalePlaceLabels_KeepsFailedDrivesQueued(t *testing.T) {
	geo := &stubGeocoder{err: errors.New("provider down")}
	tracker, db, vehicleID := newRepairTracker(t, geo)
	id := seedStaleDrive(t, db, vehicleID)

	done := make(chan struct{})
	go func() {
		tracker.RepairStalePlaceLabels(context.Background())
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		t.Fatal("repair did not terminate when every lookup failed — backlog query is not cursor-paginated, so it would spin")
	}

	start, end, version := readPlaces(t, db, id)
	if version != 0 {
		t.Errorf("place_label_version: want 0 (still queued), got %d", version)
	}
	if start != oldStartLabel || end != oldEndLabel {
		t.Errorf("labels changed despite provider failure: start=%q end=%q", start, end)
	}
}

// TestRepairStalePlaceLabels_BypassesStalePlacesCache is the subtle one. The
// places cache stores labels produced by whichever revision was live, so a
// repair that consulted it would be handed back the exact string it is trying
// to replace. The pass must reach the provider, and the refreshed cache entry
// must carry the new label for everyone else.
func TestRepairStalePlaceLabels_BypassesStalePlacesCache(t *testing.T) {
	geo := repairFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)
	id := seedStaleDrive(t, db, vehicleID)

	cache := dbadmin.NewPlacesCacheRepo(db)
	ctx := context.Background()
	if err := cache.Upsert(ctx, &dbadmin.PlaceCacheEntry{
		Latitude:    repairStartLat,
		Longitude:   repairStartLon,
		DisplayName: oldStartLabel,
		Source:      "geocoding",
	}); err != nil {
		t.Fatalf("seed places cache: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(),
			`DELETE FROM places_cache WHERE display_name IN ($1, $2)`,
			oldStartLabel, newStartLabel)
	})

	tracker.RepairStalePlaceLabels(ctx)

	start, _, _ := readPlaces(t, db, id)
	if start == oldStartLabel {
		t.Fatalf("repair read the stale cache entry back: start_place still %q", start)
	}
	if geo.callCount() == 0 {
		t.Fatal("repair never reached the provider — the cache was not bypassed")
	}

	refreshed, err := cache.FindNearby(ctx, repairStartLat, repairStartLon, 50)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if refreshed == nil {
		t.Fatal("cache entry vanished after repair")
	}
	if refreshed.DisplayName == oldStartLabel {
		t.Errorf("cache still serves the old label %q to every other drive", refreshed.DisplayName)
	}
}

// TestRepairStalePlaceLabels_HonoursContextCancellation keeps shutdown fast:
// the pass runs in a startup goroutine and sleeps between provider calls.
func TestRepairStalePlaceLabels_HonoursContextCancellation(t *testing.T) {
	geo := repairFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)
	seedStaleDrive(t, db, vehicleID)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	done := make(chan struct{})
	go func() {
		tracker.RepairStalePlaceLabels(ctx)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("repair ignored a cancelled context")
	}
	if geo.callCount() != 0 {
		t.Errorf("repair geocoded %d endpoints after cancellation", geo.callCount())
	}
}
