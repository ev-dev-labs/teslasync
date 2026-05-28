package quiethours

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Phase-46 / Prompt 19 — repository for notification_quiet_hours.
//
// All inputs are validated before they reach Postgres so the API handler
// can map sentinel errors to the right HTTP status without string-matching.

// QuietHoursRepo provides per-user CRUD for notification_quiet_hours.
type QuietHoursRepo struct {
	db *database.DB
}

// NewQuietHoursRepo returns a repo bound to the supplied DB.
func NewQuietHoursRepo(db *database.DB) *QuietHoursRepo {
	return &QuietHoursRepo{db: db}
}

// Sentinel errors raised by validation and lookup misses. Handlers map
// these to 4xx responses; anything else is treated as a 500.
var (
	ErrQuietHoursNotFound        = errors.New("notification_quiet_hours: not found")
	ErrQuietHoursInvalidTime     = errors.New("notification_quiet_hours: start_local/end_local must be HH:MM (24h)")
	ErrQuietHoursEqualTime       = errors.New("notification_quiet_hours: start_local must differ from end_local")
	ErrQuietHoursInvalidTimezone = errors.New("notification_quiet_hours: timezone must be a valid IANA name")
	ErrQuietHoursInvalidWeekdays = errors.New("notification_quiet_hours: weekdays must be 0..127")
	ErrQuietHoursInvalidSeverity = errors.New("notification_quiet_hours: bypass_severities allowed values are info|warn|critical")
)

// AllowedQuietHoursSeverities is the canonical, lower-case set of
// severity strings accepted in BypassSeverities. The dispatcher uses
// the same strings to compare the inbound notification severity.
var AllowedQuietHoursSeverities = []string{"info", "warn", "critical"}

// Insert validates the payload and inserts a new row scoped to the
// supplied user_id. Defaults: enabled=true, weekdays=127,
// bypass_severities={"critical"}. Returns the persisted row.
func (r *QuietHoursRepo) Insert(ctx context.Context, userID string, in database.QuietHoursInput) (*models.QuietHoursWindow, error) {
	row := &models.QuietHoursWindow{
		UserID:           userID,
		Enabled:          true,
		Weekdays:         models.QuietHoursWeekdayAll,
		BypassSeverities: []string{"critical"},
	}
	if in.Enabled != nil {
		row.Enabled = *in.Enabled
	}
	if in.StartLocal != nil {
		row.StartLocal = *in.StartLocal
	}
	if in.EndLocal != nil {
		row.EndLocal = *in.EndLocal
	}
	if in.Timezone != nil {
		row.Timezone = *in.Timezone
	}
	if in.Weekdays != nil {
		row.Weekdays = *in.Weekdays
	}
	if in.BypassSeverities != nil {
		row.BypassSeverities = *in.BypassSeverities
	}
	if err := validateQuietHours(row); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	const q = `
		INSERT INTO notification_quiet_hours
			(user_id, enabled, start_local, end_local, timezone, weekdays, bypass_severities, created_at, updated_at)
		VALUES ($1, $2, $3::time, $4::time, $5, $6, $7, $8, $8)
		RETURNING id, created_at, updated_at`
	if err := r.db.Pool.QueryRow(ctx, q,
		row.UserID, row.Enabled, row.StartLocal, row.EndLocal,
		row.Timezone, row.Weekdays, row.BypassSeverities, now,
	).Scan(&row.ID, &row.CreatedAt, &row.UpdatedAt); err != nil {
		return nil, fmt.Errorf("notification_quiet_hours insert: %w", err)
	}
	return row, nil
}

// Get returns a single row by id, scoped to the supplied user_id so a
// user can only fetch their own windows. Returns ErrQuietHoursNotFound
// when no row matches.
func (r *QuietHoursRepo) Get(ctx context.Context, userID string, id int64) (*models.QuietHoursWindow, error) {
	const q = `
		SELECT id, user_id, enabled, start_local::text, end_local::text,
		       timezone, weekdays, bypass_severities, created_at, updated_at
		FROM notification_quiet_hours
		WHERE id = $1 AND user_id = $2`
	row := &models.QuietHoursWindow{}
	err := r.db.Pool.QueryRow(ctx, q, id, userID).Scan(
		&row.ID, &row.UserID, &row.Enabled, &row.StartLocal, &row.EndLocal,
		&row.Timezone, &row.Weekdays, &row.BypassSeverities,
		&row.CreatedAt, &row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQuietHoursNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("notification_quiet_hours get: %w", err)
	}
	row.StartLocal = trimTimeText(row.StartLocal)
	row.EndLocal = trimTimeText(row.EndLocal)
	return row, nil
}

// ListByUser returns every window owned by the supplied user, ordered
// by start_local ASC for deterministic UI rendering.
func (r *QuietHoursRepo) ListByUser(ctx context.Context, userID string) ([]*models.QuietHoursWindow, error) {
	const q = `
		SELECT id, user_id, enabled, start_local::text, end_local::text,
		       timezone, weekdays, bypass_severities, created_at, updated_at
		FROM notification_quiet_hours
		WHERE user_id = $1
		ORDER BY start_local ASC, id ASC`
	rows, err := r.db.Pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("notification_quiet_hours list: %w", err)
	}
	defer rows.Close()
	return scanQuietHoursRows(rows)
}

// ListEnabled returns every enabled window across all users. Used by
// the dispatcher to decide whether to defer a notification, and by the
// replay loop to re-evaluate deferred rows.
func (r *QuietHoursRepo) ListEnabled(ctx context.Context) ([]*models.QuietHoursWindow, error) {
	const q = `
		SELECT id, user_id, enabled, start_local::text, end_local::text,
		       timezone, weekdays, bypass_severities, created_at, updated_at
		FROM notification_quiet_hours
		WHERE enabled = true
		ORDER BY id ASC`
	rows, err := r.db.Pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("notification_quiet_hours list_enabled: %w", err)
	}
	defer rows.Close()
	return scanQuietHoursRows(rows)
}

// Update applies a partial PATCH to a single row scoped to user_id.
// Returns the updated row, or ErrQuietHoursNotFound when no row matches.
func (r *QuietHoursRepo) Update(ctx context.Context, userID string, id int64, in database.QuietHoursInput) (*models.QuietHoursWindow, error) {
	existing, err := r.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if in.Enabled != nil {
		existing.Enabled = *in.Enabled
	}
	if in.StartLocal != nil {
		existing.StartLocal = *in.StartLocal
	}
	if in.EndLocal != nil {
		existing.EndLocal = *in.EndLocal
	}
	if in.Timezone != nil {
		existing.Timezone = *in.Timezone
	}
	if in.Weekdays != nil {
		existing.Weekdays = *in.Weekdays
	}
	if in.BypassSeverities != nil {
		existing.BypassSeverities = *in.BypassSeverities
	}
	if err := validateQuietHours(existing); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	const q = `
		UPDATE notification_quiet_hours
		SET enabled = $1, start_local = $2::time, end_local = $3::time, timezone = $4,
		    weekdays = $5, bypass_severities = $6, updated_at = $7
		WHERE id = $8 AND user_id = $9
		RETURNING updated_at`
	err = r.db.Pool.QueryRow(ctx, q,
		existing.Enabled, existing.StartLocal, existing.EndLocal,
		existing.Timezone, existing.Weekdays, existing.BypassSeverities,
		now, id, userID,
	).Scan(&existing.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQuietHoursNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("notification_quiet_hours update: %w", err)
	}
	return existing, nil
}

// Delete removes a single row scoped to user_id. Returns
// ErrQuietHoursNotFound when no matching row exists, so the handler
// can return a 404 without leaking the existence of other users' rows.
func (r *QuietHoursRepo) Delete(ctx context.Context, userID string, id int64) error {
	tag, err := r.db.Pool.Exec(ctx,
		`DELETE FROM notification_quiet_hours WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil {
		return fmt.Errorf("notification_quiet_hours delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrQuietHoursNotFound
	}
	return nil
}

// scanQuietHoursRows reads the canonical SELECT shape (see ListByUser /
// ListEnabled) into a slice. The HH:MM trim happens once here so all
// callers see the same "HH:MM" format the API contract documents.
func scanQuietHoursRows(rows pgx.Rows) ([]*models.QuietHoursWindow, error) {
	out := make([]*models.QuietHoursWindow, 0)
	for rows.Next() {
		row := &models.QuietHoursWindow{}
		if err := rows.Scan(
			&row.ID, &row.UserID, &row.Enabled, &row.StartLocal, &row.EndLocal,
			&row.Timezone, &row.Weekdays, &row.BypassSeverities,
			&row.CreatedAt, &row.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("notification_quiet_hours scan: %w", err)
		}
		row.StartLocal = trimTimeText(row.StartLocal)
		row.EndLocal = trimTimeText(row.EndLocal)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("notification_quiet_hours iter: %w", err)
	}
	return out, nil
}

// trimTimeText collapses the Postgres `time` text representation
// "HH:MM:SS" (or "HH:MM:SS.ffffff") down to "HH:MM" so the API
// returns the same shape the UI sends in.
func trimTimeText(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 5 && s[2] == ':' {
		return s[:5]
	}
	return s
}

// validateQuietHours runs every server-side guard against a populated
// row. Used by both Insert and Update so the rules stay symmetric.
func validateQuietHours(w *models.QuietHoursWindow) error {
	if !validHHMM(w.StartLocal) || !validHHMM(w.EndLocal) {
		return ErrQuietHoursInvalidTime
	}
	if w.StartLocal == w.EndLocal {
		return ErrQuietHoursEqualTime
	}
	if strings.TrimSpace(w.Timezone) == "" {
		return ErrQuietHoursInvalidTimezone
	}
	if _, err := time.LoadLocation(w.Timezone); err != nil {
		return ErrQuietHoursInvalidTimezone
	}
	if w.Weekdays < 0 || w.Weekdays > 127 {
		return ErrQuietHoursInvalidWeekdays
	}
	for i, sev := range w.BypassSeverities {
		w.BypassSeverities[i] = strings.ToLower(strings.TrimSpace(sev))
		if !isAllowedSeverity(w.BypassSeverities[i]) {
			return ErrQuietHoursInvalidSeverity
		}
	}
	return nil
}

func validHHMM(s string) bool {
	if len(s) != 5 || s[2] != ':' {
		return false
	}
	h := (int(s[0]-'0') * 10) + int(s[1]-'0')
	m := (int(s[3]-'0') * 10) + int(s[4]-'0')
	if s[0] < '0' || s[0] > '9' || s[1] < '0' || s[1] > '9' ||
		s[3] < '0' || s[3] > '9' || s[4] < '0' || s[4] > '9' {
		return false
	}
	return h >= 0 && h <= 23 && m >= 0 && m <= 59
}

func isAllowedSeverity(s string) bool {
	for _, allowed := range AllowedQuietHoursSeverities {
		if s == allowed {
			return true
		}
	}
	return false
}
