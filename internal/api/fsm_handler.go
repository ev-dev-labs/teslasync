package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// FSMHandler serves the FSM debugger endpoints.
type FSMHandler struct {
	db *database.DB
}

// NewFSMHandler creates a new FSM debugger handler.
func NewFSMHandler(db *database.DB) *FSMHandler {
	return &FSMHandler{db: db}
}

// fsmTransitionDTO is the API response shape with snake_case JSON tags.
type fsmTransitionDTO struct {
	ID        string `json:"id"`
	EntityID  string `json:"entity_id"`
	FSMName   string `json:"fsm_name"`
	FromState string `json:"from_state"`
	ToState   string `json:"to_state"`
	Event     string `json:"event"`
	CreatedAt string `json:"created_at"`
}

// Stats returns aggregate FSM transition counts per fsm_name for an entity.
// GET /fsm/stats?vehicle_id=X
func (h *FSMHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID := r.URL.Query().Get("vehicle_id")

	ctx := r.Context()

	// Build query based on whether vehicle_id is provided
	var query string
	var args []interface{}
	if vehicleID != "" {
		query = `SELECT fsm_name, COUNT(*) FROM fsm_transitions WHERE entity_id = $1 GROUP BY fsm_name ORDER BY COUNT(*) DESC`
		args = []interface{}{vehicleID}
	} else {
		query = `SELECT fsm_name, COUNT(*) FROM fsm_transitions GROUP BY fsm_name ORDER BY COUNT(*) DESC`
	}

	rows, err := h.db.Pool.Query(ctx, query, args...)
	if err != nil {
		log.Error().Err(err).Str("handler", "FSMStats").Msg("failed to query FSM stats")
		writeError(w, http.StatusInternalServerError, "failed to query FSM stats")
		return
	}
	defer rows.Close()

	stats := make(map[string]int)
	for rows.Next() {
		var name string
		var count int
		if err := rows.Scan(&name, &count); err != nil {
			log.Error().Err(err).Msg("failed to scan FSM stats row")
			continue
		}
		stats[name] = count
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("FSM stats row iteration error")
		writeError(w, http.StatusInternalServerError, "failed to read FSM stats")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled": true,
		"stats":   stats,
	})
}

// Transitions returns a paginated, filtered list of FSM transitions.
// GET /fsm/transitions?vehicle_id=X&fsm_type=Y&hours=H&page=P&per_page=N
func (h *FSMHandler) Transitions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	vehicleID := q.Get("vehicle_id")
	fsmType := q.Get("fsm_type")

	hours, _ := strconv.Atoi(q.Get("hours"))
	if hours <= 0 {
		hours = 1
	}
	if hours > 168 { // cap at 7 days
		hours = 168
	}

	page, _ := strconv.Atoi(q.Get("page"))
	if page <= 0 {
		page = 1
	}

	perPage, _ := strconv.Atoi(q.Get("per_page"))
	if perPage <= 0 {
		perPage = 50
	}
	if perPage > 500 {
		perPage = 500
	}

	since := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)
	offset := (page - 1) * perPage
	ctx := r.Context()

	// Build WHERE clauses dynamically
	where := "WHERE created_at >= $1"
	args := []interface{}{since}
	argIdx := 2

	if vehicleID != "" {
		where += " AND entity_id = $" + strconv.Itoa(argIdx)
		args = append(args, vehicleID)
		argIdx++
	}

	if fsmType != "" && fsmType != "all" {
		where += " AND fsm_name = $" + strconv.Itoa(argIdx)
		args = append(args, fsmType)
		argIdx++
	}

	// Count total matching rows
	countQuery := "SELECT COUNT(*) FROM fsm_transitions " + where
	var total int
	if err := h.db.Pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		log.Error().Err(err).Str("handler", "FSMTransitions").Msg("failed to count transitions")
		writeError(w, http.StatusInternalServerError, "failed to count transitions")
		return
	}

	// Fetch paginated rows
	dataQuery := "SELECT id, entity_id, fsm_name, from_state, event, to_state, created_at FROM fsm_transitions " +
		where + " ORDER BY created_at DESC LIMIT $" + strconv.Itoa(argIdx) + " OFFSET $" + strconv.Itoa(argIdx+1)
	args = append(args, perPage, offset)

	rows, err := h.db.Pool.Query(ctx, dataQuery, args...)
	if err != nil {
		log.Error().Err(err).Str("handler", "FSMTransitions").Msg("failed to query transitions")
		writeError(w, http.StatusInternalServerError, "failed to query transitions")
		return
	}
	defer rows.Close()

	var transitions []fsmTransitionDTO
	for rows.Next() {
		var dto fsmTransitionDTO
		var createdAt time.Time
		if err := rows.Scan(&dto.ID, &dto.EntityID, &dto.FSMName, &dto.FromState, &dto.Event, &dto.ToState, &createdAt); err != nil {
			if err == pgx.ErrNoRows {
				break
			}
			log.Error().Err(err).Msg("failed to scan transition row")
			continue
		}
		dto.CreatedAt = createdAt.Format(time.RFC3339)
		transitions = append(transitions, dto)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("transition row iteration error")
		writeError(w, http.StatusInternalServerError, "failed to read transitions")
		return
	}

	if transitions == nil {
		transitions = []fsmTransitionDTO{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":     transitions,
		"total":    total,
		"page":     page,
		"per_page": perPage,
	})
}
