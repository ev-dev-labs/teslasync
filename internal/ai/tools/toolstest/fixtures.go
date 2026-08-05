package toolstest

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// FakeVehicles implements the narrow vehicle-read port that tools
// like query_vehicle_count + query_vehicle_state need. All access is
// in-memory; the test populates All and One directly.
type FakeVehicles struct {
	All []*vehiclemodel.Vehicle
	One map[int64]*vehiclemodel.Vehicle
	Err error
}

// GetAll returns every vehicle the fake was seeded with, or Err.
// On error it returns a nil slice (mirroring GetByID and the real
// *vehicledb.VehicleRepo, which never returns rows alongside an
// error) so a fake stands in for the production repo faithfully.
func (f *FakeVehicles) GetAll(_ context.Context) ([]*vehiclemodel.Vehicle, error) {
	if f.Err != nil {
		return nil, f.Err
	}
	return f.All, nil
}

// GetByID returns the vehicle with the given ID, or Err.
func (f *FakeVehicles) GetByID(_ context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	if f.Err != nil {
		return nil, f.Err
	}
	return f.One[id], nil
}

// FakeState satisfies the SignalAt port used by every tool that
// reads a single vehicle signal at a point in time. The fake ignores
// the requested timestamp and vehicle ID and returns whatever the
// test seeded for the signal name.
type FakeState struct {
	Values map[string]any
}

// SignalAt returns the seeded value for sig, ignoring vid and at.
func (f *FakeState) SignalAt(_ context.Context, _ int64, sig string, _ time.Time) (any, error) {
	return f.Values[sig], nil
}

// FakeDrives implements every drive-read port the tools use
// (GetByVehicle for windowed slices, GetByID for detail).
type FakeDrives struct {
	Rows []*drivemodel.Drive
	One  map[int64]*drivemodel.Drive
}

// GetByVehicle returns up to limit drives, or all if limit <= 0.
func (f *FakeDrives) GetByVehicle(_ context.Context, _ int64, limit, _ int, _, _ time.Time) ([]*drivemodel.Drive, error) {
	if limit > 0 && limit < len(f.Rows) {
		return f.Rows[:limit], nil
	}
	return f.Rows, nil
}

// GetByID returns the drive with the given ID, or nil.
func (f *FakeDrives) GetByID(_ context.Context, id int64) (*drivemodel.Drive, error) {
	return f.One[id], nil
}

// FakeCharges implements every charging-session-read port the tools
// use (GetByVehicle for windowed slices, GetByID for detail).
type FakeCharges struct {
	Rows []*chargingmodel.ChargingSession
	One  map[int64]*chargingmodel.ChargingSession
}

// GetByVehicle returns up to limit charging sessions, or all if
// limit <= 0.
func (f *FakeCharges) GetByVehicle(_ context.Context, _ int64, limit, _ int, _, _ time.Time) ([]*chargingmodel.ChargingSession, error) {
	if limit > 0 && limit < len(f.Rows) {
		return f.Rows[:limit], nil
	}
	return f.Rows, nil
}

// GetByID returns the session with the given ID, or nil.
func (f *FakeCharges) GetByID(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
	return f.One[id], nil
}

// FakeRules implements the alert-rule-read port (GetAll only).
type FakeRules struct {
	Rules []*alertmodel.AlertRule
}

// GetAll returns every seeded rule.
func (f *FakeRules) GetAll(_ context.Context) ([]*alertmodel.AlertRule, error) {
	return f.Rules, nil
}

// FakeNotif implements the alert-backed notification-log read port.
type FakeNotif struct {
	Logs []*notificationmodel.NotificationLog
}

// GetLogs returns every seeded log entry for legacy tool fixtures.
func (f *FakeNotif) GetLogs(_ context.Context, _, _ int) ([]*notificationmodel.NotificationLog, error) {
	return f.Logs, nil
}

// GetAlertLogs returns every seeded alert-backed log entry.
func (f *FakeNotif) GetAlertLogs(_ context.Context, _, _ int) ([]*notificationmodel.NotificationLog, error) {
	return f.Logs, nil
}

// FakeFences implements the geofence-read port (GetAll only).
type FakeFences struct {
	Fences []*systemmodel.Geofence
}

// GetAll returns every seeded geofence.
func (f *FakeFences) GetAll(_ context.Context) ([]*systemmodel.Geofence, error) {
	return f.Fences, nil
}

// FakeRetriever records every Retrieve call for assertions and
// returns canned chunks. Implements rag.Retriever; Index + Forget
// are no-ops because the tools never call them.
type FakeRetriever struct {
	Subjects    []string
	Queries     []string
	SourceTypes [][]string
	Ks          []int
	Out         []rag.Chunk
	Err         error
}

// Retrieve records the call and returns Out (or Err).
func (f *FakeRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
	f.Subjects = append(f.Subjects, subject)
	f.Queries = append(f.Queries, query)
	dup := make([]string, len(sourceTypes))
	copy(dup, sourceTypes)
	f.SourceTypes = append(f.SourceTypes, dup)
	f.Ks = append(f.Ks, k)
	if f.Err != nil {
		return nil, f.Err
	}
	return f.Out, nil
}

// Index is a no-op; the tools never call it.
func (f *FakeRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

// Forget is a no-op; the tools never call it.
func (f *FakeRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

// PtrString returns a pointer to the given string. Test sugar.
func PtrString(s string) *string { return &s }

// PtrInt16 returns a pointer to the given int16. Test sugar.
func PtrInt16(v int16) *int16 { return &v }

// PtrFloat64 returns a pointer to the given float64. Test sugar.
func PtrFloat64(v float64) *float64 { return &v }

// PtrTime returns a pointer to the given time.Time. Test sugar.
func PtrTime(t time.Time) *time.Time { return &t }

// FixedNow returns a deterministic 2025-06-01 12:00 UTC timestamp
// for tests that need a stable "now" reference.
func FixedNow() time.Time {
	return time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
}
