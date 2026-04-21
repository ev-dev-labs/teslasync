package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// chargingTelemetryCoreCols are the fields stored as dedicated SQL columns
// on the charging_telemetry table. All other charging-related signals live
// in the `signals` JSONB column, where Tesla can add/remove fields without
// requiring a schema migration. See migrations/000142..000144.
var chargingTelemetryCoreCols = []string{
	"battery_level",
	"charge_state",
	"charger_voltage",
	"charge_rate_mph",
	"dc_charging_power",
	"time_to_full_charge",
}

type ChargingTelemetryRepo struct {
	db *DB
}

func NewChargingTelemetryRepo(db *DB) *ChargingTelemetryRepo {
	return &ChargingTelemetryRepo{db: db}
}

func (r *ChargingTelemetryRepo) Insert(ctx context.Context, snap *models.ChargingTelemetry) error {
	signalsJSON, err := marshalSignals(snap, chargingTelemetryCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO charging_telemetry
		(vehicle_id, battery_level, charge_state, charger_voltage, charge_rate_mph,
		 dc_charging_power, time_to_full_charge, signals)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.BatteryLevel, snap.ChargeState, snap.ChargerVoltage,
		snap.ChargeRateMph, snap.DCChargingPower, snap.TimeToFullCharge, signalsJSON,
	).Scan(&snap.ID)
}

func (r *ChargingTelemetryRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.ChargingTelemetry, error) {
	query := `SELECT id, vehicle_id, battery_level, charge_state, charger_voltage,
			charge_rate_mph, dc_charging_power, time_to_full_charge, signals, created_at
		FROM charging_telemetry WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.ChargingTelemetry
	for rows.Next() {
		s := &models.ChargingTelemetry{}
		var signalsRaw []byte
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.BatteryLevel, &s.ChargeState,
			&s.ChargerVoltage, &s.ChargeRateMph, &s.DCChargingPower, &s.TimeToFullCharge,
			&signalsRaw, &s.CreatedAt); err != nil {
			return nil, err
		}
		if err := hydrateFromSignals(signalsRaw, s); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *ChargingTelemetryRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.ChargingTelemetry, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}

// GetLatestMerged returns a composite of the most recent charging telemetry
// by merging the last N records. The vehicle sends different signals in
// different batches, so the latest single record may be sparse. This fills
// in nil fields from older records within the lookback window.
func (r *ChargingTelemetryRepo) GetLatestMerged(ctx context.Context, vehicleID int64, lookback int) (*models.ChargingTelemetry, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, lookback)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	merged := *snaps[0] // start with the newest
	for _, s := range snaps[1:] {
		if merged.BatteryLevel == nil && s.BatteryLevel != nil { merged.BatteryLevel = s.BatteryLevel }
		if merged.Soc == nil && s.Soc != nil { merged.Soc = s.Soc }
		if merged.ChargeState == nil && s.ChargeState != nil { merged.ChargeState = s.ChargeState }
		if merged.ChargeAmps == nil && s.ChargeAmps != nil { merged.ChargeAmps = s.ChargeAmps }
		if merged.ChargerVoltage == nil && s.ChargerVoltage != nil { merged.ChargerVoltage = s.ChargerVoltage }
		if merged.ChargeRateMph == nil && s.ChargeRateMph != nil { merged.ChargeRateMph = s.ChargeRateMph }
		if merged.DCChargingPower == nil && s.DCChargingPower != nil { merged.DCChargingPower = s.DCChargingPower }
		if merged.ACChargingPower == nil && s.ACChargingPower != nil { merged.ACChargingPower = s.ACChargingPower }
		if merged.EstBatteryRange == nil && s.EstBatteryRange != nil { merged.EstBatteryRange = s.EstBatteryRange }
		if merged.IdealBatteryRange == nil && s.IdealBatteryRange != nil { merged.IdealBatteryRange = s.IdealBatteryRange }
		if merged.RatedRange == nil && s.RatedRange != nil { merged.RatedRange = s.RatedRange }
		if merged.TimeToFullCharge == nil && s.TimeToFullCharge != nil { merged.TimeToFullCharge = s.TimeToFullCharge }
		if merged.PackVoltage == nil && s.PackVoltage != nil { merged.PackVoltage = s.PackVoltage }
		if merged.PackCurrent == nil && s.PackCurrent != nil { merged.PackCurrent = s.PackCurrent }
		if merged.ChargeLimitSoc == nil && s.ChargeLimitSoc != nil { merged.ChargeLimitSoc = s.ChargeLimitSoc }
	}
	return &merged, nil
}
