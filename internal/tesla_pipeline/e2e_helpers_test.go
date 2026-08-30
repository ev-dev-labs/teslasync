// Shared fakes used by e2e_test.go to exercise the full normalize.Pipeline +
// router.Router + SideEffectsObserver chain without touching a real PostgreSQL
// pool, Redis, MQTT broker, or HTTP server.
//
// The tests use in-memory recording fakes because pgxmock and testcontainers
// are not dependencies. This drops actual DB INSERT verification but still
// exercises routing and observer side effects.
//
// Type names use the `e2e` prefix to avoid collisions with fakes in
// side_effects_observer_test.go.
//
// All fakes are concurrency-safe: every test in e2e_test.go calls t.Parallel()
// and the fakes share no global state.
package teslapipeline

import (
	"context"
	"fmt"
	"sync"
	"time"

	ftproto "github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// e2eVehicleID is the canonical numeric vehicle id used by every e2e
// test. Tests that need a different id must declare their own; sharing
// one keeps the fixture concise and lets the recording fakes
// trivially compare expected vs observed.
const e2eVehicleID int64 = 4242

// e2eVIN is the canonical 17-character Tesla VIN string used by every
// e2e test. The codec layer populates codec.Atomic.VehicleID from
// Payload.Vin verbatim, so this string also appears unchanged on
// every routed atomic.
const e2eVIN = "5YJ3E1EA0KFE2EE2E"

// e2eEmittedAt is the canonical Payload.CreatedAt the fixtures use.
// All unit-history pre-seeds use a window that contains this instant
// so unit-bearing fields convert successfully on Repo.At lookup.
var e2eEmittedAt = time.Date(2026, time.May, 6, 12, 0, 0, 0, time.UTC)

// ---------------------------------------------------------------------------
// e2eRecordingWriter — single fake satisfying router.Writer
// ---------------------------------------------------------------------------

// e2eWriteCall captures the per-write tuple the test asserts: vehicle id
// (carried as VIN on the atomic), timestamp, field, value, and the routing entry
// that dispatched it.
type e2eWriteCall struct {
	Field     string
	Value     any
	EmittedAt time.Time
	VIN       string
	Entry     router.Entry
}

// e2eRecordingWriter implements router.Writer by recording every Write call.
// Failure injection is covered by router_test.go and
// side_effects_observer_test.go, not this end-to-end test.
type e2eRecordingWriter struct {
	mu    sync.Mutex
	calls []e2eWriteCall
}

func (w *e2eRecordingWriter) Write(_ context.Context, atomic codec.Atomic, dst router.Entry) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.calls = append(w.calls, e2eWriteCall{
		Field:     atomic.Field,
		Value:     atomic.Value,
		EmittedAt: atomic.EmittedAt,
		VIN:       atomic.VehicleID,
		Entry:     dst,
	})
	return nil
}

// callsCopy returns a snapshot of the writer's recorded calls so
// tests can iterate without holding the lock.
func (w *e2eRecordingWriter) callsCopy() []e2eWriteCall {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]e2eWriteCall, len(w.calls))
	copy(out, w.calls)
	return out
}

// callForField returns the first recorded call with the given field
// name, or nil if no such call was recorded. Tests use this to assert
// the per-destination sentinel reached the right writer.
func (w *e2eRecordingWriter) callForField(field string) *e2eWriteCall {
	w.mu.Lock()
	defer w.mu.Unlock()
	for i := range w.calls {
		if w.calls[i].Field == field {
			return &w.calls[i]
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// e2eHistRepo — fake unithistory.Repo that pre-seeds unit context
// ---------------------------------------------------------------------------

// e2eHistRepo is the in-memory unithistory.Repo used by every e2e
// test. It is structurally similar to fakeRepo in
// internal/tesla/normalize/normalize_test.go, but lives here because
// that fake is package-private to normalize and the e2e test sits in
// teslapipeline. The duplication is the lesser evil — a shared
// helper package would couple normalize tests to teslapipeline.
//
// At returns ErrNotFound when no row with effective_from <= t exists
// (matching the production pgRepo contract); Record appends and is
// also recorded so the per-destination assertion can verify the
// SettingDistanceUnit atomic landed in the unit-history layer. The
// unit_history router writer is a no-op; the actual Setting*Unit side effect
// happens here.
type e2eHistRepo struct {
	mu      sync.Mutex
	entries []unithistory.Entry
	records []unithistory.Entry
}

func (r *e2eHistRepo) Record(_ context.Context, e unithistory.Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = append(r.entries, e)
	r.records = append(r.records, e)
	return nil
}

func (r *e2eHistRepo) At(_ context.Context, vehicleID int64, kind unithistory.Kind, t time.Time) (units.ActiveUnit, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best *unithistory.Entry
	for i := range r.entries {
		e := &r.entries[i]
		if e.VehicleID != vehicleID || e.Kind != kind {
			continue
		}
		if e.EffectiveFrom.After(t) {
			continue
		}
		if best == nil || e.EffectiveFrom.After(best.EffectiveFrom) {
			best = e
		}
	}
	if best == nil {
		return "", unithistory.ErrNotFound
	}
	return best.Value, nil
}

func (r *e2eHistRepo) Latest(_ context.Context, vehicleID int64, kind unithistory.Kind) (unithistory.Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best *unithistory.Entry
	for i := range r.entries {
		e := &r.entries[i]
		if e.VehicleID != vehicleID || e.Kind != kind {
			continue
		}
		if best == nil || e.EffectiveFrom.After(best.EffectiveFrom) {
			best = e
		}
	}
	if best == nil {
		return unithistory.Entry{}, unithistory.ErrNotFound
	}
	return *best, nil
}

// recordsCopy returns a snapshot of every Record call. The DestUnitHistory
// assertion checks for a SettingDistanceUnit Record here because the routed
// Setting*Unit atomic short-circuits before reaching router.Route in
// normalize.Pipeline.processOne.
func (r *e2eHistRepo) recordsCopy() []unithistory.Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]unithistory.Entry, len(r.records))
	copy(out, r.records)
	return out
}

// preSeedActiveUnits seeds the repo with one row per (Kind) at an
// effective_from preceding e2eEmittedAt, so Repo.At lookups for the
// three unit-bearing Kinds (Distance, Temperature, Pressure) all
// return a deterministic ActiveUnit and unit-bearing atomics in the
// e2e fixture convert without ErrNoUnitContext.
//
// Choice of units (km, C, bar) is arbitrary but documented:
//   - km matches the SettingDistanceUnit=km atomic in the payload so
//     a test asserting "the payload kept the active unit" need not
//     differ from the pre-seed.
//   - C because InsideTemp's wire value is already in C and the
//     identity conversion makes the SI sentinel verifiable.
//   - bar is defensive only — present so a future fixture extension
//     that adds TpmsPressureFl converts cleanly.
func (r *e2eHistRepo) preSeedActiveUnits(vehicleID int64, before time.Time) {
	seedAt := before.Add(-time.Hour)
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, seed := range []struct {
		kind  unithistory.Kind
		value units.ActiveUnit
	}{
		{unithistory.KindDistance, units.ActiveUnitKilometers},
		{unithistory.KindTemperature, units.ActiveUnitCelsius},
		{unithistory.KindPressure, units.ActiveUnitBar},
	} {
		r.entries = append(r.entries, unithistory.Entry{
			VehicleID:     vehicleID,
			Kind:          seed.kind,
			Value:         seed.value,
			EffectiveFrom: seedAt,
			Source:        unithistory.SourceRESTBootstrap,
		})
	}
}

// ---------------------------------------------------------------------------
// SideEffectsObserver fakes — one recorder per callback (e2e prefix)
// ---------------------------------------------------------------------------

// e2eLiveCall records a LiveSignalStore.UpdateAll invocation.
type e2eLiveCall struct {
	VehicleID int64
	Signals   map[string]any
}

// e2eLiveStore satisfies LiveSignalStore. UpdateAll never errors;
// failure-injection is exercised in side_effects_observer_test.go.
// GetAll returns the union of every UpdateAll call so tests that
// assert on the cross-batch accumulated snapshot see the full
// state — matching the production HybridLiveSignalStore semantics.
type e2eLiveStore struct {
	mu    sync.Mutex
	calls []e2eLiveCall
	state map[int64]map[string]any
}

func (s *e2eLiveStore) UpdateAll(_ context.Context, vehicleID int64, timedSignals map[string]TimedSignal) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	signals := make(map[string]any, len(timedSignals))
	for name, value := range timedSignals {
		signals[name] = value.Value
	}
	// Defensive copy — the Pipeline reuses the same signals map across
	// observers, so a recorder that retains the live reference would
	// race with the next test (or, in production, with later
	// observers that read the map).
	s.calls = append(s.calls, e2eLiveCall{VehicleID: vehicleID, Signals: copyAnyMapE2E(signals)})
	if s.state == nil {
		s.state = make(map[int64]map[string]any)
	}
	veh, ok := s.state[vehicleID]
	if !ok {
		veh = make(map[string]any, len(signals))
		s.state[vehicleID] = veh
	}
	for k, v := range signals {
		veh[k] = v
	}
	return nil
}

func (s *e2eLiveStore) GetAll(_ context.Context, vehicleID int64) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	veh, ok := s.state[vehicleID]
	if !ok {
		return nil, nil
	}
	return copyAnyMapE2E(veh), nil
}

func (s *e2eLiveStore) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

func (s *e2eLiveStore) lastCall() *e2eLiveCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.calls) == 0 {
		return nil
	}
	c := s.calls[len(s.calls)-1]
	return &c
}

// e2eFSMCall records an FSMHandler.ProcessSignals invocation.
type e2eFSMCall struct {
	VehicleID int64
	Signals   map[string]any
}

type e2eFSM struct {
	mu    sync.Mutex
	calls []e2eFSMCall
}

func (f *e2eFSM) ProcessSignals(_ context.Context, vehicleID int64, signals map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, e2eFSMCall{VehicleID: vehicleID, Signals: copyAnyMapE2E(signals)})
}

func (f *e2eFSM) ProcessSignalsAt(ctx context.Context, vehicleID int64, signals map[string]any, _ time.Time, _ map[string]time.Time) {
	f.ProcessSignals(ctx, vehicleID, signals)
}

func (f *e2eFSM) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

// e2eSessionCall records a SessionTracker.ProcessSignals invocation.
type e2eSessionCall struct {
	VehicleID   int64
	VIN         string
	Signals     map[string]any
	Accumulated map[string]any
}

type e2eSessions struct {
	mu    sync.Mutex
	calls []e2eSessionCall
}

func (s *e2eSessions) ProcessSignals(_ context.Context, vehicleID int64, vin string, signals, accumulated map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, e2eSessionCall{
		VehicleID:   vehicleID,
		VIN:         vin,
		Signals:     copyAnyMapE2E(signals),
		Accumulated: copyAnyMapE2E(accumulated),
	})
}

func (s *e2eSessions) ProcessSignalsAt(ctx context.Context, vehicleID int64, vin string, signals, accumulated map[string]any, _ time.Time, _ map[string]time.Time) {
	s.ProcessSignals(ctx, vehicleID, vin, signals, accumulated)
}

func (s *e2eSessions) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

// e2eAlertCall records an AlertEvaluator.Evaluate invocation.
type e2eAlertCall struct {
	VehicleID   int64
	VIN         string
	Signals     map[string]any
	Accumulated map[string]any
}

type e2eAlerts struct {
	mu    sync.Mutex
	calls []e2eAlertCall
}

func (a *e2eAlerts) Evaluate(_ context.Context, vehicleID int64, vin string, signals, accumulated map[string]any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls = append(a.calls, e2eAlertCall{
		VehicleID:   vehicleID,
		VIN:         vin,
		Signals:     copyAnyMapE2E(signals),
		Accumulated: copyAnyMapE2E(accumulated),
	})
}

func (a *e2eAlerts) callCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.calls)
}

// e2eVINResolver satisfies VINResolver by returning a fixed VIN for
// e2eVehicleID and an error otherwise. Tests that want to exercise
// the "VIN lookup failed" branch swap in a different resolver.
type e2eVINResolver struct {
	vin       string
	vehicleID int64
}

func (v *e2eVINResolver) VINByID(_ context.Context, vehicleID int64) (string, error) {
	if vehicleID != v.vehicleID {
		return "", fmt.Errorf("e2eVINResolver: vehicle %d not registered", vehicleID)
	}
	return v.vin, nil
}

// e2eSSECall records a BroadcastSSEFunc invocation.
type e2eSSECall struct {
	Payload map[string]any
}

// e2eSSE captures the broadcast payload via the broadcast method
// which is wired into BroadcastSSEFunc by callers.
type e2eSSE struct {
	mu    sync.Mutex
	calls []e2eSSECall
}

func (s *e2eSSE) broadcast(_ context.Context, payload map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, e2eSSECall{Payload: copyAnyMapE2E(payload)})
}

func (s *e2eSSE) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

// ---------------------------------------------------------------------------
// payload-fixture builder
// ---------------------------------------------------------------------------

// e2eFixturePayload returns the bytes for a real Tesla
// fleet-telemetry Payload carrying one routed sentinel field per
// destination in the closed router.Destination set, EXCEPT
// DestLocationSnapshot which is exempt because routing.yaml has zero
//
//	`dest: location_snapshot` entries today. Geocoder writes via a separate
//	path; LocationWriter exists to satisfy router.New's "writer-required"
//	invariant. The exemption is documented in
//
// e2e_test.go's === TEST_DESIGN === block.
//
// The 11 sentinel fields cover:
//   - DestPositions             via Location compound flatten ->
//     LocationLatitude / LocationLongitude (LocationLatitude is the
//     declared sentinel; LocationLongitude is a free-rider)
//   - DestClimateSnapshot       InsideTemp (UnitKindTemperature, pre-
//     seeded to ActiveUnitCelsius so identity SI conversion succeeds)
//   - DestSecurityEvent         Locked (bool)
//   - DestMotorSnapshot         DiTorqueActualF (float)
//   - DestTirePressure          TpmsLastSeenPressureTimeFl (float epoch
//     seconds — UnitKindNone so no conversion needed)
//   - DestMediaSnapshot         MediaNowPlayingTitle (string)
//   - DestSafetySnapshot        ServiceMode (bool)
//   - DestChargingTelemetry     BatteryHeaterOn (bool)
//   - DestDriveTelemetry        BrakePedal (bool)
//   - DestSignalLog             AutomaticBlindSpotCamera (bool — only
//     dest:signal_log among the routing.yaml entries that won't trip a
//     dual-write surprise; see plan.md for the picking rationale)
//   - DestUnitHistory           SettingDistanceUnit=km (handled inside
//     normalize.Pipeline.observeSettingUnit, never reaches the
//     unit_history writer, which is a no-op)
//
// All values are fixed sentinels in this file so the assertions in
// e2e_test.go can compare ==. UnitKindTemperature/Distance fields use
// values whose SI form is independently verifiable.
func e2eFixturePayload() ([]byte, error) {
	p := &ftproto.Payload{
		Vin:       e2eVIN,
		CreatedAt: timestamppb.New(e2eEmittedAt),
		Data: []*ftproto.Datum{
			// SettingDistanceUnit FIRST so the codec preserves
			// Payload-order; the SettingUnitFirst sort inside
			// normalize.Pipeline.processAtomics is what gives the
			// invariant guarantee, but emitting it first matches the
			// ordering Tesla typically uses in production payloads.
			{
				Key: ftproto.Field_SettingDistanceUnit,
				Value: &ftproto.Value{Value: &ftproto.Value_DistanceUnitValue{
					DistanceUnitValue: ftproto.DistanceUnit_DistanceUnitKilometers,
				}},
			},
			// DestPositions: Location compound flattens to
			// LocationLatitude + LocationLongitude.
			{
				Key: ftproto.Field_Location,
				Value: &ftproto.Value{Value: &ftproto.Value_LocationValue{
					LocationValue: &ftproto.LocationValue{
						Latitude:  37.7749,
						Longitude: -122.4194,
					},
				}},
			},
			// DestClimateSnapshot: InsideTemp 25.0 in active unit C
			// -> SI 25.0 (identity).
			{
				Key:   ftproto.Field_InsideTemp,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 25.0}},
			},
			// DestSecurityEvent: Locked true.
			{
				Key:   ftproto.Field_Locked,
				Value: &ftproto.Value{Value: &ftproto.Value_BooleanValue{BooleanValue: true}},
			},
			// DestMotorSnapshot: DiTorqueActualF 100.5 Nm.
			{
				Key:   ftproto.Field_DiTorqueActualF,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 100.5}},
			},
			// DestTirePressure: TpmsLastSeenPressureTimeFl epoch
			// seconds (UnitKindNone — the writer converts to
			// TIMESTAMPTZ at the boundary, no normalize toSI step).
			{
				Key:   ftproto.Field_TpmsLastSeenPressureTimeFl,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 1714896000.0}},
			},
			// DestMediaSnapshot: MediaNowPlayingTitle string.
			{
				Key:   ftproto.Field_MediaNowPlayingTitle,
				Value: &ftproto.Value{Value: &ftproto.Value_StringValue{StringValue: "E2E Test Track"}},
			},
			// DestSafetySnapshot: ServiceMode true.
			{
				Key:   ftproto.Field_ServiceMode,
				Value: &ftproto.Value{Value: &ftproto.Value_BooleanValue{BooleanValue: true}},
			},
			// DestChargingTelemetry: BatteryHeaterOn true.
			{
				Key:   ftproto.Field_BatteryHeaterOn,
				Value: &ftproto.Value{Value: &ftproto.Value_BooleanValue{BooleanValue: true}},
			},
			// DestDriveTelemetry: BrakePedal true.
			{
				Key:   ftproto.Field_BrakePedal,
				Value: &ftproto.Value{Value: &ftproto.Value_BooleanValue{BooleanValue: true}},
			},
			// DestSignalLog: AutomaticBlindSpotCamera true.
			{
				Key:   ftproto.Field_AutomaticBlindSpotCamera,
				Value: &ftproto.Value{Value: &ftproto.Value_BooleanValue{BooleanValue: true}},
			},
		},
	}
	return proto.Marshal(p)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// copyAnyMapE2E returns a shallow copy of m. The fakes use this when
// recording the per-payload signals map so the test assertions are
// not invalidated by a future mutation upstream of the recorder.
// Named with the e2e suffix to avoid colliding with a similarly-
// purposed helper in side_effects_observer_test.go (none exists today
// but the suffix keeps drift safety).
func copyAnyMapE2E(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
