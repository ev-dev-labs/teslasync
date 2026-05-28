// Drive-end diagnostic HTTP handler.
//
// Phase-44 / observability-batch / Prompt F10.
//
// Endpoint:
//
//	GET /api/v1/drives/{driveID}/why-ended
//	    ?window=60s  (default; supports 30s, 60s, 5m, 15m)
//
// Response:
//
//	{
//	  "drive_id": 42,
//	  "vehicle_id": 1,
//	  "end_ts": "..." | null,
//	  "ended_status": "..." | null,
//	  "window": "60s",
//	  "fsm_transitions": [...],
//	  "signal_window": [...]
//	}
//
// What the operator gets:
//
//   - The fsm_transitions in a window centered on end_ts. The
//     drive-end transition (drive→stopped) + neighboring transitions
//     (gear→P, ignition off, speed→0) explain "why".
//   - The signal_log values for Gear / VehicleSpeed / Odometer in the
//     same window so the operator can spot a sensor blip that
//     triggered the FSM.
//
// In-progress drives (end_ts NULL) return 200 with end_ts:null and
// signal_window covering [now-window, now] — the operator can still
// inspect "what's it doing right now".

package drivediagnostic

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// driveLookup is the narrow Drive-load surface used by the handler.
type driveLookup interface {
	GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error)
}

// driveDiagnosticReader is the narrow diagnostic-read surface used by
// the handler. The concrete *drivedb.DriveDiagnosticRepo satisfies it.
type driveDiagnosticReader interface {
	TransitionsAround(ctx context.Context, vehicleID int64, ts time.Time, window time.Duration) ([]drivedb.DriveDiagnosticTransition, error)
	SignalsAround(ctx context.Context, vehicleID int64, ts time.Time, window time.Duration, fields []string) ([]drivedb.DriveDiagnosticSignal, error)
}

// Handler serves the per-drive "why did it end" view.
type Handler struct {
	driveRepo driveLookup
	diagRepo  driveDiagnosticReader
}

// NewHandler constructs a handler bound to driveRepo +
// diagRepo. nil-typed args are normalised to nil-interface so the
// handler's nil-check trips cleanly.
func NewHandler(driveRepo *drivedb.DriveRepo, diagRepo *drivedb.DriveDiagnosticRepo) *Handler {
	h := &Handler{}
	if driveRepo != nil {
		h.driveRepo = driveRepo
	}
	if diagRepo != nil {
		h.diagRepo = diagRepo
	}
	return h
}

// newHandlerForTest is the interface-typed constructor
// for unit tests.
func newHandlerForTest(driveRepo driveLookup, diagRepo driveDiagnosticReader) *Handler {
	return &Handler{driveRepo: driveRepo, diagRepo: diagRepo}
}

// DriveDiagnosticResponse is the JSON shape returned by Get.
type DriveDiagnosticResponse struct {
	DriveID        int64                               `json:"drive_id"`
	VehicleID      int64                               `json:"vehicle_id"`
	StartTs        string                              `json:"start_ts"`
	EndTs          *string                             `json:"end_ts,omitempty"`
	EndedStatus    *string                             `json:"ended_status,omitempty"`
	Window         string                              `json:"window"`
	FSMTransitions []drivedb.DriveDiagnosticTransition `json:"fsm_transitions"`
	SignalWindow   []drivedb.DriveDiagnosticSignal     `json:"signal_window"`
}

var driveDiagnosticAllowedWindows = map[string]time.Duration{
	"30s": 30 * time.Second,
	"60s": 60 * time.Second,
	"5m":  5 * time.Minute,
	"15m": 15 * time.Minute,
}

// Default signal whitelist — narrow set that explains drive lifecycle
// without flooding the response with telemetry firehose noise.
var driveDiagnosticSignalFields = []string{
	"Gear",
	"VehicleSpeed",
	"Odometer",
	"BatteryLevel",
	"ChargeState",
	"DCDCEnable",
	"VehicleAirbagDeployment",
}

// Get serves the GET endpoint.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.driveRepo == nil || h.diagRepo == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "drive diagnostic not configured")
		return
	}
	driveID, err := apiparams.URLParamInt64(r, "driveID")
	if err != nil || driveID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "driveID must be a positive integer")
		return
	}

	drive, err := h.driveRepo.GetByID(r.Context(), driveID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if drive == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	windowStr := strings.TrimSpace(r.URL.Query().Get("window"))
	if windowStr == "" {
		windowStr = "60s"
	}
	windowDur, ok := driveDiagnosticAllowedWindows[windowStr]
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "window must be one of 30s,60s,5m,15m")
		return
	}

	// For in-progress drives use NOW() as the anchor. The FE renders
	// end_ts:null to convey "still in progress".
	anchor := time.Now()
	if drive.EndTs != nil {
		anchor = *drive.EndTs
	}

	transitions, err := h.diagRepo.TransitionsAround(r.Context(), drive.VehicleID, anchor, windowDur)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	signals, err := h.diagRepo.SignalsAround(r.Context(), drive.VehicleID, anchor, windowDur, driveDiagnosticSignalFields)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	resp := DriveDiagnosticResponse{
		DriveID:        drive.ID,
		VehicleID:      drive.VehicleID,
		StartTs:        drive.StartTs.UTC().Format(time.RFC3339Nano),
		Window:         windowStr,
		EndedStatus:    drive.EndedStatus,
		FSMTransitions: transitions,
		SignalWindow:   signals,
	}
	if drive.EndTs != nil {
		ts := drive.EndTs.UTC().Format(time.RFC3339Nano)
		resp.EndTs = &ts
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}
