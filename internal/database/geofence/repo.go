package geofence

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
)

// geofenceColumns is the canonical projection for every SELECT in this file.
// Column order MUST match scanGeofence() arg order; keep them in sync or
// pgx scan errors will surface at first list/get.
const geofenceColumns = `id, name, polygon_wkt, category, enabled, alert_on_entry, alert_on_exit, created_at, updated_at, origin, needs_review, archived_at`

// scanGeofence is the single point of truth for geofences row → struct
// mapping so a column rename only requires one edit.
func scanGeofence(row pgx.Row, g *systemmodel.Geofence) error {
	return row.Scan(
		&g.ID,
		&g.Name,
		&g.PolygonWKT,
		&g.Category,
		&g.Enabled,
		&g.AlertOnEntry,
		&g.AlertOnExit,
		&g.CreatedAt,
		&g.UpdatedAt,
		&g.Origin,
		&g.NeedsReview,
		&g.ArchivedAt,
	)
}

// GeofenceRepo provides geofence data access.
type GeofenceRepo struct {
	pool geofencePool
}

func NewGeofenceRepo(db *database.DB) *GeofenceRepo {
	return &GeofenceRepo{pool: db.Pool}
}

func (r *GeofenceRepo) Create(ctx context.Context, g *systemmodel.Geofence) error {
	if g.Origin == "" {
		g.Origin = systemmodel.GeofenceOriginManual
	}
	query := `INSERT INTO geofences (name, polygon_wkt, category, enabled, alert_on_entry, alert_on_exit, created_at, updated_at, origin, needs_review)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9) RETURNING id`
	now := time.Now().UTC()
	if err := r.pool.QueryRow(ctx, query,
		g.Name, g.PolygonWKT, g.Category,
		g.Enabled, g.AlertOnEntry, g.AlertOnExit,
		now, g.Origin, g.NeedsReview,
	).Scan(&g.ID); err != nil {
		return fmt.Errorf("geofences create: %w", err)
	}
	g.CreatedAt, g.UpdatedAt = now, now
	return nil
}

// GetAll lists active (non-archived) geofences. Archived places are excluded
// from this default listing per the historical-integrity rule — they remain
// individually resolvable via GetByID for history, but never appear in the
// general management list.
func (r *GeofenceRepo) GetAll(ctx context.Context) ([]*systemmodel.Geofence, error) {
	return r.getAll(ctx, false)
}

// GetAllIncludingArchived lists active and archived geofences for management
// surfaces that explicitly request historical places.
func (r *GeofenceRepo) GetAllIncludingArchived(ctx context.Context) ([]*systemmodel.Geofence, error) {
	return r.getAll(ctx, true)
}

func (r *GeofenceRepo) getAll(ctx context.Context, includeArchived bool) ([]*systemmodel.Geofence, error) {
	query := `SELECT ` + geofenceColumns + ` FROM geofences`
	if !includeArchived {
		query += ` WHERE archived_at IS NULL`
	}
	query += ` ORDER BY archived_at NULLS FIRST, name LIMIT 500`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("geofences get_all query: %w", err)
	}
	defer rows.Close()

	var geofences []*systemmodel.Geofence
	for rows.Next() {
		g := &systemmodel.Geofence{}
		if err := scanGeofence(rows, g); err != nil {
			return nil, fmt.Errorf("geofences get_all scan: %w", err)
		}
		geofences = append(geofences, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofences get_all iter: %w", err)
	}
	return geofences, nil
}

func (r *GeofenceRepo) GetByID(ctx context.Context, id int64) (*systemmodel.Geofence, error) {
	query := `SELECT ` + geofenceColumns + ` FROM geofences WHERE id=$1`
	g := &systemmodel.Geofence{}
	err := scanGeofence(r.pool.QueryRow(ctx, query, id), g)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("geofences get_by_id %d: %w", id, err)
	}
	return g, nil
}

// Update applies the CRUD/alert-relevant fields (name, geometry, category,
// enabled, alert flags, needs_review). It deliberately does NOT touch Origin
// (immutable provenance set once at creation) or ArchivedAt (owned
// exclusively by Archive/Unarchive so a routine merge-PUT can never
// accidentally resurrect or retire a place).
func (r *GeofenceRepo) Update(ctx context.Context, g *systemmodel.Geofence) error {
	query := `UPDATE geofences
		SET name=$2, polygon_wkt=$3, category=$4,
		    enabled=$5, alert_on_entry=$6, alert_on_exit=$7,
		    needs_review=$8, updated_at=$9
		WHERE id=$1`
	now := time.Now().UTC()
	if _, err := r.pool.Exec(ctx, query,
		g.ID, g.Name, g.PolygonWKT, g.Category,
		g.Enabled, g.AlertOnEntry, g.AlertOnExit,
		g.NeedsReview, now,
	); err != nil {
		return fmt.Errorf("geofences update %d: %w", g.ID, err)
	}
	g.UpdatedAt = now
	return nil
}

func (r *GeofenceRepo) Delete(ctx context.Context, id int64) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM geofences WHERE id=$1`, id); err != nil {
		return fmt.Errorf("geofences delete %d: %w", id, err)
	}
	return nil
}

// rowQueryer is the minimal "run a SELECT" seam shared by geofencePool and
// pgx.Tx, letting findActiveGeofencesNear run identically inside or outside
// a transaction (needed by the discovery advisory-lock flow in
// repo_discovery.go, which must re-check for a match INSIDE its lock/tx).
type rowQueryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// FindByCoordinates finds active (non-archived) geofences containing the
// given point. Loads all active geofences and filters in Go using Haversine
// against the polygon centroid + derived radius (columns removed from
// table).
//
// Archived places are excluded here (unlike GetByID, which resolves any ID
// including archived ones for history) because this method backs *active*
// matching: charging/drive place-name lookup and automation
// entry/exit-alert evaluation. Matching against a retired place identity
// would silently resurrect it from the user's perspective.
//
// NOTE: this intentionally does NOT filter on `enabled`. The reverse-geocoder
// and friendly-name lookups want every fence; alert evaluators (FSM,
// notification dispatcher) MUST filter g.Enabled themselves.
func (r *GeofenceRepo) FindByCoordinates(ctx context.Context, lat, lng float64) ([]*systemmodel.Geofence, error) {
	return findActiveGeofencesNear(ctx, r.pool, lat, lng)
}

// findActiveGeofencesNear is the shared implementation behind
// FindByCoordinates; see that method's doc for behavior.
func findActiveGeofencesNear(ctx context.Context, q rowQueryer, lat, lng float64) ([]*systemmodel.Geofence, error) {
	query := `SELECT ` + geofenceColumns + ` FROM geofences WHERE archived_at IS NULL`
	rows, err := q.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("geofences find_by_coordinates query: %w", err)
	}
	defer rows.Close()

	var geofences []*systemmodel.Geofence
	for rows.Next() {
		g := &systemmodel.Geofence{}
		if err := scanGeofence(rows, g); err != nil {
			return nil, fmt.Errorf("geofences find_by_coordinates scan: %w", err)
		}
		cLat, cLon := g.Centroid()
		radius := g.Radius()
		if radius > 0 && haversineMeters(lat, lng, cLat, cLon) <= radius {
			geofences = append(geofences, g)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofences find_by_coordinates iter: %w", err)
	}
	sort.SliceStable(geofences, func(i, j int) bool {
		leftManual := geofences[i].Origin == systemmodel.GeofenceOriginManual
		rightManual := geofences[j].Origin == systemmodel.GeofenceOriginManual
		if leftManual != rightManual {
			return leftManual
		}
		leftRadius := geofences[i].Radius()
		rightRadius := geofences[j].Radius()
		if leftRadius != rightRadius {
			return leftRadius < rightRadius
		}
		return geofences[i].ID < geofences[j].ID
	})
	return geofences, nil
}

// haversineMeters returns the great-circle distance in meters between two points.
func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadius = 6371000
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	return earthRadius * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
