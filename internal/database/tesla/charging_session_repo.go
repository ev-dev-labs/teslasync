package tesla

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

// TeslaChargingSessionRepo provides data access for Tesla fleet charging sessions (business accounts).
type TeslaChargingSessionRepo struct {
	pool teslaPool
}

func NewTeslaChargingSessionRepo(db *database.DB) *TeslaChargingSessionRepo {
	return &TeslaChargingSessionRepo{pool: db.Pool}
}

// GetAll returns paginated fleet charging sessions, optionally filtered by VIN.
func (r *TeslaChargingSessionRepo) GetAll(ctx context.Context, vin string, limit, offset int) ([]*teslamodel.TeslaChargingSession, error) {
	query := `SELECT id, session_id, vin, charger_id, site_location_name,
		charge_start_datetime, charge_stop_datetime,
		energy_added_kwh, peak_power_kw, max_charge_rate_kw, charge_duration_s,
		charger_type, currency_code, total_cost, per_kwh_rate, idle_fee, congestion_fee,
		latitude, longitude, fetched_at, created_at
		FROM tesla_charging_sessions`
	args := []interface{}{}
	argIdx := 1

	if vin != "" {
		query += fmt.Sprintf(" WHERE vin = $%d", argIdx)
		args = append(args, vin)
		argIdx++
	}

	query += fmt.Sprintf(" ORDER BY charge_start_datetime DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query tesla charging sessions: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaChargingSession
	for rows.Next() {
		s := &teslamodel.TeslaChargingSession{}
		if err := rows.Scan(
			&s.ID, &s.SessionID, &s.VIN, &s.ChargerID, &s.SiteLocationName,
			&s.ChargeStartDatetime, &s.ChargeStopDatetime,
			&s.EnergyAddedKWh, &s.PeakPowerKW, &s.MaxChargeRateKW, &s.ChargeDurationS,
			&s.ChargerType, &s.CurrencyCode, &s.TotalCost, &s.PerKWhRate, &s.IdleFee, &s.CongestionFee,
			&s.Latitude, &s.Longitude,
			&s.FetchedAt, &s.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tesla charging session: %w", err)
		}
		results = append(results, s)
	}
	return results, rows.Err()
}

// GetBySessionID returns a single charging session by Tesla session ID.
func (r *TeslaChargingSessionRepo) GetBySessionID(ctx context.Context, sessionID int64) (*teslamodel.TeslaChargingSession, error) {
	query := `SELECT id, session_id, vin, charger_id, site_location_name,
		charge_start_datetime, charge_stop_datetime,
		energy_added_kwh, peak_power_kw, max_charge_rate_kw, charge_duration_s,
		charger_type, currency_code, total_cost, per_kwh_rate, idle_fee, congestion_fee,
		latitude, longitude, fetched_at, created_at
		FROM tesla_charging_sessions WHERE session_id = $1`
	s := &teslamodel.TeslaChargingSession{}
	err := r.pool.QueryRow(ctx, query, sessionID).Scan(
		&s.ID, &s.SessionID, &s.VIN, &s.ChargerID, &s.SiteLocationName,
		&s.ChargeStartDatetime, &s.ChargeStopDatetime,
		&s.EnergyAddedKWh, &s.PeakPowerKW, &s.MaxChargeRateKW, &s.ChargeDurationS,
		&s.ChargerType, &s.CurrencyCode, &s.TotalCost, &s.PerKWhRate, &s.IdleFee, &s.CongestionFee,
		&s.Latitude, &s.Longitude,
		&s.FetchedAt, &s.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get tesla charging session by session_id: %w", err)
	}
	return s, nil
}

// GetSummary returns aggregated stats for Tesla fleet charging sessions, optionally filtered by VIN.
func (r *TeslaChargingSessionRepo) GetSummary(ctx context.Context, vin string) (*teslamodel.TeslaChargingSessionSummary, error) {
	query := `SELECT COUNT(*), SUM(energy_added_kwh) * 1000.0, SUM(total_cost),
		CASE WHEN SUM(energy_added_kwh) > 0 THEN SUM(total_cost) / SUM(energy_added_kwh) ELSE NULL END,
		MAX(peak_power_kw)
		FROM tesla_charging_sessions`
	args := []interface{}{}
	if vin != "" {
		query += " WHERE vin = $1"
		args = append(args, vin)
	}

	s := &teslamodel.TeslaChargingSessionSummary{}
	err := r.pool.QueryRow(ctx, query, args...).Scan(
		&s.TotalSessions, &s.TotalWh, &s.TotalCost, &s.AvgCostPerKWh, &s.PeakPowerKW,
	)
	if err != nil {
		return nil, fmt.Errorf("get tesla charging session summary: %w", err)
	}
	return s, nil
}

// UpsertBatch inserts or updates charging sessions by session_id.
func (r *TeslaChargingSessionRepo) UpsertBatch(ctx context.Context, sessions []*teslamodel.TeslaChargingSession) (int, error) {
	if len(sessions) == 0 {
		return 0, nil
	}

	query := `INSERT INTO tesla_charging_sessions (
		session_id, vin, charger_id, site_location_name,
		charge_start_datetime, charge_stop_datetime,
		energy_added_kwh, peak_power_kw, max_charge_rate_kw, charge_duration_s,
		charger_type, currency_code, total_cost, per_kwh_rate, idle_fee, congestion_fee,
		latitude, longitude, fetched_at
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
	ON CONFLICT (session_id) DO UPDATE SET
		vin = EXCLUDED.vin,
		charger_id = EXCLUDED.charger_id,
		site_location_name = EXCLUDED.site_location_name,
		charge_start_datetime = EXCLUDED.charge_start_datetime,
		charge_stop_datetime = EXCLUDED.charge_stop_datetime,
		energy_added_kwh = EXCLUDED.energy_added_kwh,
		peak_power_kw = EXCLUDED.peak_power_kw,
		max_charge_rate_kw = EXCLUDED.max_charge_rate_kw,
		charge_duration_s = EXCLUDED.charge_duration_s,
		charger_type = EXCLUDED.charger_type,
		currency_code = EXCLUDED.currency_code,
		total_cost = EXCLUDED.total_cost,
		per_kwh_rate = EXCLUDED.per_kwh_rate,
		idle_fee = EXCLUDED.idle_fee,
		congestion_fee = EXCLUDED.congestion_fee,
		latitude = EXCLUDED.latitude,
		longitude = EXCLUDED.longitude,
		fetched_at = EXCLUDED.fetched_at`

	now := time.Now().UTC()
	upserted := 0
	for i, s := range sessions {
		if s == nil {
			return upserted, fmt.Errorf("upsert tesla charging session: nil entry at index %d", i)
		}
		_, err := r.pool.Exec(ctx, query,
			s.SessionID, s.VIN, s.ChargerID, s.SiteLocationName,
			s.ChargeStartDatetime, s.ChargeStopDatetime,
			s.EnergyAddedKWh, s.PeakPowerKW, s.MaxChargeRateKW, s.ChargeDurationS,
			s.ChargerType, s.CurrencyCode, s.TotalCost, s.PerKWhRate, s.IdleFee, s.CongestionFee,
			s.Latitude, s.Longitude,
			now,
		)
		if err != nil {
			return upserted, fmt.Errorf("upsert tesla charging session %d: %w", s.SessionID, err)
		}
		upserted++
	}
	return upserted, nil
}
