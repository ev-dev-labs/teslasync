package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/teslasync/teslasync/internal/models"
)

// GeofenceRepo provides geofence data access.
type GeofenceRepo struct {
	db *DB
}

func NewGeofenceRepo(db *DB) *GeofenceRepo {
	return &GeofenceRepo{db: db}
}

func (r *GeofenceRepo) Create(ctx context.Context, g *models.Geofence) error {
	query := `INSERT INTO geofences (name, latitude, longitude, radius, cost_per_kwh, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`
	now := time.Now().UTC()
	err := r.db.Pool.QueryRow(ctx, query, g.Name, g.Latitude, g.Longitude, g.Radius, g.CostPerKwh, now).Scan(&g.ID)
	if err != nil {
		return err
	}
	// Record initial rate in history if cost is set
	if g.CostPerKwh != nil {
		_, err = r.db.Pool.Exec(ctx,
			`INSERT INTO geofence_electricity_rates (geofence_id, cost_per_kwh, effective_from) VALUES ($1, $2, $3)`,
			g.ID, *g.CostPerKwh, now)
	}
	return err
}

func (r *GeofenceRepo) GetAll(ctx context.Context) ([]*models.Geofence, error) {
	query := `SELECT id, name, latitude, longitude, radius, cost_per_kwh, created_at, updated_at FROM geofences ORDER BY name`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var geofences []*models.Geofence
	for rows.Next() {
		g := &models.Geofence{}
		if err := rows.Scan(&g.ID, &g.Name, &g.Latitude, &g.Longitude, &g.Radius, &g.CostPerKwh, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		geofences = append(geofences, g)
	}
	return geofences, rows.Err()
}

func (r *GeofenceRepo) GetByID(ctx context.Context, id int64) (*models.Geofence, error) {
	query := `SELECT id, name, latitude, longitude, radius, cost_per_kwh, created_at, updated_at FROM geofences WHERE id=$1`
	g := &models.Geofence{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(&g.ID, &g.Name, &g.Latitude, &g.Longitude, &g.Radius, &g.CostPerKwh, &g.CreatedAt, &g.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return g, err
}

func (r *GeofenceRepo) Update(ctx context.Context, g *models.Geofence) error {
	now := time.Now().UTC()
	// Close the old rate period if cost changed
	_, _ = r.db.Pool.Exec(ctx,
		`UPDATE geofence_electricity_rates SET effective_to = $2 WHERE geofence_id = $1 AND effective_to IS NULL`,
		g.ID, now)
	// Insert new rate period if cost is set
	if g.CostPerKwh != nil {
		_, _ = r.db.Pool.Exec(ctx,
			`INSERT INTO geofence_electricity_rates (geofence_id, cost_per_kwh, effective_from) VALUES ($1, $2, $3)`,
			g.ID, *g.CostPerKwh, now)
	}
	query := `UPDATE geofences SET name=$2, latitude=$3, longitude=$4, radius=$5, cost_per_kwh=$6, updated_at=$7 WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, g.ID, g.Name, g.Latitude, g.Longitude, g.Radius, g.CostPerKwh, now)
	return err
}

func (r *GeofenceRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM geofences WHERE id=$1`, id)
	return err
}

// FindByCoordinates finds geofences containing the given point.
func (r *GeofenceRepo) FindByCoordinates(ctx context.Context, lat, lng float64) ([]*models.Geofence, error) {
	// Uses Haversine approximation — radius in meters
	query := `SELECT id, name, latitude, longitude, radius, cost_per_kwh, created_at, updated_at
		FROM geofences
		WHERE (6371000 * acos(
			cos(radians($1)) * cos(radians(latitude)) *
			cos(radians(longitude) - radians($2)) +
			sin(radians($1)) * sin(radians(latitude))
		)) <= radius
		ORDER BY radius ASC`
	rows, err := r.db.Pool.Query(ctx, query, lat, lng)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var geofences []*models.Geofence
	for rows.Next() {
		g := &models.Geofence{}
		if err := rows.Scan(&g.ID, &g.Name, &g.Latitude, &g.Longitude, &g.Radius, &g.CostPerKwh, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		geofences = append(geofences, g)
	}
	return geofences, rows.Err()
}
