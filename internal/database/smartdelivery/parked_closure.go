package smartdelivery

import (
	"context"
	"errors"
	"fmt"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/jackc/pgx/v5"
)

var _ port.ParkedClosureRepository = (*Repository)(nil)

const parkedClosureScope = `
	FROM smart_parked_closure_plans p
	JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
	JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL`

func (r *Repository) ListParkedClosureDeliveries(ctx context.Context, now time.Time, limit int) ([]domain.ParkedClosureRef, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT p.subject,p.id,p.vehicle_id,d.id,p.park_id,p.open_since,p.risk_expires_at `+parkedClosureScope+`
		WHERE p.risk_expires_at>$1 AND p.park_id IS NOT NULL AND p.subject NOT IN ($3,'open-mode')
			AND NOT EXISTS (SELECT 1 FROM smart_push_parked_closure_deliveries a
				WHERE a.subject=p.subject AND a.vehicle_id=p.vehicle_id AND a.park_id=p.park_id)
		ORDER BY p.risk_expires_at,p.id LIMIT $2`, now, limit, personal.OpenSubject)
	if err != nil {
		return nil, fmt.Errorf("list pending parked closure notifications: %w", err)
	}
	pending, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.ParkedClosureRef])
	if err != nil {
		return nil, fmt.Errorf("read pending parked closure notifications: %w", err)
	}
	return pending, nil
}

func (r *Repository) LockParkedClosure(ctx context.Context, ref domain.ParkedClosureRef, now time.Time) (port.ExpiringDispatchLease, error) {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin parked closure dispatch: %w", err)
	}
	var ciphertext string
	err = tx.QueryRow(ctx, `SELECT d.subscription_ciphertext `+parkedClosureScope+`
		WHERE p.subject=$1 AND p.id=$2 AND p.vehicle_id=$3 AND d.id=$4 AND p.park_id=$5 AND p.open_since=$6
			AND p.risk_expires_at>=$7 AND $7::timestamptz>$8
		FOR SHARE OF p,d,v`, ref.Subject, ref.PlanID, ref.VehicleID, ref.DeviceID, ref.ParkID, ref.OpenSince, ref.ExpiresAt, now).
		Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock parked closure dispatch: %w", err)
	}
	return &parkedClosureLease{dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, ref: ref}, nil
}

type parkedClosureLease struct {
	dispatchLease
	ref domain.ParkedClosureRef
}

func (l *parkedClosureLease) Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error) {
	var reserved bool
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.ref.DeviceID, now)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_push_parked_closure_deliveries
			(subject,vehicle_id,plan_id,device_id,park_id,open_since,token_hash,status,created_at,expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,'dispatching',$8,$9) ON CONFLICT DO NOTHING`, l.ref.Subject,
			l.ref.VehicleID, l.ref.PlanID, l.ref.DeviceID, l.ref.ParkID, l.ref.OpenSince, hash, now, expiresAt)
		if err != nil {
			return fmt.Errorf("reserve parked closure dispatch: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *parkedClosureLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	if _, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_parked_closure_deliveries SET status=$2 WHERE token_hash=$1 AND status='dispatching'`, hash, status); err != nil {
		return fmt.Errorf("record parked closure dispatch: %w", err)
	}
	return nil
}

const parkedClosureClaimScope = parkedClosureScope + `
	JOIN smart_push_parked_closure_deliveries a ON a.plan_id=p.id AND a.subject=p.subject
		AND a.vehicle_id=p.vehicle_id AND a.device_id=d.id AND a.park_id=p.park_id AND a.open_since=p.open_since
	WHERE a.token_hash=$1 AND a.subject=$2 AND a.expires_at>$3 AND p.risk_expires_at>$3
		AND a.claimed_at IS NULL AND a.status IN ('dispatching','accepted','unknown')`

func (r *Repository) FindParkedClosureDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.ParkedClosureRef, error) {
	ref := domain.ParkedClosureRef{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `SELECT p.id,p.vehicle_id,d.id,a.park_id,a.open_since,a.expires_at `+parkedClosureClaimScope, hash, subject, now).
		Scan(&ref.PlanID, &ref.VehicleID, &ref.DeviceID, &ref.ParkID, &ref.OpenSince, &ref.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read parked closure delivery: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumeParkedClosureDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var vehicleID, planID, parkID int64
		err := tx.QueryRow(ctx, `SELECT p.vehicle_id,p.id,p.park_id,p.push_title,p.push_body `+parkedClosureClaimScope+`
			AND EXISTS (SELECT 1 FROM (
				SELECT id,ended_at FROM drives WHERE vehicle_id=p.vehicle_id AND started_at<=$3
				ORDER BY started_at DESC,id DESC LIMIT 1
			) latest WHERE latest.id=p.park_id AND latest.ended_at=p.parked_at)
			FOR SHARE OF p,d,v`, hash, subject, now).
			Scan(&vehicleID, &planID, &parkID, &notification.Title, &notification.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock parked closure claim: %w", err)
		}
		tag, err := tx.Exec(ctx, `UPDATE smart_push_parked_closure_deliveries SET claimed_at=$2
			WHERE token_hash=$1 AND expires_at>$2 AND claimed_at IS NULL AND status IN ('dispatching','accepted','unknown')`, hash, now)
		if err != nil {
			return fmt.Errorf("consume parked closure claim: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		notification.URL = fmt.Sprintf("/security-access?vehicle_id=%d&closure_vehicle_id=%d&closure_plan_id=%d&closure_park_id=%d#parked-closure",
			vehicleID, vehicleID, planID, parkID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

func (r *Repository) PruneParkedClosureDeliveries(ctx context.Context, now time.Time) error {
	if _, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_push_parked_closure_deliveries WHERE token_hash IN (
		SELECT token_hash FROM smart_push_parked_closure_deliveries
		WHERE expires_at<$1::timestamptz-INTERVAL '24 hours' ORDER BY expires_at LIMIT 100
	)`, now); err != nil {
		return fmt.Errorf("prune expired parked closure deliveries: %w", err)
	}
	return nil
}
