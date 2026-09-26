package tesla

import (
	"context"
	"errors"
	"fmt"
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
	keys, known := fleetEndpointKeys(method, path)
	if !known || len(keys) == 0 {
		return fmt.Errorf("%w: unrecognized Fleet API operation %s", ErrEndpointDisabled, method)
	}
	pc, err := reader.GetEndpointControls(ctx)
	if err != nil {
		return fmt.Errorf("endpoint controls unavailable: %w", err)
	}
	for _, key := range keys {
		if !pc.EndpointEnabled(key) || (ctx.Value(automaticPollingKey{}) == true && !pc.PollsEndpoint(key)) {
			return fmt.Errorf("%w: %s", ErrEndpointDisabled, key)
		}
	}
	return nil
}
