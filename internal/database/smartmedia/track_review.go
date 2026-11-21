package smartmedia

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var _ port.TrackReviewRepository = (*Repository)(nil)

func (r *Repository) ReadDriveTrack(ctx context.Context, scope port.DriveScope, now time.Time) (*domain.DriveTrackSource, error) {
	source := &domain.DriveTrackSource{Review: domain.DriveTrackReview{DriveID: scope.DriveID, VehicleID: scope.VehicleID}}
	err := pgx.BeginTxFunc(ctx, r.db.Pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		review := &source.Review
		var savedStart, savedEnd *time.Time
		var competing bool
		err := tx.QueryRow(ctx, `
			SELECT d.started_at,d.ended_at,COALESCE(p.id,0),p.started_at,p.ended_at,p.selected_at,p.expires_at,
				CASE WHEN p.save_status='saving' AND p.claimed_at <= $4::timestamptz-INTERVAL '2 minutes' THEN 'unknown'
					ELSE COALESCE(p.save_status,'') END,
				COALESCE(p.token_expires_at>$4,false),
				EXISTS (SELECT 1 FROM drives other WHERE p.selected_at IS NOT NULL AND other.vehicle_id=d.vehicle_id
					AND other.id<>d.id AND other.started_at<=p.selected_at AND
					(other.ended_at>p.selected_at OR (other.ended_at IS NULL AND other.started_at>=d.started_at)))
			FROM drives d JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
			LEFT JOIN smart_drive_track_reviews p ON p.drive_id=d.id AND p.vehicle_id=d.vehicle_id AND p.subject=$1
			WHERE d.id=$2 AND d.vehicle_id=$3`, scope.Subject, scope.DriveID, scope.VehicleID, now).
			Scan(&review.StartedAt, &review.EndedAt, &review.ID, &savedStart, &savedEnd, &review.SelectedAt, &review.ExpiresAt,
				&review.Status, &review.LibraryConnected, &competing)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read private drive-track scope: %w", err)
		}
		switch {
		case review.EndedAt == nil || !review.EndedAt.After(review.StartedAt) || review.EndedAt.After(now) ||
			review.EndedAt.Sub(review.StartedAt) > 24*time.Hour:
			review.Reason = "drive_unmatched"
		case review.ID == 0:
			review.Reason = "off"
		case !savedStart.Equal(review.StartedAt) || !savedEnd.Equal(*review.EndedAt):
			review.Reason = "drive_changed"
		case !review.ExpiresAt.After(now):
			review.Reason = "expired"
		case competing:
			review.Reason = "drive_unmatched"
		default:
			review.Reason = "pending_evidence"
		}
		if review.Reason != "pending_evidence" {
			review.LibraryConnected = false
			return nil
		}
		from := review.StartedAt
		if limit := review.SelectedAt.Add(-2 * time.Hour); limit.After(from) {
			from = limit
		}
		to := *review.EndedAt
		if limit := review.SelectedAt.Add(30 * time.Second); limit.Before(to) {
			to = limit
		}
		source.Samples, err = readPlaybackSamples(ctx, tx, scope.VehicleID, from, to)
		if errors.Is(err, signal.ErrTimelineEventLimit) {
			review.Reason = "evidence_limit"
			return nil
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	if source.Review.Reason != "pending_evidence" {
		return source, nil
	}
	if err := r.currentDriveTrack(ctx, scope, source.Review.ID, now); err != nil {
		return nil, err
	}
	return source, nil
}

func (r *Repository) currentDriveTrack(ctx context.Context, scope port.DriveScope, id int64, now time.Time) error {
	var allowed bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1
		FROM smart_drive_track_reviews p JOIN drives d ON d.id=p.drive_id AND d.vehicle_id=p.vehicle_id
		JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.drive_id=$2 AND p.vehicle_id=$3 AND p.id=$4 AND p.expires_at>$5
			AND d.started_at=p.started_at AND d.ended_at=p.ended_at
			AND NOT EXISTS (SELECT 1 FROM drives other WHERE other.vehicle_id=d.vehicle_id AND other.id<>d.id
				AND other.started_at<=p.selected_at AND
				(other.ended_at>p.selected_at OR (other.ended_at IS NULL AND other.started_at>=d.started_at))))`,
		scope.Subject, scope.DriveID, scope.VehicleID, id, now).Scan(&allowed)
	if err != nil {
		return fmt.Errorf("recheck private track review consent: %w", err)
	}
	if !allowed {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) ConfirmDriveTrack(ctx context.Context, scope port.DriveScope, c domain.DriveTrackConfirmation, selected, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if *c.ExpectedID > 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_drive_track_reviews WHERE subject=$1 AND drive_id=$2 AND vehicle_id=$3
				AND id=$4 AND (save_status<>'saving' OR claimed_at <= $5::timestamptz-INTERVAL '2 minutes')`,
				scope.Subject, scope.DriveID, scope.VehicleID, *c.ExpectedID, now)
			if err := changedPlaylistRow(tag, err, "replace private drive-track selection"); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_drive_track_reviews(subject,drive_id,vehicle_id,started_at,ended_at,selected_at,confirmed_at,expires_at)
			SELECT $1,d.id,d.vehicle_id,d.started_at,d.ended_at,$7,$4,$4::timestamptz+INTERVAL '30 minutes'
			FROM drives d JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
			WHERE d.id=$2 AND d.vehicle_id=$3 AND d.started_at=$5 AND d.ended_at=$6 AND d.ended_at<=$4
				AND d.ended_at>d.started_at AND d.ended_at<=d.started_at+INTERVAL '24 hours'
				AND $7::timestamptz>=d.started_at AND $7<d.ended_at
			ON CONFLICT (subject,drive_id) DO NOTHING`, scope.Subject, scope.DriveID, scope.VehicleID, now, c.StartedAt, c.EndedAt, selected)
		return changedPlaylistRow(tag, err, "store private drive-track selection")
	})
}

func (r *Repository) ClearDriveTrack(ctx context.Context, scope port.DriveScope, id int64, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_drive_track_reviews WHERE subject=$1 AND drive_id=$2 AND vehicle_id=$3
		AND id=$4 AND (save_status<>'saving' OR claimed_at <= $5::timestamptz-INTERVAL '2 minutes')`,
		scope.Subject, scope.DriveID, scope.VehicleID, id, now)
	return changedPlaylistRow(tag, err, "clear private drive-track review")
}
