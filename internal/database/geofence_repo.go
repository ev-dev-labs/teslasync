package database

import (
	"context"
	"math"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
)

// geofenceColumns is the canonical projection for every SELECT in this file.
// Column order MUST match scanGeofence() arg order; keep them in sync or
// pgx scan errors will surface at first list/get.
const geofenceColumns = `id, name, polygon_wkt, category, enabled, alert_on_entry, alert_on_exit, created_at, updated_at`

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
	)
}

// GeofenceRepo provides geofence data access.
type GeofenceRepo struct {
	db *DB
}

func NewGeofenceRepo(db *DB) *GeofenceRepo {
	return &GeofenceRepo{db: db}
}

func (r *GeofenceRepo) Create(ctx context.Context, g *systemmodel.Geofence) error {
	query := `INSERT INTO geofences (name, polygon_wkt, category, enabled, alert_on_entry, alert_on_exit, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query,
		g.Name, g.PolygonWKT, g.Category,
		g.Enabled, g.AlertOnEntry, g.AlertOnExit,
		now,
	).Scan(&g.ID)
}

func (r *GeofenceRepo) GetAll(ctx context.Context) ([]*systemmodel.Geofence, error) {
	query := `SELECT ` + geofenceColumns + ` FROM geofences ORDER BY name LIMIT 500`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var geofences []*systemmodel.Geofence
	for rows.Next() {
		g := &systemmodel.Geofence{}
		if err := scanGeofence(rows, g); err != nil {
			return nil, err
		}
		geofences = append(geofences, g)
	}
	return geofences, rows.Err()
}

func (r *GeofenceRepo) GetByID(ctx context.Context, id int64) (*systemmodel.Geofence, error) {
	query := `SELECT ` + geofenceColumns + ` FROM geofences WHERE id=$1`
	g := &systemmodel.Geofence{}
	err := scanGeofence(r.db.Pool.QueryRow(ctx, query, id), g)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return g, err
}

func (r *GeofenceRepo) Update(ctx context.Context, g *systemmodel.Geofence) error {
	query := `UPDATE geofences
		SET name=$2, polygon_wkt=$3, category=$4,
		    enabled=$5, alert_on_entry=$6, alert_on_exit=$7,
		    updated_at=$8
		WHERE id=$1`
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx, query,
		g.ID, g.Name, g.PolygonWKT, g.Category,
		g.Enabled, g.AlertOnEntry, g.AlertOnExit,
		now,
	)
	return err
}

func (r *GeofenceRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM geofences WHERE id=$1`, id)
	return err
}

// FindByCoordinates finds geofences containing the given point.
// Loads all geofences and filters in Go using Haversine against the
// polygon centroid + derived radius (columns removed from table).
//
// NOTE: this intentionally does NOT filter on `enabled`. The reverse-geocoder
// and friendly-name lookups want every fence; alert evaluators (FSM,
// notification dispatcher) MUST filter g.Enabled themselves.
func (r *GeofenceRepo) FindByCoordinates(ctx context.Context, lat, lng float64) ([]*systemmodel.Geofence, error) {
	query := `SELECT ` + geofenceColumns + ` FROM geofences`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var geofences []*systemmodel.Geofence
	for rows.Next() {
		g := &systemmodel.Geofence{}
		if err := scanGeofence(rows, g); err != nil {
			return nil, err
		}
		cLat, cLon := g.Centroid()
		radius := g.Radius()
		if radius > 0 && haversineMeters(lat, lng, cLat, cLon) <= radius {
			geofences = append(geofences, g)
		}
	}
	return geofences, rows.Err()
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
