package api

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SearchHit is one entity result returned by the global /search endpoint.
//
// Score is server-computed in [0, ~1.7] (exact-id match + prefix bonus +
// recency bonus). The frontend should only sort by Score for grouping; it
// MUST NOT compute its own score because the inputs (column-level matches,
// row id, recency) are not all returned.
//
// URL is always an app-relative path (e.g. "/drives/42"). The frontend
// navigates via react-router; absolute or scheme-bearing URLs are never
// emitted by this handler.
type SearchHit struct {
	Type     string     `json:"type"`
	ID       int64      `json:"id"`
	Title    string     `json:"title"`
	Subtitle string     `json:"subtitle,omitempty"`
	URL      string     `json:"url"`
	Score    float64    `json:"score"`
	When     *time.Time `json:"when,omitempty"`
}

// SearchType identifiers — kept as exported constants so the test file and
// the router (filter parsing) share the same string literals.
const (
	SearchTypeVehicle      = "vehicle"
	SearchTypeDrive        = "drive"
	SearchTypeCharging     = "charging"
	SearchTypeAlert        = "alert"
	SearchTypeNotification = "notification"
	SearchTypeGeofence     = "geofence"
	SearchTypeAutomation   = "automation"
	SearchTypeLocation     = "location"
	SearchTypeTrip         = "trip"
)

// allSearchTypes is the canonical set used when the request omits ?types=.
var allSearchTypes = []string{
	SearchTypeVehicle,
	SearchTypeDrive,
	SearchTypeCharging,
	SearchTypeAlert,
	SearchTypeNotification,
	SearchTypeGeofence,
	SearchTypeAutomation,
	SearchTypeLocation,
	SearchTypeTrip,
}

// Searcher is the port that SearchHandler depends on. The production wiring
// uses pgSearcher (backed by *database.DB); tests substitute a fake to
// exercise handler logic without a real Postgres pool.
//
// Each method takes the trimmed query string, an optional numeric ID parsed
// from the query (-1 when the query did not parse as an int64), and a
// per-type limit. Implementations MUST honor ctx for cancellation/timeout.
type Searcher interface {
	SearchVehicles(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchDrives(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchCharging(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchAlerts(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchNotifications(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchGeofences(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchAutomations(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchLocations(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
	SearchTrips(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error)
}

// SearchHandler exposes the unified entity-search endpoint
// (GET /api/v1/search). See router.go for rate limiting and mount path.
type SearchHandler struct {
	s Searcher
}

// NewSearchHandler constructs a SearchHandler backed by the production
// Postgres-backed Searcher (pgSearcher).
func NewSearchHandler(db *database.DB) *SearchHandler {
	return &SearchHandler{s: newPGSearcher(db)}
}

// NewSearchHandlerWithSearcher is the test seam: handler tests inject a
// stubbed Searcher to exercise the fan-out, ranking, and capping logic
// without requiring a Postgres pool.
func NewSearchHandlerWithSearcher(s Searcher) *SearchHandler {
	return &SearchHandler{s: s}
}

// per-type and global limits used to bound result sets.
const (
	defaultPerTypeLimit = 5
	maxPerTypeLimit     = 25
	maxTotalHits        = 225 // = 9 types * maxPerTypeLimit
	searchTimeout       = 3 * time.Second
	minQueryRunes       = 2
)

// Search handles GET /api/v1/search?q=...&types=...&limit=N.
//
// Returns 200 with `{ hits: [], query: "..." }` whenever the query is
// shorter than minQueryRunes — the frontend treats this as an empty
// state, not an error, so the palette can issue requests speculatively
// without surfacing 4xx flickers in DevTools.
func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))

	// Empty / too-short queries: return empty hits with a 200 so the
	// palette can poll without churning error states.
	if utf8.RuneCountInString(q) < minQueryRunes {
		writeJSON(w, http.StatusOK, map[string]any{"hits": []SearchHit{}, "query": q})
		return
	}

	requestedTypes := parseTypesFilter(r.URL.Query().Get("types"))
	perTypeLimit := parseSearchLimit(r.URL.Query().Get("limit"))

	// idHint is -1 when q is not a parsable int64 — sub-searches use it
	// to apply an exact-ID match bonus when relevant.
	idHint := int64(-1)
	if v, err := strconv.ParseInt(q, 10, 64); err == nil {
		idHint = v
	}

	ctx, cancel := context.WithTimeout(r.Context(), searchTimeout)
	defer cancel()

	hits := h.runSubSearches(ctx, q, idHint, perTypeLimit, requestedTypes)
	rankAndCap(hits, maxTotalHits)
	if len(hits) > maxTotalHits {
		hits = hits[:maxTotalHits]
	}

	writeJSON(w, http.StatusOK, map[string]any{"hits": hits, "query": q})
}

// runSubSearches fans out one goroutine per requested entity type and
// collects partial successes. A failed sub-search is logged and skipped
// — never propagated to the response — so a single broken table never
// blanks out the entire palette.
func (h *SearchHandler) runSubSearches(ctx context.Context, q string, idHint int64, limit int, types map[string]struct{}) []SearchHit {
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		results []SearchHit
	)

	run := func(name string, fn func(context.Context, string, int64, int) ([]SearchHit, error)) {
		if _, ok := types[name]; !ok {
			return
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := fn(ctx, q, idHint, limit)
			if err != nil {
				if ctx.Err() == nil {
					log.Warn().Err(err).Str("type", name).Msg("search: sub-query failed")
				}
				return
			}
			mu.Lock()
			results = append(results, res...)
			mu.Unlock()
		}()
	}

	run(SearchTypeVehicle, h.s.SearchVehicles)
	run(SearchTypeDrive, h.s.SearchDrives)
	run(SearchTypeCharging, h.s.SearchCharging)
	run(SearchTypeAlert, h.s.SearchAlerts)
	run(SearchTypeNotification, h.s.SearchNotifications)
	run(SearchTypeGeofence, h.s.SearchGeofences)
	run(SearchTypeAutomation, h.s.SearchAutomations)
	run(SearchTypeLocation, h.s.SearchLocations)
	run(SearchTypeTrip, h.s.SearchTrips)

	wg.Wait()
	return results
}

// rankAndCap sorts hits in-place by (Score DESC, When DESC, Type, Title, ID)
// so identical-score results render deterministically across requests.
//
// The maxTotalHits trim is applied by the caller — keeping the slicing
// outside of this function makes it trivially testable in isolation.
func rankAndCap(hits []SearchHit, _ int) {
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Score != hits[j].Score {
			return hits[i].Score > hits[j].Score
		}
		// Recency tie-breaker: newer first when both have timestamps.
		switch {
		case hits[i].When != nil && hits[j].When != nil && !hits[i].When.Equal(*hits[j].When):
			return hits[i].When.After(*hits[j].When)
		case hits[i].When != nil && hits[j].When == nil:
			return true
		case hits[i].When == nil && hits[j].When != nil:
			return false
		}
		// Deterministic fallbacks so goroutine append order does not leak
		// into the response.
		if hits[i].Type != hits[j].Type {
			return hits[i].Type < hits[j].Type
		}
		if hits[i].Title != hits[j].Title {
			return hits[i].Title < hits[j].Title
		}
		return hits[i].ID < hits[j].ID
	})
}

// parseTypesFilter converts "vehicle,drive" into a set. An empty string
// (or a string that contains only whitespace and commas) means "search
// every supported type" — never an empty set.
func parseTypesFilter(raw string) map[string]struct{} {
	out := make(map[string]struct{}, len(allSearchTypes))
	parts := strings.Split(raw, ",")
	any := false
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out[p] = struct{}{}
		any = true
	}
	if !any {
		for _, t := range allSearchTypes {
			out[t] = struct{}{}
		}
	}
	return out
}

// parseSearchLimit clamps the per-type LIMIT to [1, maxPerTypeLimit] and
// falls back to defaultPerTypeLimit on garbage input.
func parseSearchLimit(raw string) int {
	if raw == "" {
		return defaultPerTypeLimit
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return defaultPerTypeLimit
	}
	if v > maxPerTypeLimit {
		return maxPerTypeLimit
	}
	return v
}

// recencyBonus returns a score uplift for hits that happened recently.
// Returns 0 for static / never-timed entities (where ts is the zero value)
// and decays linearly from 0.2 at "now" to 0 at +7 days old.
func recencyBonus(ts time.Time, now time.Time) float64 {
	if ts.IsZero() {
		return 0
	}
	age := now.Sub(ts)
	if age < 0 {
		age = 0
	}
	const window = 7 * 24 * time.Hour
	if age >= window {
		return 0
	}
	return 0.2 * (1.0 - float64(age)/float64(window))
}

// scoreText is the canonical ranking expression used by sub-searches.
// Mirrors the SQL ranking applied per row (exact-id 1.0 + prefix 0.5 +
// contains 0.2) plus an optional recency bonus.
//
// idMatch is true when the row's id == idHint (the q-parsed int64).
func scoreText(title, q string, idMatch bool, ts time.Time, now time.Time) float64 {
	score := 0.0
	if idMatch {
		score += 1.0
	}
	lowerTitle := strings.ToLower(title)
	lowerQ := strings.ToLower(q)
	if lowerQ != "" && strings.HasPrefix(lowerTitle, lowerQ) {
		score += 0.5
	} else if lowerQ != "" && strings.Contains(lowerTitle, lowerQ) {
		score += 0.2
	}
	score += recencyBonus(ts, now)
	return score
}

// pgSearcher is the production Searcher implementation. Each sub-query is
// a small ILIKE scan capped per type; new tables can be added by writing
// one method here and wiring it into runSubSearches.
type pgSearcher struct {
	db *database.DB
}

func newPGSearcher(db *database.DB) *pgSearcher {
	return &pgSearcher{db: db}
}

// scanQueryRows is a tiny helper that runs the supplied query and lets the
// caller decode each pgx.Row into a SearchHit. Errors during a single row
// scan log + skip; only outer query / iteration errors propagate.
func (p *pgSearcher) scanQueryRows(ctx context.Context, sql string, args []any, fn func(pgx.Rows) (SearchHit, bool, error)) ([]SearchHit, error) {
	rows, err := p.db.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SearchHit, 0, 8)
	for rows.Next() {
		hit, ok, err := fn(rows)
		if err != nil {
			log.Debug().Err(err).Msg("search: row scan failed")
			continue
		}
		if !ok {
			continue
		}
		out = append(out, hit)
	}
	return out, rows.Err()
}

// likePattern wraps the user's query in '%' bookends for ILIKE matching.
// Postgres handles parameter binding so no escaping is required.
func likePattern(q string) string { return "%" + q + "%" }

// prefixPattern is used to give first-character matches a higher rank.
func prefixPattern(q string) string { return q + "%" }

func (p *pgSearcher) SearchVehicles(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	const sql = `
		SELECT id, display_name, COALESCE(model, ''), COALESCE(vin, ''),
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN display_name ILIKE $2 THEN 0.5
		               WHEN display_name ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM vehicles
		WHERE archived_at IS NULL
		  AND (display_name ILIKE $1 OR vin ILIKE $1 OR COALESCE(model, '') ILIKE $1)
		ORDER BY rank DESC, display_name ASC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id            int64
			displayName   string
			model         string
			vin           string
			rank          float64
		)
		if err := rows.Scan(&id, &displayName, &model, &vin, &rank); err != nil {
			return SearchHit{}, false, err
		}
		title := displayName
		if title == "" {
			title = vin
		}
		sub := strings.TrimSpace(strings.Join(filterEmpty(model, maskedVIN(vin)), " · "))
		return SearchHit{
			Type:     SearchTypeVehicle,
			ID:       id,
			Title:    title,
			Subtitle: sub,
			URL:      "/vehicles/" + strconv.FormatInt(id, 10),
			Score:    rank,
		}, true, nil
	})
}

func (p *pgSearcher) SearchDrives(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	// Phase-42 (Prompt 0076): SI canonical drives schema (migration 000172).
	// start_address/end_address → start_place/end_place. start_ts → started_at.
	// distance_mi → distance_m / 1609.344 (display still in miles).
	const sql = `
		SELECT id, vehicle_id, started_at,
		       COALESCE(start_place, ''), COALESCE(end_place, ''),
		       COALESCE(distance_m, 0) / 1609.344 AS distance_mi,
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN COALESCE(start_place,'') ILIKE $2
		                 OR COALESCE(end_place,'')   ILIKE $2 THEN 0.5
		               WHEN COALESCE(start_place,'') ILIKE $1
		                 OR COALESCE(end_place,'')   ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM drives
		WHERE id = $4
		   OR COALESCE(start_place, '') ILIKE $1
		   OR COALESCE(end_place, '')   ILIKE $1
		ORDER BY rank DESC, started_at DESC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	now := time.Now().UTC()
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id, vehicleID int64
			startTs       time.Time
			startAddr     string
			endAddr       string
			distance      float64
			rank          float64
		)
		if err := rows.Scan(&id, &vehicleID, &startTs, &startAddr, &endAddr, &distance, &rank); err != nil {
			return SearchHit{}, false, err
		}
		title := driveTitle(id, startAddr, endAddr)
		when := startTs
		return SearchHit{
			Type:     SearchTypeDrive,
			ID:       id,
			Title:    title,
			Subtitle: startTs.Format("2006-01-02 15:04") + " · " + strconv.FormatFloat(distance, 'f', 1, 64) + " mi",
			URL:      "/drives/" + strconv.FormatInt(id, 10),
			When:     &when,
			Score:    rank + recencyBonus(startTs, now),
		}, true, nil
	})
}

func (p *pgSearcher) SearchCharging(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	// Phase-42 (Prompt 0076): SI canonical charging_sessions schema
	// (migration 000171). charger_location → start_place. start_ts → started_at.
	const sql = `
		SELECT id, vehicle_id, started_at, COALESCE(start_place, ''), COALESCE(charger_type, ''),
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN COALESCE(start_place,'') ILIKE $2 THEN 0.5
		               WHEN COALESCE(start_place,'') ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM charging_sessions
		WHERE id = $4 OR COALESCE(start_place, '') ILIKE $1
		ORDER BY rank DESC, started_at DESC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	now := time.Now().UTC()
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id, vehicleID int64
			startTs       time.Time
			loc           string
			chargerType   string
			rank          float64
		)
		if err := rows.Scan(&id, &vehicleID, &startTs, &loc, &chargerType, &rank); err != nil {
			return SearchHit{}, false, err
		}
		title := loc
		if title == "" {
			title = "Charging session #" + strconv.FormatInt(id, 10)
		}
		when := startTs
		return SearchHit{
			Type:     SearchTypeCharging,
			ID:       id,
			Title:    title,
			Subtitle: strings.TrimSpace(chargerType + " · " + startTs.Format("2006-01-02 15:04")),
			URL:      "/charging/" + strconv.FormatInt(id, 10),
			When:     &when,
			Score:    rank + recencyBonus(startTs, now),
		}, true, nil
	})
}

func (p *pgSearcher) SearchAlerts(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	const sql = `
		SELECT id, name, COALESCE(description, ''), signal_name, severity, created_at,
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN name ILIKE $2 OR signal_name ILIKE $2 THEN 0.5
		               WHEN name ILIKE $1 OR COALESCE(description,'') ILIKE $1
		                 OR signal_name ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM alert_rules
		WHERE id = $4
		   OR name ILIKE $1
		   OR COALESCE(description, '') ILIKE $1
		   OR signal_name ILIKE $1
		ORDER BY rank DESC, updated_at DESC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	now := time.Now().UTC()
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id         int64
			name       string
			desc       string
			signalName string
			severity   string
			createdAt  time.Time
			rank       float64
		)
		if err := rows.Scan(&id, &name, &desc, &signalName, &severity, &createdAt, &rank); err != nil {
			return SearchHit{}, false, err
		}
		when := createdAt
		return SearchHit{
			Type:     SearchTypeAlert,
			ID:       id,
			Title:    name,
			Subtitle: strings.TrimSpace(severity + " · " + signalName),
			// Alert Studio is the rule editor; passing ?ruleId=N lets the
			// page deep-select once it grows that param. Plain /alert-studio
			// is a useful fallback today.
			URL:   "/alert-studio?ruleId=" + strconv.FormatInt(id, 10),
			When:  &when,
			Score: rank + recencyBonus(createdAt, now),
		}, true, nil
	})
}

func (p *pgSearcher) SearchNotifications(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	const sql = `
		SELECT id, ts, title, body, severity,
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN title ILIKE $2 THEN 0.5
		               WHEN title ILIKE $1 OR body ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM notifications
		WHERE id = $4 OR title ILIKE $1 OR body ILIKE $1
		ORDER BY rank DESC, ts DESC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	now := time.Now().UTC()
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id       int64
			ts       time.Time
			title    string
			body     string
			severity string
			rank     float64
		)
		if err := rows.Scan(&id, &ts, &title, &body, &severity, &rank); err != nil {
			return SearchHit{}, false, err
		}
		when := ts
		return SearchHit{
			Type:     SearchTypeNotification,
			ID:       id,
			Title:    title,
			Subtitle: strings.TrimSpace(severity + " · " + truncate(body, 80)),
			URL:      "/notifications?id=" + strconv.FormatInt(id, 10),
			When:     &when,
			Score:    rank + recencyBonus(ts, now),
		}, true, nil
	})
}

func (p *pgSearcher) SearchGeofences(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	const sql = `
		SELECT id, name, COALESCE(category, ''), updated_at,
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN name ILIKE $2 THEN 0.5
		               WHEN name ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM geofences
		WHERE id = $4 OR name ILIKE $1
		ORDER BY rank DESC, name ASC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id        int64
			name      string
			category  string
			updatedAt time.Time
			rank      float64
		)
		if err := rows.Scan(&id, &name, &category, &updatedAt, &rank); err != nil {
			return SearchHit{}, false, err
		}
		return SearchHit{
			Type:     SearchTypeGeofence,
			ID:       id,
			Title:    name,
			Subtitle: category,
			URL:      "/geofences?id=" + strconv.FormatInt(id, 10),
			Score:    rank,
		}, true, nil
	})
}

func (p *pgSearcher) SearchAutomations(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	const sql = `
		SELECT id, name, COALESCE(description, ''), enabled, updated_at,
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN name ILIKE $2 THEN 0.5
		               WHEN name ILIKE $1 OR COALESCE(description,'') ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM automations
		WHERE id = $4 OR name ILIKE $1 OR COALESCE(description, '') ILIKE $1
		ORDER BY rank DESC, name ASC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id        int64
			name      string
			desc      string
			enabled   bool
			updatedAt time.Time
			rank      float64
		)
		if err := rows.Scan(&id, &name, &desc, &enabled, &updatedAt, &rank); err != nil {
			return SearchHit{}, false, err
		}
		state := "disabled"
		if enabled {
			state = "enabled"
		}
		return SearchHit{
			Type:     SearchTypeAutomation,
			ID:       id,
			Title:    name,
			Subtitle: strings.TrimSpace(state + " · " + truncate(desc, 80)),
			URL:      "/automations/" + strconv.FormatInt(id, 10) + "/edit",
			Score:    rank,
		}, true, nil
	})
}

func (p *pgSearcher) SearchLocations(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	// Phase-42 (Prompt 0076 covenant #11): the visited_locations and addresses
	// tables are dropped without a recreate. Locations are now derived from
	// drives by grouping on end_place. Synthetic IDs come from MIN(id) so a
	// /locations?id=N URL still resolves to a real underlying drive row.
	const sql = `
		SELECT MIN(id) AS id,
		       end_place AS display_name,
		       COUNT(*) AS visit_count,
		       MAX(ended_at) AS last_visited,
		       (CASE WHEN MIN(id) = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN end_place ILIKE $2 THEN 0.5
		               WHEN end_place ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM drives
		WHERE end_place IS NOT NULL AND end_place != ''
		  AND (id = $4 OR end_place ILIKE $1)
		GROUP BY end_place
		ORDER BY rank DESC, visit_count DESC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	now := time.Now().UTC()
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id          int64
			displayName string
			visitCount  int
			lastVisited *time.Time
			rank        float64
		)
		if err := rows.Scan(&id, &displayName, &visitCount, &lastVisited, &rank); err != nil {
			return SearchHit{}, false, err
		}
		title := displayName
		if title == "" {
			title = "Location #" + strconv.FormatInt(id, 10)
		}
		var when *time.Time
		var bonus float64
		if lastVisited != nil {
			lv := *lastVisited
			when = &lv
			bonus = recencyBonus(lv, now)
		}
		return SearchHit{
			Type:     SearchTypeLocation,
			ID:       id,
			Title:    title,
			Subtitle: strconv.Itoa(visitCount) + " visits",
			URL:      "/locations?id=" + strconv.FormatInt(id, 10),
			When:     when,
			Score:    rank + bonus,
		}, true, nil
	})
}

func (p *pgSearcher) SearchTrips(ctx context.Context, q string, idHint int64, limit int) ([]SearchHit, error) {
	// Phase-42 (Prompt 0076): trips description column was renamed to notes
	// (migration 000172). start_ts → started_at.
	const sql = `
		SELECT id, name, COALESCE(notes, ''), started_at,
		       (CASE WHEN id = $4 THEN 1.0 ELSE 0.0 END
		        + CASE WHEN name ILIKE $2 THEN 0.5
		               WHEN name ILIKE $1 OR COALESCE(notes,'') ILIKE $1 THEN 0.2 ELSE 0.0 END) AS rank
		FROM trips
		WHERE id = $4 OR name ILIKE $1 OR COALESCE(notes, '') ILIKE $1
		ORDER BY rank DESC, started_at DESC
		LIMIT $3`
	args := []any{likePattern(q), prefixPattern(q), limit, idHint}
	now := time.Now().UTC()
	return p.scanQueryRows(ctx, sql, args, func(rows pgx.Rows) (SearchHit, bool, error) {
		var (
			id      int64
			name    string
			desc    string
			startTs time.Time
			rank    float64
		)
		if err := rows.Scan(&id, &name, &desc, &startTs, &rank); err != nil {
			return SearchHit{}, false, err
		}
		when := startTs
		return SearchHit{
			Type:     SearchTypeTrip,
			ID:       id,
			Title:    name,
			Subtitle: strings.TrimSpace(startTs.Format("2006-01-02") + " · " + truncate(desc, 80)),
			URL:      "/trips/" + strconv.FormatInt(id, 10),
			When:     &when,
			Score:    rank + recencyBonus(startTs, now),
		}, true, nil
	})
}

// driveTitle composes a human-readable label for a Drive hit, falling
// back through (start→end) → (start) → (#id) until something printable
// is available. Address columns can be NULL during ingestion when
// reverse geocoding hasn't completed yet.
func driveTitle(id int64, startAddr, endAddr string) string {
	switch {
	case startAddr != "" && endAddr != "" && startAddr != endAddr:
		return startAddr + " → " + endAddr
	case startAddr != "":
		return startAddr
	case endAddr != "":
		return endAddr
	default:
		return "Drive #" + strconv.FormatInt(id, 10)
	}
}

// truncate returns the first n runes of s with an ellipsis when the
// original was longer. Used to keep subtitles short in result rows.
func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	count := 0
	for i := range s {
		if count == n {
			return s[:i] + "…"
		}
		count++
	}
	return s
}

// filterEmpty drops any zero-length elements from the input. Used by
// subtitle composition where some columns may be NULL.
func filterEmpty(xs ...string) []string {
	out := make([]string, 0, len(xs))
	for _, s := range xs {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

// maskedVIN returns the last 4 characters of a VIN — the full VIN can
// identify a vehicle uniquely, so we never include it raw in subtitles.
func maskedVIN(vin string) string {
	if vin == "" {
		return ""
	}
	if len(vin) <= 4 {
		return vin
	}
	return "VIN ····" + vin[len(vin)-4:]
}
