package smartcommute_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/teslanavigation"
	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/config"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	commutedb "github.com/ev-dev-labs/teslasync/internal/database/smartcommute"
	featuredb "github.com/ev-dev-labs/teslasync/internal/database/smartfeature"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartfeature"
	commutehttp "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartcommute"
	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/go-chi/chi/v5"
)

const (
	navigationOwner   = "synthetic-navigation-owner"
	navigationAddress = "100 Synthetic Office Way"
	navigationVIN     = "SYNTHETICVEHICLE1"
)

type navigationFleetFixture struct {
	executor teslanavigation.Executor
	checks   atomic.Int32
	wakes    atomic.Int32
	sends    atomic.Int32
}

type navigationFleetOptions struct {
	initialState string
	replyStatus  int
	beforeStatus func(context.Context) error
	beforeWake   func(context.Context) error
	disableWake  bool
}

type navigationFleetControls struct {
	config settingsmodel.LegacyPollingConfig
}

func (c navigationFleetControls) GetEndpointControls(context.Context) (settingsmodel.LegacyPollingConfig, error) {
	return c.config, nil
}

func (navigationFleetControls) IsAPISuspended(context.Context) (bool, error) { return false, nil }

func newNavigationFleetFixture(t *testing.T, options navigationFleetOptions) *navigationFleetFixture {
	t.Helper()
	fleet := &navigationFleetFixture{}
	const base = "/api/1/vehicles/" + navigationVIN
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic-navigation-token" {
			t.Error("navigation must use the authorized vehicle connection")
		}
		switch r.Method + " " + r.URL.Path {
		case http.MethodGet + " " + base:
			fleet.checks.Add(1)
			if options.beforeStatus != nil {
				if err := options.beforeStatus(r.Context()); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
			}
			state := options.initialState
			if fleet.wakes.Load() > 0 {
				state = "online"
			}
			_, _ = fmt.Fprintf(w, `{"response":{"state":%q}}`, state)
		case http.MethodPost + " " + base + "/wake_up":
			fleet.wakes.Add(1)
			if options.beforeWake != nil {
				if err := options.beforeWake(r.Context()); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
			}
			_, _ = w.Write([]byte(`{"response":{"state":"online"}}`))
		case http.MethodPost + " " + base + "/command/navigation_request":
			fleet.sends.Add(1)
			var body struct {
				Type   string            `json:"type"`
				Value  map[string]string `json:"value"`
				Locale string            `json:"locale"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Type != "share_ext_content_raw" ||
				body.Locale != "en-US" || len(body.Value) != 1 || body.Value["android.intent.extra.TEXT"] != navigationAddress {
				t.Error("navigation sent something other than the entered address")
			}
			w.WriteHeader(options.replyStatus)
			_, _ = w.Write([]byte(`{"response":{"result":true,"reason":""}}`))
		default:
			t.Errorf("unexpected Tesla fixture call: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	client := tesla.NewClient(config.TeslaConfig{BaseURL: server.URL, Timeout: 3 * time.Second})
	client.SetTokens("synthetic-navigation-token", "", time.Now().Add(time.Hour))
	controls := settingsmodel.DefaultPollingConfig()
	controls.SmartEndpoints = map[string]bool{"vehicles.connectivity": true, "vehicles.wake_up": true, "command.navigation_request": true}
	if options.disableWake {
		delete(controls.SmartEndpoints, "vehicles.wake_up")
	}
	client.SetEndpointControlsReader(navigationFleetControls{config: controls})
	fleet.executor = teslanavigation.Executor{Client: client}
	return fleet
}

func newNavigationFixture(t *testing.T, fleet *navigationFleetFixture) (*fixture, *trafficLiveFixture, domain.TrafficDecision) {
	t.Helper()
	live := &trafficLiveFixture{gear: "P"}
	source := trafficSourceFixture(func(ctx context.Context, _ domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error) {
		if err := authorize(ctx); err != nil {
			return domain.TrafficComparison{}, err
		}
		at := live.now.Add(-time.Minute)
		return domain.TrafficComparison{
			Usual:       domain.TrafficEstimate{DurationS: 43 * 60, FlowUpdatedAt: at, RouteLabel: "Synthetic Parkway"},
			Alternative: domain.TrafficEstimate{DurationS: 29 * 60, FlowUpdatedAt: at, RouteLabel: "Synthetic Bypass"},
		}, nil
	})
	f := newFixtureWithServices(t, nil, func(repo *commutedb.Repository) smartcommutesvc.Option {
		return smartcommutesvc.WithNavigation(repo, fleet.executor, fleet.executor.Client.NavigationAllowed)
	}, smartcommutesvc.WithTrafficLiveReader(live),
		smartcommutesvc.WithTrafficEvaluator(source, func(context.Context, string, time.Time) (bool, error) { return false, nil }, nil))
	live.now = f.now
	const root = "/api/v1/smart-commute"
	expectStatus(t, f.request(t, http.MethodPut, root, navigationOwner, settings(42, true, true, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, root+"/routines", navigationOwner, manualRoutine(42)), http.StatusCreated)
	var routine domain.Routine
	for _, row := range snapshot(t, f.request(t, http.MethodGet, root+"?vehicle_id=42", navigationOwner, nil)).Routines {
		if row.Status == domain.RoutineConfirmed {
			routine = row
		}
	}
	repo := commutedb.NewRepository(f.db)
	if err := repo.SaveTrafficConsent(t.Context(), navigationOwner, routine, domain.TrafficConsent{
		Trace: []domain.Point{routine.Origin, {Latitude: 47.15, Longitude: -122.15}, routine.Destination},
		LeadS: 900, MinSavingsS: 480, CheckAt: f.now, DepartureAt: f.now.Add(15 * time.Minute),
	}, f.now); err != nil {
		t.Fatal(err)
	}
	if count, err := f.commute.ProcessTrafficChecks(t.Context(), 5); count != 1 || err != nil {
		t.Fatalf("process Tuesday commute: %d %v", count, err)
	}
	read := snapshot(t, f.request(t, http.MethodGet, root+"?vehicle_id=42", navigationOwner, nil))
	if !read.NavigationAvailable || len(read.TrafficDecisions) != 1 || fleet.checks.Load()+fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatal("reading a qualified decision must expose the action without making any Tesla calls")
	}
	return f, live, read.TrafficDecisions[0]
}

func navigationRequest(
	router http.Handler, routineID int64, subject, expected string, input domain.NavigationRequest,
) *httptest.ResponseRecorder {
	data, _ := json.Marshal(input)
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/smart-commute/routines/%d/navigation", routineID), bytes.NewReader(data))
	req.Header.Set("X-Test-Subject", subject)
	req.Header.Set(auth.ExpectedPrincipalHeader, expected)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	return res
}

func navigationResult(t *testing.T, response *httptest.ResponseRecorder) domain.NavigationOutcome {
	t.Helper()
	expectStatus(t, response, http.StatusOK)
	var envelope struct {
		Data domain.NavigationResult `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("navigation result must be private and uncached")
	}
	return envelope.Data.Outcome
}

func TestNavigationOccurrenceIsScopedAndFencedAcrossRequests(t *testing.T) {
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "online", replyStatus: http.StatusOK})
	f, live, decision := newNavigationFixture(t, fleet)
	request := domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true}
	expected := "subject:" + navigationOwner
	const other = "other-synthetic-user"
	expectStatus(t, navigationRequest(f.sharedRouter(), decision.RoutineID, "", "open", request), http.StatusForbidden)
	expectStatus(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "", request), http.StatusForbidden)
	expectStatus(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+other, request), http.StatusConflict)
	foreign := navigationRequest(f.router, decision.RoutineID, other, "subject:"+other, request)
	request.VehicleID = 43
	wrongVehicle := navigationRequest(f.router, decision.RoutineID, navigationOwner, expected, request)
	request.VehicleID = 42
	live.gear = "D"
	moving := navigationRequest(f.router, decision.RoutineID, navigationOwner, expected, request)
	live.gear = "P"
	live.now = f.now.Add(-10 * time.Minute)
	stale := navigationRequest(f.router, decision.RoutineID, navigationOwner, expected, request)
	live.now = f.now
	for _, res := range []*httptest.ResponseRecorder{foreign, wrongVehicle, moving, stale} {
		if navigationResult(t, res) != domain.NavigationExpired {
			t.Fatal("ineligible request did not expire")
		}
	}
	if fleet.checks.Load()+fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatal("unauthorized or moving requests reached Tesla")
	}
	if got := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, expected, request)); got != domain.NavigationWakePermission {
		t.Fatalf("online state does not establish a no-wake contract: %s", got)
	}
	if fleet.checks.Load() != 1 || fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatal("a connectivity check must not wake or send a destination")
	}
	request.WakeConfirmed = true
	replies := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() { replies <- navigationRequest(f.router, decision.RoutineID, navigationOwner, expected, request) }()
	}
	first, second := navigationResult(t, <-replies), navigationResult(t, <-replies)
	if first != domain.NavigationAccepted && second != domain.NavigationAccepted {
		t.Fatalf("both confirmations failed: %q, %q", first, second)
	}
	if fleet.sends.Load() != 1 || fleet.wakes.Load() != 0 {
		t.Fatal("double confirmation must dispatch one destination without waking")
	}
	repo := commutedb.NewRepository(f.db)
	restart := smartcommutesvc.New(repo, smartcommutesvc.WithClock(func() time.Time { return f.now }),
		smartcommutesvc.WithTrafficConnector(true), smartcommutesvc.WithTrafficLiveReader(live),
		smartcommutesvc.WithNavigation(repo, fleet.executor, fleet.executor.Client.NavigationAllowed))
	router := chi.NewRouter()
	router.Route("/api/v1", commutehttp.NewHandler(restart, "X-Test-Subject").MountRoutes)
	if result := navigationResult(t, navigationRequest(router, decision.RoutineID, navigationOwner, expected, request)); result != domain.NavigationAccepted {
		t.Fatalf("restarted service did not recover the acknowledged outcome: %s", result)
	}
	read := f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", navigationOwner, nil)
	if strings.Contains(read.Body.String(), navigationAddress) || strings.Contains(read.Body.String(), navigationVIN) {
		t.Fatal("comparison must not expose the dispatched address or VIN")
	}
	if snapshot(t, read).TrafficDecisions[0].NavigationOutcome != domain.NavigationAccepted || fleet.sends.Load() != 1 {
		t.Fatal("saved outcome missing or replayed")
	}
}

func TestNavigationRequiresIndependentWakeAndNeverReplaysTimeout(t *testing.T) {
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "asleep", replyStatus: http.StatusRequestTimeout})
	f, _, decision := newNavigationFixture(t, fleet)
	request := domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true}
	send := func() domain.NavigationOutcome {
		return navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner, request))
	}
	if got := send(); got != domain.NavigationWakeRequired || fleet.checks.Load() != 1 || fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatalf("unconsented wake or dispatch: %s", got)
	}
	request.WakeConfirmed = true
	if got := send(); got != domain.NavigationUnknown || fleet.wakes.Load() != 1 || fleet.sends.Load() != 1 {
		t.Fatalf("explicit wake and timeout outcome: %s", got)
	}
	if got := send(); got != domain.NavigationUnknown || fleet.checks.Load() != 2 || fleet.wakes.Load() != 1 || fleet.sends.Load() != 1 {
		t.Fatalf("uncertain request replayed: %s", got)
	}
	f.now = decision.ExpiresAt.Add(time.Second)
	if got := send(); got != domain.NavigationExpired || fleet.checks.Load() != 2 {
		t.Fatalf("expiry initiated a new request: %s", got)
	}
}

func TestNavigationDoesNotOfferOrSendDisabledWake(t *testing.T) {
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "asleep", replyStatus: http.StatusOK, disableWake: true})
	f, _, decision := newNavigationFixture(t, fleet)
	for _, wake := range []bool{false, true} {
		outcome := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
			domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true, WakeConfirmed: wake}))
		if outcome != domain.NavigationNotSent {
			t.Fatalf("disabled wake, confirmed=%t: got %s", wake, outcome)
		}
	}
	if fleet.checks.Load() != 2 || fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatal("disabled wake should stop navigation after connectivity")
	}
}

func TestNavigationRechecksConsentAfterConnectivity(t *testing.T) {
	var revoke func(context.Context) error
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "online", replyStatus: http.StatusOK,
		beforeStatus: func(ctx context.Context) error { return revoke(ctx) }})
	f, _, decision := newNavigationFixture(t, fleet)
	revoke = func(ctx context.Context) error {
		return commutedb.NewRepository(f.db).DeleteTrafficConsent(ctx, navigationOwner, 42, decision.RoutineID)
	}
	outcome := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
		domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true}))
	if outcome != domain.NavigationExpired || fleet.checks.Load() != 1 || fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatalf("revoked comparison dispatched a command: %s", outcome)
	}
}

func TestNavigationRechecksOutageAfterConnectivity(t *testing.T) {
	var f *fixture
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "online", replyStatus: http.StatusOK,
		beforeStatus: func(ctx context.Context) error { return interruptHEREFlow(ctx, f) }})
	f, _, decision := newNavigationFixture(t, fleet)
	outcome := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
		domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true}))
	if outcome != domain.NavigationExpired || fleet.checks.Load() != 1 || fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatalf("outage after connectivity allowed navigation: %s (%d checks, %d wakes, %d sends)",
			outcome, fleet.checks.Load(), fleet.wakes.Load(), fleet.sends.Load())
	}
}

func TestNavigationPauseFencesInFlightRequestButKeepsTrafficAdvice(t *testing.T) {
	var cyclePermission func(context.Context) error
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{
		initialState: "online", replyStatus: http.StatusOK,
		beforeStatus: func(ctx context.Context) error { return cyclePermission(ctx) },
	})
	f, _, decision := newNavigationFixture(t, fleet)
	prefs := featuredb.NewRepository(f.db.Pool)
	set := func(ctx context.Context, allowed bool) error {
		return prefs.SetPreference(ctx, navigationOwner, smartfeature.Preference{Feature: smartfeature.Navigation, Allowed: allowed})
	}
	cyclePermission = func(ctx context.Context) error {
		if err := set(ctx, false); err != nil {
			return err
		}
		return set(ctx, true)
	}
	send := func() domain.NavigationOutcome {
		return navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
			domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true, WakeConfirmed: true}))
	}
	if err := set(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	if got := send(); got != domain.NavigationExpired || fleet.checks.Load() != 0 {
		t.Fatalf("paused destination dispatch called Tesla: %s", got)
	}
	if err := set(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if got := send(); got != domain.NavigationExpired || fleet.checks.Load() != 1 || fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatalf("pause and resume allowed an old request to send a destination: %s", got)
	}
	cyclePermission = func(context.Context) error { return nil }
	if got := send(); got != domain.NavigationAccepted || fleet.sends.Load() != 1 {
		t.Fatalf("a fresh confirmation could not use the existing traffic advice: %s", got)
	}
}

type navigationBudget struct {
	beforeCommand func(context.Context) error
	beforeWake    func(context.Context) error
}

func (b navigationBudget) Reserve(ctx context.Context, charge tesla.BudgetCharge) (tesla.BudgetSnapshot, error) {
	if charge.Category == tesla.BudgetCategoryCommand && b.beforeCommand != nil {
		return tesla.BudgetSnapshot{}, b.beforeCommand(ctx)
	}
	if charge.Category == tesla.BudgetCategoryWakeUp && b.beforeWake != nil {
		return tesla.BudgetSnapshot{}, b.beforeWake(ctx)
	}
	return tesla.BudgetSnapshot{}, nil
}

func (navigationBudget) Snapshot(context.Context) (tesla.BudgetSnapshot, error) {
	return tesla.BudgetSnapshot{}, nil
}

func TestNavigationFailsClosedBeforeDestinationDispatch(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		state     string
		revoke    string
		want      domain.NavigationOutcome
		wakeCount int32
	}{
		{name: "unknown connectivity", state: "unknown", want: domain.NavigationNotSent},
		{name: "consent revoked after wake", state: "asleep", revoke: "wake", want: domain.NavigationExpired, wakeCount: 1},
		{name: "consent revoked during budget admission", state: "online", revoke: "budget", want: domain.NavigationExpired},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var revoke func(context.Context) error
			options := navigationFleetOptions{initialState: scenario.state, replyStatus: http.StatusOK}
			if scenario.revoke == "wake" {
				options.beforeWake = func(ctx context.Context) error { return revoke(ctx) }
			}
			fleet := newNavigationFleetFixture(t, options)
			f, _, decision := newNavigationFixture(t, fleet)
			revoke = func(ctx context.Context) error {
				return commutedb.NewRepository(f.db).DeleteTrafficConsent(ctx, navigationOwner, 42, decision.RoutineID)
			}
			if scenario.revoke == "budget" {
				fleet.executor.Client.SetRequestBudget(navigationBudget{beforeCommand: revoke})
			}
			outcome := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
				domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true, WakeConfirmed: true}))
			if outcome != scenario.want || fleet.checks.Load() != 1 || fleet.wakes.Load() != scenario.wakeCount || fleet.sends.Load() != 0 {
				t.Fatalf("ineligible destination dispatched or wrong outcome: %s", outcome)
			}
		})
	}
}

func TestNavigationRechecksConsentAfterTheFinalLiveRead(t *testing.T) {
	for _, connection := range []string{"online", "asleep"} {
		t.Run(connection, func(t *testing.T) {
			fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: connection, replyStatus: http.StatusOK})
			f, live, decision := newNavigationFixture(t, fleet)
			var revoke, revoked bool
			arm := func(context.Context) error { revoke = true; return nil }
			fleet.executor.Client.SetRequestBudget(navigationBudget{beforeCommand: arm, beforeWake: arm})
			live.beforeRead = func(ctx context.Context) error {
				if !revoke || revoked {
					return nil
				}
				err := commutedb.NewRepository(f.db).DeleteTrafficConsent(ctx, navigationOwner, 42, decision.RoutineID)
				revoked = err == nil
				return err
			}
			outcome := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
				domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true, WakeConfirmed: true}))
			if !revoked || outcome != domain.NavigationExpired || fleet.checks.Load() != 1 || fleet.wakes.Load()+fleet.sends.Load() != 0 {
				t.Fatalf("revocation during the final live read did not block %s navigation: %s", connection, outcome)
			}
		})
	}
}

func TestNavigationOccurrenceStaysExpiredAfterTheVehicleReparks(t *testing.T) {
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "online", replyStatus: http.StatusOK})
	f, live, decision := newNavigationFixture(t, fleet)
	f.now = f.now.Add(90 * time.Second)
	live.now = f.now
	live.beforeRead = func(context.Context) error {
		recordTrafficDeparture(t, f)
		return nil
	}
	if !f.now.Before(decision.ExpiresAt) {
		t.Fatal("fixture must repark before the traffic snapshot expires")
	}
	read := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", navigationOwner, nil))
	if len(read.TrafficDecisions) != 0 {
		t.Fatal("reparking near the origin reopened the earlier comparison")
	}
	live.beforeRead = nil
	outcome := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
		domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true, WakeConfirmed: true}))
	if outcome != domain.NavigationExpired || fleet.checks.Load()+fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatalf("reparked vehicle could use a previous departure: %s", outcome)
	}
}

func TestResumedDriveRetiresTrafficWithoutANewStart(t *testing.T) {
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "online", replyStatus: http.StatusOK})
	f, live, decision := newNavigationFixture(t, fleet)
	checkAt := f.now
	ctx := t.Context()
	var driveID int64
	if err := f.db.Pool.QueryRow(ctx, `
		INSERT INTO drives (vehicle_id, started_at, ended_at)
		VALUES (42, $1, $2) RETURNING id`, checkAt.Add(-time.Hour), checkAt.Add(-30*time.Second)).Scan(&driveID); err != nil {
		t.Fatal(err)
	}
	comparisons := func() int {
		read := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", navigationOwner, nil))
		return len(read.TrafficDecisions)
	}
	if comparisons() != 1 {
		t.Fatal("a completed pre-window drive suppressed an otherwise eligible comparison")
	}
	f.now = checkAt.Add(30 * time.Second)
	live.now = f.now
	if err := drivedb.NewDriveRepo(f.db).ResumeForMerge(ctx, driveID); err != nil {
		t.Fatal(err)
	}
	if comparisons() != 0 {
		t.Error("resuming a pre-window drive left its comparison visible")
	}
	f.now = checkAt.Add(time.Minute)
	live.now = f.now
	if _, err := f.db.Pool.Exec(ctx, `UPDATE drives SET ended_at = $1 WHERE id = $2`, f.now, driveID); err != nil {
		t.Fatal(err)
	}
	if comparisons() != 0 {
		t.Error("parking after the merged leg reopened its comparison")
	}
	outcome := navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner,
		domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID, Address: navigationAddress, Confirmed: true, WakeConfirmed: true}))
	if outcome != domain.NavigationExpired || fleet.checks.Load()+fleet.wakes.Load()+fleet.sends.Load() != 0 {
		t.Fatalf("merged departure permitted a navigation action: %s", outcome)
	}
}

func TestTrafficEvidenceMigrationPreservesTheExistingNavigationFence(t *testing.T) {
	fleet := newNavigationFleetFixture(t, navigationFleetOptions{initialState: "online", replyStatus: http.StatusOK})
	f, _, decision := newNavigationFixture(t, fleet)
	request := domain.NavigationRequest{VehicleID: 42, OccurrenceID: decision.OccurrenceID,
		Address: navigationAddress, Confirmed: true, WakeConfirmed: true}
	navigate := func() domain.NavigationOutcome {
		return navigationResult(t, navigationRequest(f.router, decision.RoutineID, navigationOwner, "subject:"+navigationOwner, request))
	}
	if decision.UsualRouteLabel != "Synthetic Parkway" || decision.AlternativeRouteLabel != "Synthetic Bypass" ||
		navigate() != domain.NavigationAccepted {
		t.Fatal("fixture did not persist the named choice and attempt")
	}
	for _, direction := range []string{"down", "up"} {
		content, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000306_smart_commute_comparison_evidence."+direction+".sql"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.db.Pool.Exec(t.Context(), string(content)); err != nil {
			t.Fatalf("migrate comparison evidence %s: %v", direction, err)
		}
	}
	read := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", navigationOwner, nil))
	if len(read.TrafficDecisions) != 1 || read.TrafficDecisions[0].UsualS != decision.UsualS ||
		read.TrafficDecisions[0].AlternativeRouteLabel != "" || navigate() != domain.NavigationAccepted || fleet.sends.Load() != 1 {
		t.Fatal("rolling back label metadata changed the original comparison or reopened its completed send")
	}
}

func recordTrafficDeparture(t *testing.T, f *fixture) {
	t.Helper()
	if _, err := f.db.Pool.Exec(t.Context(), `
		INSERT INTO drives (vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng)
		VALUES (42, $1, $2, 47.1, -122.1, 47.1003, -122.1003)`,
		f.now.Add(-time.Minute), f.now); err != nil {
		t.Fatal(err)
	}
}
