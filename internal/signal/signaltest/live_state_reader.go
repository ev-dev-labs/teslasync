// Package signaltest provides test doubles for the signal package boundaries
// (LiveStateReader, StateReader). They are intended for use in handler tests
// where wiring a real signal.Store + RedisSignalCache + signal_log path is
// disproportionate to the unit under test.
package signaltest

import (
	"context"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// FakeLiveStateReader is a mutex-safe in-memory implementation of
// signal.LiveStateReader for handler tests.
type FakeLiveStateReader struct {
	mu sync.RWMutex
	// state per vehicleID; values are the opaque payload (numbers, bools,
	// strings, structured maps) just as a handler would receive them.
	state map[int64]map[string]signal.SignalValue
	// err lets a test trigger transport-failure paths.
	err error
}

// NewFakeLiveStateReader returns an empty fake.
func NewFakeLiveStateReader() *FakeLiveStateReader {
	return &FakeLiveStateReader{state: make(map[int64]map[string]signal.SignalValue)}
}

// Set stores a signal value for vehicleID. Pass value=nil to delete.
func (f *FakeLiveStateReader) Set(vehicleID int64, name string, value signal.SignalValue) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.state[vehicleID] == nil {
		f.state[vehicleID] = make(map[string]signal.SignalValue)
	}
	if value == nil {
		delete(f.state[vehicleID], name)
		return
	}
	f.state[vehicleID][name] = value
}

// SetMany stores multiple signal values for vehicleID in one call.
func (f *FakeLiveStateReader) SetMany(vehicleID int64, signals map[string]signal.SignalValue) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.state[vehicleID] == nil {
		f.state[vehicleID] = make(map[string]signal.SignalValue)
	}
	for k, v := range signals {
		if v == nil {
			delete(f.state[vehicleID], k)
			continue
		}
		f.state[vehicleID][k] = v
	}
}

// Reset clears all per-vehicle state.
func (f *FakeLiveStateReader) Reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.state = make(map[int64]map[string]signal.SignalValue)
	f.err = nil
}

// SetError causes subsequent calls to return err.
func (f *FakeLiveStateReader) SetError(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

// LiveState returns a copy of the per-vehicle state map. The returned map
// is owned by the caller per the LiveStateReader contract.
func (f *FakeLiveStateReader) LiveState(_ context.Context, vehicleID int64) (signal.State, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	if f.err != nil {
		return nil, f.err
	}
	out := signal.State{}
	for k, v := range f.state[vehicleID] {
		out[k] = v
	}
	return out, nil
}

// LiveSignal returns the value of one signal for vehicleID, or (nil, nil)
// when not present.
func (f *FakeLiveStateReader) LiveSignal(_ context.Context, vehicleID int64, name string) (signal.SignalValue, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	if f.err != nil {
		return nil, f.err
	}
	if m, ok := f.state[vehicleID]; ok {
		if v, ok := m[name]; ok {
			return v, nil
		}
	}
	return nil, nil
}

// Compile-time conformance check.
var _ signal.LiveStateReader = (*FakeLiveStateReader)(nil)
