// Stores per-subject TOTP secrets (encrypted) + hashed backup codes.
// The two tables (user_totp_enrollments + user_totp_credentials) split
// pending enrollments from active credentials so a user that walks away
// halfway through scanning the QR cannot accidentally lock themselves
// out of step-up because the TTL on the pending row prunes itself.
//
// Subject identity comes from the ForwardAuth header value — see
// `internal/api/totp_handler.go` for the derivation. This file is
// strictly responsible for storage; subject validation lives upstream.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TOTPEnrollmentRow is the in-memory projection of a row in
// user_totp_enrollments. The encrypted secret is returned raw — it's
// the handler's job to decrypt only when actually needed (verify,
// promote-to-active) so a curious admin endpoint can list enrollments
// without ever materialising a usable secret.
type TOTPEnrollmentRow struct {
	Subject           string
	SecretEncrypted   []byte
	BackupCodesHashed []string
	StartedAt         time.Time
	ExpiresAt         time.Time
}

// TOTPCredentialRow is the in-memory projection of an active TOTP
// credential. failed_attempts + last_failed_at drive the per-subject
// rate limiter in the handler — the handler can choose to reset on a
// successful verify (see `MarkUsed`) or on backup-code rotation.
type TOTPCredentialRow struct {
	Subject           string
	SecretEncrypted   []byte
	BackupCodesHashed []string
	ActivatedAt       time.Time
	LastUsedAt        *time.Time
	FailedAttempts    int
	LastFailedAt      *time.Time
}

// ErrTOTPNotFound is returned by the lookup methods when no row matches
// the supplied subject. Callers map this to HTTP 404 (or to "not
// enrolled" status pills in the UI).
var ErrTOTPNotFound = errors.New("totp: not found")

// TOTPRepo is the data access layer for TOTP enrollment + credentials.
// All methods are safe for concurrent use — they go through the pool's
// connection acquisition or through a single explicit transaction.
type TOTPRepo struct {
	db *database.DB
}

// NewTOTPRepo wires a TOTPRepo to a database pool. The encryptor is NOT
// held here because we want repository tests to exercise the byte
// transport independently of the cipher; the api/totp_handler owns the
// Encryptor and feeds already-sealed bytes to the repo.
func NewTOTPRepo(db *database.DB) *TOTPRepo {
	return &TOTPRepo{db: db}
}

// BeginEnrollment upserts a pending enrollment row for subject. Any
// previous pending row is replaced (UPSERT) so a user that re-clicks
// "enroll" gets a fresh secret + fresh codes + fresh 15-minute TTL.
//
// `secretEncrypted` MUST already be encrypted by the caller using the
// crypto.Encryptor. backupHashes are SHA-256 hex digests of the
// printable codes.
func (r *TOTPRepo) BeginEnrollment(ctx context.Context, subject string, secretEncrypted []byte, backupHashes []string) error {
	if subject == "" {
		return errors.New("totp: subject required")
	}
	if len(secretEncrypted) == 0 {
		return errors.New("totp: encrypted secret required")
	}
	codes, err := encodeBackupHashes(backupHashes)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO user_totp_enrollments (subject, secret_encrypted, backup_codes_hashed, started_at, expires_at)
		VALUES ($1, $2, $3, now(), now() + interval '15 minutes')
		ON CONFLICT (subject) DO UPDATE SET
			secret_encrypted = EXCLUDED.secret_encrypted,
			backup_codes_hashed = EXCLUDED.backup_codes_hashed,
			started_at = now(),
			expires_at = now() + interval '15 minutes'`
	if _, err := r.db.Pool.Exec(ctx, q, subject, secretEncrypted, codes); err != nil {
		return fmt.Errorf("totp: begin enrollment: %w", err)
	}
	return nil
}

// GetEnrollment returns the pending row for subject, or ErrTOTPNotFound
// if there is none. Expired rows are still returned — the handler is
// responsible for the freshness check so the error message can
// distinguish "you never started enrolling" from "your QR expired".
func (r *TOTPRepo) GetEnrollment(ctx context.Context, subject string) (*TOTPEnrollmentRow, error) {
	const q = `
		SELECT subject, secret_encrypted, backup_codes_hashed, started_at, expires_at
		FROM user_totp_enrollments
		WHERE subject = $1`
	var row TOTPEnrollmentRow
	var hashes []byte
	err := r.db.Pool.QueryRow(ctx, q, subject).Scan(
		&row.Subject, &row.SecretEncrypted, &hashes, &row.StartedAt, &row.ExpiresAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTOTPNotFound
		}
		return nil, fmt.Errorf("totp: get enrollment: %w", err)
	}
	if row.BackupCodesHashed, err = decodeBackupHashes(hashes); err != nil {
		return nil, err
	}
	return &row, nil
}

// DeleteEnrollment drops any pending row for subject. Used by the
// pruning sweep (PruneExpiredEnrollments) and as a safety cleanup
// inside ActivateEnrollment after a successful promotion.
func (r *TOTPRepo) DeleteEnrollment(ctx context.Context, subject string) error {
	const q = `DELETE FROM user_totp_enrollments WHERE subject = $1`
	if _, err := r.db.Pool.Exec(ctx, q, subject); err != nil {
		return fmt.Errorf("totp: delete enrollment: %w", err)
	}
	return nil
}

// ActivateEnrollment atomically promotes a pending enrollment to an
// active credential. The pending row is consumed. Returns
// ErrTOTPNotFound if there's no pending row, or wraps
// pgx.ErrNoRows-equivalent if the row has expired.
//
// We do this in a single transaction so a crash mid-promotion can never
// leave a user with both a pending AND an active row (the unique PK on
// user_totp_credentials would otherwise violate a re-enrollment).
func (r *TOTPRepo) ActivateEnrollment(ctx context.Context, subject string) (*TOTPCredentialRow, error) {
	if subject == "" {
		return nil, errors.New("totp: subject required")
	}
	var out TOTPCredentialRow
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		// Lock the pending row so two parallel verifies can't both
		// promote — second one will see ErrTOTPNotFound after the first
		// commits.
		const selectQ = `
			SELECT secret_encrypted, backup_codes_hashed, started_at, expires_at
			FROM user_totp_enrollments
			WHERE subject = $1
			FOR UPDATE`
		var encSecret []byte
		var codes []byte
		var startedAt, expiresAt time.Time
		if err := tx.QueryRow(ctx, selectQ, subject).Scan(&encSecret, &codes, &startedAt, &expiresAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrTOTPNotFound
			}
			return fmt.Errorf("totp: lock enrollment: %w", err)
		}

		// Insert into credentials (replacing any pre-existing active
		// credential for the same subject — this matters for the
		// re-enrollment path where a user that lost their phone walks
		// through enroll → verify again).
		const upsertQ = `
			INSERT INTO user_totp_credentials
				(subject, secret_encrypted, backup_codes_hashed, activated_at, last_used_at, failed_attempts, last_failed_at)
			VALUES
				($1, $2, $3, now(), NULL, 0, NULL)
			ON CONFLICT (subject) DO UPDATE SET
				secret_encrypted = EXCLUDED.secret_encrypted,
				backup_codes_hashed = EXCLUDED.backup_codes_hashed,
				activated_at = now(),
				last_used_at = NULL,
				failed_attempts = 0,
				last_failed_at = NULL
			RETURNING subject, secret_encrypted, backup_codes_hashed,
			          activated_at, last_used_at, failed_attempts, last_failed_at`
		var hashesJSON []byte
		if err := tx.QueryRow(ctx, upsertQ, subject, encSecret, codes).Scan(
			&out.Subject, &out.SecretEncrypted, &hashesJSON,
			&out.ActivatedAt, &out.LastUsedAt, &out.FailedAttempts, &out.LastFailedAt,
		); err != nil {
			return fmt.Errorf("totp: upsert credential: %w", err)
		}
		hashes, err := decodeBackupHashes(hashesJSON)
		if err != nil {
			return err
		}
		out.BackupCodesHashed = hashes

		// Drop the pending row — same transaction so the consumer can
		// never accidentally re-promote the same enrollment.
		const deleteQ = `DELETE FROM user_totp_enrollments WHERE subject = $1`
		if _, err := tx.Exec(ctx, deleteQ, subject); err != nil {
			return fmt.Errorf("totp: clean enrollment: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// GetCredential returns the active credential for subject. Returns
// ErrTOTPNotFound if no active credential exists.
func (r *TOTPRepo) GetCredential(ctx context.Context, subject string) (*TOTPCredentialRow, error) {
	const q = `
		SELECT subject, secret_encrypted, backup_codes_hashed,
		       activated_at, last_used_at, failed_attempts, last_failed_at
		FROM user_totp_credentials
		WHERE subject = $1`
	var row TOTPCredentialRow
	var hashes []byte
	err := r.db.Pool.QueryRow(ctx, q, subject).Scan(
		&row.Subject, &row.SecretEncrypted, &hashes,
		&row.ActivatedAt, &row.LastUsedAt, &row.FailedAttempts, &row.LastFailedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTOTPNotFound
		}
		return nil, fmt.Errorf("totp: get credential: %w", err)
	}
	if row.BackupCodesHashed, err = decodeBackupHashes(hashes); err != nil {
		return nil, err
	}
	return &row, nil
}

// Revoke removes BOTH the active credential and any pending enrollment
// for subject. Idempotent — returns nil even when nothing matched, so
// the API endpoint can safely return 204 without an exists-first round
// trip.
func (r *TOTPRepo) Revoke(ctx context.Context, subject string) error {
	if subject == "" {
		return errors.New("totp: subject required")
	}
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM user_totp_credentials WHERE subject = $1`, subject); err != nil {
			return fmt.Errorf("totp: revoke credential: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM user_totp_enrollments WHERE subject = $1`, subject); err != nil {
			return fmt.Errorf("totp: revoke enrollment: %w", err)
		}
		return nil
	})
}

// RotateBackupCodes overwrites the active credential's backup codes
// with a fresh hashed list. Returns ErrTOTPNotFound if there's no
// active credential to rotate against.
func (r *TOTPRepo) RotateBackupCodes(ctx context.Context, subject string, hashes []string) error {
	if subject == "" {
		return errors.New("totp: subject required")
	}
	codes, err := encodeBackupHashes(hashes)
	if err != nil {
		return err
	}
	const q = `
		UPDATE user_totp_credentials
		SET backup_codes_hashed = $2
		WHERE subject = $1`
	tag, err := r.db.Pool.Exec(ctx, q, subject, codes)
	if err != nil {
		return fmt.Errorf("totp: rotate backup codes: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrTOTPNotFound
	}
	return nil
}

// MarkUsed records a successful verify by stamping last_used_at and
// resetting the failed_attempts counter. Idempotent — safe to call
// even after the row has been revoked (in which case it's a no-op).
func (r *TOTPRepo) MarkUsed(ctx context.Context, subject string) error {
	if subject == "" {
		return errors.New("totp: subject required")
	}
	const q = `
		UPDATE user_totp_credentials
		SET last_used_at = now(),
		    failed_attempts = 0,
		    last_failed_at = NULL
		WHERE subject = $1`
	if _, err := r.db.Pool.Exec(ctx, q, subject); err != nil {
		return fmt.Errorf("totp: mark used: %w", err)
	}
	return nil
}

// MarkFailure increments failed_attempts and stamps last_failed_at.
// Returns the new failed_attempts value so the handler can compare
// against the rate-limit threshold without a follow-up read. Returns
// ErrTOTPNotFound if no active credential exists.
func (r *TOTPRepo) MarkFailure(ctx context.Context, subject string) (int, error) {
	if subject == "" {
		return 0, errors.New("totp: subject required")
	}
	const q = `
		UPDATE user_totp_credentials
		SET failed_attempts = failed_attempts + 1,
		    last_failed_at = now()
		WHERE subject = $1
		RETURNING failed_attempts`
	var n int
	if err := r.db.Pool.QueryRow(ctx, q, subject).Scan(&n); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrTOTPNotFound
		}
		return 0, fmt.Errorf("totp: mark failure: %w", err)
	}
	return n, nil
}

// ConsumeBackupCode atomically removes hashedCode from the credential's
// backup_codes_hashed array and returns whether a match was found.
// Wraps the read+write in a transaction with FOR UPDATE so two parallel
// requests presenting the same backup code cannot both succeed.
//
// Returns (false, nil) when no match — the handler maps this to a
// generic "code rejected" 401 to avoid revealing whether the wrong code
// matched a known-valid digit form.
func (r *TOTPRepo) ConsumeBackupCode(ctx context.Context, subject, hashedCode string) (bool, error) {
	if subject == "" {
		return false, errors.New("totp: subject required")
	}
	if hashedCode == "" {
		return false, errors.New("totp: hashed code required")
	}
	consumed := false
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		const selectQ = `
			SELECT backup_codes_hashed FROM user_totp_credentials
			WHERE subject = $1 FOR UPDATE`
		var hashesJSON []byte
		if err := tx.QueryRow(ctx, selectQ, subject).Scan(&hashesJSON); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrTOTPNotFound
			}
			return fmt.Errorf("totp: lock credential for backup-code consume: %w", err)
		}
		current, err := decodeBackupHashes(hashesJSON)
		if err != nil {
			return err
		}
		next := make([]string, 0, len(current))
		for _, h := range current {
			if !consumed && h == hashedCode {
				consumed = true
				continue
			}
			next = append(next, h)
		}
		if !consumed {
			return nil
		}
		nextJSON, err := encodeBackupHashes(next)
		if err != nil {
			return err
		}
		const updateQ = `
			UPDATE user_totp_credentials
			SET backup_codes_hashed = $2,
			    last_used_at = now(),
			    failed_attempts = 0,
			    last_failed_at = NULL
			WHERE subject = $1`
		if _, err := tx.Exec(ctx, updateQ, subject, nextJSON); err != nil {
			return fmt.Errorf("totp: persist backup-code consume: %w", err)
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	return consumed, nil
}

// PruneExpiredEnrollments deletes pending enrollment rows whose
// expires_at has passed. Returns the number of rows removed for
// observability. Safe to call from a periodic job.
func (r *TOTPRepo) PruneExpiredEnrollments(ctx context.Context) (int64, error) {
	const q = `DELETE FROM user_totp_enrollments WHERE expires_at < now()`
	tag, err := r.db.Pool.Exec(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("totp: prune expired enrollments: %w", err)
	}
	return tag.RowsAffected(), nil
}

// encodeBackupHashes / decodeBackupHashes wrap JSON-array marshalling
// for the backup_codes_hashed JSONB column. Centralised so a future
// switch to e.g. PostgreSQL TEXT[] only changes one place.
func encodeBackupHashes(hashes []string) ([]byte, error) {
	if hashes == nil {
		hashes = []string{}
	}
	b, err := json.Marshal(hashes)
	if err != nil {
		return nil, fmt.Errorf("totp: encode backup hashes: %w", err)
	}
	return b, nil
}

func decodeBackupHashes(raw []byte) ([]string, error) {
	if len(raw) == 0 {
		return []string{}, nil
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("totp: decode backup hashes: %w", err)
	}
	if out == nil {
		out = []string{}
	}
	return out, nil
}
