package api

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	signal "github.com/ev-dev-labs/teslasync/internal/signal"
)

// aiSettingsReader adapts *database.SettingsRepo to the
// provider.SettingsReader port. The repo natively exposes
// AIMode + AIFeatureEnabled (cheap single-row PK lookups). The
// AIProviderConfig accessor is implemented here by calling
// the existing typed Get() and pulling out the AIProviderConfig
// JSONB field — keeping the repo single-purpose (R5 mitigation)
// and avoiding a settings-repo migration in slice F1.
type aiSettingsReader struct {
	repo *database.SettingsRepo
}

func (a aiSettingsReader) AIMode(ctx context.Context) (string, error) {
	return a.repo.AIMode(ctx)
}

func (a aiSettingsReader) AIFeatureEnabled(ctx context.Context, featureID string) (bool, error) {
	return a.repo.AIFeatureEnabled(ctx, featureID)
}

func (a aiSettingsReader) AIProviderConfig(ctx context.Context) (map[string]any, error) {
	s, err := a.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	if s == nil || s.AIProviderConfig == nil {
		return map[string]any{}, nil
	}
	return s.AIProviderConfig, nil
}

// aiToolsStateAdapter bridges signal.StateReader (whose SignalAt
// returns signal.SignalValue, a defined type whose underlying type
// is any) to ai/tools.VehicleStateSource (whose SignalAt returns
// any). Go interface satisfaction is by type identity, not
// underlying-type compatibility, so a tiny wrapper is the minimal
// safe bridge.
//
// The adapter forwards the call verbatim; the implicit conversion
// from SignalValue to any is the entire bridge. Any future change
// to either signature will surface here as a compile error before
// the AI handler ships.
type aiToolsStateAdapter struct {
	r signal.StateReader
}

// SignalAt implements ai/tools.VehicleStateSource.
func (a aiToolsStateAdapter) SignalAt(ctx context.Context, vehicleID int64, name string, at time.Time) (any, error) {
	return a.r.SignalAt(ctx, vehicleID, name, at)
}
