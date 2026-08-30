package signal

import "context"

// NoopLiveSignalStore is a LiveSignalStore that holds no state. It is used
// by router wiring when no real L1+L2 store has been provisioned (e.g., a
// test router slice that does not exercise telemetry, or a degraded-mode
// startup where TelemetryHandler is nil). It returns empty maps, never
// errors, and silently accepts writes.
//
// LiveStateReader composes this with a real StateReader fallback so the
// /latest endpoints continue to surface signal_log values when the live
// layer is absent.
type NoopLiveSignalStore struct{}

// NewNoopLiveSignalStore returns the canonical no-op LiveSignalStore.
func NewNoopLiveSignalStore() *NoopLiveSignalStore { return &NoopLiveSignalStore{} }

func (*NoopLiveSignalStore) Update(_ context.Context, _ int64, _ map[string]interface{}) error {
	return nil
}

func (*NoopLiveSignalStore) UpdateNonBlocking(_ context.Context, _ int64, _ map[string]interface{}) error {
	return nil
}

func (*NoopLiveSignalStore) UpdateValuesNonBlocking(_ context.Context, _ int64, _ map[string]*Value) error {
	return nil
}

func (*NoopLiveSignalStore) GetSignal(_ context.Context, _ int64, _ string, _ LiveSignalReadPreference) (*Value, error) {
	return nil, nil
}

func (*NoopLiveSignalStore) GetAll(_ context.Context, _ int64, _ LiveSignalReadPreference) (map[string]*Value, error) {
	return map[string]*Value{}, nil
}

func (*NoopLiveSignalStore) Warm(_ context.Context, _ int64) error { return nil }

func (*NoopLiveSignalStore) LocalVehicleIDs() []int64 { return nil }

// Compile-time conformance check.
var _ LiveSignalStore = (*NoopLiveSignalStore)(nil)
