package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// The production bug these tests cover: Journey Details showed a byte-identical
// Start and Destination on drives covering many miles, while the route map drew
// the correct route.
//
// Re-labelling could not fix it. The geocoder is handed drives.start_lat and
// drives.end_lat, so once completion persisted the same fix into both pairs,
// every repair pass re-resolved one coordinate twice and wrote the identical
// string into start_place and end_place. The map looked right because it renders
// the recorded GPS track rather than the stored endpoint columns — which is also
// where the true endpoints survive, and where the repair now reads them from.

func f64(v float64) *float64 { return &v }

// TestEndpointsDegenerate covers the predicate that decides whether a drive's
// stored coordinates can describe two distinct places at all.
func TestEndpointsDegenerate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		drive *drivemodel.Drive
		want  bool
	}{
		{
			name:  "identical endpoints cannot describe two places",
			drive: &drivemodel.Drive{StartLat: f64(47.80), StartLon: f64(-122.20), EndLat: f64(47.80), EndLon: f64(-122.20)},
			want:  true,
		},
		{
			name:  "distinct endpoints are usable",
			drive: &drivemodel.Drive{StartLat: f64(47.80), StartLon: f64(-122.20), EndLat: f64(47.86), EndLon: f64(-122.19)},
			want:  false,
		},
		{
			name:  "same latitude but different longitude is distinct",
			drive: &drivemodel.Drive{StartLat: f64(47.80), StartLon: f64(-122.20), EndLat: f64(47.80), EndLon: f64(-122.31)},
			want:  false,
		},
		{
			name:  "missing end endpoint",
			drive: &drivemodel.Drive{StartLat: f64(47.80), StartLon: f64(-122.20)},
			want:  true,
		},
		{
			name:  "missing start endpoint",
			drive: &drivemodel.Drive{EndLat: f64(47.86), EndLon: f64(-122.19)},
			want:  true,
		},
		{
			name:  "no endpoints at all",
			drive: &drivemodel.Drive{},
			want:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := endpointsDegenerate(tt.drive); got != tt.want {
				t.Errorf("endpointsDegenerate() = %v, want %v", got, tt.want)
			}
		})
	}
}

// Track fixture. The stored row collapses both endpoints onto the start fix,
// while signal_log holds a route between two genuinely different places.
const (
	trackStartLat, trackStartLon = 47.6205, -122.1490
	trackEndLat, trackEndLon     = 47.6740, -122.1215
	trackStartLabel              = "1 Microsoft Way, Redmond"
	trackEndLabel                = "Willows Road Northeast, Redmond"
)

func trackFixtureGeocoder() *stubGeocoder {
	return &stubGeocoder{results: map[string]*geocoding.GeoResult{
		coordKey(trackStartLat, trackStartLon): {
			DisplayName: "1 Microsoft Way, Redmond, WA 98052",
			HouseNumber: "1",
			Road:        "Microsoft Way",
			City:        "Redmond",
		},
		coordKey(trackEndLat, trackEndLon): {
			DisplayName: "Willows Road Northeast, Redmond, WA 98052",
			Road:        "Willows Road Northeast",
			City:        "Redmond",
		},
	}}
}

// seedDegenerateDrive stores a drive whose end coordinates were persisted equal
// to its start, together with the GPS track that holds the true endpoints.
func seedDegenerateDrive(t *testing.T, db *database.DB, vehicleID int64) (int64, time.Time, time.Time) {
	t.Helper()
	bg := context.Background()

	startTs := time.Now().Add(-90 * time.Minute).UTC().Truncate(time.Second)
	endTs := startTs.Add(36 * time.Minute)

	var id int64
	err := db.Pool.QueryRow(bg,
		`INSERT INTO drives (vehicle_id, started_at, ended_at, start_place, end_place,
		                     start_lat, start_lng, end_lat, end_lng, place_label_version)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0) RETURNING id`,
		vehicleID, startTs, endTs,
		// Both labels and both coordinate pairs are the start fix: exactly the
		// shape a completed drive lands in when the boundary snapshot fallback
		// resolves one position for both ends.
		trackStartLabel, trackStartLabel,
		trackStartLat, trackStartLon, trackStartLat, trackStartLon).Scan(&id)
	if err != nil {
		t.Fatalf("seed degenerate drive: %v", err)
	}

	fixes := []struct {
		offset   time.Duration
		lat, lon float64
	}{
		{0, trackStartLat, trackStartLon},
		{18 * time.Minute, 47.6480, -122.1350},
		{36 * time.Minute, trackEndLat, trackEndLon},
	}
	for _, fx := range fixes {
		ts := startTs.Add(fx.offset)
		for field, val := range map[string]float64{
			"LocationLatitude":  fx.lat,
			"LocationLongitude": fx.lon,
		} {
			if _, err := db.Pool.Exec(bg,
				`INSERT INTO signal_log (vehicle_id, ts, field, value_kind, float_value)
				 VALUES ($1, $2, $3, $4, $5)`,
				vehicleID, ts, field, int16(protomodel.ValueKindFloat), val); err != nil {
				t.Fatalf("seed signal_log %s: %v", field, err)
			}
		}
	}

	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(),
			`DELETE FROM signal_log WHERE vehicle_id = $1`, vehicleID)
	})
	return id, startTs, endTs
}

func readCoords(t *testing.T, db *database.DB, id int64) (sLat, sLon, eLat, eLon float64) {
	t.Helper()
	var a, b, c, d *float64
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT start_lat, start_lng, end_lat, end_lng FROM drives WHERE id = $1`, id).
		Scan(&a, &b, &c, &d); err != nil {
		t.Fatalf("read coords for drive %d: %v", id, err)
	}
	deref := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	return deref(a), deref(b), deref(c), deref(d)
}

// TestRepairStalePlaceLabels_RecoversCollapsedEndpoints is the regression test
// for the reported bug. A drive whose stored endpoints collapsed onto one fix
// must come out of the repair with the true endpoints from its GPS track and
// two different place labels.
func TestRepairStalePlaceLabels_RecoversCollapsedEndpoints(t *testing.T) {
	geo := trackFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)
	tracker.SetSignalLogReader(signaldb.NewSignalLogReader(db))
	id, _, _ := seedDegenerateDrive(t, db, vehicleID)

	tracker.RepairStalePlaceLabels(context.Background())

	sLat, sLon, eLat, eLon := readCoords(t, db, id)
	if sLat == eLat && sLon == eLon {
		t.Fatalf("endpoints still collapsed onto one fix (%.4f,%.4f) — the panel would repeat one address", sLat, sLon)
	}
	if !closeTo(eLat, trackEndLat) || !closeTo(eLon, trackEndLon) {
		t.Errorf("end coordinates: want the track's last fix (%.4f,%.4f), got (%.4f,%.4f)",
			trackEndLat, trackEndLon, eLat, eLon)
	}
	if !closeTo(sLat, trackStartLat) || !closeTo(sLon, trackStartLon) {
		t.Errorf("start coordinates: want the track's first fix (%.4f,%.4f), got (%.4f,%.4f)",
			trackStartLat, trackStartLon, sLat, sLon)
	}

	start, end, _ := readPlaces(t, db, id)
	if start == end {
		t.Fatalf("Start and Destination are still the same label %q — this is the reported bug", start)
	}
	if end != trackEndLabel {
		t.Errorf("end_place: want %q resolved from the repaired endpoint, got %q", trackEndLabel, end)
	}
}

// TestRepairDriveEndpointCoords_LeavesGenuineRoundTrips pins that a drive which
// really did finish where it started keeps its coordinates. Rewriting those
// would invent a destination the vehicle never reached.
func TestRepairDriveEndpointCoords_LeavesGenuineRoundTrips(t *testing.T) {
	geo := trackFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)
	tracker.SetSignalLogReader(signaldb.NewSignalLogReader(db))

	bg := context.Background()
	startTs := time.Now().Add(-60 * time.Minute).UTC().Truncate(time.Second)
	endTs := startTs.Add(20 * time.Minute)

	var id int64
	if err := db.Pool.QueryRow(bg,
		`INSERT INTO drives (vehicle_id, started_at, ended_at,
		                     start_lat, start_lng, end_lat, end_lng, place_label_version)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 0) RETURNING id`,
		vehicleID, startTs, endTs,
		trackStartLat, trackStartLon, trackStartLat, trackStartLon).Scan(&id); err != nil {
		t.Fatalf("seed round trip: %v", err)
	}

	// The track leaves and returns to the same place, so the first and last fix
	// agree with what is stored.
	for _, fx := range []struct {
		offset   time.Duration
		lat, lon float64
	}{
		{0, trackStartLat, trackStartLon},
		{10 * time.Minute, trackEndLat, trackEndLon},
		{20 * time.Minute, trackStartLat, trackStartLon},
	} {
		ts := startTs.Add(fx.offset)
		for field, val := range map[string]float64{
			"LocationLatitude":  fx.lat,
			"LocationLongitude": fx.lon,
		} {
			if _, err := db.Pool.Exec(bg,
				`INSERT INTO signal_log (vehicle_id, ts, field, value_kind, float_value)
				 VALUES ($1, $2, $3, $4, $5)`,
				vehicleID, ts, field, int16(protomodel.ValueKindFloat), val); err != nil {
				t.Fatalf("seed signal_log: %v", err)
			}
		}
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM signal_log WHERE vehicle_id = $1`, vehicleID)
	})

	d := &drivemodel.Drive{
		ID: id, VehicleID: vehicleID, StartTs: startTs, EndTs: &endTs,
		StartLat: f64(trackStartLat), StartLon: f64(trackStartLon),
		EndLat: f64(trackStartLat), EndLon: f64(trackStartLon),
	}
	startRepaired, endRepaired := tracker.repairDriveEndpointCoords(bg, d)
	if startRepaired || endRepaired {
		t.Errorf("round trip was rewritten (start=%v end=%v); a drive that returned home has no other destination",
			startRepaired, endRepaired)
	}

	sLat, _, eLat, _ := readCoords(t, db, id)
	if !closeTo(sLat, trackStartLat) || !closeTo(eLat, trackStartLat) {
		t.Errorf("round-trip coordinates were modified: start=%.4f end=%.4f", sLat, eLat)
	}
}

// TestRepairDriveEndpointCoords_NoTrackKeepsStoredEndpoints pins that a drive
// with no usable GPS history is left exactly as it is. Blanking or guessing its
// endpoints would replace a possibly-correct row with a definitely-wrong one.
func TestRepairDriveEndpointCoords_NoTrackKeepsStoredEndpoints(t *testing.T) {
	geo := trackFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)
	tracker.SetSignalLogReader(signaldb.NewSignalLogReader(db))

	startTs := time.Now().Add(-45 * time.Minute).UTC().Truncate(time.Second)
	endTs := startTs.Add(15 * time.Minute)
	d := &drivemodel.Drive{
		ID: 0, VehicleID: vehicleID, StartTs: startTs, EndTs: &endTs,
		StartLat: f64(trackStartLat), StartLon: f64(trackStartLon),
		EndLat: f64(trackStartLat), EndLon: f64(trackStartLon),
	}

	startRepaired, endRepaired := tracker.repairDriveEndpointCoords(context.Background(), d)
	if startRepaired || endRepaired {
		t.Errorf("repaired from an empty track (start=%v end=%v)", startRepaired, endRepaired)
	}
	if *d.EndLat != trackStartLat {
		t.Errorf("end latitude changed without any track evidence: %v", *d.EndLat)
	}
}

func closeTo(got, want float64) bool {
	d := got - want
	if d < 0 {
		d = -d
	}
	return d < 1e-6
}
