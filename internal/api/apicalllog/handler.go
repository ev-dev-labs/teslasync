package apicalllog

import (
	"context"
	"net/http"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/rs/zerolog/log"
)

// apiCallLogRepository is the minimal repo surface Handler depends on. It is
// declared as an interface — rather than binding the handler directly to the
// concrete *systemdb.APICallLogRepo — so the handler tests can inject a fake
// without standing up a database. This mirrors the test-double pattern already
// used by internal/api/vampiredrain. The concrete *systemdb.APICallLogRepo
// returned by systemdb.NewAPICallLogRepo satisfies this interface.
type apiCallLogRepository interface {
	GetAll(ctx context.Context, limit, offset int, method, statusFilter, endpoint, service, startDate, endDate string) ([]*teslamodel.APICallLog, int, error)
	GetStats(ctx context.Context) (map[string]interface{}, error)
}

// Handler handles API call log HTTP requests.
type Handler struct {
	repo apiCallLogRepository
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{
		repo: systemdb.NewAPICallLogRepo(db),
	}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := apiparams.Pagination(r)

	// url.Values.Get re-parses RawQuery on every call; parse once and reuse.
	q := r.URL.Query()
	method := q.Get("method")
	status := q.Get("status")
	endpoint := q.Get("endpoint")
	service := q.Get("service")
	start := q.Get("start")
	end := q.Get("end")

	logs, total, err := h.repo.GetAll(r.Context(), limit, offset, method, status, endpoint, service, start, end)
	if err != nil {
		log.Error().Err(err).
			Int("limit", limit).
			Int("offset", offset).
			Str("method", method).
			Str("status", status).
			Str("service", service).
			Msg("failed to list api call logs")
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
