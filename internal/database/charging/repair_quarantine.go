package charging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/database/repairsnapshot"
	"github.com/jackc/pgx/v5"
)

// charging_telemetry.session_id intentionally has no FK (000184), and
// geofence_id/rate_id intentionally have no FK (000228). Therefore deleting a
// charging session has no cascading children to capture or restore.
const snapshotChargingForQuarantineSQL = `
	SELECT jsonb_build_object(
		'schema_version', 1,
		'charging_session', to_jsonb(c)
	)
	FROM charging_sessions c
	WHERE c.id = $1
	FOR UPDATE`

// SnapshotForQuarantineWithTx locks a charging session and returns its
// canonical opaque v1 quarantine payload. Use it in the same transaction as
// the quarantine record and DeleteWithTx.
func (r *ChargingRepo) SnapshotForQuarantineWithTx(
	ctx context.Context,
	tx database.DBTX,
	id int64,
) (json.RawMessage, error) {
	if tx == nil {
		return nil, repairsnapshot.ErrTransactionRequired
	}
	var payload []byte
	if err := tx.QueryRow(ctx, snapshotChargingForQuarantineSQL, id).Scan(&payload); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("snapshot charging session %d: %w", id, repairsnapshot.ErrNotFound)
		}
		return nil, fmt.Errorf("snapshot charging session %d: %w", id, err)
	}
	canonical, err := repairsnapshot.Canonicalize(payload)
	if err != nil {
		return nil, fmt.Errorf("snapshot charging session %d: %w", id, err)
	}
	if _, err := parseChargingQuarantineSnapshot(canonical); err != nil {
		return nil, fmt.Errorf("snapshot charging session %d schema validation: %w", id, err)
	}
	return canonical, nil
}

// chargingSnapshotRow mirrors every current charging_sessions column. The
// geofence/rate/cost_source fields are mandatory in v1 because 000228 added
// them to the parent row after the SI-table migration.
type chargingSnapshotRow struct {
	ID                 int64                   `json:"id"`
	VehicleID          int64                   `json:"vehicle_id"`
	StartedAt          time.Time               `json:"started_at"`
	EndedAt            *time.Time              `json:"ended_at"`
	StartSocPct        *repairsnapshot.Float64 `json:"start_soc_pct"`
	EndSocPct          *repairsnapshot.Float64 `json:"end_soc_pct"`
	DeltaSocPct        *repairsnapshot.Float64 `json:"delta_soc_pct"`
	StartOdometerM     *repairsnapshot.Float64 `json:"start_odometer_m"`
	EndOdometerM       *repairsnapshot.Float64 `json:"end_odometer_m"`
	StartLat           *repairsnapshot.Float64 `json:"start_lat"`
	StartLng           *repairsnapshot.Float64 `json:"start_lng"`
	StartPlace         *string                 `json:"start_place"`
	TotalEnergyAddedWh *repairsnapshot.Float64 `json:"total_energy_added_wh"`
	PeakPowerW         *repairsnapshot.Float64 `json:"peak_power_w"`
	AvgPowerW          *repairsnapshot.Float64 `json:"avg_power_w"`
	CostDecimal        *json.Number            `json:"cost_decimal"`
	CostCurrency       *string                 `json:"cost_currency"`
	ChargerType        *string                 `json:"charger_type"`
	CableType          *string                 `json:"cable_type"`
	GeofenceID         *int64                  `json:"geofence_id"`
	RateID             *int64                  `json:"rate_id"`
	CostSource         *string                 `json:"cost_source"`
}

var chargingSnapshotColumns = []string{
	"id", "vehicle_id", "started_at", "ended_at",
	"start_soc_pct", "end_soc_pct", "delta_soc_pct",
	"start_odometer_m", "end_odometer_m", "start_lat", "start_lng", "start_place",
	"total_energy_added_wh", "peak_power_w", "avg_power_w", "cost_decimal", "cost_currency",
	"charger_type", "cable_type", "geofence_id", "rate_id", "cost_source",
}

func parseChargingQuarantineSnapshot(payload json.RawMessage) (chargingSnapshotRow, error) {
	root, err := repairsnapshot.ExactObject(payload, []string{"schema_version", "charging_session"})
	if err != nil {
		return chargingSnapshotRow{}, err
	}
	if err := repairsnapshot.RequireNonNull(root, "schema_version", "charging_session"); err != nil {
		return chargingSnapshotRow{}, err
	}
	var version int
	if err := json.Unmarshal(root["schema_version"], &version); err != nil || version != 1 {
		return chargingSnapshotRow{}, fmt.Errorf("%w: unsupported schema_version", repairsnapshot.ErrMalformedPayload)
	}
	sessionObject, err := repairsnapshot.ExactObject(root["charging_session"], chargingSnapshotColumns)
	if err != nil {
		return chargingSnapshotRow{}, err
	}
	if err := repairsnapshot.RequireNonNull(sessionObject, "id", "vehicle_id", "started_at"); err != nil {
		return chargingSnapshotRow{}, err
	}
	var session chargingSnapshotRow
	if err := json.Unmarshal(root["charging_session"], &session); err != nil {
		return chargingSnapshotRow{}, fmt.Errorf("%w: decode charging session: %v", repairsnapshot.ErrMalformedPayload, err)
	}
	if session.ID <= 0 || session.VehicleID <= 0 || session.StartedAt.IsZero() {
		return chargingSnapshotRow{}, fmt.Errorf("%w: invalid charging session identity", repairsnapshot.ErrMalformedPayload)
	}
	if session.CostDecimal != nil {
		if _, err := session.CostDecimal.Float64(); err != nil {
			return chargingSnapshotRow{}, fmt.Errorf("%w: invalid cost_decimal", repairsnapshot.ErrMalformedPayload)
		}
	}
	return session, nil
}

const restoreChargingParentSQL = `
	INSERT INTO charging_sessions (
		id, vehicle_id, started_at, ended_at,
		start_soc_pct, end_soc_pct, delta_soc_pct,
		start_odometer_m, end_odometer_m, start_lat, start_lng, start_place,
		total_energy_added_wh, peak_power_w, avg_power_w, cost_decimal, cost_currency,
		charger_type, cable_type, geofence_id, rate_id, cost_source
	) OVERRIDING SYSTEM VALUE VALUES (
		$1, $2, $3, $4,
		$5, $6, $7,
		$8, $9, $10, $11, $12,
		$13, $14, $15, $16, $17,
		$18, $19, $20, $21, $22
	)
	ON CONFLICT (id) DO NOTHING
	RETURNING id`

const chargingSequenceStateSQL = `SELECT last_value, is_called FROM charging_sessions_id_seq`

// See the equivalent drive sequence query for the conditional locking
// rationale.
const advanceChargingSequenceSQL = `
	SELECT setval(
		pg_get_serial_sequence('charging_sessions', 'id'),
		GREATEST($1, (SELECT last_value FROM charging_sessions_id_seq)),
		true
	)`

// RestoreSnapshotWithTx restores a v1 charging-session snapshot through the
// supplied transaction. No telemetry is restored because its session_id is an
// unconstrained retained reference, not a cascading relationship.
func (r *ChargingRepo) RestoreSnapshotWithTx(
	ctx context.Context,
	tx database.DBTX,
	payload json.RawMessage,
	expectedChecksum string,
) error {
	if tx == nil {
		return repairsnapshot.ErrTransactionRequired
	}
	if err := repairsnapshot.RequireChecksum(payload, expectedChecksum); err != nil {
		return fmt.Errorf("restore charging snapshot integrity: %w", err)
	}
	session, err := parseChargingQuarantineSnapshot(payload)
	if err != nil {
		return err
	}
	advanceSequence, err := prepareChargingSequenceForRestore(ctx, tx, session.ID)
	if err != nil {
		return err
	}
	var restoredID int64
	var costDecimal any
	if session.CostDecimal != nil {
		costDecimal = session.CostDecimal.String()
	}
	err = tx.QueryRow(ctx, restoreChargingParentSQL,
		session.ID, session.VehicleID, session.StartedAt, session.EndedAt,
		repairsnapshot.Float64Ptr(session.StartSocPct), repairsnapshot.Float64Ptr(session.EndSocPct),
		repairsnapshot.Float64Ptr(session.DeltaSocPct),
		repairsnapshot.Float64Ptr(session.StartOdometerM), repairsnapshot.Float64Ptr(session.EndOdometerM),
		repairsnapshot.Float64Ptr(session.StartLat), repairsnapshot.Float64Ptr(session.StartLng), session.StartPlace,
		repairsnapshot.Float64Ptr(session.TotalEnergyAddedWh), repairsnapshot.Float64Ptr(session.PeakPowerW),
		repairsnapshot.Float64Ptr(session.AvgPowerW), costDecimal, session.CostCurrency,
		session.ChargerType, session.CableType, session.GeofenceID, session.RateID, session.CostSource,
	).Scan(&restoredID)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("restore charging session %d: %w", session.ID, repairsnapshot.ErrAlreadyExists)
	}
	if err != nil {
		return fmt.Errorf("restore charging session %d parent: %w", session.ID, err)
	}
	if advanceSequence {
		if _, err := tx.Exec(ctx, advanceChargingSequenceSQL, session.ID); err != nil {
			return fmt.Errorf("restore charging session %d advance sequence: %w", session.ID, err)
		}
	}
	return nil
}

func prepareChargingSequenceForRestore(ctx context.Context, tx database.DBTX, id int64) (bool, error) {
	var (
		lastValue int64
		isCalled  bool
	)
	if err := tx.QueryRow(ctx, chargingSequenceStateSQL).Scan(&lastValue, &isCalled); err != nil {
		return false, fmt.Errorf("restore charging session %d read sequence: %w", id, err)
	}
	if (isCalled && lastValue >= id) || (!isCalled && lastValue > id) {
		return false, nil
	}
	if _, err := tx.Exec(ctx, `LOCK TABLE charging_sessions IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return false, fmt.Errorf("restore charging session %d lock table: %w", id, err)
	}
	return true, nil
}
