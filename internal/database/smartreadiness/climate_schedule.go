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

var _ port.ClimateScheduleRepository = (*Repository)(nil)

const qualifiedClimateSchedules = `WITH eligible AS (
	SELECT a.id,a.vehicle_id,a.name,a.updated_at,t.cron_expr,t.timezone
	FROM automations a
	JOIN automation_steps ts ON ts.automation_id=a.id AND ts.kind='trigger_schedule'
	JOIN automation_step_trigger_schedule t ON t.step_id=ts.id
	JOIN automation_steps ac ON ac.automation_id=a.id AND ac.kind='action_command'
	JOIN automation_actions c ON c.step_id=ac.id AND c.command_name IN ('hvac_on','climate_on')
	JOIN vehicles v ON v.id=a.vehicle_id AND v.archived_at IS NULL
	WHERE a.enabled AND NOT EXISTS (
		SELECT 1 FROM automation_steps extra WHERE extra.automation_id=a.id AND (
			(extra.id<>ts.id AND extra.kind::text LIKE 'trigger_%')
			OR (extra.id<>ac.id AND extra.kind::text LIKE 'action_%')
		)
	)
) `

const noReviewedClimateTravel = `NOT EXISTS (
	SELECT 1 FROM unnest(e.run_times) AS run(fired_at)
	JOIN drives d ON d.vehicle_id=p.vehicle_id AND d.started_at<run.fired_at+INTERVAL '90 minutes'
		AND (d.ended_at IS NULL OR d.ended_at>run.fired_at-INTERVAL '5 minutes')
)`

func scanClimateSchedule(row pgx.CollectableRow) (domain.ClimateScheduleVersion, error) {
	var option domain.ClimateScheduleVersion
	err := row.Scan(&option.ID, &option.Name, &option.UpdatedAt, &option.Cron, &option.TimeZone)
	return option, err
}

func (r *Repository) ReadClimateSchedule(ctx context.Context, scope port.ClimateScheduleScope, now time.Time) (domain.ClimateScheduleSettings, error) {
	var out domain.ClimateScheduleSettings
	rows, err := r.db.Pool.Query(ctx, qualifiedClimateSchedules+`
		SELECT id,name,updated_at,cron_expr,timezone FROM eligible WHERE vehicle_id=$1 ORDER BY id LIMIT 50`, scope.VehicleID)
	if err != nil {
		return out, fmt.Errorf("list vehicle climate schedules: %w", err)
	}
	out.Options, err = pgx.CollectRows(rows, scanClimateSchedule)
	if err != nil {
		return out, fmt.Errorf("scan vehicle climate schedules: %w", err)
	}
	var plan domain.ClimateSchedulePlan
	var review domain.ClimateScheduleEvidence
	var week, expiry, observed *time.Time
	err = r.db.Pool.QueryRow(ctx, qualifiedClimateSchedules+`
		SELECT COALESCE(p.id,0),COALESCE(p.automation_id,0),a.id IS NOT NULL,
		       e.week_of,e.expires_at,e.observed_through,e.run_times
		FROM vehicles v
		LEFT JOIN smart_climate_schedule_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN eligible a ON a.id=p.automation_id AND a.vehicle_id=p.vehicle_id AND a.updated_at=p.schedule_revision
		LEFT JOIN smart_climate_schedule_reviews e ON e.plan_id=p.id AND e.expires_at>$3 AND a.id IS NOT NULL
			AND `+noReviewedClimateTravel+`
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, now).
		Scan(&plan.ID, &plan.AutomationID, &plan.Current, &week, &expiry, &observed, &review.RunTimes)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, port.ErrNotFound
	}
	if err != nil {
		return out, fmt.Errorf("read private climate schedule review: %w", err)
	}
	if plan.ID != 0 {
		if week != nil && expiry != nil && observed != nil {
			review.WeekOf, review.ExpiresAt, review.ObservedThrough = *week, *expiry, *observed
			plan.Evidence = &review
		}
		out.Plan = &plan
	}
	return out, nil
}

func (r *Repository) ReplaceClimateSchedule(ctx context.Context, scope port.ClimateScheduleScope, expectedID, automationID int64, revision, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_climate_schedule_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, expectedID)
			if err != nil {
				return fmt.Errorf("replace private climate review: %w", err)
			}
			if tag.RowsAffected() != 1 {
				return port.ErrClimateScheduleChanged
			}
		}
		tag, err := tx.Exec(ctx, qualifiedClimateSchedules+`
			INSERT INTO smart_climate_schedule_plans(subject,vehicle_id,automation_id,schedule_revision,enabled_at,next_check_at)
			SELECT $1,vehicle_id,id,updated_at,$5,$5 FROM eligible WHERE id=$3 AND vehicle_id=$2 AND updated_at=$4
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID, automationID, revision, now)
		if err != nil {
			return fmt.Errorf("enable private climate schedule review: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return port.ErrClimateScheduleChanged
		}
		return nil
	})
}

func (r *Repository) DeleteClimateSchedule(ctx context.Context, scope port.ClimateScheduleScope, expectedID int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_climate_schedule_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, expectedID)
	if err != nil {
		return fmt.Errorf("disable private climate schedule review: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrClimateScheduleChanged
	}
	return nil
}

func (r *Repository) ClaimClimateSchedule(ctx context.Context, now, lease time.Time) (*port.DueClimateSchedule, error) {
	var job port.DueClimateSchedule
	err := r.db.Pool.QueryRow(ctx, qualifiedClimateSchedules+`, due AS (
		SELECT p.id,a.timezone FROM smart_climate_schedule_plans p
		JOIN eligible a ON a.id=p.automation_id AND a.vehicle_id=p.vehicle_id AND a.updated_at=p.schedule_revision
		WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
		  AND p.subject NOT IN ($3,'open-mode')
		ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_climate_schedule_plans p SET lease_until=$2 FROM due WHERE p.id=due.id
	RETURNING p.id,p.vehicle_id,due.timezone,p.lease_until`, now, lease, personaldomain.OpenSubject).
		Scan(&job.PlanID, &job.VehicleID, &job.TimeZone, &job.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due climate schedule review: %w", err)
	}
	return &job, nil
}

func (r *Repository) ClimateScheduleRuns(ctx context.Context, job port.DueClimateSchedule, earliest, latest time.Time) ([]domain.ClimateScheduleRun, error) {
	rows, err := r.db.Pool.Query(ctx, `SELECT receipt.fired_at,h.triggered_at,h.completed_at
		FROM smart_climate_schedule_receipts receipt
		JOIN smart_climate_schedule_plans p ON p.id=receipt.plan_id AND p.vehicle_id=$2 AND p.lease_until=$3
		JOIN automation_history h ON h.id=receipt.history_id AND h.automation_id=p.automation_id
		WHERE p.id=$1 AND receipt.fired_at BETWEEN $4 AND $5
		  AND h.status='success' AND h.completed_at IS NOT NULL
		  AND NOT EXISTS (
			SELECT 1 FROM drives d WHERE d.vehicle_id=p.vehicle_id AND d.started_at<receipt.fired_at+INTERVAL '90 minutes'
			  AND (d.ended_at IS NULL OR d.ended_at>receipt.fired_at-INTERVAL '5 minutes')
		  )
		ORDER BY receipt.fired_at DESC,h.id DESC LIMIT 50`,
		job.PlanID, job.VehicleID, job.Lease, earliest, latest)
	if err != nil {
		return nil, fmt.Errorf("read attributable scheduled climate outcomes: %w", err)
	}
	runs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.ClimateScheduleRun, error) {
		var run domain.ClimateScheduleRun
		err := row.Scan(&run.FiredAt, &run.TriggeredAt, &run.CompletedAt)
		return run, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan attributable scheduled climate outcomes: %w", err)
	}
	return runs, nil
}

func (r *Repository) FinishClimateSchedule(ctx context.Context, job port.DueClimateSchedule, checked, next time.Time, evidence *domain.ClimateScheduleEvidence) (port.ClimateScheduleCompletion, error) {
	var out port.ClimateScheduleCompletion
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, qualifiedClimateSchedules+`
			UPDATE smart_climate_schedule_plans p SET lease_until=NULL,next_check_at=$4
			FROM eligible a WHERE p.id=$1 AND p.lease_until=$2 AND $3<p.lease_until
			  AND a.id=p.automation_id AND a.vehicle_id=p.vehicle_id AND a.updated_at=p.schedule_revision`,
			job.PlanID, job.Lease, checked, next)
		if err != nil {
			return fmt.Errorf("finish private climate schedule review: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_climate_schedule_receipts WHERE plan_id=$1
			AND fired_at<$2::timestamptz-INTERVAL '43 days'`, job.PlanID, checked); err != nil {
			return fmt.Errorf("prune expired climate schedule receipts: %w", err)
		}
		if evidence == nil {
			_, err = tx.Exec(ctx, `DELETE FROM smart_climate_schedule_reviews WHERE plan_id=$1`, job.PlanID)
		} else {
			_, err = tx.Exec(ctx, `INSERT INTO smart_climate_schedule_reviews(plan_id,week_of,expires_at,observed_through,run_times)
				VALUES ($1,$2,$3,$4,$5) ON CONFLICT (plan_id) DO UPDATE SET
				week_of=EXCLUDED.week_of,expires_at=EXCLUDED.expires_at,observed_through=EXCLUDED.observed_through,
				run_times=EXCLUDED.run_times`, job.PlanID, evidence.WeekOf, evidence.ExpiresAt, evidence.ObservedThrough, evidence.RunTimes)
		}
		if err != nil {
			return fmt.Errorf("persist private climate schedule review: %w", err)
		}
		if evidence != nil {
			tag, err := tx.Exec(ctx, `UPDATE smart_climate_schedule_plans SET last_review_week=$2
				WHERE id=$1 AND (last_review_week IS NULL OR last_review_week<$2)`, job.PlanID, evidence.WeekOf)
			if err != nil {
				return fmt.Errorf("record first climate review publication: %w", err)
			}
			out.Published = tag.RowsAffected() == 1
		}
		out.Applied = true
		return nil
	})
	if err != nil {
		return port.ClimateScheduleCompletion{}, err
	}
	return out, nil
}

func (r *Repository) ListClimateScheduleReviews(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]port.ClimateScheduleCandidate, error) {
	rows, err := r.db.Pool.Query(ctx, qualifiedClimateSchedules+`
		SELECT p.id,p.vehicle_id,v.display_name,a.id,a.name,a.updated_at,a.cron_expr,a.timezone,
		       e.week_of,e.expires_at,e.observed_through,e.run_times
		FROM smart_climate_schedule_plans p
		JOIN eligible a ON a.id=p.automation_id AND a.vehicle_id=p.vehicle_id AND a.updated_at=p.schedule_revision
		JOIN vehicles v ON v.id=p.vehicle_id
		JOIN smart_climate_schedule_reviews e ON e.plan_id=p.id AND e.expires_at>$3
		WHERE p.subject=$1 AND ($2::bigint IS NULL OR p.vehicle_id=$2) AND `+noReviewedClimateTravel+`
		ORDER BY e.observed_through DESC,p.id LIMIT $4`, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list private climate schedule reviews: %w", err)
	}
	reviews, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.ClimateScheduleCandidate, error) {
		var review port.ClimateScheduleCandidate
		a, e := &review.Automation, &review.Evidence
		err := row.Scan(&review.PlanID, &review.VehicleID, &review.VehicleName, &a.ID, &a.Name, &a.UpdatedAt, &a.Cron, &a.TimeZone,
			&e.WeekOf, &e.ExpiresAt, &e.ObservedThrough, &e.RunTimes)
		return review, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan private climate schedule reviews: %w", err)
	}
	return reviews, nil
}
