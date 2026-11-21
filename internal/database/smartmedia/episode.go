package smartmedia

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

var _ port.EpisodeRepository = (*Repository)(nil)

func (r *Repository) ReadEpisodeReview(ctx context.Context, scope port.Scope) (*domain.StoredEpisodeReview, error) {
	stored := &domain.StoredEpisodeReview{Review: domain.EpisodeReview{VehicleID: scope.VehicleID}}
	review := &stored.Review
	var title *string
	var duration, position *int
	var completed *bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(p.id,0),p.departure_at,p.drive_duration_s,p.expires_at,COALESCE(p.spotify_episode,''),
			p.title,p.duration_s,p.position_s,p.completed
		FROM vehicles v LEFT JOIN smart_episode_reviews p ON p.vehicle_id=v.id AND p.subject=$1
		WHERE v.id=$2 AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID).
		Scan(&review.ID, &review.DepartureAt, &review.DriveDurationS, &review.ExpiresAt, &stored.EpisodeID,
			&title, &duration, &position, &completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read private episode review: %w", err)
	}
	if title != nil && duration != nil {
		stored.Progress = &domain.EpisodeProgress{
			ID: stored.EpisodeID, Title: *title, DurationS: *duration, PositionS: position, Completed: completed,
		}
	}
	return stored, nil
}

func (r *Repository) ReplaceEpisodeReview(ctx context.Context, scope port.Scope, c domain.EpisodeConfirmation,
	episodeID string, stateHash []byte, cipher string, now time.Time) error {
	var title *string
	var duration, position *int
	var completed *bool
	if c.Manual != nil {
		title, duration, position = &c.Manual.Title, &c.Manual.DurationS, c.Manual.PositionS
		if position != nil {
			played := *position == *duration
			completed = &played
		}
	}
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if *c.ExpectedID > 0 {
			tag, err := tx.Exec(ctx, `DELETE FROM smart_episode_reviews WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
				scope.Subject, scope.VehicleID, *c.ExpectedID)
			if err := changedPlaylistRow(tag, err, "replace exact private episode review"); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO smart_episode_reviews(subject,vehicle_id,confirmed_at,departure_at,drive_duration_s,expires_at,
				spotify_episode,title,duration_s,position_s,completed,state_hash,verifier_cipher,state_expires_at)
			SELECT $1,v.id,$3,$4::timestamptz,$5,LEAST($4,$3::timestamptz+INTERVAL '2 hours'),
				NULLIF($6,''),$7,$8,$9,$10,$11,NULLIF($12,''),CASE WHEN $11::bytea IS NULL THEN NULL
					ELSE LEAST($4,$3::timestamptz+INTERVAL '10 minutes') END
			FROM vehicles v WHERE v.id=$2 AND v.archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING`,
			scope.Subject, scope.VehicleID, now, c.DepartureAt, c.DriveDurationS, episodeID, title, duration, position, completed, stateHash, cipher)
		return changedPlaylistRow(tag, err, "confirm private episode review")
	})
}

func (r *Repository) ConsumeEpisodeAuthorization(ctx context.Context, subject string, stateHash []byte, now time.Time) (*port.EpisodeOAuth, error) {
	attempt := &port.EpisodeOAuth{Scope: port.Scope{Subject: subject}}
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT p.id,p.vehicle_id,p.spotify_episode,p.verifier_cipher
			FROM smart_episode_reviews p JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
			WHERE p.subject=$1 AND p.state_hash=$2 AND p.state_expires_at>$3 AND p.expires_at>$3 FOR UPDATE OF p`,
			subject, stateHash, now).Scan(&attempt.ReviewID, &attempt.Scope.VehicleID, &attempt.EpisodeID, &attempt.VerifierCipher)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read pending private episode authorization: %w", err)
		}
		tag, err := tx.Exec(ctx, `UPDATE smart_episode_reviews SET state_hash=NULL,verifier_cipher=NULL WHERE id=$1`,
			attempt.ReviewID)
		return changedPlaylistRow(tag, err, "consume private episode authorization")
	})
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

func (r *Repository) CheckEpisodeAuthorization(ctx context.Context, attempt port.EpisodeOAuth, now time.Time) error {
	var current bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM smart_episode_reviews p
		JOIN vehicles v ON v.id=p.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.spotify_episode=$4 AND p.state_hash IS NULL
			AND p.state_expires_at>$5 AND p.expires_at>$5 AND p.title IS NULL)`,
		attempt.Scope.Subject, attempt.Scope.VehicleID, attempt.ReviewID, attempt.EpisodeID, now).Scan(&current)
	if err != nil {
		return fmt.Errorf("recheck private episode authorization: %w", err)
	}
	if !current {
		return port.ErrChanged
	}
	return nil
}

func (r *Repository) FinishEpisodeAuthorization(ctx context.Context, attempt port.EpisodeOAuth, progress domain.EpisodeProgress, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_episode_reviews p SET title=$6,duration_s=$7,position_s=$8,completed=$9,state_expires_at=NULL
		FROM vehicles v WHERE v.id=p.vehicle_id AND v.archived_at IS NULL
			AND p.subject=$1 AND p.vehicle_id=$2 AND p.id=$3 AND p.spotify_episode=$4 AND p.state_hash IS NULL
			AND p.state_expires_at>$5 AND p.expires_at>$5 AND p.title IS NULL`,
		attempt.Scope.Subject, attempt.Scope.VehicleID, attempt.ReviewID, attempt.EpisodeID, now,
		progress.Title, progress.DurationS, progress.PositionS, progress.Completed)
	return changedPlaylistRow(tag, err, "finish private episode review")
}

func (r *Repository) ClearEpisodeReview(ctx context.Context, scope port.Scope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_episode_reviews WHERE subject=$1 AND vehicle_id=$2 AND id=$3`,
		scope.Subject, scope.VehicleID, id)
	return changedPlaylistRow(tag, err, "clear private episode review")
}
