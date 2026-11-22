package smartdelivery

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/jackc/pgx/v5"
)

var _ port.PublicFeeRepository = (*Repository)(nil)

const publicFeeScope = `
	FROM smart_public_charging_fee_terms p
	JOIN smart_push_devices dev ON dev.id = p.push_device_id AND dev.subject = p.subject
	  AND dev.verified_at = p.push_device_verified_at
	JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
	JOIN geofences g ON g.id = p.place_id AND g.enabled AND NOT g.needs_review
	  AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at = p.place_updated_at`

func (r *Repository) LockPublicFee(ctx context.Context, ref domain.PublicFeeRef, now time.Time) (port.PublicFeeLease, error) {
	tx, err := r.beginFeatureDispatch(ctx, ref.Subject, smartfeature.PublicFee)
	if tx == nil {
		return nil, err
	}
	var ciphertext string
	err = tx.QueryRow(ctx, `
		SELECT dev.subscription_ciphertext
		`+publicFeeScope+`
		JOIN charging_sessions c ON c.id = $5 AND c.vehicle_id = p.vehicle_id AND c.geofence_id = p.place_id
		WHERE p.subject = $1 AND p.vehicle_id = $2 AND p.place_id = $3 AND dev.id = $4
		  AND p.place_updated_at = $6 AND p.confirmed_at = $7 AND p.valid_until > $8
		  AND c.ended_at > p.confirmed_at AND c.ended_at <= $8
		  AND smart_feature_current(p.subject,'public_fee',c.ended_at)
		FOR SHARE OF p, dev, v, g, c`,
		ref.Subject, ref.VehicleID, ref.PlaceID, ref.DeviceID, ref.SessionID, ref.PlaceUpdatedAt, ref.ConfirmedAt, now).
		Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock public charging fee dispatch: %w", err)
	}
	return &publicFeeLease{dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, ref: ref}, nil
}

type publicFeeLease struct {
	dispatchLease
	ref domain.PublicFeeRef
}

func (l *publicFeeLease) Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error) {
	var reserved bool
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.ref.DeviceID, now)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_push_public_fee_deliveries
			  (subject, device_id, vehicle_id, place_id, place_updated_at, confirmed_at, session_id,
			   token_hash, status, created_at, expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'dispatching',$9,$10)
			ON CONFLICT DO NOTHING`, l.ref.Subject, l.ref.DeviceID, l.ref.VehicleID, l.ref.PlaceID,
			l.ref.PlaceUpdatedAt, l.ref.ConfirmedAt, l.ref.SessionID, hash, now, expiresAt)
		if err != nil {
			return fmt.Errorf("reserve public charging fee push: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *publicFeeLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	_, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_public_fee_deliveries SET status = $2
		WHERE token_hash = $1 AND status = 'dispatching'`, hash, status)
	if err != nil {
		return fmt.Errorf("record public charging fee dispatch: %w", err)
	}
	return nil
}

const publicFeeClaimScope = publicFeeScope + `
	JOIN smart_push_public_fee_deliveries a ON a.subject = p.subject AND a.vehicle_id = p.vehicle_id
	  AND a.place_id = p.place_id AND a.place_updated_at = p.place_updated_at AND a.confirmed_at = p.confirmed_at
	  AND a.device_id = dev.id
	JOIN charging_sessions c ON c.id = a.session_id AND c.vehicle_id = p.vehicle_id AND c.geofence_id = p.place_id
	WHERE a.token_hash = $1 AND a.subject = $2 AND a.expires_at > $3 AND p.valid_until > $3
	  AND smart_feature_current(a.subject,'public_fee',a.feature_enqueued_at)
	  AND a.claimed_at IS NULL AND a.status IN ('dispatching', 'accepted', 'unknown')
	  AND c.ended_at > p.confirmed_at AND c.ended_at <= $3`

func (r *Repository) FindPublicFeeDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.PublicFeeRef, error) {
	ref := domain.PublicFeeRef{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `
		SELECT dev.id, p.vehicle_id, p.place_id, a.session_id, p.place_updated_at, p.confirmed_at, a.expires_at
		`+publicFeeClaimScope, hash, subject, now).Scan(
		&ref.DeviceID, &ref.VehicleID, &ref.PlaceID, &ref.SessionID, &ref.PlaceUpdatedAt, &ref.ConfirmedAt, &ref.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read public charging fee delivery: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumePublicFeeDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.withFeatureClaim(ctx, subject, smartfeature.PublicFee, func(tx pgx.Tx) error {
		var vehicleID, sessionID int64
		err := tx.QueryRow(ctx, `
			SELECT p.vehicle_id, a.session_id, p.push_title, p.push_body
			`+publicFeeClaimScope+` FOR SHARE OF p, dev, v, g, c`, hash, subject, now).
			Scan(&vehicleID, &sessionID, &notification.Title, &notification.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock public charging fee claim: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_push_public_fee_deliveries SET claimed_at = $2
			WHERE token_hash = $1 AND expires_at > $2 AND claimed_at IS NULL
			  AND status IN ('dispatching', 'accepted', 'unknown')`, hash, now)
		if err != nil {
			return fmt.Errorf("consume public charging fee claim: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		notification.URL = fmt.Sprintf("/settings/smart-charging?vehicle_id=%d&fee_session_id=%d#public-fee", vehicleID, sessionID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &notification, nil
}
