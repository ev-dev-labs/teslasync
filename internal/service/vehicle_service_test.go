package service

import (
	"bytes"
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

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

// newSvc builds a VehicleService wired only with the SignalStateReader used
// by the fallback path. The other fields stay nil so any hidden snapshot-table
// read through positionRepo, vehicleRepo, or stateProvider would panic and fail
// the ADR-001 guard.
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

	state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})

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
		"LocationLatitude":  37.4419,
		"LocationLongitude": -122.1430,
	}}
	svc := newSvc(fake)

	before := time.Now().UTC()
	state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})
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

func TestBuildStateFromSignalStoreWithProvenanceTracksWinningSources(t *testing.T) {
	const vehicleID int64 = 17
	observedAt := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	store := signal.New()
	store.Set(vehicleID, "BatteryLevel", 82.0, observedAt)
	store.Set(vehicleID, "VehicleSpeed", 0.0, observedAt)
	store.Set(vehicleID, "LocationLatitude", 37.4, observedAt)
	store.Set(vehicleID, "LocationLongitude", -122.1, observedAt)
	// A legacy bare coordinate must not override the canonical flattened
	// signal, even when the compatibility value was hydrated later.
	store.Hydrate(vehicleID, map[string]interface{}{"Latitude": 40.0})

	reader := &fakeStateReader{snapshot: signal.State{
		"VehicleSpeed": 31.0,
		"BatteryLevel": 55.0,
	}}
	svc := newSvc(reader)
	state, verified := svc.BuildStateFromSignalStoreWithProvenance(
		store,
		&vehiclemodel.Vehicle{ID: vehicleID},
	)

	if state.BatteryLevel != 82 || !verified["battery_level"] {
		t.Fatalf("battery = %d, verified=%v; want live 82 verified", state.BatteryLevel, verified["battery_level"])
	}
	if state.Speed != 0 || !verified["speed"] {
		t.Fatalf("speed = %v, verified=%v; want observed live zero", state.Speed, verified["speed"])
	}
	if state.Latitude != 37.4 || !verified["latitude"] {
		t.Fatalf("latitude = %v, verified=%v; want canonical live coordinate", state.Latitude, verified["latitude"])
	}
	if state.Longitude != -122.1 || !verified["longitude"] {
		t.Fatalf("longitude = %v, verified=%v; want live composite verified", state.Longitude, verified["longitude"])
	}
	if verified["state"] {
		t.Fatal("state provenance was fabricated by the assembler")
	}
}

func TestBuildStateFromSignalStoreWithProvenanceHonorsLiveFallbackPrecedence(t *testing.T) {
	const vehicleID int64 = 18
	observedAt := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	store := signal.New()
	store.Set(vehicleID, "BatteryLevel", 0.0, observedAt)
	store.Set(vehicleID, "RatedRange", 0.0, observedAt)
	store.Set(vehicleID, "InsideTemp", 0.0, observedAt)
	store.Set(vehicleID, "DetailedChargeState", "Disconnected", observedAt)
	store.Hydrate(vehicleID, map[string]interface{}{"ChargeAmps": 32.0})

	reader := &fakeStateReader{snapshot: signal.State{
		"BatteryLevel": 82.0,
		"RatedRange":   300_000.0,
		"InsideTemp":   21.0,
	}}
	state, verified := newSvc(reader).BuildStateFromSignalStoreWithProvenance(
		store,
		&vehiclemodel.Vehicle{ID: vehicleID},
	)

	if state.BatteryLevel != 0 || !verified["battery_level"] {
		t.Fatalf("battery = %d, verified=%v; want observed live zero", state.BatteryLevel, verified["battery_level"])
	}
	if state.RatedRange != 0 || !verified["rated_range"] {
		t.Fatalf("range = %v, verified=%v; want observed live zero", state.RatedRange, verified["rated_range"])
	}
	if state.InsideTemp != 0 || !verified["inside_temp"] {
		t.Fatalf("inside temp = %v, verified=%v; want observed live zero", state.InsideTemp, verified["inside_temp"])
	}
	if state.IsCharging || !verified["is_charging"] {
		t.Fatalf("charging = %v, verified=%v; want observed disconnected state", state.IsCharging, verified["is_charging"])
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

	state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})

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

	state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})

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

	state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})

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
		check   func(*testing.T, *vehiclemodel.VehicleState)
	}
	cases := []tc{
		{"Odometer", signal.State{"Odometer": 12345.6},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.Odometer != 12345.6 {
					t.Errorf("Odometer: got %v", s.Odometer)
				}
			}},
		{"InsideTemp", signal.State{"InsideTemp": 22.7},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.InsideTemp != 22.7 {
					t.Errorf("InsideTemp: got %v", s.InsideTemp)
				}
			}},
		{"OutsideTemp", signal.State{"OutsideTemp": 18.0},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.OutsideTemp != 18.0 {
					t.Errorf("OutsideTemp: got %v", s.OutsideTemp)
				}
			}},
		{"SoftwareVersion (Version)", signal.State{"Version": "2026.8.6"},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.SoftwareVersion != "2026.8.6" {
					t.Errorf("SoftwareVersion: got %q", s.SoftwareVersion)
				}
			}},
		{"SoftwareVersion (SoftwareUpdateVersion fallback)",
			signal.State{"SoftwareUpdateVersion": "2026.9.0"},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.SoftwareVersion != "2026.9.0" {
					t.Errorf("SoftwareVersion: secondary fallback failed, got %q", s.SoftwareVersion)
				}
			}},
		{"IdealRange", signal.State{"IdealBatteryRange": 310.0},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.IdealRange != 310.0 {
					t.Errorf("IdealRange: got %v", s.IdealRange)
				}
			}},
		{"RatedRange (RatedRange)", signal.State{"RatedRange": 305.0},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.RatedRange != 305.0 {
					t.Errorf("RatedRange: got %v", s.RatedRange)
				}
			}},
		{"RatedRange (EstBatteryRange fallback)",
			signal.State{"EstBatteryRange": 290.0},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.RatedRange != 290.0 {
					t.Errorf("RatedRange: secondary fallback failed, got %v", s.RatedRange)
				}
			}},
		{"LocationLatitude", signal.State{"LocationLatitude": 37.4419},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.Latitude != 37.4419 {
					t.Errorf("Latitude: got %v", s.Latitude)
				}
			}},
		{"LocationLongitude", signal.State{"LocationLongitude": -122.143},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.Longitude != -122.143 {
					t.Errorf("Longitude: got %v", s.Longitude)
				}
			}},
		{"Latitude legacy fallback", signal.State{"Latitude": 37.4419},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.Latitude != 37.4419 {
					t.Errorf("Latitude legacy fallback: got %v", s.Latitude)
				}
			}},
		{"Longitude legacy fallback", signal.State{"Longitude": -122.143},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.Longitude != -122.143 {
					t.Errorf("Longitude legacy fallback: got %v", s.Longitude)
				}
			}},
		{"BatteryLevel (BatteryLevel)", signal.State{"BatteryLevel": 80.0},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.BatteryLevel != 80 {
					t.Errorf("BatteryLevel: got %v", s.BatteryLevel)
				}
			}},
		{"BatteryLevel (Soc fallback)", signal.State{"Soc": 65.0},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
				if s.BatteryLevel != 65 {
					t.Errorf("BatteryLevel: Soc fallback failed, got %v", s.BatteryLevel)
				}
			}},
		{"Speed", signal.State{"VehicleSpeed": 42.0},
			func(t *testing.T, s *vehiclemodel.VehicleState) {
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
			state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})
			c.check(t, state)
		})
	}
}

// TestBuildStateFromSignalStore_DoesNotReadSnapshotTables verifies that
// BuildStateFromSignalStore reaches for *no* repository besides the optional
// stateProvider + the SignalStateReader. It does so by constructing a service
// with every field nil — any attempt to query positionRepo, vehicleRepo,
// settingsRepo, etc. would nil-pointer-panic. ADR-001 anchor: only signal_log,
// no snapshot table reads.
//
// stateProvider stays nil here and must remain guarded by its receiver checks.
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
	svc := newSvc(fake) // positionRepo, stateProvider, etc. all nil

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("BuildStateFromSignalStore touched a snapshot-table repo (panic: %v)", r)
		}
	}()

	state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})

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

// TestBuildStateFromSignalStore_AcceptsCodecNumericTypes is the regression
// for the dashboard-blank bug: the codec stores Float5 fields as float32 and
// Int3/Int4 fields as int32, but the projection layer was narrowing to
// float64 only and silently dropping those values. Every numeric kind the
// codec emits must land in VehicleState through signal.Float64.
//
// If this test fails after a future codec change, the answer is to extend
// internal/signal/coerce.go (and re-run this test), NOT to add a new
// type-specific branch in vehicle_service.go.
func TestBuildStateFromSignalStore_AcceptsPhase42CodecNumericTypes(t *testing.T) {
	const vehicleID int64 = 7
	store := newStore(t, vehicleID, map[string]interface{}{
		// Float5 codec fields → float32 in the live store
		"VehicleSpeed":          float32(42.5),
		"Odometer":              float32(98765.5),
		"IdealBatteryRange":     float32(310.25),
		"RatedRange":            float32(305.5),
		"InsideTemp":            float32(22.75),
		"OutsideTemp":           float32(14.5),
		"LocationLatitude":      float32(37.4419),
		"LocationLongitude":     float32(-122.143),
		"ACChargingPower":       float32(7200),
		"ChargeRateMilePerHour": float32(28.5),
		"TimeToFullCharge":      float32(2.5),
		// Int3/Int4 codec fields → int32 in the live store
		"BatteryLevel": int32(72),
		"GpsHeading":   int32(180),
	})
	svc := newSvc(nil)
	state := svc.BuildStateFromSignalStore(store, &vehiclemodel.Vehicle{ID: vehicleID})

	tol := func(name string, got, want float64) {
		t.Helper()
		if diff := got - want; diff > 0.01 || diff < -0.01 {
			t.Errorf("%s: float32→float64 round-trip failed; got %v want ≈%v", name, got, want)
		}
	}
	tol("Speed", state.Speed, 42.5)
	tol("Odometer", state.Odometer, 98765.5)
	tol("IdealRange", state.IdealRange, 310.25)
	tol("RatedRange", state.RatedRange, 305.5)
	tol("InsideTemp", state.InsideTemp, 22.75)
	tol("OutsideTemp", state.OutsideTemp, 14.5)
	tol("Latitude", state.Latitude, 37.4419)
	tol("Longitude", state.Longitude, -122.143)
	tol("ChargerPower", state.ChargerPower, 7.2)
	tol("ChargeRate", state.ChargeRate, 28.5)
	tol("TimeToFullChg", state.TimeToFullChg, 2.5)

	if state.BatteryLevel != 72 {
		t.Errorf("BatteryLevel: int32 narrowing failed, got %v want 72", state.BatteryLevel)
	}
	if state.Heading == nil || *state.Heading != 180 {
		got := "nil"
		if state.Heading != nil {
			got = strconv.FormatFloat(*state.Heading, 'f', -1, 64)
		}
		t.Errorf("Heading: int32 narrowing failed, got %s want 180", got)
	}
}
