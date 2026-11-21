package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/jackc/pgx/v5"
)

var _ port.PublicFeeRepository = (*Repository)(nil)

const activePublicFeeTerms = `
	FROM smart_public_charging_fee_terms p
	JOIN vehicles v ON v.id = p.vehicle_id AND v.archived_at IS NULL
	JOIN geofences g ON g.id = p.place_id AND g.enabled AND NOT g.needs_review
	  AND g.archived_at IS NULL AND g.is_charging_location AND g.updated_at = p.place_updated_at`

func (r *Repository) SavePublicFeeTerms(ctx context.Context, terms domain.PublicFeeTerms) error {
	tag, err := r.db.Pool.Exec(ctx, `
		INSERT INTO smart_public_charging_fee_terms AS p (
		  subject, vehicle_id, place_id, place_updated_at, confirmed_unconditional, currency,
		  fee_per_minute_minor, grace_s, source_url, confirmed_at, valid_until,
		  push_device_id, push_device_verified_at, push_title, push_body)
		SELECT $1, v.id, g.id, g.updated_at, $4, $5, $6, $7, $8, $9, $10,
		  dev.id, dev.verified_at, NULLIF($13, ''), NULLIF($14, '')
		FROM vehicles v JOIN geofences g ON g.id = $3
		LEFT JOIN smart_push_devices dev ON dev.id = $12 AND dev.subject = $1 AND dev.verified_at IS NOT NULL
		WHERE v.id = $2 AND v.archived_at IS NULL AND g.enabled
		  AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
		  AND g.updated_at = $11 AND ($12::bigint IS NULL OR dev.id IS NOT NULL)
		ON CONFLICT (subject, vehicle_id) DO UPDATE SET
		  place_id = EXCLUDED.place_id, place_updated_at = EXCLUDED.place_updated_at,
		  confirmed_unconditional = EXCLUDED.confirmed_unconditional, currency = EXCLUDED.currency,
		  fee_per_minute_minor = EXCLUDED.fee_per_minute_minor, grace_s = EXCLUDED.grace_s,
		  source_url = EXCLUDED.source_url, confirmed_at = EXCLUDED.confirmed_at, valid_until = EXCLUDED.valid_until,
		  push_device_id = EXCLUDED.push_device_id, push_device_verified_at = EXCLUDED.push_device_verified_at,
		  push_title = EXCLUDED.push_title, push_body = EXCLUDED.push_body
		WHERE p.confirmed_at < EXCLUDED.confirmed_at`,
		terms.Subject, terms.VehicleID, terms.PlaceID, terms.ConfirmedUnconditional, terms.Currency,
		terms.FeePerMinuteMinor, terms.GraceS, terms.SourceURL, terms.ConfirmedAt, terms.ValidUntil, terms.PlaceUpdatedAt,
		terms.PushDeviceID, terms.PushTitle, terms.PushBody)
	if err != nil {
		return fmt.Errorf("save reviewed public charging terms: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func (r *Repository) DeletePublicFeeTerms(ctx context.Context, subject string, vehicleID int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_public_charging_fee_terms WHERE subject = $1 AND vehicle_id = $2`, subject, vehicleID)
	if err != nil {
		return fmt.Errorf("delete reviewed public charging terms: %w", err)
	}
	return nil
}

func (r *Repository) HasPublicFeeTerms(ctx context.Context, subject string, vehicleID int64) (bool, error) {
	var exists bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM smart_public_charging_fee_terms WHERE subject = $1 AND vehicle_id = $2
		)`, subject, vehicleID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check saved public charging fee terms: %w", err)
	}
	return exists, nil
}

func (r *Repository) PrunePublicFeeDeliveries(ctx context.Context, now time.Time) error {
	if _, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_push_public_fee_deliveries a
		USING (
		  SELECT subject, vehicle_id, session_id FROM smart_push_public_fee_deliveries
		  WHERE expires_at < $1::timestamptz - INTERVAL '48 hours'
		  ORDER BY expires_at LIMIT 200
		  FOR UPDATE SKIP LOCKED
		) expired
		WHERE a.subject = expired.subject AND a.vehicle_id = expired.vehicle_id AND a.session_id = expired.session_id`,
		now); err != nil {
		return fmt.Errorf("prune expired public charging fee attempts: %w", err)
	}
	return nil
}

func (r *Repository) FindPublicFeeTerms(ctx context.Context, subject string, vehicleID int64, now time.Time) (*domain.PublicFeeTerms, error) {
	var terms domain.PublicFeeTerms
	err := r.db.Pool.QueryRow(ctx, `
		SELECT p.subject, p.vehicle_id, p.place_id, p.place_updated_at, p.confirmed_unconditional,
		  p.currency, p.fee_per_minute_minor, p.grace_s, p.source_url, p.confirmed_at, p.valid_until,
		  dev.id, COALESCE(p.push_title, ''), COALESCE(p.push_body, '')
		`+activePublicFeeTerms+`
		LEFT JOIN smart_push_devices dev ON dev.id = p.push_device_id AND dev.subject = p.subject
		  AND dev.verified_at = p.push_device_verified_at
		WHERE p.subject = $1 AND p.vehicle_id = $2 AND p.confirmed_at <= $3 AND p.valid_until > $3`,
		subject, vehicleID, now).Scan(&terms.Subject, &terms.VehicleID, &terms.PlaceID, &terms.PlaceUpdatedAt,
		&terms.ConfirmedUnconditional, &terms.Currency, &terms.FeePerMinuteMinor, &terms.GraceS,
		&terms.SourceURL, &terms.ConfirmedAt, &terms.ValidUntil, &terms.PushDeviceID, &terms.PushTitle, &terms.PushBody)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read reviewed public charging terms: %w", err)
	}
	return &terms, nil
}

func (r *Repository) ListDuePublicFeeRecipients(ctx context.Context, now time.Time, limit int) ([]domain.PublicFeeRecipient, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT p.subject, p.vehicle_id
		`+activePublicFeeTerms+`
		JOIN smart_push_devices dev ON dev.id = p.push_device_id AND dev.subject = p.subject
		  AND dev.verified_at = p.push_device_verified_at
		JOIN LATERAL (
		  SELECT c.id, c.ended_at FROM charging_sessions c
		  WHERE c.vehicle_id = p.vehicle_id AND c.geofence_id = p.place_id
		    AND c.ended_at > GREATEST(p.confirmed_at, $1::timestamptz - INTERVAL '2 minutes') AND c.ended_at <= $1
		  ORDER BY c.ended_at DESC LIMIT 1
		) recent ON true
		WHERE p.confirmed_at <= $1 AND p.valid_until > $1
		  AND NOT EXISTS (
		    SELECT 1 FROM smart_push_public_fee_deliveries a
		    WHERE a.subject = p.subject AND a.vehicle_id = p.vehicle_id AND a.session_id = recent.id
		  )
		ORDER BY recent.ended_at, p.vehicle_id, p.subject LIMIT $2`, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list due public charging fee recipients: %w", err)
	}
	recipients, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.PublicFeeRecipient, error) {
		var recipient domain.PublicFeeRecipient
		err := row.Scan(&recipient.Subject, &recipient.VehicleID)
		return recipient, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan due public charging fee recipients: %w", err)
	}
	return recipients, nil
}

func (r *Repository) FindPublicChargeCompletion(
	ctx context.Context, terms domain.PublicFeeTerms, now time.Time,
) (*domain.PublicChargeCompletion, error) {
	// Match one closed durable session before reading its change feed. The first
	// Complete after the last non-Complete is the upper bound; repeated Complete
	// samples must not reset the fee clock. Positive charging power may narrow
	// the lower bound when the sparse Charging transition is older.
	var completion domain.PublicChargeCompletion
	err := r.db.Pool.QueryRow(ctx, `
		WITH recent AS MATERIALIZED (
		  SELECT c.id, p.vehicle_id, p.place_id, p.confirmed_at, c.started_at, c.ended_at
		  `+activePublicFeeTerms+`
		  JOIN charging_sessions c ON c.vehicle_id = p.vehicle_id
		  WHERE p.subject = $1 AND p.vehicle_id = $2 AND p.place_id = $3
		    AND p.place_updated_at = $4 AND p.confirmed_at = $5
		    AND p.confirmed_at <= $6 AND p.valid_until > $6
		    AND c.ended_at > $6::timestamptz - INTERVAL '2 minutes' AND c.ended_at <= $6
		    AND c.started_at < c.ended_at
		  ORDER BY c.ended_at DESC LIMIT 2
		)
		SELECT c.id, c.vehicle_id, c.place_id, GREATEST(prior.ts, power.ts), completed.ts
		FROM recent c
		JOIN charging_sessions session ON session.id = c.id AND session.geofence_id = c.place_id
		CROSS JOIN LATERAL (
		  SELECT ts, value_kind, int_value FROM signal_log
		  WHERE vehicle_id = c.vehicle_id AND field = 'DetailedChargeState'
		    AND ts >= GREATEST(c.started_at, c.confirmed_at, $6::timestamptz - INTERVAL '90 minutes') AND ts <= $6
		    AND (value_kind, int_value) IS DISTINCT FROM ($7::smallint, $8::bigint)
		  ORDER BY ts DESC LIMIT 1
		) prior
		CROSS JOIN LATERAL (
		  SELECT ts FROM signal_log
		  WHERE vehicle_id = c.vehicle_id AND field = 'DetailedChargeState'
		    AND ts > prior.ts AND ts <= $6 AND value_kind = $7 AND int_value = $8
		  ORDER BY ts LIMIT 1
		) completed
		LEFT JOIN LATERAL (
		  SELECT MAX(ts) AS ts FROM signal_log
		  WHERE vehicle_id = c.vehicle_id AND field IN ('ACChargingPower', 'DCChargingPower')
		    AND ts >= GREATEST(prior.ts, completed.ts - INTERVAL '3 minutes')
		    AND ts < LEAST(completed.ts, c.ended_at)
		    AND value_kind IN ($10, $11) AND float_value >= 100 AND float_value < 'Infinity'::float8
		) power ON true
		WHERE (SELECT count(*) FROM recent) = 1 AND prior.value_kind = $7 AND prior.int_value = $9
		  AND completed.ts >= c.ended_at - INTERVAL '30 seconds'
		  AND completed.ts <= c.ended_at + INTERVAL '30 seconds'
		  AND completed.ts - GREATEST(prior.ts, power.ts) <= INTERVAL '3 minutes'`,
		terms.Subject, terms.VehicleID, terms.PlaceID, terms.PlaceUpdatedAt, terms.ConfirmedAt, now,
		protomodel.ValueKindEnum, protomodel.DetailedChargeStateValue_DetailedChargeStateComplete,
		protomodel.DetailedChargeStateValue_DetailedChargeStateCharging,
		protomodel.ValueKindFloat, protomodel.ValueKindDouble).Scan(
		&completion.SessionID, &completion.VehicleID, &completion.PlaceID, &completion.ChargingAt, &completion.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read matched public charge completion: %w", err)
	}
	return &completion, nil
}
