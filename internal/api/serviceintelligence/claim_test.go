package serviceintelligence

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func claimTestOutlook() *WarrantyOutlook {
	return &WarrantyOutlook{
		VehicleID: 42, Model: "Model 3", ModelYear: 2019,
		Coverages: []WarrantyCoverage{
			{Name: "Basic Limited", Status: "expired", DaysRemaining: -100},
			{Name: "Battery & Drive Unit", Status: "active", DaysRemaining: 900},
		},
	}
}

func claimTestResponse() *Response {
	resp := handlerResponse()
	resp.Communications = []CommunicationFinding{
		{ID: "c1", CommunicationNumber: "SB-21-12-001", Component: "HV Battery",
			Summary: "Battery contactor inspection", Confidence: 0.9,
			SourceDocumentURL: "https://example.com/tsb1"},
		{ID: "c2", CommunicationNumber: "SB-20-01-003", Component: "Suspension",
			Summary: "Control arm torque", Confidence: 0.4},
	}
	resp.RankedSymptoms = []SymptomMatch{
		{Signal: "charge_rate_drop", Component: "HV Battery", Severity: "high",
			ObservedAt: time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC), Score: 0.8},
	}
	doc := "https://example.com/ev1"
	resp.Evidence.Items = []EvidenceItem{
		{ID: "e1", Title: "Charge curve anomaly", Summary: " taper  at  60%", SourceDocumentURL: &doc},
	}
	return resp
}

func TestBuildClaimDraft(t *testing.T) {
	d := BuildClaimDraft("Charge rate drops after 60%. Happens daily.", claimTestOutlook(), claimTestResponse())

	if d.Subject != "Service request: Charge rate drops after 60%" {
		t.Fatalf("subject = %q", d.Subject)
	}
	if d.Vehicle != "Model 3 (2019)" {
		t.Fatalf("vehicle = %q", d.Vehicle)
	}
	if len(d.Coverages) != 2 {
		t.Fatalf("coverages = %d, want 2", len(d.Coverages))
	}
	if len(d.Comms) != 2 || !strings.Contains(d.Comms[0], "SB-21-12-001") {
		t.Fatalf("comms = %v, want confidence-ordered", d.Comms)
	}
	if len(d.Symptoms) != 1 || !strings.Contains(d.Symptoms[0], "charge_rate_drop") {
		t.Fatalf("symptoms = %v", d.Symptoms)
	}
	if len(d.Evidence) != 1 || !strings.Contains(d.Evidence[0], "taper at 60%") {
		t.Fatalf("evidence = %v, want one-lined", d.Evidence)
	}
	if !strings.Contains(d.Ask, "Battery & Drive Unit") || strings.Contains(d.Ask, "Basic Limited") {
		t.Fatalf("ask = %q, want active coverage only", d.Ask)
	}
	for _, want := range []string{"Subject:", "Vehicle:", "Issue:", "Warranty status:",
		"Related manufacturer communications", "Requested action:", "Verify coverage"} {
		if !strings.Contains(d.Body, want) {
			t.Fatalf("body missing %q:\n%s", want, d.Body)
		}
	}
}

func TestBuildClaimDraftEmptyIssue(t *testing.T) {
	d := BuildClaimDraft("  ", claimTestOutlook(), claimTestResponse())
	if d.Subject != "Service request — issue description needed" {
		t.Fatalf("subject = %q", d.Subject)
	}
	if strings.Contains(d.Body, "Issue:\n") {
		t.Fatal("body should omit the empty issue section")
	}
}

func TestBuildClaimDraftExpired(t *testing.T) {
	outlook := &WarrantyOutlook{VehicleID: 42, Model: "Model S", ModelYear: 2015,
		Coverages: []WarrantyCoverage{{Name: "Basic Limited", Status: "expired"}}}
	d := BuildClaimDraft("rattle", outlook, handlerResponse())
	if !strings.Contains(d.Ask, "out-of-warranty") {
		t.Fatalf("ask = %q, want out-of-warranty quote", d.Ask)
	}
}

func TestClaimDraftHandler(t *testing.T) {
	svc := &fakeIntelligenceService{response: claimTestResponse(), warranty: claimTestOutlook()}
	h := mountedHandler(svc)

	target := "/service-intelligence/vehicles/42/claim-draft?issue=" + url.QueryEscape("Charge rate drops.") + "&odometer_km=80000"
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var draft ClaimDraft
	if err := json.Unmarshal(rec.Body.Bytes(), &draft); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if draft.Subject != "Service request: Charge rate drops" {
		t.Fatalf("subject = %q", draft.Subject)
	}
	if svc.warrantyOdo != 80000 {
		t.Fatalf("odometer = %v, want 80000", svc.warrantyOdo)
	}
	if rec.Header().Get("Cache-Control") == "" {
		t.Fatal("missing cache-control")
	}
}

func TestClaimDraftHandlerErrors(t *testing.T) {
	svc := &fakeIntelligenceService{response: claimTestResponse(), warranty: claimTestOutlook()}
	h := mountedHandler(svc)
	for _, target := range []string{
		"/service-intelligence/vehicles/nope/claim-draft",
		"/service-intelligence/vehicles/42/claim-draft?odometer_km=abc",
		"/service-intelligence/vehicles/42/claim-draft?odometer_km=-5",
	} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400", target, rec.Code)
		}
	}
}
