// Phase-46 / p46-dq-lineage — Data quality scoring + signal lineage.
//
// Two read-only endpoints:
//
//	GET /api/v1/admin/observability/data-quality
//	  Per-field freshness / max-gap / duplicate-ratio score from
//	  signal_log over a configurable lookback window (default 60 mins).
//	  Worst scores first so the SPA can lead with the most degraded
//	  fields. Returns 503 SUBSYSTEM_NOT_CONFIGURED when the database
//	  pool was not threaded into the handler.
//
//	GET /api/v1/admin/observability/lineage
//	  Static pipeline DAG: source(field) → router → writer → table.
//	  Same shape across every deployment because routing.yaml is
//	  embedded in the binary. Dual-write edges to signal_log are
//	  rendered when the routing entry has also_signal_log=true.
//
// ADR-009 exception: handlers placed in internal/api/ rather than
// internal/handler/v1/ so they sit next to the SLO + queue handlers
// (same Phase-46 batch).
package api

import (
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/dataquality"
)

// DataQualityHandler serves data quality + lineage endpoints.
type DataQualityHandler struct {
	scorer *dataquality.Scorer
}

// NewDataQualityHandler wires the handler. Pass nil for scorer when
// the signal_log pool wasn't available — the handler reports 503 on
// the per-field score endpoint but still serves the static lineage
// graph (which has no DB dependency).
func NewDataQualityHandler(scorer *dataquality.Scorer) *DataQualityHandler {
	return &DataQualityHandler{scorer: scorer}
}

// Score is GET /admin/observability/data-quality.
func (h *DataQualityHandler) Score(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.scorer == nil {
		writeError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
		return
	}
	snap, err := h.scorer.Snapshot(r.Context())
	if err != nil {
		if errors.Is(err, dataquality.ErrNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

// Lineage is GET /admin/observability/lineage. Static so available on
// every deployment even if signal_log scoring is offline.
func (h *DataQualityHandler) Lineage(w http.ResponseWriter, _ *http.Request) {
	graph, err := dataquality.BuildLineage()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, graph)
}
