package chargeplanner

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestComputeQueueOrdersBySlack(t *testing.T) {
	now := time.Date(2026, 3, 10, 18, 0, 0, 0, time.UTC)
	got, err := ComputeQueue([]QueueVehicle{
		{VehicleID: 1, CurrentSOC: 50, TargetSOC: 80, ReadyBy: "07:30", BatteryCapacityKWh: 75},
		{VehicleID: 2, CurrentSOC: 20, TargetSOC: 80, ReadyBy: "06:00", BatteryCapacityKWh: 75},
	}, 11, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Slots) != 2 || got.Slots[0].VehicleID != 2 {
		t.Fatalf("tightest car must charge first: %+v", got.Slots)
	}
	if !got.Slots[0].StartTime.Equal(now) {
		t.Fatalf("first slot must start now: %+v", got.Slots[0])
	}
	if !got.Slots[1].StartTime.Equal(got.Slots[0].EndTime) {
		t.Fatal("slots must be back-to-back")
	}
}

func TestComputeQueueFlagsInfeasible(t *testing.T) {
	now := time.Date(2026, 3, 10, 18, 0, 0, 0, time.UTC)
	got, err := ComputeQueue([]QueueVehicle{
		{VehicleID: 1, CurrentSOC: 10, TargetSOC: 100, ReadyBy: "19:00", BatteryCapacityKWh: 75},
	}, 7, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.AllFeasible || got.Slots[0].Feasible {
		t.Fatalf("expected infeasible: %+v", got)
	}
}

func TestComputeQueueRejects(t *testing.T) {
	now := time.Now().UTC()
	if _, err := ComputeQueue(nil, 11, now); err == nil {
		t.Fatal("expected error for empty queue")
	}
	if _, err := ComputeQueue([]QueueVehicle{
		{VehicleID: 1, CurrentSOC: 80, TargetSOC: 80, ReadyBy: "07:30"},
	}, 11, now); err == nil {
		t.Fatal("expected error when target <= current")
	}
	if _, err := ComputeQueue([]QueueVehicle{
		{VehicleID: 1, CurrentSOC: 50, TargetSOC: 80, ReadyBy: "25:00"},
	}, 11, now); err == nil {
		t.Fatal("expected error for bad ready_by")
	}
}

func TestQueueEndpoint(t *testing.T) {
	h := &Handler{}
	body := `{"vehicles":[{"vehicle_id":1,"current_soc":50,"target_soc":80,"ready_by":"07:30","battery_capacity_kwh":75}],"charger_kw":11}`
	req := httptest.NewRequest(http.MethodPost, "/queue", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Queue(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var advice QueueAdvice
	if err := json.NewDecoder(rec.Body).Decode(&advice); err != nil {
		t.Fatal(err)
	}
	if len(advice.Slots) != 1 || advice.Explanation == "" {
		t.Fatalf("incomplete advice: %+v", advice)
	}
}
