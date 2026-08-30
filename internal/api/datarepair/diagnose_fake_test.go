package datarepair

import (
	"context"
	"fmt"
	"time"

	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// fakeDiagnosis is an in-memory diagnosisSource. Every method filters the
// fixture slices with the SAME time-window semantics the SQL uses, so a test
// that passes here is exercising the real analyzer decision tree:
//
//	"first after"  → ts >  after AND ts <= until, ascending, first row
//	"last before"  → ts >= from  AND ts <= to,    descending, first row
//
// Errors are injected per-method so error propagation is testable without a
// database.
type fakeDiagnosis struct {
	openDrives     []datarepairdb.SessionCandidate
	overrunDrives  []datarepairdb.SessionCandidate
	openCharges    []datarepairdb.SessionCandidate
	overrunCharges []datarepairdb.SessionCandidate

	drivesByID  map[int64]datarepairdb.SessionCandidate
	chargesByID map[int64]datarepairdb.SessionCandidate

	// chargeStates are signal_log DetailedChargeState rows (Value = raw state).
	chargeStates []datarepairdb.Observation
	// gearObs are drive_telemetry rows carrying a gear (Value = "D"/"P"/…).
	gearObs []datarepairdb.Observation
	// drivingObs are drive_telemetry rows consistent with motion.
	drivingObs []datarepairdb.Observation
	// powerObs are charging_telemetry rows with positive charging power.
	powerObs []datarepairdb.Observation
	// chargeStarts / driveStarts are session rows keyed by their start instant.
	chargeStarts []sessionStart
	driveStarts  []sessionStart

	listErr     error
	evidenceErr error

	// Call counters used to assert the analyzer does not skip guards.
	liveDriveChecks  int
	liveChargeChecks int
}

type sessionStart struct {
	ts time.Time
	id int64
}

// Local aliases keep the fixture literals in the tests readable.
type (
	datarepairObs       = datarepairdb.Observation
	datarepairCandidate = datarepairdb.SessionCandidate
)

func (f *fakeDiagnosis) ListOpenDrives(_ context.Context, since time.Time, _ *int64, limit int) ([]datarepairdb.SessionCandidate, error) {
	return f.sliceCandidates(f.openDrives, since, limit)
}

func (f *fakeDiagnosis) ListOverrunDrives(_ context.Context, since time.Time, _ *int64, _ time.Duration, limit int) ([]datarepairdb.SessionCandidate, error) {
	return f.sliceCandidates(f.overrunDrives, since, limit)
}

func (f *fakeDiagnosis) ListOpenChargingSessions(_ context.Context, since time.Time, _ *int64, limit int) ([]datarepairdb.SessionCandidate, error) {
	return f.sliceCandidates(f.openCharges, since, limit)
}

func (f *fakeDiagnosis) ListOverrunChargingSessions(_ context.Context, since time.Time, _ *int64, _ time.Duration, limit int) ([]datarepairdb.SessionCandidate, error) {
	return f.sliceCandidates(f.overrunCharges, since, limit)
}

func (f *fakeDiagnosis) sliceCandidates(in []datarepairdb.SessionCandidate, since time.Time, limit int) ([]datarepairdb.SessionCandidate, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	out := make([]datarepairdb.SessionCandidate, 0, len(in))
	for _, c := range in {
		if c.StartedAt.Before(since) {
			continue
		}
		if len(out) >= limit {
			break
		}
		out = append(out, c)
	}
	return out, nil
}

func (f *fakeDiagnosis) GetDriveCandidate(_ context.Context, id int64) (*datarepairdb.SessionCandidate, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	c, ok := f.drivesByID[id]
	if !ok {
		return nil, nil
	}
	return &c, nil
}

func (f *fakeDiagnosis) GetChargingCandidate(_ context.Context, id int64) (*datarepairdb.SessionCandidate, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	c, ok := f.chargesByID[id]
	if !ok {
		return nil, nil
	}
	return &c, nil
}

func (f *fakeDiagnosis) ChargeStateObservations(_ context.Context, _ int64, _ []string, after, until time.Time, limit int) ([]datarepairdb.Observation, error) {
	if f.evidenceErr != nil {
		return nil, f.evidenceErr
	}
	out := make([]datarepairdb.Observation, 0, len(f.chargeStates))
	for _, o := range f.chargeStates {
		if o.Ts.After(after) && !o.Ts.After(until) {
			out = append(out, o)
		}
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (f *fakeDiagnosis) FirstGearObservation(_ context.Context, _ int64, gears []string, after, until time.Time) (*datarepairdb.Observation, error) {
	if f.evidenceErr != nil {
		return nil, f.evidenceErr
	}
	for i := range f.gearObs {
		o := f.gearObs[i]
		if !o.Ts.After(after) || o.Ts.After(until) {
			continue
		}
		if containsString(gears, o.Value) {
			return &o, nil
		}
	}
	return nil, nil
}

func (f *fakeDiagnosis) LastDrivingObservation(_ context.Context, _ int64, _ []string, from, to time.Time) (*datarepairdb.Observation, error) {
	if f.evidenceErr != nil {
		return nil, f.evidenceErr
	}
	if to.Sub(from) == liveActivityWindow {
		f.liveDriveChecks++
	}
	return lastInWindow(f.drivingObs, from, to), nil
}

func (f *fakeDiagnosis) LastChargingPowerObservation(_ context.Context, _ int64, from, to time.Time) (*datarepairdb.Observation, error) {
	if f.evidenceErr != nil {
		return nil, f.evidenceErr
	}
	if to.Sub(from) == liveActivityWindow {
		f.liveChargeChecks++
	}
	return lastInWindow(f.powerObs, from, to), nil
}

func (f *fakeDiagnosis) FirstChargingSessionAfter(_ context.Context, _ int64, after time.Time, excludeID int64) (*datarepairdb.Observation, error) {
	return f.firstSessionAfter(f.chargeStarts, after, excludeID,
		systemmodel.SessionRepairSourceChargingSessions, "charging_session.started_at")
}

func (f *fakeDiagnosis) FirstDriveAfter(_ context.Context, _ int64, after time.Time, excludeID int64) (*datarepairdb.Observation, error) {
	return f.firstSessionAfter(f.driveStarts, after, excludeID,
		systemmodel.SessionRepairSourceDrives, "drive.started_at")
}

func (f *fakeDiagnosis) firstSessionAfter(
	in []sessionStart,
	after time.Time,
	excludeID int64,
	source systemmodel.SessionRepairEvidenceSource,
	field string,
) (*datarepairdb.Observation, error) {
	if f.evidenceErr != nil {
		return nil, f.evidenceErr
	}
	for _, s := range in {
		if !s.ts.After(after) || s.id == excludeID {
			continue
		}
		return &datarepairdb.Observation{
			Ts:     s.ts,
			Source: source,
			Field:  field,
			Value:  fmt.Sprintf("#%d", s.id),
		}, nil
	}
	return nil, nil
}

func containsString(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func lastInWindow(in []datarepairdb.Observation, from, to time.Time) *datarepairdb.Observation {
	var found *datarepairdb.Observation
	for i := range in {
		o := in[i]
		if o.Ts.Before(from) || o.Ts.After(to) {
			continue
		}
		if found == nil || o.Ts.After(found.Ts) {
			cp := o
			found = &cp
		}
	}
	return found
}

// Compile-time assertion that the fake satisfies the production port.
var _ diagnosisSource = (*fakeDiagnosis)(nil)

// ---- fixture builders ----------------------------------------------------

func driveTelemetryObs(ts time.Time, field, value string) datarepairdb.Observation {
	return datarepairdb.Observation{
		Ts:     ts,
		Source: systemmodel.SessionRepairSourceDriveTelemetry,
		Field:  field,
		Value:  value,
	}
}

func chargeStateObs(ts time.Time, value string) datarepairdb.Observation {
	return datarepairdb.Observation{
		Ts:     ts,
		Source: systemmodel.SessionRepairSourceSignalLog,
		Field:  "DetailedChargeState",
		Value:  value,
	}
}

func chargingPowerObs(ts time.Time, watts float64) datarepairdb.Observation {
	return datarepairdb.Observation{
		Ts:     ts,
		Source: systemmodel.SessionRepairSourceChargingTelemetry,
		Field:  "ACChargingPower",
		Value:  fmt.Sprintf("%.0f W", watts),
	}
}

func candidate(id, vehicleID int64, start time.Time, end *time.Time) datarepairdb.SessionCandidate {
	return datarepairdb.SessionCandidate{
		ID:        id,
		VehicleID: vehicleID,
		StartedAt: start,
		EndedAt:   end,
	}
}

func timePtr(t time.Time) *time.Time { return &t }

// newDiagnosisHandler builds a handler wired to the fake evidence source and
// the pinned test clock.
func newDiagnosisHandler(src diagnosisSource) *DataRepairHandler {
	return &DataRepairHandler{
		chargingRepo: &fakeChargingRepo{},
		driveRepo:    &fakeDriveRepo{},
		clock:        func() time.Time { return testNow },
		diagnosis:    src,
	}
}
