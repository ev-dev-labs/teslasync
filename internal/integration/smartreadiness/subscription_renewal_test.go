package smartreadiness_test

import (
	"fmt"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	renewalsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/subscriptionrenewal"
	"github.com/ev-dev-labs/teslasync/internal/app/smartfeaturesvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	renewaldb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/subscriptionrenewal"
	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	renewal "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/subscriptionrenewal"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	ownershiphandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/subscriptionrenewal"
	"github.com/go-chi/chi/v5"
)

const renewalEndpoint = "/api/v1/subscription-roi/renewal"
const renewalPath = renewalEndpoint + "?vehicle_id=7&subscription_id=1"
const renewalInbox = "/api/v1/action-center?source_feature=subscription_renewal"

var renewalEarly = time.Date(2026, 3, 9, 12, 59, 0, 0, time.UTC)

func renewalRouter(db *database.DB, now func() time.Time, header string) http.Handler {
	svc := ownershipintelsvc.New(ownershipdb.NewSourceRepository(db), ownershipdb.NewDurableRepository(db))
	reviews := renewalsvc.NewReviews(renewaldb.NewRepository(db.Pool), now)
	actions := actionhandler.NewHandler(actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithSubscriptionRenewals(reviews), actioncentersvc.WithClock(now)), header)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		ownershiphandler.NewHandler(svc, header).WithSubscriptionRenewals(reviews).MountRoutes(r)
		r.Get("/action-center", actions.List)
		r.Post("/action-center/{recommendationID}/actions", actions.ApplyAction)
	})
	return router
}

func seedSubscriptionRenewals(t *testing.T, subjects ...string) *database.DB {
	t.Helper()
	_, db := testRepository(t)
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO vehicles(id,display_name) VALUES (8,'Another synthetic vehicle');
		CREATE TABLE drives (
		    id bigint PRIMARY KEY,vehicle_id bigint NOT NULL,started_at timestamptz NOT NULL,
		    ended_at timestamptz,distance_m double precision
		);
		INSERT INTO drives VALUES
		    (801,7,'2026-02-10T02:25:00Z','2026-02-10T03:45:00Z',15000),
		    (802,7,'2026-02-25T10:00:00Z','2026-02-25T10:20:00Z',25500),
		    (803,7,'2026-02-25T10:00:00Z','2026-02-25T10:20:00Z',NULL),
		    (804,7,'2026-03-09T04:00:00Z','2026-03-09T04:30:00Z',90000),
		    (805,8,'2026-03-03T11:00:00Z','2026-03-03T11:20:00Z',65000),
		    (806,7,'2026-03-03T12:00:00Z',NULL,NULL);`); err != nil {
		t.Fatal(err)
	}
	applyWarrantyFixtureMigration(t, db, "000225_ownership_intelligence.up")
	applyWarrantyFixtureMigration(t, db, "000223_action_center_state.up")
	applyWarrantyFixtureMigration(t, db, "000302_smart_subscription_renewals.up")
	for _, owner := range subjects {
		if _, err := db.Pool.Exec(t.Context(), `
			INSERT INTO vehicle_subscriptions
			    (subject,vehicle_id,name,kind,billing_period,price_minor,currency,usage_metric,started_at)
			VALUES ($1,7,'Synthetic travel plan','subscription','monthly',1337,'USD','driving_distance','2026-01-01T05:00:00Z')`,
			owner); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func renewalInput(revision string, day string) map[string]any {
	return map[string]any{"expected_revision": revision, "subscription_version": 1, "confirmed": true,
		"renewal_day": day, "time_zone": "America/New_York", "lead_days": 7}
}

func TestSubscriptionRenewalPublishesOnceWithScopedUsageAndExpires(t *testing.T) {
	now := renewalEarly
	clock := func() time.Time { return now }
	db := seedSubscriptionRenewals(t, mediaOwner)
	router, repo := renewalRouter(db, clock, "X-Test-Subject"), renewaldb.NewRepository(db.Pool)
	read := func() renewalsvc.State {
		t.Helper()
		return invoiceRequest[renewalsvc.State](t, router, http.MethodGet, renewalPath, mediaOwner, "", nil, http.StatusOK)
	}
	inbox := func(path, subject string) []actiondomain.Recommendation {
		t.Helper()
		return invoiceRequest[actiondomain.Response](t, router, http.MethodGet, path, subject, "", nil, http.StatusOK).Items
	}
	run := renewalsvc.NewReviews(repo, clock)
	if state := read(); state.Plan != nil || state.Review != nil {
		t.Fatal("an existing subscription enabled renewal tracking")
	}
	if rows := inbox(renewalInbox, mediaOwner); len(rows) != 0 {
		t.Fatal("Action Center showed a renewal while off")
	}
	if result, err := run.ProcessDue(t.Context(), 5); err != nil || len(result.Outcomes) != 0 {
		t.Fatalf("worker touched a default-off subscription: %+v %v", result, err)
	}
	invoiceRequest[struct{}](t, router, http.MethodGet, renewalPath, mediaOther, "", nil, http.StatusNotFound)
	invoiceRequest[struct{}](t, router, http.MethodGet, renewalEndpoint+"?vehicle_id=8&subscription_id=1", mediaOwner, "", nil, http.StatusNotFound)
	invoiceRequest[struct{}](t, router, http.MethodGet, "/api/v1/subscription-roi/subscriptions?vehicle_id=7", mediaOwner, "subject:"+mediaOther, nil, http.StatusConflict)
	invoiceRequest[struct{}](t, renewalRouter(db, clock, ""), http.MethodPut,
		renewalPath, "", "open", renewalInput("", "2026-03-16"), http.StatusForbidden)
	invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", renewalInput("", "2026-03-16"), http.StatusNoContent)
	if result, err := run.ProcessDue(t.Context(), 5); err != nil || len(result.Outcomes) != 0 {
		t.Fatalf("worker checked before the DST-adjusted local release: %+v %v", result, err)
	}
	now = now.Add(time.Minute)
	var workers sync.WaitGroup
	pubs := make(chan int, 2)
	for range 2 {
		workers.Go(func() {
			result, err := renewalsvc.NewReviews(renewaldb.NewRepository(db.Pool), clock).ProcessDue(t.Context(), 5)
			if err != nil {
				t.Error(err)
			}
			pubs <- result.Published
		})
	}
	workers.Wait()
	if count := <-pubs + <-pubs; count != 1 {
		t.Fatalf("concurrent workers produced %d reviews", count)
	}
	state := read()
	got := state.Review
	if got == nil || got.PriceMinor != 1337 || got.RenewalDay != "2026-03-16" || got.Currency != "USD" ||
		got.Evidence.Coverage != renewal.Observed || got.Evidence.Quantity == nil || *got.Evidence.Quantity != 40_500 ||
		got.Evidence.ObservedDays != 2 || got.Evidence.Excluded != 1 {
		t.Fatalf("review did not limit usage to qualifying records: %+v", got)
	}
	if rows := inbox(renewalInbox+"&vehicle_id=7", mediaOwner); len(rows) != 1 || rows[0].NavigationPath == nil ||
		*rows[0].NavigationPath != "/ownership/subscription-roi?vehicle_id=7&subscription_id=1#private-renewal" {
		t.Fatalf("Action Center did not expose one scoped renewal link: %+v", rows)
	}
	if len(inbox(renewalInbox, mediaOther)) != 0 || len(inbox(renewalInbox+"&vehicle_id=8", mediaOwner)) != 0 {
		t.Fatal("renewal visible in another subject or vehicle scope")
	}
	if open := invoiceRequest[actiondomain.Response](t, renewalRouter(db, clock, ""), http.MethodGet,
		renewalInbox, "", "open", nil, http.StatusOK); len(open.Items) != 0 {
		t.Fatal("renewal visible in shared open mode")
	}
	invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", renewalInput(state.Plan.Revision, "2026-03-16"), http.StatusNoContent)
	if state = read(); state.Review != nil || len(inbox(renewalInbox, mediaOwner)) != 0 {
		t.Fatal("same-date edit bypassed the fresh scheduled check")
	}
	if result, err := run.ProcessDue(t.Context(), 5); err != nil || result.Published != 0 {
		t.Fatalf("same-date edit duplicated the occurrence: %+v %v", result, err)
	}
	if state = read(); state.Review == nil || len(inbox(renewalInbox, mediaOwner)) != 1 {
		t.Fatal("same-date edit did not restore the checked occurrence")
	}
	prefs := smartfeaturesvc.New(featuredb.NewRepository(db.Pool))
	setAllowed := func(allowed bool) {
		t.Helper()
		if err := prefs.Set(t.Context(), mediaOwner, smartfeature.Preference{Feature: smartfeature.RenewalReview, Allowed: allowed}); err != nil {
			t.Fatal(err)
		}
	}
	beforePause := inbox(renewalInbox, mediaOwner)[0].ID
	setAllowed(false)
	if state = read(); state.Plan == nil || state.Review != nil || len(inbox(renewalInbox, mediaOwner)) != 0 {
		t.Fatal("account pause removed setup or left old advice visible")
	}
	if result, err := run.ProcessDue(t.Context(), 5); err != nil || len(result.Outcomes) != 0 {
		t.Fatalf("worker checked a paused renewal: %+v %v", result, err)
	}
	setAllowed(true)
	if state = read(); state.Review != nil {
		t.Fatal("resume displayed a pre-pause decision without a fresh check")
	}
	if result, err := run.ProcessDue(t.Context(), 5); err != nil || result.Published != 1 {
		t.Fatalf("a current renewal did not requalify: %+v %v", result, err)
	}
	if rows := inbox(renewalInbox, mediaOwner); len(rows) != 1 || rows[0].ID != beforePause {
		t.Fatalf("resume duplicated or replaced the renewal occurrence: %+v", rows)
	}
	state = read()
	dismiss := map[string]any{"expected_revision": state.Plan.Revision}
	invoiceRequest[struct{}](t, router, http.MethodPatch, renewalPath, mediaOwner, "", dismiss, http.StatusNoContent)
	invoiceRequest[struct{}](t, router, http.MethodPatch, renewalPath, mediaOwner, "", dismiss, http.StatusConflict)
	state = read()
	if !state.Dismissed || state.Review != nil || len(inbox(renewalInbox, mediaOwner)) != 0 {
		t.Fatal("a dismissed occurrence was still actionable")
	}
	setAllowed(false)
	setAllowed(true)
	if result, err := run.ProcessDue(t.Context(), 5); err != nil || len(result.Outcomes) != 0 || !read().Dismissed {
		t.Fatalf("resume reset the dismissal: %+v %v", result, err)
	}
	invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", renewalInput(state.Plan.Revision, "2026-03-17"), http.StatusNoContent)
	now = now.AddDate(0, 0, 1)
	if result, err := run.ProcessDue(t.Context(), 5); err != nil || result.Published != 1 {
		t.Fatalf("new confirmed renewal date did not publish: %+v %v", result, err)
	}
	state = read()
	now = state.Review.ExpiresAt
	if state = read(); state.Review != nil || len(inbox(renewalInbox, mediaOwner)) != 0 {
		t.Fatal("the card remained visible on the renewal day")
	}
	clear := fmt.Sprintf("%s&expected_revision=%s", renewalPath, state.Plan.Revision)
	invoiceRequest[struct{}](t, router, http.MethodDelete, clear, mediaOwner, "", nil, http.StatusNoContent)
	var records, occurrences int
	if err := db.Pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM vehicle_subscriptions),(SELECT count(*) FROM smart_subscription_renewal_occurrences)`).
		Scan(&records, &occurrences); err != nil || records != 1 || occurrences != 0 {
		t.Fatalf("clear did not preserve the subscription and remove private metadata: %d records, %d reviews, %v", records, occurrences, err)
	}
}

func TestSubscriptionRenewalRejectsChangedVersionAndRevokedLease(t *testing.T) {
	now := renewalEarly.Add(time.Minute)
	db := seedSubscriptionRenewals(t, mediaOwner)
	clock := func() time.Time { return now }
	router, repo := renewalRouter(db, clock, "X-Test-Subject"), renewaldb.NewRepository(db.Pool)
	invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", renewalInput("", "2026-03-16"), http.StatusNoContent)
	job, err := repo.Claim(t.Context(), now, now.Add(5*time.Minute))
	if err != nil || job == nil {
		t.Fatalf("worker could not claim due review: %+v %v", job, err)
	}
	pause := map[string]any{"expected_revision": job.Revision, "subscription_version": 1, "paused": true}
	invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", pause, http.StatusNoContent)
	if sent, err := repo.Finish(t.Context(), *job, now, true); sent || err != nil {
		t.Fatalf("old claim published after pause: %t %v", sent, err)
	}
	if _, err := db.Pool.Exec(t.Context(), `UPDATE vehicle_subscriptions SET price_minor=2010,version=2 WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	state := invoiceRequest[renewalsvc.State](t, router, http.MethodGet, renewalPath, mediaOwner, "", nil, http.StatusOK)
	if !state.NeedsReview || state.Review != nil {
		t.Fatalf("price changed without fresh review consent: %+v", state)
	}
	invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", renewalInput(state.Plan.Revision, "2026-03-16"), http.StatusConflict)
	_, plan, err := repo.Read(t.Context(), port.Scope{Subject: mediaOwner, VehicleID: 7, SubscriptionID: 1})
	if err != nil || plan == nil || !plan.Paused || plan.NextCheckAt != nil {
		t.Fatalf("revoked work changed private settings: %+v %v", plan, err)
	}
	invoiceRequest[struct{}](t, router, http.MethodDelete, fmt.Sprintf("%s&expected_revision=%s", renewalPath, plan.Revision),
		mediaOwner, "", nil, http.StatusNoContent)
	newTerms := renewalInput("", "2026-03-16")
	newTerms["subscription_version"] = 2
	invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", newTerms, http.StatusNoContent)
	staleClear := fmt.Sprintf("%s&expected_revision=%s", renewalPath, job.Revision)
	invoiceRequest[struct{}](t, router, http.MethodDelete, staleClear, mediaOwner, "", nil, http.StatusConflict)
	published, err := repo.Finish(t.Context(), *job, now, true)
	if published || err != nil {
		t.Fatalf("a revoked claim survived clear and re-enrollment: %t %v", published, err)
	}
}

func TestSubscriptionRenewalReenrollmentDoesNotInheritInboxDismissal(t *testing.T) {
	now := renewalEarly.Add(time.Minute)
	clock := func() time.Time { return now }
	db := seedSubscriptionRenewals(t, mediaOwner)
	router := renewalRouter(db, clock, "X-Test-Subject")
	worker := renewalsvc.NewReviews(renewaldb.NewRepository(db.Pool), clock)
	save := func(revision string, wantPublished int) {
		t.Helper()
		invoiceRequest[struct{}](t, router, http.MethodPut, renewalPath, mediaOwner, "", renewalInput(revision, "2026-03-16"), http.StatusNoContent)
		if result, err := worker.ProcessDue(t.Context(), 5); err != nil || result.Published != wantPublished {
			t.Fatalf("check renewal: %+v %v", result, err)
		}
	}
	revision := func() string {
		t.Helper()
		state := invoiceRequest[renewalsvc.State](t, router, http.MethodGet, renewalPath, mediaOwner, "", nil, http.StatusOK)
		if state.Plan == nil {
			t.Fatal("expected scoped renewal plan")
		}
		return state.Plan.Revision
	}
	inbox := func(state string) []actiondomain.Recommendation {
		t.Helper()
		return invoiceRequest[actiondomain.Response](t, router, http.MethodGet, renewalInbox+"&state="+state, mediaOwner, "", nil, http.StatusOK).Items
	}
	save("", 1)
	beforeRollback := revision()
	first := inbox("open")
	if len(first) != 1 {
		t.Fatalf("first enrollment: %+v", first)
	}
	dismissPath := "/api/v1/action-center/" + first[0].ID + "/actions"
	dismiss := map[string]any{
		"action": "dismiss", "confirmed": true, "fingerprint": first[0].Fingerprint, "expected_version": first[0].CurrentState.Version,
	}
	invoiceRequest[actiondomain.ActionResult](t, router, http.MethodPost, dismissPath, mediaOwner, "", dismiss, http.StatusOK)

	save(revision(), 0)
	if rows := inbox("dismissed"); len(rows) != 1 || rows[0].ID != first[0].ID || len(inbox("open")) != 0 {
		t.Fatalf("a same-date edit changed the existing dismissal: %+v", rows)
	}
	clear := fmt.Sprintf("%s&expected_revision=%s", renewalPath, revision())
	invoiceRequest[struct{}](t, router, http.MethodDelete, clear, mediaOwner, "", nil, http.StatusNoContent)
	save("", 1)
	second := inbox("open")
	if len(second) != 1 || second[0].ID == first[0].ID || len(inbox("dismissed")) != 0 {
		t.Fatalf("same-date re-enrollment inherited the deleted occurrence's dismissal: %+v", second)
	}
	invoiceRequest[struct{}](t, router, http.MethodPost, dismissPath, mediaOwner, "", dismiss, http.StatusNotFound)

	applyWarrantyFixtureMigration(t, db, "000302_smart_subscription_renewals.down")
	applyWarrantyFixtureMigration(t, db, "000302_smart_subscription_renewals.up")
	reset := invoiceRequest[renewalsvc.State](t, router, http.MethodGet, renewalPath, mediaOwner, "", nil, http.StatusOK)
	if reset.Plan != nil || len(inbox("open")) != 0 || len(inbox("dismissed")) != 0 {
		t.Fatal("migration rollback left derived consent or occurrences behind")
	}
	save("", 1)
	staleClear := fmt.Sprintf("%s&expected_revision=%s", renewalPath, beforeRollback)
	invoiceRequest[struct{}](t, router, http.MethodDelete, staleClear, mediaOwner, "", nil, http.StatusConflict)
	afterRollback := inbox("open")
	if len(afterRollback) != 1 || afterRollback[0].ID == first[0].ID || afterRollback[0].ID == second[0].ID {
		t.Fatalf("migration retry reused an old inbox identity: %+v", afterRollback)
	}
	invoiceRequest[struct{}](t, router, http.MethodPost, dismissPath, mediaOwner, "", dismiss, http.StatusNotFound)
}

func TestSubscriptionRenewalBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	db := seedSubscriptionRenewals(t, "synthetic-renewal-desktop", "synthetic-renewal-mobile")
	now := renewalEarly
	clock := func() time.Time { return now }
	mounted := renewalRouter(db, clock, "X-Test-Subject")
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
			now = renewalEarly
		case "due":
			now, want = renewalEarly.Add(time.Minute), 1
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		got, err := renewalsvc.NewReviews(renewaldb.NewRepository(db.Pool), clock).ProcessDue(r.Context(), 4)
		if err != nil || got.Published != want || (want == 0 && len(got.Outcomes) != 0) {
			t.Errorf("expected %d publication(s): %+v %v", want, got, err)
			http.Error(w, "unexpected worker result", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	runPrivateMediaBrowserWithWorker(t, router, "synthetic-renewal", "smart-subscription-renewal.smoke.spec.ts",
		"SMART_SUBSCRIPTION_RENEWAL_REAL_BACKEND", "/__fixture/subscription-renewal", tick)
}
