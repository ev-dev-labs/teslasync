package chargeautopilot

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
)

// fakePlanStore satisfies PlanCreator in memory.
type fakePlanStore struct {
	created *chargingdb.ChargePlan
	err     error
}

func (f *fakePlanStore) Create(_ context.Context, p *chargingdb.ChargePlan) error {
	if f.err != nil {
		return f.err
	}
	p.ID = 42
	f.created = p
	return nil
}

// fakeRunner satisfies PlanRunner without touching Tesla.
type fakeRunner struct {
	applied    *chargingdb.ChargePlan
	failedCmd  string
	err        error
	appliedIDs []int64
}

func (f *fakeRunner) ApplyPlanByID(_ context.Context, planID int64) (*chargingdb.ChargePlan, string, error) {
	f.appliedIDs = append(f.appliedIDs, planID)
	if f.err != nil {
		return nil, f.failedCmd, f.err
	}
	return f.applied, "", nil
}

var (
	_ PlanCreator = (*fakePlanStore)(nil)
	_ PlanRunner  = (*fakeRunner)(nil)
)

func enabledProfile(vehicleID int64) Profile {
	p := DefaultProfile(vehicleID)
	p.Enabled = true
	p.TargetSOC = 80
	p.ReadyBy = "07:30"
	p.RatePlan = "pge-ev2a"
	p.DailyCapSOC = 90
	p.MaxAmps = 32
	p.BatteryCapacityKWh = 75
	return p
}

func newRunHandlerForTest(stores *fakeStores, plans *fakePlanStore, runner *fakeRunner) *RunHandler {
	h := NewRunHandler(stores, plans, runner)
	h.now = func() time.Time { return time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC) }
	return h
}

func doRun(t *testing.T, h *RunHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/run", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Run(rec, req)
	return rec
}

func TestRunRejectsDisabledProfile(t *testing.T) {
	p := enabledProfile(7)
	p.Enabled = false
	stores := &fakeStores{profiles: map[int64]Profile{7: p}}
	h := newRunHandlerForTest(stores, &fakePlanStore{}, &fakeRunner{})

	rec := doRun(t, h, `{"vehicle_id":7,"current_soc":40}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestRunRejectsInfeasiblePreview(t *testing.T) {
	// Current SOC already above target: Preview fails, Run must 409
	// without persisting or applying anything.
	stores := &fakeStores{profiles: map[int64]Profile{7: enabledProfile(7)}}
	plans := &fakePlanStore{}
	runner := &fakeRunner{}
	h := newRunHandlerForTest(stores, plans, runner)

	rec := doRun(t, h, `{"vehicle_id":7,"current_soc":95}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if plans.created != nil {
		t.Fatal("no plan should be persisted for an infeasible run")
	}
	if len(runner.appliedIDs) != 0 {
		t.Fatal("no plan should be applied for an infeasible run")
	}
}

func TestRunPersistsAndAppliesPlan(t *testing.T) {
	stores := &fakeStores{profiles: map[int64]Profile{7: enabledProfile(7)}}
	plans := &fakePlanStore{}
	applied := &chargingdb.ChargePlan{
		ID:             42,
		VehicleID:      7,
		TargetSOC:      80,
		ScheduledStart: time.Date(2026, 1, 16, 1, 0, 0, 0, time.UTC),
		Status:         "scheduled",
	}
	runner := &fakeRunner{applied: applied}
	h := newRunHandlerForTest(stores, plans, runner)

	rec := doRun(t, h, `{"vehicle_id":7,"current_soc":40}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if plans.created == nil {
		t.Fatal("expected a persisted draft plan")
	}
	if plans.created.Status != "draft" {
		t.Fatalf("plan status = %q, want draft", plans.created.Status)
	}
	if plans.created.TargetSOC != 80 {
		t.Fatalf("plan target_soc = %d, want 80", plans.created.TargetSOC)
	}
	if plans.created.RatePlan != "pge-ev2a" {
		t.Fatalf("plan rate_plan = %q, want pge-ev2a", plans.created.RatePlan)
	}
	if len(runner.appliedIDs) != 1 || runner.appliedIDs[0] != 42 {
		t.Fatalf("applied IDs = %v, want [42]", runner.appliedIDs)
	}

	var res runResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if res.PlanID != 42 || res.Status != "scheduled" || res.TargetSOC != 80 {
		t.Fatalf("unexpected response: %+v", res)
	}
}

func TestRunSurfacesApplyFailure(t *testing.T) {
	stores := &fakeStores{profiles: map[int64]Profile{7: enabledProfile(7)}}
	plans := &fakePlanStore{}
	runner := &fakeRunner{failedCmd: "set_charge_limit", err: errors.New("tesla unavailable")}
	h := newRunHandlerForTest(stores, plans, runner)

	rec := doRun(t, h, `{"vehicle_id":7,"current_soc":40}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	// The draft plan survives so the run is retryable from the planner UI.
	if plans.created == nil || plans.created.Status != "draft" {
		t.Fatal("expected the draft plan to survive an apply failure")
	}
}

func TestNewRunHandlerPanicsOnNil(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on nil deps")
		}
	}()
	NewRunHandler(nil, &fakePlanStore{}, &fakeRunner{})
}
