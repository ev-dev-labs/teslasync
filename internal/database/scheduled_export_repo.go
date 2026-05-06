// Phase-46 / Prompt 65 — Scheduled / recurring exports repository.
//
// Persists user-configured cron schedules backing /scheduled-exports.
// The handler creates / updates / deletes rows via this repo; the
// export package's Scheduler tick reads due rows via DueBefore and
// writes back the run outcome via MarkRunResult.
//
// Validation policy
// -----------------
// Every public method that accepts user-supplied fields normalises +
// validates them up front so a row that survives the boundary is
// guaranteed to be processable by the worker:
//
//   - export_type is whitelisted to the same set the
//     scheduled_exports table CHECK constraint pins.
//   - format is whitelisted to csv / json.
//   - schedule_cron parses through robfig/cron v3 standard parser at
//     create / update time so an obviously broken expression never
//     reaches the worker tick.
//   - delivery.kind is whitelisted to download / email / webhook;
//     email + webhook reject empty targets so a "wired but not
//     configured" delivery never silently no-ops.
//   - range_window parses via ParseRangeWindow (default '7d') so the
//     worker has a concrete (start, end) to slot into the export
//     request without re-validating per tick.
package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/robfig/cron/v3"
)

// ScheduledExportDeliveryKind enumerates the supported delivery
// transports. The string form is the on-wire / on-disk value.
type ScheduledExportDeliveryKind string

const (
	DeliveryKindDownload ScheduledExportDeliveryKind = "download"
	DeliveryKindEmail    ScheduledExportDeliveryKind = "email"
	DeliveryKindWebhook  ScheduledExportDeliveryKind = "webhook"
)

// ScheduledExportDelivery is the typed projection of the JSONB
// `delivery` column. Kept narrow so a future delivery kind addition
// (S3, Drive, …) only touches this struct + the validator below.
type ScheduledExportDelivery struct {
	Kind   ScheduledExportDeliveryKind `json:"kind"`
	Target string                      `json:"target,omitempty"`
}

// ScheduledExportRow is the in-memory projection of a row in
// scheduled_exports. Times are always UTC; nullable columns are
// pointers so the JSON layer can omitempty without lying about a
// present-but-empty value.
type ScheduledExportRow struct {
	ID            int64                   `json:"id"`
	OwnerSubject  string                  `json:"owner_subject"`
	Name          string                  `json:"name"`
	ExportType    string                  `json:"export_type"`
	Format        string                  `json:"format"`
	VehicleID     *int64                  `json:"vehicle_id,omitempty"`
	Columns       []string                `json:"columns,omitempty"`
	ScheduleCron  string                  `json:"schedule_cron"`
	Delivery      ScheduledExportDelivery `json:"delivery"`
	RangeWindow   string                  `json:"range_window"`
	Enabled       bool                    `json:"enabled"`
	LastRunAt     *time.Time              `json:"last_run_at,omitempty"`
	LastStatus    *string                 `json:"last_status,omitempty"`
	LastError     *string                 `json:"last_error,omitempty"`
	NextRunAt     *time.Time              `json:"next_run_at,omitempty"`
	CreatedAt     time.Time               `json:"created_at"`
	UpdatedAt     time.Time               `json:"updated_at"`
}

// ScheduledExportInput is the validated payload accepted by Create /
// Update. Every field is the post-normalisation form so the repo
// never has to re-trim whitespace below this layer.
type ScheduledExportInput struct {
	Name         string
	ExportType   string
	Format       string
	VehicleID    *int64
	Columns      []string
	ScheduleCron string
	Delivery     ScheduledExportDelivery
	RangeWindow  string
	Enabled      bool
}

// ScheduledExportRunOutcome captures the result of a single tick
// processing a due row. The orchestrator passes this back to
// MarkRunResult so last_status / last_error / last_run_at /
// next_run_at land in a single UPDATE.
type ScheduledExportRunOutcome struct {
	RanAt     time.Time
	Status    string // "ok" | "failed"
	Err       string // empty when Status="ok"
	NextRunAt *time.Time
}

// Sentinel errors raised by the repo. Handlers map these to
// specific 4xx responses; anything else is a 500.
var (
	ErrScheduledExportNotFound      = errors.New("scheduled_export: not found")
	ErrScheduledExportInvalidType   = errors.New("scheduled_export: invalid export_type")
	ErrScheduledExportInvalidFormat = errors.New("scheduled_export: invalid format")
	ErrScheduledExportInvalidCron   = errors.New("scheduled_export: invalid schedule_cron")
	ErrScheduledExportInvalidDeliv  = errors.New("scheduled_export: invalid delivery")
	ErrScheduledExportInvalidWindow = errors.New("scheduled_export: invalid range_window")
	ErrScheduledExportEmptyOwner    = errors.New("scheduled_export: owner subject is required")
	ErrScheduledExportEmptyName     = errors.New("scheduled_export: name is required")
	ErrScheduledExportNotConfigured = errors.New("scheduled_export: repo not configured")
)

// allowedScheduledExportTypes mirrors the CHECK constraint on
// scheduled_exports.export_type. Kept as a package-private set so
// callers go through ValidateScheduledExportType.
var allowedScheduledExportTypes = map[string]struct{}{
	"drives":    {},
	"charging":  {},
	"trips":     {},
	"positions": {},
	"signals":   {},
}

// allowedScheduledExportFormats mirrors the CHECK constraint on
// scheduled_exports.format.
var allowedScheduledExportFormats = map[string]struct{}{
	"csv":  {},
	"json": {},
}

// allowedScheduledExportDeliveryKinds mirrors the worker's accepted
// kind set. Extending it requires also updating Scheduler.deliver in
// the export package.
var allowedScheduledExportDeliveryKinds = map[ScheduledExportDeliveryKind]struct{}{
	DeliveryKindDownload: {},
	DeliveryKindEmail:    {},
	DeliveryKindWebhook:  {},
}

// scheduledExportCronParser is the same parser shape automation/cron
// uses (5 standard fields + descriptor). Compiled once at init for
// throughput.
var scheduledExportCronParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

// ValidateScheduledExportType returns the canonical lower-case form
// of t when allowed, or ErrScheduledExportInvalidType otherwise.
func ValidateScheduledExportType(t string) (string, error) {
	canon := strings.ToLower(strings.TrimSpace(t))
	if _, ok := allowedScheduledExportTypes[canon]; !ok {
		return "", fmt.Errorf("%w: %q", ErrScheduledExportInvalidType, t)
	}
	return canon, nil
}

// ValidateScheduledExportFormat returns the canonical lower-case
// form of f when allowed, or ErrScheduledExportInvalidFormat
// otherwise.
func ValidateScheduledExportFormat(f string) (string, error) {
	canon := strings.ToLower(strings.TrimSpace(f))
	if _, ok := allowedScheduledExportFormats[canon]; !ok {
		return "", fmt.Errorf("%w: %q", ErrScheduledExportInvalidFormat, f)
	}
	return canon, nil
}

// ValidateScheduledExportDelivery normalises and validates a
// delivery envelope. The returned value is the form persisted +
// surfaced to the SPA.
func ValidateScheduledExportDelivery(d ScheduledExportDelivery) (ScheduledExportDelivery, error) {
	canon := ScheduledExportDelivery{
		Kind:   ScheduledExportDeliveryKind(strings.ToLower(strings.TrimSpace(string(d.Kind)))),
		Target: strings.TrimSpace(d.Target),
	}
	if _, ok := allowedScheduledExportDeliveryKinds[canon.Kind]; !ok {
		return ScheduledExportDelivery{}, fmt.Errorf("%w: kind %q", ErrScheduledExportInvalidDeliv, d.Kind)
	}
	switch canon.Kind {
	case DeliveryKindEmail, DeliveryKindWebhook:
		if canon.Target == "" {
			return ScheduledExportDelivery{}, fmt.Errorf(
				"%w: %s delivery requires a non-empty target",
				ErrScheduledExportInvalidDeliv, canon.Kind,
			)
		}
	case DeliveryKindDownload:
		// download is the implicit default — a target is meaningless
		// because the artifact is fetched out-of-band via the
		// /export/jobs/{id}/download endpoint. Drop any value the
		// caller supplied so future readers don't think it does
		// anything.
		canon.Target = ""
	}
	return canon, nil
}

// ValidateScheduledExportCron parses expr through the same parser
// the worker uses. The returned schedule is suitable for
// schedule.Next(now) calls; callers that only need validation can
// discard it.
func ValidateScheduledExportCron(expr string) (cron.Schedule, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return nil, fmt.Errorf("%w: empty expression", ErrScheduledExportInvalidCron)
	}
	sched, err := scheduledExportCronParser.Parse(expr)
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %v", ErrScheduledExportInvalidCron, expr, err)
	}
	return sched, nil
}

// ParseRangeWindow turns a user-supplied window string ("7d", "24h",
// "30m") into a time.Duration. Empty input falls back to the table's
// default '7d'. Negative or zero durations are rejected.
//
// Accepted suffixes: "m" (minutes), "h" (hours), "d" (days). The
// duration is computed as count * unit; a bare integer (e.g. "7") is
// rejected so users don't end up with ambiguous "7 nanoseconds"
// behaviour from time.ParseDuration.
func ParseRangeWindow(s string) (time.Duration, error) {
	raw := strings.TrimSpace(s)
	if raw == "" {
		raw = "7d"
	}
	if len(raw) < 2 {
		return 0, fmt.Errorf("%w: %q", ErrScheduledExportInvalidWindow, s)
	}
	suffix := raw[len(raw)-1]
	body := raw[:len(raw)-1]
	// Tolerate uppercase units ('24H') so a wire payload pasted from
	// a docs page isn't rejected purely on case.
	if suffix >= 'A' && suffix <= 'Z' {
		suffix += 'a' - 'A'
	}
	n, err := strconv.Atoi(body)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%w: %q (need positive integer)", ErrScheduledExportInvalidWindow, s)
	}
	switch suffix {
	case 'm':
		return time.Duration(n) * time.Minute, nil
	case 'h':
		return time.Duration(n) * time.Hour, nil
	case 'd':
		return time.Duration(n) * 24 * time.Hour, nil
	default:
		return 0, fmt.Errorf("%w: %q (suffix must be m/h/d)", ErrScheduledExportInvalidWindow, s)
	}
}

// CanonicalRangeWindow normalises s to its trimmed lowercase form,
// substituting the table default when empty. Used by the handler
// before persisting so '24H ' and ' 7d' both store as '24h' / '7d'.
func CanonicalRangeWindow(s string) (string, error) {
	if _, err := ParseRangeWindow(s); err != nil {
		return "", err
	}
	raw := strings.ToLower(strings.TrimSpace(s))
	if raw == "" {
		raw = "7d"
	}
	return raw, nil
}

// NormalizeScheduledExportInput runs every validator over an input
// and returns the canonical form. Callers should use this single
// entry point rather than invoking the field-level validators in
// sequence so a future input field cannot be silently skipped.
func NormalizeScheduledExportInput(in ScheduledExportInput) (ScheduledExportInput, error) {
	out := in
	out.Name = strings.TrimSpace(in.Name)
	if out.Name == "" {
		return ScheduledExportInput{}, ErrScheduledExportEmptyName
	}
	canonType, err := ValidateScheduledExportType(in.ExportType)
	if err != nil {
		return ScheduledExportInput{}, err
	}
	out.ExportType = canonType
	canonFmt, err := ValidateScheduledExportFormat(in.Format)
	if err != nil {
		return ScheduledExportInput{}, err
	}
	out.Format = canonFmt
	if _, err := ValidateScheduledExportCron(in.ScheduleCron); err != nil {
		return ScheduledExportInput{}, err
	}
	out.ScheduleCron = strings.TrimSpace(in.ScheduleCron)
	canonDeliv, err := ValidateScheduledExportDelivery(in.Delivery)
	if err != nil {
		return ScheduledExportInput{}, err
	}
	out.Delivery = canonDeliv
	canonWindow, err := CanonicalRangeWindow(in.RangeWindow)
	if err != nil {
		return ScheduledExportInput{}, err
	}
	out.RangeWindow = canonWindow
	// Columns: trim each entry; drop blanks. Per Phase-46 / Prompt 62
	// nil/empty signals "every catalog column" so we deliberately
	// allow that distinction to round-trip.
	if len(in.Columns) > 0 {
		cleaned := make([]string, 0, len(in.Columns))
		for _, c := range in.Columns {
			t := strings.TrimSpace(c)
			if t != "" {
				cleaned = append(cleaned, t)
			}
		}
		if len(cleaned) == 0 {
			out.Columns = nil
		} else {
			out.Columns = cleaned
		}
	}
	return out, nil
}

// ComputeNextRun returns the next firing time for expr after now.
// Convenience wrapper so the handler doesn't have to invoke the cron
// parser directly.
func ComputeNextRun(expr string, now time.Time) (time.Time, error) {
	sched, err := ValidateScheduledExportCron(expr)
	if err != nil {
		return time.Time{}, err
	}
	return sched.Next(now), nil
}

// ScheduledExportRepo is the data-access layer for scheduled_exports.
type ScheduledExportRepo struct {
	db *DB
}

// NewScheduledExportRepo wires the repo to a database pool. db may
// be nil for tests that exercise only the helpers exported from this
// file; pool-touching methods then return ErrScheduledExportNotConfigured.
func NewScheduledExportRepo(db *DB) *ScheduledExportRepo {
	return &ScheduledExportRepo{db: db}
}

func (r *ScheduledExportRepo) ready() error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrScheduledExportNotConfigured
	}
	return nil
}

// Create inserts a new row. owner MUST come from the request's
// authenticated subject — it is NEVER taken from the request body.
// The handler enforces this by passing the actor identity directly;
// the repo refuses an empty owner so a misconfigured handler can't
// silently plant a NULL-owner row.
func (r *ScheduledExportRepo) Create(ctx context.Context, owner string, in ScheduledExportInput, now time.Time) (*ScheduledExportRow, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, ErrScheduledExportEmptyOwner
	}
	if err := r.ready(); err != nil {
		return nil, err
	}
	canon, err := NormalizeScheduledExportInput(in)
	if err != nil {
		return nil, err
	}
	next, err := ComputeNextRun(canon.ScheduleCron, now)
	if err != nil {
		return nil, err
	}
	deliveryJSON, err := json.Marshal(canon.Delivery)
	if err != nil {
		return nil, fmt.Errorf("scheduled_export: marshal delivery: %w", err)
	}
	var columnsJSON []byte
	if len(canon.Columns) > 0 {
		columnsJSON, err = json.Marshal(canon.Columns)
		if err != nil {
			return nil, fmt.Errorf("scheduled_export: marshal columns: %w", err)
		}
	}
	const query = `
		INSERT INTO scheduled_exports
			(owner_subject, name, export_type, format, vehicle_id,
			 columns_json, schedule_cron, delivery, range_window, enabled,
			 next_run_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
		RETURNING id, owner_subject, name, export_type, format, vehicle_id,
		          columns_json, schedule_cron, delivery, range_window, enabled,
		          last_run_at, last_status, last_error, next_run_at,
		          created_at, updated_at`
	row := r.db.Pool.QueryRow(ctx, query,
		owner, canon.Name, canon.ExportType, canon.Format, canon.VehicleID,
		columnsJSON, canon.ScheduleCron, deliveryJSON, canon.RangeWindow, canon.Enabled,
		next, now,
	)
	out, err := scanScheduledExportRow(row)
	if err != nil {
		return nil, fmt.Errorf("scheduled_export create: %w", err)
	}
	return out, nil
}

// Get returns the row for id, or ErrScheduledExportNotFound when no
// row matches. Owner-scope filtering happens above this layer (the
// handler verifies the row's owner_subject matches the authenticated
// subject before returning it).
func (r *ScheduledExportRepo) Get(ctx context.Context, id int64) (*ScheduledExportRow, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `
		SELECT id, owner_subject, name, export_type, format, vehicle_id,
		       columns_json, schedule_cron, delivery, range_window, enabled,
		       last_run_at, last_status, last_error, next_run_at,
		       created_at, updated_at
		FROM scheduled_exports
		WHERE id = $1`
	row := r.db.Pool.QueryRow(ctx, query, id)
	out, err := scanScheduledExportRow(row)
	if err != nil {
		if isNoRowsError(err) {
			return nil, ErrScheduledExportNotFound
		}
		return nil, fmt.Errorf("scheduled_export get: %w", err)
	}
	return out, nil
}

// ListByOwner returns every schedule belonging to owner, ordered by
// name. The owner argument MUST come from the request's
// authenticated subject — passing a client-supplied string here
// would punch a hole in the per-user isolation contract.
func (r *ScheduledExportRepo) ListByOwner(ctx context.Context, owner string) ([]ScheduledExportRow, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, ErrScheduledExportEmptyOwner
	}
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `
		SELECT id, owner_subject, name, export_type, format, vehicle_id,
		       columns_json, schedule_cron, delivery, range_window, enabled,
		       last_run_at, last_status, last_error, next_run_at,
		       created_at, updated_at
		FROM scheduled_exports
		WHERE owner_subject = $1
		ORDER BY name ASC, id ASC`
	rows, err := r.db.Pool.Query(ctx, query, owner)
	if err != nil {
		return nil, fmt.Errorf("scheduled_export list: %w", err)
	}
	defer rows.Close()
	out := make([]ScheduledExportRow, 0, 8)
	for rows.Next() {
		row, err := scanScheduledExportRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scheduled_export list scan: %w", err)
		}
		out = append(out, *row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduled_export list iterate: %w", err)
	}
	return out, nil
}

// Update mutates the row referenced by id. owner is the requesting
// subject and is verified inside the SQL — passing the wrong owner
// returns ErrScheduledExportNotFound rather than 403 so the handler
// surface stays consistent (the row simply does not exist for
// this caller).
func (r *ScheduledExportRepo) Update(ctx context.Context, id int64, owner string, in ScheduledExportInput, now time.Time) (*ScheduledExportRow, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, ErrScheduledExportEmptyOwner
	}
	if err := r.ready(); err != nil {
		return nil, err
	}
	canon, err := NormalizeScheduledExportInput(in)
	if err != nil {
		return nil, err
	}
	next, err := ComputeNextRun(canon.ScheduleCron, now)
	if err != nil {
		return nil, err
	}
	deliveryJSON, err := json.Marshal(canon.Delivery)
	if err != nil {
		return nil, fmt.Errorf("scheduled_export: marshal delivery: %w", err)
	}
	var columnsJSON []byte
	if len(canon.Columns) > 0 {
		columnsJSON, err = json.Marshal(canon.Columns)
		if err != nil {
			return nil, fmt.Errorf("scheduled_export: marshal columns: %w", err)
		}
	}
	const query = `
		UPDATE scheduled_exports
		SET name = $3,
		    export_type = $4,
		    format = $5,
		    vehicle_id = $6,
		    columns_json = $7,
		    schedule_cron = $8,
		    delivery = $9,
		    range_window = $10,
		    enabled = $11,
		    next_run_at = $12,
		    updated_at = $13
		WHERE id = $1 AND owner_subject = $2
		RETURNING id, owner_subject, name, export_type, format, vehicle_id,
		          columns_json, schedule_cron, delivery, range_window, enabled,
		          last_run_at, last_status, last_error, next_run_at,
		          created_at, updated_at`
	row := r.db.Pool.QueryRow(ctx, query,
		id, owner, canon.Name, canon.ExportType, canon.Format, canon.VehicleID,
		columnsJSON, canon.ScheduleCron, deliveryJSON, canon.RangeWindow, canon.Enabled,
		next, now,
	)
	out, err := scanScheduledExportRow(row)
	if err != nil {
		if isNoRowsError(err) {
			return nil, ErrScheduledExportNotFound
		}
		return nil, fmt.Errorf("scheduled_export update: %w", err)
	}
	return out, nil
}

// Delete removes the row referenced by id, scoped to owner. Returns
// ErrScheduledExportNotFound when no row matches the (id, owner)
// pair so a caller can never delete another user's schedule.
func (r *ScheduledExportRepo) Delete(ctx context.Context, id int64, owner string) error {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return ErrScheduledExportEmptyOwner
	}
	if err := r.ready(); err != nil {
		return err
	}
	tag, err := r.db.Pool.Exec(ctx,
		`DELETE FROM scheduled_exports WHERE id = $1 AND owner_subject = $2`,
		id, owner,
	)
	if err != nil {
		return fmt.Errorf("scheduled_export delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrScheduledExportNotFound
	}
	return nil
}

// SetNextRunAt overwrites next_run_at for id, scoped to owner. Used
// by the manual "Run now" route which sets next_run_at = now() so
// the worker tick picks the row on its next iteration.
func (r *ScheduledExportRepo) SetNextRunAt(ctx context.Context, id int64, owner string, when time.Time) error {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return ErrScheduledExportEmptyOwner
	}
	if err := r.ready(); err != nil {
		return err
	}
	tag, err := r.db.Pool.Exec(ctx,
		`UPDATE scheduled_exports SET next_run_at = $3, updated_at = $4
		 WHERE id = $1 AND owner_subject = $2`,
		id, owner, when, time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("scheduled_export set next_run_at: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrScheduledExportNotFound
	}
	return nil
}

// DueBefore returns every enabled row whose next_run_at has already
// elapsed relative to cutoff. Used by the worker tick. The result is
// ordered by next_run_at ASC so a backlog is processed oldest-first.
//
// The query is intentionally NOT FOR UPDATE — the worker pipeline
// applies an in-process lock per row before processing, and a
// MarkRunResult call advances next_run_at past the current cutoff.
// This keeps the tick a pure SELECT so a worker outage doesn't leave
// row locks dangling.
func (r *ScheduledExportRepo) DueBefore(ctx context.Context, cutoff time.Time) ([]ScheduledExportRow, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `
		SELECT id, owner_subject, name, export_type, format, vehicle_id,
		       columns_json, schedule_cron, delivery, range_window, enabled,
		       last_run_at, last_status, last_error, next_run_at,
		       created_at, updated_at
		FROM scheduled_exports
		WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= $1
		ORDER BY next_run_at ASC, id ASC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, fmt.Errorf("scheduled_export due: %w", err)
	}
	defer rows.Close()
	out := make([]ScheduledExportRow, 0, 8)
	for rows.Next() {
		row, err := scanScheduledExportRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scheduled_export due scan: %w", err)
		}
		out = append(out, *row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduled_export due iterate: %w", err)
	}
	return out, nil
}

// MarkRunResult writes a tick outcome back to the row. The four
// fields land in a single UPDATE so the row never reports a stale
// last_status alongside a freshly-recomputed next_run_at.
func (r *ScheduledExportRepo) MarkRunResult(ctx context.Context, id int64, outcome ScheduledExportRunOutcome) error {
	if err := r.ready(); err != nil {
		return err
	}
	if outcome.Status != "ok" && outcome.Status != "failed" {
		return fmt.Errorf("scheduled_export mark: invalid status %q", outcome.Status)
	}
	var lastErr *string
	if outcome.Err != "" {
		v := outcome.Err
		lastErr = &v
	}
	tag, err := r.db.Pool.Exec(ctx,
		`UPDATE scheduled_exports
		 SET last_run_at = $2,
		     last_status = $3,
		     last_error = $4,
		     next_run_at = $5,
		     updated_at = $6
		 WHERE id = $1`,
		id, outcome.RanAt, outcome.Status, lastErr, outcome.NextRunAt, time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("scheduled_export mark: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrScheduledExportNotFound
	}
	return nil
}

// scanScheduledExportRow centralises the column projection for both
// QueryRow and Query callers. pgx.Row is a superset of pgx.Rows for
// the Scan method we use here.
type scheduledExportScanner interface {
	Scan(dest ...any) error
}

func scanScheduledExportRow(s scheduledExportScanner) (*ScheduledExportRow, error) {
	var (
		out          ScheduledExportRow
		columnsJSON  []byte
		deliveryJSON []byte
	)
	if err := s.Scan(
		&out.ID,
		&out.OwnerSubject,
		&out.Name,
		&out.ExportType,
		&out.Format,
		&out.VehicleID,
		&columnsJSON,
		&out.ScheduleCron,
		&deliveryJSON,
		&out.RangeWindow,
		&out.Enabled,
		&out.LastRunAt,
		&out.LastStatus,
		&out.LastError,
		&out.NextRunAt,
		&out.CreatedAt,
		&out.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(columnsJSON) > 0 {
		if err := json.Unmarshal(columnsJSON, &out.Columns); err != nil {
			return nil, fmt.Errorf("scheduled_export: decode columns: %w", err)
		}
	}
	if len(deliveryJSON) > 0 {
		if err := json.Unmarshal(deliveryJSON, &out.Delivery); err != nil {
			return nil, fmt.Errorf("scheduled_export: decode delivery: %w", err)
		}
	}
	return &out, nil
}

// Compile-time guard: pgx.Row satisfies scheduledExportScanner.
var _ scheduledExportScanner = (pgx.Row)(nil)
