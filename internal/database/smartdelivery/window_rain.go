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

var _ port.WindowRainRepository = (*Repository)(nil)

const windowRainScope = `
	FROM smart_window_rain_plans p
	JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
	JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL`

func (r *Repository) ListWindowRainDeliveries(ctx context.Context, now time.Time, limit int) ([]domain.WindowRainRef, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.subject,p.id,p.vehicle_id,d.id,p.risk_expires_at `+windowRainScope+`
		WHERE p.risk_expires_at>$1 AND p.reason='window_rain_risk' AND p.subject NOT IN ($3,'open-mode')
			AND NOT EXISTS (SELECT 1 FROM smart_push_window_rain_deliveries a
				WHERE a.subject=p.subject AND a.vehicle_id=p.vehicle_id
				AND (a.plan_id=p.id OR a.created_at>$1::timestamptz-INTERVAL '1 hour'))
		ORDER BY p.risk_expires_at,p.id LIMIT $2`, now, limit, personal.OpenSubject)
	if err != nil {
		return nil, fmt.Errorf("list pending window rain notifications: %w", err)
	}
	pending, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.WindowRainRef])
	if err != nil {
		return nil, fmt.Errorf("read pending window rain notifications: %w", err)
	}
	return pending, nil
}

func (r *Repository) LockWindowRain(ctx context.Context, ref domain.WindowRainRef, now time.Time) (port.ExpiringDispatchLease, error) {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin window rain dispatch: %w", err)
	}
	var ciphertext string
	err = tx.QueryRow(ctx, `SELECT d.subscription_ciphertext `+windowRainScope+`
		WHERE p.subject=$1 AND p.id=$2 AND p.vehicle_id=$3 AND d.id=$4
			AND p.risk_expires_at=$5 AND p.risk_expires_at>$6 AND p.reason='window_rain_risk'
		FOR SHARE OF p,d,v`, ref.Subject, ref.PlanID, ref.VehicleID, ref.DeviceID, ref.ExpiresAt, now).Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock window rain dispatch: %w", err)
	}
	return &windowRainLease{dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, ref: ref}, nil
}

type windowRainLease struct {
	dispatchLease
	ref domain.WindowRainRef
}

func (l *windowRainLease) Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error) {
	var reserved bool
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.ref.DeviceID, now)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_push_window_rain_deliveries
				(subject,vehicle_id,plan_id,device_id,token_hash,status,created_at,expires_at)
			SELECT $1,$2,$3,$4,$5,'dispatching',$6,$7
			WHERE NOT EXISTS (SELECT 1 FROM smart_push_window_rain_deliveries a
				WHERE a.subject=$1 AND a.vehicle_id=$2 AND a.created_at>$6::timestamptz-INTERVAL '1 hour')
			ON CONFLICT DO NOTHING`, l.ref.Subject, l.ref.VehicleID, l.ref.PlanID, l.ref.DeviceID, hash, now, expiresAt)
		if err != nil {
			return fmt.Errorf("reserve window rain dispatch: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *windowRainLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	if _, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_window_rain_deliveries SET status=$2 WHERE token_hash=$1 AND status='dispatching'`, hash, status); err != nil {
		return fmt.Errorf("record window rain dispatch: %w", err)
	}
	return nil
}

const windowRainClaimScope = windowRainScope + `
	JOIN smart_push_window_rain_deliveries a ON a.plan_id=p.id AND a.subject=p.subject
		AND a.vehicle_id=p.vehicle_id AND a.device_id=d.id AND a.expires_at=p.risk_expires_at
	WHERE a.token_hash=$1 AND a.subject=$2 AND a.expires_at>$3 AND p.reason='window_rain_risk'
		AND a.claimed_at IS NULL AND a.status IN ('dispatching','accepted','unknown')`

func (r *Repository) FindWindowRainDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.WindowRainRef, error) {
	ref := domain.WindowRainRef{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `SELECT p.id,p.vehicle_id,d.id,a.expires_at `+windowRainClaimScope, hash, subject, now).
		Scan(&ref.PlanID, &ref.VehicleID, &ref.DeviceID, &ref.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read window rain delivery: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumeWindowRainDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var vehicleID, planID int64
		err := tx.QueryRow(ctx, `SELECT p.vehicle_id,p.id,p.push_title,p.push_body `+windowRainClaimScope+`
			AND NOT EXISTS (SELECT 1 FROM drives
				WHERE vehicle_id=p.vehicle_id AND started_at<=$3
					AND (ended_at IS NULL OR started_at>=p.park_observed_at OR ended_at>p.created_at))
			AND NOT EXISTS (SELECT 1 FROM signal_log WHERE vehicle_id=p.vehicle_id AND ts>=p.park_observed_at AND ts<=$3
				AND ((field='Gear' AND str_value IS DISTINCT FROM 'P') OR
					(field='VehicleSpeed' AND ts>p.park_observed_at AND COALESCE(float_value,int_value::float8)<>0)))
			FOR SHARE OF p,d,v`, hash, subject, now).Scan(&vehicleID, &planID, &notification.Title, &notification.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock window rain claim: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_push_window_rain_deliveries SET claimed_at=$2
			WHERE token_hash=$1 AND expires_at>$2 AND claimed_at IS NULL AND status IN ('dispatching','accepted','unknown')`, hash, now)
		if err != nil {
			return fmt.Errorf("consume window rain claim: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		notification.URL = fmt.Sprintf("/security-access?vehicle_id=%d&rain_vehicle_id=%d&rain_plan_id=%d#window-rain", vehicleID, vehicleID, planID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

func (r *Repository) PruneWindowRainDeliveries(ctx context.Context, now time.Time) error {
	if _, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_push_window_rain_deliveries WHERE token_hash IN (
		SELECT token_hash FROM smart_push_window_rain_deliveries
		WHERE expires_at<$1::timestamptz-INTERVAL '24 hours' ORDER BY expires_at LIMIT 100
	)`, now); err != nil {
		return fmt.Errorf("prune expired window rain delivery data: %w", err)
	}
	return nil
}
