package normalize

import (
	"context"
	"testing"
	"time"

	"github.com/rs/zerolog"
	ftproto "github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
)

// TestPipelineProcess_ObserverInvokedFromBytesEntry exercises the FULL
// Process(ctx, bytes, vehicleID) path — proto.Unmarshal -> codec.Decode
// -> sortAtomicsSettingUnitFirst -> processOne loop -> AtomicsObserver
// fan-out — to verify the bytes-in entry and the AtomicsObserver
// integration are wired end-to-end. The other observer tests in
// observer_test.go drive processAtomics directly to keep the
// dependency on a hand-built proto fixture minimal; this file owns
// the one bytes-in test so a future codec-level regression that
// breaks the Process delegation gets caught here.
func TestPipelineProcess_ObserverInvokedFromBytesEntry(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 77
	emittedAt := time.Date(2026, 5, 5, 13, 0, 0, 0, time.UTC)

	// Two atomics through the bytes path: a unit-bearing field
	// (VehicleSpeed) that exercises the toSI conversion arm and a
	// dimensionless enum (Gear) that flows through pass-through.
	// The observer must receive BOTH post-route.
	payload := &ftproto.Payload{
		Vin:       "5YJ3OBSERVER0001",
		CreatedAt: timestamppb.New(emittedAt),
		Data: []*ftproto.Datum{
			{
				Key:   ftproto.Field_VehicleSpeed,
				Value: &ftproto.Value{Value: &ftproto.Value_FloatValue{FloatValue: 0}},
			},
			{
				Key: ftproto.Field_Gear,
				Value: &ftproto.Value{Value: &ftproto.Value_ShiftStateValue{
					ShiftStateValue: ftproto.ShiftState_ShiftStateP,
				}},
			},
		},
	}
	wireBytes, err := proto.Marshal(payload)
	if err != nil {
		t.Fatalf("proto.Marshal: %v", err)
	}

	// Pre-seed the unit-history repo so VehicleSpeed converts cleanly
	// (km/h -> m/s with active=km). Without this seed the dispatch
	// would tag VehicleSpeed as dropped_no_unit and the observer
	// would still see it (with raw Value), but seeding makes the
	// happy-path expectations crisp.
	repo := &fakeRepo{}
	repo.entries = append(repo.entries, unithistory.Entry{
		VehicleID:     vehicleID,
		Kind:          unithistory.KindDistance,
		Value:         units.ActiveUnitKilometers,
		EffectiveFrom: emittedAt.Add(-time.Hour),
		Source:        unithistory.SourceTelemetry,
	})

	rt := &fakeRouter{}
	obs := newRecordingObserver("from-bytes")
	p := New(repo, rt, zerolog.Nop(), obs)

	if err := p.Process(context.Background(), wireBytes, vehicleID); err != nil {
		t.Fatalf("Process returned error: %v", err)
	}

	if got := obs.calls(); got != 1 {
		t.Fatalf("observer call count = %d, want 1 (Process should fan out exactly once per payload)", got)
	}
	captured := obs.lastCapture()
	if len(captured) != 2 {
		t.Fatalf("observer captured %d atomics, want 2 (VehicleSpeed + Gear); got %+v", len(captured), captured)
	}
	if findAtomic(captured, "VehicleSpeed") == nil {
		t.Errorf("observer slice missing VehicleSpeed; got %+v", captured)
	}
	if findAtomic(captured, "Gear") == nil {
		t.Errorf("observer slice missing Gear; got %+v", captured)
	}

	// Router must have received the two atomics (VehicleSpeed +
	// Gear) — neither is a Setting*Unit so neither short-circuits.
	if got := rt.routesCopy(); len(got) != 2 {
		t.Errorf("router received %d routes, want 2: %+v", len(got), got)
	}
}

// TestPipelineProcessAtomics_DelegatesToInternalDispatch is the unit
// test for the SECOND public ingest entry added in Phase-42a/0060.
// Whereas TestPipelineProcess_ObserverInvokedFromBytesEntry exercises
// the bytes-in path (proto.Unmarshal -> codec.Decode -> processAtomics),
// this test exercises the atomics-in path used by the HTTP webhook
// adapter — Pipeline.ProcessAtomics(ctx, []codec.Atomic, vehicleID)
// is a thin wrapper around the same processAtomics dispatch, so the
// observer fan-out, router dispatch, and SI mutation contracts must
// all be identical to Process beyond the codec.Decode step.
func TestPipelineProcessAtomics_DelegatesToInternalDispatch(t *testing.T) {
	t.Parallel()

	const vehicleID int64 = 91
	emittedAt := time.Date(2026, 5, 5, 13, 0, 0, 0, time.UTC)

	// Two atomics fed directly: a unit-bearing field (VehicleSpeed
	// in km/h) and a dimensionless string (Gear). The observer must
	// see both post-route, mirroring the bytes-in test.
	atomics := []codec.Atomic{
		{
			Field:     "VehicleSpeed",
			Value:     float64(72.0), // 72 km/h
			VehicleID: "5YJ3WEBHOOK00001",
			EmittedAt: emittedAt,
		},
		{
			Field:     "Gear",
			Value:     "ShiftStateD",
			VehicleID: "5YJ3WEBHOOK00001",
			EmittedAt: emittedAt,
		},
	}

	repo := &fakeRepo{}
	repo.entries = append(repo.entries, unithistory.Entry{
		VehicleID:     vehicleID,
		Kind:          unithistory.KindDistance,
		Value:         units.ActiveUnitKilometers,
		EffectiveFrom: emittedAt.Add(-time.Hour),
		Source:        unithistory.SourceTelemetry,
	})

	rt := &fakeRouter{}
	obs := newRecordingObserver("from-atomics")
	p := New(repo, rt, zerolog.Nop(), obs)

	if err := p.ProcessAtomics(context.Background(), atomics, vehicleID); err != nil {
		t.Fatalf("ProcessAtomics returned error: %v", err)
	}

	if got := obs.calls(); got != 1 {
		t.Fatalf("observer call count = %d, want 1 (ProcessAtomics should fan out exactly once per batch)", got)
	}
	captured := obs.lastCapture()
	if len(captured) != 2 {
		t.Fatalf("observer captured %d atomics, want 2 (VehicleSpeed + Gear); got %+v", len(captured), captured)
	}
	if findAtomic(captured, "VehicleSpeed") == nil {
		t.Errorf("observer slice missing VehicleSpeed; got %+v", captured)
	}
	if findAtomic(captured, "Gear") == nil {
		t.Errorf("observer slice missing Gear; got %+v", captured)
	}

	// Router must have received both atomics — neither is a Setting*Unit
	// so neither short-circuits via observeSettingUnit.
	if got := rt.routesCopy(); len(got) != 2 {
		t.Errorf("router received %d routes, want 2: %+v", len(got), got)
	}
}

// TestPipelineProcessAtomics_EmptyBatchIsNoOp documents the contract
// for an empty []codec.Atomic input: the observer is invoked exactly
// once with an empty slice, the router is not called, and no error
// is returned. The HTTP webhook can legitimately receive a payload
// with zero signals (e.g. a heartbeat-only ping); the pipeline must
// not error on it.
func TestPipelineProcessAtomics_EmptyBatchIsNoOp(t *testing.T) {
	t.Parallel()

	repo := &fakeRepo{}
	rt := &fakeRouter{}
	obs := newRecordingObserver("empty-batch")
	p := New(repo, rt, zerolog.Nop(), obs)

	if err := p.ProcessAtomics(context.Background(), nil, 1); err != nil {
		t.Fatalf("ProcessAtomics(nil) returned error: %v", err)
	}
	if got := obs.calls(); got != 1 {
		t.Errorf("observer call count = %d, want 1 (observer must fire exactly once per batch even when empty)", got)
	}
	if got := rt.routesCopy(); len(got) != 0 {
		t.Errorf("router received %d routes for empty batch, want 0: %+v", len(got), got)
	}
}

