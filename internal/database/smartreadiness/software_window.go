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

var _ port.SoftwareWindowRepository = (*Repository)(nil)

func (r *Repository) ReadSoftwareWindow(ctx context.Context, scope port.SoftwareWindowScope) (*domain.SoftwareWindowPlan, error) {
	plan := domain.SoftwareWindowPlan{VehicleID: scope.VehicleID}
	var confirmed, departure *time.Time
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),p.confirmed_at,p.departure_at,COALESCE(p.version,''),
			COALESCE(p.estimated_duration_s,0),COALESCE(p.paused,false),p.snoozed_until
		FROM vehicles v
		LEFT JOIN smart_software_window_plans p ON p.vehicle_id=v.id AND p.subject=$1
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&plan.ID, &confirmed, &departure, &plan.Version, &plan.EstimatedDurationS, &plan.Paused, &plan.SnoozedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read private software window: %w", err)
	}
	if plan.ID == 0 || confirmed == nil || departure == nil {
		return nil, nil
	}
	plan.ConfirmedAt, plan.DepartureAt = *confirmed, *departure
	return &plan, nil
}

func (r *Repository) ReplaceSoftwareWindow(ctx context.Context, scope port.SoftwareWindowScope, expectedID int64, setup domain.SoftwareWindowSetup, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_software_window_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, expectedID)
			if err != nil {
				return fmt.Errorf("replace prior private software window: %w", err)
			}
			if tag.RowsAffected() != 1 {
				return port.ErrSoftwareWindowChanged
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_software_window_plans (subject,vehicle_id,confirmed_at,departure_at,version,estimated_duration_s)
			SELECT $1,v.id,$3,$4,$5,$6 FROM vehicles v WHERE v.id=$2 AND v.archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, now, setup.DepartureAt, setup.Version, setup.EstimatedDurationS)
		if err != nil {
			return fmt.Errorf("save private software window: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrSoftwareWindowChanged
		}
		return nil
	})
}

func (r *Repository) HoldSoftwareWindow(ctx context.Context, scope port.SoftwareWindowScope, expectedID int64, until *time.Time, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_software_window_plans p SET id=DEFAULT,paused=$4::timestamptz IS NULL,snoozed_until=$4::timestamptz
		FROM vehicles v WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.departure_at>$5
			AND v.id=p.vehicle_id AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, expectedID, until, now)
	if err != nil {
		return fmt.Errorf("hold private software window: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrSoftwareWindowChanged
	}
	return nil
}

func (r *Repository) DeleteSoftwareWindow(ctx context.Context, scope port.SoftwareWindowScope, expectedID int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_software_window_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, expectedID)
	if err != nil {
		return fmt.Errorf("clear private software window: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrSoftwareWindowChanged
	}
	return nil
}

func (r *Repository) CheckSoftwareWindow(ctx context.Context, scope port.SoftwareWindowScope, expectedID int64, parkAt, now time.Time) (bool, error) {
	var valid bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM smart_software_window_plans p JOIN vehicles v ON v.id=p.vehicle_id
			WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND NOT p.paused
				AND v.archived_at IS NULL AND (p.snoozed_until IS NULL OR p.snoozed_until<=$5)
				AND (SELECT ended_at FROM drives WHERE vehicle_id=v.id AND started_at<=$5
					ORDER BY started_at DESC,id DESC LIMIT 1)=$4
		)`, scope.Subject, scope.VehicleID, expectedID, parkAt, now).Scan(&valid)
	if err != nil {
		return false, fmt.Errorf("check private software window revision and park: %w", err)
	}
	return valid, nil
}
