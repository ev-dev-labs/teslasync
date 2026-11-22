package ownershipintel

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
	"github.com/jackc/pgx/v5"
)

var _ port.WarrantyReminderRepository = (*DurableRepository)(nil)

const warrantyOwner = `w.id=$1 AND w.subject=$2 AND w.vehicle_id=$3 AND v.archived_at IS NULL`
const warrantyVehicle = `JOIN vehicles v ON v.id=w.vehicle_id`
const warrantyStartKnown = `(w.start_odometer_m > 0 OR w.zero_start_odometer_confirmed)`
const reminderValues = `p.recorded_at, p.evidence_from, p.observed_days, p.remaining_m, p.pace_mps,
	p.earliest_at, p.latest_at, p.term_end, p.expires_at`

func (r *DurableRepository) SetWarrantyReminder(ctx context.Context, key port.WarrantyReminderKey, enabled bool, now time.Time) error {
	if !enabled {
		_, err := r.q.Exec(ctx, `DELETE FROM smart_warranty_reminders p USING vehicle_warranties w
			WHERE p.warranty_id=w.id AND w.id=$1 AND w.subject=$2 AND w.vehicle_id=$3`,
			key.WarrantyID, key.Subject, key.VehicleID)
		if err != nil {
			return fmt.Errorf("remove private warranty reminder: %w", err)
		}
		return nil
	}
	tag, err := r.q.Exec(ctx, `INSERT INTO smart_warranty_reminders (warranty_id, enabled_at, next_check_at)
		SELECT w.id, $4, $4 FROM vehicle_warranties w `+warrantyVehicle+` WHERE `+warrantyOwner+` AND `+warrantyStartKnown+`
		ON CONFLICT (warranty_id) DO NOTHING`, key.WarrantyID, key.Subject, key.VehicleID, now)
	if err != nil {
		return fmt.Errorf("enable private warranty reminder: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	state, err := r.WarrantyReminderSettings(ctx, key, now)
	if err == nil && (!state.Enabled || !state.StartOdometerKnown) {
		return port.ErrNotFound
	}
	return err
}

func (r *DurableRepository) WarrantyReminderSettings(
	ctx context.Context, key port.WarrantyReminderKey, now time.Time,
) (domain.WarrantyReminderSettings, error) {
	var state domain.WarrantyReminderSettings
	var projected domain.WarrantyDistanceReminder
	var recordedAt, evidenceFrom, earliestAt, latestAt, termEnd, expiresAt *time.Time
	var observedDays *int
	var remainingM, paceMps *float64
	var current bool
	err := r.q.QueryRow(ctx, `SELECT p.warranty_id IS NOT NULL, `+warrantyStartKnown+`, `+reminderValues+`,
		smart_feature_current(w.subject,'warranty_mileage',p.feature_checked_at)
		FROM vehicle_warranties w `+warrantyVehicle+`
		LEFT JOIN smart_warranty_reminders p ON p.warranty_id=w.id
		WHERE `+warrantyOwner, key.WarrantyID, key.Subject, key.VehicleID).
		Scan(&state.Enabled, &state.StartOdometerKnown, &recordedAt, &evidenceFrom, &observedDays, &remainingM, &paceMps,
			&earliestAt, &latestAt, &termEnd, &expiresAt, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return state, port.ErrNotFound
	}
	if err != nil {
		return state, fmt.Errorf("read private warranty reminder: %w", err)
	}
	if current && state.Enabled && state.StartOdometerKnown && expiresAt != nil && expiresAt.After(now) {
		projected = domain.WarrantyDistanceReminder{
			WarrantyID: key.WarrantyID, VehicleID: key.VehicleID, ObservedDays: *observedDays,
			RecordedAt: *recordedAt, EvidenceFrom: *evidenceFrom, RemainingM: *remainingM, PaceMps: *paceMps,
			EarliestLimitAt: *earliestAt, LatestLimitAt: *latestAt, DocumentedTermEnd: *termEnd, ExpiresAt: *expiresAt,
		}
		state.Projection = &projected
	}
	return state, nil
}

func (r *DurableRepository) ClaimWarrantyReminders(
	ctx context.Context, now, leaseUntil time.Time, limit int,
) ([]port.WarrantyReminderClaim, error) {
	rows, err := r.q.Query(ctx, `WITH due AS (
		SELECT p.warranty_id, w.subject, w.vehicle_id, w.version, w.start_at, w.start_odometer_m,
		       w.zero_start_odometer_confirmed, w.term_s, w.term_distance_m
		FROM smart_warranty_reminders p JOIN vehicle_warranties w ON w.id=p.warranty_id `+warrantyVehicle+`
		WHERE v.archived_at IS NULL AND p.next_check_at <= $1 AND (p.lease_until IS NULL OR p.lease_until <= $1)
		  AND smart_feature_allowed(w.subject,'warranty_mileage')
		  AND w.subject <> $4 AND `+warrantyStartKnown+`
		  AND w.start_at <= $1 AND EXTRACT(EPOCH FROM ($1::timestamptz - w.start_at)) < w.term_s
		ORDER BY p.next_check_at, p.warranty_id LIMIT $3 FOR UPDATE OF p SKIP LOCKED
	)
	UPDATE smart_warranty_reminders p SET lease_until=$2,feature_claimed_at=statement_timestamp() FROM due
	WHERE p.warranty_id=due.warranty_id
	RETURNING p.warranty_id, due.subject, due.vehicle_id, due.version, due.start_at, due.start_odometer_m,
	          due.zero_start_odometer_confirmed, due.term_s, due.term_distance_m, p.generation, p.lease_until, p.published_at IS NOT NULL`,
		now, leaseUntil, limit, domain.LegacyOpenSubject)
	if err != nil {
		return nil, fmt.Errorf("claim due warranty reminders: %w", err)
	}
	claims, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.WarrantyReminderClaim, error) {
		var claim port.WarrantyReminderClaim
		w := &claim.Warranty
		err := row.Scan(&claim.Key.WarrantyID, &claim.Key.Subject, &claim.Key.VehicleID, &w.Version, &w.StartAt,
			&w.StartOdometerM, &w.ZeroStartOdometerConfirmed, &w.TermS, &w.TermDistanceM, &claim.Generation, &claim.LeaseUntil, &claim.Published)
		w.ID, w.VehicleID = claim.Key.WarrantyID, claim.Key.VehicleID
		return claim, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan due warranty reminders: %w", err)
	}
	return claims, nil
}

func (r *DurableRepository) WarrantyReminderDrives(
	ctx context.Context, claim port.WarrantyReminderClaim, from, until time.Time,
) ([]port.DriveRecord, error) {
	const maxSamples = 2000
	rows, err := r.q.Query(ctx, `SELECT d.id, d.started_at, d.ended_at, d.end_odometer_m FROM drives d
		WHERE d.vehicle_id=$3 AND d.started_at BETWEEN $7::timestamptz - INTERVAL '24 hours' AND $6
		  AND d.ended_at BETWEEN $7 AND $6 AND d.end_odometer_m IS NOT NULL
		  AND EXISTS (SELECT 1 FROM vehicle_warranties w `+warrantyVehicle+`
		    JOIN smart_warranty_reminders p ON p.warranty_id=w.id
		    WHERE `+warrantyOwner+` AND `+warrantyStartKnown+` AND p.generation=$4 AND p.lease_until=$5 AND p.lease_until>$6 AND w.version=$8
		      AND smart_feature_current(w.subject,'warranty_mileage',p.feature_claimed_at))
		ORDER BY d.ended_at DESC, d.id DESC LIMIT $9`, claim.Key.WarrantyID, claim.Key.Subject, claim.Key.VehicleID,
		claim.Generation, claim.LeaseUntil, until, from, claim.Warranty.Version, maxSamples+1)
	if err != nil {
		return nil, fmt.Errorf("read measured odometer for the opted-in reminder: %w", err)
	}
	drives, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.DriveRecord, error) {
		var drive port.DriveRecord
		err := row.Scan(&drive.ID, &drive.StartedAt, &drive.EndedAt, &drive.EndOdometerM)
		return drive, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan warranty distance observations: %w", err)
	}
	if len(drives) > maxSamples {
		return nil, nil
	}
	return drives, nil
}

func (r *DurableRepository) SaveWarrantyProjection(
	ctx context.Context, claim port.WarrantyReminderClaim, update port.WarrantyProjectionUpdate,
) (bool, error) {
	values := make([]any, 9)
	if p := update.Projection; p != nil {
		values = []any{p.RecordedAt, p.EvidenceFrom, p.ObservedDays, p.RemainingM, p.PaceMps, p.EarliestLimitAt,
			p.LatestLimitAt, p.DocumentedTermEnd, p.ExpiresAt}
	}
	args := append([]any{claim.Key.WarrantyID, claim.Key.Subject, claim.Key.VehicleID, claim.Generation, claim.LeaseUntil, update.CheckedAt, update.NextAt,
		claim.Warranty.Version}, values...)
	args = append(args, update.Publish)
	tag, err := r.q.Exec(ctx, `UPDATE smart_warranty_reminders p SET
		lease_until=NULL, next_check_at=$7, recorded_at=$9, evidence_from=$10, observed_days=$11, feature_checked_at=p.feature_claimed_at,
		remaining_m=$12, pace_mps=$13, earliest_at=$14, latest_at=$15, term_end=$16, expires_at=$17,
		published_at=CASE WHEN $18 THEN COALESCE(p.published_at, $6) ELSE p.published_at END
		FROM vehicle_warranties w `+warrantyVehicle+`
		WHERE p.warranty_id=w.id AND `+warrantyOwner+` AND `+warrantyStartKnown+` AND p.generation=$4 AND p.lease_until=$5
		  AND p.lease_until>$6 AND w.version=$8 AND smart_feature_current(w.subject,'warranty_mileage',p.feature_claimed_at)`, args...)
	if err != nil {
		return false, fmt.Errorf("save current warranty projection: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (r *DurableRepository) ListWarrantyReminderCandidates(
	ctx context.Context, subject string, vehicleID *int64, now, horizon time.Time, limit int,
) ([]port.WarrantyReminderCandidate, error) {
	rows, err := r.q.Query(ctx, `SELECT w.id, w.vehicle_id, w.label, v.display_name, `+reminderValues+`
		FROM smart_warranty_reminders p JOIN vehicle_warranties w ON w.id=p.warranty_id `+warrantyVehicle+`
		WHERE w.subject=$1 AND ($2::bigint IS NULL OR w.vehicle_id=$2) AND v.archived_at IS NULL
		  AND smart_feature_current(w.subject,'warranty_mileage',p.feature_checked_at)
		  AND `+warrantyStartKnown+` AND p.published_at IS NOT NULL AND p.expires_at>$3 AND p.latest_at <= $4
		ORDER BY p.earliest_at, w.id LIMIT $5`, subject, vehicleID, now, horizon, limit)
	if err != nil {
		return nil, fmt.Errorf("list current private warranty reminders: %w", err)
	}
	result, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (port.WarrantyReminderCandidate, error) {
		var candidate port.WarrantyReminderCandidate
		p := &candidate.Projection
		err := row.Scan(&p.WarrantyID, &p.VehicleID, &candidate.Warranty, &candidate.VehicleName,
			&p.RecordedAt, &p.EvidenceFrom, &p.ObservedDays, &p.RemainingM, &p.PaceMps,
			&p.EarliestLimitAt, &p.LatestLimitAt, &p.DocumentedTermEnd, &p.ExpiresAt)
		return candidate, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan current private warranty reminders: %w", err)
	}
	return result, nil
}
