package apicalllog

import (
	"net/http"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/rs/zerolog/log"
)

// Handler handles API call log HTTP requests.
type Handler struct {
	repo *systemdb.APICallLogRepo
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{
		repo: systemdb.NewAPICallLogRepo(db),
	}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := apiparams.Pagination(r)

	method := r.URL.Query().Get("method")
	status := r.URL.Query().Get("status")
	endpoint := r.URL.Query().Get("endpoint")
	service := r.URL.Query().Get("service")
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")

	logs, total, err := h.repo.GetAll(r.Context(), limit, offset, method, status, endpoint, service, start, end)
	if err != nil {
		log.Error().Err(err).Msg("failed to list api call logs")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list api call logs")
		return
	}
	if logs == nil {
		logs = []*teslamodel.APICallLog{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"data":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get api call log stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get api call log stats")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stats)
}
