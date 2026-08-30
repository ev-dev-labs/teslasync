package signal_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// stubLiveSignalStore records each read preference so tests can assert that
// LiveStateReader uses the distributed path rather than local-only reads.
type stubLiveSignalStore struct {
	values         map[string]*signal.Value
	getAllErr      error
	getSignalErr   error
	lastPreference signal.LiveSignalReadPreference
	signalCalls    int
}

func (s *stubLiveSignalStore) Update(_ context.Context, _ int64, _ map[string]interface{}) error {
	return nil
}

func (s *stubLiveSignalStore) UpdateNonBlocking(_ context.Context, _ int64, _ map[string]interface{}) error {
	return nil
}

func (s *stubLiveSignalStore) UpdateValuesNonBlocking(_ context.Context, _ int64, _ map[string]*signal.Value) error {
	return nil
}

func (s *stubLiveSignalStore) GetSignal(_ context.Context, _ int64, name string, pref signal.LiveSignalReadPreference) (*signal.Value, error) {
	s.signalCalls++
	s.lastPreference = pref
	if s.getSignalErr != nil {
		return nil, s.getSignalErr
	}
	if v, ok := s.values[name]; ok {
		return v, nil
	}
	return nil, nil
}

func (s *stubLiveSignalStore) GetAll(_ context.Context, _ int64, pref signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	s.lastPreference = pref
	if s.getAllErr != nil {
		return nil, s.getAllErr
	}
	out := make(map[string]*signal.Value, len(s.values))
	for k, v := range s.values {
		out[k] = v
	}
	return out, nil
}

func (s *stubLiveSignalStore) Warm(_ context.Context, _ int64) error { return nil }
func (s *stubLiveSignalStore) LocalVehicleIDs() []int64              { return nil }

// stubStateReader is a minimal StateReader for fallback assertions.
type stubStateReader struct {
	state    signal.State
	signals  map[string]signal.SignalValue
	stateErr error
}

func (s *stubStateReader) State(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
	if s.stateErr != nil {
		return nil, s.stateErr
	}
	out := signal.State{}
	for k, v := range s.state {
		out[k] = v
	}
	return out, nil
}

func (s *stubStateReader) SignalAt(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
	if s.stateErr != nil {
		return nil, s.stateErr
	}
	if v, ok := s.signals[name]; ok {
		return v, nil
	}
	return nil, nil
}

func (s *stubStateReader) Timeline(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

func TestNewLiveStateReader_NilLive(t *testing.T) {
	if _, err := signal.NewLiveStateReader(nil, &stubStateReader{}); !errors.Is(err, signal.ErrNilLiveSignalStore) {
		t.Fatalf("expected ErrNilLiveSignalStore, got %v", err)
	}
}

func TestLiveStateReader_LiveState_UsesDistributedPreference(t *testing.T) {
	live := &stubLiveSignalStore{values: map[string]*signal.Value{
		"BatteryLevel": {Raw: 87.0, Timestamp: time.Now()},
	}}
	r, err := signal.NewLiveStateReader(live, nil)
	if err != nil {
		t.Fatalf("NewLiveStateReader: %v", err)
	}
	if _, err := r.LiveState(context.Background(), 1); err != nil {
		t.Fatalf("LiveState: %v", err)
	}
	if live.lastPreference != signal.LiveSignalReadDistributed {
		t.Fatalf("expected LiveSignalReadDistributed, got %v", live.lastPreference)
	}
}

func TestLiveStateReader_LiveState_FillsMissingFromFallback(t *testing.T) {
	live := &stubLiveSignalStore{values: map[string]*signal.Value{
		"BatteryLevel": {Raw: 87.0, Timestamp: time.Now()},
	}}
	cold := &stubStateReader{state: signal.State{
		"Latitude":     34.5,
		"Longitude":    -121.7,
		"BatteryLevel": 50.0, // must NOT override the live value
	}}
	r, err := signal.NewLiveStateReader(live, cold)
	if err != nil {
		t.Fatalf("NewLiveStateReader: %v", err)
	}
	state, err := r.LiveState(context.Background(), 1)
	if err != nil {
		t.Fatalf("LiveState: %v", err)
	}
	if state["BatteryLevel"].(float64) != 87.0 {
		t.Fatalf("live value must win for BatteryLevel; got %v", state["BatteryLevel"])
	}
	if state["Latitude"].(float64) != 34.5 {
		t.Fatalf("expected fallback Latitude, got %v", state["Latitude"])
	}
	if state["Longitude"].(float64) != -121.7 {
		t.Fatalf("expected fallback Longitude, got %v", state["Longitude"])
	}
}

func TestLiveStateReader_LiveState_NilLiveValueSkipped(t *testing.T) {
	// A LiveSignalStore implementation might return a map containing nil
	// values for keys it has historically seen; the reader must skip those.
	live := &stubLiveSignalStore{values: map[string]*signal.Value{
		"BatteryLevel": nil,
		"Soc":          {Raw: 75.0, Timestamp: time.Now()},
	}}
	r, _ := signal.NewLiveStateReader(live, nil)
	state, err := r.LiveState(context.Background(), 1)
	if err != nil {
		t.Fatalf("LiveState: %v", err)
	}
	if _, ok := state["BatteryLevel"]; ok {
		t.Fatalf("nil live value must be skipped, got %v", state["BatteryLevel"])
	}
	if state["Soc"].(float64) != 75.0 {
		t.Fatalf("expected Soc=75.0, got %v", state["Soc"])
	}
}

func TestLiveStateReader_LiveState_LiveErrorSurfaces(t *testing.T) {
	live := &stubLiveSignalStore{getAllErr: errors.New("redis down")}
	r, _ := signal.NewLiveStateReader(live, &stubStateReader{})
	if _, err := r.LiveState(context.Background(), 1); err == nil {
		t.Fatalf("expected error when live layer fails")
	}
}

func TestLiveStateReader_LiveSignal_LiveWinsOverFallback(t *testing.T) {
	live := &stubLiveSignalStore{values: map[string]*signal.Value{
		"InsideTemp": {Raw: 22.5, Timestamp: time.Now()},
	}}
	cold := &stubStateReader{signals: map[string]signal.SignalValue{
		"InsideTemp": 18.0,
	}}
	r, _ := signal.NewLiveStateReader(live, cold)
	v, err := r.LiveSignal(context.Background(), 1, "InsideTemp")
	if err != nil {
		t.Fatalf("LiveSignal: %v", err)
	}
	if v.(float64) != 22.5 {
		t.Fatalf("expected 22.5, got %v", v)
	}
}

func TestLiveStateReader_LiveSignal_FallbackWhenLiveAbsent(t *testing.T) {
	live := &stubLiveSignalStore{values: map[string]*signal.Value{}}
	cold := &stubStateReader{signals: map[string]signal.SignalValue{
		"Latitude": 34.5,
	}}
	r, _ := signal.NewLiveStateReader(live, cold)
	v, err := r.LiveSignal(context.Background(), 1, "Latitude")
	if err != nil {
		t.Fatalf("LiveSignal: %v", err)
	}
	if v.(float64) != 34.5 {
		t.Fatalf("expected 34.5, got %v", v)
	}
}

func TestLiveStateReader_LiveSignal_AllAbsentReturnsNilNil(t *testing.T) {
	live := &stubLiveSignalStore{values: map[string]*signal.Value{}}
	cold := &stubStateReader{signals: map[string]signal.SignalValue{}}
	r, _ := signal.NewLiveStateReader(live, cold)
	v, err := r.LiveSignal(context.Background(), 1, "Whatever")
	if err != nil {
		t.Fatalf("LiveSignal: %v", err)
	}
	if v != nil {
		t.Fatalf("expected nil, got %v", v)
	}
}

func TestLiveStateReader_LiveSignal_NoFallback(t *testing.T) {
	live := &stubLiveSignalStore{values: map[string]*signal.Value{}}
	r, _ := signal.NewLiveStateReader(live, nil)
	v, err := r.LiveSignal(context.Background(), 1, "Whatever")
	if err != nil {
		t.Fatalf("LiveSignal: %v", err)
	}
	if v != nil {
		t.Fatalf("expected nil with no fallback, got %v", v)
	}
}
