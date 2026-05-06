package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Phase-46 / Prompt 08 — user feedback / report-bug persistence.
//
// Stores rows captured by the SPA <FeedbackModal> POST /api/v1/feedback
// and surfaced through the admin GET/PATCH /api/v1/admin/feedback queue.
// All length / value validation lives here so the public ingest handler
// and the admin update handler share the exact same rules.

// User feedback categories. Constrained at the DB layer via CHECK and
// here so callers can branch / render without referring to magic
// strings.
const (
	FeedbackCategoryBug     = "bug"
	FeedbackCategoryFeature = "feature"
	FeedbackCategoryOther   = "other"
)

// User feedback statuses. Default is FeedbackStatusNew.
const (
	FeedbackStatusNew     = "new"
	FeedbackStatusTriaged = "triaged"
	FeedbackStatusClosed  = "closed"
)

// Length bounds enforced before the row hits the database. Keep these
// in sync with the zod schema in web/src/components/feedback/FeedbackModal.tsx.
const (
	FeedbackTitleMinLen     = 5
	FeedbackTitleMaxLen     = 120
	FeedbackBodyMinLen      = 20
	FeedbackBodyMaxLen      = 4000
	FeedbackUserAgentMaxLen = 500
	FeedbackPageRouteMaxLen = 200
	FeedbackAppVersionMaxLen = 64
	FeedbackUserEmailMaxLen = 200
	FeedbackConsoleTailMaxLen = 16 * 1024 // 16 KiB cap for opt-in console capture
	// FeedbackRecentErrorsMaxBytes caps the JSON byte length of the
	// recent_errors payload accepted by the public ingest endpoint.
	// Any payload larger than this is truncated to NULL by the handler
	// (we'd rather drop noisy diagnostics than reject the report).
	FeedbackRecentErrorsMaxBytes = 32 * 1024
)

// Sentinel errors so the handler can map repo failures to the right
// HTTP status without string matching.
var (
	ErrFeedbackInvalidCategory = errors.New("user_feedback: invalid category")
	ErrFeedbackInvalidStatus   = errors.New("user_feedback: invalid status")
	ErrFeedbackTitleTooShort   = errors.New("user_feedback: title too short")
	ErrFeedbackBodyTooShort    = errors.New("user_feedback: body too short")
	ErrFeedbackNotFound        = errors.New("user_feedback: not found")
)

// UserFeedback mirrors a single row in the user_feedback table.
//
// JSON tags use snake_case to match other API response shapes; the SPA's
// camelCaseKeys transform produces matching camelCase keys at runtime.
type UserFeedback struct {
	ID               int64           `json:"id"`
	CreatedAt        time.Time       `json:"created_at"`
	Category         string          `json:"category"`
	Title            string          `json:"title"`
	Body             string          `json:"body"`
	PageRoute        string          `json:"page_route,omitempty"`
	UserAgent        string          `json:"user_agent,omitempty"`
	AppVersion       string          `json:"app_version,omitempty"`
	UserEmail        string          `json:"user_email,omitempty"`
	RecentErrors     json.RawMessage `json:"recent_errors,omitempty"`
	ConsoleTail      string          `json:"console_tail,omitempty"`
	Status           string          `json:"status"`
	GitHubIssueURL   string          `json:"github_issue_url,omitempty"`
	SubmitterSubject string          `json:"submitter_subject,omitempty"`
	SubmitterIP      string          `json:"submitter_ip,omitempty"`
	TriagedAt        *time.Time      `json:"triaged_at,omitempty"`
	TriagedBy        string          `json:"triaged_by,omitempty"`
}

// FeedbackInsert is the validated input shape consumed by Insert. All
// strings are pre-trimmed; empty values become NULL columns when the
// underlying DB column is nullable.
type FeedbackInsert struct {
	Category         string
	Title            string
	Body             string
	PageRoute        string
	UserAgent        string
	AppVersion       string
	UserEmail        string
	RecentErrors     json.RawMessage
	ConsoleTail      string
	SubmitterSubject string
	SubmitterIP      string
}

// FeedbackUpdate is the partial-update shape consumed by Update. Only
// non-nil fields are written. Empty-string values for optional columns
// (GitHubIssueURL) clear the column to NULL; Status="" leaves the
// column untouched.
type FeedbackUpdate struct {
	Status         *string
	GitHubIssueURL *string
	TriagedBy      string
}

// UserFeedbackRepo persists feedback rows.
type UserFeedbackRepo struct {
	db *DB
}

// NewUserFeedbackRepo wires a repository against the shared pool.
func NewUserFeedbackRepo(db *DB) *UserFeedbackRepo {
	return &UserFeedbackRepo{db: db}
}

// ValidateFeedbackCategory normalises (lower-case + trim) and validates
// a caller-supplied category string.
func ValidateFeedbackCategory(category string) (string, error) {
	c := strings.ToLower(strings.TrimSpace(category))
	switch c {
	case FeedbackCategoryBug, FeedbackCategoryFeature, FeedbackCategoryOther:
		return c, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrFeedbackInvalidCategory, category)
	}
}

// ValidateFeedbackStatus normalises and validates a caller-supplied
// status string.
func ValidateFeedbackStatus(status string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(status))
	switch s {
	case FeedbackStatusNew, FeedbackStatusTriaged, FeedbackStatusClosed:
		return s, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrFeedbackInvalidStatus, status)
	}
}

// NormalizeFeedbackInput trims, validates, and truncates an inbound
// FeedbackInsert. Returns the cleaned struct ready for Insert. Pure —
// safe to call without a live DB.
func NormalizeFeedbackInput(in FeedbackInsert) (FeedbackInsert, error) {
	cat, err := ValidateFeedbackCategory(in.Category)
	if err != nil {
		return FeedbackInsert{}, err
	}
	in.Category = cat

	in.Title = strings.TrimSpace(in.Title)
	titleRunes := []rune(in.Title)
	if len(titleRunes) < FeedbackTitleMinLen {
		return FeedbackInsert{}, fmt.Errorf("%w: have %d need %d", ErrFeedbackTitleTooShort, len(titleRunes), FeedbackTitleMinLen)
	}
	if len(titleRunes) > FeedbackTitleMaxLen {
		in.Title = string(titleRunes[:FeedbackTitleMaxLen])
	}

	in.Body = strings.TrimSpace(in.Body)
	bodyRunes := []rune(in.Body)
	if len(bodyRunes) < FeedbackBodyMinLen {
		return FeedbackInsert{}, fmt.Errorf("%w: have %d need %d", ErrFeedbackBodyTooShort, len(bodyRunes), FeedbackBodyMinLen)
	}
	if len(bodyRunes) > FeedbackBodyMaxLen {
		in.Body = string(bodyRunes[:FeedbackBodyMaxLen])
	}

	in.PageRoute = truncateRunes(strings.TrimSpace(in.PageRoute), FeedbackPageRouteMaxLen)
	in.UserAgent = truncateRunes(strings.TrimSpace(in.UserAgent), FeedbackUserAgentMaxLen)
	in.AppVersion = truncateRunes(strings.TrimSpace(in.AppVersion), FeedbackAppVersionMaxLen)
	in.UserEmail = truncateRunes(strings.TrimSpace(in.UserEmail), FeedbackUserEmailMaxLen)
	in.ConsoleTail = truncateRunes(in.ConsoleTail, FeedbackConsoleTailMaxLen)
	in.SubmitterSubject = strings.TrimSpace(in.SubmitterSubject)
	in.SubmitterIP = strings.TrimSpace(in.SubmitterIP)

	if len(in.RecentErrors) > 0 {
		// Validate JSON shape — an invalid payload becomes NULL rather
		// than rejecting the report (the diagnostic is a nice-to-have,
		// the user's words are the actionable surface).
		if !json.Valid(in.RecentErrors) || len(in.RecentErrors) > FeedbackRecentErrorsMaxBytes {
			in.RecentErrors = nil
		}
	}

	return in, nil
}

func truncateRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// Insert validates + persists a feedback row and returns the populated
// UserFeedback (id + created_at filled by the DB).
func (r *UserFeedbackRepo) Insert(ctx context.Context, in FeedbackInsert) (UserFeedback, error) {
	if r == nil || r.db == nil {
		return UserFeedback{}, errors.New("user_feedback: repo not initialized")
	}
	clean, err := NormalizeFeedbackInput(in)
	if err != nil {
		return UserFeedback{}, err
	}

	row := UserFeedback{}
	var (
		pageRoute      = nullString(clean.PageRoute)
		userAgent      = nullString(clean.UserAgent)
		appVersion     = nullString(clean.AppVersion)
		userEmail      = nullString(clean.UserEmail)
		recentErrors   any
		consoleTail    = nullString(clean.ConsoleTail)
		submitterSubj  = nullString(clean.SubmitterSubject)
		submitterIP    = nullString(clean.SubmitterIP)
	)
	if len(clean.RecentErrors) > 0 {
		recentErrors = []byte(clean.RecentErrors)
	}

	const query = `
		INSERT INTO user_feedback (
			category, title, body, page_route, user_agent, app_version,
			user_email, recent_errors, console_tail,
			submitter_subject, submitter_ip
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9,
			$10, $11
		)
		RETURNING id, created_at, category, title, body,
			COALESCE(page_route, ''), COALESCE(user_agent, ''),
			COALESCE(app_version, ''), COALESCE(user_email, ''),
			recent_errors, COALESCE(console_tail, ''),
			status, COALESCE(github_issue_url, ''),
			COALESCE(submitter_subject, ''), COALESCE(submitter_ip, ''),
			triaged_at, COALESCE(triaged_by, '')`

	var rawErrors []byte
	err = r.db.Pool.QueryRow(ctx, query,
		clean.Category, clean.Title, clean.Body,
		pageRoute, userAgent, appVersion,
		userEmail, recentErrors, consoleTail,
		submitterSubj, submitterIP,
	).Scan(
		&row.ID, &row.CreatedAt, &row.Category, &row.Title, &row.Body,
		&row.PageRoute, &row.UserAgent,
		&row.AppVersion, &row.UserEmail,
		&rawErrors, &row.ConsoleTail,
		&row.Status, &row.GitHubIssueURL,
		&row.SubmitterSubject, &row.SubmitterIP,
		&row.TriagedAt, &row.TriagedBy,
	)
	if err != nil {
		return UserFeedback{}, fmt.Errorf("user_feedback insert: %w", err)
	}
	if len(rawErrors) > 0 {
		row.RecentErrors = json.RawMessage(rawErrors)
	}
	return row, nil
}

// FeedbackListParams is the optional filter shape for List. Empty
// fields disable that filter.
type FeedbackListParams struct {
	Status   string
	Category string
	Limit    int
	Offset   int
}

// List returns matching rows ordered by created_at DESC. Limit defaults
// to 50 and is capped at 200; offset clamps to >= 0.
func (r *UserFeedbackRepo) List(ctx context.Context, p FeedbackListParams) ([]UserFeedback, int64, error) {
	if r == nil || r.db == nil {
		return nil, 0, errors.New("user_feedback: repo not initialized")
	}

	limit := p.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset := p.Offset
	if offset < 0 {
		offset = 0
	}

	args := []any{}
	whereParts := []string{}
	if p.Status != "" {
		s, err := ValidateFeedbackStatus(p.Status)
		if err != nil {
			return nil, 0, err
		}
		args = append(args, s)
		whereParts = append(whereParts, fmt.Sprintf("status = $%d", len(args)))
	}
	if p.Category != "" {
		c, err := ValidateFeedbackCategory(p.Category)
		if err != nil {
			return nil, 0, err
		}
		args = append(args, c)
		whereParts = append(whereParts, fmt.Sprintf("category = $%d", len(args)))
	}
	whereClause := ""
	if len(whereParts) > 0 {
		whereClause = "WHERE " + strings.Join(whereParts, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM user_feedback %s", whereClause)
	var total int64
	if err := r.db.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("user_feedback count: %w", err)
	}

	listQuery := fmt.Sprintf(`
		SELECT id, created_at, category, title, body,
			COALESCE(page_route, ''), COALESCE(user_agent, ''),
			COALESCE(app_version, ''), COALESCE(user_email, ''),
			recent_errors, COALESCE(console_tail, ''),
			status, COALESCE(github_issue_url, ''),
			COALESCE(submitter_subject, ''), COALESCE(submitter_ip, ''),
			triaged_at, COALESCE(triaged_by, '')
		FROM user_feedback
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, whereClause, len(args)+1, len(args)+2)

	rows, err := r.db.Pool.Query(ctx, listQuery, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("user_feedback list: %w", err)
	}
	defer rows.Close()

	out := []UserFeedback{}
	for rows.Next() {
		var row UserFeedback
		var rawErrors []byte
		if err := rows.Scan(
			&row.ID, &row.CreatedAt, &row.Category, &row.Title, &row.Body,
			&row.PageRoute, &row.UserAgent,
			&row.AppVersion, &row.UserEmail,
			&rawErrors, &row.ConsoleTail,
			&row.Status, &row.GitHubIssueURL,
			&row.SubmitterSubject, &row.SubmitterIP,
			&row.TriagedAt, &row.TriagedBy,
		); err != nil {
			return nil, 0, fmt.Errorf("user_feedback scan: %w", err)
		}
		if len(rawErrors) > 0 {
			row.RecentErrors = json.RawMessage(rawErrors)
		}
		out = append(out, row)
	}
	return out, total, rows.Err()
}

// Get returns a single feedback row by id, or ErrFeedbackNotFound.
func (r *UserFeedbackRepo) Get(ctx context.Context, id int64) (UserFeedback, error) {
	if r == nil || r.db == nil {
		return UserFeedback{}, errors.New("user_feedback: repo not initialized")
	}
	const query = `
		SELECT id, created_at, category, title, body,
			COALESCE(page_route, ''), COALESCE(user_agent, ''),
			COALESCE(app_version, ''), COALESCE(user_email, ''),
			recent_errors, COALESCE(console_tail, ''),
			status, COALESCE(github_issue_url, ''),
			COALESCE(submitter_subject, ''), COALESCE(submitter_ip, ''),
			triaged_at, COALESCE(triaged_by, '')
		FROM user_feedback
		WHERE id = $1`

	var row UserFeedback
	var rawErrors []byte
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&row.ID, &row.CreatedAt, &row.Category, &row.Title, &row.Body,
		&row.PageRoute, &row.UserAgent,
		&row.AppVersion, &row.UserEmail,
		&rawErrors, &row.ConsoleTail,
		&row.Status, &row.GitHubIssueURL,
		&row.SubmitterSubject, &row.SubmitterIP,
		&row.TriagedAt, &row.TriagedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserFeedback{}, ErrFeedbackNotFound
	}
	if err != nil {
		return UserFeedback{}, fmt.Errorf("user_feedback get: %w", err)
	}
	if len(rawErrors) > 0 {
		row.RecentErrors = json.RawMessage(rawErrors)
	}
	return row, nil
}

// Update applies a partial update (status, github_issue_url) to the row
// identified by id and returns the refreshed UserFeedback. Bumps
// triaged_at to NOW() and sets triaged_by to the supplied subject when
// any field changed.
func (r *UserFeedbackRepo) Update(ctx context.Context, id int64, upd FeedbackUpdate) (UserFeedback, error) {
	if r == nil || r.db == nil {
		return UserFeedback{}, errors.New("user_feedback: repo not initialized")
	}

	setParts := []string{}
	args := []any{}
	if upd.Status != nil {
		s, err := ValidateFeedbackStatus(*upd.Status)
		if err != nil {
			return UserFeedback{}, err
		}
		args = append(args, s)
		setParts = append(setParts, fmt.Sprintf("status = $%d", len(args)))
	}
	if upd.GitHubIssueURL != nil {
		raw := strings.TrimSpace(*upd.GitHubIssueURL)
		if raw == "" {
			args = append(args, nil)
		} else {
			args = append(args, raw)
		}
		setParts = append(setParts, fmt.Sprintf("github_issue_url = $%d", len(args)))
	}
	if len(setParts) == 0 {
		return r.Get(ctx, id)
	}

	args = append(args, time.Now().UTC())
	setParts = append(setParts, fmt.Sprintf("triaged_at = $%d", len(args)))
	by := strings.TrimSpace(upd.TriagedBy)
	if by == "" {
		args = append(args, nil)
	} else {
		args = append(args, by)
	}
	setParts = append(setParts, fmt.Sprintf("triaged_by = $%d", len(args)))

	args = append(args, id)
	query := fmt.Sprintf(`
		UPDATE user_feedback
		SET %s
		WHERE id = $%d
		RETURNING id, created_at, category, title, body,
			COALESCE(page_route, ''), COALESCE(user_agent, ''),
			COALESCE(app_version, ''), COALESCE(user_email, ''),
			recent_errors, COALESCE(console_tail, ''),
			status, COALESCE(github_issue_url, ''),
			COALESCE(submitter_subject, ''), COALESCE(submitter_ip, ''),
			triaged_at, COALESCE(triaged_by, '')`,
		strings.Join(setParts, ", "), len(args))

	var row UserFeedback
	var rawErrors []byte
	err := r.db.Pool.QueryRow(ctx, query, args...).Scan(
		&row.ID, &row.CreatedAt, &row.Category, &row.Title, &row.Body,
		&row.PageRoute, &row.UserAgent,
		&row.AppVersion, &row.UserEmail,
		&rawErrors, &row.ConsoleTail,
		&row.Status, &row.GitHubIssueURL,
		&row.SubmitterSubject, &row.SubmitterIP,
		&row.TriagedAt, &row.TriagedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserFeedback{}, ErrFeedbackNotFound
	}
	if err != nil {
		return UserFeedback{}, fmt.Errorf("user_feedback update: %w", err)
	}
	if len(rawErrors) > 0 {
		row.RecentErrors = json.RawMessage(rawErrors)
	}
	return row, nil
}

// CountSubmittedSince returns the number of rows submitted by the given
// subject (or IP when subject is empty) since the cutoff time. Used by
// the public ingest handler to enforce per-submitter rate limits.
func (r *UserFeedbackRepo) CountSubmittedSince(ctx context.Context, subject, ip string, since time.Time) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("user_feedback: repo not initialized")
	}
	subject = strings.TrimSpace(subject)
	ip = strings.TrimSpace(ip)
	var (
		count int64
		err   error
	)
	if subject != "" {
		err = r.db.Pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM user_feedback
			  WHERE submitter_subject = $1 AND created_at >= $2`,
			subject, since).Scan(&count)
	} else if ip != "" {
		err = r.db.Pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM user_feedback
			  WHERE submitter_subject IS NULL AND submitter_ip = $1 AND created_at >= $2`,
			ip, since).Scan(&count)
	} else {
		// Neither identity surface is available — disable the per-row
		// throttle (the route-level httprate.LimitByIP still bounds abuse).
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("user_feedback count_recent: %w", err)
	}
	return count, nil
}

// nullString returns nil for empty strings so they map to SQL NULL,
// otherwise the trimmed string itself.
func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
