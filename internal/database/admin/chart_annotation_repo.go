package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ChartAnnotationRepo is the data-access layer for the `chart_annotations`
// table introduced by migration 000159.
//
// Annotations are user-authored event markers rendered on time-series charts
// (battery replacement, software update, tire change…). The repo deliberately
// keeps queries simple — there's only one user today, all rows are returned in
// chronological order so the UI can pick the slice it needs client-side.
type ChartAnnotationRepo struct {
	pool adminPool
}

func NewChartAnnotationRepo(db *database.DB) *ChartAnnotationRepo {
	return &ChartAnnotationRepo{pool: db.Pool}
}

// ChartAnnotationFilter narrows a List call to a vehicle, time window, and/or
// chart-bucket scope. Zero values disable the corresponding filter.
type ChartAnnotationFilter struct {
	VehicleID *int64
	From      *time.Time
	To        *time.Time
	// Scope filters by overlap: a row matches when its scope[] array shares
	// any element with the requested bucket, OR when the row's scope is
	// empty (meaning "all charts").
	Scope string
}

// List returns every annotation matching the supplied filter, newest first.
//
// Vehicle scoping is inclusive: when a VehicleID is supplied, rows pinned to
// that vehicle PLUS rows with vehicle_id IS NULL (fleet-wide) are returned —
// so a single utility-rate annotation can annotate every vehicle's cost chart.
func (r *ChartAnnotationRepo) List(ctx context.Context, f ChartAnnotationFilter) ([]*dashboardmodel.ChartAnnotation, error) {
	const query = `
		SELECT id, user_id, vehicle_id, occurred_at, category, title, description, scope, color, created_at, updated_at
		FROM chart_annotations
		WHERE ($1::bigint IS NULL OR vehicle_id IS NULL OR vehicle_id = $1)
		  AND ($2::timestamptz IS NULL OR occurred_at >= $2)
		  AND ($3::timestamptz IS NULL OR occurred_at <= $3)
		  AND ($4::text = '' OR scope = '{}'::text[] OR $4 = ANY(scope))
		ORDER BY occurred_at DESC, id DESC`

	rows, err := r.pool.Query(ctx, query, f.VehicleID, f.From, f.To, f.Scope)
	if err != nil {
		return nil, fmt.Errorf("chart_annotations list query: %w", err)
	}
	defer rows.Close()

	var out []*dashboardmodel.ChartAnnotation
	for rows.Next() {
		a := &dashboardmodel.ChartAnnotation{}
		if scanErr := rows.Scan(
			&a.ID, &a.UserID, &a.VehicleID, &a.OccurredAt, &a.Category,
			&a.Title, &a.Description, &a.Scope, &a.Color,
			&a.CreatedAt, &a.UpdatedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("chart_annotations list scan: %w", scanErr)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chart_annotations list iter: %w", err)
	}
	return out, nil
}

// GetByID fetches a single annotation. Returns (nil, nil) if no row matches
// so callers can render a clean 404 without unwrapping pgx-specific errors.
func (r *ChartAnnotationRepo) GetByID(ctx context.Context, id int64) (*dashboardmodel.ChartAnnotation, error) {
	const query = `
		SELECT id, user_id, vehicle_id, occurred_at, category, title, description, scope, color, created_at, updated_at
		FROM chart_annotations
		WHERE id = $1`

	a := &dashboardmodel.ChartAnnotation{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&a.ID, &a.UserID, &a.VehicleID, &a.OccurredAt, &a.Category,
		&a.Title, &a.Description, &a.Scope, &a.Color,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("chart_annotations get_by_id: %w", err)
	}
	return a, nil
}

// Create inserts a new annotation. The `id`, `created_at`, `updated_at`
// fields on the supplied struct are populated on success.
func (r *ChartAnnotationRepo) Create(ctx context.Context, a *dashboardmodel.ChartAnnotation) error {
	const query = `
		INSERT INTO chart_annotations (user_id, vehicle_id, occurred_at, category, title, description, scope, color, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
		RETURNING id, created_at, updated_at`

	now := time.Now().UTC()
	scope := a.Scope
	if scope == nil {
		scope = []string{}
	}
	if err := r.pool.QueryRow(ctx, query,
		a.UserID, a.VehicleID, a.OccurredAt, string(a.Category),
		a.Title, a.Description, scope, a.Color, now,
	).Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return fmt.Errorf("chart_annotations create: %w", err)
	}
	a.Scope = scope
	return nil
}

// ChartAnnotationUpdate carries the patch shape for Update. Each pointer is
// optional — nil means "leave alone". The pattern mirrors the existing
// dashboard layout repo so Update can support partial PATCH semantics.
type ChartAnnotationUpdate struct {
	OccurredAt  *time.Time
	Category    *dashboardmodel.AnnotationCategory
	Title       *string
	Description *string
	Scope       *[]string
	Color       *string
	// ClearDescription / ClearColor explicitly set the column to NULL so
	// callers can distinguish "leave alone" (nil) from "wipe it" (true).
	ClearDescription bool
	ClearColor       bool
}

// Update mutates an existing annotation. Returns pgx.ErrNoRows when no row
// matches the id so the handler can return 404 cleanly.
func (r *ChartAnnotationRepo) Update(ctx context.Context, id int64, patch ChartAnnotationUpdate) error {
	existing, err := r.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return pgx.ErrNoRows
	}

	if patch.OccurredAt != nil {
		existing.OccurredAt = *patch.OccurredAt
	}
	if patch.Category != nil {
		existing.Category = *patch.Category
	}
	if patch.Title != nil {
		existing.Title = *patch.Title
	}
	if patch.ClearDescription {
		existing.Description = nil
	} else if patch.Description != nil {
		v := *patch.Description
		existing.Description = &v
	}
	if patch.Scope != nil {
		existing.Scope = *patch.Scope
	}
	if patch.ClearColor {
		existing.Color = nil
	} else if patch.Color != nil {
		v := *patch.Color
		existing.Color = &v
	}

	const query = `
		UPDATE chart_annotations
		SET occurred_at = $2,
		    category    = $3,
		    title       = $4,
		    description = $5,
		    scope       = $6,
		    color       = $7,
		    updated_at  = $8
		WHERE id = $1`

	now := time.Now().UTC()
	scope := existing.Scope
	if scope == nil {
		scope = []string{}
	}
	tag, execErr := r.pool.Exec(ctx, query,
		id, existing.OccurredAt, string(existing.Category), existing.Title,
		existing.Description, scope, existing.Color, now,
	)
	if execErr != nil {
		return fmt.Errorf("chart_annotations update: %w", execErr)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// Delete removes an annotation by id. Returns pgx.ErrNoRows when the row was
// already gone so the handler can return 404 cleanly.
func (r *ChartAnnotationRepo) Delete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM chart_annotations WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("chart_annotations delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
