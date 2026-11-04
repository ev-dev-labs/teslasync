package drive

import (
	"context"
	"testing"
)

// TestFindDuplicateEndAddresses_DB pins the repair finder contract against
// a live database (skipped without a test DSN): only drives whose end
// label equals the start label while the endpoints are far apart are
// selected — different labels, genuine round trips, and missing labels
// or coordinates are not.
func TestFindDuplicateEndAddresses_DB(t *testing.T) {
	db := openRepairTestDB(t, repairDSNOrSkip(t))
	vehicleID := seedRepairFixture(t, db)
	repo := NewDriveRepo(db)
	bg := context.Background()

	insert := func(startPlace, endPlace *string, endLat, endLon *float64) int64 {
		t.Helper()
		var id int64
		err := db.Pool.QueryRow(bg,
			`INSERT INTO drives (vehicle_id, started_at, start_place, end_place,
			                     start_lat, start_lng, end_lat, end_lng, place_label_version)
			 VALUES ($1, now(), $2, $3, 47.8060, -122.2050, $4, $5, 3) RETURNING id`,
			vehicleID, startPlace, endPlace, endLat, endLon).Scan(&id)
		if err != nil {
			t.Fatalf("seed drive: %v", err)
		}
		return id
	}
	str := func(s string) *string { return &s }
	f64 := func(v float64) *float64 { return &v }

	suspect := insert(str("19720 Bothell Everett Highway, Bothell"), str("19720 Bothell Everett Highway, Bothell"), f64(47.6740), f64(-122.1215))
	_ = insert(str("19720 Bothell Everett Highway, Bothell"), str("1 Microsoft Way, Redmond"), f64(47.6740), f64(-122.1215))
	_ = insert(str("19720 Bothell Everett Highway, Bothell"), str("19720 Bothell Everett Highway, Bothell"), f64(47.8061), f64(-122.2050))
	_ = insert(str("19720 Bothell Everett Highway, Bothell"), nil, f64(47.6740), f64(-122.1215))

	found, err := repo.FindDuplicateEndAddresses(bg, 100)
	if err != nil {
		t.Fatalf("FindDuplicateEndAddresses: %v", err)
	}
	var ids []int64
	for _, d := range found {
		if d.VehicleID == vehicleID {
			ids = append(ids, d.ID)
		}
	}
	if len(ids) != 1 || ids[0] != suspect {
		t.Fatalf("found drive ids = %v, want only suspect drive %d", ids, suspect)
	}

	// GetByID must not surface the start address as the destination.
	d, err := repo.GetByID(bg, suspect)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if d.EndAddress != nil {
		t.Errorf("GetByID EndAddress = %v, want nil (suppressed duplicate)", *d.EndAddress)
	}
	if d.StartAddress == nil || *d.StartAddress != "19720 Bothell Everett Highway, Bothell" {
		t.Errorf("GetByID StartAddress = %v, want unchanged", d.StartAddress)
	}
}
