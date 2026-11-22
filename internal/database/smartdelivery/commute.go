package smartdelivery

import (
	"context"
	"errors"
	"fmt"
	"time"

	commute "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/jackc/pgx/v5"
)

func reserveBudget(ctx context.Context, tx pgx.Tx, deviceID int64, now time.Time) (bool, error) {
	if _, err := tx.Exec(ctx, `
		SELECT pg_advisory_xact_lock(hashtextextended('smart-push:' || ($1::bigint)::text, 263))`, deviceID); err != nil {
		return false, fmt.Errorf("lock personal push budget: %w", err)
	}
	var count int
	var latest *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT count(*), max(created_at) FROM (
			SELECT created_at FROM smart_push_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_commute_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_public_fee_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_cabin_prep_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_park_reserve_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_window_rain_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_parked_closure_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_parked_unlock_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
			UNION ALL
			SELECT created_at FROM smart_push_backup_charging_deliveries
			WHERE device_id=$1 AND created_at >= $2::timestamptz - INTERVAL '24 hours'
		) attempts`, deviceID, now).Scan(&count, &latest); err != nil {
		return false, fmt.Errorf("read personal push budget: %w", err)
	}
	return count < 4 && (latest == nil || !latest.After(now.Add(-time.Hour))), nil
}

func (r *Repository) SetCommuteEnabled(
	ctx context.Context, subject string, id int64, enabled bool, copy domain.Copy, now time.Time,
) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 263))`, subject); err != nil {
			return fmt.Errorf("lock commute delivery owner: %w", err)
		}
		if enabled {
			var previous int64
			err := tx.QueryRow(ctx, `
				UPDATE smart_push_devices
				SET commute_enabled=false, commute_title=NULL, commute_body=NULL, updated_at=$3
				WHERE subject=$1 AND id<>$2 AND commute_enabled RETURNING id`, subject, id, now).Scan(&previous)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("replace selected commute browser: %w", err)
			}
			if err == nil {
				if err := revokeCommuteDeliveries(ctx, tx, previous, now); err != nil {
					return err
				}
			}
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_push_devices
			SET commute_enabled=$3, commute_title=CASE WHEN $3 THEN $4 END,
			    commute_body=CASE WHEN $3 THEN $5 END, updated_at=$6
			WHERE id=$1 AND subject=$2 AND verified_at IS NOT NULL`,
			id, subject, enabled, copy.Title, copy.Body, now)
		if err != nil {
			return fmt.Errorf("save commute delivery preference: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return port.ErrNotFound
		}
		if !enabled {
			return revokeCommuteDeliveries(ctx, tx, id, now)
		}
		return nil
	})
}

func revokeCommuteDeliveries(ctx context.Context, tx pgx.Tx, id int64, now time.Time) error {
	if _, err := tx.Exec(ctx, `
		UPDATE smart_push_commute_deliveries SET revoked_at=$2
		WHERE device_id=$1 AND revoked_at IS NULL AND claimed_at IS NULL`, id, now); err != nil {
		return fmt.Errorf("revoke pending commute deliveries: %w", err)
	}
	return nil
}

const commuteDeliveryScope = `
	FROM smart_commute_traffic_decisions d
	JOIN smart_commute_traffic_consent c ON c.id=d.consent_id AND NOT d.route_energy_only
	JOIN smart_commute_routines r ON r.id=c.routine_id AND r.status='confirmed'
	JOIN smart_commute_settings s ON s.subject=r.subject AND s.vehicle_id=r.vehicle_id
	  AND s.updated_at=d.settings_updated_at AND s.enabled AND s.local_analysis_enabled AND NOT s.paused
	JOIN smart_commute_traffic_occurrences o ON o.routine_id=r.id AND o.departure_at=d.departure_at AND NOT o.skipped
	  AND smart_feature_current(r.subject,'traffic_advice',o.feature_claimed_at)
	JOIN vehicles v ON v.id=r.vehicle_id AND v.archived_at IS NULL`

func (r *Repository) LockCommute(
	ctx context.Context, subject string, occurrence domain.CommuteOccurrence, now time.Time,
) (port.CommuteLease, error) {
	tx, err := r.beginFeatureDispatch(ctx, subject, smartfeature.TrafficAdvice)
	if err != nil || tx == nil {
		return nil, err
	}
	candidate := domain.CommuteDelivery{Occurrence: occurrence}
	var deviceID int64
	var ciphertext string
	var checkAt, observedAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT dev.id, dev.subscription_ciphertext, r.vehicle_id, r.origin_latitude, r.origin_longitude, d.expires_at,
		       o.departure_at - make_interval(secs => c.lead_s), d.observed_at
		`+commuteDeliveryScope+`
		JOIN smart_push_devices dev ON dev.subject=r.subject AND dev.verified_at IS NOT NULL AND dev.commute_enabled
		WHERE r.subject=$1 AND c.id=$2 AND r.id=$3 AND d.departure_at=$4 AND d.expires_at > $5
		  AND here_estimates_usable(d.observed_at)
		  AND NOT smart_commute_drive_started(r.vehicle_id, o.departure_at - make_interval(secs => c.lead_s), $5)
		FOR SHARE OF dev, r, s, v, c, d, o`,
		subject, occurrence.ConsentID, occurrence.RoutineID, occurrence.DepartureAt, now).Scan(
		&deviceID, &ciphertext, &candidate.VehicleID, &candidate.Origin.Latitude, &candidate.Origin.Longitude,
		&candidate.ExpiresAt, &checkAt, &observedAt)
	if err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lock personal commute dispatch: %w", err)
	}
	return &commuteLease{
		dispatchLease: dispatchLease{repository: r, tx: tx, ciphertext: ciphertext},
		candidate:     candidate, deviceID: deviceID, checkAt: checkAt, observedAt: observedAt,
	}, nil
}

type commuteLease struct {
	dispatchLease
	candidate  domain.CommuteDelivery
	deviceID   int64
	checkAt    time.Time
	observedAt time.Time
}

func (l *commuteLease) Candidate() domain.CommuteDelivery { return l.candidate }

func (l *commuteLease) DispatchEligible(ctx context.Context, now time.Time) (bool, error) {
	var eligible bool
	if err := l.tx.QueryRow(ctx, `
		SELECT NOT smart_commute_drive_started($1, $2, $3) AND here_estimates_usable($4)`,
		l.candidate.VehicleID, l.checkAt, now, l.observedAt).Scan(&eligible); err != nil {
		return false, fmt.Errorf("recheck departure and upstream estimates before personal commute delivery: %w", err)
	}
	return eligible, nil
}

func (l *commuteLease) Reserve(ctx context.Context, hash []byte, now time.Time) (bool, error) {
	var reserved bool
	err := l.repository.db.WithTx(ctx, func(tx pgx.Tx) error {
		allowed, err := reserveBudget(ctx, tx, l.deviceID, now)
		if err != nil || !allowed {
			return err
		}
		occ := l.candidate.Occurrence
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_push_commute_deliveries
			  (device_id, routine_id, consent_id, departure_at, token_hash, status, created_at, expires_at)
			VALUES ($1,$2,$3,$4,$5,'dispatching',$6,$7)
			ON CONFLICT DO NOTHING`, l.deviceID, occ.RoutineID, occ.ConsentID, occ.DepartureAt,
			hash, now, l.candidate.ExpiresAt)
		if err != nil {
			return fmt.Errorf("reserve personal commute dispatch: %w", err)
		}
		reserved = tag.RowsAffected() == 1
		return nil
	})
	return reserved, err
}

func (l *commuteLease) Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error {
	if _, err := l.repository.db.Pool.Exec(ctx, `
		UPDATE smart_push_commute_deliveries SET status=$2 WHERE token_hash=$1 AND status='dispatching'`,
		hash, status); err != nil {
		return fmt.Errorf("finish personal commute dispatch: %w", err)
	}
	return nil
}

const commuteClaimScope = commuteDeliveryScope + `
	JOIN smart_push_commute_deliveries a ON a.routine_id=r.id AND a.consent_id=c.id AND a.departure_at=d.departure_at
	JOIN smart_push_devices dev ON dev.id=a.device_id
	WHERE a.token_hash=$1 AND dev.subject=$2 AND r.subject=$2 AND dev.verified_at IS NOT NULL AND dev.commute_enabled
	  AND smart_feature_current(r.subject,'traffic_advice',a.feature_enqueued_at)
	  AND a.status IN ('dispatching','accepted','unknown') AND a.claimed_at IS NULL AND a.revoked_at IS NULL
	  AND a.expires_at > $3 AND d.expires_at > $3
	  AND here_estimates_usable(d.observed_at)
	  AND NOT smart_commute_drive_started(r.vehicle_id, o.departure_at - make_interval(secs => c.lead_s), $3)`

func (r *Repository) FindCommuteDelivery(
	ctx context.Context, subject string, hash []byte, now time.Time,
) (*domain.CommuteDelivery, error) {
	var result domain.CommuteDelivery
	err := r.db.Pool.QueryRow(ctx, `
		SELECT c.id, r.id, d.departure_at, r.vehicle_id, r.origin_latitude, r.origin_longitude, LEAST(a.expires_at, d.expires_at)
		`+commuteClaimScope, hash, subject, now).Scan(
		&result.Occurrence.ConsentID, &result.Occurrence.RoutineID, &result.Occurrence.DepartureAt,
		&result.VehicleID, &result.Origin.Latitude, &result.Origin.Longitude, &result.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find personal commute claim: %w", err)
	}
	return &result, nil
}

func (r *Repository) ConsumeCommuteDelivery(
	ctx context.Context, subject string, hash []byte, now time.Time,
) (*domain.Notification, error) {
	var result domain.Notification
	err := r.withFeatureClaim(ctx, subject, smartfeature.TrafficAdvice, func(tx pgx.Tx) error {
		var id, routineID, vehicleID int64
		var departure time.Time
		err := tx.QueryRow(ctx, `
			SELECT a.id, r.id, r.vehicle_id, a.departure_at, dev.commute_title, dev.commute_body
			`+commuteClaimScope+` FOR SHARE OF dev, r, s, v, c, d, o`, hash, subject, now).Scan(
			&id, &routineID, &vehicleID, &departure, &result.Title, &result.Body)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock personal commute claim: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_push_commute_deliveries SET claimed_at=$2
			WHERE id=$1 AND claimed_at IS NULL AND revoked_at IS NULL AND status IN ('dispatching','accepted','unknown')`, id, now)
		if err != nil {
			return fmt.Errorf("consume personal commute claim: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrNotFound
		}
		result.URL = commute.TrafficComparisonPath(vehicleID, commute.TrafficOccurrenceID(routineID, departure))
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}
