package widgetdesign

import "context"

type Repository interface {
	// Get returns nil, nil for an absent preference.
	Get(ctx context.Context, scope string) (*string, error)
	Put(ctx context.Context, scope, packID string) error
}
