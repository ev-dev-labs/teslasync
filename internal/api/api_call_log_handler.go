package api

import (
	"net/http"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// APICallLogHandler handles API call log HTTP requests.
type APICallLogHandler struct {
	repo *database.APICallLogRepo
}

func NewAPICallLogHandler(db *database.DB) *APICallLogHandler {
	return &APICallLogHandler{
		repo: database.NewAPICallLogRepo(db),
	}
}

func (h *APICallLogHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)

	method := r.URL.Query().Get("method")
	status := r.URL.Query().Get("status")
	endpoint := r.URL.Query().Get("endpoint")
	service := r.URL.Query().Get("service")
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")

	logs, total, err := h.repo.GetAll(r.Context(), limit, offset, method, status, endpoint, service, start, end)
	if err != nil {
		log.Error().Err(err).Msg("failed to list api call logs")
		writeError(w, http.StatusInternalServerError, "failed to list api call logs")
		return
	}
	if logs == nil {
		logs = []*teslamodel.APICallLog{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *APICallLogHandler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get api call log stats")
		writeError(w, http.StatusInternalServerError, "failed to get api call log stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
