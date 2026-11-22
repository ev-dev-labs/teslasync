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

func (r *Repository) StartLibraryAuthorization(ctx context.Context, scope port.DriveScope, id int64, stateHash []byte, cipher string, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_drive_track_reviews p SET grant_revision=grant_revision+1,state_hash=$5,verifier_cipher=$6,
			state_expires_at=LEAST(p.expires_at,$7::timestamptz+INTERVAL '10 minutes'),token_cipher=NULL,token_expires_at=NULL,
			feature_authorized_at=statement_timestamp()
		FROM drives d JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.drive_id=$2 AND p.vehicle_id=$3 AND p.id=$4 AND p.expires_at>$7 AND p.save_status='review'
			AND smart_feature_allowed(p.subject,'drive_track')
			AND d.id=p.drive_id AND d.vehicle_id=p.vehicle_id AND d.started_at=p.started_at AND d.ended_at=p.ended_at`,
		scope.Subject, scope.DriveID, scope.VehicleID, id, stateHash, cipher, now)
	return changedPlaylistRow(tag, err, "begin private Spotify library authorization")
}

func (r *Repository) ConsumeLibraryAuthorization(ctx context.Context, subject string, stateHash []byte, now time.Time) (*port.LibraryOAuthAttempt, error) {
	attempt := &port.LibraryOAuthAttempt{Scope: port.DriveScope{Scope: port.Scope{Subject: subject}}}
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT p.id,p.grant_revision,p.drive_id,p.vehicle_id,p.verifier_cipher
			FROM smart_drive_track_reviews p JOIN drives d ON d.id=p.drive_id AND d.vehicle_id=p.vehicle_id
			JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
			WHERE p.subject=$1 AND p.state_hash=$2 AND p.state_expires_at>$3 AND p.expires_at>$3 AND p.save_status='review'
				AND smart_feature_current(p.subject,'drive_track',p.feature_authorized_at)
				AND d.started_at=p.started_at AND d.ended_at=p.ended_at FOR UPDATE OF p`, subject, stateHash, now).
			Scan(&attempt.ReviewID, &attempt.Revision, &attempt.Scope.DriveID, &attempt.Scope.VehicleID, &attempt.VerifierCipher)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read matching Spotify library authorization: %w", err)
		}
		tag, err := tx.Exec(ctx, `UPDATE smart_drive_track_reviews SET state_hash=NULL,verifier_cipher=NULL
			WHERE subject=$1 AND id=$2 AND grant_revision=$3`, subject, attempt.ReviewID, attempt.Revision)
		return changedPlaylistRow(tag, err, "consume private Spotify library authorization")
	})
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

func (r *Repository) SetLibraryGrant(ctx context.Context, attempt port.LibraryOAuthAttempt, cipher string, expiry, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_drive_track_reviews p SET token_cipher=$6,token_expires_at=LEAST(p.expires_at,$7::timestamptz)
		FROM drives d JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.drive_id=$2 AND p.vehicle_id=$3 AND p.id=$4 AND p.grant_revision=$5
			AND smart_feature_current(p.subject,'drive_track',p.feature_authorized_at)
			AND p.state_hash IS NULL AND p.token_cipher IS NULL AND p.state_expires_at>$8 AND p.expires_at>$8 AND p.save_status='review'
			AND d.id=p.drive_id AND d.vehicle_id=p.vehicle_id AND d.started_at=p.started_at AND d.ended_at=p.ended_at`,
		attempt.Scope.Subject, attempt.Scope.DriveID, attempt.Scope.VehicleID, attempt.ReviewID, attempt.Revision, cipher, expiry, now)
	return changedPlaylistRow(tag, err, "store private Spotify library grant")
}

func (r *Repository) ReadLibraryGrant(ctx context.Context, scope port.DriveScope, id int64, now time.Time) (*port.Grant, error) {
	grant := &port.Grant{}
	err := r.db.Pool.QueryRow(ctx, `SELECT p.grant_revision,p.token_cipher,p.token_expires_at
		FROM smart_drive_track_reviews p JOIN drives d ON d.id=p.drive_id AND d.vehicle_id=p.vehicle_id
		JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.drive_id=$2 AND p.vehicle_id=$3 AND p.id=$4 AND p.expires_at>$5 AND p.token_expires_at>$5
			AND smart_feature_current(p.subject,'drive_track',p.feature_authorized_at)
			AND p.save_status='review' AND d.started_at=p.started_at AND d.ended_at=p.ended_at`,
		scope.Subject, scope.DriveID, scope.VehicleID, id, now).Scan(&grant.Revision, &grant.TokenCipher, &grant.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read private Spotify library grant: %w", err)
	}
	return grant, nil
}

func (r *Repository) DisconnectLibrary(ctx context.Context, scope port.DriveScope, id int64) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_drive_track_reviews SET grant_revision=grant_revision+1,
			state_hash=NULL,verifier_cipher=NULL,state_expires_at=NULL,token_cipher=NULL,token_expires_at=NULL
		WHERE subject=$1 AND drive_id=$2 AND vehicle_id=$3 AND id=$4`, scope.Subject, scope.DriveID, scope.VehicleID, id)
	return changedPlaylistRow(tag, err, "disconnect Spotify library")
}

func (r *Repository) ClaimTrackSave(ctx context.Context, scope port.DriveScope, id, revision int64, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_drive_track_reviews p SET save_status='saving',claimed_at=$6
		FROM drives d JOIN vehicles v ON v.id=d.vehicle_id AND v.archived_at IS NULL
		WHERE p.subject=$1 AND p.drive_id=$2 AND p.vehicle_id=$3 AND p.id=$4 AND p.grant_revision=$5
			AND smart_feature_current(p.subject,'drive_track',p.feature_authorized_at)
			AND p.expires_at>$6 AND p.token_expires_at>$6 AND p.save_status='review'
			AND d.id=p.drive_id AND d.vehicle_id=p.vehicle_id AND d.started_at=p.started_at AND d.ended_at=p.ended_at
			AND NOT EXISTS (SELECT 1 FROM drives other WHERE other.vehicle_id=d.vehicle_id AND other.id<>d.id
				AND other.started_at<=p.selected_at AND
				(other.ended_at>p.selected_at OR (other.ended_at IS NULL AND other.started_at>=d.started_at)))`,
		scope.Subject, scope.DriveID, scope.VehicleID, id, revision, now)
	return changedPlaylistRow(tag, err, "claim one private library save")
}

func (r *Repository) FinishTrackSave(ctx context.Context, scope port.DriveScope, id int64, status domain.TrackSaveStatus) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_drive_track_reviews SET save_status=$5,grant_revision=grant_revision+1,
			state_hash=NULL,verifier_cipher=NULL,state_expires_at=NULL,token_cipher=NULL,token_expires_at=NULL
		WHERE subject=$1 AND drive_id=$2 AND vehicle_id=$3 AND id=$4 AND save_status='saving'`,
		scope.Subject, scope.DriveID, scope.VehicleID, id, status)
	return changedPlaylistRow(tag, err, "record private Spotify library save outcome")
}
