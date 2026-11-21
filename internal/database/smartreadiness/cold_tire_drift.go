package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.ColdTireRepository = (*Repository)(nil)

func (r *Repository) ReadColdTireReview(ctx context.Context, scope port.ColdTireScope, now time.Time) (domain.ColdTireReview, error) {
	var review domain.ColdTireReview
	var corner *domain.TireCorner
	var drift domain.ColdTireDrift
	err := r.db.Pool.QueryRow(ctx, `SELECT COALESCE(c.id,0),COALESCE(c.reading_count,0),c.last_reading_at,
		c.corner,COALESCE(c.comparable_count,0),COALESCE(c.baseline_at,'epoch'::timestamptz),
		COALESCE(c.expires_at,'epoch'::timestamptz),COALESCE(c.relative_drop_pa,0),COALESCE(c.last_gauge_pressure_pa,0)
		FROM vehicles v LEFT JOIN smart_cold_tire_reviews c ON c.vehicle_id=v.id AND c.subject=$1
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&review.SeriesID, &review.ReadingCount, &review.LastReading, &corner, &drift.Count, &drift.BaselineAt,
			&drift.ExpiresAt, &drift.RelativeDropPa, &drift.LastGaugePressurePa)
	if errors.Is(err, pgx.ErrNoRows) {
		return review, port.ErrNotFound
	}
	if err != nil {
		return review, fmt.Errorf("read private cold tire review: %w", err)
	}
	if corner != nil && review.LastReading != nil && drift.ExpiresAt.After(now) {
		drift.Corner, drift.ObservedAt = *corner, *review.LastReading
		review.Drift = &drift
	}
	return review, nil
}

func (r *Repository) AppendColdTireReading(ctx context.Context, scope port.ColdTireScope, expectedID int64, reading domain.ColdTireReading,
	window port.ColdTireWindow, evaluate port.ColdTireEvaluator,
) (domain.ColdTireDriftReason, bool, error) {
	var reason domain.ColdTireDriftReason
	var published bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		key, err := lockColdTireSeries(ctx, tx, scope, expectedID)
		if err != nil {
			return err
		}
		if key.last != nil && reading.ObservedAt.Before(key.last.Add(window.MinSpacing)) {
			return port.ErrColdTireSeriesChanged
		}
		if err := writeColdTireReading(ctx, tx, key.id, reading, window.From); err != nil {
			return err
		}
		rows, err := readColdTireSeries(ctx, tx, key.id)
		if err != nil {
			return err
		}
		drift, outcome := evaluate(rows)
		published = drift != nil && (key.corner == nil || *key.corner != drift.Corner ||
			key.expires == nil || !key.expires.After(window.Now))
		if err := saveColdTireReview(ctx, tx, key.id, len(rows), reading.ObservedAt, drift, published); err != nil {
			return err
		}
		reason = outcome
		return nil
	})
	if err != nil {
		return "", false, err
	}
	return reason, published, nil
}

type coldTireSeriesKey struct {
	id      int64
	last    *time.Time
	corner  *domain.TireCorner
	expires *time.Time
}

func lockColdTireSeries(ctx context.Context, tx pgx.Tx, scope port.ColdTireScope, expectedID int64) (coldTireSeriesKey, error) {
	var key coldTireSeriesKey
	if expectedID == 0 {
		err := tx.QueryRow(ctx, `INSERT INTO smart_cold_tire_reviews(subject,vehicle_id)
			SELECT $1,id FROM vehicles WHERE id=$2 AND archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING RETURNING id`, scope.Subject, scope.VehicleID).Scan(&key.id)
		if errors.Is(err, pgx.ErrNoRows) {
			return key, port.ErrColdTireSeriesChanged
		}
		if err != nil {
			return key, fmt.Errorf("start private cold tire series: %w", err)
		}
		return key, nil
	}
	err := tx.QueryRow(ctx, `SELECT c.id,c.last_reading_at,c.corner,c.expires_at
		FROM smart_cold_tire_reviews c JOIN vehicles v ON v.id=c.vehicle_id AND v.archived_at IS NULL
		WHERE c.subject=$1 AND c.vehicle_id=$2 AND c.id=$3 FOR UPDATE OF c`,
		scope.Subject, scope.VehicleID, expectedID).Scan(&key.id, &key.last, &key.corner, &key.expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return key, port.ErrColdTireSeriesChanged
	}
	if err != nil {
		return key, fmt.Errorf("lock private cold tire series: %w", err)
	}
	return key, nil
}

func writeColdTireReading(ctx context.Context, tx pgx.Tx, seriesID int64, reading domain.ColdTireReading, from time.Time) error {
	if _, err := tx.Exec(ctx, `DELETE FROM smart_cold_tire_readings WHERE review_id=$1 AND observed_at<$2`, seriesID, from); err != nil {
		return fmt.Errorf("prune expired cold gauge readings: %w", err)
	}
	_, err := tx.Exec(ctx, `INSERT INTO smart_cold_tire_readings
		(review_id,observed_at,ambient_c,front_left_pa,front_right_pa,rear_left_pa,rear_right_pa) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		seriesID, reading.ObservedAt, reading.AmbientC, reading.FrontLeftPa, reading.FrontRightPa, reading.RearLeftPa, reading.RearRightPa)
	if err != nil {
		return fmt.Errorf("record private cold gauge readings: %w", err)
	}
	return nil
}

func readColdTireSeries(ctx context.Context, tx pgx.Tx, seriesID int64) ([]domain.ColdTireReading, error) {
	rows, err := tx.Query(ctx, `SELECT observed_at,ambient_c,front_left_pa,front_right_pa,rear_left_pa,rear_right_pa
		FROM smart_cold_tire_readings WHERE review_id=$1 ORDER BY observed_at DESC LIMIT 41`, seriesID)
	if err != nil {
		return nil, fmt.Errorf("read private cold gauge series: %w", err)
	}
	result, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.ColdTireReading, error) {
		value := domain.ColdTireReading{ColdGaugeConfirmed: true}
		err := row.Scan(&value.ObservedAt, &value.AmbientC, &value.FrontLeftPa, &value.FrontRightPa, &value.RearLeftPa, &value.RearRightPa)
		return value, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan private cold gauge series: %w", err)
	}
	return result, nil
}

func saveColdTireReview(ctx context.Context, tx pgx.Tx, seriesID int64, count int, at time.Time, drift *domain.ColdTireDrift, published bool) error {
	var corner *domain.TireCorner
	var comparable *int
	var baseline, expires *time.Time
	var drop, gauge *float64
	if drift != nil {
		corner, comparable, baseline, expires = &drift.Corner, &drift.Count, &drift.BaselineAt, &drift.ExpiresAt
		drop, gauge = &drift.RelativeDropPa, &drift.LastGaugePressurePa
	}
	var next int
	if published {
		next = 1
	}
	_, err := tx.Exec(ctx, `UPDATE smart_cold_tire_reviews SET reading_count=$2,last_reading_at=$3,corner=$4,
		comparable_count=$5,baseline_at=$6,expires_at=$7,relative_drop_pa=$8,last_gauge_pressure_pa=$9,
		occurrence=occurrence+$10::bigint WHERE id=$1`,
		seriesID, count, at, corner, comparable, baseline, expires, drop, gauge, next)
	if err != nil {
		return fmt.Errorf("persist private cold tire evaluation: %w", err)
	}
	return nil
}

func (r *Repository) DeleteColdTireReview(ctx context.Context, scope port.ColdTireScope, seriesID int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_cold_tire_reviews WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, seriesID)
	if err != nil {
		return fmt.Errorf("delete private cold gauge series: %w", err)
	}
	return nil
}

func (r *Repository) ListColdTireDrift(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]port.ColdTireCandidate, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT c.vehicle_id,v.display_name,c.id,c.occurrence,c.corner,c.comparable_count,
		c.baseline_at,c.last_reading_at,c.expires_at,c.relative_drop_pa,c.last_gauge_pressure_pa
		FROM smart_cold_tire_reviews c JOIN vehicles v ON v.id=c.vehicle_id AND v.archived_at IS NULL
		WHERE c.subject=$1 AND ($2::bigint IS NULL OR c.vehicle_id=$2) AND c.expires_at>$3
		ORDER BY c.expires_at,c.id LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list private cold tire decisions: %w", err)
	}
	candidates, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.ColdTireCandidate, error) {
		var item port.ColdTireCandidate
		d := &item.Drift
		err := row.Scan(&item.VehicleID, &item.VehicleName, &item.ReviewID, &item.Occurrence, &d.Corner, &d.Count,
			&d.BaselineAt, &d.ObservedAt, &d.ExpiresAt, &d.RelativeDropPa, &d.LastGaugePressurePa)
		return item, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan private cold tire decisions: %w", err)
	}
	return candidates, nil
}
