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

var _ port.ParkedUnlockRepository = (*Repository)(nil)

const parkedUnlockScope = `
	FROM smart_parked_unlock_plans p
	JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
	JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL AND smart_feature_current(p.subject,'parked_unlock',p.feature_checked_at)
	JOIN geofences g ON g.id=p.place_id AND g.updated_at=p.place_revision
		AND g.enabled AND NOT g.needs_review AND g.archived_at IS NULL`

func (r *Repository) ListParkedUnlockDeliveries(ctx context.Context, now time.Time, limit int) ([]domain.ParkedUnlockRef, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT p.subject,p.id,p.vehicle_id,d.id,p.park_id,p.unlocked_since,p.risk_expires_at `+parkedUnlockScope+`
		WHERE p.risk_expires_at>$1 AND p.park_id IS NOT NULL AND p.subject NOT IN ($3,'open-mode')
			AND NOT EXISTS (SELECT 1 FROM smart_push_parked_unlock_deliveries a
				WHERE a.subject=p.subject AND a.vehicle_id=p.vehicle_id AND a.park_id=p.park_id)
		ORDER BY p.risk_expires_at,p.id LIMIT $2`, now, limit, personal.OpenSubject)
	if err != nil {
		return nil, fmt.Errorf("list pending parked unlock notifications: %w", err)
	}
	pending, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.ParkedUnlockRef])
	if err != nil {
		return nil, fmt.Errorf("read pending parked unlock notifications: %w", err)
	}
	return pending, nil
}

func (r *Repository) LockParkedUnlock(ctx context.Context, ref domain.ParkedUnlockRef, now time.Time) (port.ExpiringDispatchLease, error) {
	tx, err := r.beginFeatureDispatch(ctx, ref.Subject, smartfeature.ParkedUnlock)
	if tx == nil {
		return nil, err
	}
	var ciphertext string
	err = tx.QueryRow(ctx, `SELECT d.subscription_ciphertext `+parkedUnlockScope+`
		WHERE p.subject=$1 AND p.id=$2 AND p.vehicle_id=$3 AND d.id=$4 AND p.park_id=$5 AND p.unlocked_since=$6
			AND p.risk_expires_at>=$7 AND $7::timestamptz>$8
		FOR SHARE OF p,d,v,g`, ref.Subject, ref.PlanID, ref.VehicleID, ref.DeviceID, ref.ParkID, ref.UnlockedSince, ref.ExpiresAt, now).
		Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock parked unlock dispatch: %w", err)
	}
	return &parkedUnlockLease{dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, ref: ref}, nil
}

type parkedUnlockLease struct {
	dispatchLease
	ref domain.ParkedUnlockRef
}

func (l *parkedUnlockLease) Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error) {
	var reserved bool
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.ref.DeviceID, now)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_push_parked_unlock_deliveries
			(subject,vehicle_id,plan_id,device_id,park_id,unlocked_since,token_hash,status,created_at,expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,'dispatching',$8,$9) ON CONFLICT DO NOTHING`, l.ref.Subject,
			l.ref.VehicleID, l.ref.PlanID, l.ref.DeviceID, l.ref.ParkID, l.ref.UnlockedSince, hash, now, expiresAt)
		if err != nil {
			return fmt.Errorf("reserve parked unlock dispatch: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *parkedUnlockLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	if _, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_parked_unlock_deliveries SET status=$2 WHERE token_hash=$1 AND status='dispatching'`, hash, status); err != nil {
		return fmt.Errorf("record parked unlock dispatch: %w", err)
	}
	return nil
}

const parkedUnlockClaimScope = parkedUnlockScope + `
	JOIN smart_push_parked_unlock_deliveries a ON a.plan_id=p.id AND a.subject=p.subject
		AND a.vehicle_id=p.vehicle_id AND a.device_id=d.id AND a.park_id=p.park_id AND a.unlocked_since=p.unlocked_since
	WHERE a.token_hash=$1 AND a.subject=$2 AND a.expires_at>$3 AND p.risk_expires_at>$3
		AND smart_feature_current(a.subject,'parked_unlock',a.feature_enqueued_at)
		AND a.claimed_at IS NULL AND a.status IN ('dispatching','accepted','unknown')`

func (r *Repository) FindParkedUnlockDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.ParkedUnlockRef, error) {
	ref := domain.ParkedUnlockRef{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `SELECT p.id,p.vehicle_id,d.id,a.park_id,a.unlocked_since,a.expires_at `+parkedUnlockClaimScope, hash, subject, now).
		Scan(&ref.PlanID, &ref.VehicleID, &ref.DeviceID, &ref.ParkID, &ref.UnlockedSince, &ref.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read parked unlock delivery: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumeParkedUnlockDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.withFeatureClaim(ctx, subject, smartfeature.ParkedUnlock, func(tx pgx.Tx) error {
		var vehicleID, planID, parkID int64
		err := tx.QueryRow(ctx, `SELECT p.vehicle_id,p.id,p.park_id,p.push_title,p.push_body `+parkedUnlockClaimScope+`
			AND EXISTS (SELECT 1 FROM (
				SELECT id,ended_at FROM drives WHERE vehicle_id=p.vehicle_id AND started_at<=$3
				ORDER BY started_at DESC,id DESC LIMIT 1
			) latest WHERE latest.id=p.park_id AND latest.ended_at=p.parked_at)
			FOR SHARE OF p,d,v,g`, hash, subject, now).
			Scan(&vehicleID, &planID, &parkID, &notification.Title, &notification.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock parked unlock claim: %w", err)
		}
		tag, err := tx.Exec(ctx, `UPDATE smart_push_parked_unlock_deliveries SET claimed_at=$2
			WHERE token_hash=$1 AND expires_at>$2 AND claimed_at IS NULL AND status IN ('dispatching','accepted','unknown')`, hash, now)
		if err != nil {
			return fmt.Errorf("consume parked unlock claim: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		notification.URL = fmt.Sprintf("/security-access?vehicle_id=%d&unlock_vehicle_id=%d&unlock_plan_id=%d&unlock_park_id=%d#parked-unlock",
			vehicleID, vehicleID, planID, parkID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

func (r *Repository) PruneParkedUnlockDeliveries(ctx context.Context, now time.Time) error {
	if _, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_push_parked_unlock_deliveries WHERE token_hash IN (
		SELECT token_hash FROM smart_push_parked_unlock_deliveries
		WHERE expires_at<$1::timestamptz-INTERVAL '24 hours' ORDER BY expires_at LIMIT 100
	)`, now); err != nil {
		return fmt.Errorf("prune expired parked unlock deliveries: %w", err)
	}
	return nil
}
