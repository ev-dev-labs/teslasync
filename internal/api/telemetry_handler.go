package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
)

// TelemetryHandler receives and processes Tesla Fleet Telemetry data.
type TelemetryHandler struct {
	db         *database.DB
	posRepo    *database.PositionRepo
	mqttClient *mqtt.Client
}

// NewTelemetryHandler creates a handler for fleet telemetry ingestion.
func NewTelemetryHandler(db *database.DB, mc ...*mqtt.Client) *TelemetryHandler {
	var mqttC *mqtt.Client
	if len(mc) > 0 {
		mqttC = mc[0]
	}
	return &TelemetryHandler{
		db:         db,
		posRepo:    database.NewPositionRepo(db),
		mqttClient: mqttC,
	}
}

type telemetrySignal struct {
	Name      string      `json:"name"`
	Value     interface{} `json:"value"`
	Timestamp string      `json:"timestamp"`
}

type telemetryPayload struct {
	VIN       string                 `json:"vin"`
	CreatedAt string                 `json:"created_at"`
	Data      map[string]interface{} `json:"data"`
	Signals   []telemetrySignal      `json:"signals"`
}

// TelemetryIngest receives Fleet Telemetry data via HTTP POST.
// Tesla Fleet Telemetry can be configured to POST to this endpoint.
func (h *TelemetryHandler) TelemetryIngest(w http.ResponseWriter, r *http.Request) {
	var payload telemetryPayload

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid telemetry payload")
		return
	}

	log.Info().
		Str("vin", payload.VIN).
		Int("signals", len(payload.Signals)).
		Msg("telemetry data received")

	// Extract common fields from signals.
	var lat, lng float64
	var speed, power float64
	var batteryLevel float64
	var insideTemp, outsideTemp float64
	var odometer float64
	var heading int

	for _, sig := range payload.Signals {
		val, ok := sig.Value.(float64)
		if !ok {
			continue
		}
		switch sig.Name {
		case "Latitude":
			lat = val
		case "Longitude":
			lng = val
		case "VehicleSpeed":
			speed = val
		case "PackPower":
			power = val
		case "BatteryLevel", "StateOfCharge":
			batteryLevel = val
		case "InsideTemp":
			insideTemp = val
		case "OutsideTemp":
			outsideTemp = val
		case "Odometer":
			odometer = val
		case "Heading":
			heading = int(val)
		}
	}

	// Store position if we have coordinates
	if lat != 0 && lng != 0 {
		pos := &models.Position{
			Latitude:    lat,
			Longitude:   lng,
			Speed:       &speed,
			Power:       &power,
			BatteryLvl:  int(batteryLevel),
			InsideTemp:  &insideTemp,
			OutsideTemp: &outsideTemp,
			Odometer:    odometer,
			Heading:     &heading,
		}

		// Find vehicle by VIN
		rows, err := h.db.Pool.Query(r.Context(), "SELECT id FROM vehicles WHERE vin = $1", payload.VIN)
		if err == nil {
			defer rows.Close()
			if rows.Next() {
				var vehicleID int64
				if err := rows.Scan(&vehicleID); err == nil {
					pos.VehicleID = vehicleID
					if err := h.posRepo.Insert(r.Context(), pos); err != nil {
						log.Warn().Err(err).Msg("telemetry: failed to store position")
					}
				}
			}
		}

		// Publish telemetry signals to MQTT for downstream consumers
		if h.mqttClient != nil {
			for _, sig := range payload.Signals {
				if val, ok := sig.Value.(float64); ok {
					h.mqttClient.Publish(payload.VIN+"/"+sig.Name, formatFloat(val))
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "accepted",
		"signals": len(payload.Signals),
		"vin":     payload.VIN,
	})
}

// TelemetryStatus returns the telemetry endpoint configuration info.
func (h *TelemetryHandler) TelemetryStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":  true,
		"endpoint": "/api/v1/telemetry",
		"protocol": "HTTP POST (JSON)",
		"supported_signals": []string{
			"Latitude", "Longitude", "VehicleSpeed", "PackPower",
			"BatteryLevel", "StateOfCharge", "InsideTemp", "OutsideTemp",
			"Odometer", "Heading",
		},
		"mqtt_publishing": h.mqttClient != nil,
	})
}

func formatFloat(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%.6f", v)
}
