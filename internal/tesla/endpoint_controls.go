package tesla

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

var ErrEndpointDisabled = errors.New("Tesla Fleet API endpoint disabled")

type automaticPollingKey struct{}

// AutomaticPollingContext distinguishes worker discovery/snapshots from
// user-triggered discovery and vehicle data, which have independent controls.
func AutomaticPollingContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, automaticPollingKey{}, true)
}

func (c *Client) checkEndpointControls(ctx context.Context, method, path string) error {
	c.budgetMu.RLock()
	reader := c.endpointControls
	c.budgetMu.RUnlock()
	if reader == nil {
		return nil // Standalone clients have no settings store.
	}
	// Only operations represented by endpoint controls require a settings read.
	// Other Fleet API operations (auth, fleet telemetry, diagnostics) are unaffected.
	if !controlledFleetPath(method, path) {
		return nil
	}
	pc, err := reader.GetEndpointControls(ctx)
	if err != nil {
		return fmt.Errorf("endpoint controls unavailable: %w", err)
	}
	if !pc.AllowsFleetOperation(method, path, ctx.Value(automaticPollingKey{}) == true) {
		return ErrEndpointDisabled
	}
	return nil
}

func controlledFleetPath(method, path string) bool {
	if method == http.MethodGet && (path == "/api/1/vehicles" ||
		containsFleetEndpoint(path, "/vehicle_data") ||
		containsFleetEndpoint(path, "/nearby_charging_sites") ||
		containsFleetEndpoint(path, "/release_notes") ||
		containsFleetEndpoint(path, "/recent_alerts") ||
		containsFleetEndpoint(path, "/service_data")) {
		return true
	}
	return method == http.MethodPost &&
		(containsFleetEndpoint(path, "/wake_up") || containsFleetEndpoint(path, "/command/"))
}

func containsFleetEndpoint(path, suffix string) bool {
	return strings.HasPrefix(path, "/api/1/vehicles/") &&
		strings.Contains(strings.SplitN(path, "?", 2)[0], suffix)
}
