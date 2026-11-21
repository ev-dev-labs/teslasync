package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/jackc/pgx/v5"
)

type SolarEnergyConnectionRepository struct {
	db  *database.DB
	enc *crypto.Encryptor
}

var _ port.SolarEnergyConnectionRepository = (*SolarEnergyConnectionRepository)(nil)

func NewSolarEnergyConnectionRepository(db *database.DB, enc *crypto.Encryptor) *SolarEnergyConnectionRepository {
	return &SolarEnergyConnectionRepository{db: db, enc: enc}
}

func (r *SolarEnergyConnectionRepository) BeginEnergyAuthorization(ctx context.Context, subject string, siteID int64,
	stateHash [32]byte, expiresAt time.Time,
) error {
	if r.enc == nil {
		return port.ErrNotFound
	}
	tag, err := r.db.Pool.Exec(ctx, `
		INSERT INTO smart_solar_energy_connections AS c (subject, energy_site_id, state_hash, expires_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (subject) DO UPDATE SET energy_site_id = EXCLUDED.energy_site_id, state_hash = EXCLUDED.state_hash,
		  state_claimed_at = NULL, expires_at = EXCLUDED.expires_at
		WHERE c.state_hash IS NOT NULL`, subject, siteID, stateHash[:], expiresAt)
	if err != nil {
		return fmt.Errorf("begin energy authorization: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrNotFound
	}
	return nil
}

func (r *SolarEnergyConnectionRepository) ClaimEnergyAuthorization(ctx context.Context, subject string,
	stateHash [32]byte, now time.Time,
) (*port.SolarEnergyAuthorization, error) {
	if r.enc == nil {
		return nil, port.ErrNotFound
	}
	scope := &port.SolarEnergyAuthorization{Subject: subject}
	err := r.db.Pool.QueryRow(ctx, `
		UPDATE smart_solar_energy_connections SET state_claimed_at = $3
		WHERE subject = $1 AND state_hash = $2 AND state_claimed_at IS NULL AND expires_at > $3
		RETURNING id, energy_site_id`, subject, stateHash[:], now).Scan(&scope.ID, &scope.SiteID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, port.ErrClaimLost
	}
	if err != nil {
		return nil, fmt.Errorf("claim energy authorization: %w", err)
	}
	return scope, nil
}

func (r *SolarEnergyConnectionRepository) CompleteEnergyAuthorization(ctx context.Context, auth port.SolarEnergyAuthorization,
	stateHash [32]byte, tokens port.SolarEnergyTokens, now time.Time,
) error {
	access, refresh, err := r.encryptTokens(tokens)
	if err != nil {
		return err
	}
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_solar_energy_connections SET state_hash = NULL, state_claimed_at = NULL,
		  encrypted_access_token = $6, encrypted_refresh_token = $7, expires_at = $8, refresh_after = $5
		WHERE id = $1 AND subject = $2 AND energy_site_id = $3
		  AND state_hash = $4 AND state_claimed_at IS NOT NULL AND expires_at > $5`,
		auth.ID, auth.Subject, auth.SiteID, stateHash[:], now, access, refresh, tokens.ExpiresAt)
	if err != nil {
		return fmt.Errorf("complete energy authorization: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrClaimLost
	}
	return nil
}

func (r *SolarEnergyConnectionRepository) FindSolarEnergySite(ctx context.Context, subject string) (int64, error) {
	var siteID int64
	err := r.db.Pool.QueryRow(ctx, `
		SELECT energy_site_id FROM smart_solar_energy_connections
		WHERE subject = $1 AND state_hash IS NULL`, subject).Scan(&siteID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("find authorized energy site: %w", err)
	}
	return siteID, nil
}

func (r *SolarEnergyConnectionRepository) DisconnectSolarEnergy(ctx context.Context, subject string) error {
	if _, err := r.db.Pool.Exec(ctx, `DELETE FROM smart_solar_energy_connections WHERE subject = $1`, subject); err != nil {
		return fmt.Errorf("disconnect solar energy grant: %w", err)
	}
	return nil
}

func (r *SolarEnergyConnectionRepository) FindSolarEnergyAccessToken(ctx context.Context, subject string,
	siteID int64, validUntil time.Time,
) (string, error) {
	if r.enc == nil {
		return "", port.ErrNotFound
	}
	var encrypted string
	err := r.db.Pool.QueryRow(ctx, `
		SELECT encrypted_access_token FROM smart_solar_energy_connections
		WHERE subject = $1 AND energy_site_id = $2 AND state_hash IS NULL AND expires_at > $3`,
		subject, siteID, validUntil).Scan(&encrypted)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("find energy access grant: %w", err)
	}
	return r.decryptToken(encrypted)
}

func (r *SolarEnergyConnectionRepository) ClaimSolarEnergyRefresh(ctx context.Context, subject string,
	siteID int64, now, retryAfter time.Time,
) (int64, string, error) {
	if r.enc == nil {
		return 0, "", port.ErrNotFound
	}
	var id int64
	var encrypted string
	err := r.db.Pool.QueryRow(ctx, `
		UPDATE smart_solar_energy_connections SET refresh_after = $4
		WHERE subject = $1 AND energy_site_id = $2 AND state_hash IS NULL
		  AND expires_at <= $3 AND refresh_after <= $3
		RETURNING id, encrypted_refresh_token`, subject, siteID, now, retryAfter).Scan(&id, &encrypted)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", port.ErrClaimLost
	}
	if err != nil {
		return 0, "", fmt.Errorf("claim energy token refresh: %w", err)
	}
	token, err := r.decryptToken(encrypted)
	return id, token, err
}

func (r *SolarEnergyConnectionRepository) CompleteSolarEnergyRefresh(ctx context.Context, connectionID int64,
	retryAfter time.Time, tokens port.SolarEnergyTokens,
) error {
	access, refresh, err := r.encryptTokens(tokens)
	if err != nil {
		return err
	}
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE smart_solar_energy_connections SET encrypted_access_token = $3, encrypted_refresh_token = $4, expires_at = $5
		WHERE id = $1 AND refresh_after = $2 AND state_hash IS NULL`,
		connectionID, retryAfter, access, refresh, tokens.ExpiresAt)
	if err != nil {
		return fmt.Errorf("complete energy token refresh: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return port.ErrClaimLost
	}
	return nil
}

func (r *SolarEnergyConnectionRepository) PruneEnergyAuthorizations(ctx context.Context, now time.Time) error {
	_, err := r.db.Pool.Exec(ctx, `
		WITH expired AS (
		  SELECT id FROM smart_solar_energy_connections
		  WHERE state_hash IS NOT NULL AND expires_at <= $1 ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
		)
		DELETE FROM smart_solar_energy_connections USING expired WHERE smart_solar_energy_connections.id = expired.id`, now)
	if err != nil {
		return fmt.Errorf("prune expired energy authorizations: %w", err)
	}
	return nil
}

func (r *SolarEnergyConnectionRepository) encryptTokens(tokens port.SolarEnergyTokens) (string, string, error) {
	if r.enc == nil || tokens.AccessToken == "" || tokens.RefreshToken == "" {
		return "", "", port.ErrNotFound
	}
	access, err := r.enc.Encrypt(tokens.AccessToken)
	if err != nil {
		return "", "", fmt.Errorf("encrypt energy access grant: %w", err)
	}
	refresh, err := r.enc.Encrypt(tokens.RefreshToken)
	if err != nil {
		return "", "", fmt.Errorf("encrypt energy refresh grant: %w", err)
	}
	return access, refresh, nil
}

func (r *SolarEnergyConnectionRepository) decryptToken(encrypted string) (string, error) {
	token, err := r.enc.Decrypt(encrypted)
	if err != nil {
		return "", errors.New("could not decrypt energy grant")
	}
	return token, nil
}
