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

var _ port.CabinPrepRepository = (*Repository)(nil)

const cabinPrepScope = `
	FROM smart_cabin_prep_plans p
	JOIN smart_push_devices dev ON dev.id=p.device_id AND dev.subject=p.subject AND dev.verified_at=p.device_verified_at
	JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL`

func (r *Repository) ListCabinPrepDeliveries(ctx context.Context, now time.Time, limit int) ([]domain.CabinPrepRef, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.subject,p.id,p.vehicle_id,dev.id,p.departure_at,p.expires_at `+cabinPrepScope+`
		WHERE p.expires_at>$1 AND p.reason='eligible' AND p.subject NOT IN ($3,'open-mode')
			AND NOT EXISTS (SELECT 1 FROM smart_push_cabin_prep_deliveries a
				WHERE a.subject=p.subject AND a.vehicle_id=p.vehicle_id AND a.departure_at=p.departure_at)
		ORDER BY p.expires_at,p.id LIMIT $2`, now, limit, personal.OpenSubject)
	if err != nil {
		return nil, fmt.Errorf("list pending cabin prep reminders: %w", err)
	}
	defer rows.Close()
	pending := make([]domain.CabinPrepRef, 0)
	for rows.Next() {
		var ref domain.CabinPrepRef
		if err := rows.Scan(&ref.Subject, &ref.PlanID, &ref.VehicleID, &ref.DeviceID, &ref.DepartureAt, &ref.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan pending cabin prep reminder: %w", err)
		}
		pending = append(pending, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending cabin prep reminders: %w", err)
	}
	return pending, nil
}

func (r *Repository) LockCabinPrep(ctx context.Context, ref domain.CabinPrepRef, now time.Time) (port.ExpiringDispatchLease, error) {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin cabin prep dispatch: %w", err)
	}
	var ciphertext string
	err = tx.QueryRow(ctx, `SELECT dev.subscription_ciphertext `+cabinPrepScope+`
		WHERE p.subject=$1 AND p.id=$2 AND p.vehicle_id=$3 AND dev.id=$4
			AND p.departure_at=$5 AND p.expires_at=$6 AND p.expires_at>$7 AND p.reason='eligible'
		FOR SHARE OF p,dev,v`, ref.Subject, ref.PlanID, ref.VehicleID, ref.DeviceID, ref.DepartureAt, ref.ExpiresAt, now).
		Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock cabin prep dispatch: %w", err)
	}
	return &cabinPrepLease{dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, ref: ref}, nil
}

type cabinPrepLease struct {
	dispatchLease
	ref domain.CabinPrepRef
}

func (l *cabinPrepLease) Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error) {
	reserved := false
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.ref.DeviceID, now)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_push_cabin_prep_deliveries
				(subject,vehicle_id,departure_at,plan_id,device_id,token_hash,status,created_at,expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,'dispatching',$7,$8) ON CONFLICT DO NOTHING`,
			l.ref.Subject, l.ref.VehicleID, l.ref.DepartureAt, l.ref.PlanID, l.ref.DeviceID, hash, now, expiresAt)
		if err != nil {
			return fmt.Errorf("reserve cabin prep dispatch: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *cabinPrepLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	if _, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_cabin_prep_deliveries SET status=$2 WHERE token_hash=$1 AND status='dispatching'`, hash, status); err != nil {
		return fmt.Errorf("record cabin prep dispatch: %w", err)
	}
	return nil
}

const cabinPrepClaimScope = cabinPrepScope + `
	JOIN smart_push_cabin_prep_deliveries a ON a.plan_id=p.id AND a.subject=p.subject
		AND a.vehicle_id=p.vehicle_id AND a.departure_at=p.departure_at AND a.device_id=dev.id
	WHERE a.token_hash=$1 AND a.subject=$2 AND p.expires_at>$3 AND a.expires_at>$3 AND p.reason='eligible'
		AND a.claimed_at IS NULL AND a.status IN ('dispatching','accepted','unknown')`

func (r *Repository) FindCabinPrepDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.CabinPrepRef, error) {
	ref := domain.CabinPrepRef{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `
		SELECT p.id,p.vehicle_id,dev.id,p.departure_at,a.expires_at `+cabinPrepClaimScope, hash, subject, now).
		Scan(&ref.PlanID, &ref.VehicleID, &ref.DeviceID, &ref.DepartureAt, &ref.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read cabin prep delivery: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumeCabinPrepDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var vehicleID int64
		err := tx.QueryRow(ctx, `SELECT p.vehicle_id,p.push_title,p.push_body `+cabinPrepClaimScope+` FOR SHARE OF p,dev,v`,
			hash, subject, now).Scan(&vehicleID, &notification.Title, &notification.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock cabin prep claim: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_push_cabin_prep_deliveries SET claimed_at=$2
			WHERE token_hash=$1 AND expires_at>$2 AND claimed_at IS NULL
				AND status IN ('dispatching','accepted','unknown')`, hash, now)
		if err != nil {
			return fmt.Errorf("consume cabin prep claim: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		notification.URL = fmt.Sprintf("/preconditioning-effectiveness?vehicle_id=%d&cabin_vehicle_id=%d#cabin-prep-reminder", vehicleID, vehicleID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

func (r *Repository) PruneCabinPrepDeliveries(ctx context.Context, now time.Time) error {
	if _, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_push_cabin_prep_deliveries WHERE token_hash IN (
			SELECT token_hash FROM smart_push_cabin_prep_deliveries
			WHERE expires_at<$1::timestamptz-INTERVAL '24 hours' ORDER BY expires_at LIMIT 100
		)`, now); err != nil {
		return fmt.Errorf("prune expired cabin prep delivery data: %w", err)
	}
	return nil
}
