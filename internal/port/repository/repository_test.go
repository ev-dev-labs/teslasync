package repository_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
	"github.com/ev-dev-labs/teslasync/internal/domain/user"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// This package is a hexagonal *port* layer: it declares persistence interfaces
// plus the FSMTransitionRecord contract struct. There is no concrete logic to
// exercise, so "elevation" here follows the sibling internal/port/messaging
// precedent:
//   1. Reflection locks on each port's method set + signature (regression guard
//      against accidental contract drift).
//   2. Compile-time conformance proofs that the ports are satisfiable.
//   3. In-memory fake round-trip tests documenting the expected adapter
//      semantics (not-found -> domain.ErrNotFound, list filters, date-range
//      boundaries, limits, error propagation, nil validation) under -race.
//   4. Wire (json) + persistence (db) contract locks on FSMTransitionRecord.

// ---------------------------------------------------------------------------
// 1. Interface surface locks
// ---------------------------------------------------------------------------

type methodSpec struct {
	name string
	in   []reflect.Type
	out  []reflect.Type
}

var (
	ctxT  = reflect.TypeOf((*context.Context)(nil)).Elem()
	errT  = reflect.TypeOf((*error)(nil)).Elem()
	strT  = reflect.TypeOf("")
	intT  = reflect.TypeOf(int(0))
	timeT = reflect.TypeOf(time.Time{})

	vehPtr   = reflect.TypeOf((*vehicle.Vehicle)(nil))
	vehSlice = reflect.TypeOf([]vehicle.Vehicle(nil))
	chgPtr   = reflect.TypeOf((*charging.ChargingSession)(nil))
	chgSlice = reflect.TypeOf([]charging.ChargingSession(nil))
	tripPtr  = reflect.TypeOf((*trip.Trip)(nil))
	tripSl   = reflect.TypeOf([]trip.Trip(nil))
	usrPtr   = reflect.TypeOf((*user.User)(nil))
	notPtr   = reflect.TypeOf((*notification.Notification)(nil))
	notSlice = reflect.TypeOf([]notification.Notification(nil))
	expPtr   = reflect.TypeOf((*export.ExportJob)(nil))
	expSlice = reflect.TypeOf([]export.ExportJob(nil))
	recT     = reflect.TypeOf(repository.FSMTransitionRecord{})
	recSlice = reflect.TypeOf([]repository.FSMTransitionRecord(nil))
)

// TestRepositoryInterfaceSurfaces locks the method set and full signature of
// every persistence port. A rename, added/removed method, or changed
// argument/return type fails here before it can silently break an adapter.
func TestRepositoryInterfaceSurfaces(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		iface   reflect.Type
		methods []methodSpec
	}{
		{
			name:  "VehicleRepository",
			iface: reflect.TypeOf((*repository.VehicleRepository)(nil)).Elem(),
			methods: []methodSpec{
				{"GetByID", []reflect.Type{ctxT, strT}, []reflect.Type{vehPtr, errT}},
				{"GetByUserID", []reflect.Type{ctxT, strT}, []reflect.Type{vehSlice, errT}},
				{"GetByVIN", []reflect.Type{ctxT, strT}, []reflect.Type{vehPtr, errT}},
				{"Save", []reflect.Type{ctxT, vehPtr}, []reflect.Type{errT}},
				{"Delete", []reflect.Type{ctxT, strT}, []reflect.Type{errT}},
				{"GetByIDForUpdate", []reflect.Type{ctxT, strT}, []reflect.Type{vehPtr, errT}},
			},
		},
		{
			name:  "ChargingSessionRepository",
			iface: reflect.TypeOf((*repository.ChargingSessionRepository)(nil)).Elem(),
			methods: []methodSpec{
				{"GetByID", []reflect.Type{ctxT, strT}, []reflect.Type{chgPtr, errT}},
				{"GetByVehicleID", []reflect.Type{ctxT, strT}, []reflect.Type{chgSlice, errT}},
				{"ListByDateRange", []reflect.Type{ctxT, strT, timeT, timeT}, []reflect.Type{chgSlice, errT}},
				{"Save", []reflect.Type{ctxT, chgPtr}, []reflect.Type{errT}},
				{"GetByIDForUpdate", []reflect.Type{ctxT, strT}, []reflect.Type{chgPtr, errT}},
			},
		},
		{
			name:  "ExportJobRepository",
			iface: reflect.TypeOf((*repository.ExportJobRepository)(nil)).Elem(),
			methods: []methodSpec{
				{"GetByID", []reflect.Type{ctxT, strT}, []reflect.Type{expPtr, errT}},
				{"GetByUserID", []reflect.Type{ctxT, strT}, []reflect.Type{expSlice, errT}},
				{"Save", []reflect.Type{ctxT, expPtr}, []reflect.Type{errT}},
				{"GetByIDForUpdate", []reflect.Type{ctxT, strT}, []reflect.Type{expPtr, errT}},
			},
		},
		{
			name:  "FSMHistoryRepository",
			iface: reflect.TypeOf((*repository.FSMHistoryRepository)(nil)).Elem(),
			methods: []methodSpec{
				{"RecordTransition", []reflect.Type{ctxT, recT}, []reflect.Type{errT}},
				{"GetHistory", []reflect.Type{ctxT, strT, intT}, []reflect.Type{recSlice, errT}},
				{"GetByEntityID", []reflect.Type{ctxT, strT}, []reflect.Type{recSlice, errT}},
			},
		},
		{
			name:  "NotificationRepository",
			iface: reflect.TypeOf((*repository.NotificationRepository)(nil)).Elem(),
			methods: []methodSpec{
				{"GetByID", []reflect.Type{ctxT, strT}, []reflect.Type{notPtr, errT}},
				{"GetByUserID", []reflect.Type{ctxT, strT}, []reflect.Type{notSlice, errT}},
				{"GetPending", []reflect.Type{ctxT, intT}, []reflect.Type{notSlice, errT}},
				{"Save", []reflect.Type{ctxT, notPtr}, []reflect.Type{errT}},
				{"GetByIDForUpdate", []reflect.Type{ctxT, strT}, []reflect.Type{notPtr, errT}},
			},
		},
		{
			name:  "TripRepository",
			iface: reflect.TypeOf((*repository.TripRepository)(nil)).Elem(),
			methods: []methodSpec{
				{"GetByID", []reflect.Type{ctxT, strT}, []reflect.Type{tripPtr, errT}},
				{"GetByVehicleID", []reflect.Type{ctxT, strT}, []reflect.Type{tripSl, errT}},
				{"ListByDateRange", []reflect.Type{ctxT, strT, timeT, timeT}, []reflect.Type{tripSl, errT}},
				{"Save", []reflect.Type{ctxT, tripPtr}, []reflect.Type{errT}},
				{"GetByIDForUpdate", []reflect.Type{ctxT, strT}, []reflect.Type{tripPtr, errT}},
			},
		},
		{
			name:  "UserRepository",
			iface: reflect.TypeOf((*repository.UserRepository)(nil)).Elem(),
			methods: []methodSpec{
				{"GetByID", []reflect.Type{ctxT, strT}, []reflect.Type{usrPtr, errT}},
				{"GetByEmail", []reflect.Type{ctxT, strT}, []reflect.Type{usrPtr, errT}},
				{"Save", []reflect.Type{ctxT, usrPtr}, []reflect.Type{errT}},
				{"Delete", []reflect.Type{ctxT, strT}, []reflect.Type{errT}},
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if tc.iface.Kind() != reflect.Interface {
				t.Fatalf("%s must be an interface, got %v", tc.name, tc.iface.Kind())
			}
			if got, want := tc.iface.NumMethod(), len(tc.methods); got != want {
				t.Fatalf("%s method count: got %d %v, want %d", tc.name, got, methodNames(tc.iface), want)
			}
			for _, spec := range tc.methods {
				checkMethod(t, tc.name, tc.iface, spec)
			}
		})
	}
}

func methodNames(iface reflect.Type) []string {
	names := make([]string, iface.NumMethod())
	for i := 0; i < iface.NumMethod(); i++ {
		names[i] = iface.Method(i).Name
	}
	return names
}

func checkMethod(t *testing.T, ifaceName string, iface reflect.Type, spec methodSpec) {
	t.Helper()
	m, ok := iface.MethodByName(spec.name)
	if !ok {
		t.Errorf("%s: missing method %s", ifaceName, spec.name)
		return
	}
	// For interface types, Method.Type carries no receiver: In(0) is the first
	// real argument.
	mt := m.Type
	if got, want := mt.NumIn(), len(spec.in); got != want {
		t.Errorf("%s.%s: got %d args, want %d", ifaceName, spec.name, got, want)
	} else {
		for i, want := range spec.in {
			if got := mt.In(i); got != want {
				t.Errorf("%s.%s arg %d: got %v, want %v", ifaceName, spec.name, i, got, want)
			}
		}
	}
	if got, want := mt.NumOut(), len(spec.out); got != want {
		t.Errorf("%s.%s: got %d returns, want %d", ifaceName, spec.name, got, want)
	} else {
		for i, want := range spec.out {
			if got := mt.Out(i); got != want {
				t.Errorf("%s.%s return %d: got %v, want %v", ifaceName, spec.name, i, got, want)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// 2. Compile-time conformance: each fake satisfies its port.
// ---------------------------------------------------------------------------

var (
	_ repository.VehicleRepository         = (*fakeVehicleRepo)(nil)
	_ repository.ChargingSessionRepository = (*fakeChargingRepo)(nil)
	_ repository.ExportJobRepository       = (*fakeExportRepo)(nil)
	_ repository.FSMHistoryRepository      = (*fakeFSMHistory)(nil)
	_ repository.NotificationRepository    = (*fakeNotificationRepo)(nil)
	_ repository.TripRepository            = (*fakeTripRepo)(nil)
	_ repository.UserRepository            = (*fakeUserRepo)(nil)
)

// ---------------------------------------------------------------------------
// 3. In-memory fakes (mutex-guarded so the suite is meaningful under -race).
// ---------------------------------------------------------------------------

func inRange(ts, from, to time.Time) bool { return !ts.Before(from) && !ts.After(to) }

// --- vehicle ---
type fakeVehicleRepo struct {
	mu      sync.Mutex
	byID    map[string]vehicle.Vehicle
	saveErr error
}

func newFakeVehicleRepo() *fakeVehicleRepo {
	return &fakeVehicleRepo{byID: make(map[string]vehicle.Vehicle)}
}

func (f *fakeVehicleRepo) GetByID(_ context.Context, id string) (*vehicle.Vehicle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.byID[id]
	if !ok {
		return nil, fmt.Errorf("vehicle %s: %w", id, domain.ErrNotFound)
	}
	cp := v
	return &cp, nil
}

func (f *fakeVehicleRepo) GetByVIN(_ context.Context, vin string) (*vehicle.Vehicle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, v := range f.byID {
		if v.VIN == vin {
			cp := v
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("vehicle vin %s: %w", vin, domain.ErrNotFound)
}

func (f *fakeVehicleRepo) GetByUserID(_ context.Context, userID string) ([]vehicle.Vehicle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []vehicle.Vehicle
	for _, v := range f.byID {
		if v.UserID == userID {
			out = append(out, v)
		}
	}
	return out, nil
}

func (f *fakeVehicleRepo) GetByIDForUpdate(ctx context.Context, id string) (*vehicle.Vehicle, error) {
	return f.GetByID(ctx, id)
}

func (f *fakeVehicleRepo) Save(_ context.Context, v *vehicle.Vehicle) error {
	if v == nil {
		return fmt.Errorf("save vehicle: nil aggregate: %w", domain.ErrValidation)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.saveErr != nil {
		return fmt.Errorf("save vehicle %s: %w", v.ID, f.saveErr)
	}
	f.byID[v.ID] = *v
	return nil
}

func (f *fakeVehicleRepo) Delete(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.byID[id]; !ok {
		return fmt.Errorf("delete vehicle %s: %w", id, domain.ErrNotFound)
	}
	delete(f.byID, id)
	return nil
}

// --- charging ---
type fakeChargingRepo struct {
	mu   sync.Mutex
	byID map[string]charging.ChargingSession
}

func newFakeChargingRepo() *fakeChargingRepo {
	return &fakeChargingRepo{byID: make(map[string]charging.ChargingSession)}
}

func (f *fakeChargingRepo) GetByID(_ context.Context, id string) (*charging.ChargingSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.byID[id]
	if !ok {
		return nil, fmt.Errorf("charging session %s: %w", id, domain.ErrNotFound)
	}
	cp := s
	return &cp, nil
}

func (f *fakeChargingRepo) GetByVehicleID(_ context.Context, vehicleID string) ([]charging.ChargingSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []charging.ChargingSession
	for _, s := range f.byID {
		if s.VehicleID == vehicleID {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f *fakeChargingRepo) ListByDateRange(_ context.Context, vehicleID string, from, to time.Time) ([]charging.ChargingSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []charging.ChargingSession
	for _, s := range f.byID {
		if s.VehicleID == vehicleID && inRange(s.StartedAt, from, to) {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f *fakeChargingRepo) GetByIDForUpdate(ctx context.Context, id string) (*charging.ChargingSession, error) {
	return f.GetByID(ctx, id)
}

func (f *fakeChargingRepo) Save(_ context.Context, s *charging.ChargingSession) error {
	if s == nil {
		return fmt.Errorf("save charging session: nil aggregate: %w", domain.ErrValidation)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byID[s.ID] = *s
	return nil
}

// --- export ---
type fakeExportRepo struct {
	mu   sync.Mutex
	byID map[string]export.ExportJob
}

func newFakeExportRepo() *fakeExportRepo {
	return &fakeExportRepo{byID: make(map[string]export.ExportJob)}
}

func (f *fakeExportRepo) GetByID(_ context.Context, id string) (*export.ExportJob, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	j, ok := f.byID[id]
	if !ok {
		return nil, fmt.Errorf("export job %s: %w", id, domain.ErrNotFound)
	}
	cp := j
	return &cp, nil
}

func (f *fakeExportRepo) GetByUserID(_ context.Context, userID string) ([]export.ExportJob, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []export.ExportJob
	for _, j := range f.byID {
		if j.UserID == userID {
			out = append(out, j)
		}
	}
	return out, nil
}

func (f *fakeExportRepo) GetByIDForUpdate(ctx context.Context, id string) (*export.ExportJob, error) {
	return f.GetByID(ctx, id)
}

func (f *fakeExportRepo) Save(_ context.Context, j *export.ExportJob) error {
	if j == nil {
		return fmt.Errorf("save export job: nil aggregate: %w", domain.ErrValidation)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byID[j.ID] = *j
	return nil
}

// --- notification ---
type fakeNotificationRepo struct {
	mu   sync.Mutex
	byID map[string]notification.Notification
}

func newFakeNotificationRepo() *fakeNotificationRepo {
	return &fakeNotificationRepo{byID: make(map[string]notification.Notification)}
}

func (f *fakeNotificationRepo) GetByID(_ context.Context, id string) (*notification.Notification, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.byID[id]
	if !ok {
		return nil, fmt.Errorf("notification %s: %w", id, domain.ErrNotFound)
	}
	cp := n
	return &cp, nil
}

func (f *fakeNotificationRepo) GetByUserID(_ context.Context, userID string) ([]notification.Notification, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []notification.Notification
	for _, n := range f.byID {
		if n.UserID == userID {
			out = append(out, n)
		}
	}
	return out, nil
}

// GetPending returns not-yet-sent notifications (SentAt zero), capped by limit
// (limit <= 0 means no cap).
func (f *fakeNotificationRepo) GetPending(_ context.Context, limit int) ([]notification.Notification, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []notification.Notification
	for _, n := range f.byID {
		if n.SentAt.IsZero() {
			out = append(out, n)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeNotificationRepo) GetByIDForUpdate(ctx context.Context, id string) (*notification.Notification, error) {
	return f.GetByID(ctx, id)
}

func (f *fakeNotificationRepo) Save(_ context.Context, n *notification.Notification) error {
	if n == nil {
		return fmt.Errorf("save notification: nil aggregate: %w", domain.ErrValidation)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byID[n.ID] = *n
	return nil
}

// --- trip ---
type fakeTripRepo struct {
	mu   sync.Mutex
	byID map[string]trip.Trip
}

func newFakeTripRepo() *fakeTripRepo {
	return &fakeTripRepo{byID: make(map[string]trip.Trip)}
}

func (f *fakeTripRepo) GetByID(_ context.Context, id string) (*trip.Trip, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	tr, ok := f.byID[id]
	if !ok {
		return nil, fmt.Errorf("trip %s: %w", id, domain.ErrNotFound)
	}
	cp := tr
	return &cp, nil
}

func (f *fakeTripRepo) GetByVehicleID(_ context.Context, vehicleID string) ([]trip.Trip, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []trip.Trip
	for _, tr := range f.byID {
		if tr.VehicleID == vehicleID {
			out = append(out, tr)
		}
	}
	return out, nil
}

func (f *fakeTripRepo) ListByDateRange(_ context.Context, vehicleID string, from, to time.Time) ([]trip.Trip, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []trip.Trip
	for _, tr := range f.byID {
		if tr.VehicleID == vehicleID && inRange(tr.StartedAt, from, to) {
			out = append(out, tr)
		}
	}
	return out, nil
}

func (f *fakeTripRepo) GetByIDForUpdate(ctx context.Context, id string) (*trip.Trip, error) {
	return f.GetByID(ctx, id)
}

func (f *fakeTripRepo) Save(_ context.Context, tr *trip.Trip) error {
	if tr == nil {
		return fmt.Errorf("save trip: nil aggregate: %w", domain.ErrValidation)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byID[tr.ID] = *tr
	return nil
}

// --- user ---
type fakeUserRepo struct {
	mu   sync.Mutex
	byID map[string]user.User
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{byID: make(map[string]user.User)}
}

func (f *fakeUserRepo) GetByID(_ context.Context, id string) (*user.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.byID[id]
	if !ok {
		return nil, fmt.Errorf("user %s: %w", id, domain.ErrNotFound)
	}
	cp := u
	return &cp, nil
}

func (f *fakeUserRepo) GetByEmail(_ context.Context, email string) (*user.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, u := range f.byID {
		if u.Email == email {
			cp := u
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("user email %s: %w", email, domain.ErrNotFound)
}

func (f *fakeUserRepo) Save(_ context.Context, u *user.User) error {
	if u == nil {
		return fmt.Errorf("save user: nil aggregate: %w", domain.ErrValidation)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byID[u.ID] = *u
	return nil
}

func (f *fakeUserRepo) Delete(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.byID[id]; !ok {
		return fmt.Errorf("delete user %s: %w", id, domain.ErrNotFound)
	}
	delete(f.byID, id)
	return nil
}

// --- fsm history ---
type fakeFSMHistory struct {
	mu        sync.Mutex
	records   []repository.FSMTransitionRecord
	recordErr error
}

func (f *fakeFSMHistory) RecordTransition(_ context.Context, r repository.FSMTransitionRecord) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.recordErr != nil {
		return fmt.Errorf("record transition %s: %w", r.EntityID, f.recordErr)
	}
	f.records = append(f.records, r)
	return nil
}

func (f *fakeFSMHistory) GetHistory(_ context.Context, _ string, limit int) ([]repository.FSMTransitionRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := append([]repository.FSMTransitionRecord(nil), f.records...)
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeFSMHistory) GetByEntityID(_ context.Context, entityID string) ([]repository.FSMTransitionRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []repository.FSMTransitionRecord
	for _, r := range f.records {
		if r.EntityID == entityID {
			out = append(out, r)
		}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// 4. Behavioural round-trip tests documenting expected adapter semantics.
// ---------------------------------------------------------------------------

func TestVehicleRepositoryContract(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var repo repository.VehicleRepository = newFakeVehicleRepo()

	v := &vehicle.Vehicle{ID: "v1", UserID: "u1", VIN: "5YJ3E1EA7KF123456", DisplayName: "My Tesla"}

	t.Run("save then get", func(t *testing.T) {
		if err := repo.Save(ctx, v); err != nil {
			t.Fatalf("Save: %v", err)
		}
		got, err := repo.GetByID(ctx, "v1")
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		if got.VIN != v.VIN {
			t.Errorf("VIN: got %q, want %q", got.VIN, v.VIN)
		}
	})

	t.Run("get by id not found", func(t *testing.T) {
		_, err := repo.GetByID(ctx, "missing")
		if !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("got %v, want wrapped domain.ErrNotFound", err)
		}
	})

	t.Run("get by vin found and missing", func(t *testing.T) {
		got, err := repo.GetByVIN(ctx, "5YJ3E1EA7KF123456")
		if err != nil || got.ID != "v1" {
			t.Fatalf("GetByVIN found: got %+v err=%v", got, err)
		}
		if _, err := repo.GetByVIN(ctx, "nope"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("GetByVIN missing: got %v, want domain.ErrNotFound", err)
		}
	})

	t.Run("get by user id filters", func(t *testing.T) {
		_ = repo.Save(ctx, &vehicle.Vehicle{ID: "v2", UserID: "u2", VIN: "OTHER"})
		mine, err := repo.GetByUserID(ctx, "u1")
		if err != nil {
			t.Fatalf("GetByUserID: %v", err)
		}
		if len(mine) != 1 || mine[0].ID != "v1" {
			t.Errorf("GetByUserID(u1): got %+v, want single v1", mine)
		}
		none, _ := repo.GetByUserID(ctx, "ghost")
		if len(none) != 0 {
			t.Errorf("GetByUserID(ghost): got %d, want 0", len(none))
		}
	})

	t.Run("get by id for update mirrors get by id", func(t *testing.T) {
		got, err := repo.GetByIDForUpdate(ctx, "v1")
		if err != nil || got.ID != "v1" {
			t.Fatalf("GetByIDForUpdate: got %+v err=%v", got, err)
		}
	})

	t.Run("delete then missing", func(t *testing.T) {
		if err := repo.Delete(ctx, "v1"); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if _, err := repo.GetByID(ctx, "v1"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("after delete: got %v, want domain.ErrNotFound", err)
		}
		if err := repo.Delete(ctx, "v1"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("delete missing: got %v, want domain.ErrNotFound", err)
		}
	})

	t.Run("save nil is validation error", func(t *testing.T) {
		if err := repo.Save(ctx, nil); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("Save(nil): got %v, want domain.ErrValidation", err)
		}
	})

	t.Run("save error propagates wrapped", func(t *testing.T) {
		f := newFakeVehicleRepo()
		sentinel := errors.New("db down")
		f.saveErr = sentinel
		err := f.Save(ctx, &vehicle.Vehicle{ID: "x"})
		if !errors.Is(err, sentinel) {
			t.Errorf("Save error: got %v, want wrapped sentinel", err)
		}
	})
}

func TestChargingSessionRepositoryContract(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var repo repository.ChargingSessionRepository = newFakeChargingRepo()

	base := time.Date(2026, 7, 1, 8, 0, 0, 0, time.UTC)
	sessions := []charging.ChargingSession{
		{ID: "c1", VehicleID: "v1", StartedAt: base},
		{ID: "c2", VehicleID: "v1", StartedAt: base.Add(48 * time.Hour)},
		{ID: "c3", VehicleID: "v2", StartedAt: base},
	}
	for i := range sessions {
		if err := repo.Save(ctx, &sessions[i]); err != nil {
			t.Fatalf("Save %s: %v", sessions[i].ID, err)
		}
	}

	t.Run("get by id found and missing", func(t *testing.T) {
		got, err := repo.GetByID(ctx, "c1")
		if err != nil || got.VehicleID != "v1" {
			t.Fatalf("GetByID: got %+v err=%v", got, err)
		}
		if _, err := repo.GetByID(ctx, "nope"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("GetByID missing: got %v", err)
		}
	})

	t.Run("get by vehicle id filters", func(t *testing.T) {
		got, _ := repo.GetByVehicleID(ctx, "v1")
		if len(got) != 2 {
			t.Errorf("GetByVehicleID(v1): got %d, want 2", len(got))
		}
	})

	t.Run("get by id for update", func(t *testing.T) {
		got, err := repo.GetByIDForUpdate(ctx, "c2")
		if err != nil || got.ID != "c2" {
			t.Fatalf("GetByIDForUpdate: got %+v err=%v", got, err)
		}
	})

	dateRangeCases := []struct {
		name      string
		vehicleID string
		from, to  time.Time
		wantIDs   []string
	}{
		{"inclusive lower boundary", "v1", base, base.Add(time.Hour), []string{"c1"}},
		{"wide window", "v1", base.Add(-time.Hour), base.Add(72 * time.Hour), []string{"c1", "c2"}},
		{"empty window", "v1", base.Add(96 * time.Hour), base.Add(120 * time.Hour), nil},
		{"other vehicle", "v2", base.Add(-time.Hour), base.Add(time.Hour), []string{"c3"}},
	}
	for _, dc := range dateRangeCases {
		dc := dc
		t.Run("date range/"+dc.name, func(t *testing.T) {
			got, err := repo.ListByDateRange(ctx, dc.vehicleID, dc.from, dc.to)
			if err != nil {
				t.Fatalf("ListByDateRange: %v", err)
			}
			if !sameIDs(chargingIDs(got), dc.wantIDs) {
				t.Errorf("ids: got %v, want %v", chargingIDs(got), dc.wantIDs)
			}
		})
	}
}

func TestTripRepositoryContract(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var repo repository.TripRepository = newFakeTripRepo()

	base := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	trips := []trip.Trip{
		{ID: "t1", VehicleID: "v1", StartedAt: base, DistanceM: 1000},
		{ID: "t2", VehicleID: "v1", StartedAt: base.Add(24 * time.Hour)},
		{ID: "t3", VehicleID: "v9", StartedAt: base},
	}
	for i := range trips {
		if err := repo.Save(ctx, &trips[i]); err != nil {
			t.Fatalf("Save %s: %v", trips[i].ID, err)
		}
	}

	t.Run("get by id", func(t *testing.T) {
		got, err := repo.GetByID(ctx, "t1")
		if err != nil || got.DistanceM != 1000 {
			t.Fatalf("GetByID: got %+v err=%v", got, err)
		}
		if _, err := repo.GetByID(ctx, "x"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("missing: got %v", err)
		}
	})

	t.Run("get by vehicle id", func(t *testing.T) {
		got, _ := repo.GetByVehicleID(ctx, "v1")
		if len(got) != 2 {
			t.Errorf("got %d, want 2", len(got))
		}
	})

	t.Run("get by id for update", func(t *testing.T) {
		if _, err := repo.GetByIDForUpdate(ctx, "t2"); err != nil {
			t.Errorf("GetByIDForUpdate: %v", err)
		}
	})

	t.Run("date range upper boundary inclusive", func(t *testing.T) {
		got, err := repo.ListByDateRange(ctx, "v1", base.Add(24*time.Hour), base.Add(24*time.Hour))
		if err != nil {
			t.Fatalf("ListByDateRange: %v", err)
		}
		if !sameIDs(tripIDs(got), []string{"t2"}) {
			t.Errorf("got %v, want [t2]", tripIDs(got))
		}
	})
}

func TestExportJobRepositoryContract(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var repo repository.ExportJobRepository = newFakeExportRepo()

	if err := repo.Save(ctx, &export.ExportJob{ID: "e1", UserID: "u1", Format: "csv"}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	_ = repo.Save(ctx, &export.ExportJob{ID: "e2", UserID: "u2"})

	t.Run("get by id found and missing", func(t *testing.T) {
		got, err := repo.GetByID(ctx, "e1")
		if err != nil || got.Format != "csv" {
			t.Fatalf("GetByID: got %+v err=%v", got, err)
		}
		if _, err := repo.GetByID(ctx, "zzz"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("missing: got %v", err)
		}
	})

	t.Run("get by user id filters", func(t *testing.T) {
		got, _ := repo.GetByUserID(ctx, "u1")
		if len(got) != 1 || got[0].ID != "e1" {
			t.Errorf("GetByUserID(u1): got %+v", got)
		}
	})

	t.Run("get by id for update", func(t *testing.T) {
		if _, err := repo.GetByIDForUpdate(ctx, "e2"); err != nil {
			t.Errorf("GetByIDForUpdate: %v", err)
		}
	})
}

func TestNotificationRepositoryContract(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var repo repository.NotificationRepository = newFakeNotificationRepo()

	sent := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	items := []notification.Notification{
		{ID: "n1", UserID: "u1", Title: "pending-a"},
		{ID: "n2", UserID: "u1", Title: "pending-b"},
		{ID: "n3", UserID: "u2", Title: "sent", SentAt: sent},
	}
	for i := range items {
		if err := repo.Save(ctx, &items[i]); err != nil {
			t.Fatalf("Save %s: %v", items[i].ID, err)
		}
	}

	t.Run("get by id", func(t *testing.T) {
		got, err := repo.GetByID(ctx, "n1")
		if err != nil || got.Title != "pending-a" {
			t.Fatalf("GetByID: got %+v err=%v", got, err)
		}
		if _, err := repo.GetByID(ctx, "x"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("missing: got %v", err)
		}
	})

	t.Run("get by user id", func(t *testing.T) {
		got, _ := repo.GetByUserID(ctx, "u1")
		if len(got) != 2 {
			t.Errorf("got %d, want 2", len(got))
		}
	})

	t.Run("get by id for update", func(t *testing.T) {
		if _, err := repo.GetByIDForUpdate(ctx, "n3"); err != nil {
			t.Errorf("GetByIDForUpdate: %v", err)
		}
	})

	pendingCases := []struct {
		name  string
		limit int
		want  int
	}{
		{"no cap", 0, 2},
		{"negative treated as no cap", -5, 2},
		{"limit below count", 1, 1},
		{"limit above count", 10, 2},
	}
	for _, pc := range pendingCases {
		pc := pc
		t.Run("get pending/"+pc.name, func(t *testing.T) {
			got, err := repo.GetPending(ctx, pc.limit)
			if err != nil {
				t.Fatalf("GetPending: %v", err)
			}
			if len(got) != pc.want {
				t.Errorf("limit=%d: got %d, want %d", pc.limit, len(got), pc.want)
			}
			for _, n := range got {
				if !n.SentAt.IsZero() {
					t.Errorf("GetPending returned already-sent notification %s", n.ID)
				}
			}
		})
	}
}

func TestUserRepositoryContract(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var repo repository.UserRepository = newFakeUserRepo()

	u := &user.User{ID: "u1", Email: "a@example.com", DisplayName: "Ann"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}

	t.Run("get by id", func(t *testing.T) {
		got, err := repo.GetByID(ctx, "u1")
		if err != nil || got.Email != "a@example.com" {
			t.Fatalf("GetByID: got %+v err=%v", got, err)
		}
		if _, err := repo.GetByID(ctx, "u9"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("missing: got %v", err)
		}
	})

	t.Run("get by email found and missing", func(t *testing.T) {
		got, err := repo.GetByEmail(ctx, "a@example.com")
		if err != nil || got.ID != "u1" {
			t.Fatalf("GetByEmail: got %+v err=%v", got, err)
		}
		if _, err := repo.GetByEmail(ctx, "none@example.com"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("missing email: got %v", err)
		}
	})

	t.Run("delete then missing", func(t *testing.T) {
		if err := repo.Delete(ctx, "u1"); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if _, err := repo.GetByID(ctx, "u1"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("after delete: got %v", err)
		}
		if err := repo.Delete(ctx, "u1"); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("delete missing: got %v", err)
		}
	})

	t.Run("save nil is validation error", func(t *testing.T) {
		if err := repo.Save(ctx, nil); !errors.Is(err, domain.ErrValidation) {
			t.Errorf("Save(nil): got %v, want domain.ErrValidation", err)
		}
	})
}

func TestFSMHistoryRepositoryContract(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var repo repository.FSMHistoryRepository = &fakeFSMHistory{}

	recs := []repository.FSMTransitionRecord{
		{ID: "r1", EntityID: "v1", FSMName: "vehicle", FromState: "offline", Event: "come_online", ToState: "online"},
		{ID: "r2", EntityID: "v1", FSMName: "vehicle", FromState: "online", Event: "go_offline", ToState: "offline"},
		{ID: "r3", EntityID: "v2", FSMName: "vehicle", FromState: "offline", Event: "come_online", ToState: "online"},
	}
	for _, r := range recs {
		if err := repo.RecordTransition(ctx, r); err != nil {
			t.Fatalf("RecordTransition %s: %v", r.ID, err)
		}
	}

	t.Run("get by entity id filters", func(t *testing.T) {
		got, err := repo.GetByEntityID(ctx, "v1")
		if err != nil {
			t.Fatalf("GetByEntityID: %v", err)
		}
		if len(got) != 2 {
			t.Errorf("got %d, want 2", len(got))
		}
		none, _ := repo.GetByEntityID(ctx, "ghost")
		if len(none) != 0 {
			t.Errorf("unknown entity: got %d, want 0", len(none))
		}
	})

	historyCases := []struct {
		name  string
		limit int
		want  int
	}{
		{"no cap", 0, 3},
		{"limit below count", 2, 2},
		{"limit above count", 100, 3},
	}
	for _, hc := range historyCases {
		hc := hc
		t.Run("get history/"+hc.name, func(t *testing.T) {
			got, err := repo.GetHistory(ctx, "v1", hc.limit)
			if err != nil {
				t.Fatalf("GetHistory: %v", err)
			}
			if len(got) != hc.want {
				t.Errorf("limit=%d: got %d, want %d", hc.limit, len(got), hc.want)
			}
		})
	}

	t.Run("record error propagates wrapped", func(t *testing.T) {
		sentinel := errors.New("insert failed")
		f := &fakeFSMHistory{recordErr: sentinel}
		err := f.RecordTransition(ctx, repository.FSMTransitionRecord{EntityID: "v1"})
		if !errors.Is(err, sentinel) {
			t.Errorf("got %v, want wrapped sentinel", err)
		}
	})
}

// ---------------------------------------------------------------------------
// 5. FSMTransitionRecord wire (json) + persistence (db) contract.
// ---------------------------------------------------------------------------

func TestFSMTransitionRecordJSONContract(t *testing.T) {
	t.Parallel()

	rec := repository.FSMTransitionRecord{
		ID:        "rec-1",
		EntityID:  "veh-1",
		FSMName:   "vehicle",
		FromState: fsm.State("offline"),
		Event:     fsm.Event("come_online"),
		ToState:   fsm.State("online"),
		CreatedAt: time.Date(2026, 7, 5, 12, 30, 0, 0, time.UTC),
	}

	b, err := json.Marshal(rec)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var keys map[string]json.RawMessage
	if err := json.Unmarshal(b, &keys); err != nil {
		t.Fatalf("Unmarshal to map: %v", err)
	}
	wantKeys := []string{"id", "entityId", "fsmName", "fromState", "event", "toState", "createdAt"}
	for _, k := range wantKeys {
		if _, ok := keys[k]; !ok {
			t.Errorf("json missing camelCase key %q; got %v", k, sortedKeys(keys))
		}
	}
	// Guard against a silent snake_case regression on the wire.
	for _, bad := range []string{"entity_id", "fsm_name", "from_state", "to_state", "created_at"} {
		if _, ok := keys[bad]; ok {
			t.Errorf("json unexpectedly contains snake_case key %q", bad)
		}
	}
	if len(keys) != len(wantKeys) {
		t.Errorf("json key count: got %d %v, want %d", len(keys), sortedKeys(keys), len(wantKeys))
	}

	var got repository.FSMTransitionRecord
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("round-trip Unmarshal: %v", err)
	}
	if got.ID != rec.ID || got.EntityID != rec.EntityID || got.FSMName != rec.FSMName ||
		got.FromState != rec.FromState || got.Event != rec.Event || got.ToState != rec.ToState {
		t.Errorf("round-trip mismatch:\n got %+v\nwant %+v", got, rec)
	}
	if !got.CreatedAt.Equal(rec.CreatedAt) {
		t.Errorf("CreatedAt: got %v, want %v", got.CreatedAt, rec.CreatedAt)
	}
}

func TestFSMTransitionRecordDBTags(t *testing.T) {
	t.Parallel()

	want := map[string]string{
		"ID":        "id",
		"EntityID":  "entity_id",
		"FSMName":   "fsm_name",
		"FromState": "from_state",
		"Event":     "event",
		"ToState":   "to_state",
		"CreatedAt": "created_at",
	}
	typ := reflect.TypeOf(repository.FSMTransitionRecord{})
	if typ.NumField() != len(want) {
		t.Fatalf("field count: got %d, want %d", typ.NumField(), len(want))
	}
	for field, wantTag := range want {
		f, ok := typ.FieldByName(field)
		if !ok {
			t.Errorf("missing field %s", field)
			continue
		}
		if got := f.Tag.Get("db"); got != wantTag {
			t.Errorf("field %s db tag: got %q, want %q", field, got, wantTag)
		}
	}
}

// ---------------------------------------------------------------------------
// 6. Concurrency: mutex-guarded fakes stay race-clean under -race.
// ---------------------------------------------------------------------------

func TestFakeVehicleRepoConcurrentSave(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeVehicleRepo()

	const n = 50
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("v%d", i)
			_ = repo.Save(ctx, &vehicle.Vehicle{ID: id, UserID: "u1"})
			_, _ = repo.GetByID(ctx, id)
		}(i)
	}
	wg.Wait()

	got, err := repo.GetByUserID(ctx, "u1")
	if err != nil {
		t.Fatalf("GetByUserID: %v", err)
	}
	if len(got) != n {
		t.Errorf("after %d concurrent saves: got %d, want %d", n, len(got), n)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func chargingIDs(ss []charging.ChargingSession) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = s.ID
	}
	return out
}

func tripIDs(ts []trip.Trip) []string {
	out := make([]string, len(ts))
	for i, tr := range ts {
		out[i] = tr.ID
	}
	return out
}

// sameIDs compares two id sets irrespective of order (map iteration in the
// fakes is non-deterministic).
func sameIDs(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	seen := make(map[string]int, len(got))
	for _, g := range got {
		seen[g]++
	}
	for _, w := range want {
		if seen[w] == 0 {
			return false
		}
		seen[w]--
	}
	return true
}

func sortedKeys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
