package condition

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

const earthRadiusM = 6371000.0

// LocationConfig represents the parsed condition config for location conditions.
// It checks whether a vehicle is inside or outside a specified geofence.
type LocationConfig struct {
	Type       string `json:"type"`        // must be "location" (or empty)
	GeofenceID int64  `json:"geofence_id"` // geofence to check against
	Operator   string `json:"operator"`    // "inside" or "outside"
}

// locationSnapshot provides detailed diagnostics for conditions_snapshot logging.
type locationSnapshot struct {
	GeofenceID   int64   `json:"geofence_id"`
	GeofenceName string  `json:"geofence_name"`
	Operator     string  `json:"operator"`
	VehicleLat   float64 `json:"vehicle_lat"`
	VehicleLon   float64 `json:"vehicle_lon"`
	DistanceM    float64 `json:"distance_m"`
	RadiusM      float64 `json:"radius_m"`
	Met          bool    `json:"met"`
	Reason       string  `json:"reason"`
}

// ParseLocationConfig unmarshals and validates a location condition config.
func ParseLocationConfig(raw json.RawMessage) (*LocationConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("condition config is empty")
	}

	var cfg LocationConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal condition config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "location" {
		return nil, fmt.Errorf("expected type \"location\", got %q", cfg.Type)
	}

	if cfg.GeofenceID <= 0 {
		return nil, fmt.Errorf("geofence_id must be a positive integer, got %d", cfg.GeofenceID)
	}

	switch cfg.Operator {
	case "inside", "outside":
		// valid
	case "":
		return nil, fmt.Errorf("operator is required")
	default:
		return nil, fmt.Errorf("unsupported operator %q, must be \"inside\" or \"outside\"", cfg.Operator)
	}

	return &cfg, nil
}

// EvaluateLocation checks whether the vehicle's last known position is inside
// or outside the specified geofence. Uses the spherical law of cosines
// (matching the SQL formula in GeofenceRepo.FindByCoordinates) for consistency.
func EvaluateLocation(cfg *LocationConfig, state *models.VehicleState, geofence *models.Geofence) (Result, json.RawMessage, error) {
	if state == nil {
		return Result{}, nil, fmt.Errorf("vehicle state is nil")
	}
	if geofence == nil {
		return Result{}, nil, fmt.Errorf("geofence is nil")
	}
	if geofence.ID != cfg.GeofenceID {
		return Result{}, nil, fmt.Errorf("geofence ID mismatch: config has %d, got %d", cfg.GeofenceID, geofence.ID)
	}

	dist := sphericalDistance(state.Latitude, state.Longitude, geofence.Latitude(), geofence.Longitude())

	var met bool
	switch cfg.Operator {
	case "inside":
		met = dist <= geofence.Radius()
	case "outside":
		met = dist > geofence.Radius()
	}

	geoName := geofence.Name
	if geoName == "" {
		geoName = fmt.Sprintf("geofence %d", geofence.ID)
	}

	var reason string
	if met {
		reason = fmt.Sprintf("vehicle is %s %s geofence (%.0fm from center, radius %.0fm)",
			cfg.Operator, geoName, dist, geofence.Radius())
	} else {
		// Describe actual position relative to geofence.
		pos := "inside"
		if dist > geofence.Radius() {
			pos = "outside"
		}
		reason = fmt.Sprintf("vehicle is %s %s geofence, expected %s (%.0fm from center, radius %.0fm)",
			pos, geoName, cfg.Operator, dist, geofence.Radius())
	}

	snapshot, _ := json.Marshal(locationSnapshot{
		GeofenceID:   geofence.ID,
		GeofenceName: geoName,
		Operator:     cfg.Operator,
		VehicleLat:   state.Latitude,
		VehicleLon:   state.Longitude,
		DistanceM:    dist,
		RadiusM:      geofence.Radius(),
		Met:          met,
		Reason:       reason,
	})

	return Result{Met: met, Reason: reason}, snapshot, nil
}

// sphericalDistance computes the great-circle distance in meters between two
// points using the spherical law of cosines. This matches the SQL formula
// used in GeofenceRepo.FindByCoordinates for consistent boundary behavior.
func sphericalDistance(lat1, lon1, lat2, lon2 float64) float64 {
	lat1r := lat1 * math.Pi / 180
	lon1r := lon1 * math.Pi / 180
	lat2r := lat2 * math.Pi / 180
	lon2r := lon2 * math.Pi / 180

	cosD := math.Sin(lat1r)*math.Sin(lat2r) +
		math.Cos(lat1r)*math.Cos(lat2r)*math.Cos(lon2r-lon1r)

	// Clamp to [-1, 1] to guard against floating-point overshoot.
	if cosD > 1 {
		cosD = 1
	}
	if cosD < -1 {
		cosD = -1
	}

	return earthRadiusM * math.Acos(cosD)
}
