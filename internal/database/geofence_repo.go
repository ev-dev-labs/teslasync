package database

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// GeofenceRepo provides geofence data access.
type GeofenceRepo struct {
	db *DB
}

func NewGeofenceRepo(db *DB) *GeofenceRepo {
	return &GeofenceRepo{db: db}
}

func (r *GeofenceRepo) Create(ctx context.Context, g *models.Geofence) error {
	query := `INSERT INTO geofences (name, polygon_wkt, category, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $4) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query, g.Name, g.PolygonWKT, g.Category, now).Scan(&g.ID)
}

func (r *GeofenceRepo) GetAll(ctx context.Context) ([]*models.Geofence, error) {
	query := `SELECT id, name, polygon_wkt, category, created_at, updated_at FROM geofences ORDER BY name LIMIT 500`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var geofences []*models.Geofence
	for rows.Next() {
		g := &models.Geofence{}
		if err := rows.Scan(&g.ID, &g.Name, &g.PolygonWKT, &g.Category, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		geofences = append(geofences, g)
	}
	return geofences, rows.Err()
}

func (r *GeofenceRepo) GetByID(ctx context.Context, id int64) (*models.Geofence, error) {
	query := `SELECT id, name, polygon_wkt, category, created_at, updated_at FROM geofences WHERE id=$1`
	g := &models.Geofence{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(&g.ID, &g.Name, &g.PolygonWKT, &g.Category, &g.CreatedAt, &g.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return g, err
}

func (r *GeofenceRepo) Update(ctx context.Context, g *models.Geofence) error {
	query := `UPDATE geofences SET name=$2, polygon_wkt=$3, category=$4, updated_at=$5 WHERE id=$1`
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx, query, g.ID, g.Name, g.PolygonWKT, g.Category, now)
	return err
}

func (r *GeofenceRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM geofences WHERE id=$1`, id)
	return err
}

// FindByCoordinates finds geofences containing the given point.
// Loads all geofences and filters in Go using Haversine against the
// polygon centroid + derived radius (columns removed from table).
func (r *GeofenceRepo) FindByCoordinates(ctx context.Context, lat, lng float64) ([]*models.Geofence, error) {
	query := `SELECT id, name, polygon_wkt, category, created_at, updated_at FROM geofences`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var geofences []*models.Geofence
	for rows.Next() {
		g := &models.Geofence{}
		if err := rows.Scan(&g.ID, &g.Name, &g.PolygonWKT, &g.Category, &g.CreatedAt, &g.UpdatedAt); err != nil {
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
