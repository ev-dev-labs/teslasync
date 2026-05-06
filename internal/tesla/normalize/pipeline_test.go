package normalize

import (
	"context"
	"testing"
	"time"

	"github.com/rs/zerolog"
	ftproto "github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

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

