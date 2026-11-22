package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	personal "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var _ port.ParkedClosureRepository = (*Repository)(nil)

func (r *Repository) ReadParkedClosure(ctx context.Context, scope port.ParkedClosureScope) (*domain.ParkedClosurePlan, error) {
	var plan domain.ParkedClosurePlan
	var from, parked, opened, observed, expires *time.Time
	var risk domain.ParkedClosureRisk
	var current bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),COALESCE(p.grace_s,0),COALESCE(p.paused,false),p.snoozed_until,COALESCE(p.reason,''),
			COALESCE(p.device_id,0),d.id IS NOT NULL,p.evidence_from,COALESCE(p.park_id,0),
			p.parked_at,COALESCE(p.position,''),p.open_since,p.last_observed_at,p.risk_expires_at,
			smart_feature_current($1,'parked_closure',p.feature_checked_at)
		FROM vehicles v
		LEFT JOIN smart_parked_closure_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&plan.ID, &plan.GraceS, &plan.Paused, &plan.SnoozedUntil, &plan.Reason, &plan.DeviceID, &plan.DeviceReady,
			&from, &risk.DriveID, &parked, &risk.Position, &opened, &observed, &expires, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read private parked closure settings: %w", err)
	}
	if from == nil {
		return nil, nil
	}
	plan.EvidenceFrom = *from
	if !current {
		plan.Reason = ""
		return &plan, nil
	}
	if parked != nil && opened != nil && observed != nil && expires != nil {
		risk.ParkedAt, risk.OpenSince, risk.LastObserved, risk.ActionUntil = *parked, *opened, *observed, *expires
		plan.Risk = &risk
	}
	return &plan, nil
}

func (r *Repository) ReplaceParkedClosure(ctx context.Context, scope port.ParkedClosureScope, expectedID int64, setup domain.ParkedClosureSetup, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_parked_closure_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, expectedID)
			if err := closurePlanChange(tag, err, "replace parked closure settings"); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_parked_closure_plans
			(subject,vehicle_id,evidence_from,grace_s,device_id,device_verified_at,push_title,push_body,next_check_at,reason)
			SELECT $1,v.id,$4,$5,d.id,d.verified_at,$6,$7,$4,'monitoring'
			FROM vehicles v JOIN smart_push_devices d ON d.id=$3 AND d.subject=$1 AND d.verified_at IS NOT NULL
			WHERE v.id=$2 AND v.archived_at IS NULL ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, setup.DeviceID, now, setup.GraceS, setup.PushTitle, setup.PushBody)
		return closurePlanChange(tag, err, "save parked closure settings")
	})
}

func (r *Repository) SetParkedClosureHold(ctx context.Context, scope port.ParkedClosureScope, id int64, until *time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_parked_closure_plans p
		SET paused=$4::timestamptz IS NULL,snoozed_until=$4,evidence_from=GREATEST(evidence_from,$4::timestamptz),
			next_check_at=$4,lease_until=NULL,reason='monitoring',park_id=NULL,parked_at=NULL,position=NULL,
			open_since=NULL,last_observed_at=NULL,risk_expires_at=NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND NOT p.paused
			AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL)`,
		scope.Subject, scope.VehicleID, id, until)
	return closurePlanChange(tag, err, "hold parked closure checks")
}

func (r *Repository) DeleteParkedClosure(ctx context.Context, scope port.ParkedClosureScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_parked_closure_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	return closurePlanChange(tag, err, "clear parked closure settings")
}

func closurePlanChange(tag pgconn.CommandTag, err error, action string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrParkedClosureChanged
	}
	return nil
}

func (r *Repository) ClaimParkedClosure(ctx context.Context, now, lease time.Time) (*port.ParkedClosureJob, error) {
	var job port.ParkedClosureJob
	err := r.db.Pool.QueryRow(ctx, `WITH due AS (
		SELECT p.id FROM smart_parked_closure_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
		  AND NOT p.paused AND p.subject NOT IN ($3,'open-mode')
		  AND smart_feature_allowed(p.subject,'parked_closure')
		ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_parked_closure_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
	RETURNING p.id,p.subject,p.vehicle_id,p.evidence_from,p.grace_s,p.lease_until`, now, lease, personal.OpenSubject).
		Scan(&job.Plan.ID, &job.Scope.Subject, &job.Scope.VehicleID, &job.Plan.EvidenceFrom, &job.Plan.GraceS, &job.LeaseUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private parked closure check: %w", err)
	}
	return &job, nil
}

func (r *Repository) FinishParkedClosure(ctx context.Context, job port.ParkedClosureJob, reason domain.ParkedClosureReason, risk *domain.ParkedClosureRisk, now time.Time) (bool, error) {
	var park *int64
	var position *domain.ParkedClosurePosition
	var parked, opened, observed, expires *time.Time
	if risk != nil {
		park, position, parked, opened, observed, expires =
			&risk.DriveID, &risk.Position, &risk.ParkedAt, &risk.OpenSince, &risk.LastObserved, &risk.ActionUntil
	}
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_parked_closure_plans p
		SET lease_until=NULL,feature_checked_at=p.feature_claimed_at,reason=$4,next_check_at=$5,snoozed_until=NULL,park_id=$6,position=$7,
			parked_at=$8,open_since=$9,last_observed_at=$10,risk_expires_at=$11
		WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3 AND NOT p.paused
			AND smart_feature_current(p.subject,'parked_closure',p.feature_claimed_at)
			AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL)
			AND EXISTS (SELECT 1 FROM smart_push_devices d WHERE d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at)
			AND ($6::bigint IS NULL OR EXISTS (SELECT 1 FROM (
				SELECT id,ended_at FROM drives WHERE vehicle_id=p.vehicle_id AND started_at<=$3
				ORDER BY started_at DESC,id DESC LIMIT 1
			) latest WHERE latest.id=$6 AND latest.ended_at=$8))`,
		job.Plan.ID, job.LeaseUntil, now, reason, now.Add(time.Minute), park, position, parked, opened, observed, expires)
	if err != nil {
		return false, fmt.Errorf("record private parked closure check: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
