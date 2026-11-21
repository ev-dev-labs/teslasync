package smartreadiness_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	ownershiphandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
)

const invoiceEndpoint = "/api/v1/charging-reconciliation/invoices"

func TestInvoiceVarianceBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	db, at := seedInvoiceVariance(t)
	runPrivateMediaBrowser(t, invoiceVarianceRouter(db, at.Add(8*24*time.Hour), "X-Test-Subject"),
		"synthetic-invoice", "smart-invoice-variance.smoke.spec.ts", "SMART_INVOICE_REAL_BACKEND")
}

func invoiceVarianceRouter(db *database.DB, now time.Time, header string) http.Handler {
	svc := ownershipintelsvc.New(ownershipdb.NewSourceRepository(db), ownershipdb.NewDurableRepository(db)).
		WithClock(func() time.Time { return now })
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) { ownershiphandler.NewHandler(svc, header).MountRoutes(r) })
	return router
}

func seedInvoiceVariance(t *testing.T) (*database.DB, time.Time) {
	t.Helper()
	_, db := testRepository(t)
	at := time.Date(2026, 11, 13, 2, 0, 0, 0, time.UTC)
	if _, err := db.Pool.Exec(t.Context(), `
		CREATE TABLE drives (id bigint PRIMARY KEY);
		CREATE TABLE charging_sessions (
			id bigint PRIMARY KEY, vehicle_id bigint NOT NULL REFERENCES vehicles(id),
			started_at timestamptz NOT NULL, ended_at timestamptz, total_energy_added_wh double precision,
			peak_power_w double precision, avg_power_w double precision, delta_soc_pct double precision,
			cost_decimal numeric, cost_currency varchar(3), charger_type text, start_place text,
			start_lat double precision, start_lng double precision
		);
		INSERT INTO vehicles (id, display_name) VALUES (8, 'Other synthetic vehicle');`); err != nil {
		t.Fatal(err)
	}
	applyWarrantyFixtureMigration(t, db, "000225_ownership_intelligence.up")
	applyWarrantyFixtureMigration(t, db, "000297_charging_invoice_variance_evidence.up")
	applyWarrantyFixtureMigration(t, db, "000304_charging_invoice_review_clear.up")
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO charging_sessions (id,vehicle_id,started_at,ended_at,total_energy_added_wh,start_place)
		VALUES (79,7,$1,$2,1000,'Synthetic site'), (80,8,$1,$2,40000,'Synthetic site')`,
		at, at.Add(30*time.Minute)); err != nil {
		t.Fatal(err)
	}
	return db, at
}

func invoiceRequest[R any](
	t *testing.T, router http.Handler, method, path, subject, expected string, body any, status int,
) R {
	t.Helper()
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(data))
	request.Header.Set("X-Test-Subject", subject)
	request.Header.Set("X-TeslaSync-Expected-Principal", expected)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != status || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%s %s: got %d %q, want %d no-store; %s",
			method, path, response.Code, response.Header().Get("Cache-Control"), status, response.Body)
	}
	var result R
	if status == http.StatusOK || status == http.StatusCreated {
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
	}
	return result
}

func invoiceAmount(amount int64) *int64 { return &amount }

func invoiceFixture(at time.Time, ref string) domain.CreateInvoiceRequest {
	return domain.CreateInvoiceRequest{
		VehicleID: 7, Provider: "Synthetic invoices", InvoiceRef: ref, Currency: "USD",
		PeriodStart: at.Add(-time.Hour), PeriodEnd: at.Add(time.Hour), BilledTotalMinor: invoiceAmount(910),
		VarianceOptions: &domain.InvoiceVarianceOptions{MaterialAmountMinor: 100, CompleteStatement: true},
		Lines: []domain.InvoiceLineInput{{
			LineRef: "synthetic line", OccurredAt: at, Location: "Synthetic site", BilledEnergyWh: 24000,
			BilledEnergyMinor: invoiceAmount(600), BilledIdleMinor: invoiceAmount(100), BilledTaxMinor: invoiceAmount(80),
			BilledTotalMinor: invoiceAmount(810),
		}},
	}
}

func TestInvoiceVarianceDistinguishesUnrecordedChargesFromZero(t *testing.T) {
	db, at := seedInvoiceVariance(t)
	router := invoiceVarianceRouter(db, at.Add(2*time.Hour), "X-Test-Subject")
	for _, tc := range []struct {
		name string
		tax  *int64
		gap  bool
	}{{"unknown tax", nil, false}, {"documented zero tax", invoiceAmount(0), true}} {
		t.Run(tc.name, func(t *testing.T) {
			input := invoiceFixture(at, tc.name)
			input.VarianceOptions = &domain.InvoiceVarianceOptions{MaterialAmountMinor: 50}
			input.Lines[0].BilledTaxMinor = tc.tax
			input.Lines[0].VarianceEvidence = &domain.InvoiceVarianceEvidence{OtherFeesMinor: invoiceAmount(30)}
			created := invoiceRequest[domain.ChargingInvoice](t, router, http.MethodPost, invoiceEndpoint, mediaOwner,
				"", input, http.StatusCreated)
			path := fmt.Sprintf("%s/%d/report?vehicle_id=7", invoiceEndpoint, created.ID)
			report := invoiceRequest[domain.ReconciliationReport](t, router, http.MethodGet, path, mediaOwner, "", nil, http.StatusOK)
			review := report.VarianceReview
			if review == nil {
				t.Fatal("expected scoped variance review")
			}
			if !tc.gap {
				if review.State != "insufficient" || review.ComparableLines != 0 || len(review.Findings) != 0 {
					t.Fatalf("unknown tax became a material difference: %+v", review)
				}
				return
			}
			if review.State != "review" || len(review.Findings) != 1 {
				t.Fatalf("explicit zero should expose the component gap: %+v", review)
			}
			delta := review.Findings[0].Assessment.UnexplainedTotalMinor
			if delta == nil || *delta != 80 {
				t.Fatalf("unexpected component gap: %+v", review.Findings[0])
			}
		})
	}
}

func TestInvoiceVarianceRequiresDocumentedTotalsAndRate(t *testing.T) {
	db, at := seedInvoiceVariance(t)
	router := invoiceVarianceRouter(db, at.Add(2*time.Hour), "X-Test-Subject")
	input := invoiceFixture(at, "synthetic-explicit-totals")
	zero := invoiceAmount(0)
	input.BilledTotalMinor = nil
	invoiceRequest[struct{}](t, router, http.MethodPost, invoiceEndpoint, mediaOwner, "", input, http.StatusBadRequest)
	input.BilledTotalMinor = zero
	input.Lines[0].BilledTotalMinor = nil
	invoiceRequest[struct{}](t, router, http.MethodPost, invoiceEndpoint, mediaOwner, "", input, http.StatusBadRequest)
	input.Lines[0].BilledTotalMinor = zero
	rate := &domain.InvoiceRateEvidence{Boundary: domain.MeterBoundaryStation, EnergyWh: 1000}
	input.Lines[0].VarianceEvidence = &domain.InvoiceVarianceEvidence{BilledBoundary: rate.Boundary, Rate: rate}
	invoiceRequest[struct{}](t, router, http.MethodPost, invoiceEndpoint, mediaOwner, "", input, http.StatusBadRequest)

	rate.AmountMinor = zero
	created := invoiceRequest[domain.ChargingInvoice](t, router, http.MethodPost, invoiceEndpoint, mediaOwner, "", input, http.StatusCreated)
	line := created.Lines[0]
	if created.BilledTotalMinor != 0 || line.BilledTotalMinor != 0 ||
		line.VarianceEvidence == nil || line.VarianceEvidence.Rate == nil ||
		line.VarianceEvidence.Rate.AmountMinor == nil || *line.VarianceEvidence.Rate.AmountMinor != 0 {
		t.Fatalf("documented zeros did not survive import: %+v", created)
	}
	rate.AmountMinor = nil
	edit := domain.UpdateInvoiceReviewRequest{
		InvoiceReviewScope: domain.InvoiceReviewScope{VehicleID: 7, ExpectedVersion: created.Version},
		Confirmed:          true,
		Options:            *input.VarianceOptions,
		Lines:              []domain.InvoiceReviewLineInput{{LineID: line.ID, Evidence: *input.Lines[0].VarianceEvidence}},
	}
	path := fmt.Sprintf("%s/%d/review", invoiceEndpoint, created.ID)
	invoiceRequest[struct{}](t, router, http.MethodPut, path, mediaOwner, "", edit, http.StatusBadRequest)
	rate.AmountMinor = zero
	invoiceRequest[struct{}](t, router, http.MethodPut, path, mediaOwner, "", edit, http.StatusNoContent)
}

func TestInvoiceVarianceMigrationPreservesImportedAmountsWithoutInferringCoverage(t *testing.T) {
	db, at := seedInvoiceVariance(t)
	router := invoiceVarianceRouter(db, at.Add(2*time.Hour), "X-Test-Subject")
	input := invoiceFixture(at, "migration-synthetic")
	invoice := invoiceRequest[domain.ChargingInvoice](t, router, http.MethodPost, invoiceEndpoint, mediaOwner,
		"", input, http.StatusCreated)
	for _, name := range []string{
		"000304_charging_invoice_review_clear.down", "000297_charging_invoice_variance_evidence.down",
		"000297_charging_invoice_variance_evidence.up", "000304_charging_invoice_review_clear.up",
	} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	var taxMinor int64
	var coverage int16
	var consent bool
	err := db.Pool.QueryRow(t.Context(), `
		SELECT l.billed_tax_minor,l.billed_amount_coverage,i.variance_complete_statement
		FROM charging_invoice_lines l JOIN charging_invoices i ON l.invoice_id=i.id
		WHERE i.id=$1`, invoice.ID).Scan(&taxMinor, &coverage, &consent)
	if err != nil || taxMinor != 80 || coverage != 0 || consent {
		t.Fatalf("unexpected invoice after migration round trip: tax=%d coverage=%d consent=%t err=%v",
			taxMinor, coverage, consent, err)
	}
}

func TestInvoiceVarianceMountedPrivateReport(t *testing.T) {
	db, at := seedInvoiceVariance(t)
	now := at.Add(2 * time.Hour)
	router := invoiceVarianceRouter(db, now, "X-Test-Subject")
	open := invoiceVarianceRouter(db, now, "")
	input := invoiceFixture(at, "syn-positive")
	loss, otherFees := 2500.0, int64(30)
	input.Lines[0].VarianceEvidence = &domain.InvoiceVarianceEvidence{
		BilledBoundary: domain.MeterBoundaryStation,
		Meter:          &domain.InvoiceMeterEvidence{ObservedBoundary: domain.MeterBoundaryBattery, ObservedEnergyWh: 20000, MaxLossWh: &loss},
		Rate: &domain.InvoiceRateEvidence{
			Boundary: domain.MeterBoundaryStation, AmountMinor: invoiceAmount(18), EnergyWh: 1000,
		},
		OtherFeesMinor: &otherFees,
	}
	invoiceRequest[struct{}](t, open, http.MethodPost, invoiceEndpoint, "", "open", input, http.StatusForbidden)
	created := invoiceRequest[domain.ChargingInvoice](t, router, http.MethodPost, invoiceEndpoint, mediaOwner,
		"subject:"+mediaOwner, input, http.StatusCreated)
	endpoint := fmt.Sprintf("%s/%d", invoiceEndpoint, created.ID)
	reportPath := endpoint + "/report?vehicle_id=7"
	invoiceRequest[struct{}](t, router, http.MethodGet, reportPath, mediaOther, "subject:"+mediaOther, nil, http.StatusNotFound)
	invoiceRequest[struct{}](t, router, http.MethodGet, reportPath, mediaOwner, "subject:"+mediaOther, nil, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodGet, endpoint+"/report?vehicle_id=8", mediaOwner, "", nil, http.StatusNotFound)
	invoiceRequest[struct{}](t, router, http.MethodGet, endpoint+"/report", mediaOwner, "", nil, http.StatusBadRequest)
	// A new service instance must reload exactly the consent and evidence that were imported.
	restarted := invoiceVarianceRouter(db, now, "X-Test-Subject")
	report := invoiceRequest[domain.ReconciliationReport](t, restarted, http.MethodGet, reportPath, mediaOwner,
		"subject:"+mediaOwner, nil, http.StatusOK)
	review := report.VarianceReview
	if review == nil || review.State != "review" || review.MatchedLines != 1 || len(review.Findings) != 1 ||
		review.UnexplainedStatementMinor == nil || *review.UnexplainedStatementMinor != 100 || report.RecoverableMinor != 0 {
		t.Fatalf("want scoped neutral report with statement gap: %+v", review)
	}
	finding := review.Findings[0]
	if finding.SessionID == nil || *finding.SessionID != 79 || finding.Assessment.UnexplainedEnergyWh == nil ||
		*finding.Assessment.UnexplainedEnergyWh != 1500 || finding.Assessment.UnexplainedRateMinor == nil ||
		*finding.Assessment.UnexplainedRateMinor != 168 || finding.Assessment.UnexplainedTotalMinor != nil {
		t.Fatalf("want exact matched session and separate material differences: %+v", finding.Assessment)
	}
	const marker = "synthetic-private-marker"
	for _, invalidBody := range []string{
		`{"confirmed":true,"claimed_minor":100,"reasons":["` + marker + `"]}`,
		`{"` + marker + `":"invalid field"}`,
	} {
		request := httptest.NewRequest(http.MethodPost, endpoint+"/disputes", strings.NewReader(invalidBody))
		request.Header.Set("X-Test-Subject", mediaOwner)
		result := httptest.NewRecorder()
		restarted.ServeHTTP(result, request)
		if result.Code != http.StatusBadRequest || strings.Contains(result.Body.String(), marker) {
			t.Fatalf("private dispute input must not be echoed: %d %s", result.Code, result.Body)
		}
	}
	const disputeNote = "Synthetic discrepancy reviewed locally"
	disputePath := endpoint + "/disputes"
	claim := domain.CreateDisputeRequest{ClaimedMinor: 100, Confirmed: true, Note: disputeNote}
	invoiceRequest[struct{}](t, restarted, http.MethodPost, disputePath, mediaOwner,
		"subject:"+mediaOwner, claim, http.StatusConflict)
	claim.VehicleID, claim.ExpectedVersion, claim.ExpectedDigest = 8, report.Invoice.Version, report.DisputePacketDigest
	invoiceRequest[struct{}](t, restarted, http.MethodPost, disputePath, mediaOwner,
		"subject:"+mediaOwner, claim, http.StatusNotFound)
	claim.VehicleID = 7
	invoiceRequest[struct{}](t, restarted, http.MethodPost, disputePath, mediaOther,
		"subject:"+mediaOther, claim, http.StatusNotFound)
	if _, err := db.Pool.Exec(t.Context(), `UPDATE charging_sessions SET started_at = $1 WHERE id = 79`, at.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	invoiceRequest[struct{}](t, restarted, http.MethodPost, disputePath, mediaOwner,
		"subject:"+mediaOwner, claim, http.StatusConflict)
	latest := invoiceRequest[domain.ReconciliationReport](t, restarted, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusOK)
	if latest.VarianceReview.State != "review" || latest.Invoice.Version != claim.ExpectedVersion ||
		latest.DisputePacketDigest == claim.ExpectedDigest {
		t.Fatalf("re-matching must change the packet even at the same statement revision: %+v", latest.VarianceReview)
	}
	claim.ExpectedDigest = latest.DisputePacketDigest
	body, err := json.Marshal(claim)
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan int, 2)
	for range 2 {
		go func() {
			request := httptest.NewRequest(http.MethodPost, disputePath, bytes.NewReader(body))
			request.Header.Set("X-Test-Subject", mediaOwner)
			request.Header.Set("X-TeslaSync-Expected-Principal", "subject:"+mediaOwner)
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			restarted.ServeHTTP(recorder, request)
			results <- recorder.Code
		}()
	}
	left, right := <-results, <-results
	if !((left == http.StatusCreated && right == http.StatusConflict) || (right == http.StatusCreated && left == http.StatusConflict)) {
		t.Fatalf("concurrent confirmation must record one dispute: %d and %d", left, right)
	}
	invoiceRequest[struct{}](t, restarted, http.MethodPost, disputePath, mediaOwner,
		"subject:"+mediaOwner, claim, http.StatusConflict)
	handled := invoiceRequest[domain.ReconciliationReport](t, restarted, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusOK)
	if len(handled.Disputes) != 1 || handled.Disputes[0].Note != disputeNote ||
		handled.VarianceReview == nil || handled.VarianceReview.State != "handled" ||
		len(handled.VarianceReview.Findings) != 0 || handled.VarianceReview.UnexplainedStatementMinor != nil {
		t.Fatalf("a statement already being disputed must not repeat advice: %+v", handled.VarianceReview)
	}
	invoiceRequest[struct{}](t, restarted, http.MethodDelete, endpoint, mediaOther, "", nil, http.StatusNotFound)
	invoiceRequest[struct{}](t, restarted, http.MethodDelete, endpoint, mediaOwner, "subject:"+mediaOwner, nil, http.StatusNoContent)
	invoiceRequest[struct{}](t, restarted, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusNotFound)
}

func TestInvoiceVarianceEditsAndClearsReviewWithoutTouchingStatement(t *testing.T) {
	db, at := seedInvoiceVariance(t)
	router := invoiceVarianceRouter(db, at.Add(2*time.Hour), "X-Test-Subject")
	input := invoiceFixture(at, "syn-corrected-review")
	fees := int64(30)
	input.Lines[0].VarianceEvidence = &domain.InvoiceVarianceEvidence{OtherFeesMinor: &fees}
	created := invoiceRequest[domain.ChargingInvoice](t, router, http.MethodPost, invoiceEndpoint, mediaOwner, "", input, http.StatusCreated)
	endpoint := fmt.Sprintf("%s/%d", invoiceEndpoint, created.ID)
	reportPath := endpoint + "/report?vehicle_id=7"
	reviewPath := endpoint + "/review"
	current := invoiceRequest[domain.ReconciliationReport](t, router, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusOK)
	edit := domain.UpdateInvoiceReviewRequest{
		InvoiceReviewScope: domain.InvoiceReviewScope{VehicleID: 7, ExpectedVersion: created.Version},
		Confirmed:          true,
		Options:            domain.InvoiceVarianceOptions{MaterialAmountMinor: 200, CompleteStatement: true},
		Lines:              []domain.InvoiceReviewLineInput{{LineID: created.Lines[0].ID + 999, Evidence: *input.Lines[0].VarianceEvidence}},
	}
	invoiceRequest[struct{}](t, router, http.MethodPut, reviewPath, mediaOther, "subject:"+mediaOther, edit, http.StatusNotFound)
	invoiceRequest[struct{}](t, router, http.MethodPut, reviewPath, mediaOwner, "subject:"+mediaOther, edit, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodPut, reviewPath, mediaOwner, "", edit, http.StatusBadRequest)
	edit.Lines[0].LineID = created.Lines[0].ID
	invoiceRequest[struct{}](t, router, http.MethodPut, reviewPath, mediaOwner, "", edit, http.StatusNoContent)
	claim := domain.CreateDisputeRequest{
		ClaimedMinor: 100, Confirmed: true, VehicleID: 7, ExpectedVersion: created.Version, ExpectedDigest: current.DisputePacketDigest,
	}
	invoiceRequest[struct{}](t, router, http.MethodPost, endpoint+"/disputes", mediaOwner, "", claim, http.StatusConflict)
	edited := invoiceRequest[domain.ReconciliationReport](t, router, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusOK)
	if edited.Invoice.Version != created.Version+1 || edited.VarianceReview.State != "no_material_difference" ||
		edited.Invoice.Lines[0].VarianceEvidence == nil {
		t.Fatalf("edit must update the optional review against the same source: %+v", edited)
	}
	edit.Options.MaterialAmountMinor = 100
	edit.ExpectedVersion = edited.Invoice.Version
	invoiceRequest[struct{}](t, router, http.MethodPut, reviewPath, mediaOwner, "", edit, http.StatusNoContent)
	current = invoiceRequest[domain.ReconciliationReport](t, router, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusOK)
	claim.ExpectedVersion, claim.ExpectedDigest = current.Invoice.Version, current.DisputePacketDigest
	dispute := invoiceRequest[domain.InvoiceDispute](t, router, http.MethodPost, endpoint+"/disputes", mediaOwner, "", claim, http.StatusCreated)
	invoiceRequest[struct{}](t, router, http.MethodDelete,
		fmt.Sprintf("%s?vehicle_id=7&expected_version=%d", reviewPath, edited.Invoice.Version), mediaOwner, "", nil, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodDelete,
		fmt.Sprintf("%s?vehicle_id=8&expected_version=%d", reviewPath, current.Invoice.Version), mediaOwner, "", nil, http.StatusNotFound)
	invoiceRequest[struct{}](t, router, http.MethodDelete,
		fmt.Sprintf("%s?vehicle_id=7&expected_version=%d", reviewPath, current.Invoice.Version), mediaOwner, "", nil, http.StatusNoContent)
	if _, err := db.Pool.Exec(t.Context(), `ALTER TABLE charging_sessions RENAME TO unused_charging_sessions`); err != nil {
		t.Fatal(err)
	}
	off := invoiceRequest[domain.ReconciliationReport](t, router, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusOK)
	line := off.Invoice.Lines[0]
	if !off.Invoice.ReviewCleared || off.Invoice.VarianceOptions != nil || off.VarianceReview.State != "off" ||
		off.DisputePacketDigest != "" || off.VarianceReview.MatchedLines != 0 ||
		len(off.Disputes) != 1 || off.Disputes[0].ID != dispute.ID ||
		line.ID != created.Lines[0].ID || line.BilledEnergyWh != 24000 || line.BilledTaxMinor != 80 ||
		line.BilledIdleMinor != 100 || line.BilledTotalMinor != 810 || line.VarianceEvidence != nil {
		t.Fatalf("clear must stop comparisons and preserve statement and dispute history: %+v", off)
	}
	invoiceRequest[struct{}](t, router, http.MethodPost, endpoint+"/disputes", mediaOwner, "",
		domain.CreateDisputeRequest{ClaimedMinor: 100, Confirmed: true}, http.StatusConflict)
	edit.ExpectedVersion = off.Invoice.Version
	invoiceRequest[struct{}](t, router, http.MethodPut, reviewPath, mediaOwner, "", edit, http.StatusNoContent)
	if _, err := db.Pool.Exec(t.Context(), `ALTER TABLE unused_charging_sessions RENAME TO charging_sessions`); err != nil {
		t.Fatal(err)
	}
	resumed := invoiceRequest[domain.ReconciliationReport](t, router, http.MethodGet, reportPath, mediaOwner, "", nil, http.StatusOK)
	if resumed.Invoice.ReviewCleared || resumed.VarianceReview.State != "handled" || len(resumed.Disputes) != 1 {
		t.Fatalf("re-enrolling must not forget a previously handled statement: %+v", resumed.VarianceReview)
	}
}

func TestInvoiceVarianceSuppressesEstimatesUnknownLossAndAmbiguousMatch(t *testing.T) {
	db, at := seedInvoiceVariance(t)
	router := invoiceVarianceRouter(db, at.Add(2*time.Hour), "X-Test-Subject")
	check := func(input domain.CreateInvoiceRequest, desired string, matched int) {
		t.Helper()
		created := invoiceRequest[domain.ChargingInvoice](t, router, http.MethodPost, invoiceEndpoint, mediaOwner,
			"", input, http.StatusCreated)
		path := fmt.Sprintf("%s/%d/report?vehicle_id=7", invoiceEndpoint, created.ID)
		result := invoiceRequest[domain.ReconciliationReport](t, router, http.MethodGet, path, mediaOwner, "", nil, http.StatusOK)
		review := result.VarianceReview
		if desired == "" {
			if review != nil {
				t.Fatalf("legacy invoice must stay opted out: %+v", review)
			}
			return
		}
		if review == nil || review.State != desired || review.MatchedLines != matched || len(review.Findings) != 0 ||
			review.UnexplainedStatementMinor != nil {
			t.Fatalf("unexpected result for %q: %+v", input.InvoiceRef, review)
		}
	}
	input := invoiceFixture(at, "syn-off")
	input.VarianceOptions = nil
	check(input, "", 0)
	input = invoiceFixture(at, "syn-meter-unknown")
	input.VarianceOptions.CompleteStatement = false
	input.Lines[0].VarianceEvidence = &domain.InvoiceVarianceEvidence{
		BilledBoundary: domain.MeterBoundaryStation,
		Meter:          &domain.InvoiceMeterEvidence{ObservedBoundary: domain.MeterBoundaryBattery, ObservedEnergyWh: 19000},
	}
	check(input, "insufficient", 1)
	input.InvoiceRef = "syn-known-fees"
	fees := int64(30)
	input.Lines[0].VarianceEvidence.OtherFeesMinor = &fees
	check(input, "no_material_difference", 1)
	input.InvoiceRef = "syn-duplicate"
	input.Lines[0].VarianceEvidence.OtherFeesMinor = nil
	input.Lines[0].VarianceEvidence.Rate = &domain.InvoiceRateEvidence{
		Boundary: domain.MeterBoundaryStation, AmountMinor: invoiceAmount(15), EnergyWh: 1000,
	}
	input.Lines = append(input.Lines, input.Lines[0])
	check(input, "insufficient", 0)
}
