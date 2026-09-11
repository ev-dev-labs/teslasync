package waitoracle

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Site is one named charging location from fleet history.
type Site struct {
	Name        string    `json:"name"`
	Sessions    int       `json:"sessions"`
	Lat         float64   `json:"lat"`
	Lng         float64   `json:"lng"`
	LastSession time.Time `json:"last_session"`
}

// Store reads fleet charging history for the oracle. Read-only: no
// migration, no writes. Panics on nil db (fail-fast wiring). Safe for
// concurrent use (pgx pool).
type Store struct {
	db  *database.DB
	now func() time.Time
}

// NewStore wires the store.
func NewStore(db *database.DB) *Store {
	if db == nil {
		panic("waitoracle: nil db")
	}
	return &Store{db: db, now: time.Now}
}

// ListSites returns named sites ordered by session count. Query filters
// by case-insensitive substring. Limit clamped 1..200.
func (s *Store) ListSites(ctx context.Context, q string, limit int) ([]*Site, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.db.Pool.Query(ctx, `
		SELECT site_location_name, COUNT(*),
			COALESCE(AVG(latitude), 0), COALESCE(AVG(longitude), 0),
			MAX(charge_start_datetime)
		FROM tesla_charging_sessions
		WHERE site_location_name <> '' AND ($1 = '' OR site_location_name ILIKE '%' || $1 || '%')
		GROUP BY site_location_name
		ORDER BY COUNT(*) DESC
		LIMIT $2`, q, limit)
	if err != nil {
		return nil, fmt.Errorf("waitoracle: list sites: %w", err)
	}
	defer rows.Close()
	out := []*Site{}
	for rows.Next() {
		site := &Site{}
		if err := rows.Scan(&site.Name, &site.Sessions, &site.Lat, &site.Lng, &site.LastSession); err != nil {
			return nil, fmt.Errorf("waitoracle: scan site: %w", err)
		}
		out = append(out, site)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("waitoracle: list sites: %w", err)
	}
	return out, nil
}

// History loads the demand aggregates + session spans for one site over
// the trailing history window.
func (s *Store) History(ctx context.Context, site string) (SiteHistory, error) {
	h := SiteHistory{Site: site}
	if site == "" {
		return h, ErrNoHistory
	}
	since := s.now().UTC().AddDate(0, 0, -historyWeeks*7)

	var count int
	var minStart, maxStart time.Time
	err := s.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(MIN(charge_start_datetime), now()), COALESCE(MAX(charge_start_datetime), now())
		FROM tesla_charging_sessions
		WHERE site_location_name = $1 AND charge_start_datetime >= $2`, site, since,
	).Scan(&count, &minStart, &maxStart)
	if err != nil {
		return h, fmt.Errorf("waitoracle: site stats: %w", err)
	}
	if count < minSiteSessions {
		return h, ErrNoHistory
	}
	h.Sessions = count
	h.Weeks = max(maxStart.Sub(minStart).Hours()/24/7, 1)

	rows, err := s.db.Pool.Query(ctx, `
		SELECT EXTRACT(DOW FROM charge_start_datetime)::int,
			EXTRACT(HOUR FROM charge_start_datetime)::int,
			COUNT(*),
			COUNT(*) FILTER (WHERE COALESCE(congestion_fee, 0) > 0)
		FROM tesla_charging_sessions
		WHERE site_location_name = $1 AND charge_start_datetime >= $2
		GROUP BY 1, 2`, site, since)
	if err != nil {
		return h, fmt.Errorf("waitoracle: demand: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var b Bucket
		if err := rows.Scan(&b.Weekday, &b.Hour, &b.Starts, &b.Congested); err != nil {
			return h, fmt.Errorf("waitoracle: scan demand: %w", err)
		}
		h.Buckets = append(h.Buckets, b)
	}
	if err := rows.Err(); err != nil {
		return h, fmt.Errorf("waitoracle: demand: %w", err)
	}

	spanRows, err := s.db.Pool.Query(ctx, `
		SELECT charge_start_datetime, COALESCE(charge_stop_datetime, charge_start_datetime)
		FROM tesla_charging_sessions
		WHERE site_location_name = $1 AND charge_start_datetime >= $2
		ORDER BY charge_start_datetime DESC
		LIMIT $3`, site, since, maxHistoryRows)
	if err != nil {
		return h, fmt.Errorf("waitoracle: spans: %w", err)
	}
	defer spanRows.Close()
	for spanRows.Next() {
		var sp Session
		if err := spanRows.Scan(&sp.Start, &sp.Stop); err != nil {
			return h, fmt.Errorf("waitoracle: scan span: %w", err)
		}
		h.Spans = append(h.Spans, sp)
	}
	if err := spanRows.Err(); err != nil {
		return h, fmt.Errorf("waitoracle: spans: %w", err)
	}
	if len(h.Spans) == 0 {
		return h, ErrNoHistory
	}
	return h, nil
}
