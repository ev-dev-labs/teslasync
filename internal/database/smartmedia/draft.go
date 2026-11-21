package smartmedia

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

var _ port.Repository = (*Repository)(nil)

func (r *Repository) ReadDraft(ctx context.Context, scope port.Scope) (*domain.PlaylistDraft, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT d.id,d.departure_at,d.created_at,d.target_duration_s,d.paused,d.snoozed_until,
			d.status,d.dispatch_at,COALESCE(d.playlist_id,''),
			c.position,c.title,c.artist,c.duration_s,c.observed_at,c.suggested
		FROM smart_media_playlist_drafts d
		JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
		LEFT JOIN smart_media_playlist_candidates c ON c.draft_id=d.id
		WHERE d.subject=$1 AND d.vehicle_id=$2 ORDER BY c.position`, scope.Subject, scope.VehicleID)
	if err != nil {
		return nil, fmt.Errorf("query private playlist preview: %w", err)
	}
	defer rows.Close()
	draft := &domain.PlaylistDraft{VehicleID: scope.VehicleID, Candidates: make([]domain.PlaylistCandidate, 0)}
	for rows.Next() {
		var position, duration *int
		var title, artist *string
		var observed *time.Time
		var suggested *bool
		if err := rows.Scan(&draft.ID, &draft.DepartureAt, &draft.CreatedAt, &draft.TargetDurationS, &draft.Paused,
			&draft.SnoozedUntil, &draft.Status, &draft.DispatchAt, &draft.PlaylistID,
			&position, &title, &artist, &duration, &observed, &suggested); err != nil {
			return nil, fmt.Errorf("decode private playlist preview: %w", err)
		}
		if position != nil {
			draft.Candidates = append(draft.Candidates, domain.PlaylistCandidate{
				Position: *position, Title: *title, Artist: *artist, DurationS: *duration, ObservedAt: *observed, Suggested: *suggested,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read private playlist preview: %w", err)
	}
	if draft.ID == 0 {
		return nil, nil
	}
	draft.ExpiresAt = draft.DepartureAt
	return draft, nil
}

func (r *Repository) ReplaceDraft(ctx context.Context, scope port.Scope, expectedID int64, draft domain.PlaylistDraft) error {
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if expectedID != 0 {
			tag, err := tx.Exec(ctx, `
				DELETE FROM smart_media_playlist_drafts
				WHERE subject=$1 AND vehicle_id=$2 AND id=$3 AND status='preview'`, scope.Subject, scope.VehicleID, expectedID)
			if err := changedPlaylistRow(tag, err, "replace private playlist preview"); err != nil {
				return err
			}
		}
		var id int64
		err := tx.QueryRow(ctx, `
			INSERT INTO smart_media_playlist_drafts (subject,vehicle_id,departure_at,created_at,target_duration_s)
			SELECT $1,v.id,$3,$4,$5 FROM vehicles v WHERE v.id=$2 AND v.archived_at IS NULL
			ON CONFLICT (subject,vehicle_id) DO NOTHING RETURNING id`,
			scope.Subject, scope.VehicleID, draft.DepartureAt, draft.CreatedAt, draft.TargetDurationS).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrChanged
		}
		if err != nil {
			return fmt.Errorf("create private playlist preview: %w", err)
		}
		if len(draft.Candidates) == 0 {
			return nil
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"smart_media_playlist_candidates"},
			[]string{"draft_id", "position", "title", "artist", "duration_s", "observed_at", "suggested"},
			pgx.CopyFromSlice(len(draft.Candidates), func(i int) ([]any, error) {
				candidate := draft.Candidates[i]
				return []any{id, candidate.Position, candidate.Title, candidate.Artist, candidate.DurationS, candidate.ObservedAt, candidate.Suggested}, nil
			})); err != nil {
			return fmt.Errorf("store bounded private playlist candidates: %w", err)
		}
		return nil
	})
}

func (r *Repository) HoldDraft(ctx context.Context, scope port.Scope, id int64, snoozedUntil *time.Time, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_media_playlist_drafts d SET paused=$4::timestamptz IS NULL,snoozed_until=$4::timestamptz
		FROM vehicles v WHERE d.subject=$1 AND d.vehicle_id=$2 AND d.id=$3 AND d.status='preview' AND NOT d.paused
			AND v.id=d.vehicle_id AND v.archived_at IS NULL AND d.departure_at>$5`,
		scope.Subject, scope.VehicleID, id, snoozedUntil, now)
	return changedPlaylistRow(tag, err, "hold private playlist preview")
}

func (r *Repository) DeleteDraft(ctx context.Context, scope port.Scope, id int64, abandonedBefore time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		DELETE FROM smart_media_playlist_drafts WHERE subject=$1 AND vehicle_id=$2 AND id=$3
			AND (status<>'saving' OR dispatch_at<=$4)`, scope.Subject, scope.VehicleID, id, abandonedBefore)
	return changedPlaylistRow(tag, err, "delete private playlist preview")
}

func (r *Repository) ClaimPlaylistSave(ctx context.Context, scope port.Scope, id, revision int64, now time.Time) (bool, error) {
	var claimed bool
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var locked int64
		err := tx.QueryRow(ctx, `
			SELECT revision FROM smart_spotify_connections
			WHERE subject=$1 AND revision=$2 AND token_expires_at>$3 FOR SHARE`, scope.Subject, revision, now).Scan(&locked)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock current Spotify consent: %w", err)
		}
		tag, err := tx.Exec(ctx, `
			UPDATE smart_media_playlist_drafts d SET status='saving',dispatch_at=$4
			FROM vehicles v WHERE d.subject=$1 AND d.vehicle_id=$2 AND d.id=$3 AND d.status='preview'
			AND NOT d.paused AND d.departure_at>$4 AND (d.snoozed_until IS NULL OR d.snoozed_until<=$4)
			AND v.id=d.vehicle_id AND v.archived_at IS NULL`, scope.Subject, scope.VehicleID, id, now)
		if err != nil {
			return fmt.Errorf("claim private playlist save: %w", err)
		}
		claimed = tag.RowsAffected() == 1
		return nil
	})
	return claimed, err
}

func (r *Repository) CanSendPlaylistItems(ctx context.Context, scope port.Scope, id, revision int64, now time.Time) (bool, error) {
	var allowed bool
	err := r.db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM smart_media_playlist_drafts d JOIN vehicles v ON v.id=d.vehicle_id
			JOIN smart_spotify_connections c ON c.subject=d.subject
			WHERE d.subject=$1 AND d.vehicle_id=$2 AND d.id=$3 AND d.status='saving' AND d.playlist_id IS NOT NULL
				AND v.archived_at IS NULL AND c.revision=$4 AND c.token_expires_at>$5 AND d.departure_at>$5
		)`, scope.Subject, scope.VehicleID, id, revision, now).Scan(&allowed)
	if err != nil {
		return false, fmt.Errorf("recheck consent before populating private playlist: %w", err)
	}
	return allowed, nil
}

func (r *Repository) RecordPlaylistCreated(ctx context.Context, scope port.Scope, id int64, playlistID string) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_media_playlist_drafts SET playlist_id=$4
		WHERE subject=$1 AND vehicle_id=$2 AND id=$3 AND status='saving' AND playlist_id IS NULL`,
		scope.Subject, scope.VehicleID, id, playlistID)
	return changedPlaylistRow(tag, err, "record private Spotify playlist identity")
}

func (r *Repository) FinishPlaylistSave(ctx context.Context, scope port.Scope, id int64, status domain.PlaylistSaveStatus) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_media_playlist_drafts SET status=$4
		WHERE subject=$1 AND vehicle_id=$2 AND id=$3 AND status='saving'`,
		scope.Subject, scope.VehicleID, id, status)
	return changedPlaylistRow(tag, err, "record private Spotify playlist outcome")
}

func changedPlaylistRow(tag pgconn.CommandTag, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if tag.RowsAffected() != 1 {
		return port.ErrChanged
	}
	return nil
}
