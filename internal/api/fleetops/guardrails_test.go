package fleetops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

func i16(v int16) *int16    { return &v }
func strp(s string) *string { return &s }

func TestEvaluateDriverGuardrailsAllow(t *testing.T) {
	d := &models.FleetDriver{ID: 1, Status: "active", MaxChargeSOC: i16(80)}
	at := time.Date(2026, 3, 10, 14, 0, 0, 0, time.UTC)
	ev := EvaluateDriverGuardrails(d, 80, at)
	if !ev.Allowed || ev.InCurfew {
		t.Fatalf("unexpected evaluation: %+v", ev)
	}
}

func TestEvaluateDriverGuardrailsChargeCap(t *testing.T) {
	d := &models.FleetDriver{ID: 1, Status: "active", MaxChargeSOC: i16(80)}
	ev := EvaluateDriverGuardrails(d, 95, time.Now().UTC())
	if ev.Allowed {
		t.Fatalf("expected deny: %+v", ev)
	}
	if len(ev.Reasons) != 1 {
		t.Fatalf("reasons = %v", ev.Reasons)
	}
}

func TestEvaluateDriverGuardrailsOvernightCurfew(t *testing.T) {
	d := &models.FleetDriver{
		ID: 1, Status: "active",
		CurfewStart: strp("22:00"), CurfewEnd: strp("06:00"),
	}
	night := time.Date(2026, 3, 10, 23, 30, 0, 0, time.UTC)
	if ev := EvaluateDriverGuardrails(d, 0, night); ev.Allowed || !ev.InCurfew {
		t.Fatalf("23:30 must be inside curfew: %+v", ev)
	}
	early := time.Date(2026, 3, 10, 5, 59, 0, 0, time.UTC)
	if ev := EvaluateDriverGuardrails(d, 0, early); ev.Allowed || !ev.InCurfew {
		t.Fatalf("05:59 must be inside curfew: %+v", ev)
	}
	day := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
	if ev := EvaluateDriverGuardrails(d, 0, day); !ev.Allowed || ev.InCurfew {
		t.Fatalf("noon must be outside curfew: %+v", ev)
	}
}

func TestEvaluateDriverGuardrailsInactive(t *testing.T) {
	d := &models.FleetDriver{ID: 1, Status: "inactive"}
	if ev := EvaluateDriverGuardrails(d, 0, time.Now().UTC()); ev.Allowed {
		t.Fatalf("expected deny: %+v", ev)
	}
}

func TestValidateDriverGuardrails(t *testing.T) {
	base := models.FleetDriver{DisplayName: "Teen", ReferenceCode: "T1", Status: "active"}
	bad := base
	bad.MaxChargeSOC = i16(10)
	if err := validateDriver(&bad); err == nil {
		t.Fatal("expected error for cap below 20")
	}
	bad = base
	bad.CurfewStart = strp("22:00")
	if err := validateDriver(&bad); err == nil {
		t.Fatal("expected error for half-set curfew")
	}
	bad = base
	bad.CurfewStart, bad.CurfewEnd = strp("22:00"), strp("25:00")
	if err := validateDriver(&bad); err == nil {
		t.Fatal("expected error for bad curfew time")
	}
	ok := base
	ok.CurfewStart, ok.CurfewEnd = strp("22:00"), strp("06:00")
	ok.MaxChargeSOC = i16(80)
	if err := validateDriver(&ok); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

type evaluateServiceFake struct {
	fleetOpsService
	driver *models.FleetDriver
}

func (f *evaluateServiceFake) GetDriver(context.Context, int64) (*models.FleetDriver, error) {
	return f.driver, nil
}

func TestEvaluateDriverEndpoint(t *testing.T) {
	svc := &evaluateServiceFake{driver: &models.FleetDriver{
		ID: 5, Status: "active", MaxChargeSOC: i16(80),
		CurfewStart: strp("22:00"), CurfewEnd: strp("06:00"),
	}}
	req := httptest.NewRequest(http.MethodGet,
		"/fleet-ops/drivers/5/evaluate?charge_soc=90&at=2026-03-10T23:00:00Z", nil)
	rec := httptest.NewRecorder()
	testRouter(svc).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var ev DriverEvaluation
	if err := json.NewDecoder(rec.Body).Decode(&ev); err != nil {
		t.Fatal(err)
	}
	if ev.Allowed || len(ev.Reasons) != 2 {
		t.Fatalf("expected cap + curfew deny: %+v", ev)
	}
}

func TestEvaluateDriverEndpointNotFound(t *testing.T) {
	svc := &evaluateServiceFake{driver: nil}
	req := httptest.NewRequest(http.MethodGet, "/fleet-ops/drivers/9/evaluate", nil)
	rec := httptest.NewRecorder()
	testRouter(svc).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
