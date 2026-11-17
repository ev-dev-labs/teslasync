package widgetdesign

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/widgetdesign"
)

type Repository interface {
	// Get returns nil, nil for an absent preference.
	Get(ctx context.Context, scope string) (*widgetdesign.Preference, error)
	// A nil appWide preserves an existing opt-in when an older client saves.
	Put(ctx context.Context, scope, packID string, appWide *bool) (widgetdesign.Preference, error)
}
