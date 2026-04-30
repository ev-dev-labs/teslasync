package api

import (
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SearchHandler handles global search requests across vehicles, drives, and locations.
type SearchHandler struct {
	db *database.DB
}

// NewSearchHandler creates a new SearchHandler.
func NewSearchHandler(db *database.DB) *SearchHandler {
	return &SearchHandler{db: db}
}

// Search queries vehicles, drives, and locations by a search term and returns
// combined results grouped by type.
func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) < 2 {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	ctx := r.Context()
	pattern := "%" + q + "%"
	var results []map[string]interface{}

	// Search vehicles by display_name or VIN
	rows, err := h.db.Pool.Query(ctx,
		`SELECT id, display_name, vin, model FROM vehicles
		 WHERE display_name ILIKE $1 OR vin ILIKE $1
		 LIMIT 5`, pattern)
	if err != nil {
		log.Error().Err(err).Msg("search: vehicles query failed")
	} else {
		defer rows.Close()
		for rows.Next() {
			var id int64
			var displayName, vin, model string
			if err := rows.Scan(&id, &displayName, &vin, &model); err != nil {
				continue
			}
			results = append(results, map[string]interface{}{
				"type":         "vehicle",
				"id":           id,
				"display_name": displayName,
				"vin":          vin,
				"model":        model,
			})
		}
	}

	// Search drives by start/end address
	rows2, err := h.db.Pool.Query(ctx,
		`SELECT d.id, d.start_ts, d.distance_mi,
		        COALESCE(a.display_name, '')
		 FROM drives d
		 LEFT JOIN addresses a ON d.start_address_id = a.id
		 WHERE a.display_name ILIKE $1 OR a.city ILIKE $1
		 ORDER BY d.start_ts DESC
		 LIMIT 5`, pattern)
	if err != nil {
		log.Error().Err(err).Msg("search: drives query failed")
	} else {
		defer rows2.Close()
		for rows2.Next() {
			var id int64
			var distance float64
			var startDate, addressName string
			if err := rows2.Scan(&id, &startDate, &distance, &addressName); err != nil {
				continue
			}
			results = append(results, map[string]interface{}{
				"type":       "drive",
				"id":         id,
				"start_date": startDate,
				"distance":   distance,
				"address":    addressName,
			})
		}
	}

	// Search visited locations
	rows3, err := h.db.Pool.Query(ctx,
		`SELECT vl.id, COALESCE(a.display_name, ''), vl.visit_count
		 FROM visited_locations vl
		 JOIN addresses a ON vl.address_id = a.id
		 WHERE a.display_name ILIKE $1
		 LIMIT 5`, pattern)
	if err != nil {
		log.Error().Err(err).Msg("search: locations query failed")
	} else {
		defer rows3.Close()
		for rows3.Next() {
			var id int64
			var visitCount int
			var displayName string
			if err := rows3.Scan(&id, &displayName, &visitCount); err != nil {
				continue
			}
			results = append(results, map[string]interface{}{
				"type":         "location",
				"id":           id,
				"display_name": displayName,
				"visit_count":  visitCount,
			})
		}
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	writeJSON(w, http.StatusOK, results)
}
