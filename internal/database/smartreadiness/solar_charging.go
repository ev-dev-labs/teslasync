package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.SolarChargingRepository = (*Repository)(nil)

const activeSolarChargingPlan = `
	FROM smart_solar_charging_plans p
	JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
	JOIN geofences g ON g.id = p.place_id AND g.enabled AND NOT g.needs_review
	  AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at = p.place_updated_at
	JOIN smart_solar_energy_connections c ON c.subject = p.subject AND c.energy_site_id = p.energy_site_id AND c.state_hash IS NULL`

func (r *Repository) SaveSolarChargingPlan(ctx context.Context, plan domain.SolarChargingPlan) error {
	err := pgx.BeginFunc(ctx, r.db.Pool, func(tx pgx.Tx) error {
		var id int64
		err := tx.QueryRow(ctx, `
		  INSERT INTO smart_solar_charging_plans AS p
		    (subject, vehicle_id, energy_site_id, place_id, place_updated_at, consented_at, next_check_at)
		  SELECT $1, v.id, c.energy_site_id, g.id, g.updated_at, $6, $6
		  FROM vehicles v JOIN geofences g ON g.id = $3
		  JOIN smart_solar_energy_connections c ON c.subject = $1 AND c.energy_site_id = $4 AND c.state_hash IS NULL
		  WHERE v.id = $2 AND v.archived_at IS NULL AND g.enabled AND NOT g.needs_review
		    AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at = $5
		  ON CONFLICT (subject, vehicle_id) DO UPDATE SET
		    energy_site_id = EXCLUDED.energy_site_id, place_id = EXCLUDED.place_id, place_updated_at = EXCLUDED.place_updated_at,
		    consented_at = EXCLUDED.consented_at, next_check_at = EXCLUDED.next_check_at, reserve_pct = NULL, reserve_read_at = NULL
		  WHERE p.consented_at < EXCLUDED.consented_at
		  RETURNING p.id`, plan.Subject, plan.VehicleID, plan.PlaceID, plan.EnergySiteID,
			plan.PlaceUpdatedAt, plan.ConsentedAt).Scan(&id)
		if err != nil {
			return err
		}
		// Take a fresh snapshot after locking the plan so an in-flight writer cannot leave old samples behind.
		_, err = tx.Exec(ctx, `DELETE FROM smart_solar_charging_samples WHERE plan_id = $1 AND consented_at <> $2`,
			id, plan.ConsentedAt)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return port.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("save solar charging consent: %w", err)
	}
	return nil
}

func (r *Repository) DeleteSolarChargingPlan(ctx context.Context, subject string, vehicleID int64) error {
	if _, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_solar_charging_plans WHERE subject = $1 AND vehicle_id = $2`, subject, vehicleID); err != nil {
		return fmt.Errorf("remove solar charging consent and samples: %w", err)
	}
	return nil
}

const solarPlanColumns = `p.id, p.subject, p.vehicle_id, p.energy_site_id, p.place_id, p.place_updated_at,
	p.consented_at, p.next_check_at, p.reserve_pct, p.reserve_read_at,
	smart_feature_current(p.subject,'solar_charging',p.feature_claimed_at),
	smart_feature_current(p.subject,'solar_charging',p.reserve_read_at)`

func scanSolarPlan(row pgx.Row) (domain.SolarChargingPlan, error) {
	var plan domain.SolarChargingPlan
	var percent *float64
	var observedAt *time.Time
	var reserveCurrent bool
	err := row.Scan(&plan.ID, &plan.Subject, &plan.VehicleID, &plan.EnergySiteID, &plan.PlaceID, &plan.PlaceUpdatedAt,
		&plan.ConsentedAt, &plan.NextCheckAt, &percent, &observedAt, &plan.ClaimCurrent, &reserveCurrent)
	if reserveCurrent && percent != nil && observedAt != nil {
		plan.Reserve = &domain.SolarBackupReserve{SiteID: plan.EnergySiteID, Percent: *percent, ObservedAt: *observedAt}
	}
	return plan, err
}

func (r *Repository) FindSolarChargingPlan(ctx context.Context, subject string, vehicleID int64) (*domain.SolarChargingPlan, error) {
	plan, err := scanSolarPlan(r.db.Pool.QueryRow(ctx, `SELECT `+solarPlanColumns+activeSolarChargingPlan+`
		WHERE p.subject = $1 AND p.vehicle_id = $2`, subject, vehicleID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read authorized solar charging consent: %w", err)
	}
	return &plan, nil
}

func (r *Repository) ListSolarChargingScopes(ctx context.Context, subject string, vehicleID *int64, now time.Time,
	limit int,
) ([]domain.SolarChargingScope, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.id, p.vehicle_id, v.display_name, p.consented_at `+activeSolarChargingPlan+`
		WHERE p.subject = $1 AND ($2::bigint IS NULL OR p.vehicle_id = $2) AND p.reserve_read_at IS NOT NULL
		  AND smart_feature_current(p.subject,'solar_charging',p.reserve_read_at)
		  AND EXISTS (SELECT 1 FROM smart_solar_charging_samples o
		    WHERE o.plan_id = p.id AND o.consented_at = p.consented_at
		      AND o.observed_at > $3 AND o.observed_at <= $4)
		ORDER BY p.next_check_at DESC, p.id LIMIT $5`, subject, vehicleID, now.Add(-90*time.Second), now, limit)
	if err != nil {
		return nil, fmt.Errorf("list current solar charging scopes: %w", err)
	}
	scopes, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.SolarChargingScope, error) {
		var scope domain.SolarChargingScope
		err := row.Scan(&scope.PlanID, &scope.VehicleID, &scope.VehicleName, &scope.ConsentedAt)
		return scope, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan current solar charging scopes: %w", err)
	}
	return scopes, nil
}

func (r *Repository) ClaimDueSolarChargingPlans(ctx context.Context, now, next time.Time,
	limit int, sharedOpenMode bool,
) ([]domain.SolarChargingPlan, error) {
	rows, err := r.db.Pool.Query(ctx, `
		WITH due AS (
		  SELECT p.id `+activeSolarChargingPlan+`
		  WHERE p.next_check_at <= $1 AND p.consented_at <= $1 AND (p.subject = $4) = $5
		    AND smart_feature_allowed(p.subject,'solar_charging')
		  ORDER BY p.next_check_at, p.id
		  LIMIT $3 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_solar_charging_plans p SET next_check_at=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id = due.id
		RETURNING `+solarPlanColumns, now, next, limit, personal.OpenSubject, sharedOpenMode)
	if err != nil {
		return nil, fmt.Errorf("claim due solar charging checks: %w", err)
	}
	plans, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.SolarChargingPlan, error) {
		return scanSolarPlan(row)
	})
	if err != nil {
		return nil, fmt.Errorf("scan due solar charging checks: %w", err)
	}
	return plans, nil
}

func (r *Repository) SaveSolarChargingObservation(ctx context.Context, plan domain.SolarChargingPlan,
	reserve *domain.SolarBackupReserve, sample domain.SolarSurplusObservation, now time.Time,
) error {
	if sample.SiteID != plan.EnergySiteID || sample.ObservedAt.Before(plan.ConsentedAt) || sample.ObservedAt.After(now) ||
		(reserve != nil && (reserve.SiteID != plan.EnergySiteID || reserve.ObservedAt.Before(plan.ConsentedAt) || reserve.ObservedAt.After(now))) {
		return port.ErrClaimLost
	}
	var reservePct, reserveAt any
	if reserve != nil {
		reservePct, reserveAt = reserve.Percent, reserve.ObservedAt
	}
	var validClaim bool
	err := r.db.Pool.QueryRow(ctx, `
		WITH checked AS (
		  SELECT p.id `+activeSolarChargingPlan+`
		  WHERE p.id = $1 AND p.subject = $2 AND p.consented_at = $3 AND p.next_check_at = $4 AND p.next_check_at > $5
		    AND smart_feature_current(p.subject,'solar_charging',p.feature_claimed_at)
		  FOR UPDATE OF p
		), refreshed AS (
		  UPDATE smart_solar_charging_plans p SET reserve_pct = $6, reserve_read_at = $7
		  FROM checked WHERE p.id = checked.id AND $7::timestamptz IS NOT NULL
		), sampled AS (
		  INSERT INTO smart_solar_charging_samples (plan_id, consented_at, observed_at, grid_connected, storm_mode,
		    grid_power_w, solar_power_w, battery_power_w, battery_pct)
		  SELECT id, $3, $8, $9, $10, $11, $12, $13, $14 FROM checked
		  ON CONFLICT (plan_id, consented_at, observed_at) DO NOTHING
		)
		SELECT EXISTS (SELECT 1 FROM checked)`,
		plan.ID, plan.Subject, plan.ConsentedAt, plan.NextCheckAt, now, reservePct, reserveAt, sample.ObservedAt,
		sample.GridConnected, sample.StormMode, sample.GridPowerW, sample.SolarPowerW, sample.BatteryPowerW, sample.BatteryPct).
		Scan(&validClaim)
	if err != nil {
		return fmt.Errorf("save consent-bound solar charging evidence: %w", err)
	}
	if !validClaim {
		return port.ErrClaimLost
	}
	return nil
}

func (r *Repository) InvalidateSolarChargingEvidence(ctx context.Context, plan domain.SolarChargingPlan, now time.Time) error {
	err := pgx.BeginFunc(ctx, r.db.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_solar_charging_plans SET reserve_pct = NULL, reserve_read_at = NULL
			WHERE id = $1 AND subject = $2 AND consented_at = $3 AND next_check_at = $4 AND next_check_at > $5
			  AND smart_feature_current(subject,'solar_charging',feature_claimed_at)`,
			plan.ID, plan.Subject, plan.ConsentedAt, plan.NextCheckAt, now)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM smart_solar_charging_samples WHERE plan_id = $1 AND consented_at = $2`,
			plan.ID, plan.ConsentedAt)
		return err
	})
	if err != nil {
		return fmt.Errorf("invalidate solar charging evidence: %w", err)
	}
	return nil
}

func (r *Repository) ListSolarChargingObservations(ctx context.Context, plan domain.SolarChargingPlan,
	since, now time.Time,
) ([]domain.SolarSurplusObservation, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.energy_site_id, o.observed_at, o.grid_connected, o.storm_mode, o.grid_power_w,
		  o.solar_power_w, o.battery_power_w, o.battery_pct
		`+activeSolarChargingPlan+`
		JOIN smart_solar_charging_samples o ON o.plan_id = p.id AND o.consented_at = p.consented_at
		WHERE p.id = $1 AND p.subject = $2 AND p.consented_at = $3
		  AND smart_feature_current(p.subject,'solar_charging',o.observed_at)
		  AND o.observed_at >= GREATEST($4, p.consented_at) AND o.observed_at <= $5
		ORDER BY o.observed_at DESC LIMIT 10`, plan.ID, plan.Subject, plan.ConsentedAt, since, now)
	if err != nil {
		return nil, fmt.Errorf("list current authorized solar charging evidence: %w", err)
	}
	samples, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.SolarSurplusObservation, error) {
		var sample domain.SolarSurplusObservation
		err := row.Scan(&sample.SiteID, &sample.ObservedAt, &sample.GridConnected, &sample.StormMode,
			&sample.GridPowerW, &sample.SolarPowerW, &sample.BatteryPowerW, &sample.BatteryPct)
		return sample, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan solar charging samples: %w", err)
	}
	for i, j := 0, len(samples)-1; i < j; i, j = i+1, j-1 {
		samples[i], samples[j] = samples[j], samples[i]
	}
	return samples, nil
}

func (r *Repository) PruneSolarChargingObservations(ctx context.Context, before time.Time) error {
	if _, err := r.db.Pool.Exec(ctx, `
		WITH expired AS (
		  SELECT plan_id, consented_at, observed_at FROM smart_solar_charging_samples
		  WHERE observed_at < $1 ORDER BY observed_at LIMIT 200 FOR UPDATE SKIP LOCKED
		)
		DELETE FROM smart_solar_charging_samples o USING expired
		WHERE o.plan_id = expired.plan_id AND o.consented_at = expired.consented_at
		  AND o.observed_at = expired.observed_at`, before); err != nil {
		return fmt.Errorf("prune expired solar charging observations: %w", err)
	}
	return nil
}
