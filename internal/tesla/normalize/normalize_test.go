package normalize

import (
	"context"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

// fakeRepo is an in-memory unithistory.Repo used by every Pipeline
// test. It records every Record / At call in op-arrival order so the
// tests can assert the SettingUnitFirst ordering invariant directly
// (Record before At for the same EmittedAt).
//
// Behaviour:
//   - Record appends an Entry to entries and a "record" op to ops.
//   - At scans entries for the row with the largest effective_from
//     <= t for (vehicleID, kind) and returns its Value, or
//     unithistory.ErrNotFound when no such row exists. Records the
//     "at" op regardless of outcome so the test can see the call
//     even on miss.
//   - Latest is unused by the dispatch loop but must be present to
//     satisfy the interface.
type fakeRepo struct {
	mu      sync.Mutex
	entries []unithistory.Entry
	ops     []fakeOp
}

type fakeOp struct {
	kind   string            // "record" or "at"
	at     time.Time         // populated for "at"
	atKind unithistory.Kind  // populated for "at"
	atVeh  int64             // populated for "at"
	entry  unithistory.Entry // populated for "record"
}

func (r *fakeRepo) Record(_ context.Context, e unithistory.Entry) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = append(r.entries, e)
	r.ops = append(r.ops, fakeOp{kind: "record", entry: e})
	return nil
}

func (r *fakeRepo) At(_ context.Context, vehicleID int64, kind unithistory.Kind, t time.Time) (units.ActiveUnit, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ops = append(r.ops, fakeOp{kind: "at", at: t, atKind: kind, atVeh: vehicleID})
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

func (r *fakeRepo) Latest(_ context.Context, vehicleID int64, kind unithistory.Kind) (unithistory.Entry, error) {
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

func (r *fakeRepo) opsCopy() []fakeOp {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]fakeOp, len(r.ops))
	copy(out, r.ops)
	return out
}

// fakeRouter records every Route call the dispatcher makes. Used as
// the Routable for every Pipeline test in this file. Substitutes
// for *router.Router because routing.yaml ships empty; a real
// *router.Router would reject every dispatch with ErrNoRoute and never
// exercise the writer path under test.
type fakeRouter struct {
	mu     sync.Mutex
	routes []codec.Atomic
	err    error // optional: returned from every Route call
}

type fakeBatchRouter struct {
	mu          sync.Mutex
	singleCalls int
	batches     [][]codec.Atomic
}

func (r *fakeBatchRouter) Route(_ context.Context, _ codec.Atomic) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.singleCalls++
	return nil
}

func (r *fakeBatchRouter) RouteBatch(_ context.Context, atomics []codec.Atomic) ([]error, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := make([]codec.Atomic, len(atomics))
	copy(cp, atomics)
	r.batches = append(r.batches, cp)
	return make([]error, len(atomics)), nil
}

func (r *fakeRouter) Route(_ context.Context, atomic codec.Atomic) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.routes = append(r.routes, atomic)
	return r.err
}

func (r *fakeRouter) routesCopy() []codec.Atomic {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]codec.Atomic, len(r.routes))
	copy(out, r.routes)
	return out
}

func TestPipeline_UsesBatchRouterWhenAvailable(t *testing.T) {
	routes := &fakeBatchRouter{}
	pipeline := New(&fakeRepo{}, routes, zerolog.Nop())
	ts := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	err := pipeline.ProcessAtomics(context.Background(), []codec.Atomic{
		{Field: "Soc", Value: float32(75), EmittedAt: ts, VehicleID: "VIN"},
		{Field: "Locked", Value: true, EmittedAt: ts, VehicleID: "VIN"},
	}, 42)
	if err != nil {
		t.Fatalf("ProcessAtomics: %v", err)
	}

	routes.mu.Lock()
	defer routes.mu.Unlock()
	if routes.singleCalls != 0 {
		t.Fatalf("single Route calls = %d, want 0", routes.singleCalls)
	}
	if len(routes.batches) != 1 || len(routes.batches[0]) != 2 {
		t.Fatalf("batch calls = %#v, want one two-atomic batch", routes.batches)
	}
}

// ---------------------------------------------------------------------------
// TestPipelineHappyPath
// ---------------------------------------------------------------------------

// TestPipeline_FixedMileBypass pins the production fix for the
// "10,334 mi drive" bug: cumulative-distance fields (Odometer,
// RatedRange, IdealBatteryRange, EstBatteryRange, MilesToArrival,
// MilesSinceReset, SelfDrivingMilesSinceReset) MUST bypass the
// per-vehicle unit-history lookup because their wire value is always
// in miles regardless of SettingDistanceUnit.
//
// Without this bypass:
//
//  1. A fresh vehicle with no unit_history rows would drop every
//     Odometer / range atomic on histRepo.ErrNotFound, silently
//     stalling drive-distance and range-state computation.
//
//  2. A user who toggles SettingDistanceUnit mid-drive would corrupt
//     the cumulative odometer value by a 1.609× factor at the
//     transition boundary, producing nonsense drive distances such
//     as 10,334 mi for an actual 10 mi trip (the bug that motivated
//     this fix; see prod evidence in commit message / drive ids 30
//     and 34 for vehicle_id=1 on 2026-05-24).
//
// Assertions per fixed-mile field:
//
//   - histRepo.At was NEVER called (the bypass elides the lookup).
//   - The routed SI value equals raw * 1609.344 (always miles).
//   - A "wrong" recorded SettingDistanceUnit=Kilometers has NO effect
//     on the routed value — the override wins.
func TestPipeline_FixedMileBypass(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 99
	tNow := time.Date(2026, 5, 24, 21, 0, 0, 0, time.UTC)

	// The fixed-mile field set whose wire-format unit must NOT
	// follow SettingDistanceUnit. Keep in lockstep with
	// units.fixedMileDistanceFields.
	fixedMileFields := []string{
		"Odometer",
		"RatedRange",
		"EstBatteryRange",
		"IdealBatteryRange",
		"MilesToArrival",
		"MilesSinceReset",
		"SelfDrivingMilesSinceReset",
	}

	for _, field := range fixedMileFields {
		field := field
		t.Run(field, func(t *testing.T) {
			t.Parallel()

			// Adversarial input: a Setting*Unit=Kilometers is
			// already in history, so the OLD code path would have
			// multiplied raw by 1000 (km factor). The override
			// must win and apply *1609.344 instead.
			atomics := []codec.Atomic{
				{Field: "SettingDistanceUnit", Value: "Kilometers", EmittedAt: tNow.Add(-1 * time.Hour), VehicleID: "VIN-FIXED"},
				{Field: field, Value: float64(100), EmittedAt: tNow, VehicleID: "VIN-FIXED"},
			}

			repo := &fakeRepo{}
			rt := &fakeRouter{}
			p := New(repo, rt, zerolog.Nop())

			if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
				t.Fatalf("processAtomics returned error: %v", err)
			}

			// The only repo op must be the SettingDistanceUnit
			// "record". histRepo.At MUST NOT have been called for
			// the fixed-mile field — that is the point of the
			// bypass and the regression net for the bug.
			ops := repo.opsCopy()
			for i, op := range ops {
				if op.kind == "at" {
					t.Fatalf("ops[%d]: histRepo.At was called for fixed-mile field %s — bypass regressed; ops=%+v", i, field, ops)
				}
			}

			routes := rt.routesCopy()
			if len(routes) != 1 {
				t.Fatalf("router received %d routes, want 1 (%s only): %+v", len(routes), field, routes)
			}
			if routes[0].Field != field {
				t.Fatalf("router received %q, want %q", routes[0].Field, field)
			}
			si, ok := routes[0].Value.(float64)
			if !ok {
				t.Fatalf("%s routed Value type = %T, want float64", field, routes[0].Value)
			}
			want := 100 * 1609.344
			if math.Abs(si-want) > 1e-6 {
				t.Errorf("%s SI = %v, want %v (always miles, ignoring SettingDistanceUnit=Kilometers)", field, si, want)
			}
		})
	}
}

// TestPipeline_FixedMileNoUnitHistory pins the no-unit-context
// branch of the fixed-mile bypass: an Odometer atomic with NO
// SettingDistanceUnit row in history must still be routed (raw *
// 1609.344) rather than dropped on ErrNoUnitContext. Without the
// bypass, a fresh vehicle with no observed Setting*Unit would
// silently lose every Odometer sample.
func TestPipeline_FixedMileNoUnitHistory(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 101
	tNow := time.Date(2026, 5, 24, 12, 0, 0, 0, time.UTC)

	atomics := []codec.Atomic{
		{Field: "Odometer", Value: float64(27210.92), EmittedAt: tNow, VehicleID: "VIN-NOUH"},
	}

	repo := &fakeRepo{} // empty — At returns ErrNotFound
	rt := &fakeRouter{}
	p := New(repo, rt, zerolog.Nop())

	if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}

	routes := rt.routesCopy()
	if len(routes) != 1 {
		t.Fatalf("router received %d routes, want 1: %+v", len(routes), routes)
	}
	if routes[0].Field != "Odometer" {
		t.Fatalf("router received %q, want Odometer", routes[0].Field)
	}
	si := routes[0].Value.(float64)
	want := 27210.92 * 1609.344
	if math.Abs(si-want) > 1e-3 {
		t.Errorf("Odometer SI = %v, want %v (always miles, no unit history)", si, want)
	}

	// Sanity: histRepo.At was not called for Odometer.
	ops := repo.opsCopy()
	for _, op := range ops {
		if op.kind == "at" {
			t.Errorf("histRepo.At was called for Odometer with no unit history — bypass regressed: %+v", op)
		}
	}
}

// TestPipeline_FixedChargingKiloUnits verifies that Tesla's fixed kWh/kW
// charging fields bypass unit history and reach every downstream writer as
// canonical Wh/W values. This is the regression net for charging sessions
// that previously displayed 0.02 kWh for a real 15.09 kWh charge.
func TestPipeline_FixedChargingKiloUnits(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 102
	tNow := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		field string
		raw   float32
		want  float64
	}{
		{field: "ACChargingEnergyIn", raw: 15.089165, want: float64(float32(15.089165)) * 1000},
		{field: "DCChargingEnergyIn", raw: 42.5, want: 42500},
		{field: "ACChargingPower", raw: 7.2, want: float64(float32(7.2)) * 1000},
		{field: "DCChargingPower", raw: 250, want: 250000},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.field, func(t *testing.T) {
			t.Parallel()
			repo := &fakeRepo{}
			rt := &fakeRouter{}
			p := New(repo, rt, zerolog.Nop())

			err := p.processAtomics(context.Background(), []codec.Atomic{{
				Field: tc.field, Value: tc.raw, EmittedAt: tNow, VehicleID: "VIN-CHARGE-SI",
			}}, vehicleID)
			if err != nil {
				t.Fatalf("processAtomics returned error: %v", err)
			}

			for _, op := range repo.opsCopy() {
				if op.kind == "at" {
					t.Fatalf("histRepo.At called for fixed-wire field %s", tc.field)
				}
			}
			routes := rt.routesCopy()
			if len(routes) != 1 {
				t.Fatalf("router received %d routes, want 1: %+v", len(routes), routes)
			}
			got, ok := routes[0].Value.(float64)
			if !ok {
				t.Fatalf("routed value type = %T, want float64", routes[0].Value)
			}
			if math.Abs(got-tc.want) > 1e-6 {
				t.Fatalf("%s SI value = %v, want %v", tc.field, got, tc.want)
			}
		})
	}
}

// TestPipelineHappyPath exercises the three primary dispatch arms in
// one payload:
//
//  1. A Setting*Unit atomic (SettingTemperatureUnit=C) is recorded to
//     the unit-history repo via observeSettingUnit and is NOT
//     routed.
//  2. A unit-bearing atomic (InsideTemp=20 C) looks up the active
//     unit at its EmittedAt, converts to SI (Celsius, identity here),
//     and is routed to the fake router with the converted value.
//  3. A dimensionless atomic (BatteryHeaterOn=true) bypasses the
//     unit-conversion path and is routed unchanged.
//
// Temperature is chosen over distance for arm (2) because Odometer
// and the other cumulative-distance fields are now fixed-mile
// (units.IsFixedMileDistanceField) and bypass unit history entirely —
// the SettingDistanceUnit → Record → unit-history → At → convert flow
// is no longer exercised by Odometer. InsideTemp still follows
// SettingTemperatureUnit so it remains the right vehicle for the
// flow assertion.
//
// The assertions cover the SettingUnitFirst ordering (Record happens
// before At), the conversion correctness (20 C → 20 C identity), the
// router population (exactly two Routes — InsideTemp + BatteryHeaterOn,
// NOT the Setting*Unit), and the pass-through invariance for
// dimensionless atomics.
func TestPipelineHappyPath(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 42
	tNow := time.Date(2026, 5, 3, 12, 0, 0, 0, time.UTC)
	// Sibling timestamps are used so the unit-history At lookup at
	// the InsideTemp's EmittedAt sees the SettingTemperatureUnit row.
	tSetting := tNow
	tValues := tNow.Add(1 * time.Second)

	atomics := []codec.Atomic{
		{Field: "SettingTemperatureUnit", Value: "Celsius", EmittedAt: tSetting, VehicleID: "VIN-HAPPY"},
		{Field: "InsideTemp", Value: float64(20), EmittedAt: tValues, VehicleID: "VIN-HAPPY"},
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: tValues, VehicleID: "VIN-HAPPY"},
	}

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	p := New(repo, rt, zerolog.Nop())

	if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}

	// Setting*Unit must have been Recorded once with the expected
	// (Kind, Value) and source.
	repo.mu.Lock()
	if len(repo.entries) != 1 {
		repo.mu.Unlock()
		t.Fatalf("expected exactly 1 unit_history entry, got %d: %+v", len(repo.entries), repo.entries)
	}
	gotEntry := repo.entries[0]
	repo.mu.Unlock()
	if gotEntry.VehicleID != vehicleID {
		t.Errorf("entry.VehicleID = %d, want %d", gotEntry.VehicleID, vehicleID)
	}
	if gotEntry.Kind != unithistory.KindTemperature {
		t.Errorf("entry.Kind = %q, want %q", gotEntry.Kind, unithistory.KindTemperature)
	}
	if gotEntry.Value != units.ActiveUnitCelsius {
		t.Errorf("entry.Value = %q, want %q", gotEntry.Value, units.ActiveUnitCelsius)
	}
	if gotEntry.Source != unithistory.SourceTelemetry {
		t.Errorf("entry.Source = %q, want %q", gotEntry.Source, unithistory.SourceTelemetry)
	}
	if !gotEntry.EffectiveFrom.Equal(tSetting) {
		t.Errorf("entry.EffectiveFrom = %s, want %s", gotEntry.EffectiveFrom, tSetting)
	}

	// Router must have received exactly two atomics: InsideTemp +
	// BatteryHeaterOn. SettingTemperatureUnit must NOT have been routed.
	got := rt.routesCopy()
	if len(got) != 2 {
		t.Fatalf("router received %d routes, want 2: %+v", len(got), got)
	}
	for _, a := range got {
		if a.Field == "SettingTemperatureUnit" {
			t.Fatalf("router received Setting*Unit atomic — should have been observed only: %+v", a)
		}
	}

	// InsideTemp should be converted: 20 C -> 20 C (identity).
	temp := findRouted(got, "InsideTemp")
	if temp == nil {
		t.Fatalf("router did not receive InsideTemp atomic; got %+v", got)
	}
	tempSI, ok := temp.Value.(float64)
	if !ok {
		t.Fatalf("InsideTemp routed Value type = %T, want float64", temp.Value)
	}
	if math.Abs(tempSI-20.0) > 1e-9 {
		t.Errorf("InsideTemp SI value = %v, want 20 (20 C identity)", tempSI)
	}

	// BatteryHeaterOn should be routed unchanged.
	heater := findRouted(got, "BatteryHeaterOn")
	if heater == nil {
		t.Fatalf("router did not receive BatteryHeaterOn atomic; got %+v", got)
	}
	if v, ok := heater.Value.(bool); !ok || !v {
		t.Errorf("BatteryHeaterOn routed Value = %v (%T), want true (bool)", heater.Value, heater.Value)
	}
}

// findRouted returns the routed atomic for field name, or nil.
func findRouted(routes []codec.Atomic, field string) *codec.Atomic {
	for i := range routes {
		if routes[i].Field == field {
			return &routes[i]
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// TestSettingUnitProcessedFirstInSamePayload
// ---------------------------------------------------------------------------

// TestSettingUnitProcessedFirstInSamePayload locks the SettingUnitFirst
// ordering invariant: when a payload contains both a Setting*Unit
// atomic and a unit-bearing atomic with the SAME EmittedAt — and the
// Setting*Unit appears AFTER the unit-bearing one in the input slice
// — the dispatcher MUST reorder so the Setting*Unit is recorded
// FIRST, so the subsequent At lookup for the unit-bearing atomic
// resolves the new unit context.
//
// The test fixture is the worst-case fresh-vehicle scenario: the
// repo has no prior history, so without reordering the VehicleSpeed
// atomic's At lookup would return ErrNotFound and the value would
// be dropped (or, if the repo had a stale "mi" row, it would be
// converted with the wrong unit). The assertions verify both:
//
//  1. The op sequence in the fake repo is [record(distance), at(distance)]
//     — locks the ordering at the call-graph level.
//  2. The router received the VehicleSpeed atomic with the value
//     correctly converted from km/h to m/s (27.7 * 1000/3600 ≈ 7.6944),
//     proving the At lookup found the freshly-Recorded "km" row.
func TestSettingUnitProcessedFirstInSamePayload(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 7
	tBoth := time.Date(2026, 5, 3, 14, 0, 0, 0, time.UTC)

	// Input order: VehicleSpeed FIRST, SettingDistanceUnit SECOND.
	// The dispatcher MUST swap them so SettingDistanceUnit is
	// processed first.
	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: float64(27.7), EmittedAt: tBoth, VehicleID: "VIN-ORDER"},
		{Field: "SettingDistanceUnit", Value: "Kilometers", EmittedAt: tBoth, VehicleID: "VIN-ORDER"},
	}

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	p := New(repo, rt, zerolog.Nop())

	if err := p.processAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("processAtomics returned error: %v", err)
	}

	// Op-sequence assertion: the FIRST op MUST be "record" (the
	// Setting*Unit observer), the SECOND MUST be "at" (the
	// VehicleSpeed unit-history lookup).
	ops := repo.opsCopy()
	if len(ops) != 2 {
		t.Fatalf("expected 2 repo ops (record then at), got %d: %+v", len(ops), ops)
	}
	if ops[0].kind != "record" {
		t.Errorf("ops[0].kind = %q, want %q (Setting*Unit must be Recorded BEFORE the speed lookup)", ops[0].kind, "record")
	}
	if ops[1].kind != "at" {
		t.Errorf("ops[1].kind = %q, want %q (speed lookup must follow the Setting*Unit Record)", ops[1].kind, "at")
	}
	// Belt + suspenders: the recorded entry MUST be the km row
	// the speed lookup later resolves.
	if ops[0].entry.Value != units.ActiveUnitKilometers {
		t.Errorf("Recorded Value = %q, want %q", ops[0].entry.Value, units.ActiveUnitKilometers)
	}
	if ops[0].entry.Kind != unithistory.KindDistance {
		t.Errorf("Recorded Kind = %q, want %q", ops[0].entry.Kind, unithistory.KindDistance)
	}
	if !ops[1].at.Equal(tBoth) || ops[1].atKind != unithistory.KindDistance || ops[1].atVeh != vehicleID {
		t.Errorf("At lookup did not match (vehicle=%d, kind=%s, t=%s); got %+v", vehicleID, unithistory.KindDistance, tBoth, ops[1])
	}

	// Router must have received the VehicleSpeed atomic with the
	// value converted from km/h to m/s. 27.7 km/h * 1000/3600 = 7.6944.
	routes := rt.routesCopy()
	if len(routes) != 1 {
		t.Fatalf("router received %d routes, want 1 (VehicleSpeed only): %+v", len(routes), routes)
	}
	if routes[0].Field != "VehicleSpeed" {
		t.Fatalf("router received %q, want VehicleSpeed", routes[0].Field)
	}
	siValue, ok := routes[0].Value.(float64)
	if !ok {
		t.Fatalf("VehicleSpeed routed Value type = %T, want float64", routes[0].Value)
	}
	want := 27.7 * (1000.0 / 3600.0)
	if math.Abs(siValue-want) > 1e-9 {
		t.Errorf("VehicleSpeed SI = %v, want %v (27.7 km/h in m/s)", siValue, want)
	}
}

// ---------------------------------------------------------------------------
// TestSinglePipelineInvariant
// ---------------------------------------------------------------------------

// TestSinglePipelineInvariant is the architecture lock that prevents
// the "two pipelines" regression. It scans every non-test .go file in
// this package and asserts:
//
//   - the only exported methods on *Pipeline that return an error are
//     in the locked allow-set {Process, ProcessAtomics}; and
//   - no other top-level exported function in the package returns an
//     error.
//
// Either of those would constitute a third public ingest entry,
// which ADR-004 #2 explicitly forbids. The two allowed entries are:
// Process (bytes-in, MQTT path) and ProcessAtomics (atomics-in, HTTP
// webhook path). The test is reflective
// rather than convention-only because text-grep gates can be defeated
// by a rename (e.g. naming the third entry HandleBatch); reading the
// AST catches the structural shape regardless of naming.
func TestSinglePipelineInvariant(t *testing.T) {
	// LOCKED set of permitted public ingest methods on *Pipeline.
	// Any new entry MUST be authored via an explicit ADR amendment +
	// prompt; do NOT add to this set casually.
	allowedPublicEntries := map[string]bool{
		"Process":        true, // bytes-in, MQTT subscriber path
		"ProcessAtomics": true, // atomics-in, HTTP webhook adapter path
	}

	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, parser.AllErrors)
	if err != nil {
		t.Fatalf("parser.ParseDir: %v", err)
	}

	var offenders []string
	for _, pkg := range pkgs {
		// Iterate files in deterministic order so the offender list
		// is stable across runs (helps human review of failures).
		filenames := make([]string, 0, len(pkg.Files))
		for fname := range pkg.Files {
			filenames = append(filenames, fname)
		}
		sort.Strings(filenames)

		for _, fname := range filenames {
			file := pkg.Files[fname]
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok {
					continue
				}
				if !fn.Name.IsExported() {
					continue
				}
				if !returnsError(fn) {
					continue
				}

				if fn.Recv != nil {
					recv := receiverTypeName(fn.Recv)
					if recv != "*Pipeline" {
						// Methods on other types (e.g. Metrics) are
						// out of scope for the single-ingest lock.
						continue
					}
					if allowedPublicEntries[fn.Name.Name] {
						continue
					}
					offenders = append(offenders, fmt.Sprintf("%s: (p *Pipeline).%s returns error (only Process, ProcessAtomics are allowed)", filepath.Base(fname), fn.Name.Name))
				} else {
					offenders = append(offenders, fmt.Sprintf("%s: package-level %s returns error (no public ingest entries other than Pipeline.Process / Pipeline.ProcessAtomics are allowed)", filepath.Base(fname), fn.Name.Name))
				}
			}
		}
	}

	if len(offenders) > 0 {
		t.Fatalf("normalize package has additional public ingest entries — only (p *Pipeline) Process and (p *Pipeline) ProcessAtomics may return error:\n  - %s", strings.Join(offenders, "\n  - "))
	}
}

// returnsError reports whether fn's signature contains an `error`
// return value (anywhere in its result list — typically the last
// position, but the check is positional-agnostic for robustness).
func returnsError(fn *ast.FuncDecl) bool {
	if fn.Type == nil || fn.Type.Results == nil {
		return false
	}
	for _, field := range fn.Type.Results.List {
		if isErrorType(field.Type) {
			return true
		}
	}
	return false
}

// isErrorType reports whether expr is the predeclared `error` type.
// Pointer/qualified variants (*error, pkg.error) are intentionally
// NOT matched — Go's idiomatic error type is the unqualified ident.
func isErrorType(expr ast.Expr) bool {
	id, ok := expr.(*ast.Ident)
	if !ok {
		return false
	}
	return id.Name == "error"
}

// receiverTypeName renders a method's receiver as a short string
// like "*Pipeline" or "Pipeline" for comparison against the lock's
// allow-list. Returns "" if the receiver shape is unrecognised
// (which is itself a programmer-bug case worth surfacing — but for
// this test we conservatively skip such methods).
func receiverTypeName(recv *ast.FieldList) string {
	if recv == nil || len(recv.List) == 0 {
		return ""
	}
	t := recv.List[0].Type
	switch x := t.(type) {
	case *ast.StarExpr:
		if id, ok := x.X.(*ast.Ident); ok {
			return "*" + id.Name
		}
	case *ast.Ident:
		return x.Name
	}
	return ""
}
