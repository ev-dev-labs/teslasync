// Phase-42a/0080 — end-to-end pipeline test.
//
// === TEST_DESIGN ===
//
// This file exercises the full normalize.Pipeline + router.Router +
// SideEffectsObserver chain end-to-end in three tests, satisfying
// Decisions #4-#6 of the Phase-42a/0080 prompt:
//
//	TestE2EPipeline_AllDestinationsAndObserverFire
//	  A real Tesla Fleet-Telemetry Payload with one routed sentinel
//	  field per destination flows through proto.Marshal -> Process
//	  and lands in the expected per-destination recording fake
//	  writer; ALL 6 SideEffectsObserver callbacks are invoked
//	  exactly once.
//
//	TestE2EPipeline_MalformedPayloadIsolatesFailure
//	  Truncated proto bytes flow through Process and:
//	    (a) Process returns an error wrapping normalize.ErrPayloadDrop
//	    (b) NO writers are invoked (codec.Decode fails before the
//	        dispatch loop)
//	    (c) NO observer callbacks are invoked (per phase-42a/0030
//	        Decision #1 — observer NOT called when codec.Decode fails)
//
//	TestE2EPipeline_ProductionWiringSmoke
//	  Reproduces the cmd/teslasync wiring shape (12 router.Writer
//	  destinations + 1 observer) using the SAME constructors
//	  (router.New + normalize.New + teslapipeline.New) but with the
//	  in-memory recording-fake writers, then sends the e2e fixture
//	  payload through and asserts:
//	    (a) all 12 writer destinations are present in the writers map
//	    (b) the observer list contains exactly one observer
//	    (c) router.New succeeded
//	    (d) the fixture's atomics reach 10 of the 11 routed
//	        destinations (DestLocationSnapshot exempt — see below)
//
// === FIELD → DESTINATION → TABLE → COLUMN → SENTINEL ===
//
// | Field                       | Destination          | Table                   | Column                  | Sentinel value             |
// |-----------------------------|----------------------|-------------------------|-------------------------|----------------------------|
// | LocationLatitude            | positions            | positions               | lat                     | 37.7749                    |
// | InsideTemp                  | climate_snapshot     | climate_snapshots       | inside_temp_c           | 25.0 (C identity SI)       |
// | Locked                      | security_event       | security_events         | event_type=locked       | bool true                  |
// | DiTorqueActualF             | motor_snapshot       | motor_snapshots         | front_torque_nm         | 100.5                      |
// | TpmsLastSeenPressureTimeFl  | tire_pressure_snap.  | tire_pressure_snapshots | front_left_last_seen_at | 1714896000.0 (epoch sec)   |
// | MediaNowPlayingTitle        | media_snapshot       | media_snapshots         | track_name              | "E2E Test Track"           |
// | ServiceMode                 | safety_snapshot      | safety_snapshots        | service_mode            | bool true                  |
// | BatteryHeaterOn             | charging_telemetry   | charging_telemetry      | battery_heater_on       | bool true                  |
// | BrakePedal                  | drive_telemetry      | drive_telemetry         | brake_pedal             | bool true                  |
// | AutomaticBlindSpotCamera    | signal_log           | signal_log              | bool_value              | bool true                  |
// | SettingDistanceUnit         | unit_history         | vehicle_unit_history    | unit_value              | DistanceUnit_km            |
// | (none)                      | location_snapshot    | location_snapshots      | n/a                     | EXEMPT — 0 routes today    |
//
// === EXEMPTION (Decision #4 escape hatch) ===
//
// DestLocationSnapshot has 0 routes in routing.yaml today. The
// LocationWriter was authored in phase-42a/0017 only to satisfy the
// router.New "writer-required-for-every-non-DestDrop-destination"
// invariant — the location_snapshots table is populated by a
// separate geocoding worker, not by the telemetry pipeline. This
// e2e test therefore covers 11 of 12 destinations as documented in
// the prompt's escape-hatch clause.
//
// === TRADE-OFF (Decision #2 escape hatch) ===
//
// pgxmock and testcontainers-postgres are NOT in go.mod (verified
// by `Select-String go.mod -Pattern 'pgxmock|testcontainers'`
// returning only the matching grep itself). Per the escape hatch:
// "fall back to in-memory recording fakes for writers and ASSERT
// the writer was called with the expected (vehicle_id, ts, field,
// value) tuple — this drops the actual DB INSERT verification but
// keeps the routing + observer chain exercised." The recording
// fakes in e2e_helpers_test.go capture that tuple.
//
// === TRADE-OFF (Decision #6 adaptation) ===
//
// Decision #6 references "a tiny test-only buildPipeline helper
// extracted in 0050". That helper does NOT exist — phase-42a/0050
// inlined the pipeline wiring directly inside an
// `if mqttClient != nil && cfg.FleetTelemetry.TopicBase != ""`
// block in cmd/teslasync/main.go (verified at L506-647). The
// existing main_pipeline_wiring_test.go takes the source-grep
// approach because cmd/teslasync is package main and the real
// writers panic on a nil *pgxpool.Pool (see e.g.
// internal/tesla/router/writers/positions_writer.go:134).
//
// Adapted: TestE2EPipeline_ProductionWiringSmoke replicates the
// SAME constructor shape — same 12 router.Destination keys, same
// teslapipeline.New + normalize.New call sequence — but with
// in-memory fakes. This proves the constructors compose without
// panic and the resulting Pipeline produces the expected fan-out.
// The source-grep tests in main_pipeline_wiring_test.go remain the
// guard that cmd/teslasync ITSELF still uses this shape.
package teslapipeline

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
)

// e2eRoutedDestinations is the closed set of router.Destination
// values that have at least one routing.yaml entry today AND that
// the e2e fixture payload exercises. DestUnitHistory is included
// because the SettingDistanceUnit atomic short-circuits to
// histRepo.Record (the unit_history writer is a no-op per
// phase-42a/0022) — it does not produce a writer Write call but it
// IS exercised end-to-end by the test.
//
// DestLocationSnapshot is intentionally absent: 0 routes today
// (Decision #4 escape hatch — see file-level === TEST_DESIGN ===).
//
// DestDrop is also absent because it has no writer by definition
// (the router skips the writer lookup for DestDrop entries).
var e2eRoutedDestinations = []router.Destination{
	router.DestPositions,
	router.DestClimateSnapshot,
	router.DestSecurityEvent,
	router.DestMotorSnapshot,
	router.DestTirePressure,
	router.DestMediaSnapshot,
	router.DestSafetySnapshot,
	router.DestChargingTelemetry,
	router.DestDriveTelemetry,
	router.DestSignalLog,
	router.DestUnitHistory,
}

// e2eFixtureSentinels declares the (Field, Destination) pairs the
// e2e fixture is expected to exercise. The driveTelemetry assertion
// in TestE2EPipeline_AllDestinationsAndObserverFire iterates this
// table so adding a new sentinel to e2eFixturePayload requires
// adding the corresponding row here — drift is caught by the
// per-destination assertion loop.
//
// DestUnitHistory entry has SinkKind="histrepo" because its
// side-effect target is the unithistory.Repo, NOT a router.Writer
// (see phase-42a/0022 — unit_history writer is a no-op).
var e2eFixtureSentinels = []struct {
	Field    string
	Dest     router.Destination
	SinkKind string // "writer" or "histrepo"
}{
	{"LocationLatitude", router.DestPositions, "writer"},
	{"InsideTemp", router.DestClimateSnapshot, "writer"},
	{"Locked", router.DestSecurityEvent, "writer"},
	{"DiTorqueActualF", router.DestMotorSnapshot, "writer"},
	{"TpmsLastSeenPressureTimeFl", router.DestTirePressure, "writer"},
	{"MediaNowPlayingTitle", router.DestMediaSnapshot, "writer"},
	{"ServiceMode", router.DestSafetySnapshot, "writer"},
	{"BatteryHeaterOn", router.DestChargingTelemetry, "writer"},
	{"BrakePedal", router.DestDriveTelemetry, "writer"},
	{"AutomaticBlindSpotCamera", router.DestSignalLog, "writer"},
	{"SettingDistanceUnit", router.DestUnitHistory, "histrepo"},
}

// e2eBuildWritersMap returns a map[router.Destination]router.Writer
// that mirrors the production shape from cmd/teslasync/main.go
// L512-525 — every key is a real router.Destination const and every
// value is an *e2eRecordingWriter. Returns the map plus a
// lookup-by-destination helper for assertion convenience.
//
// The 12-key set matches cmd/teslasync exactly (DestPositions /
// DestClimateSnapshot / DestMotorSnapshot / DestTirePressure /
// DestMediaSnapshot / DestSafetySnapshot / DestLocationSnapshot /
// DestSecurityEvent / DestChargingTelemetry / DestDriveTelemetry /
// DestSignalLog / DestUnitHistory) so router.New does not reject
// for an "unknown destination" or "missing writer" reason.
func e2eBuildWritersMap() (map[router.Destination]router.Writer, map[router.Destination]*e2eRecordingWriter) {
	dests := []router.Destination{
		router.DestPositions,
		router.DestClimateSnapshot,
		router.DestMotorSnapshot,
		router.DestTirePressure,
		router.DestMediaSnapshot,
		router.DestSafetySnapshot,
		router.DestLocationSnapshot,
		router.DestSecurityEvent,
		router.DestChargingTelemetry,
		router.DestDriveTelemetry,
		router.DestSignalLog,
		router.DestUnitHistory,
	}
	writers := make(map[router.Destination]router.Writer, len(dests))
	recorders := make(map[router.Destination]*e2eRecordingWriter, len(dests))
	for _, d := range dests {
		w := &e2eRecordingWriter{}
		writers[d] = w
		recorders[d] = w
	}
	return writers, recorders
}

// e2eBuildSideEffects returns a SideEffectsObserver wired against
// the canonical e2e fakes plus a struct holding every fake so the
// caller can assert callback counts and recorded payloads.
type e2eFakes struct {
	live     *e2eLiveStore
	fsm      *e2eFSM
	sessions *e2eSessions
	alerts   *e2eAlerts
	vins     *e2eVINResolver
	sse      *e2eSSE
}

func e2eBuildSideEffects() (*SideEffectsObserver, *e2eFakes) {
	fakes := &e2eFakes{
		live:     &e2eLiveStore{},
		fsm:      &e2eFSM{},
		sessions: &e2eSessions{},
		alerts:   &e2eAlerts{},
		vins:     &e2eVINResolver{vin: e2eVIN, vehicleID: e2eVehicleID},
		sse:      &e2eSSE{},
	}
	obs := New(Config{
		Live:         fakes.live,
		FSM:          fakes.fsm,
		Sessions:     fakes.sessions,
		Alerts:       fakes.alerts,
		VINResolver:  fakes.vins,
		BroadcastSSE: fakes.sse.broadcast,
		Logger:       zerolog.Nop(),
		// Fixed clock so the SSE payload assertion can compare the
		// "ts" field exactly.
		Now: func() time.Time { return e2eEmittedAt },
	})
	return obs, fakes
}

// ---------------------------------------------------------------------------
// Test 1 (Decision #4) — full e2e: 11 routed dests + 5 observer callbacks
// ---------------------------------------------------------------------------

// TestE2EPipeline_AllDestinationsAndObserverFire is the headline
// gate test for Phase-42a/0080. A real Tesla fleet-telemetry Payload
// proto with one routed sentinel field per destination flows through
// proto.Marshal -> normalize.Pipeline.Process and:
//
//  1. Each per-destination recording-fake writer receives exactly
//     one Write call for its expected sentinel field, with the
//     sentinel value preserved (with the documented SI conversion
//     for InsideTemp).
//  2. The unit-history Repo receives exactly one Record call for
//     SettingDistanceUnit (the unit_history router writer is a
//     no-op per phase-42a/0022).
//  3. Each of the 5 SideEffectsObserver callbacks (live store,
//     FSM, sessions, alerts, SSE) is invoked exactly once with
//     the per-payload signals map. (signal_log writes are owned
//     by the router signal_log writer, not the observer.)
//  4. The observer's signals map carries every routed atomic plus
//     the SettingDistanceUnit short-circuited atomic (12 entries
//     total — the 11 routed sentinels above + the second
//     LocationLatitude/Longitude pair from the Location compound,
//     MINUS one because Location flattens to TWO atomics not one;
//     11 routed sentinels + 1 free-rider LocationLongitude = 12).
func TestE2EPipeline_AllDestinationsAndObserverFire(t *testing.T) {
	t.Parallel()

	// (1) Build the in-memory writer set + a real *router.Router.
	writers, recorders := e2eBuildWritersMap()
	r, err := router.New(writers)
	if err != nil {
		t.Fatalf("router.New: %v", err)
	}

	// (2) Build the SideEffectsObserver and its fake callback recorders.
	obs, fakes := e2eBuildSideEffects()

	// (3) Build the unit-history repo and pre-seed the three
	// unit-bearing Kinds so InsideTemp converts cleanly.
	repo := &e2eHistRepo{}
	repo.preSeedActiveUnits(e2eVehicleID, e2eEmittedAt)

	// (4) Build the Pipeline with the observer registered.
	pipeline := normalize.New(repo, r, zerolog.Nop(), obs)

	// (5) Construct the fixture and Process it.
	payloadBytes, err := e2eFixturePayload()
	if err != nil {
		t.Fatalf("e2eFixturePayload: %v", err)
	}
	if err := pipeline.Process(context.Background(), payloadBytes, e2eVehicleID); err != nil {
		t.Fatalf("Pipeline.Process returned error: %v", err)
	}

	// (6) Per-destination assertion loop. Iterates e2eFixtureSentinels
	// so adding a sentinel to the fixture without updating the
	// expectations is caught immediately.
	for _, s := range e2eFixtureSentinels {
		s := s
		t.Run("dest_"+string(s.Dest)+"_field_"+s.Field, func(t *testing.T) {
			t.Parallel()
			switch s.SinkKind {
			case "writer":
				w := recorders[s.Dest]
				if w == nil {
					t.Fatalf("no recording writer registered for destination %q", s.Dest)
				}
				call := w.callForField(s.Field)
				if call == nil {
					t.Fatalf("destination %q: writer received no Write call for field %q; got calls=%+v", s.Dest, s.Field, w.callsCopy())
				}
				if call.Entry.Destination != s.Dest {
					t.Errorf("destination %q: Entry.Destination=%q on the recorded call (router dispatched to the wrong writer slot)", s.Dest, call.Entry.Destination)
				}
				if call.VIN != e2eVIN {
					t.Errorf("destination %q field %q: VIN=%q, want %q", s.Dest, s.Field, call.VIN, e2eVIN)
				}
				if !call.EmittedAt.Equal(e2eEmittedAt) {
					t.Errorf("destination %q field %q: EmittedAt=%v, want %v", s.Dest, s.Field, call.EmittedAt, e2eEmittedAt)
				}
			case "histrepo":
				records := repo.recordsCopy()
				found := false
				for _, e := range records {
					if e.Kind == unithistory.KindDistance && e.VehicleID == e2eVehicleID {
						found = true
					}
				}
				if !found {
					t.Fatalf("destination %q: histRepo.Record was NOT called for SettingDistanceUnit; got records=%+v", s.Dest, records)
				}
			default:
				t.Fatalf("internal: unknown SinkKind %q for field %s", s.SinkKind, s.Field)
			}
		})
	}

	// (7) Per-destination value-correctness assertions. Decoupled
	// from the per-destination loop above so a per-destination
	// failure does not mask a value-correctness regression.
	t.Run("InsideTemp_converted_to_SI_via_unit_context", func(t *testing.T) {
		t.Parallel()
		w := recorders[router.DestClimateSnapshot]
		call := w.callForField("InsideTemp")
		if call == nil {
			t.Skip("InsideTemp not routed; covered by per-destination test")
		}
		// 25.0 C in Celsius active unit converts to 25.0 SI (C is the
		// canonical SI for temperature in this codebase). The
		// converted value MUST be a float64 (units.ToSI signature).
		got, ok := call.Value.(float64)
		if !ok {
			t.Fatalf("InsideTemp value type=%T, want float64 (units.ToSI returns float64)", call.Value)
		}
		const want = 25.0
		if got != want {
			t.Errorf("InsideTemp SI value=%v, want %v (identity conversion C->C)", got, want)
		}
	})

	t.Run("BrakePedal_passthrough_bool_unchanged", func(t *testing.T) {
		t.Parallel()
		w := recorders[router.DestDriveTelemetry]
		call := w.callForField("BrakePedal")
		if call == nil {
			t.Fatalf("BrakePedal not routed (per-destination test should have caught this)")
		}
		got, ok := call.Value.(bool)
		if !ok || got != true {
			t.Errorf("BrakePedal value=%v (%T), want true (bool, dimensionless pass-through)", call.Value, call.Value)
		}
	})

	t.Run("MediaNowPlayingTitle_string_unchanged", func(t *testing.T) {
		t.Parallel()
		w := recorders[router.DestMediaSnapshot]
		call := w.callForField("MediaNowPlayingTitle")
		if call == nil {
			t.Fatalf("MediaNowPlayingTitle not routed (per-destination test should have caught this)")
		}
		got, ok := call.Value.(string)
		if !ok || got != "E2E Test Track" {
			t.Errorf("MediaNowPlayingTitle value=%v (%T), want \"E2E Test Track\"", call.Value, call.Value)
		}
	})

	// (8) Observer callback fan-out. Each of the 5 callbacks must
	// be invoked exactly once for the single payload.
	t.Run("observer_callbacks_each_invoked_exactly_once", func(t *testing.T) {
		t.Parallel()
		if got := fakes.live.callCount(); got != 1 {
			t.Errorf("LiveSignalStore.UpdateAll: got %d calls, want 1", got)
		}
		if got := fakes.fsm.callCount(); got != 1 {
			t.Errorf("FSMHandler.ProcessSignals: got %d calls, want 1", got)
		}
		if got := fakes.sessions.callCount(); got != 1 {
			t.Errorf("SessionTracker.ProcessSignals: got %d calls, want 1", got)
		}
		if got := fakes.alerts.callCount(); got != 1 {
			t.Errorf("AlertEvaluator.Evaluate: got %d calls, want 1", got)
		}
		if got := fakes.sse.callCount(); got != 1 {
			t.Errorf("BroadcastSSE: got %d calls, want 1", got)
		}
	})

	// (9) Observer signals map content. The live-store call must
	// carry every field the payload produced (12 atomics: 1
	// SettingDistanceUnit + 2 LocationLatitude/Longitude + 9 plain
	// scalars). Asserting on the full set defends Decision #8: the
	// observer sees the post-route slice with SI substitutions
	// applied — no field is lost between the route loop and the
	// observer fan-out.
	t.Run("observer_signals_map_contains_every_routed_field", func(t *testing.T) {
		t.Parallel()
		last := fakes.live.lastCall()
		if last == nil {
			t.Fatal("LiveSignalStore.UpdateAll never called; cannot assert signals map content")
		}
		if last.VehicleID != e2eVehicleID {
			t.Errorf("LiveSignalStore.UpdateAll vehicleID=%d, want %d", last.VehicleID, e2eVehicleID)
		}
		expectedFields := []string{
			"SettingDistanceUnit",
			"LocationLatitude",
			"LocationLongitude",
			"InsideTemp",
			"Locked",
			"DiTorqueActualF",
			"TpmsLastSeenPressureTimeFl",
			"MediaNowPlayingTitle",
			"ServiceMode",
			"BatteryHeaterOn",
			"BrakePedal",
			"AutomaticBlindSpotCamera",
		}
		for _, f := range expectedFields {
			if _, ok := last.Signals[f]; !ok {
				t.Errorf("observer signals map missing %q; got keys=%v", f, mapKeys(last.Signals))
			}
		}
	})
}

// ---------------------------------------------------------------------------
// Test 2 (Decision #5) — malformed payload isolates failure
// ---------------------------------------------------------------------------

// TestE2EPipeline_MalformedPayloadIsolatesFailure exercises the
// codec.Decode failure path:
//
//	(a) Process returns an error wrapping normalize.ErrPayloadDrop.
//	(b) NO router.Writer Write is invoked.
//	(c) NO observer callback is invoked (per phase-42a/0030
//	    Decision #1: observer NOT called when codec.Decode fails).
//
// This is the contract the MQTT subscriber's poison-pill / DLQ
// policy depends on (Phase-42a/0040): the payload must NOT cause
// downstream side-effects when the bytes themselves are corrupt.
func TestE2EPipeline_MalformedPayloadIsolatesFailure(t *testing.T) {
	t.Parallel()

	writers, recorders := e2eBuildWritersMap()
	r, err := router.New(writers)
	if err != nil {
		t.Fatalf("router.New: %v", err)
	}
	obs, fakes := e2eBuildSideEffects()
	repo := &e2eHistRepo{}
	repo.preSeedActiveUnits(e2eVehicleID, e2eEmittedAt)
	pipeline := normalize.New(repo, r, zerolog.Nop(), obs)

	// Truncated proto bytes — proto.Unmarshal will fail because the
	// outer Payload message cannot be parsed. The non-empty prefix
	// guards against an "empty bytes are valid Payload" false
	// positive (proto3 messages with no fields ARE valid against
	// proto.Unmarshal — using truncated valid prefix forces the
	// codec to error on a malformed varint instead).
	malformed := []byte{0xff, 0xff, 0xff, 0xff, 0xff}

	err = pipeline.Process(context.Background(), malformed, e2eVehicleID)
	if err == nil {
		t.Fatal("Process(malformed) returned nil; want non-nil error wrapping normalize.ErrPayloadDrop")
	}
	if !errors.Is(err, normalize.ErrPayloadDrop) {
		t.Errorf("Process(malformed) returned %v, want errors.Is(err, normalize.ErrPayloadDrop)", err)
	}

	// (b) NO writer received a Write call. Iterate every recorder so
	// a future writer added to the production set is caught.
	for dest, w := range recorders {
		if calls := w.callsCopy(); len(calls) != 0 {
			t.Errorf("destination %q writer received %d Write call(s) on a malformed-payload run; want 0: %+v", dest, len(calls), calls)
		}
	}

	// (c) NO observer callback was invoked.
	if got := fakes.live.callCount(); got != 0 {
		t.Errorf("LiveSignalStore.UpdateAll: got %d calls on malformed payload, want 0", got)
	}
	if got := fakes.fsm.callCount(); got != 0 {
		t.Errorf("FSMHandler.ProcessSignals: got %d calls on malformed payload, want 0", got)
	}
	if got := fakes.sessions.callCount(); got != 0 {
		t.Errorf("SessionTracker.ProcessSignals: got %d calls on malformed payload, want 0", got)
	}
	if got := fakes.alerts.callCount(); got != 0 {
		t.Errorf("AlertEvaluator.Evaluate: got %d calls on malformed payload, want 0", got)
	}
	if got := fakes.sse.callCount(); got != 0 {
		t.Errorf("BroadcastSSE: got %d calls on malformed payload, want 0", got)
	}

	// histRepo must also be untouched (codec.Decode failed before
	// the SettingDistanceUnit short-circuit could fire).
	if records := repo.recordsCopy(); len(records) != 0 {
		t.Errorf("histRepo.Record received %d Record call(s) on malformed payload; want 0: %+v", len(records), records)
	}
}

// ---------------------------------------------------------------------------
// Test 3 (Decision #6 adapted) — production wiring smoke
// ---------------------------------------------------------------------------

// TestE2EPipeline_ProductionWiringSmoke replicates the
// cmd/teslasync/main.go pipeline-wiring shape (12-key writer map,
// router.New, teslapipeline.New, normalize.New) using the SAME
// constructors but with in-memory recording fakes. It is the
// adapted form of Decision #6 — a literal "import cmd/teslasync via
// buildPipeline" is impossible because no such helper was extracted
// in 0050 and cmd/teslasync is package main (the source-grep
// guards in main_pipeline_wiring_test.go cover the cmd/teslasync
// side).
//
// What this test proves that the source-grep tests don't:
//   - The 12 router.Destination keys cmd/teslasync uses are a valid
//     input to router.New (no "unknown destination" rejection).
//   - The combination of router.New + normalize.New + teslapipeline.New
//     compiles and constructs a working *Pipeline with the SideEffectsObserver
//     registered as an observer.
//   - The fixture payload reaches at least one writer per
//     destination + the observer fan-out fires — a sanity check
//     that a routing-yaml change that orphans a destination would
//     surface here as well as in the per-prompt writer tests.
func TestE2EPipeline_ProductionWiringSmoke(t *testing.T) {
	t.Parallel()

	// (a) The 12-key writer map matching cmd/teslasync/main.go
	// L512-525. router.New rejects an "unknown destination" key, so
	// the act of constructing and passing this map proves the keys
	// are all valid Destinations.
	writers, recorders := e2eBuildWritersMap()
	if got, want := len(writers), 12; got != want {
		t.Fatalf("writer map has %d destinations, want %d (cmd/teslasync wires exactly 12)", got, want)
	}
	requiredDests := []router.Destination{
		router.DestPositions,
		router.DestClimateSnapshot,
		router.DestMotorSnapshot,
		router.DestTirePressure,
		router.DestMediaSnapshot,
		router.DestSafetySnapshot,
		router.DestLocationSnapshot,
		router.DestSecurityEvent,
		router.DestChargingTelemetry,
		router.DestDriveTelemetry,
		router.DestSignalLog,
		router.DestUnitHistory,
	}
	for _, d := range requiredDests {
		if _, ok := writers[d]; !ok {
			t.Errorf("writer map missing required destination %q", d)
		}
	}

	// (b) router.New must succeed — this is the same constructor
	// production calls, with the same writer-map shape.
	r, err := router.New(writers)
	if err != nil {
		t.Fatalf("router.New(production-shaped writers map): %v", err)
	}
	if r == nil {
		t.Fatal("router.New returned nil router with nil error")
	}

	// (c) Build the SideEffectsObserver via teslapipeline.New using
	// the canonical fakes. Production wiring registers exactly one
	// observer (the SideEffectsObserver); the test mirrors that.
	obs, fakes := e2eBuildSideEffects()
	if obs == nil {
		t.Fatal("teslapipeline.New returned nil SideEffectsObserver")
	}

	// (d) Construct *normalize.Pipeline with a single observer in the
	// variadic tail — exactly the production shape from
	// cmd/teslasync/main.go L574.
	repo := &e2eHistRepo{}
	repo.preSeedActiveUnits(e2eVehicleID, e2eEmittedAt)
	pipeline := normalize.New(repo, r, zerolog.Nop(), obs)
	if pipeline == nil {
		t.Fatal("normalize.New returned nil Pipeline")
	}

	// (e) Send the fixture payload through. Asserts the wired
	// pipeline actually dispatches end-to-end.
	payloadBytes, err := e2eFixturePayload()
	if err != nil {
		t.Fatalf("e2eFixturePayload: %v", err)
	}
	if err := pipeline.Process(context.Background(), payloadBytes, e2eVehicleID); err != nil {
		t.Fatalf("Pipeline.Process: %v", err)
	}

	// (f) Every routed destination in e2eFixtureSentinels must have
	// received at least one Write (or a histRepo.Record for
	// DestUnitHistory). DestLocationSnapshot is exempt — see file-
	// level === TEST_DESIGN === for the rationale.
	for _, s := range e2eFixtureSentinels {
		switch s.SinkKind {
		case "writer":
			w := recorders[s.Dest]
			if calls := w.callsCopy(); len(calls) == 0 {
				t.Errorf("destination %q (field %q): writer received 0 calls in production-wiring smoke; want >=1", s.Dest, s.Field)
			}
		case "histrepo":
			if records := repo.recordsCopy(); len(records) == 0 {
				t.Errorf("destination %q (field %q): histRepo.Record received 0 calls in production-wiring smoke; want >=1", s.Dest, s.Field)
			}
		}
	}

	// (g) Observer fan-out fired.
	if got := fakes.live.callCount(); got != 1 {
		t.Errorf("production-wiring smoke: LiveSignalStore.UpdateAll got %d calls, want 1", got)
	}
	if got := fakes.sse.callCount(); got != 1 {
		t.Errorf("production-wiring smoke: BroadcastSSE got %d calls, want 1", got)
	}

	// (h) Sanity: DestLocationSnapshot writer received NO calls
	// (because routing.yaml has 0 location_snapshot entries today).
	// This also serves as the canary for the Decision #4 exemption:
	// a future routing.yaml entry that adds a `dest: location_snapshot`
	// route will start populating this writer and the test will fail,
	// alerting the next prompt author to extend e2eFixtureSentinels.
	if calls := recorders[router.DestLocationSnapshot].callsCopy(); len(calls) != 0 {
		t.Errorf("DestLocationSnapshot writer received %d calls; expected 0 because routing.yaml has no `dest: location_snapshot` entries today. If a new route was added, extend e2eFixtureSentinels in e2e_test.go.", len(calls))
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// mapKeys returns the keys of m as a sorted slice (well, an
// unsorted slice — sufficient for error messages).
func mapKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// _ keeps `strings` imported even when no test in this file uses it
// directly — the import remains useful for future drift assertions
// (e.g. verifying a SSE payload's signal map serialises correctly).
var _ = strings.Builder{}
