package app

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"
	sigsvc "github.com/ev-dev-labs/teslasync/internal/signal"
)

// liveSignalStoreAdapter bridges signal.LiveSignalStore (whose
// per-payload write method is UpdateNonBlocking) to the
// teslapipeline.LiveSignalStore interface (whose method is named
// UpdateAll). The two have identical semantics — the rename exists so
// the teslapipeline package can describe the contract in its own
// vocabulary without depending on the internal/signal naming
// conventions. Wraps the legacy implementation verbatim; no behaviour
// change.
type liveSignalStoreAdapter struct {
	store sigsvc.LiveSignalStore
}

func (a *liveSignalStoreAdapter) UpdateAll(ctx context.Context, vehicleID int64, signals map[string]any) error {
	return a.store.UpdateNonBlocking(ctx, vehicleID, signals)
}

// vinByIDResolver bridges *database.VehicleRepo (whose lookup returns
// the full *models.Vehicle) to the teslapipeline.VINResolver
// interface (which only needs the VIN string). Returns a wrapped
// "vehicle not registered" error when the row is nil so the
// SideEffectsObserver's WARN log includes enough context for triage
// without leaking the VIN itself; the legacy AlertEvaluator + session
// tracker handle the same case identically.
type vinByIDResolver struct {
	repo *database.VehicleRepo
}

func (r *vinByIDResolver) VINByID(ctx context.Context, vehicleID int64) (string, error) {
	v, err := r.repo.GetByID(ctx, vehicleID)
	if err != nil {
		return "", fmt.Errorf("phase-42a vinByID: %w", err)
	}
	if v == nil {
		return "", fmt.Errorf("phase-42a vinByID: vehicle %d not registered", vehicleID)
	}
	return v.VIN, nil
}
