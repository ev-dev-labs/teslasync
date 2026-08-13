package telemetry

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

// =============================================================================
// telemetry_sessions_drive_geofence_attachment_test.go — tracker-layer tests
// for resolveAndUpdateAddress's geofence attachment behavior (migration
// 000228_geofence_charging_place_pricing).
//
// Business requirement #5 ("drive start/end naming... existing place text
// retained as fallback") and the auto-discovery design's explicit "match vs
// auto-create" split are pinned here:
//   - A drive endpoint that falls inside an existing geofence attaches that
//     geofence's id (start_geofence_id/end_geofence_id) AND uses its name
//     for start_place/end_place, same as before this feature except for the
//     new id attachment.
//   - A drive endpoint NEVER auto-creates a geofence — that is exclusive to
//     a confirmed charging session (see
//     telemetry_sessions_charge_geofence_pricing_test.go). No match simply
//     falls through to the pre-existing places-cache/geocoder resolution
//     chain, exactly as before this feature.
//
// Reuses this package's existing openGeofencePricingDB/seedPricingGeofence/
// countGeofences helpers (telemetry_sessions_charge_geofence_pricing_test.go)
// and the stubGeocoder type (place_label_repair_test.go).
// =============================================================================

const (
	driveGeofenceLat = 15.4000
	driveGeofenceLon = -48.4000
	driveNoMatchLat  = 16.5000
	driveNoMatchLon  = -49.5000
)

// errDriveGeocoderMustNotBeCalled documents intent: a stubGeocoder wired
// with this error makes "the geocoder must never be reached" an explicit,
// named failure mode instead of an unexplained generic error string.
var errDriveGeocoderMustNotBeCalled = errors.New("geocoder must not be called when an existing geofence already matched")

// seedDriveRow inserts one bare drives row (no place/coords yet) for
// vehicleID, removed via t.Cleanup.
func seedDriveRow(t *testing.T, db *database.DB, vehicleID int64) int64 {
	t.Helper()
	var id int64
	err := db.Pool.QueryRow(context.Background(),
		`INSERT INTO drives (vehicle_id, started_at) VALUES ($1, now()) RETURNING id`, vehicleID).Scan(&id)
	if err != nil {
		t.Fatalf("seed drive: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM drives WHERE id = $1`, id)
	})
	return id
}

// geocoderWithResult returns a stubGeocoder that answers exactly one
// coordinate with a named result, using ShortName()'s Name-preferred branch.
func geocoderWithResult(lat, lon float64, name string) *stubGeocoder {
	return &stubGeocoder{results: map[string]*geocoding.GeoResult{
		coordKey(lat, lon): {Name: name},
	}}
}

// readDriveGeofenceFields reads back one place/geofence-id column pair
// (start_place+start_geofence_id, or end_place+end_geofence_id) for a drive.
func readDriveGeofenceFields(t *testing.T, db *database.DB, driveID int64, placeCol, geofenceCol string) (*string, *int64) {
	t.Helper()
	var place *string
	var geofenceID *int64
	query := `SELECT ` + placeCol + `, ` + geofenceCol + ` FROM drives WHERE id = $1`
	if err := db.Pool.QueryRow(context.Background(), query, driveID).Scan(&place, &geofenceID); err != nil {
		t.Fatalf("read drive %d (%s, %s): %v", driveID, placeCol, geofenceCol, err)
	}
	return place, geofenceID
}

// TestResolveAndUpdateAddress_MatchesGeofence_SetsPlaceAndGeofenceID proves
// the match half of "match vs auto-create" at the tracker layer: a drive
// endpoint whose coordinates fall inside an existing geofence gets both its
// place text AND its new start_geofence_id/end_geofence_id column set from
// that match — never from the places cache or geocoder (which the stub
// below would fail loudly if reached, since it returns an error).
func TestResolveAndUpdateAddress_MatchesGeofence_SetsPlaceAndGeofenceID(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(t, db, driveGeofenceLat, driveGeofenceLon, "Matched Drive Endpoint Place")

	startDriveID := seedDriveRow(t, db, 820001)
	endDriveID := seedDriveRow(t, db, 820002)

	geo := &stubGeocoder{err: errDriveGeocoderMustNotBeCalled}
	tracker := NewTelemetrySessionTracker(db, nil, geo, nil)

	if ok := tracker.resolveAndUpdateAddress(startDriveID, driveGeofenceLat, driveGeofenceLon, true, resolveUseCache); !ok {
		t.Fatalf("resolveAndUpdateAddress(start) = false, want true (geofence match)")
	}
	if ok := tracker.resolveAndUpdateAddress(endDriveID, driveGeofenceLat, driveGeofenceLon, false, resolveUseCache); !ok {
		t.Fatalf("resolveAndUpdateAddress(end) = false, want true (geofence match)")
	}

	startPlace, startGeofenceID := readDriveGeofenceFields(t, db, startDriveID, "start_place", "start_geofence_id")
	if startPlace == nil || *startPlace != "Matched Drive Endpoint Place" {
		t.Fatalf("start_place = %v, want the matched geofence's name", startPlace)
	}
	if startGeofenceID == nil || *startGeofenceID != geofenceID {
		t.Fatalf("start_geofence_id = %v, want %d", startGeofenceID, geofenceID)
	}

	endPlace, endGeofenceID := readDriveGeofenceFields(t, db, endDriveID, "end_place", "end_geofence_id")
	if endPlace == nil || *endPlace != "Matched Drive Endpoint Place" {
		t.Fatalf("end_place = %v, want the matched geofence's name", endPlace)
	}
	if endGeofenceID == nil || *endGeofenceID != geofenceID {
		t.Fatalf("end_geofence_id = %v, want %d", endGeofenceID, geofenceID)
	}
}

// TestResolveAndUpdateAddress_NoMatch_NeverCreatesGeofence proves the other
// half: with no existing geofence at these coordinates, the function must
// (a) leave start_geofence_id/end_geofence_id nil, (b) never insert a new
// geofence row (auto-create is exclusive to confirmed charging sessions),
// and (c) still fall through to the pre-existing geocoder resolution chain
// so place naming keeps working exactly as it did before this feature.
func TestResolveAndUpdateAddress_NoMatch_NeverCreatesGeofence(t *testing.T) {
	db := openGeofencePricingDB(t)
	driveID := seedDriveRow(t, db, 820003)

	geo := geocoderWithResult(driveNoMatchLat, driveNoMatchLon, "Fallback Geocoded Place")
	tracker := NewTelemetrySessionTracker(db, nil, geo, nil)

	before := countGeofences(t, db)
	ok := tracker.resolveAndUpdateAddress(driveID, driveNoMatchLat, driveNoMatchLon, true, resolveUseCache)
	after := countGeofences(t, db)

	if !ok {
		t.Fatalf("resolveAndUpdateAddress = false, want true (geocoder fallback succeeds)")
	}
	if after != before {
		t.Fatalf("geofence count = %d -> %d, want unchanged (drive endpoints never auto-create)", before, after)
	}

	startPlace, startGeofenceID := readDriveGeofenceFields(t, db, driveID, "start_place", "start_geofence_id")
	if startGeofenceID != nil {
		t.Fatalf("start_geofence_id = %v, want nil (no geofence matched)", startGeofenceID)
	}
	if startPlace == nil || *startPlace != "Fallback Geocoded Place" {
		t.Fatalf("start_place = %v, want the geocoder's fallback name", startPlace)
	}
}
