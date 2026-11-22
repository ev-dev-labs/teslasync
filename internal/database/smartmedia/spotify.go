package smartmedia

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	port "github.com/ev-dev-labs/teslasync/internal/port/smartmedia"
)

func (r *Repository) StartSpotify(ctx context.Context, scope port.Scope, stateHash []byte, verifierCipher string, expiresAt time.Time) error {
	_, err := r.db.Pool.Exec(ctx, `
		INSERT INTO smart_spotify_connections (subject,state_hash,verifier_cipher,state_expires_at,return_vehicle_id)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subject) DO UPDATE SET revision=DEFAULT,
			state_hash=EXCLUDED.state_hash,verifier_cipher=EXCLUDED.verifier_cipher,state_expires_at=EXCLUDED.state_expires_at,
			return_vehicle_id=EXCLUDED.return_vehicle_id,token_cipher=NULL,token_expires_at=NULL`,
		scope.Subject, stateHash, verifierCipher, expiresAt, scope.VehicleID)
	if err != nil {
		return fmt.Errorf("begin private Spotify authorization: %w", err)
	}
	return nil
}

func (r *Repository) ConsumeSpotify(ctx context.Context, subject string, stateHash []byte, now time.Time) (*port.OAuthAttempt, error) {
	attempt := &port.OAuthAttempt{}
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT revision,return_vehicle_id,verifier_cipher FROM smart_spotify_connections
			WHERE subject=$1 AND state_hash=$2 AND state_expires_at>$3 FOR UPDATE`, subject, stateHash, now).
			Scan(&attempt.Revision, &attempt.VehicleID, &attempt.VerifierCipher)
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read matching private Spotify authorization: %w", err)
		}
		tag, err := tx.Exec(ctx, `UPDATE smart_spotify_connections SET state_hash=NULL,verifier_cipher=NULL
			WHERE subject=$1 AND revision=$2`, subject, attempt.Revision)
		return changedPlaylistRow(tag, err, "consume private Spotify authorization")
	})
	if errors.Is(err, port.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

func (r *Repository) SetSpotifyGrant(ctx context.Context, subject string, revision int64, grant port.Grant, now time.Time) error {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_spotify_connections SET token_cipher=$3,token_expires_at=$4
		WHERE subject=$1 AND revision=$2 AND state_hash IS NULL AND token_cipher IS NULL AND state_expires_at>$5`,
		subject, revision, grant.TokenCipher, grant.ExpiresAt, now)
	return changedPlaylistRow(tag, err, "store private Spotify grant")
}

func (r *Repository) SpotifyGrant(ctx context.Context, subject string, now time.Time) (*port.Grant, error) {
	grant := &port.Grant{}
	err := r.db.Pool.QueryRow(ctx, `
		SELECT revision,token_cipher,token_expires_at FROM smart_spotify_connections
		WHERE subject=$1 AND token_expires_at>$2`, subject, now).
		Scan(&grant.Revision, &grant.TokenCipher, &grant.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read current private Spotify grant: %w", err)
	}
	return grant, nil
}

func (r *Repository) DisconnectSpotify(ctx context.Context, subject string) error {
	if _, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_spotify_connections WHERE subject=$1`, subject); err != nil {
		return fmt.Errorf("disconnect Spotify from private media: %w", err)
	}
	return nil
}
