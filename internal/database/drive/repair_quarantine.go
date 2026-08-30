package drive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/database/repairsnapshot"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// The snapshot deliberately excludes drive_telemetry and share_tokens. Their
// drive_id columns have no current FK (000185), so a hard delete retains them
// and restoring them would duplicate records rather than recover cascaded data.
const snapshotDriveForQuarantineSQL = `
	WITH locked_drive AS (
		SELECT *
		FROM drives
		WHERE id = $1
		FOR UPDATE
	),
	locked_trip_drives AS (
		SELECT td.*
		FROM trip_drives td
		JOIN locked_drive d ON d.id = td.drive_id
		FOR UPDATE OF td
	),
	locked_driver_assignments AS (
		SELECT a.*
		FROM drive_driver_assignments a
		JOIN locked_drive d ON d.id = a.drive_id
		FOR UPDATE OF a
	)
	SELECT jsonb_build_object(
		'schema_version', 1,
		'drive', to_jsonb(d),
		'trip_drives', COALESCE((
			SELECT jsonb_agg(to_jsonb(td) ORDER BY td.trip_id)
			FROM locked_trip_drives td
		), '[]'::jsonb),
		'driver_assignments', COALESCE((
			SELECT jsonb_agg(to_jsonb(a) ORDER BY a.subject)
			FROM locked_driver_assignments a
		), '[]'::jsonb)
	)
	FROM locked_drive d`

// SnapshotForQuarantineWithTx locks a drive and captures its opaque v1
// quarantine payload. The caller must pass the same transaction to
// DeleteWithTx so the snapshot, quarantine record, delete, and audit row share
// one commit boundary.
func (r *DriveRepo) SnapshotForQuarantineWithTx(
	ctx context.Context,
	tx database.DBTX,
	id int64,
) (json.RawMessage, error) {
	if tx == nil {
		return nil, repairsnapshot.ErrTransactionRequired
	}

	var payload []byte
	if err := tx.QueryRow(ctx, snapshotDriveForQuarantineSQL, id).Scan(&payload); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("snapshot drive %d: %w", id, repairsnapshot.ErrNotFound)
		}
		return nil, fmt.Errorf("snapshot drive %d: %w", id, err)
	}
	canonical, err := repairsnapshot.Canonicalize(payload)
	if err != nil {
		return nil, fmt.Errorf("snapshot drive %d: %w", id, err)
	}
	if _, _, _, err := parseDriveQuarantineSnapshot(canonical); err != nil {
		return nil, fmt.Errorf("snapshot drive %d schema validation: %w", id, err)
	}
	return canonical, nil
}

// driveSnapshotRow mirrors every current drives column. In particular,
// place_label_version is from 000226 and the endpoint geofence ids are from
// 000228; omitting either would make restore lossy.
type driveSnapshotRow struct {
	ID                int64                   `json:"id"`
	VehicleID         int64                   `json:"vehicle_id"`
	StartedAt         time.Time               `json:"started_at"`
	EndedAt           *time.Time              `json:"ended_at"`
	StartLat          *repairsnapshot.Float64 `json:"start_lat"`
	StartLng          *repairsnapshot.Float64 `json:"start_lng"`
	EndLat            *repairsnapshot.Float64 `json:"end_lat"`
	EndLng            *repairsnapshot.Float64 `json:"end_lng"`
	StartPlace        *string                 `json:"start_place"`
	EndPlace          *string                 `json:"end_place"`
	StartOdometerM    *repairsnapshot.Float64 `json:"start_odometer_m"`
	EndOdometerM      *repairsnapshot.Float64 `json:"end_odometer_m"`
	DistanceM         *repairsnapshot.Float64 `json:"distance_m"`
	DurationS         *int64                  `json:"duration_s"`
	StartSocPct       *repairsnapshot.Float64 `json:"start_soc_pct"`
	EndSocPct         *repairsnapshot.Float64 `json:"end_soc_pct"`
	EnergyUsedWh      *repairsnapshot.Float64 `json:"energy_used_wh"`
	RegenEnergyWh     *repairsnapshot.Float64 `json:"regen_energy_wh"`
	AvgSpeedMps       *repairsnapshot.Float64 `json:"avg_speed_mps"`
	MaxSpeedMps       *repairsnapshot.Float64 `json:"max_speed_mps"`
	AvgPowerW         *repairsnapshot.Float64 `json:"avg_power_w"`
	PeakPowerW        *repairsnapshot.Float64 `json:"peak_power_w"`
	AmbientTempCAvg   *repairsnapshot.Float64 `json:"ambient_temp_c_avg"`
	PlaceLabelVersion int16                   `json:"place_label_version"`
	StartGeofenceID   *int64                  `json:"start_geofence_id"`
	EndGeofenceID     *int64                  `json:"end_geofence_id"`
}

type tripDriveSnapshotRow struct {
	TripID   int64 `json:"trip_id"`
	DriveID  int64 `json:"drive_id"`
	Position int   `json:"position"`
}

type driveAssignmentSnapshotRow struct {
	DriveID         int64     `json:"drive_id"`
	Subject         string    `json:"subject"`
	DriverProfileID int64     `json:"driver_profile_id"`
	Source          string    `json:"source"`
	ConfidencePct   float32   `json:"confidence_pct"`
	AssignedAt      time.Time `json:"assigned_at"`
}

var driveSnapshotColumns = []string{
	"id", "vehicle_id", "started_at", "ended_at",
	"start_lat", "start_lng", "end_lat", "end_lng", "start_place", "end_place",
	"start_odometer_m", "end_odometer_m", "distance_m", "duration_s",
	"start_soc_pct", "end_soc_pct", "energy_used_wh", "regen_energy_wh",
	"avg_speed_mps", "max_speed_mps", "avg_power_w", "peak_power_w",
	"ambient_temp_c_avg", "place_label_version", "start_geofence_id", "end_geofence_id",
}

// parseDriveQuarantineSnapshot rejects missing, unknown, and null-required
// fields before typed decoding. That prevents a malformed JSON payload from
// becoming a plausible-but-lossy zero-value restore.
func parseDriveQuarantineSnapshot(payload json.RawMessage) (
	driveSnapshotRow,
	[]tripDriveSnapshotRow,
	[]driveAssignmentSnapshotRow,
	error,
) {
	root, err := repairsnapshot.ExactObject(payload,
		[]string{"schema_version", "drive", "trip_drives", "driver_assignments"})
	if err != nil {
		return driveSnapshotRow{}, nil, nil, err
	}
	if err := repairsnapshot.RequireNonNull(root, "schema_version", "drive", "trip_drives", "driver_assignments"); err != nil {
		return driveSnapshotRow{}, nil, nil, err
	}
	var version int
	if err := json.Unmarshal(root["schema_version"], &version); err != nil || version != 1 {
		return driveSnapshotRow{}, nil, nil, fmt.Errorf("%w: unsupported schema_version", repairsnapshot.ErrMalformedPayload)
	}

	driveObject, err := repairsnapshot.ExactObject(root["drive"], driveSnapshotColumns)
	if err != nil {
		return driveSnapshotRow{}, nil, nil, err
	}
	if err := repairsnapshot.RequireNonNull(driveObject, "id", "vehicle_id", "started_at", "place_label_version"); err != nil {
		return driveSnapshotRow{}, nil, nil, err
	}
	var drive driveSnapshotRow
	if err := json.Unmarshal(root["drive"], &drive); err != nil {
		return driveSnapshotRow{}, nil, nil, fmt.Errorf("%w: decode drive: %v", repairsnapshot.ErrMalformedPayload, err)
	}
	if drive.ID <= 0 || drive.VehicleID <= 0 || drive.StartedAt.IsZero() || drive.PlaceLabelVersion < 0 {
		return driveSnapshotRow{}, nil, nil, fmt.Errorf("%w: invalid drive identity", repairsnapshot.ErrMalformedPayload)
	}

	var tripRaw []json.RawMessage
	if err := json.Unmarshal(root["trip_drives"], &tripRaw); err != nil {
		return driveSnapshotRow{}, nil, nil, fmt.Errorf("%w: decode trip_drives: %v", repairsnapshot.ErrMalformedPayload, err)
	}
	trips := make([]tripDriveSnapshotRow, 0, len(tripRaw))
	for _, raw := range tripRaw {
		object, err := repairsnapshot.ExactObject(raw, []string{"trip_id", "drive_id", "position"})
		if err != nil {
			return driveSnapshotRow{}, nil, nil, err
		}
		if err := repairsnapshot.RequireNonNull(object, "trip_id", "drive_id", "position"); err != nil {
			return driveSnapshotRow{}, nil, nil, err
		}
		var membership tripDriveSnapshotRow
		if err := json.Unmarshal(raw, &membership); err != nil ||
			membership.TripID <= 0 || membership.DriveID != drive.ID || membership.Position < 1 {
			return driveSnapshotRow{}, nil, nil, fmt.Errorf("%w: invalid trip_drives row", repairsnapshot.ErrMalformedPayload)
		}
		trips = append(trips, membership)
	}

	var assignmentRaw []json.RawMessage
	if err := json.Unmarshal(root["driver_assignments"], &assignmentRaw); err != nil {
		return driveSnapshotRow{}, nil, nil, fmt.Errorf("%w: decode driver_assignments: %v", repairsnapshot.ErrMalformedPayload, err)
	}
	assignments := make([]driveAssignmentSnapshotRow, 0, len(assignmentRaw))
	for _, raw := range assignmentRaw {
		object, err := repairsnapshot.ExactObject(raw,
			[]string{"drive_id", "subject", "driver_profile_id", "source", "confidence_pct", "assigned_at"})
		if err != nil {
			return driveSnapshotRow{}, nil, nil, err
		}
		if err := repairsnapshot.RequireNonNull(object,
			"drive_id", "subject", "driver_profile_id", "source", "confidence_pct", "assigned_at"); err != nil {
			return driveSnapshotRow{}, nil, nil, err
		}
		var assignment driveAssignmentSnapshotRow
		if err := json.Unmarshal(raw, &assignment); err != nil ||
			assignment.DriveID != drive.ID || assignment.Subject == "" ||
			assignment.DriverProfileID <= 0 || assignment.Source == "" || assignment.AssignedAt.IsZero() {
			return driveSnapshotRow{}, nil, nil, fmt.Errorf("%w: invalid driver_assignments row", repairsnapshot.ErrMalformedPayload)
		}
		assignments = append(assignments, assignment)
	}
	return drive, trips, assignments, nil
}

const restoreDriveParentSQL = `
	INSERT INTO drives (
		id, vehicle_id, started_at, ended_at,
		start_lat, start_lng, end_lat, end_lng, start_place, end_place,
		start_odometer_m, end_odometer_m, distance_m, duration_s,
		start_soc_pct, end_soc_pct, energy_used_wh, regen_energy_wh,
		avg_speed_mps, max_speed_mps, avg_power_w, peak_power_w,
		ambient_temp_c_avg, place_label_version, start_geofence_id, end_geofence_id
	) OVERRIDING SYSTEM VALUE VALUES (
		$1, $2, $3, $4,
		$5, $6, $7, $8, $9, $10,
		$11, $12, $13, $14,
		$15, $16, $17, $18,
		$19, $20, $21, $22,
		$23, $24, $25, $26
	)
	ON CONFLICT (id) DO NOTHING
	RETURNING id`

const restoreTripDriveSQL = `
	INSERT INTO trip_drives (trip_id, drive_id, position)
	VALUES ($1, $2, $3)`

const restoreDriveAssignmentSQL = `
	INSERT INTO drive_driver_assignments (
		drive_id, subject, driver_profile_id, source, confidence_pct, assigned_at
	) VALUES ($1, $2, $3, $4, $5, $6)`

const driveSequenceStateSQL = `SELECT last_value, is_called FROM drives_id_seq`

// advanceDriveSequenceSQL runs only when the restored historical ID is not
// already below the sequence's next value. The rare catch-up path holds SHARE
// ROW EXCLUSIVE on drives so setval cannot race an ordinary INSERT.
const advanceDriveSequenceSQL = `
	SELECT setval(
		pg_get_serial_sequence('drives', 'id'),
		GREATEST($1, (SELECT last_value FROM drives_id_seq)),
		true
	)`

// RestoreSnapshotWithTx restores a v1 opaque drive snapshot through the
// supplied transaction. It never recreates telemetry or share-token rows,
// because those tables retain their unconstrained drive_id values after delete.
func (r *DriveRepo) RestoreSnapshotWithTx(
	ctx context.Context,
	tx database.DBTX,
	payload json.RawMessage,
	expectedChecksum string,
) error {
	if tx == nil {
		return repairsnapshot.ErrTransactionRequired
	}
	if err := repairsnapshot.RequireChecksum(payload, expectedChecksum); err != nil {
		return fmt.Errorf("restore drive snapshot integrity: %w", err)
	}
	drive, trips, assignments, err := parseDriveQuarantineSnapshot(payload)
	if err != nil {
		return err
	}

	advanceSequence, err := prepareDriveSequenceForRestore(ctx, tx, drive.ID)
	if err != nil {
		return err
	}
	var restoredID int64
	err = tx.QueryRow(ctx, restoreDriveParentSQL,
		drive.ID, drive.VehicleID, drive.StartedAt, drive.EndedAt,
		repairsnapshot.Float64Ptr(drive.StartLat), repairsnapshot.Float64Ptr(drive.StartLng),
		repairsnapshot.Float64Ptr(drive.EndLat), repairsnapshot.Float64Ptr(drive.EndLng),
		drive.StartPlace, drive.EndPlace,
		repairsnapshot.Float64Ptr(drive.StartOdometerM), repairsnapshot.Float64Ptr(drive.EndOdometerM),
		repairsnapshot.Float64Ptr(drive.DistanceM), drive.DurationS,
		repairsnapshot.Float64Ptr(drive.StartSocPct), repairsnapshot.Float64Ptr(drive.EndSocPct),
		repairsnapshot.Float64Ptr(drive.EnergyUsedWh), repairsnapshot.Float64Ptr(drive.RegenEnergyWh),
		repairsnapshot.Float64Ptr(drive.AvgSpeedMps), repairsnapshot.Float64Ptr(drive.MaxSpeedMps),
		repairsnapshot.Float64Ptr(drive.AvgPowerW), repairsnapshot.Float64Ptr(drive.PeakPowerW),
		repairsnapshot.Float64Ptr(drive.AmbientTempCAvg),
		drive.PlaceLabelVersion, drive.StartGeofenceID, drive.EndGeofenceID,
	).Scan(&restoredID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("restore drive %d: %w", drive.ID, repairsnapshot.ErrAlreadyExists)
	}
	if err != nil {
		return fmt.Errorf("restore drive %d parent: %w", drive.ID, err)
	}

	for _, trip := range trips {
		if _, err := tx.Exec(ctx, restoreTripDriveSQL, trip.TripID, trip.DriveID, trip.Position); err != nil {
			if isIntegrityConstraintError(err) {
				return fmt.Errorf("restore drive %d trip %d: %w: %v", drive.ID, trip.TripID, repairsnapshot.ErrConflict, err)
			}
			return fmt.Errorf("restore drive %d trip %d: %w", drive.ID, trip.TripID, err)
		}
	}
	for _, assignment := range assignments {
		if _, err := tx.Exec(ctx, restoreDriveAssignmentSQL,
			assignment.DriveID, assignment.Subject, assignment.DriverProfileID,
			assignment.Source, assignment.ConfidencePct, assignment.AssignedAt,
		); err != nil {
			if isIntegrityConstraintError(err) {
				return fmt.Errorf("restore drive %d assignment %q: %w: %v",
					drive.ID, assignment.Subject, repairsnapshot.ErrConflict, err)
			}
			return fmt.Errorf("restore drive %d assignment %q: %w", drive.ID, assignment.Subject, err)
		}
	}
	if advanceSequence {
		if _, err := tx.Exec(ctx, advanceDriveSequenceSQL, drive.ID); err != nil {
			return fmt.Errorf("restore drive %d advance sequence: %w", drive.ID, err)
		}
	}
	return nil
}

func prepareDriveSequenceForRestore(ctx context.Context, tx database.DBTX, id int64) (bool, error) {
	var (
		lastValue int64
		isCalled  bool
	)
	if err := tx.QueryRow(ctx, driveSequenceStateSQL).Scan(&lastValue, &isCalled); err != nil {
		return false, fmt.Errorf("restore drive %d read sequence: %w", id, err)
	}
	if (isCalled && lastValue >= id) || (!isCalled && lastValue > id) {
		return false, nil
	}
	if _, err := tx.Exec(ctx, `LOCK TABLE drives IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return false, fmt.Errorf("restore drive %d lock table: %w", id, err)
	}
	return true, nil
}

func isIntegrityConstraintError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && len(pgErr.Code) >= 2 && pgErr.Code[:2] == "23"
}
