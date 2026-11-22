package smartdelivery

import (
	"context"
	"errors"
	"fmt"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/jackc/pgx/v5"
)

var _ port.ParkReserveRepository = (*Repository)(nil)

const parkReserveDeliveryScope = `
	FROM smart_park_reserve_plans p
	JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
	JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL AND smart_feature_current(p.subject,'park_reserve',p.feature_checked_at)`

func (r *Repository) ListParkReserveDeliveries(ctx context.Context, now time.Time, limit int) ([]domain.ParkReserveRef, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.subject,p.id,p.vehicle_id,d.id,p.return_at,p.action_until `+parkReserveDeliveryScope+`
		WHERE p.action_until>$1 AND p.reason='estimated_reserve_crossing' AND p.subject NOT IN ($3,'open-mode')
			AND NOT EXISTS (SELECT 1 FROM smart_push_park_reserve_deliveries a
				WHERE a.subject=p.subject AND a.vehicle_id=p.vehicle_id
				AND (a.return_at=p.return_at OR a.expires_at>p.created_at))
		ORDER BY p.action_until,p.id LIMIT $2`, now, limit, personal.OpenSubject)
	if err != nil {
		return nil, fmt.Errorf("list pending park reserve reminders: %w", err)
	}
	pending, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.ParkReserveRef])
	if err != nil {
		return nil, fmt.Errorf("read pending park reserve reminders: %w", err)
	}
	return pending, nil
}

func (r *Repository) LockParkReserve(ctx context.Context, ref domain.ParkReserveRef, now time.Time) (port.ExpiringDispatchLease, error) {
	tx, err := r.beginFeatureDispatch(ctx, ref.Subject, smartfeature.ParkReserve)
	if tx == nil {
		return nil, err
	}
	var ciphertext string
	err = tx.QueryRow(ctx, `SELECT d.subscription_ciphertext `+parkReserveDeliveryScope+`
		WHERE p.subject=$1 AND p.id=$2 AND p.vehicle_id=$3 AND d.id=$4 AND p.return_at=$5
			AND p.action_until=$6 AND p.action_until>$7 AND p.reason='estimated_reserve_crossing'
		FOR SHARE OF p,d,v`, ref.Subject, ref.PlanID, ref.VehicleID, ref.DeviceID, ref.ReturnAt, ref.ExpiresAt, now).
		Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock park reserve dispatch: %w", err)
	}
	return &parkReserveLease{dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, ref: ref}, nil
}

type parkReserveLease struct {
	dispatchLease
	ref domain.ParkReserveRef
}

func (l *parkReserveLease) Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error) {
	reserved := false
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.ref.DeviceID, now)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_push_park_reserve_deliveries
				(subject,vehicle_id,return_at,plan_id,device_id,token_hash,status,created_at,expires_at)
			SELECT $1,$2,$3,$4,$5,$6,'dispatching',$7,$8
			WHERE NOT EXISTS (SELECT 1 FROM smart_push_park_reserve_deliveries a
				WHERE a.subject=$1 AND a.vehicle_id=$2 AND a.expires_at>(
					SELECT p.created_at FROM smart_park_reserve_plans p WHERE p.id=$4))
			ON CONFLICT DO NOTHING`, l.ref.Subject, l.ref.VehicleID, l.ref.ReturnAt, l.ref.PlanID, l.ref.DeviceID, hash, now, expiresAt)
		if err != nil {
			return fmt.Errorf("reserve park reserve dispatch: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *parkReserveLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	if _, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_park_reserve_deliveries SET status=$2 WHERE token_hash=$1 AND status='dispatching'`, hash, status); err != nil {
		return fmt.Errorf("record park reserve dispatch: %w", err)
	}
	return nil
}

const parkReserveClaimScope = parkReserveDeliveryScope + `
	JOIN smart_push_park_reserve_deliveries a ON a.plan_id=p.id AND a.subject=p.subject
		AND a.vehicle_id=p.vehicle_id AND a.return_at=p.return_at AND a.device_id=d.id
	WHERE a.token_hash=$1 AND a.subject=$2 AND p.action_until>$3 AND a.expires_at>$3
		AND smart_feature_current(a.subject,'park_reserve',a.feature_enqueued_at)
		AND p.reason='estimated_reserve_crossing' AND a.claimed_at IS NULL AND a.status IN ('dispatching','accepted','unknown')`

func (r *Repository) FindParkReserveDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.ParkReserveRef, error) {
	ref := domain.ParkReserveRef{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `
		SELECT p.id,p.vehicle_id,d.id,p.return_at,a.expires_at `+parkReserveClaimScope, hash, subject, now).
		Scan(&ref.PlanID, &ref.VehicleID, &ref.DeviceID, &ref.ReturnAt, &ref.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read park reserve delivery: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumeParkReserveDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.withFeatureClaim(ctx, subject, smartfeature.ParkReserve, func(tx pgx.Tx) error {
		var vehicleID, planID int64
		err := tx.QueryRow(ctx, `SELECT p.vehicle_id,p.id,p.push_title,p.push_body `+parkReserveClaimScope+`
			AND NOT EXISTS (SELECT 1 FROM drives
				WHERE vehicle_id=p.vehicle_id AND started_at<=$3 AND (ended_at IS NULL OR ended_at>p.created_at))
			AND NOT EXISTS (SELECT 1 FROM charging_sessions
				WHERE vehicle_id=p.vehicle_id AND started_at<=$3 AND (ended_at IS NULL OR ended_at>p.created_at))
			FOR SHARE OF p,d,v`, hash, subject, now).Scan(&vehicleID, &planID, &notification.Title, &notification.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock park reserve claim: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_push_park_reserve_deliveries SET claimed_at=$2
			WHERE token_hash=$1 AND expires_at>$2 AND claimed_at IS NULL AND status IN ('dispatching','accepted','unknown')`, hash, now)
		if err != nil {
			return fmt.Errorf("consume park reserve claim: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		notification.URL = fmt.Sprintf("/vampire-drain?vehicle_id=%d&park_vehicle_id=%d&park_plan_id=%d#park-reserve", vehicleID, vehicleID, planID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

func (r *Repository) PruneParkReserveDeliveries(ctx context.Context, now time.Time) error {
	if _, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_push_park_reserve_deliveries WHERE token_hash IN (
			SELECT token_hash FROM smart_push_park_reserve_deliveries
			WHERE expires_at<$1::timestamptz-INTERVAL '8 days' ORDER BY expires_at LIMIT 100
		)`, now); err != nil {
		return fmt.Errorf("prune expired park reserve delivery data: %w", err)
	}
	return nil
}
