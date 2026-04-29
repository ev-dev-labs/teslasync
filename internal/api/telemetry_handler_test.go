package api

import (
	"context"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestTelemetryHandlerUpdateLiveSignalsUpdatesL1WithoutRedis(t *testing.T) {
	ctx := context.Background()
	local := signal.New()
	liveStore, err := signal.NewHybridLiveSignalStore(local, nil, signal.LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	handler := &TelemetryHandler{
		signalStore:     local,
		liveSignalStore: liveStore,
	}

	handler.updateLiveSignals(ctx, 101, map[string]interface{}{"Gear": "D"})

	value := local.Get(101, "Gear")
	if value == nil || value.Raw != "D" {
		t.Fatalf("SignalStore Gear = %#v, want D", value)
	}
}

func TestTelemetryHandlerUpdateLiveSignalsUsesLiveStoreOnceForRedisMirror(t *testing.T) {
	ctx := context.Background()
	liveStore := &recordingLiveSignalStore{}
	handler := &TelemetryHandler{liveSignalStore: liveStore}
	signals := map[string]interface{}{"BatteryLevel": 72.0}

	handler.updateLiveSignals(ctx, 102, signals)

	if liveStore.updateNonBlockingCalls != 1 {
		t.Fatalf("UpdateNonBlocking calls = %d, want 1", liveStore.updateNonBlockingCalls)
	}
	if liveStore.vehicleID != 102 {
		t.Fatalf("vehicleID = %d, want 102", liveStore.vehicleID)
	}
	if got := liveStore.signals["BatteryLevel"]; got != 72.0 {
		t.Fatalf("BatteryLevel = %#v, want 72", got)
	}
}

func TestTelemetryHandlerUpdateLiveSignalsLogsRedisFailureAfterL1Update(t *testing.T) {
	ctx := context.Background()
	local := signal.New()
	liveStore := &recordingLiveSignalStore{
		local: local,
		err:   errRecordingRedisFailure,
	}
	handler := &TelemetryHandler{
		signalStore:     local,
		liveSignalStore: liveStore,
	}

	handler.updateLiveSignals(ctx, 103, map[string]interface{}{"Gear": "R"})

	value := local.Get(103, "Gear")
	if value == nil || value.Raw != "R" {
		t.Fatalf("SignalStore Gear after Redis failure = %#v, want R", value)
	}
	if liveStore.updateNonBlockingCalls != 1 {
		t.Fatalf("UpdateNonBlocking calls = %d, want 1", liveStore.updateNonBlockingCalls)
	}
}

var errRecordingRedisFailure = &recordingRedisFailureError{}

type recordingRedisFailureError struct{}

func (e *recordingRedisFailureError) Error() string {
	return "redis unavailable"
}

type recordingLiveSignalStore struct {
	local                  *signal.Store
	err                    error
	updateNonBlockingCalls int
	vehicleID              int64
	signals                map[string]interface{}
}

func (s *recordingLiveSignalStore) Update(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	return s.record(vehicleID, signals)
}

func (s *recordingLiveSignalStore) UpdateNonBlocking(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	if err := s.record(vehicleID, signals); err != nil {
		return err
	}
	return s.err
}

func (s *recordingLiveSignalStore) GetSignal(ctx context.Context, vehicleID int64, name string, preference signal.LiveSignalReadPreference) (*signal.Value, error) {
	return nil, nil
}

func (s *recordingLiveSignalStore) GetAll(ctx context.Context, vehicleID int64, preference signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	return nil, nil
}

func (s *recordingLiveSignalStore) Warm(ctx context.Context, vehicleID int64) error {
	return nil
}

func (s *recordingLiveSignalStore) LocalVehicleIDs() []int64 {
	return nil
}

func (s *recordingLiveSignalStore) record(vehicleID int64, signals map[string]interface{}) error {
	s.updateNonBlockingCalls++
	s.vehicleID = vehicleID
	s.signals = make(map[string]interface{}, len(signals))
	for name, value := range signals {
		s.signals[name] = value
	}
	if s.local != nil {
		s.local.Update(vehicleID, signals)
	}
	return nil
}
