package app

import (
	"context"
	"fmt"

	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	sigsvc "github.com/ev-dev-labs/teslasync/internal/signal"
	teslapipeline "github.com/ev-dev-labs/teslasync/internal/tesla_pipeline"
)

// liveSignalStoreAdapter bridges signal.LiveSignalStore (whose
// per-payload write method is UpdateNonBlocking and whose snapshot
// reader is GetAll(...) (map[string]*Value, error)) to the
// teslapipeline.LiveSignalStore interface (UpdateAll +
// GetAll(...) (map[string]any, error)). The two have identical
// semantics — the rename + Value-unwrap exists so the teslapipeline
// package can describe the contract in its own vocabulary without
// depending on the internal/signal naming conventions or the
// signal.Value envelope shape.
type liveSignalStoreAdapter struct {
	store sigsvc.LiveSignalStore
}

func (a *liveSignalStoreAdapter) UpdateAll(ctx context.Context, vehicleID int64, signals map[string]teslapipeline.TimedSignal) error {
	values := make(map[string]*sigsvc.Value, len(signals))
	for name, value := range signals {
		values[name] = &sigsvc.Value{Raw: value.Value, Timestamp: value.EmittedAt}
	}
	return a.store.UpdateValuesNonBlocking(ctx, vehicleID, values)
}

// GetAll returns the cross-batch snapshot of all signals the live
// store has accumulated for the vehicle. The bridge invokes this
// AFTER UpdateAll to construct the `accumulated` argument
// SessionTracker + AlertEvaluator need under per-field MQTT (where
// each payload carries one atomic and the per-payload signals map
// alone is insufficient for "use last-known battery / odometer /
// location" decisions).
//
// LiveSignalReadDistributed is used so the snapshot includes both
// L1 (in-process) and L2 (Redis) state — important for multi-pod
// deployments where the FSM/session state for a vehicle may have
// been populated by a prior payload routed to a different pod.
//
// Returns nil + nil when the live store has no state for the
// vehicle (first message ever); the bridge handles this by
// falling back to the per-payload signals map.
func (a *liveSignalStoreAdapter) GetAll(ctx context.Context, vehicleID int64) (map[string]any, error) {
	values, err := a.store.GetAll(ctx, vehicleID, sigsvc.LiveSignalReadDistributed)
	if err != nil {
		return nil, fmt.Errorf("phase-42a liveStore GetAll: %w", err)
	}
	if len(values) == 0 {
		return nil, nil
	}
	out := make(map[string]any, len(values))
	for k, v := range values {
		if v == nil {
			continue
		}
		out[k] = v.Raw
	}
	return out, nil
}

// vinByIDResolver bridges *vehicledb.VehicleRepo (whose lookup returns
// the full *vehiclemodel.Vehicle) to the teslapipeline.VINResolver
// interface (which only needs the VIN string). Returns a wrapped
// "vehicle not registered" error when the row is nil so the
// SideEffectsObserver's WARN log includes enough context for triage
// without leaking the VIN itself; the legacy AlertEvaluator + session
// tracker handle the same case identically.
type vinByIDResolver struct {
	repo *vehicledb.VehicleRepo
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
