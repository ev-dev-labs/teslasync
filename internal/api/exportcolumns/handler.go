package exportcolumns

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/export"
)

// Handler exposes the publishable column metadata for each export job
// type so the frontend column picker can render checkboxes without
// hard-coding the catalog. Phase-46 / Prompt 62.
type Handler struct{}

// NewHandler returns a handler with no dependencies; the catalog lives
// statically in the export package.
func NewHandler() *Handler {
	return &Handler{}
}

// ListColumns serves GET /api/v1/exports/columns?type={drives|charging|...}.
//
// Response shape (snake_case to match the rest of the export endpoints):
//
//	{
//	  "type": "drives",
//	  "columns": [
//	    {"name": "id", "label": "ID", "always_included": true},
//	    {"name": "start_date", "label": "Start date", "always_included": false}
//	  ],
//	  "supports_selection": true
//	}
//
// `supports_selection: false` indicates that, while the export type is
// recognised, its column set is dynamic (e.g. account exports span many
// tables) and a per-column picker does not apply. The client should hide
// the picker UI for such types and submit without a `columns` field.
func (h *Handler) ListColumns(w http.ResponseWriter, r *http.Request) {
	jobType := r.URL.Query().Get("type")
	if jobType == "" {
		httpx.WriteError(w, http.StatusBadRequest, "type query parameter is required")
		return
	}

	cols := export.AvailableColumns(jobType)
	supports := export.SupportsColumnSelection(jobType)

	// When a type doesn't publish a fixed catalog, return an empty list
	// with supports_selection:false rather than 404 — that lets the
	// frontend ask about every type uniformly without branching on
	// status codes.
	if cols == nil {
		cols = []export.ColumnInfo{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"type":               jobType,
		"columns":            cols,
		"supports_selection": supports,
	})
}
