package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// GuardHandler handles anti-theft guard mode endpoints.
type GuardHandler struct {
	guardRepo    *database.GuardRepo
	vehicleRepo  *database.VehicleRepo
	notifRepo    *database.NotificationRepo
	settingsRepo *database.SettingsRepo
	teslaClient  *tesla.Client
}

func NewGuardHandler(db *database.DB, tc *tesla.Client) *GuardHandler {
	return &GuardHandler{
		guardRepo:    database.NewGuardRepo(db),
		vehicleRepo:  database.NewVehicleRepo(db),
		notifRepo:    database.NewNotificationRepo(db),
		settingsRepo: database.NewSettingsRepo(db),
		teslaClient:  tc,
	}
}

// GetConfig returns the guard configuration for a vehicle.
func (h *GuardHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	cfg, err := h.guardRepo.GetConfig(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get guard config")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to get guard config"))
		return
	}

	if cfg == nil {
		// Return default config for unconfigured vehicles
		cfg = &models.GuardConfig{
			VehicleID:   vehicleID,
			Enabled:     false,
			Sensitivity: "medium",
		}
	}
	writeJSON(w, http.StatusOK, cfg)
}

// SetConfig creates or updates the guard configuration.
// When enabling guard mode, it also sends lock + sentry_on commands.
func (h *GuardHandler) SetConfig(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	var req struct {
		Enabled        bool   `json:"enabled"`
		HomeGeofenceID *int64 `json:"home_geofence_id"`
		Sensitivity    string `json:"sensitivity"`
		AutoPanic      bool   `json:"auto_panic"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}

	// Validate sensitivity
	switch req.Sensitivity {
	case "low", "medium", "high":
	case "":
		req.Sensitivity = "medium"
	default:
		writeError(w, http.StatusBadRequest, "sensitivity must be low, medium, or high")
		return
	}

	// Verify vehicle exists
	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil || vehicle == nil {
		writeAppError(w, r, ErrVehicleNotFound)
		return
	}

	cfg := &models.GuardConfig{
		VehicleID:      vehicleID,
		Enabled:        req.Enabled,
		HomeGeofenceID: req.HomeGeofenceID,
		Sensitivity:    req.Sensitivity,
		AutoPanic:      req.AutoPanic,
	}

	if err := h.guardRepo.UpsertConfig(r.Context(), cfg); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to save guard config")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to save guard config"))
		return
	}

	// When arming guard mode, lock the vehicle and enable sentry
	armResults := map[string]string{}
	if req.Enabled && h.teslaClient != nil && h.teslaClient.HasValidToken() {
		if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); !suspended {
			if lockErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, "lock", nil); lockErr != nil {
				armResults["lock"] = lockErr.Error()
			} else {
				armResults["lock"] = "ok"
			}
			if sentryErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, "sentry_on", nil); sentryErr != nil {
				armResults["sentry_on"] = sentryErr.Error()
			} else {
				armResults["sentry_on"] = "ok"
			}
		} else {
			armResults["skipped"] = "Tesla API suspended"
		}
	}

	log.Info().
		Int64("vehicle_id", vehicleID).
		Bool("enabled", req.Enabled).
		Str("sensitivity", req.Sensitivity).
		Msg("guard config updated")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"config":      cfg,
		"arm_results": armResults,
	})
}

// ListEvents returns guard events for a vehicle.
func (h *GuardHandler) ListEvents(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	limit, offset := pagination(r)
	events, err := h.guardRepo.ListEvents(r.Context(), vehicleID, limit, offset)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to list guard events")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to list guard events"))
		return
	}
	if events == nil {
		events = []*models.GuardEvent{}
	}
	writeJSON(w, http.StatusOK, events)
}

// AcknowledgeEvent marks a guard event as acknowledged.
func (h *GuardHandler) AcknowledgeEvent(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}
	eventID, err := urlParamInt64(r, "eventID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid event ID")
		return
	}

	if err := h.guardRepo.AcknowledgeEvent(r.Context(), vehicleID, eventID); err != nil {
		writeError(w, http.StatusNotFound, "event not found or already acknowledged")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "acknowledged"})
}

// Panic executes emergency response: flash+honk+lock+sentry then notifies all channels.
func (h *GuardHandler) Panic(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := urlParamInt64(r, "vehicleID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	vehicle, err := h.vehicleRepo.GetByID(r.Context(), vehicleID)
	if err != nil || vehicle == nil {
		writeAppError(w, r, ErrVehicleNotFound)
		return
	}

	// Execute panic commands
	cmdResults := map[string]string{}
	if h.teslaClient != nil && h.teslaClient.HasValidToken() {
		if suspended, _ := h.settingsRepo.IsAPISuspended(r.Context()); suspended {
			cmdResults["error"] = "Tesla API suspended"
		} else {
			// Lock first for safety, then parallel flash+honk+sentry
			if lockErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, "lock", nil); lockErr != nil {
				cmdResults["lock"] = lockErr.Error()
			} else {
				cmdResults["lock"] = "ok"
			}

			var wg sync.WaitGroup
			var mu sync.Mutex
			panicCmds := []string{"flash_lights", "honk_horn", "sentry_on"}
			for _, cmd := range panicCmds {
				wg.Add(1)
				go func(c string) {
					defer wg.Done()
					if cmdErr := h.teslaClient.SendCommand(r.Context(), vehicle.VIN, c, nil); cmdErr != nil {
						mu.Lock()
						cmdResults[c] = cmdErr.Error()
						mu.Unlock()
					} else {
						mu.Lock()
						cmdResults[c] = "ok"
						mu.Unlock()
					}
				}(cmd)
			}
			wg.Wait()
		}
	} else {
		cmdResults["error"] = "Tesla client not authenticated"
	}

	// Record the panic event
	ev := &models.GuardEvent{
		VehicleID: vehicleID,
		EventType: "manual_panic",
		Details:   map[string]interface{}{"command_results": cmdResults},
	}

	// Send notifications to all enabled channels
	notifiedChannels := h.notifyAllChannels(r, vehicle, ev)
	ev.NotifiedChannels = notifiedChannels

	if createErr := h.guardRepo.CreateEvent(r.Context(), ev); createErr != nil {
		log.Error().Err(createErr).Int64("vehicle_id", vehicleID).Msg("failed to record panic event")
	}

	log.Warn().
		Int64("vehicle_id", vehicleID).
		Str("display_name", vehicle.DisplayName).
		Interface("cmd_results", cmdResults).
		Msg("guard mode PANIC triggered")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"command_results":   cmdResults,
		"notified_channels": notifiedChannels,
		"event_id":          ev.ID,
	})
}

// notifyAllChannels sends a guard alert to every enabled notification channel.
func (h *GuardHandler) notifyAllChannels(r *http.Request, vehicle *models.Vehicle, ev *models.GuardEvent) []string {
	channels, err := h.notifRepo.GetAllChannels(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list notification channels for guard alert")
		return nil
	}

	title := fmt.Sprintf("🚨 GUARD ALERT — %s", vehicle.DisplayName)
	message := fmt.Sprintf("Guard mode triggered: %s", ev.EventType)
	if ev.Latitude != nil && ev.Longitude != nil {
		message += fmt.Sprintf("\n📍 Location: https://maps.google.com/?q=%.6f,%.6f", *ev.Latitude, *ev.Longitude)
	}

	var notified []string
	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		if sendErr := sendNotification(ch, title, message); sendErr != nil {
			log.Error().Err(sendErr).Str("channel", ch.Name).Msg("guard notification failed")
			continue
		}
		notified = append(notified, ch.Type)
	}
	return notified
}
