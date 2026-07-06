package vehiclefsm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/fsm"
	"github.com/ev-dev-labs/teslasync/internal/fsm/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
)

// debugRequest builds a GET with chi route context wired so
// chi.URLParam(r, "vehicleID") resolves inside HandleDebug.
func debugRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/fsm/debug", nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("vehicleID", vehicleID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
}

func TestHandler_Accessors_UnknownVehicle(t *testing.T) {
	h := NewHandler(nil, nil)
	const vid = int64(99)

	if got := h.CurrentState(vid); got != "" {
		t.Errorf("CurrentState = %q, want empty", got)
	}
	if d := h.ActiveDrive(vid); d != nil {
		t.Errorf("ActiveDrive = %v, want nil", d)
	}
	if s, d := h.ActiveDriveState(vid); s != "" || d != nil {
		t.Errorf("ActiveDriveState = (%q, %v), want (\"\", nil)", s, d)
	}
	if c := h.ActiveCharge(vid); c != nil {
		t.Errorf("ActiveCharge = %v, want nil", c)
	}
	if s, c := h.ActiveChargeState(vid); s != "" || c != nil {
		t.Errorf("ActiveChargeState = (%q, %v), want (\"\", nil)", s, c)
	}
}

func TestHandler_ActiveDrive(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()
	const vid = int64(7)

	h.ProcessSignals(ctx, vid, gearBatch(enums.GearDrive))
	if got := h.CurrentState(vid); got != string(fsm.Driving) {
		t.Fatalf("setup: state = %q, want driving", got)
	}

	d := h.ActiveDrive(vid)
	if d == nil {
		t.Fatal("ActiveDrive = nil after a drive started")
	}
	if d.VehicleID != vid {
		t.Errorf("drive context VehicleID = %d, want %d", d.VehicleID, vid)
	}

	state, dctx := h.ActiveDriveState(vid)
	if dctx == nil {
		t.Fatal("ActiveDriveState context = nil")
	}
	if state != string(drive.Pending) && state != string(drive.Active) {
		t.Errorf("drive sub-FSM state = %q, want pending or active", state)
	}

	// A driving vehicle has no charge session.
	if c := h.ActiveCharge(vid); c != nil {
		t.Error("ActiveCharge should be nil during a drive")
	}
	if s, c := h.ActiveChargeState(vid); s != "" || c != nil {
		t.Errorf("ActiveChargeState = (%q, %v), want (\"\", nil) during a drive", s, c)
	}
}

func TestHandler_ActiveCharge(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()
	const vid = int64(8)

	h.ProcessSignals(ctx, vid, chargeBatch(enums.ChargeStateCharging))
	if got := h.CurrentState(vid); got != string(fsm.Charging) {
		t.Fatalf("setup: state = %q, want charging", got)
	}

	c := h.ActiveCharge(vid)
	if c == nil {
		t.Fatal("ActiveCharge = nil after a charge started")
	}
	if c.VehicleID != vid {
		t.Errorf("charge context VehicleID = %d, want %d", c.VehicleID, vid)
	}

	state, cctx := h.ActiveChargeState(vid)
	if state == "" || cctx == nil {
		t.Fatalf("ActiveChargeState = (%q, %v), want a state and context", state, cctx)
	}

	if d := h.ActiveDrive(vid); d != nil {
		t.Error("ActiveDrive should be nil during a charge")
	}
}

func TestHandler_Stats(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()

	h.ProcessSignals(ctx, 1, gearBatch(enums.GearDrive))             // driving + 1 drive
	h.ProcessSignals(ctx, 2, chargeBatch(enums.ChargeStateCharging)) // charging + 1 charge
	h.getOrCreate(ctx, 3)                                            // online, no sub-FSM

	st := h.Stats()
	if st["vehicles"] != 3 {
		t.Errorf("vehicles = %d, want 3", st["vehicles"])
	}
	if st["drives"] != 1 {
		t.Errorf("drives = %d, want 1", st["drives"])
	}
	if st["charges"] != 1 {
		t.Errorf("charges = %d, want 1", st["charges"])
	}
}

func TestHandler_VehicleSnapshots(t *testing.T) {
	h := NewHandler(nil, nil)
	ctx := context.Background()

	h.ProcessSignals(ctx, 10, gearBatch(enums.GearDrive)) // driving, gear-capable
	h.getOrCreate(ctx, 20)                                // online

	snaps := h.VehicleSnapshots()
	if len(snaps) != 2 {
		t.Fatalf("snapshots = %d, want 2", len(snaps))
	}

	byID := make(map[int64]VehicleFSMSnapshot, len(snaps))
	for _, s := range snaps {
		byID[s.VehicleID] = s
	}

	s10, ok := byID[10]
	if !ok {
		t.Fatal("snapshot for vehicle 10 missing")
	}
	if s10.State != string(fsm.Driving) {
		t.Errorf("v10 state = %q, want driving", s10.State)
	}
	if !s10.IsGearCapable {
		t.Error("v10 should be gear-capable after a Gear signal")
	}
	if s10.LastTransitionAt.IsZero() {
		t.Error("v10 LastTransitionAt should be set")
	}
	if s10.SecondsSinceLastTransition < 0 {
		t.Errorf("v10 SecondsSinceLastTransition = %f, want >= 0", s10.SecondsSinceLastTransition)
	}

	s20, ok := byID[20]
	if !ok {
		t.Fatal("snapshot for vehicle 20 missing")
	}
	if s20.State != string(fsm.Online) {
		t.Errorf("v20 state = %q, want online", s20.State)
	}
	if s20.IsGearCapable {
		t.Error("v20 should not be gear-capable (no Gear signal seen)")
	}
}

func TestHandler_HandleDebug_Errors(t *testing.T) {
	tests := []struct {
		name       string
		vehicleID  string
		wantStatus int
		wantError  string
		wantCode   string
	}{
		{
			name:       "non-numeric vehicle id is a bad request",
			vehicleID:  "not-a-number",
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid vehicle_id",
			wantCode:   "BAD_REQUEST",
		},
		{
			name:       "unknown vehicle has no FSM",
			vehicleID:  "123",
			wantStatus: http.StatusNotFound,
			wantError:  "no FSM for vehicle",
			wantCode:   "NOT_FOUND",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(nil, nil)
			rec := httptest.NewRecorder()

			h.HandleDebug(rec, debugRequest(t, tt.vehicleID))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error body: %v; raw = %s", err, rec.Body.String())
			}
			if body["error"] != tt.wantError {
				t.Errorf("error = %q, want %q", body["error"], tt.wantError)
			}
			if body["code"] != tt.wantCode {
				t.Errorf("code = %q, want %q", body["code"], tt.wantCode)
			}
		})
	}
}

func TestHandler_HandleDebug_OnlineNoStore(t *testing.T) {
	h := NewHandler(nil, nil)
	h.getOrCreate(context.Background(), 42)

	rec := httptest.NewRecorder()
	h.HandleDebug(rec, debugRequest(t, "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}

	var resp FSMDebugResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v; raw = %s", err, rec.Body.String())
	}
	if resp.VehicleID != 42 {
		t.Errorf("VehicleID = %d, want 42", resp.VehicleID)
	}
	if resp.FSM.CurrentState != string(fsm.Online) {
		t.Errorf("FSM.CurrentState = %q, want online", resp.FSM.CurrentState)
	}
	if resp.HasActiveDrive || resp.HasActiveCharge {
		t.Errorf("HasActiveDrive/HasActiveCharge = %v/%v, want false/false", resp.HasActiveDrive, resp.HasActiveCharge)
	}
	if resp.LastProcessedAt != nil {
		t.Errorf("LastProcessedAt = %v, want nil (never processed)", resp.LastProcessedAt)
	}
	if resp.Reconciliation != nil {
		t.Errorf("Reconciliation = %v, want nil (no signal store)", resp.Reconciliation)
	}
}

func TestHandler_HandleDebug_DrivingWithReconciliation(t *testing.T) {
	now := time.Now()
	s := signal.New()
	s.Set(55, "Gear", "D", now)

	h := NewHandler(nil, nil)
	h.SetSignalStore(s)
	h.ProcessSignals(context.Background(), 55, gearBatch(enums.GearDrive)) // driving + drive + lastProcessed

	rec := httptest.NewRecorder()
	h.HandleDebug(rec, debugRequest(t, "55"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}

	var resp FSMDebugResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v; raw = %s", err, rec.Body.String())
	}
	if resp.FSM.CurrentState != string(fsm.Driving) {
		t.Errorf("FSM.CurrentState = %q, want driving", resp.FSM.CurrentState)
	}
	if !resp.HasActiveDrive {
		t.Error("HasActiveDrive = false, want true")
	}
	if resp.LastProcessedAt == nil {
		t.Fatal("LastProcessedAt = nil, want a timestamp after ProcessSignals")
	}
	if resp.Reconciliation == nil {
		t.Fatal("Reconciliation = nil, want diagnostics when a store is present")
	}
	if resp.Reconciliation.Confidence != "high" {
		t.Errorf("Reconciliation.Confidence = %q, want high (Gear=D)", resp.Reconciliation.Confidence)
	}
	if resp.Reconciliation.ExpectedState != string(fsm.Driving) {
		t.Errorf("Reconciliation.ExpectedState = %q, want driving", resp.Reconciliation.ExpectedState)
	}
	if resp.Reconciliation.Mismatch {
		t.Error("Reconciliation.Mismatch = true, want false (FSM already driving)")
	}
}
