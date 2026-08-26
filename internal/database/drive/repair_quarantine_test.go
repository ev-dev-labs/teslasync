package drive

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database/repairsnapshot"
)

func validDriveQuarantinePayload(t *testing.T) json.RawMessage {
	t.Helper()
	row := make(map[string]any, len(driveSnapshotColumns))
	for _, column := range driveSnapshotColumns {
		row[column] = nil
	}
	row["id"] = int64(7)
	row["vehicle_id"] = int64(3)
	row["started_at"] = time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	row["place_label_version"] = 3
	payload, err := json.Marshal(map[string]any{
		"schema_version":     1,
		"drive":              row,
		"trip_drives":        []any{},
		"driver_assignments": []any{},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return payload
}

func TestParseDriveQuarantineSnapshotAcceptsCurrentSIShape(t *testing.T) {
	t.Parallel()

	drive, trips, assignments, err := parseDriveQuarantineSnapshot(validDriveQuarantinePayload(t))
	if err != nil {
		t.Fatalf("parseDriveQuarantineSnapshot: %v", err)
	}
	if drive.ID != 7 || drive.VehicleID != 3 || drive.PlaceLabelVersion != 3 {
		t.Fatalf("unexpected parsed drive: %+v", drive)
	}
	if len(trips) != 0 || len(assignments) != 0 {
		t.Fatalf("unexpected relationships: trips=%d assignments=%d", len(trips), len(assignments))
	}
}

func TestParseDriveQuarantineSnapshotRejectsMissingCurrentParentColumn(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	if err := json.Unmarshal(validDriveQuarantinePayload(t), &payload); err != nil {
		t.Fatal(err)
	}
	delete(payload["drive"].(map[string]any), "start_geofence_id")
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, err = parseDriveQuarantineSnapshot(raw)
	if !errors.Is(err, repairsnapshot.ErrMalformedPayload) {
		t.Fatalf("error = %v, want malformed payload", err)
	}
}

func TestParseDriveQuarantineSnapshotPreservesPostgresSpecialFloat(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	if err := json.Unmarshal(validDriveQuarantinePayload(t), &payload); err != nil {
		t.Fatal(err)
	}
	payload["drive"].(map[string]any)["avg_power_w"] = "NaN"
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	drive, _, _, err := parseDriveQuarantineSnapshot(raw)
	if err != nil {
		t.Fatalf("parse special float snapshot: %v", err)
	}
	if drive.AvgPowerW == nil || !math.IsNaN(float64(*drive.AvgPowerW)) {
		t.Fatalf("avg_power_w = %v, want NaN", drive.AvgPowerW)
	}
}

func TestDriveSnapshotAndRestoreSQLShape(t *testing.T) {
	t.Parallel()

	for _, required := range []string{
		"FROM drives",
		"FOR UPDATE",
		"FROM trip_drives td",
		"FROM drive_driver_assignments a",
		"FOR UPDATE OF td",
		"FOR UPDATE OF a",
		"'schema_version', 1",
	} {
		if !strings.Contains(snapshotDriveForQuarantineSQL, required) {
			t.Errorf("snapshot SQL missing %q", required)
		}
	}
	for _, required := range []string{
		"OVERRIDING SYSTEM VALUE",
		"peak_power_w",
		"place_label_version",
		"start_geofence_id",
		"end_geofence_id",
		"ON CONFLICT (id) DO NOTHING",
	} {
		if !strings.Contains(restoreDriveParentSQL, required) {
			t.Errorf("restore SQL missing %q", required)
		}
	}
	for _, required := range []string{
		"last_value, is_called",
	} {
		if !strings.Contains(driveSequenceStateSQL, required) {
			t.Errorf("sequence state SQL missing %q", required)
		}
	}
	for _, required := range []string{
		"pg_get_serial_sequence('drives', 'id')",
		"GREATEST($1, (SELECT last_value FROM drives_id_seq))",
	} {
		if !strings.Contains(advanceDriveSequenceSQL, required) {
			t.Errorf("sequence SQL missing %q", required)
		}
	}
}
