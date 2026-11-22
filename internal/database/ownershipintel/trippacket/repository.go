package trippacket

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/trippacket"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/trippacket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) Read(ctx context.Context, scope port.Scope) (*domain.Plan, error) {
	var plan domain.Plan
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),COALESCE(p.revision,0),COALESCE(p.time_zone,''),COALESCE(p.paused,false),
		    p.next_check_at,CASE WHEN smart_feature_current($1,'trip_packet',p.feature_checked_at) THEN p.reviewed_through END,
		    p.dismissed_through
		FROM vehicles v LEFT JOIN smart_trip_packet_plans p ON p.vehicle_id=v.id AND p.subject=$1
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).Scan(
		&plan.ID, &plan.Revision, &plan.TimeZone, &plan.Paused, &plan.NextCheckAt, &plan.ReviewedThrough, &plan.DismissedThrough)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read private trip packet plan: %w", err)
	}
	if plan.ID == 0 {
		return nil, nil
	}
	return &plan, nil
}

func (r *Repository) Replace(ctx context.Context, scope port.Scope, p domain.Plan, next time.Time) error {
	var count int64
	if p.ID == 0 {
		tag, err := r.pool.Exec(ctx, `
			INSERT INTO smart_trip_packet_plans (subject,vehicle_id,time_zone,paused,next_check_at)
			SELECT $1,v.id,$3,false,$4 FROM vehicles v WHERE v.id=$2 AND v.archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`, scope.Subject, scope.VehicleID, p.TimeZone, next)
		if err != nil {
			return fmt.Errorf("create private trip packet plan: %w", err)
		}
		count = tag.RowsAffected()
	} else {
		tag, err := r.pool.Exec(ctx, `
			UPDATE smart_trip_packet_plans p
			SET revision=p.revision+1,time_zone=$5,paused=$6,lease_until=NULL,
			    next_check_at=CASE WHEN $6 THEN NULL WHEN p.time_zone=$5 AND NOT p.paused THEN p.next_check_at ELSE $7 END,
			    checked_through=CASE WHEN p.time_zone=$5 THEN p.checked_through END,
			    reviewed_through=CASE WHEN p.time_zone=$5 THEN p.reviewed_through END,
			    dismissed_through=CASE WHEN p.time_zone=$5 THEN p.dismissed_through END
			FROM vehicles v WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.revision=$4
			    AND v.id=p.vehicle_id AND v.archived_at IS NULL AND (NOT $6 OR p.time_zone=$5)`,
			scope.Subject, scope.VehicleID, p.ID, p.Revision, p.TimeZone, p.Paused, next)
		if err != nil {
			return fmt.Errorf("replace private trip packet plan: %w", err)
		}
		count = tag.RowsAffected()
	}
	if count != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, scope port.Scope, v domain.Version) error {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM smart_trip_packet_plans WHERE subject=$1 AND vehicle_id=$2 AND id=$3 AND revision=$4`,
		scope.Subject, scope.VehicleID, v.ID, v.Revision)
	if err != nil {
		return fmt.Errorf("clear private trip packet: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) Dismiss(ctx context.Context, scope port.Scope, v domain.Version, through time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE smart_trip_packet_plans p SET dismissed_through=$5,revision=p.revision+1,lease_until=NULL
		FROM vehicles v WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.revision=$4
		    AND NOT p.paused AND p.reviewed_through=$5 AND p.dismissed_through IS DISTINCT FROM $5
		    AND v.id=p.vehicle_id AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, v.ID, v.Revision, through)
	if err != nil {
		return fmt.Errorf("dismiss private trip packet: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) ReadEntry(ctx context.Context, scope port.Scope, p domain.Plan, driveID int64, now time.Time) (*domain.Entry, error) {
	entry := &domain.Entry{DriveID: driveID}
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT COALESCE(e.purpose,'')
			FROM smart_trip_packet_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			JOIN drives d ON d.id=$5 AND d.vehicle_id=v.id AND d.ended_at>d.started_at AND d.ended_at<=$6
			LEFT JOIN smart_trip_packet_entries e ON e.plan_id=p.id AND e.drive_id=d.id
			WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.revision=$4 AND NOT p.paused`,
			scope.Subject, scope.VehicleID, p.ID, p.Revision, driveID, now).Scan(&entry.Purpose)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read confirmed drive purpose: %w", err)
		}
		entry.Receipts, err = readReceipts(ctx, tx, p.ID, []int64{driveID}, domain.MaxReceiptsPerDrive+1)
		return err
	})
	return entry, err
}

func (r *Repository) ReplaceEntry(ctx context.Context, scope port.Scope, p domain.Plan, e domain.Entry, now time.Time, refresh port.Window) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var started, ended time.Time
		err := tx.QueryRow(ctx, `
			SELECT d.started_at,d.ended_at FROM smart_trip_packet_plans p
			JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			JOIN drives d ON d.id=$5 AND d.vehicle_id=v.id AND d.ended_at>d.started_at AND d.ended_at<=$6
			WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.revision=$4 AND NOT p.paused
			FOR UPDATE OF p`, scope.Subject, scope.VehicleID, p.ID, p.Revision, e.DriveID, now).Scan(&started, &ended)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrChanged
		}
		if err != nil {
			return fmt.Errorf("check private trip packet entry scope: %w", err)
		}
		loc, ok := p.Location()
		if !ok {
			return port.ErrChanged
		}
		first, last := started.In(loc).Format(time.DateOnly), ended.In(loc).Format(time.DateOnly)
		for _, receipt := range e.Receipts {
			if receipt.Day < first || receipt.Day > last {
				return port.ErrReceiptDay
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM smart_trip_packet_entries WHERE plan_id=$1 AND drive_id=$2`, p.ID, e.DriveID); err != nil {
			return fmt.Errorf("remove existing packet association: %w", err)
		}
		if e.Purpose.Valid() {
			if _, err := tx.Exec(ctx, `INSERT INTO smart_trip_packet_entries(plan_id,drive_id,purpose) VALUES ($1,$2,$3)`,
				p.ID, e.DriveID, e.Purpose); err != nil {
				return fmt.Errorf("save explicit business purpose: %w", err)
			}
		}
		for _, receipt := range e.Receipts {
			if _, err := tx.Exec(ctx, `
				INSERT INTO smart_trip_packet_receipts(plan_id,drive_id,receipt_day,reference,currency,amount_minor)
				VALUES ($1,$2,$3::text::date,$4,$5,$6)`, p.ID, e.DriveID, receipt.Day, receipt.Reference, receipt.Currency, receipt.AmountMinor); err != nil {
				return fmt.Errorf("save private receipt match: %w", err)
			}
		}
		refreshDue := !started.Before(refresh.From) && started.Before(refresh.Through)
		_, err = tx.Exec(ctx, `
			UPDATE smart_trip_packet_plans SET revision=revision+1,lease_until=NULL,
			    next_check_at=CASE WHEN $2 AND (checked_through=$4 OR next_check_at<=$3)
			            AND dismissed_through IS DISTINCT FROM $4 THEN LEAST(next_check_at,$3) ELSE next_check_at END
			WHERE id=$1`, p.ID, refreshDue, now, refresh.Through)
		if err != nil {
			return fmt.Errorf("invalidate changed private trip packet: %w", err)
		}
		return nil
	})
}

func (r *Repository) Claim(ctx context.Context, now, lease time.Time) (*port.Job, error) {
	var job port.Job
	err := r.pool.QueryRow(ctx, `
		WITH due AS (
		    SELECT p.id FROM smart_trip_packet_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		    WHERE (p.next_check_at<=$1 OR (p.reviewed_through IS NOT NULL AND p.dismissed_through IS DISTINCT FROM p.reviewed_through
		        AND NOT smart_feature_current(p.subject,'trip_packet',p.feature_checked_at)))
		        AND NOT p.paused AND (p.lease_until IS NULL OR p.lease_until<=$1) AND p.subject NOT IN ($3,'open-mode')
		        AND smart_feature_allowed(p.subject,'trip_packet')
		    ORDER BY p.next_check_at,p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED
		)
		UPDATE smart_trip_packet_plans p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due WHERE p.id=due.id
		RETURNING p.id,p.revision,p.subject,p.vehicle_id,p.time_zone,p.dismissed_through,p.lease_until`, now, lease, personal.OpenSubject).
		Scan(&job.ID, &job.Revision, &job.Subject, &job.VehicleID, &job.TimeZone, &job.DismissedThrough, &job.Lease)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("claim private trip packet: %w", err)
	}
	return &job, nil
}

func (r *Repository) Sources(ctx context.Context, scope port.Scope, v domain.Version, window port.Window, now time.Time, lease *time.Time) ([]domain.Drive, []domain.Receipt, error) {
	var drives []domain.Drive
	var receipts []domain.Receipt
	var workAt time.Time
	const sourcePlan = `
		FROM smart_trip_packet_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.revision=$4 AND NOT p.paused
		    AND (($5::timestamptz IS NOT NULL AND p.lease_until=$5 AND p.lease_until>$6
		            AND smart_feature_current(p.subject,'trip_packet',p.feature_claimed_at))
		        OR ($5 IS NULL AND p.reviewed_through=$7 AND p.dismissed_through IS DISTINCT FROM $7
		            AND smart_feature_current(p.subject,'trip_packet',p.feature_checked_at)))`
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		var id int64
		err := tx.QueryRow(ctx, `SELECT p.id,statement_timestamp()`+sourcePlan,
			scope.Subject, scope.VehicleID, v.ID, v.Revision, lease, now, window.Through).Scan(&id, &workAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrChanged
		}
		if err != nil {
			return fmt.Errorf("check private trip packet read scope: %w", err)
		}
		rows, err := tx.Query(ctx, `
			SELECT d.id,d.started_at,d.ended_at,d.distance_m,COALESCE(e.purpose,'')
			FROM drives d LEFT JOIN smart_trip_packet_entries e ON e.drive_id=d.id AND e.plan_id=$1
			WHERE d.vehicle_id=$2 AND d.started_at>=$3 AND d.started_at<$4 AND d.ended_at>d.started_at AND d.ended_at<=$5
			ORDER BY d.started_at,d.id LIMIT $6`, id, scope.VehicleID, window.From, window.Through, now, domain.MaxDrives+1)
		if err != nil {
			return fmt.Errorf("read bounded trip packet history: %w", err)
		}
		drives, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Drive, error) {
			var d domain.Drive
			err := row.Scan(&d.ID, &d.StartedAt, &d.EndedAt, &d.DistanceM, &d.Purpose)
			return d, err
		})
		if err != nil {
			return fmt.Errorf("read typed trip packet drives: %w", err)
		}
		if len(drives) == 0 || len(drives) > domain.MaxDrives {
			return nil
		}
		ids := make([]int64, 0, len(drives))
		for _, drive := range drives {
			ids = append(ids, drive.ID)
		}
		receipts, err = readReceipts(ctx, tx, id, ids, domain.MaxReceipts+1)
		return err
	})
	if err == nil && lease == nil {
		var current bool
		err = r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1`+sourcePlan+` AND smart_feature_current(p.subject,'trip_packet',$8))`,
			scope.Subject, scope.VehicleID, v.ID, v.Revision, lease, now, window.Through, workAt).Scan(&current)
		if err != nil {
			return nil, nil, fmt.Errorf("recheck private trip packet scope: %w", err)
		}
		if !current {
			return nil, nil, port.ErrChanged
		}
	}
	return drives, receipts, err
}

func readReceipts(ctx context.Context, tx pgx.Tx, planID int64, ids []int64, cap int) ([]domain.Receipt, error) {
	rows, err := tx.Query(ctx, `
		SELECT drive_id,to_char(receipt_day,'YYYY-MM-DD'),reference,currency,amount_minor
		FROM smart_trip_packet_receipts WHERE plan_id=$1 AND drive_id=ANY($2)
		ORDER BY drive_id,receipt_day,reference,currency LIMIT $3`, planID, ids, cap)
	if err != nil {
		return nil, fmt.Errorf("read private matched receipt references: %w", err)
	}
	receipts, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Receipt, error) {
		var receipt domain.Receipt
		err := row.Scan(&receipt.DriveID, &receipt.Day, &receipt.Reference, &receipt.Currency, &receipt.AmountMinor)
		return receipt, err
	})
	if err != nil {
		return nil, fmt.Errorf("read typed receipt references: %w", err)
	}
	return receipts, nil
}

func (r *Repository) Finish(ctx context.Context, job port.Job, now, next, through time.Time, ready bool) (bool, error) {
	var published bool
	err := r.pool.QueryRow(ctx, `
		WITH held AS (
		    SELECT p.id,($7 AND p.notified_through IS DISTINCT FROM $6
		        AND p.dismissed_through IS DISTINCT FROM $6) publish
		    FROM smart_trip_packet_plans p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		    WHERE p.id=$1 AND p.revision=$2 AND p.lease_until=$3 AND p.lease_until>$4 AND NOT p.paused
		        AND smart_feature_current(p.subject,'trip_packet',p.feature_claimed_at)
		    FOR UPDATE OF p
		)
		UPDATE smart_trip_packet_plans p SET next_check_at=$5,lease_until=NULL,checked_through=$6,
		    reviewed_through=CASE WHEN $7 THEN $6 END,feature_checked_at=p.feature_claimed_at,
		    notified_through=CASE WHEN held.publish THEN $6 ELSE p.notified_through END
		FROM held WHERE p.id=held.id RETURNING held.publish`, job.ID, job.Revision, job.Lease, now, next, through, ready).Scan(&published)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("finish fenced private trip packet: %w", err)
	}
	return published, nil
}
