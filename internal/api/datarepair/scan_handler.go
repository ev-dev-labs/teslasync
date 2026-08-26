package datarepair

import (
	"context"
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/rs/zerolog/log"
)

// ScannerService is the manual scan endpoint's narrow dependency.
type ScannerService interface {
	Scan(context.Context, ScanOptions) (ScanResult, error)
}

type scanCasesRequest struct {
	VehicleID *int64 `json:"vehicle_id,omitempty"`
}

// ScanCases runs the same bounded, advisory-locked discovery service used by
// the scheduled worker. It creates or refreshes cases only; source sessions
// are never mutated.
func (h *DataRepairHandler) ScanCases(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "scan_cases")
	defer span.End()

	if h.scanner == nil {
		err := errors.New("data-repair scanner is unavailable")
		recordHandlerError(r.Context(), err)
		httpx.WriteError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	var req scanCasesRequest
	if err := decodeCaseRequest(w, r, &req); err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if req.VehicleID != nil && *req.VehicleID <= 0 {
		writeCaseValidationError(w, r, errors.New("vehicle_id must be a positive integer"))
		return
	}

	result, err := h.scanner.Scan(r.Context(), ScanOptions{
		Trigger:     systemmodel.RepairScanTriggerManual,
		VehicleID:   req.VehicleID,
		InitiatedBy: actorFromRequest(r, h.forwardAuthHeader),
	})
	if errors.Is(err, ErrScanAlreadyRunning) {
		httpx.WriteError(w, http.StatusConflict, "a data-repair scan is already running")
		return
	}
	if err != nil {
		recordHandlerError(r.Context(), err)
		log.Error().
			Err(err).
			Str("trace_id", activeTraceID(r.Context())).
			Msg("data-repair manual scan failed")
		httpx.WriteError(w, http.StatusInternalServerError, "data-repair scan failed")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}
