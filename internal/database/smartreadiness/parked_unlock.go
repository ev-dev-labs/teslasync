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

var _ port.ParkedUnlockRepository = (*Repository)(nil)

func (r *Repository) ReadParkedUnlock(ctx context.Context, scope port.ParkedUnlockScope) (*domain.ParkedUnlockPlan, error) {
	var plan domain.ParkedUnlockPlan
	var from, revision, parked, unlocked, observed, expires *time.Time
	var risk domain.ParkedUnlockRisk
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),COALESCE(p.place_id,0),p.place_revision,COALESCE(g.name,''),g.id IS NOT NULL,
			COALESCE(p.device_id,0),d.id IS NOT NULL,p.evidence_from,COALESCE(p.paused,false),p.snoozed_until,
			COALESCE(p.reason,''),COALESCE(p.park_id,0),p.parked_at,p.unlocked_since,p.last_observed_at,p.risk_expires_at
		FROM vehicles v
		LEFT JOIN smart_parked_unlock_plans p ON p.vehicle_id=v.id AND p.subject=$1
		LEFT JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		LEFT JOIN geofences g ON g.id=p.place_id AND g.updated_at=p.place_revision
			AND g.enabled AND NOT g.needs_review AND g.archived_at IS NULL
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&plan.ID, &plan.PlaceID, &revision, &plan.PlaceName, &plan.PlaceReady, &plan.DeviceID, &plan.DeviceReady, &from,
			&plan.Paused, &plan.SnoozedUntil, &plan.Reason, &risk.DriveID, &parked, &unlocked, &observed, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read private parked unlock settings: %w", err)
	}
	if from == nil || revision == nil {
		return nil, nil
	}
	plan.EvidenceFrom, plan.PlaceRevision = *from, *revision
	if parked != nil && unlocked != nil && observed != nil && expires != nil {
		risk.ParkedAt, risk.UnlockedSince, risk.LastObserved, risk.ActionUntil = *parked, *unlocked, *observed, *expires
		plan.Risk = &risk
	}
	return &plan, nil
}

func (r *Repository) ReplaceParkedUnlock(ctx context.Context, scope port.ParkedUnlockScope, expectedID int64, setup domain.ParkedUnlockSetup, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_parked_unlock_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, expectedID)
			if err := unlockPlanChange(tag, err, "replace parked unlock settings"); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `INSERT INTO smart_parked_unlock_plans
			(subject,vehicle_id,place_id,place_revision,evidence_from,device_id,device_verified_at,push_title,push_body,next_check_at,reason)
			SELECT $1,v.id,g.id,g.updated_at,$6,d.id,d.verified_at,$7,$8,$6,'monitoring'
			FROM vehicles v JOIN smart_push_devices d ON d.id=$3 AND d.subject=$1 AND d.verified_at IS NOT NULL
			JOIN geofences g ON g.id=$4 AND g.updated_at=$5 AND g.enabled AND NOT g.needs_review AND g.archived_at IS NULL
			WHERE v.id=$2 AND v.archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, setup.DeviceID, setup.PlaceID, setup.PlaceRevision, now, setup.PushTitle, setup.PushBody)
		return unlockPlanChange(tag, err, "save parked unlock settings")
	})
}

func (r *Repository) SetParkedUnlockHold(ctx context.Context, scope port.ParkedUnlockScope, id int64, until *time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_parked_unlock_plans p
		SET paused=$4::timestamptz IS NULL,snoozed_until=$4,evidence_from=GREATEST(evidence_from,$4::timestamptz),
			next_check_at=$4,lease_until=NULL,reason='monitoring',park_id=NULL,parked_at=NULL,
			unlocked_since=NULL,last_observed_at=NULL,risk_expires_at=NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND NOT p.paused
			AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL)`,
		scope.Subject, scope.VehicleID, id, until)
	return unlockPlanChange(tag, err, "hold parked unlock checks")
}

func (r *Repository) DeleteParkedUnlock(ctx context.Context, scope port.ParkedUnlockScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_parked_unlock_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	return unlockPlanChange(tag, err, "clear parked unlock settings")
}

func unlockPlanChange(tag pgconn.CommandTag, err error, action string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrParkedUnlockChanged
	}
	return nil
}

func (r *Repository) ClaimParkedUnlock(ctx context.Context, now, lease time.Time) (*port.ParkedUnlockJob, error) {
	var job port.ParkedUnlockJob
	err := r.db.Pool.QueryRow(ctx, `WITH due AS (
		SELECT p.id FROM smart_parked_unlock_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		JOIN smart_push_devices d ON d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at
		WHERE p.next_check_at<=$1 AND (p.lease_until IS NULL OR p.lease_until<=$1)
		  AND NOT p.paused AND p.subject NOT IN ($3,'open-mode')
		ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_parked_unlock_plans p SET lease_until=$2 FROM due WHERE p.id=due.id
	RETURNING p.id,p.subject,p.vehicle_id,p.place_id,p.place_revision,p.evidence_from,p.lease_until`, now, lease, personal.OpenSubject).
		Scan(&job.Plan.ID, &job.Scope.Subject, &job.Scope.VehicleID, &job.Plan.PlaceID, &job.Plan.PlaceRevision,
			&job.Plan.EvidenceFrom, &job.LeaseUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim due private parked unlock check: %w", err)
	}
	return &job, nil
}

func (r *Repository) FinishParkedUnlock(ctx context.Context, job port.ParkedUnlockJob, reason domain.ParkedUnlockReason, risk *domain.ParkedUnlockRisk, now time.Time) (bool, error) {
	var park *int64
	var parked, unlocked, observed, expires *time.Time
	if risk != nil {
		park, parked, unlocked, observed, expires = &risk.DriveID, &risk.ParkedAt, &risk.UnlockedSince, &risk.LastObserved, &risk.ActionUntil
	}
	tag, err := r.db.Pool.Exec(ctx, `UPDATE smart_parked_unlock_plans p
		SET lease_until=NULL,reason=$4,next_check_at=CASE WHEN $4='place_changed' THEN NULL ELSE $5::timestamptz END,
			snoozed_until=NULL,park_id=$6,parked_at=$7,unlocked_since=$8,last_observed_at=$9,risk_expires_at=$10
		WHERE p.id=$1 AND p.lease_until=$2 AND p.lease_until>$3 AND NOT p.paused
			AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL)
			AND EXISTS (SELECT 1 FROM smart_push_devices d WHERE d.id=p.device_id AND d.subject=p.subject AND d.verified_at=p.device_verified_at)
			AND ($6::bigint IS NULL OR (
				EXISTS (SELECT 1 FROM geofences g WHERE g.id=p.place_id AND g.updated_at=p.place_revision
					AND g.enabled AND NOT g.needs_review AND g.archived_at IS NULL)
				AND EXISTS (SELECT 1 FROM (
					SELECT id,ended_at FROM drives WHERE vehicle_id=p.vehicle_id AND started_at<=$3
					ORDER BY started_at DESC,id DESC LIMIT 1
				) latest WHERE latest.id=$6 AND latest.ended_at=$7)
			))`,
		job.Plan.ID, job.LeaseUntil, now, reason, now.Add(time.Minute), park, parked, unlocked, observed, expires)
	if err != nil {
		return false, fmt.Errorf("record private parked unlock check: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
