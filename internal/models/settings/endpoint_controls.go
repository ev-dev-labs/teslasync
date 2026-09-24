package settings

import (
	"net/http"
	"net/url"
	"strings"
)

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
