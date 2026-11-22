package smartreadiness

import (
	"context"
	"net/http"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type backupCharging interface {
	BackupSettings(context.Context, string, int64) (domain.BackupChargingSettings, error)
	StartBackupWatch(context.Context, string, domain.BackupChargingWatch, bool, bool) error
	StopBackupWatch(context.Context, string, int64, int64) error
}

func WithBackupCharging(service backupCharging, deliveryAvailable func() bool) Option {
	return func(h *Handler) { h.backup, h.backupReady = service, deliveryAvailable }
}

func (h *Handler) BackupCharging(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.backup_watch")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "backup charging")
	if !ok {
		return
	}
	available := h.backup != nil && h.backupReady != nil && h.backupReady()
	switch r.Method {
	case http.MethodGet:
		vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
		if err != nil {
			h.handleError(w, span, err)
			return
		}
		var settings domain.BackupChargingSettings
		if h.backup != nil {
			settings, err = h.backup.BackupSettings(ctx, subject, vehicleID)
		}
		if err != nil {
			h.handleError(w, span, err)
			return
		}
		settings.Available = available
		if !available {
			settings.Active, settings.Decision = false, nil
		}
		httputil.Respond(w, http.StatusOK, settings)
	case http.MethodPost:
		if !available {
			h.handleError(w, span, smartreadinesssvc.ErrSolarChargingUnavailable)
			return
		}
		input, err := decode[struct {
			VehicleID       int64     `json:"vehicle_id"`
			Connection      int64     `json:"connection_revision"`
			PlaceID         int64     `json:"place_id"`
			PlaceUpdatedAt  time.Time `json:"place_updated_at"`
			DeviceID        int64     `json:"device_id"`
			DeviceUpdatedAt time.Time `json:"device_updated_at"`
			CircuitAgreed   bool      `json:"same_backup_circuit_confirmed"`
			OutageConfirmed bool      `json:"utility_outage_confirmed"`
		}](w, r)
		if err == nil {
			err = h.backup.StartBackupWatch(ctx, subject, domain.BackupChargingWatch{
				VehicleID: input.VehicleID, ConnectionID: input.Connection, PlaceID: input.PlaceID,
				PlaceUpdatedAt: input.PlaceUpdatedAt, DeviceID: input.DeviceID, DeviceUpdatedAt: input.DeviceUpdatedAt,
			}, input.CircuitAgreed, input.OutageConfirmed)
		}
		if err != nil {
			h.handleError(w, span, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodDelete:
		vehicleID, vehicleErr := positiveID(r.URL.Query().Get("vehicle_id"))
		watchID, watchErr := positiveID(r.URL.Query().Get("watch_id"))
		if vehicleErr != nil || watchErr != nil {
			h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
			return
		}
		if h.backup == nil {
			h.handleError(w, span, smartreadinesssvc.ErrSolarChargingUnavailable)
			return
		}
		if err := h.backup.StopBackupWatch(ctx, subject, vehicleID, watchID); err != nil {
			h.handleError(w, span, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
