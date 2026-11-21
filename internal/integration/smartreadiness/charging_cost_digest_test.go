package smartreadiness_test

import (
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	costsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/costtrend"
	"github.com/ev-dev-labs/teslasync/internal/database"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	costdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/costtrend"
	costdomain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/costtrend"
	ownershiphandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
	costport "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/costtrend"
)

const costDigestPath = "/api/v1/analytics/tco/charging-cost-digest"

func chargingCostDigestRouter(db *database.DB, reviews *costsvc.Reviews) http.Handler {
	ownership := ownershipintelsvc.New(ownershipdb.NewSourceRepository(db), ownershipdb.NewDurableRepository(db))
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		ownershiphandler.NewHandler(ownership, "X-Test-Subject").WithChargingCostReviews(reviews).MountRoutes(r)
	})
	return router
}

func TestChargingCostDigestBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	db := seedChargingCostDigest(t)
	setup := time.Date(2026, 11, 2, 13, 59, 0, 0, time.UTC)
	now := setup
	clock := func() time.Time { return now }
	store, source := costdb.NewRepository(db.Pool), costdb.NewSource(db.Pool)
	mounted := chargingCostDigestRouter(db, costsvc.NewReviews(store, nil, clock))
	var gate sync.Mutex
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		mounted.ServeHTTP(w, r)
	})
	tick := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		var want int
		switch r.URL.Query().Get("phase") {
		case "early":
			now = setup
		case "due":
			now, want = setup.Add(time.Minute), 1
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		batch, err := costsvc.NewReviews(store, source, clock).ProcessDue(r.Context(), 4)
		if err != nil || batch.Published != want || (want == 0 && len(batch.Outcomes) != 0) {
			t.Errorf("expected %d publication(s): %+v %v", want, batch, err)
			http.Error(w, "unexpected worker result", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	runPrivateMediaBrowserWithWorker(t, router, "synthetic-cost", "smart-charging-cost-digest.smoke.spec.ts",
		"SMART_CHARGING_COST_REAL_BACKEND", "/__fixture/charging-cost-digest", tick)
}

func seedChargingCostDigest(t *testing.T) *database.DB {
	t.Helper()
	_, db := testRepository(t)
	if _, err := db.Pool.Exec(t.Context(), `
		ALTER TABLE vehicles ADD COLUMN vin text;
		UPDATE vehicles SET vin='SYNTHETIC-COST-VEHICLE' WHERE id=7;
		INSERT INTO vehicles(id,display_name,vin) VALUES (8,'Other synthetic vehicle','SYNTHETIC-OTHER-COST');
		INSERT INTO geofences(id,name,enabled,needs_review,is_charging_location)
			VALUES (10,'Second synthetic site',true,false,true);
		CREATE TABLE drives (
			id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz,
			distance_m double precision,start_odometer_m double precision,end_odometer_m double precision
		);
		CREATE TABLE charging_sessions (
			id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			vehicle_id bigint NOT NULL,started_at timestamptz NOT NULL,ended_at timestamptz,
			geofence_id bigint,start_place text,total_energy_added_wh double precision
		);`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"000110_add_tesla_charging_history.up", "000191_tesla_charging_history_si.up",
		"000225_ownership_intelligence.up", "000297_charging_invoice_variance_evidence.up", "000298_smart_charging_cost_digests.up",
		"000304_charging_invoice_review_clear.up"} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	for index, month := range []time.Month{time.September, time.October} {
		amount := float64(index+1) * 40_000
		first := time.Date(2026, month, 5, 15, 0, 0, 0, time.UTC)
		if _, err := db.Pool.Exec(t.Context(), `
			INSERT INTO drives(vehicle_id,started_at,ended_at,distance_m,start_odometer_m,end_odometer_m)
			VALUES (7,$1::timestamptz,$1::timestamptz+INTERVAL '1 hour',$2::float8,200000,200000+$2::float8),
			       (7,$1::timestamptz+INTERVAL '7 days',$1::timestamptz+INTERVAL '7 days 1 hour',$2::float8,200000+$2::float8,200000+2*$2::float8)`,
			first, amount); err != nil {
			t.Fatal(err)
		}
		for i := range 4 {
			start := first.AddDate(0, 0, 1+i)
			site, name, energy, cost := 9, "Synthetic charging place", 10_000., 1.
			if i >= 2 {
				site, name, cost = 10, "Second synthetic site", 3
			}
			if index == 1 {
				cost = 1.5
				if i >= 2 {
					energy, cost = 30_000, 10.5
				}
			}
			var id int
			if err := db.Pool.QueryRow(t.Context(), `
				INSERT INTO charging_sessions(vehicle_id,started_at,ended_at,geofence_id,start_place,total_energy_added_wh)
				VALUES (7,$1::timestamptz,$1::timestamptz+INTERVAL '30 minutes',$2,$3,750) RETURNING id`,
				start, site, name).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Pool.Exec(t.Context(), `
				INSERT INTO tesla_charging_history(session_id,vin,charge_start_datetime,charge_stop_datetime,total_due,currency_code,fee_type,pricing_type,has_invoice,usage_wh)
				VALUES ($1,'SYNTHETIC-COST-VEHICLE',$2::timestamptz,$2::timestamptz+INTERVAL '30 minutes',$3,'USD','CHARGING','PER_KWH',true,$4)`,
				id, start, cost, energy); err != nil {
				t.Fatal(err)
			}
		}
	}
	return db
}

func TestChargingCostDigestPublishesPrivateCompletedMonths(t *testing.T) {
	db := seedChargingCostDigest(t)
	now := time.Date(2026, time.November, 2, 13, 59, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	store := costdb.NewRepository(db.Pool)
	source := costdb.NewSource(db.Pool)
	reviews := costsvc.NewReviews(store, nil, clock)
	newWorker := func() *costsvc.Reviews { return costsvc.NewReviews(store, source, clock) }
	router := chargingCostDigestRouter(db, reviews)
	path := costDigestPath + "?vehicle_id=7"
	read := func(path, subject string) costdomain.Review {
		t.Helper()
		return invoiceRequest[costdomain.Review](t, router, http.MethodGet, path, subject, "subject:"+subject, nil, http.StatusOK)
	}
	tick := func(want int) costsvc.Batch {
		t.Helper()
		batch, err := newWorker().ProcessDue(t.Context(), 4)
		if err != nil || batch.Published != want {
			t.Fatalf("want %d publications, got %+v: %v", want, batch, err)
		}
		return batch
	}
	if off := read(path, mediaOwner); off.Settings != nil || off.Digest != nil {
		t.Fatalf("fresh install not off: %+v", off)
	}
	if batch := tick(0); len(batch.Outcomes) != 0 {
		t.Fatalf("an opted-out vehicle was evaluated: %+v", batch)
	}
	config := map[string]any{
		"expected_plan_id": 0, "time_zone": "America/New_York", "currency": "USD",
		"material_change_minor": 100, "local_review_confirmed": true,
	}
	invoiceRequest[struct{}](t, router, http.MethodPut, path, mediaOwner, "subject:"+mediaOwner, config, http.StatusNoContent)
	if batch := tick(0); len(batch.Outcomes) != 0 {
		t.Fatalf("digest ran before the local release following DST: %+v", batch)
	}
	now = now.Add(time.Minute)
	tick(1)
	got := read(path, mediaOwner)
	if got.Settings == nil || got.Digest == nil || got.Digest.Through.UTC().Format(time.RFC3339) != "2026-11-01T04:00:00Z" {
		t.Fatalf("want digest for the prior two completed local months: %+v", got)
	}
	a := got.Digest.Attribution
	if a.Current.RecordedSpendMinor != 2400 || a.Prior.RecordedSpendMinor != 800 ||
		a.DistanceMinor != 1000 || a.SiteMixMinor != 300 || a.EffectivePriceMinor != 300 || a.PurchaseIntensityMinor != 0 {
		t.Fatalf("mounted digest must use observed bill energy, never SoC-derived numbers: %+v", a)
	}
	if other := read(path, mediaOther); other.Settings != nil || other.Digest != nil {
		t.Fatalf("same vehicle exposed another subject's review: %+v", other)
	}
	if other := read(costDigestPath+"?vehicle_id=8", mediaOwner); other.Settings != nil || other.Digest != nil {
		t.Fatalf("wrong vehicle exposed a review: %+v", other)
	}
	invoiceRequest[struct{}](t, router, http.MethodGet, path, mediaOwner, "subject:"+mediaOther, nil, http.StatusConflict)
	tick(0)
	invoiceRequest[struct{}](t, router, http.MethodPatch, path, mediaOwner, "", map[string]any{
		"plan_id": got.Settings.ID, "through": got.Digest.Through,
	}, http.StatusNoContent)
	if dismissed := read(path, mediaOwner); dismissed.Digest != nil {
		t.Fatalf("dismissed digest resurfaced: %+v", dismissed.Digest)
	}
	config["expected_plan_id"], config["paused"] = got.Settings.ID, true
	invoiceRequest[struct{}](t, router, http.MethodPut, path, mediaOwner, "", config, http.StatusNoContent)
	paused := read(path, mediaOwner)
	if paused.Settings == nil || !paused.Settings.Paused || paused.Digest != nil {
		t.Fatalf("want no digest after pause: %+v", paused)
	}
	config["expected_plan_id"], config["paused"] = paused.Settings.ID, false
	invoiceRequest[struct{}](t, router, http.MethodPut, path, mediaOwner, "", config, http.StatusNoContent)
	tick(0)
	resumed := read(path, mediaOwner)
	deletePath := fmt.Sprintf("%s&plan_id=%d", path, resumed.Settings.ID)
	invoiceRequest[struct{}](t, router, http.MethodDelete, deletePath, mediaOther, "", nil, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodDelete, deletePath, mediaOwner, "", nil, http.StatusNoContent)
	if cleared := read(path, mediaOwner); cleared.Settings != nil || cleared.Digest != nil {
		t.Fatalf("clear left derived data: %+v", cleared)
	}
}

func TestChargingCostDigestSuppressesAmbiguousBillingAndRevokedLease(t *testing.T) {
	db := seedChargingCostDigest(t)
	now := time.Date(2026, time.November, 2, 15, 0, 0, 0, time.UTC)
	store, source := costdb.NewRepository(db.Pool), costdb.NewSource(db.Pool)
	clock := func() time.Time { return now }
	worker := costsvc.NewReviews(store, source, clock)
	scope := costport.Scope{Subject: mediaOwner, VehicleID: 7}
	settings := costdomain.Settings{TimeZone: "UTC", Currency: "USD", MaterialChangeMinor: 100}
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO tesla_charging_history(session_id,vin,charge_start_datetime,charge_stop_datetime,total_due,currency_code,fee_type,pricing_type,has_invoice,usage_wh)
		SELECT 999,vin,charge_start_datetime,charge_stop_datetime,total_due,currency_code,fee_type,pricing_type,has_invoice,usage_wh
		FROM tesla_charging_history WHERE session_id=1`); err != nil {
		t.Fatal(err)
	}

	if err := worker.Save(t.Context(), scope, settings); err != nil {
		t.Fatal(err)
	}
	batch, err := worker.ProcessDue(t.Context(), 4)
	if err != nil || batch.Published != 0 || batch.Outcomes[costdomain.InsufficientCoverage] != 1 {
		t.Fatalf("ambiguous receipt must reduce coverage instead of duplicating spend: %+v %v", batch, err)
	}
	current, err := worker.Read(t.Context(), scope)
	if err != nil || current.Settings == nil || current.Digest != nil {
		t.Fatalf("want checked plan with no card: %+v %v", current, err)
	}
	now = now.AddDate(0, 1, 0)
	job, err := store.Claim(t.Context(), now, now.Add(15*time.Minute))
	if err != nil || job == nil {
		t.Fatalf("want due plan: %+v %v", job, err)
	}
	if another, err := store.Claim(t.Context(), now, now.Add(15*time.Minute)); err != nil || another != nil {
		t.Fatalf("same lease claimed twice: %+v %v", another, err)
	}
	if err := worker.Delete(t.Context(), scope, current.Settings.ID); err != nil {
		t.Fatal(err)
	}
	if published, err := store.Finish(t.Context(), *job, now, now.AddDate(0, 1, 0), &costdomain.Digest{}); err != nil || published {
		t.Fatalf("revoked lease must not publish: %v %v", published, err)
	}
}

func TestChargingCostDigestDoesNotTreatTimeBilledUsageAsEnergy(t *testing.T) {
	db := seedChargingCostDigest(t)
	if _, err := db.Pool.Exec(t.Context(), `
		UPDATE tesla_charging_history SET pricing_type='PER_MINUTE' WHERE session_id=1`); err != nil {
		t.Fatal(err)
	}
	source := costdb.NewSource(db.Pool)
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	prior, current, err := source.ReadCostPeriods(t.Context(), mediaOwner, 7, "USD", from, from.AddDate(0, 1, 0), from.AddDate(0, 2, 0))
	if err != nil {
		t.Fatal(err)
	}
	knownTimeCharge := false
	for _, row := range prior.Sessions {
		if row.CostMinor != nil && *row.CostMinor == 100 && row.BilledEnergyWh == nil {
			knownTimeCharge = true
		}
	}
	if !knownTimeCharge {
		t.Fatalf("time billed session must count only as known spend: %+v", prior.Sessions)
	}
	if result, reason := costdomain.Compare(prior, current, "USD", 100); result != nil || reason != costdomain.InsufficientCoverage {
		t.Fatalf("time billed usage cannot qualify as energy: %+v %s", result, reason)
	}
}

func TestChargingCostDigestDoesNotSelectAQualifiedBillOverIncompleteCompetitor(t *testing.T) {
	db := seedChargingCostDigest(t)
	ctx := t.Context()
	if _, err := db.Pool.Exec(ctx, `
			WITH invoice AS (
				INSERT INTO charging_invoices
				  (subject, vehicle_id, provider, invoice_ref, currency, period_start, period_end,
				   billed_total_minor, variance_threshold_minor, variance_complete_statement)
				VALUES ($1,7,'Synthetic competing provider','review-1','USD',
				        '2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',2000,100,true) RETURNING id
			)
			INSERT INTO charging_invoice_lines
			  (invoice_id, occurred_at, location, billed_energy_wh, billed_energy_minor, billed_idle_minor, billed_total_minor,
			   billed_amount_coverage, review_billed_boundary, review_other_fees_minor)
			SELECT invoice.id, c.started_at, c.start_place, 10000, 2000, 0, 2000, 3, 'station', 0
			FROM invoice CROSS JOIN charging_sessions c WHERE c.id=1`, mediaOwner); err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	prior, current, err := costdb.NewSource(db.Pool).ReadCostPeriods(ctx, mediaOwner, 7, "USD", start,
		start.AddDate(0, 1, 0), start.AddDate(0, 2, 0))
	if err != nil {
		t.Fatal(err)
	}
	if result, reason := costdomain.Compare(prior, current, "USD", 100); result != nil || reason != costdomain.InsufficientCoverage {
		t.Fatalf("the unrecorded tax on a competing bill cannot make the cheaper bill unambiguous: %+v %s", result, reason)
	}
	if _, err := db.Pool.Exec(ctx, `DELETE FROM charging_invoices WHERE subject=$1`, mediaOwner); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO tesla_charging_history(session_id,vin,charge_start_datetime,fee_type,has_invoice)
		SELECT 999,vin,charge_start_datetime,'CHARGING',false
		FROM tesla_charging_history WHERE session_id=1`); err != nil {
		t.Fatal(err)
	}
	prior, current, err = costdb.NewSource(db.Pool).ReadCostPeriods(ctx, mediaOwner, 7, "USD", start,
		start.AddDate(0, 1, 0), start.AddDate(0, 2, 0))
	if err != nil {
		t.Fatal(err)
	}
	if result, reason := costdomain.Compare(prior, current, "USD", 100); result != nil || reason != costdomain.InsufficientCoverage {
		t.Fatalf("a competing Tesla record with no invoice or stop time must reduce coverage: %+v %s", result, reason)
	}
}
