package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.TripMaintenanceRepository = (*Repository)(nil)

const maintenancePlanScope = `p.id=$1 AND p.subject=$2 AND p.vehicle_id=$3`
const maintenanceVehicle = `JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL`
const maintenancePlanColumns = `p.id, p.vehicle_id, p.enabled, p.version, p.departure_at, p.snoozed_until, v.display_name`
const maintenanceSetupColumns = `COALESCE(m.plan_version,0), COALESCE(m.service_label,''),
	COALESCE(m.service_completed_at,'epoch'::timestamptz), COALESCE(m.service_odometer_m,0),
	COALESCE(m.interval_m,0), COALESCE(m.trip_distance_low_m,0), COALESCE(m.trip_distance_high_m,0)`
const maintenanceObservationColumns = `
	CASE WHEN smart_feature_current(p.subject,'trip_maintenance',m.feature_checked_at) THEN COALESCE(m.recorded_odometer_m,0) ELSE 0 END,
	CASE WHEN smart_feature_current(p.subject,'trip_maintenance',m.feature_checked_at) THEN COALESCE(m.recorded_at,'epoch') ELSE 'epoch' END`

func (r *Repository) ReadTripMaintenance(ctx context.Context, key domain.StopPlanKey) (port.TripMaintenanceSnapshot, error) {
	value, err := scanTripMaintenance(r.db.Pool.QueryRow(ctx, `
		SELECT `+maintenancePlanColumns+`, `+maintenanceSetupColumns+`, `+maintenanceObservationColumns+`
		FROM smart_charging_plans p `+maintenanceVehicle+`
		LEFT JOIN smart_trip_maintenance m ON m.plan_id=p.id
		WHERE `+maintenancePlanScope, key.PlanID, key.Subject, key.VehicleID))
	if errors.Is(err, pgx.ErrNoRows) {
		return value, port.ErrNotFound
	}
	if err != nil {
		return value, fmt.Errorf("read private trip maintenance settings: %w", err)
	}
	return value, nil
}

func (r *Repository) ReplaceTripMaintenance(ctx context.Context, key domain.StopPlanKey, input domain.TripMaintenanceSetup, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var planID int64
		err := tx.QueryRow(ctx, `SELECT p.id FROM smart_charging_plans p `+maintenanceVehicle+`
			WHERE `+maintenancePlanScope+` AND p.version=$4 AND p.enabled AND p.departure_at>$5 FOR UPDATE OF p`,
			key.PlanID, key.Subject, key.VehicleID, input.PlanVersion, now).Scan(&planID)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock scoped trip maintenance plan: %w", err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO smart_trip_maintenance AS m
			(plan_id, plan_version, service_label, service_completed_at, service_odometer_m, interval_m,
			trip_distance_low_m, trip_distance_high_m, next_check_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			ON CONFLICT (plan_id) DO UPDATE SET
				plan_version=EXCLUDED.plan_version, service_label=EXCLUDED.service_label,
				service_completed_at=EXCLUDED.service_completed_at, service_odometer_m=EXCLUDED.service_odometer_m,
				interval_m=EXCLUDED.interval_m, trip_distance_low_m=EXCLUDED.trip_distance_low_m,
				trip_distance_high_m=EXCLUDED.trip_distance_high_m, next_check_at=EXCLUDED.next_check_at,
				recorded_at=NULL, recorded_odometer_m=NULL, expires_at=NULL
			WHERE (m.plan_version, m.service_label, m.service_completed_at, m.service_odometer_m, m.interval_m,
				m.trip_distance_low_m, m.trip_distance_high_m) IS DISTINCT FROM
				(EXCLUDED.plan_version, EXCLUDED.service_label, EXCLUDED.service_completed_at, EXCLUDED.service_odometer_m,
				EXCLUDED.interval_m, EXCLUDED.trip_distance_low_m, EXCLUDED.trip_distance_high_m)`,
			planID, input.PlanVersion, input.ServiceLabel, input.ServiceCompletedAt,
			input.ServiceOdometerM, input.IntervalM, input.TripDistanceLowM, input.TripDistanceHighM, now)
		if err != nil {
			return fmt.Errorf("save trip maintenance opt-in: %w", err)
		}
		return nil
	})
}

func (r *Repository) DeleteTripMaintenance(ctx context.Context, key domain.StopPlanKey) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_trip_maintenance m USING smart_charging_plans p
		WHERE m.plan_id=p.id AND `+maintenancePlanScope, key.PlanID, key.Subject, key.VehicleID)
	if err != nil {
		return fmt.Errorf("remove private trip maintenance setup: %w", err)
	}
	return nil
}

func (r *Repository) CheckNextTripMaintenance(ctx context.Context, window port.TripMaintenanceCheck, evaluate port.TripMaintenanceEvaluator) (
	domain.TripMaintenanceReason, bool, error,
) {
	var reason domain.TripMaintenanceReason
	var published bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var plan domain.Plan
		var setup domain.TripMaintenanceSetup
		var previouslyPublished bool
		var subject string
		err := tx.QueryRow(ctx, `SELECT p.id,p.vehicle_id,p.enabled,p.version,p.departure_at,p.snoozed_until,p.subject,
			`+maintenanceSetupColumns+`, COALESCE(m.published_for_version=p.version,false)
			FROM smart_trip_maintenance m JOIN smart_charging_plans p ON p.id=m.plan_id `+maintenanceVehicle+`
			WHERE m.plan_version=p.version AND p.enabled AND p.subject<>$4
				AND smart_feature_allowed(p.subject,'trip_maintenance')
			  AND (p.snoozed_until IS NULL OR p.snoozed_until<=$1) AND m.next_check_at<=$1
			  AND p.departure_at>$2 AND p.departure_at<=$3
			ORDER BY m.next_check_at, m.plan_id LIMIT 1 FOR UPDATE OF p, m SKIP LOCKED`,
			window.Now, window.EarliestDeparture, window.LatestDeparture, personaldomain.OpenSubject).
			Scan(&plan.ID, &plan.VehicleID, &plan.Enabled, &plan.Version, &plan.DepartureAt, &plan.SnoozedUntil, &subject,
				&setup.PlanVersion, &setup.ServiceLabel, &setup.ServiceCompletedAt, &setup.ServiceOdometerM,
				&setup.IntervalM, &setup.TripDistanceLowM, &setup.TripDistanceHighM, &previouslyPublished)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock next scoped trip maintenance check: %w", err)
		}
		allowed, err := featuredb.HoldAllowed(ctx, tx, subject, smartfeature.TripMaintenance)
		if err != nil || !allowed {
			return err
		}
		observation, err := tripMaintenanceOdometer(ctx, tx, plan.VehicleID, window.OldestObservation, window.Now)
		if err != nil {
			return err
		}
		projection, outcome := evaluate(plan, setup, observation)
		var measuredAt, expiresAt *time.Time
		var odometerM *float64
		if projection != nil {
			measuredAt, expiresAt, odometerM = &projection.RecordedAt, &projection.ExpiresAt, &projection.RecordedOdometerM
		}
		_, err = tx.Exec(ctx, `UPDATE smart_trip_maintenance SET next_check_at=$2, recorded_at=$3, recorded_odometer_m=$4,
			feature_checked_at=statement_timestamp(),
			expires_at=$5, published_for_version=CASE WHEN $3::timestamptz IS NOT NULL THEN plan_version ELSE published_for_version END
			WHERE plan_id=$1`, plan.ID, window.NextAt, measuredAt, odometerM, expiresAt)
		if err != nil {
			return fmt.Errorf("save checked trip maintenance evidence: %w", err)
		}
		reason, published = outcome, projection != nil && !previouslyPublished
		return nil
	})
	if err != nil {
		return "", false, err
	}
	return reason, published, nil
}

func tripMaintenanceOdometer(ctx context.Context, tx pgx.Tx, vehicleID int64, from, until time.Time) (domain.TripOdometerObservation, error) {
	rows, err := tx.Query(ctx, `SELECT ended_at,end_odometer_m FROM drives
		WHERE vehicle_id=$1 AND started_at BETWEEN $2::timestamptz - INTERVAL '24 hours' AND $3
		  AND ended_at>$2 AND ended_at<= $3 AND ended_at>started_at AND end_odometer_m IS NOT NULL
		ORDER BY ended_at DESC, id DESC LIMIT 2`, vehicleID, from, until)
	if err != nil {
		return domain.TripOdometerObservation{}, fmt.Errorf("read opted-in trip odometer evidence: %w", err)
	}
	samples, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.TripOdometerObservation, error) {
		sample := domain.TripOdometerObservation{VehicleID: vehicleID}
		err := row.Scan(&sample.ObservedAt, &sample.OdometerM)
		return sample, err
	})
	if err != nil {
		return domain.TripOdometerObservation{}, fmt.Errorf("scan trip odometer evidence: %w", err)
	}
	if len(samples) == 0 || (len(samples) == 2 && (samples[0].OdometerM < samples[1].OdometerM ||
		(samples[0].ObservedAt.Equal(samples[1].ObservedAt) && samples[0].OdometerM != samples[1].OdometerM))) {
		return domain.TripOdometerObservation{}, nil
	}
	return samples[0], nil
}

func (r *Repository) ListTripMaintenance(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) (
	[]port.TripMaintenanceSnapshot, error,
) {
	rows, err := r.db.Pool.Query(ctx, `SELECT `+maintenancePlanColumns+`, `+maintenanceSetupColumns+`, `+maintenanceObservationColumns+`
		FROM smart_trip_maintenance m JOIN smart_charging_plans p ON p.id=m.plan_id `+maintenanceVehicle+`
		WHERE p.subject=$1 AND ($2::bigint IS NULL OR p.vehicle_id=$2) AND m.plan_version=p.version AND p.enabled
			AND smart_feature_current(p.subject,'trip_maintenance',m.feature_checked_at)
		  AND m.expires_at>$3 AND (p.snoozed_until IS NULL OR p.snoozed_until<=$3)
		ORDER BY p.departure_at, p.id LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list current trip maintenance projections: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.TripMaintenanceSnapshot, error) {
		return scanTripMaintenance(row)
	})
	if err != nil {
		return nil, fmt.Errorf("scan private trip maintenance projections: %w", err)
	}
	return items, nil
}

func scanTripMaintenance(row pgx.Row) (port.TripMaintenanceSnapshot, error) {
	var value port.TripMaintenanceSnapshot
	p, s, o := &value.Plan, &value.Setup, &value.Observation
	err := row.Scan(&p.ID, &p.VehicleID, &p.Enabled, &p.Version, &p.DepartureAt, &p.SnoozedUntil, &value.VehicleName,
		&s.PlanVersion, &s.ServiceLabel, &s.ServiceCompletedAt, &s.ServiceOdometerM, &s.IntervalM,
		&s.TripDistanceLowM, &s.TripDistanceHighM, &o.OdometerM, &o.ObservedAt)
	o.VehicleID = p.VehicleID
	return value, err
}
