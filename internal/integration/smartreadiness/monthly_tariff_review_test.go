package smartreadiness_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	tariffsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/monthlytariff"
	"github.com/ev-dev-labs/teslasync/internal/database"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	tariffdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/monthlytariff"
	ownership "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	tariff "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/monthlytariff"
	ownershiphandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
	tariffport "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/monthlytariff"
	"github.com/go-chi/chi/v5"
)

const monthlyTariffEndpoint = "/api/v1/tariff-lab/monthly-review"
const monthlyTariffPath = monthlyTariffEndpoint + "?vehicle_id=7"

var monthlyTariffEarly = time.Date(2026, 12, 2, 13, 59, 0, 0, time.UTC)

type tariffSelection struct {
	SiteID             int64     `json:"site_id"`
	SiteRevision       time.Time `json:"site_revision"`
	CurrentTariffID    int64     `json:"current_tariff_id"`
	CurrentVersion     int       `json:"current_version"`
	AlternativeID      int64     `json:"alternative_tariff_id"`
	AlternativeVersion int       `json:"alternative_version"`
	TimeZone           string    `json:"time_zone"`
	MinimumMinor       int64     `json:"minimum_savings_minor"`
	SwitchFeeMinor     int64     `json:"switch_fee_minor"`
	Paused             bool      `json:"paused"`
	ExpectedID         int64     `json:"expected_plan_id"`
	Confirmed          bool      `json:"same_site_terms_confirmed"`
}

func monthlyTariffRouter(db *database.DB, now func() time.Time, header string) http.Handler {
	svc := ownershipintelsvc.New(ownershipdb.NewSourceRepository(db), ownershipdb.NewDurableRepository(db))
	tariffs := tariffsvc.NewReviews(tariffdb.NewRepository(db.Pool), nil, now)
	router := chi.NewRouter()
	router.Route("/api/v1", ownershiphandler.NewHandler(svc, header).WithMonthlyTariffReviews(tariffs).MountRoutes)
	return router
}

func seedMonthlyTariff(t *testing.T, now func() time.Time, subjects ...string) (*database.DB, http.Handler, tariffSelection) {
	t.Helper()
	_, db := testRepository(t)
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO vehicles(id,display_name) VALUES (8,'Other synthetic vehicle');
		CREATE TABLE drives (id bigint PRIMARY KEY);
		CREATE TABLE charging_sessions (
			id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz, geofence_id bigint
		);`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"000225_ownership_intelligence.up", "000297_charging_invoice_variance_evidence.up",
		"000299_smart_monthly_tariff_reviews.up", "000304_charging_invoice_review_clear.up"} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, loc)
	noOtherFees := int64(0)
	invoice := ownership.CreateInvoiceRequest{
		VehicleID: 7, Provider: "Synthetic station", InvoiceRef: "synthetic-november", Currency: "USD",
		PeriodStart: from, PeriodEnd: from.AddDate(0, 1, 0), BilledTotalMinor: invoiceAmount(2000),
		VarianceOptions: &ownership.InvoiceVarianceOptions{MaterialAmountMinor: 100, CompleteStatement: true},
	}
	for day := range 4 {
		start := from.AddDate(0, 0, day).Add(30 * time.Minute)
		if _, err := db.Pool.Exec(t.Context(), `
			INSERT INTO charging_sessions (vehicle_id,started_at,ended_at,geofence_id) VALUES (7,$1,$2,9)`,
			start, start.Add(3*time.Hour)); err != nil {
			t.Fatal(err)
		}
		invoice.Lines = append(invoice.Lines, ownership.InvoiceLineInput{
			LineRef: fmt.Sprintf("synthetic-station-%d", day), OccurredAt: start, Location: "Synthetic charging place",
			BilledEnergyWh: 8_000, BilledEnergyMinor: invoiceAmount(500), BilledIdleMinor: &noOtherFees,
			BilledTaxMinor: &noOtherFees, BilledTotalMinor: invoiceAmount(500),
			VarianceEvidence: &ownership.InvoiceVarianceEvidence{BilledBoundary: ownership.MeterBoundaryStation, OtherFeesMinor: &noOtherFees},
		})
	}
	router := monthlyTariffRouter(db, now, "X-Test-Subject")
	price := func(from, until int, amount float64) ownership.TariffRate {
		return ownership.TariffRate{DayMask: 127, StartMinute: from, EndMinute: until, SeasonStartMonth: 1,
			SeasonEndMonth: 12, PriceMinorPerWh: amount}
	}
	if len(subjects) == 0 {
		subjects = []string{mediaOwner}
	}
	var current, alt ownership.Tariff
	for _, owner := range subjects {
		invoiceRequest[ownership.ChargingInvoice](t, router, http.MethodPost, invoiceEndpoint, owner,
			"subject:"+owner, invoice, http.StatusCreated)
		current = createMonthlyTariffFixture(t, router, owner, ownership.CreateTariffRequest{
			Name: "Synthetic current", Currency: "USD", Structure: ownership.TariffFlat, IsCurrent: true,
			StandingChargeMinorPerDay: 30, Rates: []ownership.TariffRate{price(0, 1440, .0625)},
		})
		alt = createMonthlyTariffFixture(t, router, owner, ownership.CreateTariffRequest{
			Name: "Synthetic alternative", Currency: "USD", Structure: ownership.TariffTOU,
			StandingChargeMinorPerDay: 40, Rates: []ownership.TariffRate{price(0, 120, .03125), price(120, 1440, .015625)},
		})
	}
	var revision time.Time
	if err := db.Pool.QueryRow(t.Context(), `SELECT updated_at FROM geofences WHERE id=9`).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	return db, router, tariffSelection{SiteID: 9, SiteRevision: revision, CurrentTariffID: current.ID,
		CurrentVersion: current.Version, AlternativeID: alt.ID, AlternativeVersion: alt.Version,
		TimeZone: "America/New_York", MinimumMinor: 500, SwitchFeeMinor: 200, Confirmed: true}
}

func createMonthlyTariffFixture(t *testing.T, router http.Handler, subject string, tariffInput ownership.CreateTariffRequest) ownership.Tariff {
	t.Helper()
	var result ownership.Tariff
	body, err := json.Marshal(tariffInput)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/tariff-lab/tariffs", bytes.NewReader(body))
	request.Header.Set("X-Test-Subject", subject)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create tariff: got %d: %s", response.Code, response.Body)
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestMonthlyTariffReviewBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	now := monthlyTariffEarly
	clock := func() time.Time { return now }
	db, mounted, selection := seedMonthlyTariff(t, clock, "synthetic-tariff-desktop", "synthetic-tariff-mobile")
	store, source := tariffdb.NewRepository(db.Pool), tariffdb.NewSource(db.Pool)
	var gate sync.Mutex
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		if r.URL.Path == "/api/v1/geofences" && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode([]map[string]any{{
				"id": 9, "name": "Synthetic charging place", "enabled": true, "needs_review": false,
				"is_charging_location": true, "updated_at": selection.SiteRevision,
			}}); err != nil {
				t.Error(err)
			}
			return
		}
		mounted.ServeHTTP(w, r)
	})
	tick := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		var want int
		switch r.URL.Query().Get("phase") {
		case "early":
			now = monthlyTariffEarly
		case "due":
			now, want = monthlyTariffEarly.Add(time.Minute), 1
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		out, err := tariffsvc.NewReviews(store, source, clock).ProcessDue(r.Context(), 4)
		if err != nil || out.Published != want || (want == 0 && len(out.Outcomes) != 0) {
			t.Errorf("expected %d publication(s): %+v %v", want, out, err)
			http.Error(w, "unexpected worker result", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	runPrivateMediaBrowserWithWorker(t, router, "synthetic-tariff", "smart-monthly-tariff-review.smoke.spec.ts",
		"SMART_MONTHLY_TARIFF_REAL_BACKEND", "/__fixture/monthly-tariff-review", tick)
}

func TestMonthlyTariffReviewPublishesPrivateReplay(t *testing.T) {
	now := monthlyTariffEarly
	clock := func() time.Time { return now }
	db, router, selection := seedMonthlyTariff(t, clock)
	store, source := tariffdb.NewRepository(db.Pool), tariffdb.NewSource(db.Pool)
	tick := tariffsvc.NewReviews(store, source, clock)
	if out, err := tick.ProcessDue(t.Context(), 4); err != nil || len(out.Outcomes) != 0 {
		t.Fatalf("opt-out must not evaluate: %+v %v", out, err)
	}
	open := monthlyTariffRouter(db, clock, "")
	invoiceRequest[struct{}](t, open, http.MethodPut, monthlyTariffPath, "", "open", selection, http.StatusForbidden)
	invoiceRequest[tariff.Review](t, router, http.MethodGet, monthlyTariffPath, mediaOwner, "subject:"+mediaOther, nil, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOther, "", selection, http.StatusConflict)
	selection.Confirmed = false
	invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOwner, "", selection, http.StatusBadRequest)
	selection.Confirmed = true
	encoded, err := json.Marshal(selection)
	if err != nil {
		t.Fatal(err)
	}
	var missingFee map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &missingFee); err != nil {
		t.Fatal(err)
	}
	delete(missingFee, "switch_fee_minor")
	invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOwner, "", missingFee, http.StatusBadRequest)
	invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOwner, "", selection, http.StatusNoContent)
	if out, err := tick.ProcessDue(t.Context(), 4); err != nil || len(out.Outcomes) != 0 {
		t.Fatalf("early tick must not evaluate: %+v %v", out, err)
	}
	now = now.Add(time.Minute)
	var wg sync.WaitGroup
	outcomes := make(chan int, 2)
	for range 2 {
		wg.Go(func() {
			out, err := tariffsvc.NewReviews(store, source, clock).ProcessDue(t.Context(), 4)
			if err != nil {
				t.Error(err)
			}
			outcomes <- out.Published
		})
	}
	wg.Wait()
	if total := <-outcomes + <-outcomes; total != 1 {
		t.Fatalf("want exactly one local publication, got %d", total)
	}
	read := func(path, subject string) tariff.Review {
		t.Helper()
		return invoiceRequest[tariff.Review](t, router, http.MethodGet, path, subject, "", nil, http.StatusOK)
	}
	published := read(monthlyTariffPath, mediaOwner)
	if published.Digest == nil || published.Settings == nil || published.Currency != "USD" || published.NeedsReview {
		t.Fatalf("missing published private comparison: %+v", published)
	}
	want := tariff.Comparison{Days: 30, Sessions: 4, EnergyWh: 32_000,
		Current: tariff.CostRange{LowerMinor: 2900, UpperMinor: 2900}, Alternative: tariff.CostRange{LowerMinor: 1700, UpperMinor: 2200},
		CurrentFixedMinor: 900, AltFixedMinor: 1200, SwitchFeeMinor: 200, NetSavings: tariff.CostRange{LowerMinor: 500, UpperMinor: 1000}}
	if published.Digest.Comparison != want || published.Digest.Through.UTC().Format(time.RFC3339) != "2026-12-01T05:00:00Z" {
		t.Fatalf("unexpected replay: %+v", published.Digest)
	}
	for _, other := range []tariff.Review{read(monthlyTariffPath, mediaOther), read(monthlyTariffEndpoint+"?vehicle_id=8", mediaOwner)} {
		if other.Settings != nil || other.Digest != nil {
			t.Fatal("leaked another subject or vehicle's review")
		}
	}
	id := published.Settings.ID
	invoiceRequest[struct{}](t, router, http.MethodPatch, monthlyTariffPath, mediaOwner, "",
		map[string]any{"plan_id": id, "through": published.Digest.Through}, http.StatusNoContent)
	if read(monthlyTariffPath, mediaOwner).Digest != nil {
		t.Fatal("dismissed review must not resurface")
	}
	selection.ExpectedID, selection.Paused, selection.Confirmed = id, true, false
	invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOwner, "", selection, http.StatusNoContent)
	paused := read(monthlyTariffPath, mediaOwner)
	if paused.Settings == nil || !paused.Settings.Paused {
		t.Fatal("review did not pause")
	}
	selection.ExpectedID, selection.Paused, selection.Confirmed = paused.Settings.ID, false, true
	invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOwner, "", selection, http.StatusNoContent)
	if out, err := tick.ProcessDue(t.Context(), 4); err != nil || len(out.Outcomes) != 0 {
		t.Fatalf("resume must not reissue the same month: %+v %v", out, err)
	}
	path := fmt.Sprintf("%s&plan_id=%d", monthlyTariffPath, read(monthlyTariffPath, mediaOwner).Settings.ID)
	invoiceRequest[struct{}](t, router, http.MethodDelete, path, mediaOwner, "", nil, http.StatusNoContent)
	if got := read(monthlyTariffPath, mediaOwner); got.Settings != nil || got.Digest != nil {
		t.Fatal("previous review survived clear")
	}
	var originals int
	if err := db.Pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM charging_invoice_lines)+(SELECT count(*) FROM utility_tariffs)`).Scan(&originals); err != nil || originals != 6 {
		t.Fatalf("clear must not remove upstream bills or tariffs: %d %v", originals, err)
	}
}

func TestMonthlyTariffReviewSuppressesUnqualifiedEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, change string
		outcome      tariff.Outcome
		reconsider   bool
	}{
		{"unassigned charge", `UPDATE charging_sessions SET geofence_id=NULL WHERE id=1`, tariff.InsufficientEvidence, false},
		{"long charge crossing the start", `INSERT INTO charging_sessions (vehicle_id,geofence_id,started_at,ended_at)
			VALUES (7,9,'2026-10-28T05:00:00Z','2026-11-01T06:00:00Z')`, tariff.InsufficientEvidence, false},
		{"open charge from the previous month", `INSERT INTO charging_sessions (vehicle_id,geofence_id,started_at,ended_at)
			VALUES (7,9,'2026-10-28T05:00:00Z',NULL)`, tariff.InsufficientEvidence, false},
		{"extra charges not modeled", `UPDATE charging_invoice_lines SET billed_tax_minor=31,billed_total_minor=531 WHERE id=1`, tariff.InsufficientEvidence, false},
		{"unrecorded tax", `UPDATE charging_invoice_lines SET billed_amount_coverage=3 WHERE id=1`, tariff.InsufficientEvidence, false},
		{"incomplete statement", `UPDATE charging_invoices SET variance_complete_statement=false`, tariff.InsufficientEvidence, false},
		{"unallocated statement discount", `UPDATE charging_invoices SET billed_total_minor=1000`, tariff.InsufficientEvidence, false},
		{"wrong current rate", `UPDATE charging_invoice_lines SET billed_energy_minor=600,billed_total_minor=600 WHERE id=1;
			UPDATE charging_invoices SET billed_total_minor=2100`, tariff.TermsDoNotMatch, false},
		{"tariff terms withdrawn", `DELETE FROM utility_tariffs WHERE NOT is_current`, tariff.UnsupportedTariff, true},
		{"site changed", `UPDATE geofences SET updated_at=updated_at+INTERVAL '1 second' WHERE id=9`, tariff.UnsupportedTariff, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now := monthlyTariffEarly
			clock := func() time.Time { return now }
			db, router, selection := seedMonthlyTariff(t, clock)
			invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOwner, "", selection, http.StatusNoContent)
			if _, err := db.Pool.Exec(t.Context(), tc.change); err != nil {
				t.Fatal(err)
			}
			now = now.Add(time.Minute)
			tick := tariffsvc.NewReviews(tariffdb.NewRepository(db.Pool), tariffdb.NewSource(db.Pool), clock)
			out, err := tick.ProcessDue(t.Context(), 4)
			if err != nil || out.Published != 0 || out.Outcomes[tc.outcome] != 1 {
				t.Fatalf("want suppression %q: %+v %v", tc.outcome, out, err)
			}
			got := invoiceRequest[tariff.Review](t, router, http.MethodGet, monthlyTariffPath, mediaOwner, "", nil, http.StatusOK)
			if got.Digest != nil || got.NeedsReview != tc.reconsider {
				t.Fatalf("must not publish a comparison from unqualified evidence: %+v", got)
			}
		})
	}
}

func TestMonthlyTariffReviewRejectsRevokedLease(t *testing.T) {
	now := monthlyTariffEarly.Add(time.Minute)
	clock := func() time.Time { return now }
	db, router, selection := seedMonthlyTariff(t, clock)
	invoiceRequest[struct{}](t, router, http.MethodPut, monthlyTariffPath, mediaOwner, "", selection, http.StatusNoContent)
	store := tariffdb.NewRepository(db.Pool)
	job, err := store.Claim(t.Context(), now, now.Add(15*time.Minute))
	if err != nil || job == nil {
		t.Fatalf("want claimed review: %+v %v", job, err)
	}
	if err := store.Delete(t.Context(), tariffport.Scope{Subject: mediaOwner, VehicleID: 7}, job.ID); err != nil {
		t.Fatal(err)
	}
	if published, err := store.Finish(t.Context(), *job, now, now.AddDate(0, 1, 0), &tariff.Digest{}); published || err != nil {
		t.Fatalf("revoked work must not publish: %v %v", published, err)
	}
}
