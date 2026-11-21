package smartdelivery

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) ListChargingDevices(ctx context.Context, subject string) ([]int64, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT id FROM smart_push_devices
		WHERE subject=$1 AND verified_at IS NOT NULL AND charging_enabled
		ORDER BY id LIMIT 10`, subject)
	if err != nil {
		return nil, fmt.Errorf("list personal charging devices: %w", err)
	}
	defer rows.Close()
	devices := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan personal charging device: %w", err)
		}
		devices = append(devices, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate personal charging devices: %w", err)
	}
	return devices, nil
}

func (r *Repository) LockCharging(ctx context.Context, attempt domain.ChargingAttempt) (port.DispatchLease, error) {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin personal charging dispatch: %w", err)
	}
	var ciphertext string
	// Both readiness decision writers lock the parent plan before updating evidence.
	err = tx.QueryRow(ctx, `
		SELECT dev.subscription_ciphertext
		FROM smart_push_devices dev
		JOIN smart_charging_plans p ON p.id=$2
		JOIN smart_charging_candidate_decisions decision ON decision.plan_id=p.id
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN geofences g ON g.id=p.charging_place_id AND g.enabled
		  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		WHERE dev.id=$1 AND dev.subject=$3 AND dev.verified_at IS NOT NULL AND dev.charging_enabled
		  AND p.subject=$3 AND p.vehicle_id=$4 AND p.version=$5 AND p.enabled AND p.departure_at=$6
		  AND p.notify_at <= $7 AND p.departure_at > $7::timestamptz + INTERVAL '30 minutes'
		  AND (p.snoozed_until IS NULL OR p.snoozed_until <= $7)
		  AND decision.expires_at > $7 AND g.updated_at=$8 AND decision.kind=$9
		  AND ($9 <> 'departure_overlap' OR p.departure_overlap_push)
		  AND ($9 <> 'slow_charging' OR EXISTS (
		    SELECT 1 FROM smart_charging_slow_samples s
		    WHERE s.plan_id=p.id AND s.plan_version=p.version
		      AND s.last_seen_at=decision.evaluated_at
		      AND s.first_seen_at <= decision.evaluated_at - INTERVAL '5 minutes'
		  ))
		FOR SHARE OF dev, p, v, g`,
		attempt.DeviceID, attempt.PlanID, attempt.Subject, attempt.VehicleID, attempt.PlanVersion,
		attempt.DepartureAt, attempt.CreatedAt, attempt.PlaceUpdatedAt, attempt.DecisionKind).Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock personal charging dispatch: %w", err)
	}
	return &dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, nil
}

type dispatchLease struct {
	repository *Repository
	tx         pgx.Tx
	ciphertext string
}

func (l *dispatchLease) Ciphertext() string { return l.ciphertext }

func (l *dispatchLease) Reserve(ctx context.Context, attempt domain.ChargingAttempt) (bool, error) {
	reserved := false
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, attempt.DeviceID, attempt.CreatedAt)
		if err != nil || !allowed {
			return err
		}
		var id int64
		err = tx.QueryRow(ctx, `
			INSERT INTO smart_push_deliveries
			  (device_id, plan_id, plan_version, departure_at, place_updated_at, decision_kind,
			   token_hash, status, created_at, expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,'dispatching',$8,$9)
			ON CONFLICT DO NOTHING RETURNING id`,
			attempt.DeviceID, attempt.PlanID, attempt.PlanVersion, attempt.DepartureAt,
			attempt.PlaceUpdatedAt, attempt.DecisionKind, attempt.TokenHash, attempt.CreatedAt, attempt.ExpiresAt).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reserve personal charging dispatch: %w", err)
		}
		reserved = true
		return nil
	})
	return reserved, err
}

func (l *dispatchLease) Finish(ctx context.Context, tokenHash []byte, status domain.DeliveryStatus) error {
	if status != domain.DeliveryAccepted && status != domain.DeliveryFailed && status != domain.DeliveryUnknown {
		return errors.New("invalid personal charging dispatch status")
	}
	_, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_deliveries SET status=$2 WHERE token_hash=$1 AND status='dispatching'`, tokenHash, status)
	if err != nil {
		return fmt.Errorf("finish personal charging dispatch: %w", err)
	}
	return nil
}

func (l *dispatchLease) Close(ctx context.Context) error {
	if err := l.tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		return fmt.Errorf("release personal dispatch: %w", err)
	}
	return nil
}

func (r *Repository) FindDelivery(
	ctx context.Context, subject string, tokenHash []byte, now time.Time,
) (*domain.DeliveryRef, error) {
	var ref domain.DeliveryRef
	err := r.db.Pool.QueryRow(ctx, `
		SELECT d.id, p.id, p.vehicle_id, p.version, d.place_updated_at, d.decision_kind
		FROM smart_push_deliveries d
		JOIN smart_push_devices dev ON dev.id=d.device_id
		JOIN smart_charging_plans p ON p.id=d.plan_id
		JOIN smart_charging_candidate_decisions decision ON decision.plan_id=p.id
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN geofences g ON g.id=p.charging_place_id AND g.enabled
		  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		WHERE d.token_hash=$1 AND dev.subject=$2 AND p.subject=$2
		  AND dev.verified_at IS NOT NULL AND dev.charging_enabled
		  AND p.enabled AND p.version=d.plan_version AND p.departure_at=d.departure_at
		  AND p.departure_at > $3::timestamptz + INTERVAL '30 minutes'
		  AND (p.snoozed_until IS NULL OR p.snoozed_until <= $3)
		  AND d.status IN ('dispatching','accepted','unknown') AND d.expires_at > $3
		  AND decision.expires_at > $3 AND d.claimed_at IS NULL AND d.revoked_at IS NULL
		  AND g.updated_at=d.place_updated_at AND decision.kind=d.decision_kind
		  AND (d.decision_kind <> 'departure_overlap' OR p.departure_overlap_push)
		  AND (d.decision_kind <> 'slow_charging' OR EXISTS (
		    SELECT 1 FROM smart_charging_slow_samples s
		    WHERE s.plan_id=p.id AND s.plan_version=p.version
		      AND s.last_seen_at=decision.evaluated_at
		      AND s.first_seen_at <= decision.evaluated_at - INTERVAL '5 minutes'
		  ))`,
		tokenHash, subject, now).Scan(
		&ref.ID, &ref.PlanID, &ref.VehicleID, &ref.PlanVersion, &ref.PlaceUpdatedAt, &ref.DecisionKind)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find personal charging delivery: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumeDelivery(
	ctx context.Context, subject string, ref domain.DeliveryRef, now time.Time,
) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var planID int64
		// Read candidate evidence in a fresh snapshot after any in-flight plan evaluation.
		err := tx.QueryRow(ctx, `
			SELECT id FROM smart_charging_plans WHERE id=$1 AND subject=$2 AND version=$3 FOR SHARE`,
			ref.PlanID, subject, ref.PlanVersion).Scan(&planID)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock claimed charging plan: %w", err)
		}
		err = tx.QueryRow(ctx, `
			SELECT dev.charging_title, dev.charging_body
			FROM smart_push_deliveries d
			JOIN smart_push_devices dev ON dev.id=d.device_id
			JOIN smart_charging_plans p ON p.id=d.plan_id
			JOIN smart_charging_candidate_decisions decision ON decision.plan_id=p.id
			JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			JOIN geofences g ON g.id=p.charging_place_id AND g.enabled
			  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
			WHERE d.id=$1 AND dev.subject=$2 AND p.subject=$2
			  AND dev.verified_at IS NOT NULL AND dev.charging_enabled
			  AND p.id=$3 AND p.vehicle_id=$4 AND p.version=$5 AND p.version=d.plan_version
			  AND p.enabled AND p.departure_at=d.departure_at
			  AND p.departure_at > $6::timestamptz + INTERVAL '30 minutes'
			  AND (p.snoozed_until IS NULL OR p.snoozed_until <= $6)
			  AND d.status IN ('dispatching','accepted','unknown') AND d.expires_at > $6
			  AND decision.expires_at > $6 AND d.claimed_at IS NULL AND d.revoked_at IS NULL
			  AND g.updated_at=$7 AND d.place_updated_at=$7 AND d.decision_kind=$8
			  AND decision.kind=$8
			  AND ($8 <> 'departure_overlap' OR p.departure_overlap_push)
			  AND ($8 <> 'slow_charging' OR EXISTS (
			    SELECT 1 FROM smart_charging_slow_samples s
			    WHERE s.plan_id=p.id AND s.plan_version=p.version
			      AND s.last_seen_at=decision.evaluated_at
			      AND s.first_seen_at <= decision.evaluated_at - INTERVAL '5 minutes'
			  ))
			FOR SHARE OF dev, v, g FOR UPDATE OF d`,
			ref.ID, subject, planID, ref.VehicleID, ref.PlanVersion, now, ref.PlaceUpdatedAt, ref.DecisionKind).
			Scan(&notification.Title, &notification.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock personal charging delivery: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE smart_push_deliveries SET claimed_at=$2 WHERE id=$1`, ref.ID, now); err != nil {
			return fmt.Errorf("consume personal charging delivery: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	notification.URL = "/action-center?vehicle_id=" + strconv.FormatInt(ref.VehicleID, 10)
	return &notification, nil
}
