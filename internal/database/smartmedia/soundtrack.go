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

var _ port.SoundtrackRepository = (*Repository)(nil)

func (r *Repository) ReadSoundtrack(ctx context.Context, scope port.JourneyScope, now time.Time) (*domain.SoundtrackSource, error) {
	source := &domain.SoundtrackSource{Review: domain.SoundtrackReview{
		VehicleID: scope.VehicleID, JourneyID: scope.JourneyID, Plays: make([]domain.TrackPlay, 0),
	}}
	var began time.Time
	err := pgx.BeginTxFunc(ctx, r.db.Pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		review := &source.Review
		var status string
		var allowed bool
		var start, end, recordedStart, recordedEnd *time.Time
		err := tx.QueryRow(ctx, `
			SELECT j.status,j.started_at,j.ended_at,COALESCE(p.id,0),p.started_at,p.ended_at,p.expires_at,
				COALESCE(p.paused,false),p.snoozed_until,smart_feature_allowed($1,'soundtrack'),statement_timestamp()
			FROM journey_sessions j JOIN vehicles v ON v.id=j.vehicle_id AND v.archived_at IS NULL
			LEFT JOIN smart_journey_soundtrack_reviews p ON p.journey_id=j.id AND p.vehicle_id=j.vehicle_id AND p.subject=$1
			WHERE j.id=$2 AND j.vehicle_id=$3`, scope.Subject, scope.JourneyID, scope.VehicleID).
			Scan(&status, &start, &end, &review.ID, &recordedStart, &recordedEnd, &review.ExpiresAt, &review.Paused, &review.SnoozedUntil, &allowed, &began)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read private soundtrack scope: %w", err)
		}
		review.StartedAt, review.EndedAt = start, end
		switch {
		case status != "completed" || start == nil || end == nil || now.Before(*end) || !end.After(*start) || end.Sub(*start) > 24*time.Hour:
			review.Reason = "journey_unmatched"
		case !now.Before(end.Add(30 * 24 * time.Hour)):
			review.Reason = "expired"
		case review.ID == 0:
			review.Reason = "off"
		case !start.Equal(*recordedStart) || !end.Equal(*recordedEnd):
			review.Reason = "journey_changed"
		case !review.ExpiresAt.After(now):
			review.Reason = "expired"
		case !allowed || review.Paused || (review.SnoozedUntil != nil && review.SnoozedUntil.After(now)):
			review.Reason = "held"
		default:
			review.Reason = "pending_evidence"
		}
		if review.Reason != "pending_evidence" {
			return nil
		}
		source.Drives, err = completedSoundtrackDrives(ctx, tx, scope.VehicleID, *start, *end)
		if err != nil {
			return err
		}
		if len(source.Drives) == 0 {
			return nil
		}
		source.Samples, err = readPlaybackSamples(ctx, tx, scope.VehicleID, *start, *end)
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
	var current bool
	err = r.db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM smart_journey_soundtrack_reviews p JOIN journey_sessions j ON j.id=p.journey_id
			JOIN vehicles v ON v.id=j.vehicle_id AND v.archived_at IS NULL
			WHERE p.subject=$1 AND p.journey_id=$2 AND p.vehicle_id=$3 AND p.id=$4 AND p.expires_at>$5 AND NOT p.paused
				AND (p.snoozed_until IS NULL OR p.snoozed_until<=$5) AND j.status='completed' AND j.vehicle_id=p.vehicle_id
				AND j.started_at=p.started_at AND j.ended_at=p.ended_at
				AND smart_feature_current(p.subject,'soundtrack',$6)
		)`, scope.Subject, scope.JourneyID, scope.VehicleID, source.Review.ID, now, began).Scan(&current)
	if err != nil {
		return nil, fmt.Errorf("recheck concurrent soundtrack consent: %w", err)
	}
	if !current {
		return nil, port.ErrChanged
	}
	return source, nil
}

func completedSoundtrackDrives(ctx context.Context, tx pgx.Tx, vehicle int64, start, end time.Time) ([]domain.DriveWindow, error) {
	const maxDrives = 30
	rows, err := tx.Query(ctx, `
		SELECT id,started_at,ended_at FROM drives
		WHERE vehicle_id=$1 AND started_at<$3 AND (ended_at>$2 OR (ended_at IS NULL AND started_at>=$2))
		ORDER BY started_at,id LIMIT $4`, vehicle, start, end, maxDrives+1)
	if err != nil {
		return nil, fmt.Errorf("read matched soundtrack drives: %w", err)
	}
	defer rows.Close()
	drives := make([]domain.DriveWindow, 0)
	cursor := start
	for rows.Next() {
		var drive domain.DriveWindow
		var finished *time.Time
		if err := rows.Scan(&drive.ID, &drive.StartedAt, &finished); err != nil {
			return nil, fmt.Errorf("scan matched soundtrack drive: %w", err)
		}
		if len(drives) == maxDrives || finished == nil || drive.StartedAt.Before(cursor) ||
			!finished.After(drive.StartedAt) || finished.After(end) {
			return nil, nil
		}
		drive.EndedAt = *finished
		cursor = *finished
		drives = append(drives, drive)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("complete matched soundtrack drive read: %w", err)
	}
	return drives, nil
}

func (r *Repository) ConfirmSoundtrack(ctx context.Context, scope port.JourneyScope, confirmation domain.SoundtrackConfirmation, now time.Time) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		expectedID := *confirmation.ExpectedID
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_journey_soundtrack_reviews
				WHERE subject=$1 AND journey_id=$2 AND vehicle_id=$3 AND id=$4`,
				scope.Subject, scope.JourneyID, scope.VehicleID, expectedID)
			if err := changedPlaylistRow(tag, err, "replace private soundtrack consent"); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_journey_soundtrack_reviews(subject,journey_id,vehicle_id,started_at,ended_at,confirmed_at,expires_at)
			SELECT $1,j.id,j.vehicle_id,j.started_at,j.ended_at,$4,
				LEAST($4::timestamptz+INTERVAL '168 hours',j.ended_at+INTERVAL '720 hours')
			FROM journey_sessions j JOIN vehicles v ON v.id=j.vehicle_id AND v.archived_at IS NULL
			WHERE j.id=$2 AND j.vehicle_id=$3 AND j.status='completed' AND j.ended_at<=$4
				AND j.ended_at>$4::timestamptz-INTERVAL '720 hours'
				AND j.ended_at>j.started_at AND j.ended_at<=j.started_at+INTERVAL '24 hours'
				AND j.started_at=$5 AND j.ended_at=$6
			ON CONFLICT (subject,journey_id) DO NOTHING`, scope.Subject, scope.JourneyID, scope.VehicleID, now,
			confirmation.StartedAt, confirmation.EndedAt)
		return changedPlaylistRow(tag, err, "store private soundtrack consent")
	})
}

func (r *Repository) HoldSoundtrack(ctx context.Context, scope port.JourneyScope, id int64, snoozedUntil *time.Time, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_journey_soundtrack_reviews p SET paused=$5::timestamptz IS NULL,snoozed_until=$5::timestamptz
		FROM journey_sessions j JOIN vehicles v ON v.id=j.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.journey_id=$2 AND p.vehicle_id=$3 AND p.id=$4 AND p.expires_at>$6 AND NOT p.paused
			AND j.id=p.journey_id AND j.vehicle_id=p.vehicle_id AND j.status='completed'
			AND j.started_at=p.started_at AND j.ended_at=p.ended_at`,
		scope.Subject, scope.JourneyID, scope.VehicleID, id, snoozedUntil, now)
	return changedPlaylistRow(tag, err, "hold private soundtrack consent")
}

func (r *Repository) ClearSoundtrack(ctx context.Context, scope port.JourneyScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_journey_soundtrack_reviews WHERE subject=$1 AND journey_id=$2 AND vehicle_id=$3 AND id=$4`,
		scope.Subject, scope.JourneyID, scope.VehicleID, id)
	return changedPlaylistRow(tag, err, "clear private soundtrack consent")
}
