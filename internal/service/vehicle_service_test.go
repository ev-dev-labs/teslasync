package service

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// fakeStateReader is an in-memory SignalStateReader used to drive the
// BuildStateFromSignalStore fallback paths under test. It records every call
// for assertion and returns a pre-canned snapshot map / error.
type fakeStateReader struct {
	mu            sync.Mutex
	snapshot      signal.State
	err           error
	calls         int
	lastVehicleID int64
	lastAt        time.Time
}

func (f *fakeStateReader) State(_ context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.lastVehicleID = vehicleID
	f.lastAt = at
	if f.err != nil {
		return nil, f.err
	}
	out := make(signal.State, len(f.snapshot))
	for k, v := range f.snapshot {
		out[k] = v
	}
	return out, nil
}

// newSvc builds a VehicleService wired only with the bits the fallback path
// touches: the SignalStateReader. stateRepo is intentionally nil so the
// test never reaches a real database; BuildStateFromSignalStore must guard
// the call. This also doubles as a guard for ADR-001 — if the implementation
// secretly tried to read a snapshot table through positionRepo/securityRepo
// it would nil-pointer-panic here.
func newSvc(reader SignalStateReader) *VehicleService {
	svc := &VehicleService{}
	if reader != nil {
		svc.WithStateReader(reader)
	}
	return svc
}

func newStore(t *testing.T, vehicleID int64, signals map[string]interface{}) *signal.Store {
	t.Helper()
	st := signal.New()
	if len(signals) > 0 {
		st.Update(vehicleID, signals)
	}
	return st
}

// TestBuildStateFromSignalStore_LiveValuesAlwaysWin proves the fallback never
// overrides values the live store already supplied (R1).
func TestBuildStateFromSignalStore_LiveValuesAlwaysWin(t *testing.T) {
	const vehicleID int64 = 7
	store := newStore(t, vehicleID, map[string]interface{}{
		"Odometer":     99999.9,
		"InsideTemp":   21.5,
		"OutsideTemp":  15.0,
		"Version":      "2026.4.1",
		"BatteryLevel": float64(80),
		"VehicleSpeed": 42.0,
	})
	fake := &fakeStateReader{snapshot: signal.State{
		"Odometer":    12345.6,
		"InsideTemp":  22.7,
		"OutsideTemp": 18.0,
		"Version":     "2026.8.6",
	}}
	svc := newSvc(fake)

	state := svc.BuildStateFromSignalStore(store, &models.Vehicle{ID: vehicleID})

	if state.Odometer != 99999.9 {
		t.Errorf("Odometer: live should win, got %v", state.Odometer)
	}
	if state.InsideTemp != 21.5 {
		t.Errorf("InsideTemp: live should win, got %v", state.InsideTemp)
	}
	if state.OutsideTemp != 15.0 {
		t.Errorf("OutsideTemp: live should win, got %v", state.OutsideTemp)
	}
	if state.SoftwareVersion != "2026.4.1" {
		t.Errorf("SoftwareVersion: live should win, got %q", state.SoftwareVersion)
	}
	if state.BatteryLevel != 80 {
		t.Errorf("BatteryLevel: live should win, got %v", state.BatteryLevel)
	}
	if state.Speed != 42.0 {
		t.Errorf("Speed: live should win, got %v", state.Speed)
	}
	if fake.calls > 1 {
		t.Errorf("State calls: expected 0 or 1, got %d", fake.calls)
	}
}

// TestBuildStateFromSignalStore_FillsZeroFieldsFromSignalLog is the headline
// contract — fields the live store left at zero are filled from signal_log
// (R2, R6).
func TestBuildStateFromSignalStore_FillsZeroFieldsFromSignalLog(t *testing.T) {
	const vehicleID int64 = 7
	store := newStore(t, vehicleID, map[string]interface{}{
		"BatteryLevel": float64(55),
		"VehicleSpeed": 30.0,
	})
	fake := &fakeStateReader{snapshot: signal.State{
		"Odometer":          12345.6,
		"InsideTemp":        22.7,
		"OutsideTemp":       18.0,
		"Version":           "2026.8.6",
		"IdealBatteryRange": 310.0,
		"RatedRange":        305.0,
		"Latitude":          37.4419,
		"Longitude":         -122.1430,
	}}
	svc := newSvc(fake)

	before := time.Now().UTC()
	state := svc.BuildStateFromSignalStore(store, &models.Vehicle{ID: vehicleID})
	after := time.Now().UTC()

	if state.Odometer != 12345.6 {
		t.Errorf("Odometer: want 12345.6 from signal_log, got %v", state.Odometer)
	}
	if state.InsideTemp != 22.7 {
		t.Errorf("InsideTemp: want 22.7 from signal_log, got %v", state.InsideTemp)
	}
	if state.OutsideTemp != 18.0 {
		t.Errorf("OutsideTemp: want 18.0 from signal_log, got %v", state.OutsideTemp)
	}
	if state.SoftwareVersion != "2026.8.6" {
		t.Errorf("SoftwareVersion: want 2026.8.6 from signal_log, got %q", state.SoftwareVersion)
	}
	if state.IdealRange != 310.0 {
		t.Errorf("IdealRange: want 310.0, got %v", state.IdealRange)
	}
	if state.RatedRange != 305.0 {
		t.Errorf("RatedRange: want 305.0, got %v", state.RatedRange)
	}
	if state.Latitude != 37.4419 {
		t.Errorf("Latitude: want 37.4419, got %v", state.Latitude)
	}
	if state.Longitude != -122.1430 {
		t.Errorf("Longitude: want -122.1430, got %v", state.Longitude)
	}
	if state.BatteryLevel != 55 {
		t.Errorf("BatteryLevel: live should be preserved, got %v", state.BatteryLevel)
	}
	if state.Speed != 30.0 {
		t.Errorf("Speed: live should be preserved, got %v", state.Speed)
	}

	if fake.calls != 1 {
		t.Errorf("State calls: want 1, got %d", fake.calls)
	}
	if fake.lastVehicleID != vehicleID {
		t.Errorf("State vehicleID: want %d, got %d", vehicleID, fake.lastVehicleID)
	}
	if fake.lastAt.Before(before.Add(-2*time.Second)) || fake.lastAt.After(after.Add(2*time.Second)) {
		t.Errorf("State at: want within ±2s of now, got %v (now ≈ %v)", fake.lastAt, before)
	}
}

// TestBuildStateFromSignalStore_MissingSignalsStayAtGoZero proves missing
// signals do not panic and stay at the Go zero value (R3).
func TestBuildStateFromSignalStore_MissingSignalsStayAtGoZero(t *testing.T) {
	const vehicleID int64 = 7
	store := newStore(t, vehicleID, nil)
	fake := &fakeStateReader{snapshot: signal.State{
		"Odometer": 42.0,
	}}
	svc := newSvc(fake)

	state := svc.BuildStateFromSignalStore(store, &models.Vehicle{ID: vehicleID})

	if state.Odometer != 42.0 {
		t.Errorf("Odometer: want 42.0, got %v", state.Odometer)
	}
	if state.InsideTemp != 0 {
		t.Errorf("InsideTemp: want 0 (no entry → Go zero), got %v", state.InsideTemp)
	}
	if state.OutsideTemp != 0 {
		t.Errorf("OutsideTemp: want 0, got %v", state.OutsideTemp)
	}
	if state.SoftwareVersion != "" {
		t.Errorf("SoftwareVersion: want empty, got %q", state.SoftwareVersion)
	}
	if state.IdealRange != 0 {
		t.Errorf("IdealRange: want 0, got %v", state.IdealRange)
	}
	if state.RatedRange != 0 {
		t.Errorf("RatedRange: want 0, got %v", state.RatedRange)
	}
	if state.Latitude != 0 {
		t.Errorf("Latitude: want 0, got %v", state.Latitude)
	}
	if state.Longitude != 0 {
		t.Errorf("Longitude: want 0, got %v", state.Longitude)
	}
}

// TestBuildStateFromSignalStore_SignalLogReadErrorIsTolerated proves the
// reader error is logged at Warn but not propagated, and live data survives
// (R4).
func TestBuildStateFromSignalStore_SignalLogReadErrorIsTolerated(t *testing.T) {
	const vehicleID int64 = 7
	store := newStore(t, vehicleID, map[string]interface{}{
		"Odometer": 12345.0,
	})
	sentinel := errors.New("snapshot at: read fail — sentinel")
	fake := &fakeStateReader{err: sentinel}
	svc := newSvc(fake)

	// Capture zerolog output to assert the warning was emitted.
	var buf bytes.Buffer
	prev := log.Logger
	log.Logger = zerolog.New(&buf).Level(zerolog.DebugLevel)
	t.Cleanup(func() { log.Logger = prev })

	state := svc.BuildStateFromSignalStore(store, &models.Vehicle{ID: vehicleID})

	if state == nil {
		t.Fatal("BuildStateFromSignalStore must never return nil — handler must still 200")
	}
	if state.Odometer != 12345.0 {
		t.Errorf("Odometer: live data must be preserved on reader error, got %v", state.Odometer)
	}
	logged := buf.String()
	if !strings.Contains(logged, "snapshot at: read fail") {
		t.Errorf("expected sentinel error in log output, got %q", logged)
	}
	if !strings.Contains(logged, `"level":"warn"`) {
		t.Errorf("expected warn level in log output, got %q", logged)
	}
}

// TestBuildStateFromSignalStore_NoSignalLogReaderConfigured proves legacy
// callers that never wire a reader keep working unchanged (R5).
func TestBuildStateFromSignalStore_NoSignalLogReaderConfigured(t *testing.T) {
	const vehicleID int64 = 7
	store := newStore(t, vehicleID, map[string]interface{}{
		"BatteryLevel": float64(42),
	})
	svc := newSvc(nil) // no SignalLogReader

	state := svc.BuildStateFromSignalStore(store, &models.Vehicle{ID: vehicleID})

	if state.BatteryLevel != 42 {
		t.Errorf("BatteryLevel: want 42 from live, got %v", state.BatteryLevel)
	}
	if state.Odometer != 0 {
		t.Errorf("Odometer: want 0 (no fallback), got %v", state.Odometer)
	}
	if state.InsideTemp != 0 {
		t.Errorf("InsideTemp: want 0 (no fallback), got %v", state.InsideTemp)
	}
}

// TestBuildStateFromSignalStore_FieldToSignalNameMapping table-drives every
// signal-name → state-field mapping (R6).
func TestBuildStateFromSignalStore_FieldToSignalNameMapping(t *testing.T) {
	const vehicleID int64 = 7

	type tc struct {
		name    string
		signals signal.State
		check   func(*testing.T, *models.VehicleState)
	}
	cases := []tc{
		{"Odometer", signal.State{"Odometer": 12345.6},
			func(t *testing.T, s *models.VehicleState) {
				if s.Odometer != 12345.6 {
					t.Errorf("Odometer: got %v", s.Odometer)
				}
			}},
		{"InsideTemp", signal.State{"InsideTemp": 22.7},
			func(t *testing.T, s *models.VehicleState) {
				if s.InsideTemp != 22.7 {
					t.Errorf("InsideTemp: got %v", s.InsideTemp)
				}
			}},
		{"OutsideTemp", signal.State{"OutsideTemp": 18.0},
			func(t *testing.T, s *models.VehicleState) {
				if s.OutsideTemp != 18.0 {
					t.Errorf("OutsideTemp: got %v", s.OutsideTemp)
				}
			}},
		{"SoftwareVersion (Version)", signal.State{"Version": "2026.8.6"},
			func(t *testing.T, s *models.VehicleState) {
				if s.SoftwareVersion != "2026.8.6" {
					t.Errorf("SoftwareVersion: got %q", s.SoftwareVersion)
				}
			}},
		{"SoftwareVersion (SoftwareUpdateVersion fallback)",
			signal.State{"SoftwareUpdateVersion": "2026.9.0"},
			func(t *testing.T, s *models.VehicleState) {
				if s.SoftwareVersion != "2026.9.0" {
					t.Errorf("SoftwareVersion: secondary fallback failed, got %q", s.SoftwareVersion)
				}
			}},
		{"IdealRange", signal.State{"IdealBatteryRange": 310.0},
			func(t *testing.T, s *models.VehicleState) {
				if s.IdealRange != 310.0 {
					t.Errorf("IdealRange: got %v", s.IdealRange)
				}
			}},
		{"RatedRange (RatedRange)", signal.State{"RatedRange": 305.0},
			func(t *testing.T, s *models.VehicleState) {
				if s.RatedRange != 305.0 {
					t.Errorf("RatedRange: got %v", s.RatedRange)
				}
			}},
		{"RatedRange (EstBatteryRange fallback)",
			signal.State{"EstBatteryRange": 290.0},
			func(t *testing.T, s *models.VehicleState) {
				if s.RatedRange != 290.0 {
					t.Errorf("RatedRange: secondary fallback failed, got %v", s.RatedRange)
				}
			}},
		{"Latitude", signal.State{"Latitude": 37.4419},
			func(t *testing.T, s *models.VehicleState) {
				if s.Latitude != 37.4419 {
					t.Errorf("Latitude: got %v", s.Latitude)
				}
			}},
		{"Longitude", signal.State{"Longitude": -122.143},
			func(t *testing.T, s *models.VehicleState) {
				if s.Longitude != -122.143 {
					t.Errorf("Longitude: got %v", s.Longitude)
				}
			}},
		{"BatteryLevel (BatteryLevel)", signal.State{"BatteryLevel": 80.0},
			func(t *testing.T, s *models.VehicleState) {
				if s.BatteryLevel != 80 {
					t.Errorf("BatteryLevel: got %v", s.BatteryLevel)
				}
			}},
		{"BatteryLevel (Soc fallback)", signal.State{"Soc": 65.0},
			func(t *testing.T, s *models.VehicleState) {
				if s.BatteryLevel != 65 {
					t.Errorf("BatteryLevel: Soc fallback failed, got %v", s.BatteryLevel)
				}
			}},
		{"Speed", signal.State{"VehicleSpeed": 42.0},
			func(t *testing.T, s *models.VehicleState) {
				if s.Speed != 42.0 {
					t.Errorf("Speed: got %v", s.Speed)
				}
			}},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			store := newStore(t, vehicleID, nil)
			fake := &fakeStateReader{snapshot: c.signals}
			svc := newSvc(fake)
			state := svc.BuildStateFromSignalStore(store, &models.Vehicle{ID: vehicleID})
			c.check(t, state)
		})
	}
}

// TestBuildStateFromSignalStore_DoesNotReadSnapshotTables verifies that
// BuildStateFromSignalStore reaches for *no* repository besides the optional
// stateRepo + the SignalStateReader. It does so by constructing a service
// with every repo nil — any attempt to query positionRepo, securityRepo,
// vehicleRepo, settingsRepo, etc. would nil-pointer-panic. ADR-001 anchor:
// only signal_log, no snapshot table reads.
func TestBuildStateFromSignalStore_DoesNotReadSnapshotTables(t *testing.T) {
	const vehicleID int64 = 7
	store := newStore(t, vehicleID, map[string]interface{}{
		"BatteryLevel": float64(55),
		"VehicleSpeed": 30.0,
	})
	fake := &fakeStateReader{snapshot: signal.State{
		"Odometer":   12345.6,
		"InsideTemp": 22.7,
	}}
	svc := newSvc(fake) // positionRepo, securityRepo, stateRepo, etc. all nil

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("BuildStateFromSignalStore touched a snapshot-table repo (panic: %v)", r)
		}
	}()

	state := svc.BuildStateFromSignalStore(store, &models.Vehicle{ID: vehicleID})

	if state.Odometer != 12345.6 {
		t.Errorf("Odometer: signal_log fallback failed, got %v", state.Odometer)
	}
	if state.BatteryLevel != 55 {
		t.Errorf("BatteryLevel: live preserved, got %v", state.BatteryLevel)
	}
	if fake.calls != 1 {
		t.Errorf("State: want exactly 1 call, got %d", fake.calls)
	}
}
