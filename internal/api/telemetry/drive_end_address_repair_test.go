package telemetry

import (
	"context"
	"testing"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// Pure planning tests for the duplicate-end-address repair: the end
// address must always come from the end coordinates, a failed or pending
// lookup must never copy the start address, and a genuine round trip
// keeps its (correctly) identical address.

func suspectDrive() *drivemodel.Drive {
	start := "19720 Bothell Everett Highway, Bothell"
	return &drivemodel.Drive{
		ID: 555, StartAddress: &start, EndAddress: &start,
		StartLat: f64(47.8060), StartLon: f64(-122.2050),
		EndLat: f64(47.6740), EndLon: f64(-122.1215),
	}
}

func TestPlanEndAddressRepair(t *testing.T) {
	t.Run("distinct end lookup is written", func(t *testing.T) {
		got, write := planEndAddressRepair(suspectDrive(), "1 Microsoft Way, Redmond", true)
		if !write || got != "1 Microsoft Way, Redmond" {
			t.Errorf("plan = %q, %v; want the end-coordinate label written", got, write)
		}
	})
	t.Run("failed end lookup never copies the start address", func(t *testing.T) {
		if got, write := planEndAddressRepair(suspectDrive(), "", false); write || got != "" {
			t.Errorf("plan = %q, %v; want no write on failed lookup", got, write)
		}
	})
	t.Run("pending end lookup writes nothing", func(t *testing.T) {
		if got, write := planEndAddressRepair(suspectDrive(), "", true); write || got != "" {
			t.Errorf("plan = %q, %v; want no write on empty result", got, write)
		}
	})
	t.Run("end resolving to the start label again writes nothing", func(t *testing.T) {
		if _, write := planEndAddressRepair(suspectDrive(), "19720 Bothell Everett Highway, Bothell", true); write {
			t.Error("plan wrote the start label as the end label")
		}
	})
	t.Run("genuine round trip is never touched", func(t *testing.T) {
		d := suspectDrive()
		d.EndLat, d.EndLon = f64(47.8061), f64(-122.2050)
		if _, write := planEndAddressRepair(d, "Somewhere Else", true); write {
			t.Error("plan touched a genuine round trip")
		}
	})
}

// TestRepairDuplicateEndAddresses_DB exercises the full repair against a
// live database (skipped without a test DSN, like the other repair
// tests): dry run proposes without writing, apply re-resolves the end
// address from the end coordinates, a second apply is a no-op, and a
// genuine round trip is untouched.
func TestRepairDuplicateEndAddresses_DB(t *testing.T) {
	geo := repairFixtureGeocoder()
	tracker, db, vehicleID := newRepairTracker(t, geo)

	bg := context.Background()
	seed := func(startPlace, endPlace string, endLat, endLon float64) int64 {
		t.Helper()
		var id int64
		err := db.Pool.QueryRow(bg,
			`INSERT INTO drives (vehicle_id, started_at, ended_at, start_place, end_place,
			                     start_lat, start_lng, end_lat, end_lng, place_label_version)
			 VALUES ($1, now(), now(), $2, $3, $4, $5, $6, $7, 3) RETURNING id`,
			vehicleID, startPlace, endPlace,
			repairStartLat, repairStartLon, endLat, endLon).Scan(&id)
		if err != nil {
			t.Fatalf("seed drive: %v", err)
		}
		return id
	}

	suspectID := seed(oldStartLabel, oldStartLabel, repairEndLat, repairEndLon)
	roundTripID := seed(oldStartLabel, oldStartLabel, repairStartLat, repairStartLon)

	dry, err := tracker.RepairDuplicateEndAddresses(bg, true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if len(dry.Changed) != 1 || dry.Changed[0].DriveID != suspectID || dry.Changed[0].NewEnd != newEndLabel {
		t.Fatalf("dry run changes = %+v, want one proposed change to %q for drive %d", dry.Changed, newEndLabel, suspectID)
	}
	if _, end, _ := readPlaces(t, db, suspectID); end != oldStartLabel {
		t.Fatalf("dry run wrote end_place = %q, want unchanged %q", end, oldStartLabel)
	}

	applied, err := tracker.RepairDuplicateEndAddresses(bg, false)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(applied.Changed) != 1 {
		t.Fatalf("apply changes = %+v, want one", applied.Changed)
	}
	if _, end, _ := readPlaces(t, db, suspectID); end != newEndLabel {
		t.Fatalf("end_place = %q, want %q resolved from end coordinates", end, newEndLabel)
	}
	if _, end, _ := readPlaces(t, db, roundTripID); end != oldStartLabel {
		t.Fatalf("round trip end_place = %q, want untouched %q", end, oldStartLabel)
	}

	again, err := tracker.RepairDuplicateEndAddresses(bg, false)
	if err != nil {
		t.Fatalf("second apply: %v", err)
	}
	if again.Scanned != 0 || len(again.Changed) != 0 {
		t.Fatalf("second apply = %+v, want no-op (idempotent)", again)
	}
}

// TestRepairDuplicateEndAddresses_FailedLookupLeavesDrive_DB pins that a
// failed end lookup neither copies the start address nor strands the
// drive: the stored label is left unchanged for a later pass.
func TestRepairDuplicateEndAddresses_FailedLookupLeavesDrive_DB(t *testing.T) {
	geo := &stubGeocoder{err: context.DeadlineExceeded}
	tracker, db, vehicleID := newRepairTracker(t, geo)

	bg := context.Background()
	var id int64
	err := db.Pool.QueryRow(bg,
		`INSERT INTO drives (vehicle_id, started_at, ended_at, start_place, end_place,
		                     start_lat, start_lng, end_lat, end_lng, place_label_version)
		 VALUES ($1, now(), now(), $2, $2, $3, $4, $5, $6, 3) RETURNING id`,
		vehicleID, oldStartLabel, repairStartLat, repairStartLon, repairEndLat, repairEndLon).Scan(&id)
	if err != nil {
		t.Fatalf("seed drive: %v", err)
	}

	report, err := tracker.RepairDuplicateEndAddresses(bg, false)
	if err != nil {
		t.Fatalf("repair: %v", err)
	}
	if len(report.Changed) != 0 || report.Failed != 1 {
		t.Fatalf("report = %+v, want no changes and one failure", report)
	}
	if _, end, _ := readPlaces(t, db, id); end != oldStartLabel {
		t.Fatalf("end_place = %q after failed lookup, want unchanged %q", end, oldStartLabel)
	}
}
