package drive

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// =============================================================================
// repo_geofence_names_test.go — proves resolveCurrentGeofenceNames' central
// contract for the geofence-based charging-place pricing feature (migration
// 000228_geofence_charging_place_pricing), business requirement #5: "The
// same geofence identity should support drive start/end naming so renames
// can improve historical display, with existing place text retained as
// fallback."
//
// DriveRepo has no fake-pool test seam (concrete db *database.DB field, not
// an interface) — same architectural gap as ChargingRepo — so this reuses
// the file's own established live-database pattern
// (repairDSNOrSkip/openRepairTestDB, already defined in
// place_label_repair_test.go in this package) rather than inventing a new
// mocking approach.
// =============================================================================

// seedGeofenceNameFixture inserts one geofence directly (this package does
// not import internal/database/geofence to avoid a needless cross-package
// dependency for a single fixture row), returning its id. Removed via
// t.Cleanup.
func seedGeofenceNameFixture(t *testing.T, db *database.DB, name string) int64 {
	t.Helper()
	ctx := context.Background()
	var id int64
	err := db.Pool.QueryRow(ctx, `
INSERT INTO geofences (name, polygon_wkt, category, enabled, origin, needs_review)
VALUES ($1, 'POLYGON((0 0,0 0.001,0.001 0.001,0.001 0,0 0))', 'custom', true, 'manual', false)
RETURNING id`, name).Scan(&id)
	if err != nil {
		t.Fatalf("seed geofence: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM geofences WHERE id = $1`, id)
	})
	return id
}

func renameGeofence(t *testing.T, db *database.DB, geofenceID int64, newName string) {
	t.Helper()
	if _, err := db.Pool.Exec(context.Background(), `UPDATE geofences SET name = $1 WHERE id = $2`, newName, geofenceID); err != nil {
		t.Fatalf("rename geofence %d: %v", geofenceID, err)
	}
}

// TestGetByID_GeofenceRename_RetroactivelyImprovesDisplay is the direct
// regression test for business requirement #5: renaming a geofence must
// change what GetByID returns for a drive attached to it — on the NEXT
// read, with no rewrite of the drive row itself — while the originally
// stored start_place/end_place text remains in the database as the
// permanent fallback (proven by the "no geofence attached" drive in the
// same test never changing).
func TestGetByID_GeofenceRename_RetroactivelyImprovesDisplay(t *testing.T) {
	db := openRepairTestDB(t, repairDSNOrSkip(t))
	repo := NewDriveRepo(db)
	vehicleID := seedRepairFixture(t, db)

	geofenceID := seedGeofenceNameFixture(t, db, "Unnamed Charging Place")

	var attachedDriveID int64
	err := db.Pool.QueryRow(context.Background(), `
INSERT INTO drives (vehicle_id, started_at, start_place, start_geofence_id, place_label_version)
VALUES ($1, now(), 'stored fallback text from discovery time', $2, $3)
RETURNING id`, vehicleID, geofenceID, PlaceLabelVersion).Scan(&attachedDriveID)
	if err != nil {
		t.Fatalf("seed attached drive: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM drives WHERE id = $1`, attachedDriveID)
	})

	// A sibling drive with NO geofence attached — its stored start_place
	// must never be overlaid by anything, proving the fallback path is
	// untouched by the rename below.
	var unattachedDriveID int64
	err = db.Pool.QueryRow(context.Background(), `
INSERT INTO drives (vehicle_id, started_at, start_place, place_label_version)
VALUES ($1, now(), 'permanent fallback text', $2)
RETURNING id`, vehicleID, PlaceLabelVersion).Scan(&unattachedDriveID)
	if err != nil {
		t.Fatalf("seed unattached drive: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM drives WHERE id = $1`, unattachedDriveID)
	})

	// Before any rename: the attached drive's displayed name is the
	// geofence's original name (an overlay, not the stored fallback text) —
	// resolveCurrentGeofenceNames already prefers the live geofence name
	// even on the very first read.
	before, err := repo.GetByID(context.Background(), attachedDriveID)
	if err != nil {
		t.Fatalf("GetByID (before rename): %v", err)
	}
	if before.StartAddress == nil || *before.StartAddress != "Unnamed Charging Place" {
		t.Fatalf("StartAddress before rename = %v, want the geofence's current name %q", before.StartAddress, "Unnamed Charging Place")
	}

	// Rename the geofence — simulating a user editing "Unnamed Charging
	// Place" to a friendly name once they review it in the Charging Places
	// UI. No drive row is touched by this statement.
	renameGeofence(t, db, geofenceID, "Grandma's House")

	after, err := repo.GetByID(context.Background(), attachedDriveID)
	if err != nil {
		t.Fatalf("GetByID (after rename): %v", err)
	}
	if after.StartAddress == nil || *after.StartAddress != "Grandma's House" {
		t.Fatalf("StartAddress after rename = %v, want the NEW geofence name %q — rename must retroactively improve display", after.StartAddress, "Grandma's House")
	}

	// The unattached sibling drive's stored text must be completely
	// unaffected by the rename — it has no geofence to overlay from.
	unattached, err := repo.GetByID(context.Background(), unattachedDriveID)
	if err != nil {
		t.Fatalf("GetByID (unattached): %v", err)
	}
	if unattached.StartAddress == nil || *unattached.StartAddress != "permanent fallback text" {
		t.Fatalf("unattached drive StartAddress = %v, want unchanged stored fallback text", unattached.StartAddress)
	}
	if unattached.StartGeofenceID != nil {
		t.Fatalf("unattached drive StartGeofenceID = %v, want nil", unattached.StartGeofenceID)
	}
}

// TestGetByVehicle_BatchesGeofenceNameResolution proves
// resolveCurrentGeofenceNames' batched (single query regardless of row
// count) contract still resolves correctly across a page of many drives —
// a regression that broke the ANY($1) batching (e.g. only resolving the
// first match) would surface as silently-stale names for every drive after
// the first.
func TestGetByVehicle_BatchesGeofenceNameResolution(t *testing.T) {
	db := openRepairTestDB(t, repairDSNOrSkip(t))
	repo := NewDriveRepo(db)
	vehicleID := seedRepairFixture(t, db)

	geofenceA := seedGeofenceNameFixture(t, db, "Place A")
	geofenceB := seedGeofenceNameFixture(t, db, "Place B")

	insertDriveWithGeofence := func(startGeofenceID, endGeofenceID *int64, offset time.Duration) int64 {
		var id int64
		err := db.Pool.QueryRow(context.Background(), `
INSERT INTO drives (vehicle_id, started_at, start_place, end_place, start_geofence_id, end_geofence_id, place_label_version)
VALUES ($1, now() - $2::interval, 'fallback start', 'fallback end', $3, $4, $5)
RETURNING id`, vehicleID, fdur(offset), startGeofenceID, endGeofenceID, PlaceLabelVersion).Scan(&id)
		if err != nil {
			t.Fatalf("seed drive: %v", err)
		}
		t.Cleanup(func() {
			_, _ = db.Pool.Exec(context.Background(), `DELETE FROM drives WHERE id = $1`, id)
		})
		return id
	}

	driveA := insertDriveWithGeofence(&geofenceA, nil, time.Hour)
	driveB := insertDriveWithGeofence(nil, &geofenceB, 2*time.Hour)
	driveBoth := insertDriveWithGeofence(&geofenceA, &geofenceB, 3*time.Hour)

	drives, err := repo.GetByVehicle(context.Background(), vehicleID, 50, 0, time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("GetByVehicle: %v", err)
	}
	byID := make(map[int64]*driveByIDResult, len(drives))
	for _, d := range drives {
		byID[d.ID] = &driveByIDResult{startAddr: d.StartAddress, endAddr: d.EndAddress}
	}

	if got := byID[driveA]; got == nil || got.startAddr == nil || *got.startAddr != "Place A" {
		t.Errorf("driveA StartAddress = %v, want Place A", got)
	}
	if got := byID[driveB]; got == nil || got.endAddr == nil || *got.endAddr != "Place B" {
		t.Errorf("driveB EndAddress = %v, want Place B", got)
	}
	if got := byID[driveBoth]; got == nil || got.startAddr == nil || *got.startAddr != "Place A" || got.endAddr == nil || *got.endAddr != "Place B" {
		t.Errorf("driveBoth = %v, want start=Place A end=Place B", got)
	}
}

type driveByIDResult struct {
	startAddr *string
	endAddr   *string
}

// fdur renders a time.Duration as a Postgres interval literal understood by
// `::interval`.
func fdur(d time.Duration) string {
	return d.String()
}
