package smartreadiness_test

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
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	portreadiness "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type controlledLive struct {
	mu     sync.Mutex
	values map[string]*signal.Value
	reads  int
}

func (s *controlledLive) GetAll(_ context.Context, _ int64, preference signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	if preference != signal.LiveSignalReadDistributed {
		return nil, fmt.Errorf("expected a distributed live read")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reads++
	values := make(map[string]*signal.Value, len(s.values))
	for key, value := range s.values {
		copy := *value
		values[key] = &copy
	}
	return values, nil
}

func (s *controlledLive) setChargeState(value string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values["DetailedChargeState"].Raw = value
	if latch := s.values["ChargePortLatch"]; latch != nil {
		latch.Raw = "Engaged"
		if value == "Disconnected" {
			latch.Raw = "Disengaged"
		}
	}
}

func (s *controlledLive) readCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reads
}

type controlledSite struct{ outside bool }

func (s controlledSite) Contains(context.Context, int64, float64, float64) (bool, error) {
	return !s.outside, nil
}

type emptySources struct{}

func (emptySources) ListActiveAlerts(context.Context, *int64, time.Time, int) ([]actiondomain.AlertRecord, error) {
	return nil, nil
}
func (emptySources) ListLatestBatteryHealth(context.Context, *int64, int) ([]actiondomain.BatteryHealthRecord, error) {
	return nil, nil
}
func (emptySources) ListStaleChargingSessions(context.Context, *int64, time.Time, int) ([]actiondomain.ChargingRecord, error) {
	return nil, nil
}
func (emptySources) ListDriveEfficiencyEvidence(context.Context, *int64, time.Time, time.Time, int, float64, float64, int) ([]actiondomain.DriveEfficiencyRecord, error) {
	return nil, nil
}
func (emptySources) ListActiveWorkOrders(context.Context, *int64, int) ([]actiondomain.WorkOrderRecord, error) {
	return nil, nil
}
func (emptySources) ListCommandReliability(context.Context, *int64, time.Time, time.Time, int) ([]actiondomain.CommandReliabilityRecord, error) {
	return nil, nil
}
func (emptySources) ListSignalHealth(context.Context, *int64, time.Time, time.Time, int) ([]actiondomain.SignalHealthRecord, error) {
	return nil, nil
}
func (emptySources) ListActiveVehicles(context.Context, *int64, int) ([]actiondomain.VehicleRef, error) {
	return nil, nil
}
func (emptySources) ListOpenSystemIncidents(context.Context, int) ([]actiondomain.SystemIncidentRecord, error) {
	return nil, nil
}

func TestSlowChargingRequiresContinuousFreshEvidenceAndScopedReads(t *testing.T) {
	repo, db := testRepository(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(context.Background(), string(migration)); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	start := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	now := start
	live := &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":             {Raw: 40.0, Timestamp: now},
		"DetailedChargeState":      {Raw: "Disconnected", Timestamp: now},
		"Gear":                     {Raw: "P", Timestamp: now},
		"LocationLatitude":         {Raw: 47.1, Timestamp: now},
		"LocationLongitude":        {Raw: -122.1, Timestamp: now},
		"NominalFullPackEnergyKwh": {Raw: 80000.0, Timestamp: now},
		"ACChargingPower":          {Raw: 1000.0, Timestamp: now},
		"ChargeCurrentRequest":     {Raw: 12.0, Timestamp: now},
		"ChargeCurrentRequestMax":  {Raw: 32.0, Timestamp: now},
	}}
	refresh := func(at time.Time, state string, power float64) {
		t.Helper()
		now = at
		live.mu.Lock()
		defer live.mu.Unlock()
		for _, value := range live.values {
			value.Timestamp = at
		}
		live.values["DetailedChargeState"].Raw = state
		live.values["ACChargingPower"].Raw = power
	}
	newService := func() *smartreadinesssvc.Service {
		return smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithClock(func() time.Time { return now }))
	}
	service := newService()
	plan := testPlan(now)
	plan.DepartureAt = now.Add(2 * time.Hour)
	saved, err := repo.SavePlan(ctx, "subject-a", plan, now)
	if err != nil {
		t.Fatal(err)
	}
	process := func() {
		t.Helper()
		if count, processErr := service.ProcessDue(ctx, 10); processErr != nil || count != 1 {
			t.Fatalf("process at %s = %d, %v", now, count, processErr)
		}
	}
	candidates := func(subject string) []portreadiness.Candidate {
		t.Helper()
		items, listErr := service.ListCandidates(ctx, subject, nil, now, 10)
		if listErr != nil {
			t.Fatal(listErr)
		}
		return items
	}

	process()
	if items := candidates("subject-a"); len(items) != 1 || items[0].Decision.Kind != readiness.DecisionPlugIn {
		t.Fatalf("initial unplugged decision = %+v", items)
	}
	refresh(start, "Charging", 1000)
	if items := candidates("subject-a"); len(items) != 0 {
		t.Fatalf("unplugged decision changed into an unsampled charging decision: %+v", items)
	}
	for _, minute := range []int{1, 2, 3, 5, 6, 7, 8, 9} {
		refresh(start.Add(time.Duration(minute)*time.Minute), "Charging", 1000)
		process()
		if minute == 1 {
			_, err := db.Pool.Exec(ctx, `INSERT INTO smart_charging_decisions
				(plan_id, battery_pct, arrival_low_pct, arrival_high_pct, observed_at, expires_at, evaluated_at)
				VALUES ($1, 40, 0, 5, $2, $3, $2)`,
				saved.ID, now, now.Add(2*time.Minute))
			if err != nil {
				t.Fatal(err)
			}
		}
		if items := candidates("subject-a"); len(items) != 0 {
			t.Fatalf("premature decision at minute %d, including older-worker decision = %+v", minute, items)
		}
		if minute == 7 {
			service = newService()
		}
	}
	refresh(start.Add(10*time.Minute), "Charging", 1000)
	process()
	items := candidates("subject-a")
	if len(items) != 1 || items[0].Plan.ID != saved.ID ||
		items[0].Decision.Kind != readiness.DecisionSlowCharging || items[0].Decision.ChargingPowerW != 1000 {
		t.Fatalf("sustained charging decision = %+v", items)
	}
	if items := candidates("subject-b"); len(items) != 0 {
		t.Fatalf("another subject received a charging decision: %+v", items)
	}

	actionService := actioncentersvc.New(
		emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithSmartCharging(service), actioncentersvc.WithClock(func() time.Time { return now }),
	)
	router := chi.NewRouter()
	router.Get("/api/v1/action-center", actionhandler.NewHandler(actionService, "X-Test-Subject").List)
	readActionCenter := func(subject string) actiondomain.Response {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/action-center?vehicle_id=7", nil)
		req.Header.Set("X-Test-Subject", subject)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		var page actiondomain.Response
		if rec.Code != http.StatusOK || json.NewDecoder(rec.Body).Decode(&page) != nil {
			t.Fatalf("action center response = %d %s", rec.Code, rec.Body.String())
		}
		return page
	}
	page := readActionCenter("subject-a")
	if len(page.Items) != 1 || page.Items[0].Title != "Charging may not be ready before your trip" ||
		page.Items[0].NavigationPath == nil || *page.Items[0].NavigationPath != "/charging/schedule?vehicle_id=7" ||
		len(page.Items[0].Evidence) != 1 || page.Items[0].Evidence[0].Kind != "charging_feasibility" ||
		page.Items[0].Evidence[0].ChargingReadiness == nil ||
		page.Items[0].Evidence[0].ChargingReadiness.ChargingPowerW == nil ||
		*page.Items[0].Evidence[0].ChargingReadiness.ChargingPowerW != 1000 ||
		page.Items[0].Evidence[0].ChargingReadiness.CurrentLimit == nil ||
		page.Items[0].Evidence[0].ChargingReadiness.CurrentLimit.RequestedA != 12 ||
		page.Items[0].Evidence[0].ChargingReadiness.CurrentLimit.MaximumA != 32 ||
		!strings.Contains(page.Items[0].Summary, "AC current request of 12.0 A") {
		t.Fatalf("feasibility card = %+v", page.Items)
	}
	if page := readActionCenter("subject-b"); len(page.Items) != 0 {
		t.Fatalf("another subject received a feasibility card: %+v", page.Items)
	}
	live.mu.Lock()
	live.values["ChargeCurrentRequest"].Timestamp = now.Add(-3 * time.Minute)
	live.mu.Unlock()
	page = readActionCenter("subject-a")
	if len(page.Items) != 1 || page.Items[0].Evidence[0].ChargingReadiness.CurrentLimit != nil ||
		strings.Contains(page.Items[0].Summary, "AC current request") {
		t.Fatalf("stale current evidence remained visible: %+v", page.Items)
	}
	live.mu.Lock()
	live.values["ChargeCurrentRequest"].Timestamp = now
	live.mu.Unlock()

	_, err = db.Pool.Exec(ctx, `UPDATE smart_charging_decisions SET evaluated_at=$2 WHERE plan_id=$1`,
		saved.ID, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if items := candidates("subject-a"); len(items) != 0 {
		t.Fatalf("decision from another worker reused an earlier sample: %+v", items)
	}
	_, err = db.Pool.Exec(ctx, `UPDATE smart_charging_decisions SET evaluated_at=$2 WHERE plan_id=$1`,
		saved.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	refresh(now, "Charging", 20000)
	if items := candidates("subject-a"); len(items) != 0 {
		t.Fatalf("resolved charging decision still visible: %+v", items)
	}
	refresh(start.Add(11*time.Minute), "Charging", 20000)
	process()
	refresh(start.Add(12*time.Minute), "Charging", 1000)
	process()
	if err := repo.SnoozePlan(ctx, "subject-a", 7, saved.ID, nil, now); err != nil {
		t.Fatal(err)
	}
	process()
	if items := candidates("subject-a"); len(items) != 0 {
		t.Fatalf("resumed plan reused old feasibility samples: %+v", items)
	}
}

func TestPrivateChargingPriceComparisonThroughHandlers(t *testing.T) {
	repo, db := testRepository(t)
	ctx := context.Background()
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	live := &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":             {Raw: 40.0, Timestamp: now},
		"DetailedChargeState":      {Raw: "Charging", Timestamp: now},
		"Gear":                     {Raw: "P", Timestamp: now},
		"LocationLatitude":         {Raw: 47.1, Timestamp: now},
		"LocationLongitude":        {Raw: -122.1, Timestamp: now},
		"NominalFullPackEnergyKwh": {Raw: 80000.0, Timestamp: now},
		"ACChargingPower":          {Raw: 10000.0, Timestamp: now},
	}}
	service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithClock(func() time.Time { return now }))
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(service, "X-Test-Subject").MountRoutes(r)
	})
	request := func(method, path, subject string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		var payload bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&payload).Encode(body); err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, &payload)
		req.Header.Set("X-Test-Subject", subject)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: status=%d cache=%q body=%s", method, path, rec.Code,
				rec.Header().Get("Cache-Control"), rec.Body.String())
		}
		return rec
	}
	plansPath := "/api/v1/smart-charging/plans"
	input := map[string]any{
		"vehicle_id": 7, "charging_place_id": 9, "enabled": true,
		"notify_at": now, "departure_at": now.Add(6 * time.Hour),
		"trip_use_low_pct": 35, "trip_use_high_pct": 45, "reserve_pct": 20,
	}
	rec := request(http.MethodPost, plansPath, "subject-a", input, http.StatusCreated)
	var created struct {
		Data readiness.Plan `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil || created.Data.ID <= 0 || created.Data.CompareSiteRates {
		t.Fatalf("default-off plan = %+v, %v", created.Data, err)
	}
	change := now.Add(3 * time.Hour)
	var firstID, secondID int64
	if err := db.Pool.QueryRow(ctx, `
		INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from, effective_to)
		VALUES (9, 0.0004, 'USD', $1, $2) RETURNING id`, now.Add(-time.Hour), change).Scan(&firstID); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool.QueryRow(ctx, `
		INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from)
		VALUES (9, 0.0001, 'USD', $1) RETURNING id`, change).Scan(&secondID); err != nil {
		t.Fatal(err)
	}
	read := func(subject string) []readiness.LatestStart {
		t.Helper()
		rec := request(http.MethodGet, "/api/v1/smart-charging/latest-start?vehicle_id=7", subject, nil, http.StatusOK)
		var result struct {
			Data []readiness.LatestStart `json:"data"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result.Data
	}
	if got := read("subject-a"); len(got) != 1 || got[0].CostComparison != nil {
		t.Fatalf("comparison without consent = %+v", got)
	}
	reads := live.readCount()
	if got := read("subject-b"); len(got) != 0 || live.readCount() != reads {
		t.Fatalf("foreign subject comparison = %+v, signal reads=%d", got, live.readCount())
	}
	path := fmt.Sprintf("%s/%d", plansPath, created.Data.ID)
	input["expected_version"], input["expected_check_at"] = created.Data.Version, created.Data.NotifyAt
	input["compare_site_rates"] = true
	request(http.MethodPut, path, "subject-b", input, http.StatusNotFound)
	recordPlanRevision(t, input, request(http.MethodPut, path, "subject-a", input, http.StatusOK))
	if got := read("subject-a"); len(got) != 1 || got[0].CostComparison == nil ||
		got[0].CostComparison.Currency != "USD" || got[0].CostComparison.CostNowDecimal != "8.000000" ||
		got[0].CostComparison.CostLaterDecimal != "2.000000" ||
		!got[0].CostComparison.LowerRateStartAt.Equal(change) {
		t.Fatalf("verified comparison = %+v", got)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE geofence_rates SET effective_to=$2 WHERE id=$1`, firstID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if got := read("subject-a"); len(got) != 1 || got[0].CostComparison != nil {
		t.Fatalf("uncovered price interval = %+v", got)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE geofence_rates SET effective_to=$2 WHERE id=$1`, firstID, change); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE geofence_rates SET currency='EUR' WHERE id=$1`, secondID); err != nil {
		t.Fatal(err)
	}
	if got := read("subject-a"); len(got) != 1 || got[0].CostComparison != nil {
		t.Fatalf("mixed currencies = %+v", got)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE geofence_rates SET currency='USD' WHERE id=$1`, secondID); err != nil {
		t.Fatal(err)
	}
	cheapStart, cheapEnd := now.Add(4*time.Minute), now.Add(124*time.Minute)
	if _, err := db.Pool.Exec(ctx, `
		UPDATE geofence_rates SET effective_to=$2, rate_per_wh=0.003 WHERE id=$1`,
		firstID, cheapStart); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `
		UPDATE geofence_rates SET effective_from=$2, effective_to=$3, rate_per_wh=0 WHERE id=$1`,
		secondID, cheapStart, cheapEnd); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from)
		VALUES (9, 0.003, 'USD', $1)`, cheapEnd); err != nil {
		t.Fatal(err)
	}
	if got := read("subject-a"); len(got) != 1 || got[0].CostComparison == nil ||
		got[0].CostComparison.SavingDecimal != "1.500000" ||
		!got[0].CostComparison.LowerRateStartAt.Equal(now.Add(5*time.Minute)) {
		t.Fatalf("first actionable start during a brief price window = %+v", got)
	}
	input["compare_site_rates"] = false
	request(http.MethodPut, path, "subject-a", input, http.StatusOK)
	if got := read("subject-a"); len(got) != 1 || got[0].CostComparison != nil {
		t.Fatalf("revoked comparison = %+v", got)
	}
}

func TestTripLegsThroughWorkerAndPrivateHandlers(t *testing.T) {
	repo, db := testRepository(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(context.Background(), string(migration)); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	live := &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":        {Raw: 45.0, Timestamp: now},
		"DetailedChargeState": {Raw: "Disconnected", Timestamp: now},
		"Gear":                {Raw: "P", Timestamp: now},
		"LocationLatitude":    {Raw: 47.1, Timestamp: now},
		"LocationLongitude":   {Raw: -122.1, Timestamp: now},
	}}
	service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithClock(func() time.Time { return now }))
	actionService := actioncentersvc.New(
		emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithSmartCharging(service), actioncentersvc.WithClock(func() time.Time { return now }),
	)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(service, "X-Test-Subject").MountRoutes(r)
		r.Get("/action-center", actionhandler.NewHandler(actionService, "X-Test-Subject").List)
	})
	request := func(method, path, subject string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		var payload bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&payload).Encode(body); err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, &payload)
		req.Header.Set("X-Test-Subject", subject)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: status=%d cache=%q body=%s", method, path, rec.Code,
				rec.Header().Get("Cache-Control"), rec.Body.String())
		}
		return rec
	}
	legs := map[string]any{
		"outbound_use_low_pct": 20, "outbound_use_high_pct": 25,
		"return_use_low_pct": 20, "return_use_high_pct": 30, "destination_charge_pct": nil,
	}
	input := map[string]any{
		"vehicle_id": 7, "charging_place_id": 9, "enabled": false,
		"notify_at": now, "departure_at": now.Add(12 * time.Hour),
		"trip_use_low_pct": 0, "trip_use_high_pct": 0, "reserve_pct": 20, "trip_legs": legs,
	}
	path := "/api/v1/smart-charging/plans"
	rec := request(http.MethodPost, path, "subject-a", input, http.StatusCreated)
	var created struct {
		Data readiness.Plan `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil || created.Data.TripLegs == nil ||
		created.Data.TripUseLowPct != 40 || created.Data.TripUseHighPct != 55 {
		t.Fatalf("created split plan = %+v, %v", created.Data, err)
	}
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 0 || live.readCount() != 0 {
		t.Fatalf("disabled plan processed: count=%d reads=%d err=%v", count, live.readCount(), err)
	}
	planPath := fmt.Sprintf("%s/%d", path, created.Data.ID)
	input["expected_version"], input["expected_check_at"] = created.Data.Version, created.Data.NotifyAt
	input["enabled"] = true
	request(http.MethodPut, planPath, "subject-b", input, http.StatusNotFound)
	recordPlanRevision(t, input, request(http.MethodPut, planPath, "subject-a", input, http.StatusOK))
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 1 {
		t.Fatalf("worker evaluation = %d, %v", count, err)
	}
	items := func(subject string) []actiondomain.Recommendation {
		t.Helper()
		rec := request(http.MethodGet, "/api/v1/action-center?vehicle_id=7", subject, nil, http.StatusOK)
		var response actiondomain.Response
		if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
			t.Fatal(err)
		}
		return response.Items
	}
	got := items("subject-a")
	if len(got) != 1 || got[0].Evidence[0].ChargingReadiness == nil ||
		got[0].NavigationPath == nil || *got[0].NavigationPath != "/settings/smart-charging?vehicle_id=7" ||
		got[0].Evidence[0].ChargingReadiness.TripProjection == nil ||
		got[0].Evidence[0].ChargingReadiness.TripProjection.DestinationLowPct != 20 ||
		got[0].Evidence[0].ChargingReadiness.TripProjection.ReturnHighPct == nil ||
		*got[0].Evidence[0].ChargingReadiness.TripProjection.ReturnHighPct != 5 {
		t.Fatalf("split-leg private recommendation = %+v", got)
	}
	if got := items("subject-b"); len(got) != 0 {
		t.Fatalf("foreign subject received a trip recommendation: %+v", got)
	}
	rec = request(http.MethodGet, "/api/v1/smart-charging/latest-start?vehicle_id=7", "subject-a", nil, http.StatusOK)
	var latest struct {
		Data []readiness.LatestStart `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&latest); err != nil || len(latest.Data) != 1 ||
		latest.Data[0].TripProjection == nil || latest.Data[0].TripProjection.DestinationHighPct != 25 {
		t.Fatalf("private latest trip projection = %+v, %v", latest, err)
	}
	legs["destination_charge_pct"] = 20
	recordPlanRevision(t, input, request(http.MethodPut, planPath, "subject-a", input, http.StatusOK))
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 1 {
		t.Fatalf("worker after planned charge = %d, %v", count, err)
	}
	if got := items("subject-a"); len(got) != 0 {
		t.Fatalf("resolved planned charge did not suppress the shortfall: %+v", got)
	}
	legs["return_use_low_pct"], legs["return_use_high_pct"], legs["destination_charge_pct"] = 90, 95, 100
	recordPlanRevision(t, input, request(http.MethodPut, planPath, "subject-a", input, http.StatusOK))
	live.setChargeState("Charging")
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 1 {
		t.Fatalf("worker for impossible reserve = %d, %v", count, err)
	}
	got = items("subject-a")
	if len(got) != 1 || got[0].Title != "Review a charging stop before your trip" ||
		got[0].Evidence[0].ChargingReadiness == nil ||
		got[0].Evidence[0].ChargingReadiness.Kind != string(readiness.DecisionTripReview) {
		t.Fatalf("unachievable trip review = %+v", got)
	}
	legs["return_use_low_pct"], legs["return_use_high_pct"] = 95, 90
	request(http.MethodPut, planPath, "subject-a", input, http.StatusBadRequest)
	input["enabled"] = false
	legs["return_use_low_pct"], legs["return_use_high_pct"] = 90, 95
	request(http.MethodPut, planPath, "subject-a", input, http.StatusOK)
	if got := items("subject-a"); len(got) != 0 {
		t.Fatalf("disabled plan retained a recommendation: %+v", got)
	}
}

func TestPrivateChargingPlanThroughWorkerAndHandlers(t *testing.T) {
	repo, db := testRepository(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(context.Background(), string(migration)); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	live := &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":             {Raw: 45.0, Timestamp: now},
		"DetailedChargeState":      {Raw: "Disconnected", Timestamp: now},
		"Gear":                     {Raw: "P", Timestamp: now},
		"LocationLatitude":         {Raw: 47.1, Timestamp: now},
		"LocationLongitude":        {Raw: -122.1, Timestamp: now},
		"NominalFullPackEnergyKwh": {Raw: 80000.0, Timestamp: now},
		"ACChargingPower":          {Raw: 10000.0, Timestamp: now},
	}}
	site := &controlledSite{}
	service := smartreadinesssvc.New(repo, live, site, smartreadinesssvc.WithClock(func() time.Time { return now }))
	actionService := actioncentersvc.New(
		emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithSmartCharging(service), actioncentersvc.WithClock(func() time.Time { return now }),
	)
	buildRouter := func(header string) http.Handler {
		router := chi.NewRouter()
		router.Route("/api/v1", func(r chi.Router) {
			readinesshandler.NewHandler(service, header).MountRoutes(r)
			action := actionhandler.NewHandler(actionService, header)
			r.Get("/action-center", action.List)
			r.Post("/action-center/{recommendationID}/actions", action.ApplyAction)
		})
		return router
	}
	router := buildRouter("X-Test-Subject")
	request := func(router http.Handler, method, path, subject string, body any, impersonate bool) *httptest.ResponseRecorder {
		t.Helper()
		var payload bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&payload).Encode(body); err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, &payload)
		if subject != "" {
			req.Header.Set("X-Test-Subject", subject)
		}
		if impersonate {
			req = req.WithContext(tsauth.WithImpersonationForTests(req.Context(), tsauth.ImpersonationClaim{
				OriginalAdmin: "synthetic-admin", Target: subject,
			}))
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	requireStatus := func(rec *httptest.ResponseRecorder, status int) {
		t.Helper()
		if rec.Code != status || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("status = %d, cache = %q, want %d no-store; body = %s",
				rec.Code, rec.Header().Get("Cache-Control"), status, rec.Body.String())
		}
	}
	actionItems := func(router http.Handler, subject, query string, impersonate bool) []actiondomain.Recommendation {
		t.Helper()
		rec := request(router, http.MethodGet, "/api/v1/action-center"+query, subject, nil, impersonate)
		requireStatus(rec, http.StatusOK)
		var page actiondomain.Response
		if err := json.NewDecoder(rec.Body).Decode(&page); err != nil {
			t.Fatal(err)
		}
		return page.Items
	}

	const owner = "open-mode"
	plansPath := "/api/v1/smart-charging/plans"
	rec := request(router, http.MethodGet, plansPath+"?vehicle_id=7", owner, nil, false)
	requireStatus(rec, http.StatusOK)
	var initial struct {
		Data []readiness.Plan `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&initial); err != nil || len(initial.Data) != 0 {
		t.Fatalf("initial plans = %+v, %v", initial.Data, err)
	}
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 0 || live.readCount() != 0 {
		t.Fatalf("default-off processing = %d, reads = %d, error = %v", count, live.readCount(), err)
	}
	requireStatus(request(router, http.MethodGet, plansPath+"?vehicle_id=7", "", nil, false), http.StatusUnauthorized)
	requireStatus(request(router, http.MethodGet, plansPath+"?vehicle_id=7", owner, nil, true), http.StatusForbidden)
	requireStatus(request(buildRouter(""), http.MethodGet, plansPath+"?vehicle_id=7", "", nil, false), http.StatusOK)

	input := map[string]any{
		"vehicle_id": 7, "charging_place_id": 9, "enabled": false,
		"notify_at": now, "departure_at": now.Add(12 * time.Hour),
		"trip_use_low_pct": 35, "trip_use_high_pct": 45, "reserve_pct": 20,
	}
	rec = request(router, http.MethodPost, plansPath, owner, input, false)
	requireStatus(rec, http.StatusCreated)
	var created struct {
		Data readiness.Plan `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil || created.Data.ID <= 0 {
		t.Fatalf("created plan = %+v, %v", created.Data, err)
	}
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 0 || live.readCount() != 0 {
		t.Fatalf("disabled processing = %d, reads = %d, error = %v", count, live.readCount(), err)
	}
	latestPath := "/api/v1/smart-charging/latest-start?vehicle_id=7"
	var latest struct {
		Data []readiness.LatestStart `json:"data"`
	}
	rec = request(router, http.MethodGet, latestPath, owner, nil, false)
	requireStatus(rec, http.StatusOK)
	if json.NewDecoder(rec.Body).Decode(&latest) != nil || len(latest.Data) != 0 || live.readCount() != 0 {
		t.Fatalf("disabled latest-start lookup = %d, %+v, signal reads=%d", rec.Code, latest, live.readCount())
	}
	path := fmt.Sprintf("%s/%d", plansPath, created.Data.ID)
	input["expected_version"], input["expected_check_at"] = created.Data.Version, created.Data.NotifyAt
	input["enabled"] = true
	requireStatus(request(router, http.MethodPut, path, "subject-b", input, false), http.StatusNotFound)
	rec = request(router, http.MethodPut, path, owner, input, false)
	requireStatus(rec, http.StatusOK)
	recordPlanRevision(t, input, rec)
	if _, err := db.Pool.Exec(context.Background(),
		`UPDATE smart_charging_plans SET notify_at=$2 WHERE id=$1`, created.Data.ID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	latest = struct {
		Data []readiness.LatestStart `json:"data"`
	}{}
	rec = request(router, http.MethodGet, latestPath, "subject-b", nil, false)
	requireStatus(rec, http.StatusOK)
	if json.NewDecoder(rec.Body).Decode(&latest) != nil || len(latest.Data) != 0 || live.readCount() != 0 {
		t.Fatalf("foreign latest-start lookup = %d, %+v, signal reads=%d", rec.Code, latest, live.readCount())
	}
	latest = struct {
		Data []readiness.LatestStart `json:"data"`
	}{}
	rec = request(router, http.MethodGet, latestPath, owner, nil, false)
	requireStatus(rec, http.StatusOK)
	if json.NewDecoder(rec.Body).Decode(&latest) != nil ||
		len(latest.Data) != 1 || latest.Data[0].Status != readiness.LatestStartUnavailable ||
		latest.Data[0].Reason != readiness.LatestStartReasonNotCharging {
		t.Fatalf("unplugged latest-start lookup = %d, %+v", rec.Code, latest)
	}
	if _, err := db.Pool.Exec(context.Background(),
		`UPDATE smart_charging_plans SET notify_at=$2 WHERE id=$1`, created.Data.ID, now); err != nil {
		t.Fatal(err)
	}
	if items := actionItems(router, owner, "?vehicle_id=7", false); len(items) != 0 {
		t.Fatalf("candidate before processing = %+v", items)
	}
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 1 {
		t.Fatalf("worker processing = %d, %v", count, err)
	}
	items := actionItems(router, owner, "?vehicle_id=7", false)
	if len(items) != 1 || items[0].SourceFeature != actiondomain.SourceSmartCharging ||
		items[0].Evidence[0].ChargingReadiness == nil ||
		items[0].Evidence[0].ChargingReadiness.ArrivalHighPct != 10 {
		t.Fatalf("private readiness card = %+v", items)
	}
	for _, read := range []struct {
		router      http.Handler
		subject     string
		query       string
		impersonate bool
	}{
		{router, "subject-b", "?vehicle_id=7", false},
		{router, owner, "?vehicle_id=8", false},
		{router, owner, "?vehicle_id=7", true},
		{buildRouter(""), "", "?vehicle_id=7", false},
	} {
		if got := actionItems(read.router, read.subject, read.query, read.impersonate); len(got) != 0 {
			t.Fatalf("unauthorized recommendation = %+v", got)
		}
	}
	actionPath := fmt.Sprintf("/api/v1/action-center/%s/actions", items[0].ID)
	action := map[string]any{
		"fingerprint": items[0].Fingerprint, "action": "dismiss", "expected_version": 0, "confirmed": true,
	}
	requireStatus(request(router, http.MethodPost, actionPath, owner, action, false), http.StatusBadRequest)
	requireStatus(request(router, http.MethodPost, actionPath, "subject-b", action, false), http.StatusNotFound)
	snoozePath := path + "/snooze"
	snooze := map[string]any{"vehicle_id": 7, "duration_s": 3600}
	requireStatus(request(router, http.MethodPost, snoozePath, "subject-b", snooze, false), http.StatusNotFound)
	requireStatus(request(router, http.MethodPost, snoozePath, owner, snooze, false), http.StatusNoContent)
	if got := actionItems(router, owner, "?vehicle_id=7", false); len(got) != 0 {
		t.Fatalf("snoozed recommendation = %+v", got)
	}
	readsBeforeSnoozedEstimate := live.readCount()
	latest = struct {
		Data []readiness.LatestStart `json:"data"`
	}{}
	rec = request(router, http.MethodGet, latestPath, owner, nil, false)
	requireStatus(rec, http.StatusOK)
	if json.NewDecoder(rec.Body).Decode(&latest) != nil || len(latest.Data) != 0 ||
		live.readCount() != readsBeforeSnoozedEstimate {
		t.Fatalf("snoozed latest-start lookup = %d, %+v, signal reads=%d",
			rec.Code, latest, live.readCount())
	}
	snooze["duration_s"] = 0
	requireStatus(request(router, http.MethodPost, snoozePath, owner, snooze, false), http.StatusNoContent)
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 1 {
		t.Fatalf("resumed processing = %d, %v", count, err)
	}
	live.setChargeState("Charging")
	latest = struct {
		Data []readiness.LatestStart `json:"data"`
	}{}
	rec = request(router, http.MethodGet, latestPath, owner, nil, false)
	requireStatus(rec, http.StatusOK)
	if json.NewDecoder(rec.Body).Decode(&latest) != nil ||
		len(latest.Data) != 1 || latest.Data[0].Status != readiness.LatestStartEstimate ||
		latest.Data[0].ChargingPowerW != 10000 || latest.Data[0].EarliestSafeStartAt == nil ||
		latest.Data[0].LatestSafeStartAt == nil {
		t.Fatalf("measured-power latest-start lookup = %d, %+v", rec.Code, latest)
	}
	site.outside = true
	latest = struct {
		Data []readiness.LatestStart `json:"data"`
	}{}
	rec = request(router, http.MethodGet, latestPath, owner, nil, false)
	requireStatus(rec, http.StatusOK)
	if json.NewDecoder(rec.Body).Decode(&latest) != nil || len(latest.Data) != 1 ||
		latest.Data[0].Status != readiness.LatestStartUnavailable ||
		latest.Data[0].Reason != readiness.LatestStartReasonOutsideSite ||
		latest.Data[0].EarliestSafeStartAt != nil || latest.Data[0].LatestSafeStartAt != nil {
		t.Fatalf("outside-place latest-start lookup = %d, %+v", rec.Code, latest)
	}
	site.outside = false
	if got := actionItems(router, owner, "?vehicle_id=7", false); len(got) != 0 {
		t.Fatalf("resolved recommendation = %+v", got)
	}
	if _, err := db.Pool.Exec(context.Background(), `DELETE FROM geofences WHERE id=9`); err != nil {
		t.Fatal(err)
	}
	input["charging_place_id"] = nil
	input["enabled"] = false
	rec = request(router, http.MethodGet, plansPath+"?vehicle_id=7", owner, nil, false)
	requireStatus(rec, http.StatusOK)
	var current struct{ Data []readiness.Plan }
	if err := json.NewDecoder(rec.Body).Decode(&current); err != nil || len(current.Data) != 1 ||
		current.Data[0].ID != created.Data.ID || current.Data[0].ChargingPlaceID != nil {
		t.Fatalf("reload plan after snoozing and removing its place: %+v, %v", current.Data, err)
	}
	input["expected_version"], input["expected_check_at"] = current.Data[0].Version, current.Data[0].NotifyAt
	requireStatus(request(router, http.MethodPut, path, owner, input, false), http.StatusOK)
	reads := live.readCount()
	if count, err := service.ProcessDue(context.Background(), 10); err != nil || count != 0 || live.readCount() != reads {
		t.Fatalf("disabled site-less processing = %d, reads = %d, error = %v", count, live.readCount(), err)
	}
	requireStatus(request(router, http.MethodDelete, path+"?vehicle_id=7", owner, nil, false), http.StatusNoContent)
}

func recordPlanRevision(t *testing.T, input map[string]any, response *httptest.ResponseRecorder) {
	t.Helper()
	var saved struct{ Data readiness.Plan }
	if err := json.Unmarshal(response.Body.Bytes(), &saved); err != nil || saved.Data.Version <= 0 {
		t.Fatalf("read plan revision: %s (%v)", response.Body, err)
	}
	input["expected_version"], input["expected_check_at"] = saved.Data.Version, saved.Data.NotifyAt
}

func TestSharedOpenChargingIsIsolatedAndProcessedOnlyInItsMode(t *testing.T) {
	repo, db := testRepository(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(context.Background(), string(migration)); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	live := &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":        {Raw: 45.0, Timestamp: now},
		"DetailedChargeState": {Raw: "Disconnected", Timestamp: now},
		"Gear":                {Raw: "P", Timestamp: now},
		"LocationLatitude":    {Raw: 47.1, Timestamp: now},
		"LocationLongitude":   {Raw: -122.1, Timestamp: now},
	}}
	clock := smartreadinesssvc.WithClock(func() time.Time { return now })
	authWorker := smartreadinesssvc.New(repo, live, controlledSite{}, clock)
	openWorker := smartreadinesssvc.New(repo, live, controlledSite{}, clock, smartreadinesssvc.WithSharedOpenMode(true))
	actionService := actioncentersvc.New(
		emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithSmartCharging(authWorker), actioncentersvc.WithClock(func() time.Time { return now }),
	)
	buildRouter := func(header string) http.Handler {
		router := chi.NewRouter()
		router.Route("/api/v1", func(r chi.Router) {
			readinesshandler.NewHandler(authWorker, header).MountRoutes(r)
			action := actionhandler.NewHandler(actionService, header)
			r.Get("/action-center", action.List)
			r.Post("/action-center/{recommendationID}/actions", action.ApplyAction)
		})
		return router
	}
	authRouter, openRouter := buildRouter("X-Test-Subject"), buildRouter("")
	request := func(router http.Handler, method, path, subject, expected string, body any, impersonate bool) *httptest.ResponseRecorder {
		t.Helper()
		var payload bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&payload).Encode(body); err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, &payload)
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set(tsauth.ExpectedPrincipalHeader, expected)
		if impersonate {
			req = req.WithContext(tsauth.WithImpersonationForTests(req.Context(), tsauth.ImpersonationClaim{
				OriginalAdmin: "synthetic-admin", Target: subject,
			}))
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("cache-control = %q", rec.Header().Get("Cache-Control"))
		}
		return rec
	}
	requireStatus := func(rec *httptest.ResponseRecorder, status int) {
		t.Helper()
		if rec.Code != status {
			t.Fatalf("status = %d, want %d; body = %s", rec.Code, status, rec.Body.String())
		}
	}
	plans := func(router http.Handler, subject, expected string) []readiness.Plan {
		t.Helper()
		rec := request(router, http.MethodGet, "/api/v1/smart-charging/plans?vehicle_id=7", subject, expected, nil, false)
		requireStatus(rec, http.StatusOK)
		var result struct {
			Data []readiness.Plan `json:"data"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result.Data
	}
	items := func(router http.Handler, subject, expected string, impersonate bool) []actiondomain.Recommendation {
		t.Helper()
		rec := request(router, http.MethodGet, "/api/v1/action-center?vehicle_id=7", subject, expected, nil, impersonate)
		requireStatus(rec, http.StatusOK)
		var result actiondomain.Response
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return result.Items
	}
	const owner = "open-mode"
	const path = "/api/v1/smart-charging/plans"
	input := map[string]any{
		"vehicle_id": 7, "charging_place_id": 9, "enabled": true,
		"notify_at": now, "departure_at": now.Add(12 * time.Hour),
		"trip_use_low_pct": 35, "trip_use_high_pct": 45, "reserve_pct": 20,
	}
	requireStatus(request(authRouter, http.MethodPost, path, owner, "subject:open-mode", input, false), http.StatusCreated)
	authPlans := plans(authRouter, owner, "subject:open-mode")
	if len(authPlans) != 1 || len(plans(openRouter, owner, "open")) != 0 {
		t.Fatal("open scope saw an authenticated plan")
	}
	if count, err := openWorker.ProcessDue(context.Background(), 10); err != nil || count != 0 || live.readCount() != 0 {
		t.Fatalf("open worker processed authenticated plans: count=%d reads=%d err=%v", count, live.readCount(), err)
	}
	requireStatus(request(openRouter, http.MethodPost, path, owner, "subject:open-mode", input, false), http.StatusConflict)
	requireStatus(request(openRouter, http.MethodPost, path, owner, "open", input, false), http.StatusCreated)
	openPlans := plans(openRouter, owner, "open")
	if len(openPlans) != 1 || openPlans[0].ID == authPlans[0].ID ||
		len(plans(authRouter, "subject-b", "subject:subject-b")) != 0 {
		t.Fatalf("owner isolation failed: authenticated=%+v shared=%+v", authPlans, openPlans)
	}
	if count, err := authWorker.ProcessDue(context.Background(), 10); err != nil || count != 1 {
		t.Fatalf("authenticated worker processed %d plans: %v", count, err)
	}
	if count, err := authWorker.ProcessDue(context.Background(), 10); err != nil || count != 0 {
		t.Fatalf("authenticated worker processed shared plan: count=%d err=%v", count, err)
	}
	if got := items(openRouter, owner, "open", false); len(got) != 0 {
		t.Fatalf("shared inbox saw authenticated decision: %+v", got)
	}
	if count, err := openWorker.ProcessDue(context.Background(), 10); err != nil || count != 1 {
		t.Fatalf("open worker processed %d plans: %v", count, err)
	}
	openItems := items(openRouter, owner, "open", false)
	authItems := items(authRouter, owner, "subject:open-mode", false)
	if len(openItems) != 1 || len(authItems) != 1 ||
		len(openItems[0].Evidence) != 1 || len(authItems[0].Evidence) != 1 ||
		openItems[0].Evidence[0].ChargingReadiness == nil ||
		authItems[0].Evidence[0].ChargingReadiness == nil ||
		openItems[0].Evidence[0].ChargingReadiness.PlanID != openPlans[0].ID ||
		authItems[0].Evidence[0].ChargingReadiness.PlanID != authPlans[0].ID {
		t.Fatalf("recommendation isolation failed: authenticated=%+v shared=%+v", authItems, openItems)
	}
	if len(items(openRouter, owner, "open", true)) != 0 ||
		len(items(authRouter, owner, "subject:open-mode", true)) != 0 {
		t.Fatal("impersonation exposed a charging recommendation")
	}
	authPath := fmt.Sprintf("%s/%d/snooze", path, authPlans[0].ID)
	openPath := fmt.Sprintf("%s/%d/snooze", path, openPlans[0].ID)
	snooze := map[string]int64{"vehicle_id": 7, "duration_s": 3600}
	requireStatus(request(openRouter, http.MethodPost, authPath, owner, "open", snooze, false), http.StatusNotFound)
	requireStatus(request(authRouter, http.MethodPost, openPath, owner, "subject:open-mode", snooze, false), http.StatusNotFound)
	requireStatus(request(openRouter, http.MethodPost, openPath, owner, "open", snooze, false), http.StatusNoContent)
	if len(items(openRouter, owner, "open", false)) != 0 || len(items(authRouter, owner, "subject:open-mode", false)) != 1 {
		t.Fatal("shared snooze affected an authenticated recommendation")
	}
}

func TestUnavailableScopeNeverReadsLiveSignals(t *testing.T) {
	for _, scenario := range []struct {
		name string
		sql  string
	}{
		{"archived vehicle", `UPDATE vehicles SET archived_at=now() WHERE id=7`},
		{"disabled place", `UPDATE geofences SET enabled=false WHERE id=9`},
		{"unreviewed place", `UPDATE geofences SET needs_review=true WHERE id=9`},
		{"archived place", `UPDATE geofences SET archived_at=now() WHERE id=9`},
		{"place no longer charging", `UPDATE geofences SET is_charging_location=false WHERE id=9`},
		{"deleted place", `DELETE FROM geofences WHERE id=9`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			repo, db := testRepository(t)
			ctx := context.Background()
			now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
			if _, err := repo.SavePlan(ctx, "synthetic-owner", testPlan(now), now); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Pool.Exec(ctx, scenario.sql); err != nil {
				t.Fatal(err)
			}
			live := &controlledLive{}
			service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithClock(func() time.Time { return now }))
			if count, err := service.ProcessDue(ctx, 10); err != nil || count != 0 || live.readCount() != 0 {
				t.Fatalf("processing unavailable scope = %d, reads = %d, error = %v", count, live.readCount(), err)
			}
			if rows, err := service.ListCandidates(ctx, "synthetic-owner", nil, now, 10); err != nil || len(rows) != 0 || live.readCount() != 0 {
				t.Fatalf("listing unavailable scope = %+v, reads = %d, error = %v", rows, live.readCount(), err)
			}
		})
	}
}
