package settings

import (
	"net/http"
	"net/url"
	"strings"
)

// EndpointEnabled applies a per-route override before consulting legacy
// switches. Unconfigured new routes stay available for deliberate on-demand use.
func (pc LegacyPollingConfig) EndpointEnabled(key string) bool {
	if value, ok := pc.FleetEndpoints[key]; ok {
		return value
	}
	switch key {
	case "vehicles.list":
		return pc.OnDemandVehicleDiscovery
	case "vehicles.nearby_charging_sites":
		return pc.NearbyChargingSites
	case "vehicles.release_notes":
		return pc.ReleaseNotes
	case "vehicles.recent_alerts":
		return pc.RecentAlerts
	case "vehicles.service_data":
		return pc.ServiceData
	case "vehicles.wake_up", "command.wake_up":
		return pc.WakeUp
	}
	if strings.HasPrefix(key, "command.") {
		return pc.Commands
	}
	if strings.HasPrefix(key, "vehicle_data.") {
		switch strings.TrimPrefix(key, "vehicle_data.") {
		case "charge_state":
			return pc.OnDemandChargeState
		case "climate_state":
			return pc.OnDemandClimateState
		case "drive_state":
			return pc.OnDemandDriveState
		case "location_data":
			return pc.OnDemandLocationData
		case "vehicle_state":
			return pc.OnDemandVehicleState
		case "vehicle_config":
			return pc.OnDemandVehicleConfig
		}
	}
	return true
}

// PollsEndpoint checks the independent participation flag for the only Fleet
// requests the worker knows how to consume: discovery and vehicle_data.
func (pc LegacyPollingConfig) PollsEndpoint(key string) bool {
	if !pc.AutoPollingEnabled || !pc.EndpointEnabled(key) {
		return false
	}
	return pc.AutoPreference(key)
}

// AutoPreference is independent of the master switch: the page retains
// selected routes while polling is paused.
func (pc LegacyPollingConfig) AutoPreference(key string) bool {
	if value, ok := pc.AutoEndpoints[key]; ok {
		return value
	}
	switch key {
	case "vehicles.list":
		return pc.VehicleDiscovery
	case "vehicle_data.charge_state":
		return pc.ChargeState
	case "vehicle_data.climate_state":
		return pc.ClimateState
	case "vehicle_data.drive_state":
		return pc.DriveState
	case "vehicle_data.location_data":
		return pc.LocationData
	case "vehicle_data.vehicle_state":
		return pc.VehicleState
	case "vehicle_data.vehicle_config":
		return pc.VehicleConfig
	}
	return false
}

// AllowsFleetOperation checks only operations represented by the endpoint
// controls. Unrelated Fleet API operations are not controlled by these flags.
// Automatic requests and user-triggered requests have separate switches.
func (pc LegacyPollingConfig) AllowsFleetOperation(method, path string, automatic bool) bool {
	u, err := url.Parse(path)
	if err != nil {
		return false
	}
	segments := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(segments) == 3 && u.Path == "/api/1/vehicles" && method == http.MethodGet {
		if automatic {
			return pc.VehicleDiscovery
		}
		return pc.OnDemandVehicleDiscovery
	}
	if len(segments) < 5 || strings.Join(segments[:3], "/") != "api/1/vehicles" {
		return true
	}
	endpoint := segments[4]
	if method == http.MethodPost {
		switch endpoint {
		case "wake_up":
			if len(segments) == 5 {
				return pc.WakeUp
			}
		case "command":
			if len(segments) == 6 {
				return pc.Commands
			}
		}
	}
	if method != http.MethodGet || len(segments) != 5 {
		return true
	}
	switch endpoint {
	case "nearby_charging_sites":
		return pc.NearbyChargingSites
	case "release_notes":
		return pc.ReleaseNotes
	case "recent_alerts":
		return pc.RecentAlerts
	case "service_data":
		return pc.ServiceData
	case "vehicle_data":
		enabled := pc.EnabledOnDemandVehicleDataEndpoints()
		if automatic {
			enabled = pc.EnabledVehicleDataEndpoints()
		}
		// Tesla's query uses literal semicolons. url.Values.Get discards
		// parameters containing unescaped semicolons, so decode the value
		// without treating them as query separators.
		requested := ""
		seen := false
		for _, part := range strings.Split(u.RawQuery, "&") {
			key, value, present := strings.Cut(part, "=")
			if key != "endpoints" {
				continue
			}
			if !present || seen {
				return false
			}
			seen = true
			requested, err = url.QueryUnescape(value)
			if err != nil {
				return false
			}
		}
		if requested == "" {
			requested = "charge_state;climate_state;drive_state;location_data;vehicle_state;vehicle_config"
		}
		for _, name := range strings.Split(requested, ";") {
			found := false
			for _, allowed := range enabled {
				if name == allowed {
					found = true
					break
				}
			}
			if !found {
				return false
			}
		}
	}
	return true
}
