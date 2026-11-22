package smartreadiness_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const recallWatchEndpoint = "/api/v1/service-intelligence/recall-watch?vehicle_id=7"
const recallWatchInbox = "/api/v1/action-center?vehicle_id=7&source_feature=recall_watch"
const testRecallRemedy = "The manufacturer will replace the synthetic latch free of charge."
const testRecallCampaign = "26V123000"

type recallWatchSubmission struct {
	domain.RecallWatchSetup
	ExpectedID     int64 `json:"expected_watch_id"`
	ModelConfirmed bool  `json:"model_confirmed"`
	NHTSAConfirmed bool  `json:"nhtsa_confirmed"`
}

func recallWatchFixtures(t *testing.T, runCatalog http.HandlerFunc) (*readinessdb.Repository, *database.DB, *nhtsa.Client) {
	t.Helper()
	repo, db := testRepository(t)
	for _, name := range []string{"000223_action_center_state.up", "000281_smart_recall_watch.up"} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	server := httptest.NewServer(runCatalog)
	t.Cleanup(server.Close)
	return repo, db, nhtsa.NewClient(nhtsa.Config{SafetyBaseURL: server.URL, VPICBaseURL: server.URL})
}

func recallWatchRouter(repo *readinessdb.Repository, db *database.DB, watch *smartreadinesssvc.RecallWatch, header string, clock func() time.Time) http.Handler {
	readiness := smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}, smartreadinesssvc.WithClock(clock))
	recommendations := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithRecallWatch(watch), actioncentersvc.WithClock(clock))
	actions := actionhandler.NewHandler(recommendations, header)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(readiness, header, readinesshandler.WithRecallWatch(watch)).MountRoutes(r)
		r.Route("/service-intelligence", func(r chi.Router) {
			r.Get("/vehicles/{vehicleID}", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNotImplemented)
			})
		})
		r.Get("/action-center", actions.List)
		r.Post("/action-center/{recommendationID}/actions", actions.ApplyAction)
	})
	return router
}

func recallCatalogResponse(t *testing.T, w http.ResponseWriter, r *http.Request, now time.Time) {
	t.Helper()
	query := r.URL.Query()
	want := url.Values{"make": {"Tesla"}, "model": {query.Get("model")}, "modelYear": {"2024"}}
	if r.Method != http.MethodGet || r.URL.Path != "/recalls/recallsByVehicle" || r.URL.RawQuery != want.Encode() ||
		(query.Get("model") != "Model Y" && query.Get("model") != "Model 3") ||
		r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
		t.Errorf("unexpected recall request: %s %s", r.Method, r.URL)
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	matching := map[string]any{
		"Make": "TESLA", "Model": "MODEL Y", "ModelYear": "2024", "NHTSACampaignNumber": testRecallCampaign,
		"Component": "SYNTHETIC LATCH", "Remedy": testRecallRemedy, "parkIt": true,
		"ReportReceivedDate": now.Add(-24 * time.Hour).Format(time.RFC3339),
	}
	mismatch := map[string]any{
		"Make": "TESLA", "Model": "MODEL 3", "ModelYear": "2023", "NHTSACampaignNumber": "26V999000",
		"Component": "WRONG MODEL YEAR", "Remedy": "Synthetic wrong-year action", "parkIt": true,
		"ReportReceivedDate": now.Add(-12 * time.Hour).Format(time.RFC3339),
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(map[string]any{"Count": 3, "results": []map[string]any{matching, mismatch, matching}}); err != nil {
		t.Errorf("encode local recall response: %v", err)
	}
}

func TestRecallWatchUsesOnlyConsentedModelYearAndScopesPrivateCampaign(t *testing.T) {
	var calls atomic.Int32
	var offset atomic.Int64
	var unavailable atomic.Bool
	var incomplete atomic.Bool
	clock := func() time.Time { return time.Now().UTC().Add(time.Duration(offset.Load())) }
	repo, db, client := recallWatchFixtures(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if unavailable.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if incomplete.Load() {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			if _, err := w.Write([]byte(`{"Count":1}`)); err != nil {
				t.Error(err)
			}
			return
		}
		recallCatalogResponse(t, w, r, time.Now().UTC())
	})
	watch := smartreadinesssvc.NewRecallWatch(repo, client, clock)
	router := recallWatchRouter(repo, db, watch, "X-Test-Subject", clock)
	open := recallWatchRouter(repo, db, watch, "", clock)
	const owner = "synthetic-recall-owner"
	const other = "synthetic-recall-peer"
	call := func(handler http.Handler, method, path, subject string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Test-Subject", subject)
		expected := "subject:" + subject
		if subject == "" {
			expected = "open"
		}
		r.Header.Set("X-TeslaSync-Expected-Principal", expected)
		resp := httptest.NewRecorder()
		handler.ServeHTTP(resp, r)
		if resp.Code != status || resp.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d (%s), want %d no-store: %s", method, path, resp.Code, resp.Header().Get("Cache-Control"), status, resp.Body)
		}
		return resp
	}
	read := func(subject string) domain.RecallWatch {
		t.Helper()
		var payload struct{ Data domain.RecallWatch }
		if err := json.Unmarshal(call(router, http.MethodGet, recallWatchEndpoint, subject, nil, 200).Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Data
	}
	inbox := func(subject string) []actiondomain.Recommendation {
		t.Helper()
		var payload actiondomain.Response
		if err := json.Unmarshal(call(router, http.MethodGet, recallWatchInbox, subject, nil, 200).Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Items
	}
	run := func(expectedCalls int32, published int, outcomes map[domain.RecallWatchOutcome]int) {
		t.Helper()
		batch, err := watch.ProcessDue(t.Context(), 5)
		if err != nil || batch.Published != published || calls.Load() != expectedCalls {
			t.Fatalf("check: %+v, %v; actual HTTP calls %d; expected %d", batch, err, calls.Load(), expectedCalls)
		}
		for outcome, count := range outcomes {
			if batch.Outcomes[outcome] != count {
				t.Fatalf("want %s = %d: %+v", outcome, count, batch)
			}
		}
	}

	if read(owner).ID != 0 || len(inbox(owner)) != 0 {
		t.Fatal("fresh install is not off")
	}
	setup := recallWatchSubmission{
		RecallWatchSetup: domain.RecallWatchSetup{Model: "Model Y", ModelYear: 2024}, ModelConfirmed: true,
	}
	call(open, http.MethodPut, recallWatchEndpoint, "", setup, 403)
	call(router, http.MethodPut, recallWatchEndpoint, owner, setup, 400)
	run(0, 0, nil)
	setup.NHTSAConfirmed = true
	call(router, http.MethodPut, recallWatchEndpoint, owner, setup, 204)
	current := read(owner)
	if current.ID == 0 || current.LastSuccess != nil || len(inbox(owner)) != 0 || calls.Load() != 0 {
		t.Fatal("saving consent must not contact the catalog or seed a card")
	}
	peerSetup := setup
	peerSetup.Model = "Model 3"
	call(router, http.MethodPut, recallWatchEndpoint, other, peerSetup, 204)
	run(2, 1, map[domain.RecallWatchOutcome]int{domain.RecallWatchMatched: 1, domain.RecallWatchNoMatch: 1})
	result, items := read(owner), inbox(owner)
	if len(result.Matches) != 1 || result.Matches[0].Campaign != testRecallCampaign || result.Matches[0].Remedy != testRecallRemedy ||
		result.Matches[0].VerifyVINURL != domain.RecallVerificationURL ||
		len(items) != 1 || items[0].NavigationPath == nil || *items[0].NavigationPath != "/maintenance?vehicle_id=7#recall-watch" ||
		len(inbox(other)) != 0 || len(read(other).Matches) != 0 {
		t.Fatalf("watch did not produce the private exact model-year match: %+v, %+v", result, items)
	}
	if items[0].Evidence[0].RecallWatchMatch == nil || items[0].Evidence[0].RecallWatchMatch.Campaign != testRecallCampaign {
		t.Fatal("matched campaign evidence was lost from the inbox")
	}
	run(2, 0, nil)
	del := recallWatchEndpoint + "&watch_id=" + strconv.FormatInt(result.ID, 10)
	call(router, http.MethodDelete, del, other, nil, 409)
	if len(inbox(owner)) != 1 {
		t.Fatal("a different owner removed the watch")
	}
	offset.Store(int64(25 * time.Hour))
	incomplete.Store(true)
	run(4, 0, map[domain.RecallWatchOutcome]int{domain.RecallWatchUnavailable: 2})
	if stale := read(owner); !stale.LastFailed || len(stale.Matches) != 1 || len(inbox(owner)) != 1 {
		t.Fatalf("an incomplete result must not clear current evidence: %+v", stale)
	}
	incomplete.Store(false)
	offset.Store(int64(27 * time.Hour))
	run(6, 0, map[domain.RecallWatchOutcome]int{domain.RecallWatchMatched: 1, domain.RecallWatchNoMatch: 1})
	if refreshed := inbox(owner); len(refreshed) != 1 || refreshed[0].ID != items[0].ID {
		t.Fatal("a fresh recheck duplicated the decision")
	}
	offset.Store(int64(52 * time.Hour))
	unavailable.Store(true)
	run(8, 0, map[domain.RecallWatchOutcome]int{domain.RecallWatchUnavailable: 2})
	if stale := read(owner); !stale.LastFailed || len(stale.Matches) != 0 || len(inbox(owner)) != 0 {
		t.Fatalf("expired provider evidence stayed actionable: %+v", stale)
	}
	call(router, http.MethodDelete, del, owner, nil, 204)
	setup.ExpectedID = current.ID
	call(router, http.MethodPut, recallWatchEndpoint, owner, setup, 409)
	call(router, http.MethodDelete, recallWatchEndpoint+"&watch_id="+strconv.FormatInt(read(other).ID, 10), other, nil, 204)
	offset.Store(int64(73 * time.Hour))
	run(8, 0, nil)
	applyWarrantyFixtureMigration(t, db, "000281_smart_recall_watch.down")
	applyWarrantyFixtureMigration(t, db, "000281_smart_recall_watch.up")
	if read(owner).ID != 0 {
		t.Fatal("down/up reapplied a private watch")
	}
}

type recallWatchClaimBoundary struct {
	*readinessdb.Repository
	onClaim func()
}

func (r recallWatchClaimBoundary) ClaimRecallWatch(ctx context.Context, now, lease time.Time) (*port.DueRecallWatch, error) {
	job, err := r.Repository.ClaimRecallWatch(ctx, now, lease)
	if job != nil && err == nil {
		r.onClaim()
	}
	return job, err
}

func TestRecallWatchWithdrawalInvalidatesClaimAndInFlightResponse(t *testing.T) {
	var calls atomic.Int32
	var afterDispatch atomic.Value
	repo, _, client := recallWatchFixtures(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if revoke, ok := afterDispatch.Load().(func()); ok {
			revoke()
		}
		recallCatalogResponse(t, w, r, time.Now().UTC())
	})
	watch := smartreadinesssvc.NewRecallWatch(repo, client, time.Now)
	scope := port.RecallWatchScope{Subject: "synthetic-recall-revoke", VehicleID: 7}
	enable := func() int64 {
		t.Helper()
		if err := watch.Enable(t.Context(), scope, 0, domain.RecallWatchSetup{Model: "Model Y", ModelYear: 2024}); err != nil {
			t.Fatal(err)
		}
		state, err := watch.Read(t.Context(), scope)
		if err != nil || state.ID == 0 {
			t.Fatalf("record watch: %+v, %v", state, err)
		}
		return state.ID
	}
	revoke := func(id int64) {
		if err := watch.Disable(t.Context(), scope, id); err != nil {
			t.Errorf("revoke consent: %v", err)
		}
	}
	check := func(service *smartreadinesssvc.RecallWatch, wantCalls int32) {
		t.Helper()
		batch, err := service.ProcessDue(t.Context(), 5)
		if err != nil || batch.Published != 0 || batch.Outcomes[domain.RecallWatchChanged] != 1 || calls.Load() != wantCalls {
			t.Fatalf("work survived revocation: %+v, %v; requests %d", batch, err, calls.Load())
		}
		result, err := watch.Read(t.Context(), scope)
		if err != nil || result.ID != 0 || len(result.Matches) != 0 {
			t.Fatalf("deleted enrollment was restored: %+v, %v", result, err)
		}
	}

	first := enable()
	afterDispatch.Store(func() { t.Error("revoked claim contacted NHTSA") })
	worker := smartreadinesssvc.NewRecallWatch(recallWatchClaimBoundary{
		Repository: repo, onClaim: func() { revoke(first) },
	}, client, time.Now)
	check(worker, 0)
	second := enable()
	afterDispatch.Store(func() { revoke(second) })
	check(watch, 1)
}

func TestSmartFeaturePauseFencesRecallWithoutRemovingWatch(t *testing.T) {
	var calls atomic.Int32
	var afterDispatch atomic.Value
	repo, db, client := recallWatchFixtures(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if change, ok := afterDispatch.Load().(func()); ok {
			change()
		}
		recallCatalogResponse(t, w, r, time.Now().UTC())
	})
	prefs := featuredb.NewRepository(db.Pool)
	scope := port.RecallWatchScope{Subject: "synthetic-paused-watch", VehicleID: 7}
	setAllowed := func(allowed bool) {
		t.Helper()
		if err := prefs.SetPreference(t.Context(), scope.Subject, smartfeature.Preference{Feature: smartfeature.RecallWatch, Allowed: allowed}); err != nil {
			t.Error(err)
		}
	}
	base := time.Now().UTC()
	now := base
	watch := smartreadinesssvc.NewRecallWatch(repo, client, func() time.Time { return now })
	if err := watch.Enable(t.Context(), scope, 0, domain.RecallWatchSetup{Model: "Model Y", ModelYear: 2024}); err != nil {
		t.Fatal(err)
	}
	read := func(wantMatches int) int64 {
		t.Helper()
		state, err := watch.Read(t.Context(), scope)
		if err != nil || state.ID == 0 || state.Setup.Model != "Model Y" || len(state.Matches) != wantMatches {
			t.Fatalf("unexpected watch after permission change: %+v, %v", state, err)
		}
		return state.ID
	}
	run := func(wantCalls int32, wantChanged int) {
		t.Helper()
		batch, err := watch.ProcessDue(t.Context(), 1)
		if err != nil || calls.Load() != wantCalls || batch.Outcomes[domain.RecallWatchChanged] != wantChanged {
			t.Fatalf("unexpected check: %+v, %v; calls %d", batch, err, calls.Load())
		}
	}
	id := read(0)
	setAllowed(false)
	run(0, 0)
	setAllowed(true)
	now = base.Add(time.Hour)
	run(1, 0)
	read(1)
	setAllowed(false)
	read(0)
	setAllowed(true)
	read(0)
	now = base.Add(26 * time.Hour)
	afterDispatch.Store(func() { setAllowed(false); setAllowed(true) })
	run(2, 1)
	if read(0) != id {
		t.Fatal("pausing replaced the existing watch")
	}
	afterDispatch.Store(func() {})
	now = base.Add(28 * time.Hour)
	run(3, 0)
	read(1)
}

func TestPrivateRecallBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_RECALL_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_RECALL_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	var calls atomic.Int32
	repo, db, catalog := recallWatchFixtures(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		recallCatalogResponse(t, w, r, time.Now().UTC())
	})
	watch := smartreadinesssvc.NewRecallWatch(repo, catalog, time.Now)
	router := recallWatchRouter(repo, db, watch, "X-Test-Subject", time.Now)
	runPrivatePlanningBrowser(t, router, "/__fixture/recall-tick", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		before := calls.Load()
		batch, err := watch.ProcessDue(r.Context(), 5)
		if err != nil {
			t.Errorf("synthetic notice check: %+v, %v", batch, err)
			http.Error(w, "recall check failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]int{
			"published": batch.Published, "requests": int(calls.Load() - before),
		}); err != nil {
			t.Error(fmt.Errorf("encode recall tick: %w", err))
		}
	}), "smart-recall-watch.smoke.spec.ts", "SMART_RECALL_REAL_BACKEND=1", nil)
}
