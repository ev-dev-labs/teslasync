// Package rotation tracks the age of secrets and certificates so the
// admin UI can warn an operator when something is overdue for
// rotation.
//
// Layer: platform
//
// Tracked secret kinds:
//
//   - tesla_refresh_token  — per-vehicle, derived from
//     tesla_credentials.updated_at; warn at 60d, critical at 90d.
//   - mqtt_mtls_cert       — from file mtime + cert NotAfter; warn at
//     60d before expiry, critical at 14d.
//   - database_password    — derived from an HMAC fingerprint stored
//     in secret_rotation_log on first boot; warn at 180d, critical
//     at 365d.
//   - session_jwk          — Authentik-managed; warn at 90d.
//   - app_signing_key      — internal JWT signing key for short-lived
//     download URLs; warn at 90d.
//
// We never store the secret itself. The fingerprint column is an
// HMAC-SHA256(secret, APP_SECRET_PEPPER) so the table is not useful
// for offline guessing even if leaked.
package rotation

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Kind enumerates the secret families we track. Strings are stable
// (used as DB CHECK values) — do not rename without a migration.
type Kind string

const (
	KindTeslaRefreshToken Kind = "tesla_refresh_token"
	KindMQTTMTLSCert      Kind = "mqtt_mtls_cert"
	KindDatabasePassword  Kind = "database_password"
	KindSessionJWK        Kind = "session_jwk"
	KindAppSigningKey     Kind = "app_signing_key"
	KindAuthentikSecret   Kind = "authentik_secret"
)

// Severity ranks rotation status. Stable enum for the UI.
type Severity string

const (
	SeverityOK       Severity = "ok"
	SeverityWarn     Severity = "warn"
	SeverityCritical Severity = "critical"
	SeverityUnknown  Severity = "unknown"
)

// Status is the per-secret summary returned by Tracker.Status.
type Status struct {
	Kind         Kind       `json:"kind"`
	TargetID     string     `json:"target_id,omitempty"`
	LastRotated  time.Time  `json:"last_rotated"`
	AgeDays      int        `json:"age_days"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	DaysToExpiry *int       `json:"days_to_expiry,omitempty"`
	WarnDays     int        `json:"warn_days"`
	CriticalDays int        `json:"critical_days"`
	Severity     Severity   `json:"severity"`
	Message      string     `json:"message,omitempty"`
}

// Thresholds defines the warn/critical day boundaries per Kind.
type Thresholds struct {
	WarnDays     int
	CriticalDays int
}

// DefaultThresholds returns the per-kind defaults.
func DefaultThresholds(k Kind) Thresholds {
	switch k {
	case KindTeslaRefreshToken:
		return Thresholds{WarnDays: 60, CriticalDays: 90}
	case KindMQTTMTLSCert:
		return Thresholds{WarnDays: 60, CriticalDays: 14}
	case KindDatabasePassword:
		return Thresholds{WarnDays: 180, CriticalDays: 365}
	case KindSessionJWK, KindAppSigningKey:
		return Thresholds{WarnDays: 90, CriticalDays: 180}
	case KindAuthentikSecret:
		return Thresholds{WarnDays: 180, CriticalDays: 365}
	default:
		return Thresholds{WarnDays: 90, CriticalDays: 180}
	}
}

// Tracker writes observations into secret_rotation_log and reads them
// back to compute Status.
type Tracker struct {
	pool   *pgxpool.Pool
	pepper []byte
	now    func() time.Time
}

// New constructs a Tracker. pepper MUST be the APP_SECRET_PEPPER env
// var; it is mixed into every fingerprint so leakage of
// secret_rotation_log alone does not enable offline guessing.
func New(pool *pgxpool.Pool, pepper string) *Tracker {
	if pool == nil {
		return nil
	}
	return &Tracker{pool: pool, pepper: []byte(pepper), now: time.Now}
}

// Fingerprint returns HMAC-SHA256(secret, pepper) as hex.
func (t *Tracker) Fingerprint(secret string) string {
	if t == nil {
		return ""
	}
	mac := hmac.New(sha256.New, t.pepper)
	mac.Write([]byte(secret))
	return hex.EncodeToString(mac.Sum(nil))
}

// Observe records a secret observation. If the most-recent row for
// (kind, target_id) already has the same fingerprint, no row is
// written — the secret has not rotated. Returns true when a new row
// was inserted.
func (t *Tracker) Observe(ctx context.Context, kind Kind, targetID, secret string, expiresAt *time.Time) (bool, error) {
	if t == nil {
		return false, nil
	}
	fp := t.Fingerprint(secret)
	var lastFP string
	err := t.pool.QueryRow(ctx, `
SELECT fingerprint_hmac FROM secret_rotation_log
 WHERE secret_kind = $1 AND COALESCE(target_id,'') = COALESCE($2,'')
 ORDER BY observed_at DESC LIMIT 1`, string(kind), nullableStr(targetID)).Scan(&lastFP)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, fmt.Errorf("rotation: query last fingerprint: %w", err)
	}
	if err == nil && lastFP == fp {
		return false, nil
	}
	_, err = t.pool.Exec(ctx, `
INSERT INTO secret_rotation_log (secret_kind, fingerprint_hmac, target_id, observed_at, expires_at)
VALUES ($1, $2, $3, $4, $5)`,
		string(kind), fp, nullableStr(targetID), t.now().UTC(), expiresAt)
	if err != nil {
		return false, fmt.Errorf("rotation: insert: %w", err)
	}
	return true, nil
}

// ObserveCertFile loads a PEM-encoded cert from disk, observes its
// fingerprint, and records NotAfter as the expiry. Skips silently
// when the file does not exist (mTLS optional in some deployments).
func (t *Tracker) ObserveCertFile(ctx context.Context, kind Kind, targetID, path string) error {
	if t == nil {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("rotation: read cert %s: %w", path, err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return fmt.Errorf("rotation: cert %s: no PEM block", path)
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return fmt.Errorf("rotation: parse cert %s: %w", path, err)
	}
	notAfter := cert.NotAfter
	_, err = t.Observe(ctx, kind, targetID, string(cert.Raw), &notAfter)
	return err
}

// Status returns the current rotation status for every kind/target
// pair seen in the log. Includes computed Severity.
func (t *Tracker) Status(ctx context.Context) ([]Status, error) {
	if t == nil {
		return nil, nil
	}
	rows, err := t.pool.Query(ctx, `
SELECT DISTINCT ON (secret_kind, COALESCE(target_id,''))
       secret_kind, COALESCE(target_id,''), observed_at, expires_at
  FROM secret_rotation_log
 ORDER BY secret_kind, COALESCE(target_id,''), observed_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("rotation: status query: %w", err)
	}
	defer rows.Close()
	var out []Status
	now := t.now().UTC()
	for rows.Next() {
		var (
			kind      string
			tgt       string
			observed  time.Time
			expiresAt *time.Time
		)
		if err := rows.Scan(&kind, &tgt, &observed, &expiresAt); err != nil {
			return nil, err
		}
		k := Kind(kind)
		th := DefaultThresholds(k)
		ageDays := int(now.Sub(observed).Hours() / 24)
		var daysToExpiry *int
		if expiresAt != nil {
			d := int(expiresAt.Sub(now).Hours() / 24)
			daysToExpiry = &d
		}
		s := Status{
			Kind: k, TargetID: tgt, LastRotated: observed, AgeDays: ageDays,
			ExpiresAt: expiresAt, DaysToExpiry: daysToExpiry,
			WarnDays: th.WarnDays, CriticalDays: th.CriticalDays,
		}
		s.Severity, s.Message = severityFor(k, ageDays, daysToExpiry, th)
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Severity != out[j].Severity {
			return severityRank(out[i].Severity) > severityRank(out[j].Severity)
		}
		return out[i].Kind < out[j].Kind
	})
	return out, rows.Err()
}

func severityFor(k Kind, ageDays int, daysToExpiry *int, th Thresholds) (Severity, string) {
	if k == KindMQTTMTLSCert && daysToExpiry != nil {
		switch {
		case *daysToExpiry < 0:
			return SeverityCritical, "certificate expired"
		case *daysToExpiry <= th.CriticalDays:
			return SeverityCritical, fmt.Sprintf("expires in %dd", *daysToExpiry)
		case *daysToExpiry <= th.WarnDays:
			return SeverityWarn, fmt.Sprintf("expires in %dd", *daysToExpiry)
		default:
			return SeverityOK, ""
		}
	}
	switch {
	case ageDays >= th.CriticalDays:
		return SeverityCritical, fmt.Sprintf("not rotated for %dd", ageDays)
	case ageDays >= th.WarnDays:
		return SeverityWarn, fmt.Sprintf("not rotated for %dd", ageDays)
	default:
		return SeverityOK, ""
	}
}

func severityRank(s Severity) int {
	switch s {
	case SeverityCritical:
		return 3
	case SeverityWarn:
		return 2
	case SeverityOK:
		return 1
	default:
		return 0
	}
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
