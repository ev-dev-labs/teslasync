package vehiclefsm

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/fsm"
	"github.com/ev-dev-labs/teslasync/internal/fsm/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"

	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
)

// loggedTransition captures the arguments of one transitionLogger.Insert call
// so tests can assert what fsmAction durably records.
type loggedTransition struct {
	vehicleID int64
	ts        time.Time
	fsmName   string
	from      string
	to        string
	trigger   string
	details   map[string]interface{}
}

// fakeTransitionLogger is an in-memory transitionLogger. It is the package's
// established test-double style (narrow interface + fake) applied to the
// fsm_transitions persistence port so the durable-logging path is exercisable
// without a database. Thread-safe because reconciliation can drive Insert from
// a goroutine under -race.
type fakeTransitionLogger struct {
	mu    sync.Mutex
	calls []loggedTransition
	err   error // returned by Insert when non-nil
}

func (f *fakeTransitionLogger) Insert(_ context.Context, vehicleID int64, ts time.Time,
	fsmName, from, to, trigger string, details map[string]interface{}) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, loggedTransition{vehicleID, ts, fsmName, from, to, trigger, details})
	return f.err
}

func (f *fakeTransitionLogger) snapshot() []loggedTransition {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]loggedTransition, len(f.calls))
	copy(out, f.calls)
	return out
}

func gearBatch(g string) map[string]interface{} {
	return map[string]interface{}{"Gear": g}
}

func chargeBatch(state string) map[string]interface{} {
	return map[string]interface{}{"DetailedChargeState": state}
}

func TestNewHandler(t *testing.T) {
	h := NewHandler(nil, nil)
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.machines == nil || h.drives == nil || h.charges == nil {
		t.Fatal("state maps not initialized")
	}
	if h.lastProcessed == nil {
		t.Fatal("lastProcessed not initialized")
	}
	if h.reconcileStop == nil {
		t.Fatal("reconcileStop not initialized")
	}
	if cap(h.reconcileStop) != 1 {
		t.Errorf("reconcileStop cap = %d, want 1 (buffered so stop can't be dropped)", cap(h.reconcileStop))
	}
	// A nil concrete repo must leave the interface field nil so fsmAction's
	// `!= nil` skip works and never dereferences a nil repo.
	if h.transRepo != nil {
		t.Error("transRepo interface should be nil when constructed from a nil repo")
	}
	st := h.Stats()
	for _, k := range []string{"vehicles", "drives", "charges"} {
		if st[k] != 0 {
			t.Errorf("Stats[%q] = %d, want 0 on a fresh handler", k, st[k])
		}
	}
	if got := h.CurrentState(1); got != "" {
		t.Errorf("CurrentState(unknown) = %q, want empty", got)
	}
	if snaps := h.VehicleSnapshots(); len(snaps) != 0 {
		t.Errorf("VehicleSnapshots = %d entries, want 0", len(snaps))
	}
}

// TestNewHandler_StoresTransitionRepoPort verifies a genuinely non-nil repo is
// retained behind the transitionLogger port (the else side of the nil-guard).
// The repo's db is nil, but no transition is driven through it so Insert is
// never called.
func TestNewHandler_StoresTransitionRepoPort(t *testing.T) {
	repo := dbobs.NewFSMTransitionRepo(nil)
	h := NewHandler(nil, repo)
	if h.transRepo == nil {
		t.Fatal("a non-nil repo must be stored behind the transitionLogger port")
	}
}

func TestHandler_getOrCreate(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()

	m1 := h.getOrCreate(ctx, 7)
	if m1 == nil {
		t.Fatal("getOrCreate returned nil FSM")
	}
	if got := m1.Current(); got != fsm.Online {
		t.Errorf("cold-start state = %q, want %q", got, fsm.Online)
	}

	if m2 := h.getOrCreate(ctx, 7); m1 != m2 {
		t.Error("getOrCreate must return the same FSM instance for the same vehicle")
	}
	if m3 := h.getOrCreate(ctx, 8); m3 == m1 {
		t.Error("distinct vehicles must get distinct FSM instances")
	}
	if st := h.Stats(); st["vehicles"] != 2 {
		t.Errorf("vehicles = %d, want 2", st["vehicles"])
	}
}

// TestHandler_ProcessSignals_StateMachine drives the top-level vehicle FSM
// through the immediate transitions and asserts both the committed state and
// the sub-FSM bookkeeping (drives/charges lifecycle).
func TestHandler_ProcessSignals_StateMachine(t *testing.T) {
	tests := []struct {
		name        string
		batches     []map[string]interface{}
		wantState   string
		wantDrives  int
		wantCharges int
	}{
		{
			name:       "online to driving via Gear=D",
			batches:    []map[string]interface{}{gearBatch(enums.GearDrive)},
			wantState:  string(fsm.Driving),
			wantDrives: 1,
		},
		{
			name:       "reverse gear also starts a drive",
			batches:    []map[string]interface{}{gearBatch(enums.GearReverse)},
			wantState:  string(fsm.Driving),
			wantDrives: 1,
		},
		{
			name:        "online to charging via DetailedChargeState",
			batches:     []map[string]interface{}{chargeBatch(enums.ChargeStateCharging)},
			wantState:   string(fsm.Charging),
			wantCharges: 1,
		},
		{
			name:        "online to charging via ChargeState fallback",
			batches:     []map[string]interface{}{{"ChargeState": enums.ChargeStateCharging}},
			wantState:   string(fsm.Charging),
			wantCharges: 1,
		},
		{
			name: "driving to charging force-completes the drive",
			batches: []map[string]interface{}{
				gearBatch(enums.GearDrive),
				chargeBatch(enums.ChargeStateCharging),
			},
			wantState:   string(fsm.Charging),
			wantDrives:  0,
			wantCharges: 1,
		},
		{
			name: "charging to driving is unplug-and-go",
			batches: []map[string]interface{}{
				chargeBatch(enums.ChargeStateCharging),
				gearBatch(enums.GearDrive),
			},
			wantState:   string(fsm.Driving),
			wantDrives:  1,
			wantCharges: 0,
		},
		{
			name: "charging to parked when charge ends",
			batches: []map[string]interface{}{
				chargeBatch(enums.ChargeStateCharging),
				chargeBatch(enums.ChargeStateDisconnected),
			},
			wantState:   string(fsm.Parked),
			wantDrives:  0,
			wantCharges: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(nil, nil)
			ctx := context.Background()
			const vid = int64(1)
			for _, b := range tt.batches {
				h.ProcessSignals(ctx, vid, b)
			}
			if got := h.CurrentState(vid); got != tt.wantState {
				t.Errorf("CurrentState = %q, want %q", got, tt.wantState)
			}
			st := h.Stats()
			if st["drives"] != tt.wantDrives {
				t.Errorf("drives = %d, want %d", st["drives"], tt.wantDrives)
			}
			if st["charges"] != tt.wantCharges {
				t.Errorf("charges = %d, want %d", st["charges"], tt.wantCharges)
			}
			if st["vehicles"] != 1 {
				t.Errorf("vehicles = %d, want 1", st["vehicles"])
			}
		})
	}
}

// TestHandler_ProcessSignalsAt_DebouncedPark exercises the event-time path: a
// Gear=P during a drive arms a debounce that only commits Parked once a later
// batch confirms it past StateConfirmDuration via CheckPending.
func TestHandler_ProcessSignalsAt_DebouncedPark(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()
	const vid = int64(9)
	t0 := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

	h.ProcessSignalsAt(ctx, vid, gearBatch(enums.GearDrive), t0, nil)
	if got := h.CurrentState(vid); got != string(fsm.Driving) {
		t.Fatalf("after Gear=D: state = %q, want driving", got)
	}

	// Gear=P arms the debounce but must NOT immediately park the vehicle.
	h.ProcessSignalsAt(ctx, vid, gearBatch(enums.GearPark), t0.Add(time.Second), nil)
	if got := h.CurrentState(vid); got != string(fsm.Driving) {
		t.Fatalf("debounced Park should keep the vehicle driving, got %q", got)
	}
	if st := h.Stats(); st["drives"] != 1 {
		t.Fatalf("drive should still be active while debounce pending, drives = %d", st["drives"])
	}

	// A later batch past StateConfirmDuration confirms the debounced Park.
	h.ProcessSignalsAt(ctx, vid, map[string]interface{}{}, t0.Add(40*time.Second), nil)
	if got := h.CurrentState(vid); got != string(fsm.Parked) {
		t.Fatalf("confirmed debounce should commit Parked, got %q", got)
	}
	if st := h.Stats(); st["drives"] != 0 {
		t.Errorf("drive should be completed on Park, drives = %d", st["drives"])
	}
}

func TestHandler_HandleTimeout(t *testing.T) {
	tests := []struct {
		name  string
		setup func(h *Handler, ctx context.Context, vid int64)
		want  string
	}{
		{
			name:  "online times out to asleep",
			setup: func(h *Handler, ctx context.Context, vid int64) { h.getOrCreate(ctx, vid) },
			want:  string(fsm.Asleep),
		},
		{
			name: "driving times out to offline",
			setup: func(h *Handler, ctx context.Context, vid int64) {
				h.ProcessSignals(ctx, vid, gearBatch(enums.GearDrive))
			},
			want: string(fsm.Offline),
		},
		{
			name:  "timeout on unknown vehicle creates then sleeps it",
			setup: func(h *Handler, ctx context.Context, vid int64) {},
			want:  string(fsm.Asleep),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(nil, nil)
			ctx := context.Background()
			const vid = int64(2)
			tt.setup(h, ctx, vid)
			h.HandleTimeout(ctx, vid)
			if got := h.CurrentState(vid); got != tt.want {
				t.Errorf("CurrentState after timeout = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestHandler_HandleSignalReceived(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()
	const vid = int64(3)

	h.getOrCreate(ctx, vid)
	h.HandleTimeout(ctx, vid)
	if got := h.CurrentState(vid); got != string(fsm.Asleep) {
		t.Fatalf("setup: state = %q, want asleep", got)
	}

	h.HandleSignalReceived(ctx, vid)
	if got := h.CurrentState(vid); got != string(fsm.Online) {
		t.Errorf("signal received should wake asleep->online, got %q", got)
	}

	// A second call on an already-online vehicle is a no-op (stays online).
	h.HandleSignalReceived(ctx, vid)
	if got := h.CurrentState(vid); got != string(fsm.Online) {
		t.Errorf("HandleSignalReceived on online should be a no-op, got %q", got)
	}
}

// TestHandler_ProcessSignals_WakesFromSleep verifies the ingest hot path wakes a
// sleeping FSM before applying the batch's own triggers.
func TestHandler_ProcessSignals_WakesFromSleep(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()
	const vid = int64(11)

	h.getOrCreate(ctx, vid)
	h.HandleTimeout(ctx, vid)
	if got := h.CurrentState(vid); got != string(fsm.Asleep) {
		t.Fatalf("setup: state = %q, want asleep", got)
	}

	h.ProcessSignals(ctx, vid, gearBatch(enums.GearDrive))
	if got := h.CurrentState(vid); got != string(fsm.Driving) {
		t.Errorf("asleep vehicle should wake and then drive, got %q", got)
	}
}

// TestFSMAction_Execute asserts the durable transition-log contract and the
// sub-FSM side effects, injecting a fake logger through the transitionLogger
// port.
func TestFSMAction_Execute(t *testing.T) {
	fixedTs := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)

	tests := []struct {
		name        string
		from, to    fsm.State
		seedDrive   bool
		sctx        *fsm.SignalContext
		wantTrigger string
		wantDetails map[string]interface{}
		wantDrives  int
		wantCharges int
	}{
		{
			name: "drive start logs full details and creates a drive",
			from: fsm.Online, to: fsm.Driving,
			sctx: &fsm.SignalContext{
				Now: fixedTs, IsGearCapable: true, IsCharging: false, Gear: "D",
				Speed: 12.5, MatchedTrigger: "TriggerGearDriving", TransitionMode: "immediate",
				Signals: gearBatch("D"),
			},
			wantTrigger: "TriggerGearDriving",
			wantDetails: map[string]interface{}{
				"is_gear_capable": true, "is_charging": false,
				"gear": "D", "speed": 12.5, "mode": "immediate",
			},
			wantDrives: 1,
		},
		{
			name: "charge start creates a charge with minimal details",
			from: fsm.Online, to: fsm.Charging,
			sctx: &fsm.SignalContext{
				Now: fixedTs, IsGearCapable: false, IsCharging: true,
				MatchedTrigger: "TriggerChargeStarted", Signals: map[string]interface{}{},
			},
			wantTrigger: "TriggerChargeStarted",
			wantDetails: map[string]interface{}{"is_gear_capable": false, "is_charging": true},
			wantCharges: 1,
		},
		{
			name: "parking records the matched guard and completes the drive",
			from: fsm.Driving, to: fsm.Parked, seedDrive: true,
			sctx: &fsm.SignalContext{
				Now: fixedTs, IsGearCapable: true, IsCharging: false, Gear: "P",
				MatchedTrigger: "TriggerGearParked", MatchedGuard: "GuardNoCharge",
				TransitionMode: "debounced", Signals: map[string]interface{}{},
			},
			wantTrigger: "TriggerGearParked",
			wantDetails: map[string]interface{}{
				"is_gear_capable": true, "is_charging": false,
				"gear": "P", "guard": "GuardNoCharge", "mode": "debounced",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(nil, nil)
			fake := &fakeTransitionLogger{}
			a := &fsmAction{handler: h, transRepo: fake}
			const vid = int64(1)
			if tt.seedDrive {
				h.mu.Lock()
				h.drives[vid] = drive.NewSessionFSM(vid, "", 0)
				h.mu.Unlock()
			}

			if err := a.Execute(context.Background(), vid, tt.from, tt.to, tt.sctx); err != nil {
				t.Fatalf("Execute error = %v", err)
			}

			calls := fake.snapshot()
			if len(calls) != 1 {
				t.Fatalf("logged %d transitions, want exactly 1", len(calls))
			}
			c := calls[0]
			if c.vehicleID != vid {
				t.Errorf("logged vehicleID = %d, want %d", c.vehicleID, vid)
			}
			if c.fsmName != "vehicle" {
				t.Errorf("logged fsmName = %q, want vehicle", c.fsmName)
			}
			if c.from != string(tt.from) || c.to != string(tt.to) {
				t.Errorf("logged from/to = %q/%q, want %q/%q", c.from, c.to, tt.from, tt.to)
			}
			if c.trigger != tt.wantTrigger {
				t.Errorf("logged trigger = %q, want %q", c.trigger, tt.wantTrigger)
			}
			if !c.ts.Equal(fixedTs) {
				t.Errorf("logged ts = %v, want %v (event-time must be preserved)", c.ts, fixedTs)
			}
			if !reflect.DeepEqual(c.details, tt.wantDetails) {
				t.Errorf("logged details = %#v, want %#v", c.details, tt.wantDetails)
			}
			if st := h.Stats(); st["drives"] != tt.wantDrives || st["charges"] != tt.wantCharges {
				t.Errorf("drives/charges = %d/%d, want %d/%d",
					st["drives"], st["charges"], tt.wantDrives, tt.wantCharges)
			}
		})
	}
}

// TestFSMAction_Execute_NilRepoSkipsLogging covers the nil-repo skip branch:
// side effects still run, no logging is attempted, no panic.
func TestFSMAction_Execute_NilRepoSkipsLogging(t *testing.T) {
	h := NewHandler(nil, nil)
	a := &fsmAction{handler: h, transRepo: nil}
	err := a.Execute(context.Background(), 5, fsm.Online, fsm.Charging,
		&fsm.SignalContext{Now: time.Now(), IsCharging: true, Signals: map[string]interface{}{}})
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if st := h.Stats(); st["charges"] != 1 {
		t.Errorf("charge sub-FSM should be created even without a repo, charges = %d", st["charges"])
	}
}

// TestFSMAction_Execute_LoggerErrorIsBestEffort locks in the documented
// best-effort logging contract: an Insert failure is swallowed (not returned)
// and never blocks the transition's side effects.
func TestFSMAction_Execute_LoggerErrorIsBestEffort(t *testing.T) {
	h := NewHandler(nil, nil)
	fake := &fakeTransitionLogger{err: errors.New("db down")}
	a := &fsmAction{handler: h, transRepo: fake}
	err := a.Execute(context.Background(), 6, fsm.Online, fsm.Driving,
		&fsm.SignalContext{Now: time.Now(), Gear: "D", IsGearCapable: true, Signals: gearBatch("D")})
	if err != nil {
		t.Fatalf("Execute must swallow logger errors (best-effort), got %v", err)
	}
	if st := h.Stats(); st["drives"] != 1 {
		t.Errorf("drive should still be created despite a logger error, drives = %d", st["drives"])
	}
	if n := len(fake.snapshot()); n != 1 {
		t.Errorf("Insert should have been attempted once, got %d", n)
	}
}

// TestFSMAction_Execute_ZeroTimestampFallsBackToWallClock covers the ts.IsZero()
// fallback: callers with no event-time get a wall-clock stamp on the logged row.
func TestFSMAction_Execute_ZeroTimestampFallsBackToWallClock(t *testing.T) {
	h := NewHandler(nil, nil)
	fake := &fakeTransitionLogger{}
	a := &fsmAction{handler: h, transRepo: fake}

	before := time.Now()
	err := a.Execute(context.Background(), 12, fsm.Online, fsm.Driving,
		&fsm.SignalContext{Now: time.Time{}, Gear: "D", IsGearCapable: true, Signals: gearBatch("D")})
	after := time.Now()
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}

	calls := fake.snapshot()
	if len(calls) != 1 {
		t.Fatalf("logged %d transitions, want 1", len(calls))
	}
	ts := calls[0].ts
	if ts.Before(before) || ts.After(after) {
		t.Errorf("zero event-time should fall back to wall-clock in [%v, %v], got %v", before, after, ts)
	}
}

// TestHandler_ProcessSignals_LogsTransitions checks the end-to-end wiring from
// ProcessSignals through the FSM to the injected transition logger.
func TestHandler_ProcessSignals_LogsTransitions(t *testing.T) {
	h := NewHandler(nil, nil)
	fake := &fakeTransitionLogger{}
	h.transRepo = fake // inject before the FSM (and its fsmAction) is created
	ctx := context.Background()
	const vid = int64(21)
	t0 := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	h.ProcessSignalsAt(ctx, vid, gearBatch(enums.GearDrive), t0, nil)

	calls := fake.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected 1 logged transition, got %d", len(calls))
	}
	c := calls[0]
	if c.from != string(fsm.Online) || c.to != string(fsm.Driving) {
		t.Errorf("logged %q->%q, want online->driving", c.from, c.to)
	}
	if c.trigger != "TriggerGearDriving" {
		t.Errorf("logged trigger = %q, want TriggerGearDriving", c.trigger)
	}
	if !c.ts.Equal(t0) {
		t.Errorf("logged ts = %v, want event-time %v", c.ts, t0)
	}
}

func TestHandler_ProcessSignalsAt_WakeTransitionUsesEventTime(t *testing.T) {
	h := NewHandler(nil, nil)
	fake := &fakeTransitionLogger{}
	h.transRepo = fake
	ctx := context.Background()
	const vehicleID = int64(22)

	h.getOrCreate(ctx, vehicleID)
	h.HandleTimeout(ctx, vehicleID)
	fake.mu.Lock()
	fake.calls = nil
	fake.mu.Unlock()

	eventTime := time.Date(2026, 8, 22, 10, 30, 0, 0, time.UTC)
	h.ProcessSignalsAt(ctx, vehicleID, map[string]interface{}{"BatteryLevel": float32(80)}, eventTime, nil)

	calls := fake.snapshot()
	if len(calls) != 1 {
		t.Fatalf("logged %d wake transitions, want 1", len(calls))
	}
	if calls[0].from != string(fsm.Asleep) || calls[0].to != string(fsm.Online) {
		t.Fatalf("wake transition = %s -> %s, want asleep -> online", calls[0].from, calls[0].to)
	}
	if !calls[0].ts.Equal(eventTime) {
		t.Fatalf("wake timestamp = %v, want source event time %v", calls[0].ts, eventTime)
	}
}

func TestHandler_reconcileVehicle(t *testing.T) {
	ctx := context.Background()

	t.Run("corrects a mismatched FSM by replaying signals", func(t *testing.T) {
		now := time.Now()
		s := signal.New()
		s.Set(1, "Gear", "D", now)
		h := NewHandler(nil, nil)
		h.SetSignalStore(s)
		h.getOrCreate(ctx, 1) // Online

		h.reconcileVehicle(1, now.Add(time.Second))

		if got := h.CurrentState(1); got != string(fsm.Driving) {
			t.Fatalf("reconcile should correct online->driving, got %q", got)
		}
	})

	t.Run("leaves an already-correct FSM untouched", func(t *testing.T) {
		s := signal.New()
		h := NewHandler(nil, nil)
		h.SetSignalStore(s)
		h.ProcessSignals(ctx, 2, gearBatch(enums.GearDrive)) // -> driving
		h.mu.Lock()
		tProc := h.lastProcessed[2]
		h.mu.Unlock()
		// Freshest signal AFTER lastProcessed so the fresh-skip does not fire and
		// we reach the already-correct branch instead.
		s.Set(2, "Gear", "D", tProc.Add(time.Second))

		h.reconcileVehicle(2, tProc.Add(2*time.Second))

		if got := h.CurrentState(2); got != string(fsm.Driving) {
			t.Fatalf("already-correct FSM should stay driving, got %q", got)
		}
	})

	t.Run("skips when confidence is insufficient", func(t *testing.T) {
		h := NewHandler(nil, nil)
		h.SetSignalStore(signal.New()) // empty store -> ConfidenceNone
		h.getOrCreate(ctx, 3)

		h.reconcileVehicle(3, time.Now())

		if got := h.CurrentState(3); got != string(fsm.Online) {
			t.Fatalf("no signals should mean no correction, want online got %q", got)
		}
	})

	t.Run("skips when no FSM exists yet", func(t *testing.T) {
		now := time.Now()
		s := signal.New()
		s.Set(4, "Gear", "D", now)
		h := NewHandler(nil, nil)
		h.SetSignalStore(s)

		h.reconcileVehicle(4, now.Add(time.Second))

		if got := h.CurrentState(4); got != "" {
			t.Fatalf("reconcile must not create an FSM, CurrentState = %q", got)
		}
	})

	t.Run("skips when the FSM is fresher than the signal", func(t *testing.T) {
		t0 := time.Now()
		s := signal.New()
		s.Set(5, "Gear", "D", t0)
		h := NewHandler(nil, nil)
		h.SetSignalStore(s)
		h.getOrCreate(ctx, 5) // Online
		h.mu.Lock()
		h.lastProcessed[5] = t0.Add(time.Minute) // processed after the freshest signal
		h.mu.Unlock()

		h.reconcileVehicle(5, t0.Add(30*time.Second)) // still inside the freshness window

		if got := h.CurrentState(5); got != string(fsm.Online) {
			t.Fatalf("fresh-skip should leave the FSM online, got %q", got)
		}
	})
}

func TestHandler_reconcileAll(t *testing.T) {
	t.Run("no-op when the signal store is not set", func(t *testing.T) {
		h := NewHandler(nil, nil)
		h.reconcileAll() // must not panic
	})

	t.Run("reconciles every vehicle in the store", func(t *testing.T) {
		now := time.Now()
		s := signal.New()
		s.Set(1, "Gear", "D", now)
		s.Set(2, "Gear", "D", now)
		h := NewHandler(nil, nil)
		h.SetSignalStore(s)
		h.getOrCreate(context.Background(), 1)
		h.getOrCreate(context.Background(), 2)

		h.reconcileAll()

		if s1, s2 := h.CurrentState(1), h.CurrentState(2); s1 != string(fsm.Driving) || s2 != string(fsm.Driving) {
			t.Fatalf("reconcileAll should correct both vehicles: v1=%q v2=%q", s1, s2)
		}
	})
}

func TestHandler_StartStopReconcileLoop(t *testing.T) {
	h := NewHandler(nil, nil)
	h.StartReconcileLoop()
	h.StopReconcileLoop() // delivers stop to the waiting goroutine
	// Idempotent: a second stop must not block or panic even if the buffered
	// slot is already occupied.
	h.StopReconcileLoop()
}

func TestHandler_StopReconcileLoop_SafeWithoutStart(t *testing.T) {
	h := NewHandler(nil, nil)
	// No goroutine is running; the buffered send fills the slot, the second
	// falls through the default branch — neither blocks.
	h.StopReconcileLoop()
	h.StopReconcileLoop()
}
