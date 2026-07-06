// Operator-managed status incidents.
//
// Backs /api/v1/status/incidents (the System Status page's Active
// incidents block + post-mortem timeline). Self-hosted operator's
// personal log; no orgs / teams / subscribers.
//
// Storage: the parent timeline lives in `status_incidents` with the
// individual updates kept inline in a `updates` JSONB array. We chose
// the single-table design over a child table because incidents have
// few updates each and the only access pattern is "render the whole
// timeline" — the join would be pure overhead on every list call.

package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Incident severity values. Match the CHECK constraint in 000198.
const (
	IncidentSeverityMinor    = "minor"
	IncidentSeverityMajor    = "major"
	IncidentSeverityCritical = "critical"
)

// Incident lifecycle statuses. Match the CHECK constraint in 000198.
const (
	IncidentStatusInvestigating = "investigating"
	IncidentStatusIdentified    = "identified"
	IncidentStatusMonitoring    = "monitoring"
	IncidentStatusResolved      = "resolved"
)

// Incident origin (manual vs auto-detected by health monitor).
const (
	IncidentSourceManual = "manual"
	IncidentSourceAuto   = "auto"
)

// IncidentTitleMinLen / Max bound the title and message lengths.
// Consistent with the SPA form constraints in IncidentForm.tsx.
const (
	IncidentTitleMinLen       = 3
	IncidentTitleMaxLen       = 200
	IncidentMessageMaxLen     = 4000
	IncidentDescriptionMaxLen = 4000
)

// Sentinel errors so handlers can map repo failures to HTTP statuses.
var (
	ErrIncidentInvalidSeverity  = errors.New("status_incidents: invalid severity")
	ErrIncidentInvalidStatus    = errors.New("status_incidents: invalid status")
	ErrIncidentInvalidSource    = errors.New("status_incidents: invalid source")
	ErrIncidentTitleLength      = errors.New("status_incidents: title length out of bounds")
	ErrIncidentMessageLength    = errors.New("status_incidents: message length out of bounds")
	ErrIncidentNotFound         = errors.New("status_incidents: not found")
	ErrIncidentRepoUnconfigured = errors.New("status_incidents: repo not configured")
)

// Incident is the canonical row shape. JSON tags align with the
// /api/v1/status/incidents response contract.
type Incident struct {
	ID                 int64            `json:"id"`
	Title              string           `json:"title"`
	Description        string           `json:"description"`
	Severity           string           `json:"severity"`
	Status             string           `json:"status"`
	Source             string           `json:"source"`
	AffectedComponents []string         `json:"affected_components"`
	Updates            []IncidentUpdate `json:"updates"`
	StartedAt          time.Time        `json:"started_at"`
	ResolvedAt         *time.Time       `json:"resolved_at,omitempty"`
	CreatedAt          time.Time        `json:"created_at"`
	UpdatedAt          time.Time        `json:"updated_at"`
	CreatedBy          string           `json:"created_by,omitempty"`
	AutoDedupeKey      string           `json:"-"`
}

// IncidentUpdate is one timeline entry. Append-only — the operator
// can add, but never delete (auditability).
type IncidentUpdate struct {
	At      time.Time `json:"at"`
	Status  string    `json:"status"`
	Message string    `json:"message"`
	Author  string    `json:"author,omitempty"`
}

// IncidentInsert is the create payload; Severity / Status / Source
// default to minor / investigating / manual when blank.
type IncidentInsert struct {
	Title              string
	Description        string
	Severity           string
	Status             string
	Source             string
	AffectedComponents []string
	StartedAt          time.Time
	CreatedBy          string
	AutoDedupeKey      string
	InitialMessage     string
}

// IncidentPatch is the operator update payload. All fields are
// optional — only set fields are written. To resolve, set Resolved=true.
type IncidentPatch struct {
	Title              *string
	Description        *string
	Severity           *string
	Status             *string
	AffectedComponents *[]string
	Resolved           *bool
}

// IncidentRepo wires the queries to the shared pool.
type IncidentRepo struct {
	exec database.DBTX
}

// NewIncidentRepo wires a repository against the shared pool. A nil db
// (or a db with a nil pool) yields a repo whose methods return
// ErrIncidentRepoUnconfigured rather than dereferencing a nil pool.
func NewIncidentRepo(db *database.DB) *IncidentRepo {
	var exec database.DBTX
	if db != nil && db.Pool != nil {
		exec = db.Pool
	}
	return &IncidentRepo{exec: exec}
}

// ready reports whether the repo has a usable execution seam. It is the
// single nil-guard used by every method so a mis-wired repo returns a
// clean error instead of panicking on a nil pool.
func (r *IncidentRepo) ready() error {
	if r == nil || r.exec == nil {
		return ErrIncidentRepoUnconfigured
	}
	return nil
}

// capText truncates s to at most maxBytes bytes without splitting a
// multi-byte UTF-8 rune. A naive s[:maxBytes] slice can cut a rune in
// half, producing invalid UTF-8 that PostgreSQL rejects on write; this
// backs off to the previous rune boundary. maxBytes <= 0 or an s that
// already fits is returned unchanged.
func capText(s string, maxBytes int) string {
	if maxBytes <= 0 || len(s) <= maxBytes {
		return s
	}
	truncated := s[:maxBytes]
	for len(truncated) > 0 && !utf8.ValidString(truncated) {
		truncated = truncated[:len(truncated)-1]
	}
	return truncated
}

// ValidateIncidentSeverity normalises and validates a severity string.
func ValidateIncidentSeverity(s string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(s))
	switch v {
	case IncidentSeverityMinor, IncidentSeverityMajor, IncidentSeverityCritical:
		return v, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrIncidentInvalidSeverity, s)
	}
}

// ValidateIncidentStatus normalises and validates a lifecycle status.
func ValidateIncidentStatus(s string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(s))
	switch v {
	case IncidentStatusInvestigating, IncidentStatusIdentified,
		IncidentStatusMonitoring, IncidentStatusResolved:
		return v, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrIncidentInvalidStatus, s)
	}
}

// ValidateIncidentSource normalises and validates a source value.
func ValidateIncidentSource(s string) (string, error) {
	v := strings.ToLower(strings.TrimSpace(s))
	switch v {
	case IncidentSourceManual, IncidentSourceAuto:
		return v, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrIncidentInvalidSource, s)
	}
}

// validateTitle enforces the title length bounds.
func validateIncidentTitle(t string) error {
	t = strings.TrimSpace(t)
	if len(t) < IncidentTitleMinLen || len(t) > IncidentTitleMaxLen {
		return ErrIncidentTitleLength
	}
	return nil
}

// Insert creates a new incident row plus an opening timeline entry
// (`InitialMessage`, defaulting to "Incident opened.") so the timeline
// is never empty.
func (r *IncidentRepo) Insert(ctx context.Context, in IncidentInsert) (Incident, error) {
	if err := r.ready(); err != nil {
		return Incident{}, err
	}
	title := strings.TrimSpace(in.Title)
	if err := validateIncidentTitle(title); err != nil {
		return Incident{}, err
	}
	severity := in.Severity
	if severity == "" {
		severity = IncidentSeverityMinor
	}
	severity, err := ValidateIncidentSeverity(severity)
	if err != nil {
		return Incident{}, err
	}
	status := in.Status
	if status == "" {
		status = IncidentStatusInvestigating
	}
	status, err = ValidateIncidentStatus(status)
	if err != nil {
		return Incident{}, err
	}
	source := in.Source
	if source == "" {
		source = IncidentSourceManual
	}
	source, err = ValidateIncidentSource(source)
	if err != nil {
		return Incident{}, err
	}
	if len(in.Description) > IncidentDescriptionMaxLen {
		in.Description = capText(in.Description, IncidentDescriptionMaxLen)
	}
	startedAt := in.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now().UTC()
	}
	if in.AffectedComponents == nil {
		in.AffectedComponents = []string{}
	}
	initialMsg := strings.TrimSpace(in.InitialMessage)
	if initialMsg == "" {
		initialMsg = "Incident opened."
	}
	if len(initialMsg) > IncidentMessageMaxLen {
		initialMsg = capText(initialMsg, IncidentMessageMaxLen)
	}
	updates := []IncidentUpdate{{
		At:      startedAt,
		Status:  status,
		Message: initialMsg,
		Author:  in.CreatedBy,
	}}
	updatesJSON, err := json.Marshal(updates)
	if err != nil {
		return Incident{}, fmt.Errorf("status_incidents: marshal updates: %w", err)
	}

	var dedupe interface{}
	if in.AutoDedupeKey != "" {
		dedupe = in.AutoDedupeKey
	}
	var createdBy interface{}
	if in.CreatedBy != "" {
		createdBy = in.CreatedBy
	}

	row := r.exec.QueryRow(ctx, `
		INSERT INTO status_incidents (
			title, description, severity, status, source,
			affected_components, updates, started_at, created_by, auto_dedupe_key
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at, updated_at`,
		title, in.Description, severity, status, source,
		in.AffectedComponents, updatesJSON, startedAt, createdBy, dedupe,
	)
	var inc Incident
	if err := row.Scan(&inc.ID, &inc.CreatedAt, &inc.UpdatedAt); err != nil {
		return Incident{}, fmt.Errorf("status_incidents: insert: %w", err)
	}
	inc.Title = title
	inc.Description = in.Description
	inc.Severity = severity
	inc.Status = status
	inc.Source = source
	inc.AffectedComponents = in.AffectedComponents
	inc.Updates = updates
	inc.StartedAt = startedAt
	inc.CreatedBy = in.CreatedBy
	inc.AutoDedupeKey = in.AutoDedupeKey
	return inc, nil
}

// Get fetches a single incident by ID. Returns ErrIncidentNotFound
// when the row doesn't exist.
func (r *IncidentRepo) Get(ctx context.Context, id int64) (Incident, error) {
	if err := r.ready(); err != nil {
		return Incident{}, err
	}
	row := r.exec.QueryRow(ctx, `
		SELECT id, title, description, severity, status, source,
		       affected_components, updates, started_at, resolved_at,
		       created_at, updated_at, COALESCE(created_by, ''),
		       COALESCE(auto_dedupe_key, '')
		  FROM status_incidents
		 WHERE id = $1`, id)
	inc, err := scanIncident(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			return Incident{}, ErrIncidentNotFound
		}
		return Incident{}, err
	}
	return inc, nil
}

// IncidentListParams scopes the list query.
type IncidentListParams struct {
	ActiveOnly bool
	Limit      int
}

// List returns incidents ordered by recency (started_at desc). When
// ActiveOnly is true, resolved_at must be NULL. Limit defaults to 50.
func (r *IncidentRepo) List(ctx context.Context, p IncidentListParams) ([]Incident, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	limit := p.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `
		SELECT id, title, description, severity, status, source,
		       affected_components, updates, started_at, resolved_at,
		       created_at, updated_at, COALESCE(created_by, ''),
		       COALESCE(auto_dedupe_key, '')
		  FROM status_incidents`
	if p.ActiveOnly {
		q += ` WHERE resolved_at IS NULL`
	}
	q += ` ORDER BY started_at DESC LIMIT $1`
	rows, err := r.exec.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("status_incidents: list: %w", err)
	}
	defer rows.Close()
	out := make([]Incident, 0, 8)
	for rows.Next() {
		inc, err := scanIncident(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, inc)
	}
	return out, rows.Err()
}

// FindByDedupeKey returns the latest unresolved incident with the
// given auto_dedupe_key, used by the auto-detector to avoid creating
// a new row every health-monitor tick.
func (r *IncidentRepo) FindByDedupeKey(ctx context.Context, key string) (Incident, error) {
	if err := r.ready(); err != nil {
		return Incident{}, err
	}
	if key == "" {
		return Incident{}, ErrIncidentNotFound
	}
	row := r.exec.QueryRow(ctx, `
		SELECT id, title, description, severity, status, source,
		       affected_components, updates, started_at, resolved_at,
		       created_at, updated_at, COALESCE(created_by, ''),
		       COALESCE(auto_dedupe_key, '')
		  FROM status_incidents
		 WHERE auto_dedupe_key = $1 AND resolved_at IS NULL
		 ORDER BY started_at DESC LIMIT 1`, key)
	inc, err := scanIncident(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			return Incident{}, ErrIncidentNotFound
		}
		return Incident{}, err
	}
	return inc, nil
}

// Patch applies a partial update. To resolve, set Resolved=true; that
// sets status to "resolved", stamps resolved_at, and appends a final
// timeline entry.
func (r *IncidentRepo) Patch(ctx context.Context, id int64, p IncidentPatch, author string) (Incident, error) {
	current, err := r.Get(ctx, id)
	if err != nil {
		return Incident{}, err
	}
	if p.Title != nil {
		t := strings.TrimSpace(*p.Title)
		if err := validateIncidentTitle(t); err != nil {
			return Incident{}, err
		}
		current.Title = t
	}
	if p.Description != nil {
		d := *p.Description
		if len(d) > IncidentDescriptionMaxLen {
			d = capText(d, IncidentDescriptionMaxLen)
		}
		current.Description = d
	}
	if p.Severity != nil {
		v, err := ValidateIncidentSeverity(*p.Severity)
		if err != nil {
			return Incident{}, err
		}
		current.Severity = v
	}
	if p.Status != nil {
		v, err := ValidateIncidentStatus(*p.Status)
		if err != nil {
			return Incident{}, err
		}
		current.Status = v
	}
	if p.AffectedComponents != nil {
		ac := *p.AffectedComponents
		if ac == nil {
			ac = []string{}
		}
		current.AffectedComponents = ac
	}
	var resolvedAt interface{}
	if p.Resolved != nil && *p.Resolved {
		now := time.Now().UTC()
		current.Status = IncidentStatusResolved
		current.ResolvedAt = &now
		resolvedAt = now
		current.Updates = append(current.Updates, IncidentUpdate{
			At: now, Status: IncidentStatusResolved,
			Message: "Incident resolved.", Author: author,
		})
	} else if current.ResolvedAt != nil {
		resolvedAt = *current.ResolvedAt
	} else {
		resolvedAt = nil
	}
	updatesJSON, err := json.Marshal(current.Updates)
	if err != nil {
		return Incident{}, fmt.Errorf("status_incidents: marshal updates: %w", err)
	}
	row := r.exec.QueryRow(ctx, `
		UPDATE status_incidents SET
			title = $2, description = $3, severity = $4, status = $5,
			affected_components = $6, updates = $7, resolved_at = $8,
			updated_at = NOW()
		 WHERE id = $1
		 RETURNING updated_at`,
		id, current.Title, current.Description, current.Severity,
		current.Status, current.AffectedComponents, updatesJSON, resolvedAt,
	)
	if err := row.Scan(&current.UpdatedAt); err != nil {
		return Incident{}, fmt.Errorf("status_incidents: patch: %w", err)
	}
	return current, nil
}

// AppendUpdate adds a timeline entry, optionally also flipping the
// lifecycle status. Returns the refreshed incident.
func (r *IncidentRepo) AppendUpdate(ctx context.Context, id int64, message, status, author string) (Incident, error) {
	current, err := r.Get(ctx, id)
	if err != nil {
		return Incident{}, err
	}
	message = strings.TrimSpace(message)
	if message == "" || len(message) > IncidentMessageMaxLen {
		return Incident{}, ErrIncidentMessageLength
	}
	if status != "" {
		v, err := ValidateIncidentStatus(status)
		if err != nil {
			return Incident{}, err
		}
		current.Status = v
	}
	now := time.Now().UTC()
	current.Updates = append(current.Updates, IncidentUpdate{
		At: now, Status: current.Status, Message: message, Author: author,
	})
	updatesJSON, err := json.Marshal(current.Updates)
	if err != nil {
		return Incident{}, fmt.Errorf("status_incidents: marshal updates: %w", err)
	}
	var resolvedAt interface{}
	if current.Status == IncidentStatusResolved && current.ResolvedAt == nil {
		current.ResolvedAt = &now
		resolvedAt = now
	} else if current.ResolvedAt != nil {
		resolvedAt = *current.ResolvedAt
	}
	row := r.exec.QueryRow(ctx, `
		UPDATE status_incidents SET
			status = $2, updates = $3, resolved_at = $4, updated_at = NOW()
		 WHERE id = $1
		 RETURNING updated_at`,
		id, current.Status, updatesJSON, resolvedAt,
	)
	if err := row.Scan(&current.UpdatedAt); err != nil {
		return Incident{}, fmt.Errorf("status_incidents: append update: %w", err)
	}
	return current, nil
}

// Delete removes an incident outright. Used only by the admin "purge"
// path; the SPA never exposes a hard-delete button (resolve instead).
func (r *IncidentRepo) Delete(ctx context.Context, id int64) error {
	if err := r.ready(); err != nil {
		return err
	}
	tag, err := r.exec.Exec(ctx, `DELETE FROM status_incidents WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("status_incidents: delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrIncidentNotFound
	}
	return nil
}

// rowScanner is the narrow surface scanIncident needs — both
// pgx.Row and pgx.Rows satisfy it.
type rowScanner interface {
	Scan(dest ...interface{}) error
}

func scanIncident(s rowScanner) (Incident, error) {
	var inc Incident
	var resolvedAt *time.Time
	var updatesRaw []byte
	if err := s.Scan(
		&inc.ID, &inc.Title, &inc.Description, &inc.Severity,
		&inc.Status, &inc.Source, &inc.AffectedComponents, &updatesRaw,
		&inc.StartedAt, &resolvedAt, &inc.CreatedAt, &inc.UpdatedAt,
		&inc.CreatedBy, &inc.AutoDedupeKey,
	); err != nil {
		return Incident{}, err
	}
	inc.ResolvedAt = resolvedAt
	if len(updatesRaw) > 0 {
		if err := json.Unmarshal(updatesRaw, &inc.Updates); err != nil {
			return Incident{}, fmt.Errorf("status_incidents: unmarshal updates: %w", err)
		}
	}
	if inc.Updates == nil {
		inc.Updates = []IncidentUpdate{}
	}
	if inc.AffectedComponents == nil {
		inc.AffectedComponents = []string{}
	}
	return inc, nil
}
