package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// PlaceCacheEntry represents a cached geocoding result.
type PlaceCacheEntry struct {
	ID           int64     `json:"id"`
	Latitude     float64   `json:"latitude"`
	Longitude    float64   `json:"longitude"`
	DisplayName  string    `json:"display_name"`
	Source       string    `json:"source"`
	PlaceID      *string   `json:"place_id,omitempty"`
	BusinessName *string   `json:"business_name,omitempty"`
	Category     *string   `json:"category,omitempty"`
	City         *string   `json:"city,omitempty"`
	State        *string   `json:"state,omitempty"`
	Country      *string   `json:"country,omitempty"`
	Postcode     *string   `json:"postcode,omitempty"`
	HitCount     int       `json:"hit_count"`
	LastUsedAt   time.Time `json:"last_used_at"`
	CreatedAt    time.Time `json:"created_at"`
}

// PlacesCacheRepo provides place cache data access.
type PlacesCacheRepo struct {
	pool adminPool
}

func NewPlacesCacheRepo(db *database.DB) *PlacesCacheRepo {
	return &PlacesCacheRepo{pool: db.Pool}
}

// FindNearby finds a cached place within radiusMeters of the given coordinates.
// Uses the Haversine formula. Returns nil if no match found.
func (r *PlacesCacheRepo) FindNearby(ctx context.Context, lat, lon float64, radiusMeters float64) (*PlaceCacheEntry, error) {
	query := `
		SELECT id, latitude, longitude, display_name, source, place_id,
		       business_name, category, city, state, country, postcode,
		       hit_count, last_used_at, created_at
		FROM places_cache
		WHERE (6371000 * acos(
			LEAST(1.0, cos(radians($1)) * cos(radians(latitude)) *
			cos(radians(longitude) - radians($2)) +
			sin(radians($1)) * sin(radians(latitude)))
		)) <= $3
		ORDER BY last_used_at DESC
		LIMIT 1`

	entry := &PlaceCacheEntry{}
	err := r.pool.QueryRow(ctx, query, lat, lon, radiusMeters).Scan(
		&entry.ID, &entry.Latitude, &entry.Longitude, &entry.DisplayName,
		&entry.Source, &entry.PlaceID, &entry.BusinessName, &entry.Category,
		&entry.City, &entry.State, &entry.Country, &entry.Postcode,
		&entry.HitCount, &entry.LastUsedAt, &entry.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("places_cache find_nearby: %w", err)
	}
	return entry, nil
}

// Upsert inserts or updates a place cache entry. If a nearby entry already
// exists (within 50m), updates it instead of creating a duplicate.
func (r *PlacesCacheRepo) Upsert(ctx context.Context, entry *PlaceCacheEntry) error {
	existing, err := r.FindNearby(ctx, entry.Latitude, entry.Longitude, 50)
	if err != nil {
		return fmt.Errorf("places_cache upsert find_nearby: %w", err)
	}

	if existing != nil {
		_, err = r.pool.Exec(ctx, `
			UPDATE places_cache
			SET display_name = $2, source = $3, place_id = $4, business_name = $5,
			    category = $6, city = $7, state = $8, country = $9, postcode = $10,
			    hit_count = hit_count + 1, last_used_at = NOW()
			WHERE id = $1`,
			existing.ID, entry.DisplayName, entry.Source, entry.PlaceID,
			entry.BusinessName, entry.Category, entry.City, entry.State,
			entry.Country, entry.Postcode)
		if err != nil {
			return fmt.Errorf("places_cache upsert update: %w", err)
		}
		return nil
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO places_cache (latitude, longitude, display_name, source, place_id,
		    business_name, category, city, state, country, postcode)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		entry.Latitude, entry.Longitude, entry.DisplayName, entry.Source,
		entry.PlaceID, entry.BusinessName, entry.Category, entry.City,
		entry.State, entry.Country, entry.Postcode)
	if err != nil {
		return fmt.Errorf("places_cache upsert insert: %w", err)
	}
	return nil
}

// IncrementHitCount bumps the hit counter and last_used_at timestamp.
func (r *PlacesCacheRepo) IncrementHitCount(ctx context.Context, id int64) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE places_cache SET hit_count = hit_count + 1, last_used_at = NOW() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("places_cache increment_hit_count: %w", err)
	}
	return nil
}

// TopPlaces returns the most frequently visited places.
func (r *PlacesCacheRepo) TopPlaces(ctx context.Context, limit int) ([]*PlaceCacheEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, latitude, longitude, display_name, source, place_id,
		       business_name, category, city, state, country, postcode,
		       hit_count, last_used_at, created_at
		FROM places_cache
		ORDER BY hit_count DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("places_cache top_places query: %w", err)
	}
	defer rows.Close()

	var entries []*PlaceCacheEntry
	for rows.Next() {
		e := &PlaceCacheEntry{}
		if err := rows.Scan(
			&e.ID, &e.Latitude, &e.Longitude, &e.DisplayName,
			&e.Source, &e.PlaceID, &e.BusinessName, &e.Category,
			&e.City, &e.State, &e.Country, &e.Postcode,
			&e.HitCount, &e.LastUsedAt, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("places_cache top_places scan: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("places_cache top_places iter: %w", err)
	}
	return entries, nil
}

// Cleanup removes entries not used in the given duration.
func (r *PlacesCacheRepo) Cleanup(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM places_cache WHERE last_used_at < $1`, time.Now().Add(-olderThan))
	if err != nil {
		return 0, fmt.Errorf("places_cache cleanup: %w", err)
	}
	return tag.RowsAffected(), nil
}
