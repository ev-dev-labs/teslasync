package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) ReadEarlierCheckPlan(ctx context.Context, key domain.StopPlanKey) (port.EarlierCheckPlan, error) {
	var scoped port.EarlierCheckPlan
	err := scanPlanInto(r.db.Pool.QueryRow(ctx, `
		SELECT `+planColumns+`, o.updated_at
		FROM smart_charging_plans p `+stopPlanJoins+`
		WHERE p.id=$1 AND p.subject=$2 AND p.vehicle_id=$3`, key.PlanID, key.Subject, key.VehicleID),
		&scoped.Plan, &scoped.PlaceUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return scoped, port.ErrNotFound
	}
	if err != nil {
		return scoped, fmt.Errorf("read earlier charging check plan: %w", err)
	}
	return scoped, nil
}

func (r *Repository) AdvanceCheck(ctx context.Context, scoped port.EarlierCheckPlan, proposed, now, expiresAt time.Time) error {
	plan := scoped.Plan
	// Both check times are still future. Keep the consent version used by existing trip evidence;
	// matching the previous check time also fences competing earlier-check confirmations.
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_charging_plans p SET notify_at=$6, next_check_at=$6, updated_at=$7
		WHERE p.id=$1 AND p.subject=$2 AND p.vehicle_id=$3 AND p.version=$4 AND p.notify_at=$5
		  AND p.enabled AND p.lease_token IS NULL AND (p.snoozed_until IS NULL OR p.snoozed_until <= $7)
		  AND $6::timestamptz < p.notify_at AND $6 < p.departure_at - INTERVAL '30 minutes'
		  AND $7::timestamptz < $6 AND $7 < $8::timestamptz
		  AND EXISTS (SELECT 1 FROM geofences g, vehicles v
		    WHERE v.id=p.vehicle_id AND v.archived_at IS NULL
		      AND g.id=p.charging_place_id AND g.updated_at=$9 AND g.enabled
		      AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		    FOR SHARE OF g, v)`,
		plan.ID, plan.Subject, plan.VehicleID, plan.Version, plan.NotifyAt, proposed, now, expiresAt, scoped.PlaceUpdatedAt)
	if err != nil {
		return fmt.Errorf("advance charging readiness check: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrEarlierCheck
	}
	return nil
}
