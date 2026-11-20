// Package smartdelivery persists verified, subject-owned browser devices.
package smartdelivery

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/jackc/pgx/v5"
)

const deviceColumns = `id, verified_at IS NOT NULL, charging_enabled, commute_enabled, created_at, updated_at`

type Repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) *Repository {
	if db == nil || db.Pool == nil {
		panic("smartdelivery.NewRepository: db and db.Pool must not be nil")
	}
	return &Repository{db: db}
}

func (r *Repository) ListDevices(ctx context.Context, subject string, limit, offset int) ([]domain.Device, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT `+deviceColumns+` FROM smart_push_devices
		WHERE subject=$1 ORDER BY id LIMIT $2 OFFSET $3`, subject, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list personal delivery devices: %w", err)
	}
	defer rows.Close()
	devices := make([]domain.Device, 0)
	for rows.Next() {
		device, scanErr := scanDevice(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan personal delivery device: %w", scanErr)
		}
		devices = append(devices, *device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate personal delivery devices: %w", err)
	}
	return devices, nil
}

func (r *Repository) FindDevice(ctx context.Context, subject string, endpointHash []byte) (*domain.Device, error) {
	device, err := scanDevice(r.db.Pool.QueryRow(ctx, `
		SELECT `+deviceColumns+` FROM smart_push_devices WHERE subject=$1 AND endpoint_hash=$2`,
		subject, endpointHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find personal delivery device: %w", err)
	}
	return device, nil
}

func (r *Repository) SavePending(
	ctx context.Context, subject string, endpointHash []byte, ciphertext string, verificationHash []byte,
	expiresAt time.Time, texts domain.Texts, now time.Time,
) (*domain.Device, error) {
	var saved *domain.Device
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 263))`, subject); err != nil {
			return fmt.Errorf("lock personal delivery owner: %w", err)
		}
		var id int64
		var owner string
		err := tx.QueryRow(ctx, `
			SELECT id, subject FROM smart_push_devices WHERE endpoint_hash=$1 FOR UPDATE`, endpointHash).Scan(&id, &owner)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("check personal delivery device: %w", err)
		}
		if err == nil && owner != subject {
			return port.ErrOwned
		}
		if errors.Is(err, pgx.ErrNoRows) {
			var count int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM smart_push_devices WHERE subject=$1`, subject).Scan(&count); err != nil {
				return fmt.Errorf("count personal delivery devices: %w", err)
			}
			if count >= 10 {
				return port.ErrLimit
			}
			saved, err = scanDevice(tx.QueryRow(ctx, `
				INSERT INTO smart_push_devices
				  (subject, endpoint_hash, subscription_ciphertext, verification_hash, verification_expires_at,
				   verification_title, verification_body, charging_title, charging_body, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
				ON CONFLICT (endpoint_hash) DO NOTHING RETURNING `+deviceColumns,
				subject, endpointHash, ciphertext, verificationHash, expiresAt,
				texts.VerificationTitle, texts.VerificationBody, texts.ChargingTitle, texts.ChargingBody, now))
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrOwned
			}
		} else {
			if err := revokeDeviceDeliveries(ctx, tx, id, now); err != nil {
				return err
			}
			if err := revokeCommuteDeliveries(ctx, tx, id, now); err != nil {
				return err
			}
			saved, err = scanDevice(tx.QueryRow(ctx, `
				UPDATE smart_push_devices
				SET subscription_ciphertext=$3, verification_hash=$4, verification_expires_at=$5,
				    verified_at=NULL, charging_enabled=false, commute_enabled=false,
				    commute_title=NULL, commute_body=NULL,
				    verification_title=$6, verification_body=$7, charging_title=$8, charging_body=$9, updated_at=$10
				WHERE id=$1 AND subject=$2 RETURNING `+deviceColumns,
				id, subject, ciphertext, verificationHash, expiresAt,
				texts.VerificationTitle, texts.VerificationBody, texts.ChargingTitle, texts.ChargingBody, now))
		}
		if err != nil {
			return fmt.Errorf("save personal delivery device: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return saved, nil
}

func (r *Repository) Verify(
	ctx context.Context, subject string, id int64, verificationHash []byte, now time.Time,
) (*domain.Notification, error) {
	var notification domain.Notification
	err := r.db.Pool.QueryRow(ctx, `
		UPDATE smart_push_devices
		SET verified_at=$4, verification_hash=NULL, verification_expires_at=NULL, updated_at=$4
		WHERE id=$1 AND subject=$2 AND verification_hash=$3 AND verification_expires_at > $4
		RETURNING verification_title, verification_body`,
		id, subject, verificationHash, now).Scan(&notification.Title, &notification.Body)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("verify personal delivery device: %w", err)
	}
	notification.URL = "/settings/smart-charging"
	return &notification, nil
}

func (r *Repository) SetChargingEnabled(
	ctx context.Context, subject string, id int64, enabled bool, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_push_devices SET charging_enabled=$3, updated_at=$4
			WHERE id=$1 AND subject=$2 AND verified_at IS NOT NULL`, id, subject, enabled, now)
		if err != nil {
			return fmt.Errorf("update personal delivery preference: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrNotFound
		}
		if !enabled {
			return revokeDeviceDeliveries(ctx, tx, id, now)
		}
		return nil
	})
}

func revokeDeviceDeliveries(ctx context.Context, tx pgx.Tx, id int64, now time.Time) error {
	if _, err := tx.Exec(ctx, `
		UPDATE smart_push_deliveries SET revoked_at=$2
		WHERE device_id=$1 AND revoked_at IS NULL AND claimed_at IS NULL`, id, now); err != nil {
		return fmt.Errorf("revoke pending personal deliveries: %w", err)
	}
	return nil
}

func (r *Repository) DeleteDevice(ctx context.Context, subject string, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_push_devices WHERE id=$1 AND subject=$2`, id, subject)
	if err != nil {
		return fmt.Errorf("delete personal delivery device: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func scanDevice(row pgx.Row) (*domain.Device, error) {
	var device domain.Device
	if err := row.Scan(&device.ID, &device.Verified, &device.ChargingEnabled, &device.CommuteEnabled, &device.CreatedAt, &device.UpdatedAt); err != nil {
		return nil, err
	}
	return &device, nil
}
