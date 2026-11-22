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

var _ port.SharedChargerRepository = (*Repository)(nil)

const activeSharedChargerScope = `
	FROM smart_shared_charger_plans p
	JOIN geofences g ON g.id = p.place_id AND g.updated_at = p.place_updated_at
	  AND g.enabled AND NOT g.needs_review AND g.archived_at IS NULL AND g.is_charging_location
	JOIN vehicles va ON va.id = p.vehicle_a_id AND va.archived_at IS NULL
	JOIN vehicles vb ON vb.id = p.vehicle_b_id AND vb.archived_at IS NULL`

const sharedChargerConfirmations = `
	JOIN smart_shared_charger_confirmations ca ON ca.plan_id = p.id AND ca.plan_revision = p.revision AND ca.position = 1
	JOIN smart_shared_charger_confirmations cb ON cb.plan_id = p.id AND cb.plan_revision = p.revision AND cb.position = 2`

const sharedChargerCurrentRef = `
	WHERE p.id = $1 AND p.revision = $2 AND p.authorized_at <= $3 AND p.expires_at > $3 AND p.revoked_at IS NULL`

const sharedChargerExactMember = `
	AND ((p.subject_a = $4 AND p.vehicle_a_id = $5) OR (p.subject_b = $4 AND p.vehicle_b_id = $5))`

const sharedChargerRecipientAccepted = `
	AND ((p.reminder_vehicle_id = p.vehicle_a_id AND ca.accept_reminder)
	  OR (p.reminder_vehicle_id = p.vehicle_b_id AND cb.accept_reminder))`

const sharedChargerRecipient = `CASE WHEN p.reminder_vehicle_id=p.vehicle_a_id THEN p.subject_a ELSE p.subject_b END`

func (r *Repository) AuthorizeSharedCharger(ctx context.Context, operator string, expected domain.SharedChargerRef,
	spec domain.SharedChargerAuthorization, now time.Time,
) (domain.SharedChargerRef, error) {
	var ref domain.SharedChargerRef
	err := pgx.BeginFunc(ctx, r.db.Pool, func(tx pgx.Tx) error {
		if expected.ID != 0 {
			if err := lockSharedChargerRevision(ctx, tx, operator, expected, now); err != nil {
				return err
			}
		}
		a, b := spec.Participants[0], spec.Participants[1]
		// Locks also protect the non-key review and archive fields from updates.
		var placeID int64
		err := tx.QueryRow(ctx, `
			SELECT g.id FROM geofences g
			JOIN vehicles va ON va.id = $3 AND va.archived_at IS NULL
			JOIN vehicles vb ON vb.id = $4 AND vb.archived_at IS NULL
			WHERE g.id = $1 AND g.updated_at = $2 AND g.enabled AND NOT g.needs_review
			  AND g.archived_at IS NULL AND g.is_charging_location AND va.id <> vb.id
			FOR NO KEY UPDATE OF g FOR SHARE OF va, vb`,
			spec.PlaceID, spec.PlaceUpdatedAt, a.VehicleID, b.VehicleID).Scan(&placeID)
		if err != nil {
			return err
		}
		var active bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM smart_shared_charger_plans
				WHERE place_id = $1 AND place_updated_at = $2 AND expires_at > $3 AND revoked_at IS NULL AND id <> $4)`,
			placeID, spec.PlaceUpdatedAt, now, expected.ID).Scan(&active); err != nil {
			return err
		}
		if active {
			return port.ErrSharedChargerActivePlan
		}
		if expected.ID == 0 {
			return tx.QueryRow(ctx, `
				INSERT INTO smart_shared_charger_plans
				  (authorized_by, authorized_at, place_id, place_updated_at, vehicle_a_id, subject_a,
				   vehicle_b_id, subject_b, reminder_vehicle_id, expires_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9::bigint, 0), $10)
				RETURNING id, revision`, operator, now, placeID, spec.PlaceUpdatedAt, a.VehicleID,
				a.Subject, b.VehicleID, b.Subject, spec.ReminderVehicleID, spec.ExpiresAt).Scan(&ref.ID, &ref.Revision)
		}
		if err := clearSharedChargerEvidence(ctx, tx, expected); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			UPDATE smart_shared_charger_plans SET
			  revision = revision + 1, authorized_by = $1, authorized_at = $2, place_id = $3,
			  place_updated_at = $4, vehicle_a_id = $5, subject_a = $6, vehicle_b_id = $7,
			  subject_b = $8, reminder_vehicle_id = NULLIF($9::bigint, 0), expires_at = $10
			WHERE id = $11 AND revision = $12
			RETURNING id, revision`, operator, now, placeID, spec.PlaceUpdatedAt, a.VehicleID,
			a.Subject, b.VehicleID, b.Subject, spec.ReminderVehicleID, spec.ExpiresAt,
			expected.ID, expected.Revision).Scan(&ref.ID, &ref.Revision)
	})
	if err != nil {
		return domain.SharedChargerRef{}, sharedChargerWriteError("authorize shared charger revision", err)
	}
	return ref, nil
}

func lockSharedChargerRevision(ctx context.Context, tx pgx.Tx, operator string, ref domain.SharedChargerRef, now time.Time) error {
	var id int64
	if err := tx.QueryRow(ctx, `
		SELECT p.id FROM smart_shared_charger_plans p `+sharedChargerCurrentRef+` AND p.authorized_by = $4 FOR UPDATE OF p`,
		ref.ID, ref.Revision, now, operator).Scan(&id); err != nil {
		return err
	}
	var published bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM smart_shared_charger_swaps WHERE plan_id = $1 AND published_at IS NOT NULL
	)`, id).Scan(&published); err != nil {
		return err
	}
	if published {
		return port.ErrSharedChargerSwapPublished
	}
	return nil
}

func clearSharedChargerEvidence(ctx context.Context, tx pgx.Tx, ref domain.SharedChargerRef) error {
	if _, err := tx.Exec(ctx, `DELETE FROM smart_shared_charger_swaps WHERE plan_id = $1 AND plan_revision = $2`,
		ref.ID, ref.Revision); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM smart_shared_charger_confirmations WHERE plan_id = $1 AND plan_revision = $2`,
		ref.ID, ref.Revision)
	return err
}

func (r *Repository) FindSharedChargerInvitation(ctx context.Context, subject string, ref domain.SharedChargerRef,
	vehicleID int64, now time.Time,
) (*domain.SharedChargerInvitation, error) {
	invite := domain.SharedChargerInvitation{Ref: ref, VehicleID: vehicleID}
	err := r.db.Pool.QueryRow(ctx, `
		SELECT p.place_id, p.place_updated_at, p.expires_at, COALESCE(p.reminder_vehicle_id = $5, false),
		  EXISTS (SELECT 1 FROM smart_shared_charger_confirmations c
		    WHERE c.plan_id = p.id AND c.plan_revision = p.revision
		      AND c.position = CASE WHEN p.vehicle_a_id = $5 THEN 1 ELSE 2 END)
		`+activeSharedChargerScope+sharedChargerCurrentRef+sharedChargerExactMember,
		ref.ID, ref.Revision, now, subject, vehicleID).
		Scan(&invite.PlaceID, &invite.PlaceUpdatedAt, &invite.ExpiresAt, &invite.ReminderOffered, &invite.Confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read shared charger invitation: %w", err)
	}
	invite.PlaceUpdatedAt, invite.ExpiresAt = invite.PlaceUpdatedAt.UTC(), invite.ExpiresAt.UTC()
	return &invite, nil
}

func (r *Repository) ConfirmSharedCharger(ctx context.Context, subject string, ref domain.SharedChargerRef,
	confirmation domain.SharedChargerConfirmation,
) error {
	request, now := confirmation.Request, confirmation.ConfirmedAt
	err := pgx.BeginFunc(ctx, r.db.Pool, func(tx pgx.Tx) error {
		var position int16
		err := tx.QueryRow(ctx, `
			SELECT (CASE WHEN p.vehicle_a_id = $5 THEN 1 ELSE 2 END)::smallint
			`+activeSharedChargerScope+sharedChargerCurrentRef+sharedChargerExactMember+`
			AND (NOT $6::boolean OR p.reminder_vehicle_id = $5)
			FOR UPDATE OF p FOR SHARE OF g, va, vb`,
			ref.ID, ref.Revision, now, subject, request.VehicleID, confirmation.AcceptReminder).Scan(&position)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_shared_charger_confirmations
			  (plan_id, plan_revision, position, available_at, departure_at, energy_needed_wh,
			   conservative_power_w, already_plugged, confirmed_at, accept_reminder)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (plan_id, plan_revision, position) DO NOTHING`,
			ref.ID, ref.Revision, position, request.AvailableAt, request.DepartureAt, request.EnergyNeededWh,
			request.ConservativePowerW, request.AlreadyPlugged, now, confirmation.AcceptReminder)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return port.ErrSharedChargerAlreadyConfirmed
		}
		return enqueueSharedChargerReminder(ctx, tx, subject, ref, now)
	})
	return sharedChargerWriteError("confirm shared charger vehicle", err)
}

func enqueueSharedChargerReminder(ctx context.Context, tx pgx.Tx, subject string, ref domain.SharedChargerRef, now time.Time) error {
	plan, err := readConfirmedSharedChargerPlan(ctx, tx, subject, ref, now)
	if err != nil || plan == nil {
		return err
	}
	evaluatedAt := now
	for _, c := range plan.Confirmations {
		if c.ConfirmedAt.After(evaluatedAt) {
			evaluatedAt = c.ConfirmedAt
		}
	}
	reminder := plan.ReminderFor(plan.CardAt(evaluatedAt))
	if reminder == nil {
		return nil
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO smart_shared_charger_swaps (plan_id, plan_revision, swap_at, expires_at)
		VALUES ($1, $2, $3, $4) ON CONFLICT (plan_id) DO NOTHING`,
		ref.ID, ref.Revision, reminder.SwapAt, reminder.ExpiresAt)
	return err
}

type sharedChargerRowQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func readConfirmedSharedChargerPlan(ctx context.Context, queryer sharedChargerRowQueryer, subject string,
	ref domain.SharedChargerRef, now time.Time,
) (*domain.SharedChargerConfirmedPlan, error) {
	plan := domain.SharedChargerConfirmedPlan{Ref: ref}
	a, b := &plan.Confirmations[0], &plan.Confirmations[1]
	err := queryer.QueryRow(ctx, `
		SELECT p.place_id, p.expires_at, COALESCE(p.reminder_vehicle_id, 0),
		  p.vehicle_a_id, ca.available_at, ca.departure_at, ca.energy_needed_wh, ca.conservative_power_w,
		  ca.already_plugged, ca.confirmed_at, ca.accept_reminder,
		  p.vehicle_b_id, cb.available_at, cb.departure_at, cb.energy_needed_wh, cb.conservative_power_w,
		  cb.already_plugged, cb.confirmed_at, cb.accept_reminder
		`+activeSharedChargerScope+sharedChargerConfirmations+sharedChargerCurrentRef+`
		AND (p.subject_a = $4 OR p.subject_b = $4)`, ref.ID, ref.Revision, now, subject).
		Scan(&plan.PlaceID, &plan.ExpiresAt, &plan.ReminderVehicleID,
			&a.Request.VehicleID, &a.Request.AvailableAt, &a.Request.DepartureAt, &a.Request.EnergyNeededWh,
			&a.Request.ConservativePowerW, &a.Request.AlreadyPlugged, &a.ConfirmedAt, &a.AcceptReminder,
			&b.Request.VehicleID, &b.Request.AvailableAt, &b.Request.DepartureAt, &b.Request.EnergyNeededWh,
			&b.Request.ConservativePowerW, &b.Request.AlreadyPlugged, &b.ConfirmedAt, &b.AcceptReminder)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read accepted shared charger revision: %w", err)
	}
	return &plan, nil
}

func (r *Repository) FindConfirmedSharedChargerPlan(ctx context.Context, subject string, ref domain.SharedChargerRef,
	now time.Time,
) (*domain.SharedChargerConfirmedPlan, error) {
	return readConfirmedSharedChargerPlan(ctx, r.db.Pool, subject, ref, now)
}

func (r *Repository) RevokeSharedCharger(ctx context.Context, subject string, ref domain.SharedChargerRef,
	vehicleID int64, now time.Time,
) error {
	err := pgx.BeginFunc(ctx, r.db.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE smart_shared_charger_plans SET revoked_at = $5
			WHERE id = $1 AND revision = $2 AND revoked_at IS NULL
			  AND (($4::bigint = 0 AND authorized_by = $3)
			    OR (subject_a = $3 AND vehicle_a_id = $4) OR (subject_b = $3 AND vehicle_b_id = $4))`,
			ref.ID, ref.Revision, subject, vehicleID, now)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return port.ErrNotFound
		}
		return clearSharedChargerEvidence(ctx, tx, ref)
	})
	return sharedChargerWriteError("revoke shared charger revision", err)
}

func (r *Repository) ListSharedChargerPlanning(ctx context.Context, subject string, includeOwned bool,
	now time.Time, limit, offset int,
) (port.SharedChargerPlanning, error) {
	result := port.SharedChargerPlanning{
		CanManage: includeOwned, Owned: []port.SharedChargerOwnedPlan{}, Invitations: []domain.SharedChargerInvitation{},
	}
	if limit <= 0 || offset < 0 || offset > 10000 {
		return result, nil
	}
	limit = min(limit, 50)
	if includeOwned {
		rows, err := r.db.Pool.Query(ctx, `
			SELECT p.id, p.revision, p.place_id, p.expires_at `+activeSharedChargerScope+`
			WHERE p.authorized_by = $1 AND p.authorized_at <= $2 AND p.expires_at > $2 AND p.revoked_at IS NULL
			ORDER BY p.expires_at, p.id LIMIT $3 OFFSET $4`, subject, now, limit, offset)
		if err != nil {
			return result, fmt.Errorf("list owned shared charger plans: %w", err)
		}
		result.Owned, err = pgx.AppendRows(result.Owned, rows, func(row pgx.CollectableRow) (port.SharedChargerOwnedPlan, error) {
			var plan port.SharedChargerOwnedPlan
			err := row.Scan(&plan.Ref.ID, &plan.Ref.Revision, &plan.PlaceID, &plan.ExpiresAt)
			plan.ExpiresAt = plan.ExpiresAt.UTC()
			return plan, err
		})
		if err != nil {
			return result, fmt.Errorf("scan owned shared charger plans: %w", err)
		}
	}
	rows, err := r.db.Pool.Query(ctx, `
			SELECT p.id, p.revision, member.vehicle_id, p.place_id, p.place_updated_at, p.expires_at,
			  COALESCE(p.reminder_vehicle_id = member.vehicle_id, false), c.position IS NOT NULL
			`+activeSharedChargerScope+`
			CROSS JOIN LATERAL (VALUES (p.vehicle_a_id, p.subject_a, 1),
			  (p.vehicle_b_id, p.subject_b, 2)) AS member(vehicle_id, subject, position)
			LEFT JOIN smart_shared_charger_confirmations c ON c.plan_id = p.id AND c.plan_revision = p.revision
			  AND c.position = member.position
			WHERE member.subject = $1 AND p.authorized_at <= $2 AND p.expires_at > $2 AND p.revoked_at IS NULL
			ORDER BY p.expires_at, p.id, member.position LIMIT $3 OFFSET $4`, subject, now, limit, offset)
	if err != nil {
		return result, fmt.Errorf("list exact subject shared charger invitations: %w", err)
	}
	result.Invitations, err = pgx.AppendRows(result.Invitations, rows, func(row pgx.CollectableRow) (domain.SharedChargerInvitation, error) {
		var invite domain.SharedChargerInvitation
		err := row.Scan(&invite.Ref.ID, &invite.Ref.Revision, &invite.VehicleID, &invite.PlaceID, &invite.PlaceUpdatedAt,
			&invite.ExpiresAt, &invite.ReminderOffered, &invite.Confirmed)
		invite.PlaceUpdatedAt, invite.ExpiresAt = invite.PlaceUpdatedAt.UTC(), invite.ExpiresAt.UTC()
		return invite, err
	})
	if err != nil {
		return result, fmt.Errorf("scan exact subject shared charger invitations: %w", err)
	}
	return result, nil
}

const sharedChargerSwapJoin = `
	JOIN smart_shared_charger_swaps o ON o.plan_id = p.id AND o.plan_revision = p.revision`

func (r *Repository) PublishDueSharedChargerReminders(ctx context.Context, now time.Time, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	// This is the entire delivery: a private in-app row becomes visible once.
	// Lock the plan, not the queue row first, to serialize with revocation.
	tag, err := r.db.Pool.Exec(ctx, `
		WITH expired AS MATERIALIZED (
		  SELECT id FROM smart_shared_charger_plans WHERE expires_at <= $1
		  ORDER BY expires_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
		), pruned AS (
		  DELETE FROM smart_shared_charger_plans p USING expired WHERE p.id = expired.id
		), due AS MATERIALIZED (
		  SELECT p.id, p.revision, `+sharedChargerRecipient+` AS recipient
		  `+activeSharedChargerScope+sharedChargerConfirmations+sharedChargerSwapJoin+`
		  WHERE o.swap_at <= $1 AND o.expires_at > $1
		    AND p.authorized_at <= $1 AND p.expires_at > $1 AND p.revoked_at IS NULL
		  `+sharedChargerRecipientAccepted+`
		  AND smart_feature_allowed(`+sharedChargerRecipient+`,'shared_charger')
		  AND (o.published_at IS NULL OR NOT smart_feature_current(`+sharedChargerRecipient+`,'shared_charger',o.feature_checked_at))
		  ORDER BY o.swap_at, p.id
		  LIMIT $2 FOR UPDATE OF p SKIP LOCKED FOR SHARE OF g, va, vb SKIP LOCKED
		)
		UPDATE smart_shared_charger_swaps o SET published_at=COALESCE(o.published_at,$1), feature_checked_at=statement_timestamp() FROM due
		WHERE o.plan_id = due.id AND o.plan_revision = due.revision
		  AND (o.published_at IS NULL OR NOT smart_feature_current(due.recipient,'shared_charger',o.feature_checked_at))`,
		now, min(limit, 50))
	if err != nil {
		return 0, fmt.Errorf("publish due private shared charger swaps: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *Repository) FindSharedChargerReminder(ctx context.Context, subject string, ref domain.SharedChargerRef,
	now time.Time,
) (*domain.SharedChargerReminder, error) {
	reminder := domain.SharedChargerReminder{Ref: ref}
	err := r.db.Pool.QueryRow(ctx, `
		SELECT p.reminder_vehicle_id, o.swap_at, o.expires_at
		`+activeSharedChargerScope+sharedChargerConfirmations+sharedChargerSwapJoin+sharedChargerCurrentRef+`
		AND o.published_at <= $3 AND o.expires_at > $3
		AND smart_feature_current($4,'shared_charger',o.feature_checked_at)
		`+sharedChargerRecipientAccepted+`
		AND ((p.reminder_vehicle_id = p.vehicle_a_id AND p.subject_a = $4)
		  OR (p.reminder_vehicle_id = p.vehicle_b_id AND p.subject_b = $4))`,
		ref.ID, ref.Revision, now, subject).
		Scan(&reminder.VehicleID, &reminder.SwapAt, &reminder.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read private shared charger swap: %w", err)
	}
	reminder.SwapAt, reminder.ExpiresAt = reminder.SwapAt.UTC(), reminder.ExpiresAt.UTC()
	return &reminder, nil
}

func sharedChargerWriteError(operation string, err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		return port.ErrNotFound
	default:
		return fmt.Errorf("%s: %w", operation, err)
	}
}
