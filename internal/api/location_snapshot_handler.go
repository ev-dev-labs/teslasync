package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// LocationSnapshotHandler serves location/navigation snapshot endpoints.
// Repo removed in phase-14/12 — returns empty results pending rewire (prompt 14).
type LocationSnapshotHandler struct {
	db          *database.DB
	signalStore *signal.Store
}

func NewLocationSnapshotHandler(db *database.DB) *LocationSnapshotHandler {
	return &LocationSnapshotHandler{db: db}
}

func (h *LocationSnapshotHandler) SetSignalStore(store *signal.Store) {
	h.signalStore = store
}

func (h *LocationSnapshotHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []struct{}{})
}

func (h *LocationSnapshotHandler) Latest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, nil)
}
