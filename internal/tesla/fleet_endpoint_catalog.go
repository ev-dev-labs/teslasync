package tesla

import (
	"net/http"
	"net/url"
	"sort"
	"strings"
)

// FleetEndpoint describes one outbound Fleet API operation. Pollable means
// the existing worker consumes its response; commands, paid requests, and
// operations requiring caller-supplied parameters are on-demand only.
type FleetEndpoint struct {
	Key      string `json:"key"`
	Method   string `json:"method"`
	Path     string `json:"path"`
	Category string `json:"category"`
	Pollable bool   `json:"pollable"`
}

var fleetDataEndpoints = []FleetEndpoint{
	{"vehicles.list", http.MethodGet, "/api/1/vehicles", "Vehicle data", true},
	{"vehicle_data.charge_state", http.MethodGet, "/api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state", "Vehicle data", true},
	{"vehicle_data.climate_state", http.MethodGet, "/api/1/vehicles/{vin}/vehicle_data?endpoints=climate_state", "Vehicle data", true},
	{"vehicle_data.drive_state", http.MethodGet, "/api/1/vehicles/{vin}/vehicle_data?endpoints=drive_state", "Vehicle data", true},
	{"vehicle_data.location_data", http.MethodGet, "/api/1/vehicles/{vin}/vehicle_data?endpoints=location_data", "Vehicle data", true},
	{"vehicle_data.vehicle_state", http.MethodGet, "/api/1/vehicles/{vin}/vehicle_data?endpoints=vehicle_state", "Vehicle data", true},
	{"vehicle_data.vehicle_config", http.MethodGet, "/api/1/vehicles/{vin}/vehicle_data?endpoints=vehicle_config", "Vehicle data", true},
	{"vehicles.nearby_charging_sites", http.MethodGet, "/api/1/vehicles/{vin}/nearby_charging_sites", "Vehicle data", false},
	{"vehicles.release_notes", http.MethodGet, "/api/1/vehicles/{vin}/release_notes", "Vehicle data", false},
	{"vehicles.recent_alerts", http.MethodGet, "/api/1/vehicles/{vin}/recent_alerts", "Vehicle data", false},
	{"vehicles.service_data", http.MethodGet, "/api/1/vehicles/{vin}/service_data", "Vehicle data", false},
	{"vehicles.fleet_status", http.MethodPost, "/api/1/vehicles/fleet_status", "Vehicle data", false},
	{"vehicles.mobile_enabled", http.MethodGet, "/api/1/vehicles/{vin}/mobile_enabled", "Vehicle data", false},
	{"vehicles.specs", http.MethodGet, "/api/1/vehicles/{vin}/specs", "Vehicle data", false},
	{"vehicles.wake_up", http.MethodPost, "/api/1/vehicles/{vin}/wake_up", "Vehicle commands", false},
	{"vehicles.drivers.list", http.MethodGet, "/api/1/vehicles/{vin}/drivers", "Vehicle access", false},
	{"vehicles.drivers.remove", http.MethodDelete, "/api/1/vehicles/{vin}/drivers", "Vehicle access", false},
	{"vehicles.invitations.list", http.MethodGet, "/api/1/vehicles/{vin}/invitations", "Vehicle access", false},
	{"vehicles.invitations.create", http.MethodPost, "/api/1/vehicles/{vin}/invitations", "Vehicle access", false},
	{"vehicles.invitations.revoke", http.MethodPost, "/api/1/vehicles/{vin}/invitations/{invitation_id}/revoke", "Vehicle access", false},
	{"vehicles.paired_keys", http.MethodPost, "/api/1/vehicles/{vin}/paired_keys", "Vehicle access", false},
	{"telemetry.subscribe", http.MethodPost, "/api/1/vehicles/fleet_telemetry_config", "Fleet telemetry", false},
	{"telemetry.config.get", http.MethodGet, "/api/1/vehicles/{vin}/fleet_telemetry_config", "Fleet telemetry", false},
	{"telemetry.config.delete", http.MethodDelete, "/api/1/vehicles/{vin}/fleet_telemetry_config", "Fleet telemetry", false},
	{"telemetry.errors", http.MethodGet, "/api/1/vehicles/{vin}/fleet_telemetry_errors", "Fleet telemetry", false},
	{"telemetry.error_vins", http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_error_vins", "Fleet telemetry", false},
	{"telemetry.partner_errors", http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_errors", "Fleet telemetry", false},
	{"users.region", http.MethodGet, "/api/1/users/region", "Account", false},
	{"users.feature_config", http.MethodGet, "/api/1/users/feature_config", "Account", false},
	{"users.orders", http.MethodGet, "/api/1/users/orders", "Account", false},
	{"users.profile", http.MethodGet, "/api/1/users/me", "Account", false},
	{"partners.register", http.MethodPost, "/api/1/partner_accounts", "Account", false},
	{"partners.public_key", http.MethodGet, "/api/1/partner_accounts/public_key", "Account", false},
	{"charging.history", http.MethodGet, "/api/1/dx/charging/history", "Charging and energy", false},
	{"charging.invoice", http.MethodGet, "/api/1/dx/charging/invoice/{content_id}", "Charging and energy", false},
	{"charging.sessions", http.MethodGet, "/api/1/dx/charging/sessions", "Charging and energy", false},
	{"products.list", http.MethodGet, "/api/1/products", "Charging and energy", false},
	{"energy.calendar_history", http.MethodGet, "/api/1/energy_sites/{site_id}/calendar_history", "Charging and energy", false},
	{"energy.telemetry_history", http.MethodGet, "/api/1/energy_sites/{site_id}/telemetry_history", "Charging and energy", false},
	{"energy.live_status", http.MethodGet, "/api/1/energy_sites/{site_id}/live_status", "Charging and energy", false},
	{"energy.site_info", http.MethodGet, "/api/1/energy_sites/{site_id}/site_info", "Charging and energy", false},
	{"energy.time_of_use_settings", http.MethodPost, "/api/1/energy_sites/{site_id}/time_of_use_settings", "Charging and energy", false},
	{"dx.vehicle_options", http.MethodGet, "/api/1/dx/vehicles/options", "Vehicle services", false},
	{"dx.subscriptions", http.MethodGet, "/api/1/dx/vehicles/subscriptions/eligibility", "Vehicle services", false},
	{"dx.upgrades", http.MethodGet, "/api/1/dx/vehicles/upgrades/eligibility", "Vehicle services", false},
	{"dx.warranty", http.MethodGet, "/api/1/dx/warranty/details", "Vehicle services", false},
	{"dx.pricing", http.MethodPost, "/api/1/dx/vehicles/pricing", "Vehicle services", false},
	{"dx.enterprise_roles", http.MethodGet, "/api/1/dx/enterprise/v1/{vin}/roles", "Vehicle services", false},
	{"dx.enterprise_payer", http.MethodPost, "/api/1/dx/enterprise/v1/{vin}/payer", "Vehicle services", false},
}

// FleetEndpointCatalog includes each distinct Tesla command endpoint once,
// even when the application has multiple aliases for that command.
func FleetEndpointCatalog() []FleetEndpoint {
	return append([]FleetEndpoint(nil), fleetCatalog...)
}

var fleetCatalog = buildFleetEndpointCatalog()

func buildFleetEndpointCatalog() []FleetEndpoint {
	out := make([]FleetEndpoint, 0, len(fleetDataEndpoints)+len(commands))
	out = append(out, fleetDataEndpoints...)
	seen := make(map[string]bool, len(commands))
	for _, command := range commands {
		if seen[command.endpoint] {
			continue
		}
		seen[command.endpoint] = true
		out = append(out, FleetEndpoint{
			Key: "command." + command.endpoint, Method: http.MethodPost,
			Path:     "/api/1/vehicles/{vin}/command/" + command.endpoint,
			Category: "Vehicle commands",
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Category != out[j].Category {
			return out[i].Category < out[j].Category
		}
		return out[i].Key < out[j].Key
	})
	return out
}

func matchesFleetPath(pattern, actual string) bool {
	patternParts := strings.Split(strings.Trim(pattern, "/"), "/")
	actualParts := strings.Split(strings.Trim(actual, "/"), "/")
	if len(patternParts) != len(actualParts) {
		return false
	}
	for i, part := range patternParts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			if actualParts[i] == "" {
				return false
			}
		} else if part != actualParts[i] {
			return false
		}
	}
	return true
}

// fleetEndpointKeys returns all individually gated sub-endpoints represented
// by one request. Empty keys with a recognized route means an invalid query.
func fleetEndpointKeys(method, path string) ([]string, bool) {
	u, err := url.Parse(path)
	if err != nil {
		return nil, false
	}
	if method == http.MethodGet && matchesFleetPath("/api/1/vehicles/{vin}/vehicle_data", u.Path) {
		raw := ""
		seen := false
		for _, part := range strings.Split(u.RawQuery, "&") {
			key, value, present := strings.Cut(part, "=")
			if key != "endpoints" {
				continue
			}
			if seen || !present {
				return nil, true
			}
			seen = true
			raw, err = url.QueryUnescape(value)
			if err != nil {
				return nil, true
			}
		}
		if !seen {
			raw = "charge_state;climate_state;drive_state;location_data;vehicle_state;vehicle_config"
		}
		var keys []string
		used := map[string]bool{}
		for _, name := range strings.Split(raw, ";") {
			key := "vehicle_data." + name
			if used[key] || !knownFleetEndpoint(key) {
				return nil, true
			}
			used[key] = true
			keys = append(keys, key)
		}
		return keys, true
	}
	for _, endpoint := range fleetCatalog {
		if strings.HasPrefix(endpoint.Key, "vehicle_data.") {
			continue
		}
		if endpoint.Method == method && matchesFleetPath(strings.SplitN(endpoint.Path, "?", 2)[0], u.Path) {
			return []string{endpoint.Key}, true
		}
	}
	return nil, false
}

func knownFleetEndpoint(key string) bool {
	for _, entry := range fleetDataEndpoints {
		if entry.Key == key {
			return true
		}
	}
	return false
}
