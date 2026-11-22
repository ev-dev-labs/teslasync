package tesla

import (
	"context"
	"errors"
	"fmt"
)

var ErrEndpointDisabled = errors.New("Tesla Fleet API endpoint disabled")

type automaticPollingKey struct{}
type smartFeaturesKey struct{}

type apiSuspensionReader interface {
	IsAPISuspended(context.Context) (bool, error)
}

// AutomaticPollingContext distinguishes worker discovery/snapshots from
// user-triggered discovery and vehicle data, which have independent controls.
func AutomaticPollingContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, automaticPollingKey{}, true)
}

func smartFeaturesContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, smartFeaturesKey{}, true)
}

func isSmartFeaturesRequest(ctx context.Context) bool {
	return ctx.Value(smartFeaturesKey{}) == true
}

func (c *Client) endpointControlsReader() EndpointControlsReader {
	c.budgetMu.RLock()
	defer c.budgetMu.RUnlock()
	return c.endpointControls
}

// CheckSmartFleetEndpoints preflights the operations a feature needs before it
// fetches credentials or enables a dependent action. The transport checks again.
func (c *Client) CheckSmartFleetEndpoints(ctx context.Context, keys ...string) error {
	return checkEndpointKeys(smartFeaturesContext(ctx), c.endpointControlsReader(), keys)
}

func (c *Client) checkEndpointControls(ctx context.Context, method, path string) error {
	reader := c.endpointControlsReader()
	if reader == nil && !isSmartFeaturesRequest(ctx) {
		return nil // Standalone clients have no controls for manual requests.
	}
	keys, known := fleetEndpointKeys(method, path)
	if !known || len(keys) == 0 {
		return fmt.Errorf("%w: unrecognized Fleet API operation %s", ErrEndpointDisabled, method)
	}
	return checkEndpointKeys(ctx, reader, keys)
}

func checkEndpointKeys(ctx context.Context, reader EndpointControlsReader, keys []string) error {
	if reader == nil || len(keys) == 0 {
		return ErrEndpointDisabled
	}
	pc, err := reader.GetEndpointControls(ctx)
	if err != nil {
		return fmt.Errorf("endpoint controls unavailable: %w", err)
	}
	for _, key := range keys {
		if !pc.EndpointEnabled(key) ||
			(ctx.Value(automaticPollingKey{}) == true && !pc.PollsEndpoint(key)) ||
			(isSmartFeaturesRequest(ctx) && !pc.SmartEndpoints[key]) {
			return fmt.Errorf("%w: %s", ErrEndpointDisabled, key)
		}
	}
	if isSmartFeaturesRequest(ctx) {
		suspension, ok := reader.(apiSuspensionReader)
		if !ok {
			return ErrEndpointDisabled
		}
		suspended, err := suspension.IsAPISuspended(ctx)
		if err != nil {
			return fmt.Errorf("Fleet API suspension unavailable: %w", err)
		}
		if suspended {
			return fmt.Errorf("%w: Fleet API suspended", ErrEndpointDisabled)
		}
	}
	return nil
}
