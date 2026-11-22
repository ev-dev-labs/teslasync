package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

var _ port.CapacityTrendRepository = (*Repository)(nil)

func (r *Repository) ListCapacityChargeWindows(ctx context.Context, vehicleID int64, from, to time.Time, limit int) ([]domain.CapacityChargeWindow, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT c.id,c.started_at,c.ended_at FROM charging_sessions c
		JOIN vehicles v ON v.id=c.vehicle_id AND v.archived_at IS NULL
		WHERE c.vehicle_id=$1 AND c.started_at>=$2 AND c.started_at<$3 AND c.ended_at<=$3
		  AND c.ended_at-c.started_at BETWEEN INTERVAL '20 minutes' AND INTERVAL '10 hours'
		  AND NOT EXISTS (
			SELECT 1 FROM charging_sessions other WHERE other.vehicle_id=c.vehicle_id AND other.id<>c.id
			  AND other.started_at<c.ended_at AND (other.ended_at IS NULL OR other.ended_at>c.started_at)
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM drives d WHERE d.vehicle_id=c.vehicle_id AND d.started_at<c.ended_at
			  AND (d.ended_at IS NULL OR d.ended_at>c.started_at)
		  )
		ORDER BY c.started_at,c.id LIMIT $4`, vehicleID, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("list bounded completed charge windows: %w", err)
	}
	windows, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.CapacityChargeWindow, error) {
		var w domain.CapacityChargeWindow
		err := row.Scan(&w.SessionID, &w.StartAt, &w.EndAt)
		return w, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan completed charge windows: %w", err)
	}
	return windows, nil
}

const capacitySourcesStillCovered = `NOT EXISTS (
	SELECT 1 FROM unnest(e.session_ids,e.sample_starts,e.sample_ends) AS n(session_id,start_at,end_at)
	LEFT JOIN charging_sessions c ON c.id=n.session_id AND c.vehicle_id=p.vehicle_id
		AND c.started_at<=n.start_at AND c.ended_at>=n.end_at
	WHERE c.id IS NULL OR EXISTS (
		SELECT 1 FROM drives d WHERE d.vehicle_id=p.vehicle_id AND d.started_at<c.ended_at
			AND (d.ended_at IS NULL OR d.ended_at>c.started_at)
	) OR EXISTS (
		SELECT 1 FROM charging_sessions o WHERE o.vehicle_id=p.vehicle_id AND o.id<>n.session_id
			AND o.started_at<c.ended_at AND (o.ended_at IS NULL OR o.ended_at>c.started_at)
	)
)`

func (r *Repository) ReadCapacityTrend(ctx context.Context, scope port.CapacityTrendScope, now time.Time) (domain.CapacityTrendSettings, error) {
	var out domain.CapacityTrendSettings
	var plan domain.CapacityTrendPlan
	var evidence domain.CapacityTrendDigest
	var baseline, recent, end, through, expiry *time.Time
	var ids []int64
	var starts, ends []time.Time
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),COALESCE(p.time_zone,''),p.next_check_at IS NULL,
		       e.baseline_from,e.recent_from,e.recent_to,e.observed_to,e.expires_at,
		       COALESCE(e.baseline_low_wh,0),COALESCE(e.baseline_high_wh,0),COALESCE(e.recent_low_wh,0),COALESCE(e.recent_high_wh,0),
		       COALESCE(e.baseline_days,0),COALESCE(e.recent_days,0),e.evidence_fingerprint,
		       e.session_ids,windows.starts,windows.ends
		FROM vehicles v
		LEFT JOIN smart_capacity_trend_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN smart_capacity_trend_digests e ON e.plan_id=p.id AND e.expires_at>$3
			AND e.dismissed_at IS NULL AND p.next_check_at IS NOT NULL AND e.evidence_fingerprint IS NOT NULL
			AND smart_feature_current(p.subject,'capacity_trend',p.feature_checked_at)
			AND `+capacitySourcesStillCovered+`
		LEFT JOIN LATERAL (
			SELECT array_agg(c.started_at ORDER BY n.ordinal) AS starts, array_agg(c.ended_at ORDER BY n.ordinal) AS ends
			FROM unnest(e.session_ids) WITH ORDINALITY AS n(session_id,ordinal)
			JOIN charging_sessions c ON c.id=n.session_id AND c.vehicle_id=p.vehicle_id
		) windows ON e.plan_id IS NOT NULL
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, now).
		Scan(&plan.ID, &plan.TimeZone, &plan.Paused, &baseline, &recent, &end, &through, &expiry,
			&evidence.Baseline.LowWh, &evidence.Baseline.HighWh, &evidence.Recent.LowWh, &evidence.Recent.HighWh,
			&evidence.BaselineDays, &evidence.RecentDays, &evidence.EvidenceFingerprint, &ids, &starts, &ends)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, port.ErrNotFound
	}
	if err != nil {
		return out, fmt.Errorf("read private monthly capacity digest: %w", err)
	}
	if plan.ID != 0 {
		out.Plan = &plan
	}
	if baseline != nil && recent != nil && end != nil && through != nil && expiry != nil &&
		len(ids) > 0 && len(ids) == len(starts) && len(ids) == len(ends) {
		evidence.BaselineFrom, evidence.RecentFrom, evidence.RecentTo, evidence.ObservedTo, evidence.ExpiresAt =
			*baseline, *recent, *end, *through, *expiry
		evidence.Change = domain.CapacityRange{
			LowWh: evidence.Recent.LowWh - evidence.Baseline.HighWh, HighWh: evidence.Recent.HighWh - evidence.Baseline.LowWh,
		}
		for i, id := range ids {
			evidence.SourceWindows = append(evidence.SourceWindows, domain.CapacityChargeWindow{SessionID: id, StartAt: starts[i], EndAt: ends[i]})
		}
		plan.Digest = &evidence
	}
	return out, nil
}

func (r *Repository) ReplaceCapacityTrend(ctx context.Context, scope port.CapacityTrendScope, expectedID int64, zone string, next *time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var lastDigestExpiry *time.Time
		if expectedID != 0 {
			err := tx.QueryRow(ctx, `DELETE FROM smart_capacity_trend_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3
				RETURNING last_digest_expiry_at`, scope.Subject, scope.VehicleID, expectedID).Scan(&lastDigestExpiry)
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrCapacityTrendChanged
			}
			if err != nil {
				return fmt.Errorf("replace private capacity digest plan: %w", err)
			}
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_capacity_trend_plans(subject,vehicle_id,time_zone,next_check_at,last_digest_expiry_at)
			SELECT $1,id,$3,CASE WHEN $4::timestamptz IS NOT NULL THEN GREATEST($4,$5::timestamptz) END,$5
			FROM vehicles WHERE id=$2 AND archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID, zone, next, lastDigestExpiry)
		if err != nil {
			return fmt.Errorf("save private capacity digest plan: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrCapacityTrendChanged
		}
		return nil
	})
}

func (r *Repository) DeleteCapacityTrend(ctx context.Context, scope port.CapacityTrendScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_capacity_trend_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	if err != nil {
		return fmt.Errorf("clear private capacity digest plan: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrCapacityTrendChanged
	}
	return nil
}

func (r *Repository) DismissCapacityTrend(ctx context.Context, scope port.CapacityTrendScope, id int64, end, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_capacity_trend_digests e SET dismissed_at=$5
		FROM smart_capacity_trend_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND e.plan_id=p.id AND e.recent_to=$4
			AND p.next_check_at IS NOT NULL AND e.expires_at>$5 AND e.dismissed_at IS NULL`, scope.Subject, scope.VehicleID, id, end, now)
	if err != nil {
		return fmt.Errorf("dismiss private capacity digest: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrCapacityTrendChanged
	}
	return nil
}

func (r *Repository) ClaimCapacityTrend(ctx context.Context, now, lease time.Time) (*port.DueCapacityTrend, error) {
	var job port.DueCapacityTrend
	err := r.db.Pool.QueryRow(ctx, `WITH due AS (
		SELECT p.id FROM smart_capacity_trend_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
		  AND smart_feature_allowed(p.subject,'capacity_trend')
		  AND p.subject NOT IN ($3,'open-mode')
		ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_capacity_trend_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
	RETURNING p.id,p.vehicle_id,p.time_zone,p.lease_until`, now, lease, personaldomain.OpenSubject).
		Scan(&job.PlanID, &job.VehicleID, &job.TimeZone, &job.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private capacity digest: %w", err)
	}
	return &job, nil
}

func (r *Repository) FinishCapacityTrend(ctx context.Context, job port.DueCapacityTrend, checked, next time.Time, e *domain.CapacityTrendDigest) (bool, error) {
	var published bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE smart_capacity_trend_plans p SET lease_until=NULL,next_check_at=$4
			,feature_checked_at=p.feature_claimed_at
			FROM vehicles v WHERE p.id=$1 AND p.lease_until=$2 AND $3<p.lease_until
				AND smart_feature_current(p.subject,'capacity_trend',p.feature_claimed_at)
				AND p.next_check_at IS NOT NULL AND p.vehicle_id=v.id AND v.archived_at IS NULL`,
			job.PlanID, job.Lease, checked, next)
		if err != nil {
			return fmt.Errorf("finish private capacity digest: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_capacity_trend_digests WHERE plan_id=$1 AND expires_at<=$2`, job.PlanID, checked); err != nil {
			return fmt.Errorf("prune expired capacity digest: %w", err)
		}
		if e == nil || !checked.Before(e.ExpiresAt) {
			return nil
		}
		ids := make([]int64, 0, len(e.Sources))
		starts, ends := make([]time.Time, 0, len(e.Sources)), make([]time.Time, 0, len(e.Sources))
		for _, source := range e.Sources {
			ids, starts, ends = append(ids, source.SessionID), append(starts, source.StartAt), append(ends, source.EndAt)
		}
		tag, err = tx.Exec(ctx, `INSERT INTO smart_capacity_trend_digests
			(plan_id,baseline_from,recent_from,recent_to,observed_to,expires_at,baseline_low_wh,baseline_high_wh,
			 recent_low_wh,recent_high_wh,baseline_days,recent_days,session_ids,sample_starts,sample_ends,evidence_fingerprint)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (plan_id) DO NOTHING`,
			job.PlanID, e.BaselineFrom, e.RecentFrom, e.RecentTo, e.ObservedTo, e.ExpiresAt,
			e.Baseline.LowWh, e.Baseline.HighWh, e.Recent.LowWh, e.Recent.HighWh, e.BaselineDays, e.RecentDays, ids, starts, ends, e.EvidenceFingerprint)
		if err != nil {
			return fmt.Errorf("publish private monthly capacity digest: %w", err)
		}
		published = tag.RowsAffected() == 1
		if published {
			// A settings revision must not reissue a digest from the same monthly cycle.
			if _, err := tx.Exec(ctx, `UPDATE smart_capacity_trend_plans SET last_digest_expiry_at=$2 WHERE id=$1`,
				job.PlanID, e.ExpiresAt); err != nil {
				return fmt.Errorf("record monthly capacity digest cycle: %w", err)
			}
		}
		return nil
	})
	return published && err == nil, err
}
