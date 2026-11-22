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

var _ port.BackupRepository = (*Repository)(nil)

const backupDeliveryScope = `
	FROM smart_push_devices d
	JOIN smart_backup_charging_watches w ON d.id=w.device_id AND d.subject=w.subject
	  AND d.verified_at=w.device_verified_at AND d.charging_enabled
	JOIN vehicles v ON v.id=w.vehicle_id AND v.archived_at IS NULL
	  AND smart_feature_current(w.subject,'backup_charging',w.feature_checked_at)
	JOIN geofences g ON g.id=w.place_id AND g.enabled AND NOT g.needs_review
	  AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at=w.place_updated_at
	JOIN smart_solar_energy_connections c ON c.subject=w.subject AND c.energy_site_id=w.energy_site_id AND c.state_hash IS NULL`

func (r *Repository) LockBackupDelivery(ctx context.Context, ref port.BackupRef, now time.Time) (port.BackupLease, error) {
	tx, err := r.beginFeatureDispatch(ctx, ref.Subject, smartfeature.BackupCharging)
	if tx == nil {
		return nil, err
	}
	var ciphertext string
	err = tx.QueryRow(ctx, `SELECT d.subscription_ciphertext `+backupDeliveryScope+`
		WHERE w.id=$1 AND w.subject=$2 AND w.vehicle_id=$3 AND w.device_id=$4 AND w.consented_at=$5
		  AND w.outage_started_at=$6 AND w.qualified_at=$7 AND w.watch_until>$8 AND w.qualified_until>$8
		  AND NOT EXISTS (SELECT 1 FROM smart_push_backup_charging_deliveries a
		    WHERE a.watch_id=w.id AND a.consented_at=w.consented_at AND a.outage_started_at=w.outage_started_at)
		FOR SHARE OF w,d,v,g,c`,
		ref.WatchID, ref.Subject, ref.VehicleID, ref.DeviceID, ref.ConsentedAt, ref.OutageStart, ref.ObservedAt, now).Scan(&ciphertext)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock backup charging delivery: %w", err)
	}
	return &backupLease{dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext}, ref: ref}, nil
}

type backupLease struct {
	dispatchLease
	ref port.BackupRef
}

func (l *backupLease) Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error) {
	reserved := false
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.ref.DeviceID, now)
		if err != nil || !allowed {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_push_backup_charging_deliveries
			  (watch_id,device_id,consented_at,outage_started_at,token_hash,status,created_at,expires_at)
			VALUES ($1,$2,$3,$4,$5,'dispatching',$6,$7)
			ON CONFLICT DO NOTHING`, l.ref.WatchID, l.ref.DeviceID, l.ref.ConsentedAt, l.ref.OutageStart, hash, now, expiresAt)
		if err != nil {
			return fmt.Errorf("reserve backup charging delivery: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *backupLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	_, err := l.repository.db.Pool.Exec(ctx, `UPDATE smart_push_backup_charging_deliveries
		SET status=$2 WHERE token_hash=$1 AND status='dispatching'`, hash, status)
	if err != nil {
		return fmt.Errorf("record backup charging delivery: %w", err)
	}
	return nil
}

const backupClaimScope = backupDeliveryScope + `
	JOIN smart_push_backup_charging_deliveries a ON a.watch_id=w.id AND a.device_id=d.id
	  AND a.consented_at=w.consented_at AND a.outage_started_at=w.outage_started_at
	WHERE a.token_hash=$1 AND w.subject=$2 AND a.expires_at>$3 AND w.watch_until>$3
	  AND smart_feature_current(w.subject,'backup_charging',a.feature_enqueued_at)
	  AND w.qualified_at >= w.qualified_from+INTERVAL '30 seconds' AND w.qualified_until>$3
	  AND a.claimed_at IS NULL AND a.status IN ('dispatching','accepted','unknown')`

func (r *Repository) FindBackupDelivery(ctx context.Context, subject string, hash []byte, now time.Time) (*port.BackupRef, error) {
	ref := port.BackupRef{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `SELECT w.id,w.vehicle_id,d.id,w.consented_at,w.outage_started_at,w.qualified_at,a.expires_at `+
		backupClaimScope, hash, subject, now).Scan(&ref.WatchID, &ref.VehicleID, &ref.DeviceID, &ref.ConsentedAt,
		&ref.OutageStart, &ref.ObservedAt, &ref.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find backup charging token: %w", err)
	}
	return &ref, nil
}

func (r *Repository) ConsumeBackupDelivery(ctx context.Context, ref port.BackupRef, hash []byte, deadline time.Time, clock func() time.Time) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.withFeatureClaim(ctx, ref.Subject, smartfeature.BackupCharging, func(tx pgx.Tx) error {
		var persistedDeadline time.Time
		err := tx.QueryRow(ctx, `SELECT d.charging_title,d.charging_body,LEAST(a.expires_at,w.watch_until,w.qualified_until) `+backupClaimScope+`
			AND w.id=$4 AND w.qualified_at=$5
			FOR SHARE OF w,d,v,g,c FOR UPDATE OF a`,
			hash, ref.Subject, clock().UTC(), ref.WatchID, ref.ObservedAt).Scan(&notification.Title, &notification.Body, &persistedDeadline)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock backup charging token: %w", err)
		}
		now := clock().UTC()
		if !now.Before(persistedDeadline) || !now.Before(deadline) {
			return port.ErrNotFound
		}
		if _, err := tx.Exec(ctx, `UPDATE smart_push_backup_charging_deliveries SET claimed_at=$2 WHERE token_hash=$1`, hash, now); err != nil {
			return fmt.Errorf("consume backup charging token: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &notification, nil
}

func (r *Repository) PruneBackupDeliveries(ctx context.Context, before time.Time) error {
	_, err := r.db.Pool.Exec(ctx, `WITH expired_watches AS (
		DELETE FROM smart_backup_charging_watches WHERE id IN (
			SELECT id FROM smart_backup_charging_watches WHERE watch_until<$1 ORDER BY watch_until LIMIT 1000)
	)
	DELETE FROM smart_push_backup_charging_deliveries WHERE token_hash IN (
		SELECT token_hash FROM smart_push_backup_charging_deliveries WHERE created_at<$1 ORDER BY created_at LIMIT 1000
	)`, before)
	if err != nil {
		return fmt.Errorf("prune backup charging delivery metadata: %w", err)
	}
	return nil
}
