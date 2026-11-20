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

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	commutedb "github.com/ev-dev-labs/teslasync/internal/database/smartcommute"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	commute "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	commutehandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type driveQueryTracer struct {
	count   atomic.Int64
	block   atomic.Bool
	started chan struct{}
	release chan struct{}
}

func (s *driveQueryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(strings.ToLower(data.SQL), "from drives") {
		s.count.Add(1)
		if s.block.CompareAndSwap(true, false) {
			close(s.started)
			select {
			case <-s.release:
			case <-ctx.Done():
			}
		}
	}
	return ctx
}

func (*driveQueryTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func testDatabase(t *testing.T, spy *driveQueryTracer) *database.DB {
	t.Helper()
	dsn := os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN")
	if dsn == "" {
		t.Skip("TESLASYNC_SMART_COMMUTE_TEST_DSN is required for the disposable database integration test")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "teslasync_test" && config.ConnConfig.Database != "teslasync_smart_test" {
		t.Fatal("integration test requires a database named teslasync_test or teslasync_smart_test")
	}
	ctx := context.Background()
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("smart_commute_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	config.ConnConfig.Tracer = spy
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE")
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Errorf("drop disposable schema: %v", err)
		}
		admin.Close()
	})
	if _, err := pool.Exec(ctx, `
		CREATE TABLE vehicles (id bigint PRIMARY KEY, display_name text NOT NULL, archived_at timestamptz);
		CREATE TABLE drives (
		  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, vehicle_id bigint NOT NULL,
		  started_at timestamptz NOT NULL, ended_at timestamptz,
		  start_lat double precision, start_lng double precision,
		  end_lat double precision, end_lng double precision
		);
		CREATE INDEX drives_vehicle_started ON drives(vehicle_id, started_at DESC);
		CREATE TABLE signal_log (
		  vehicle_id bigint NOT NULL, ts timestamptz NOT NULL, field text NOT NULL,
		  value_kind smallint NOT NULL, str_value text, bool_value boolean, int_value bigint,
		  float_value double precision, time_value timestamptz, received_at timestamptz NOT NULL,
		  PRIMARY KEY (vehicle_id, field, ts)
		);`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"000223_action_center_state.up.sql", "000259_smart_commute.up.sql", "000268_smart_commute_traffic_consent.up.sql"} {
		content, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", file))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(content)); err != nil {
			t.Fatalf("apply %s: %v", file, err)
		}
	}
	return &database.DB{Pool: pool}
}

type emptyActionSources struct{}

func (emptyActionSources) ListActiveAlerts(context.Context, *int64, time.Time, int) ([]actiondomain.AlertRecord, error) {
	return nil, nil
}
func (emptyActionSources) ListLatestBatteryHealth(context.Context, *int64, int) ([]actiondomain.BatteryHealthRecord, error) {
	return nil, nil
}
func (emptyActionSources) ListStaleChargingSessions(context.Context, *int64, time.Time, int) ([]actiondomain.ChargingRecord, error) {
	return nil, nil
}
func (emptyActionSources) ListDriveEfficiencyEvidence(context.Context, *int64, time.Time, time.Time, int, float64, float64, int) ([]actiondomain.DriveEfficiencyRecord, error) {
	return nil, nil
}
func (emptyActionSources) ListActiveWorkOrders(context.Context, *int64, int) ([]actiondomain.WorkOrderRecord, error) {
	return nil, nil
}
func (emptyActionSources) ListCommandReliability(context.Context, *int64, time.Time, time.Time, int) ([]actiondomain.CommandReliabilityRecord, error) {
	return nil, nil
}
func (emptyActionSources) ListSignalHealth(context.Context, *int64, time.Time, time.Time, int) ([]actiondomain.SignalHealthRecord, error) {
	return nil, nil
}
func (emptyActionSources) ListActiveVehicles(context.Context, *int64, int) ([]actiondomain.VehicleRef, error) {
	return nil, nil
}
func (emptyActionSources) ListOpenSystemIncidents(context.Context, int) ([]actiondomain.SystemIncidentRecord, error) {
	return nil, nil
}

type fixture struct {
	router  http.Handler
	db      *database.DB
	spy     *driveQueryTracer
	now     time.Time
	commute *smartcommutesvc.Service
}

func newFixture(t *testing.T, options ...smartcommutesvc.Option) *fixture {
	t.Helper()
	spy := &driveQueryTracer{}
	db := testDatabase(t, spy)
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 7, 7, 45, 0, 0, loc)
	ctx := context.Background()
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO vehicles(id, display_name, archived_at) VALUES
		  (42, 'Synthetic vehicle A', NULL), (43, 'Synthetic vehicle B', NULL),
		  (44, 'Archived vehicle', now())`); err != nil {
		t.Fatal(err)
	}
	for week := 1; week <= 7; week++ {
		day := now.AddDate(0, 0, -7*week)
		start := time.Date(day.Year(), day.Month(), day.Day(), 8, week, 0, 0, loc)
		if _, err := db.Pool.Exec(ctx, `
			INSERT INTO drives(vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng)
			VALUES (42, $1, $2, 47.1, -122.1, 47.2, -122.2)`,
			start, start.Add(30*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	f := &fixture{db: db, spy: spy, now: now}
	clock := func() time.Time { return f.now }
	baseOptions := []smartcommutesvc.Option{smartcommutesvc.WithClock(clock),
		smartcommutesvc.WithTrafficConnector(true),
		smartcommutesvc.WithTrafficTraceReader(signal.NewLogStateReader(db.Pool, zerolog.Nop()))}
	service := smartcommutesvc.New(commutedb.NewRepository(db), append(baseOptions, options...)...)
	f.commute = service
	commuteHTTP := commutehandler.NewHandler(service, "X-Test-Subject")
	actionService := actioncentersvc.New(
		emptyActionSources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithSmartCommute(service), actioncentersvc.WithClock(clock),
	)
	actionHTTP := actionhandler.NewHandler(actionService, "X-Test-Subject")
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		commuteHTTP.MountRoutes(r)
		r.Get("/action-center", actionHTTP.List)
		r.Post("/action-center/{recommendationID}/actions", actionHTTP.ApplyAction)
		r.Get("/action-center/{recommendationID}/history", actionHTTP.History)
	})
	f.router = router
	return f
}

func (f *fixture) sharedRouter() http.Handler {
	service := smartcommutesvc.New(commutedb.NewRepository(f.db), smartcommutesvc.WithClock(func() time.Time { return f.now }))
	actionService := actioncentersvc.New(
		emptyActionSources{}, actiondb.NewStateRepository(f.db),
		actioncentersvc.WithSmartCommute(service), actioncentersvc.WithClock(func() time.Time { return f.now }),
	)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		commutehandler.NewHandler(service, "").MountRoutes(r)
		action := actionhandler.NewHandler(actionService, "")
		r.Get("/action-center", action.List)
		r.Post("/action-center/{recommendationID}/actions", action.ApplyAction)
		r.Get("/action-center/{recommendationID}/history", action.History)
	})
	return router
}

func (f *fixture) request(t *testing.T, method, path, subject string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var content bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&content).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	request := httptest.NewRequest(method, path, &content)
	if subject != "" {
		request.Header.Set("X-Test-Subject", subject)
	}
	response := httptest.NewRecorder()
	f.router.ServeHTTP(response, request)
	return response
}

func expectStatus(t *testing.T, response *httptest.ResponseRecorder, status int) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
}

func snapshot(t *testing.T, response *httptest.ResponseRecorder) commute.Snapshot {
	t.Helper()
	expectStatus(t, response, http.StatusOK)
	var envelope struct {
		Data commute.Snapshot `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data
}

func settings(vehicleID int64, enabled, analysis, paused bool) map[string]any {
	return map[string]any{
		"vehicle_id": vehicleID, "enabled": enabled, "local_analysis_enabled": analysis,
		"paused": paused, "time_zone": "America/Los_Angeles",
	}
}

func manualRoutine(vehicleID int64) map[string]any {
	return map[string]any{
		"vehicle_id": vehicleID, "name": "Office", "weekday": 2, "departure_s": 28800,
		"time_zone":   "America/Los_Angeles",
		"origin":      map[string]float64{"latitude": 47.1, "longitude": -122.1},
		"destination": map[string]float64{"latitude": 47.2, "longitude": -122.2},
	}
}

func TestPrivateEnrollmentAndDecisionJourney(t *testing.T) {
	f := newFixture(t)
	const owner = "open-mode" // This is a verified subject, not the open-mode fallback.
	const other = "subject-b"
	initial := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if initial.Settings.Enabled || initial.Settings.LocalAnalysisEnabled || len(initial.Routines) != 0 || f.spy.count.Load() != 0 {
		t.Fatalf("fresh install was not quiet: %+v; scans=%d", initial, f.spy.count.Load())
	}
	expectStatus(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", "", nil), http.StatusUnauthorized)
	for _, path := range []string{"/api/v1/smart-commute?vehicle_id=42", "/api/v1/action-center?vehicle_id=42"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-Test-Subject", other)
		req.Header.Set("X-TeslaSync-Expected-Principal", "subject:open-mode")
		rec := httptest.NewRecorder()
		f.router.ServeHTTP(rec, req)
		expectStatus(t, rec, http.StatusConflict)
		if !strings.Contains(rec.Body.String(), "IDENTITY_CHANGED") {
			t.Fatalf("identity race response = %s", rec.Body.String())
		}
	}
	expectStatus(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=44", owner, nil), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, false)), http.StatusNoContent)
	if f.spy.count.Load() != 1 {
		t.Fatalf("consented history scans = %d, want 1", f.spy.count.Load())
	}
	got := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 || got.Routines[0].Status != commute.RoutineSuggested ||
		got.Routines[0].Weekday != time.Tuesday || got.Routines[0].Evidence == nil ||
		got.Routines[0].Evidence.MatchingDays != 7 {
		t.Fatalf("learned routines = %+v", got.Routines)
	}
	routineID := got.Routines[0].ID
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", other, settings(42, true, false, false)), http.StatusNoContent)
	otherSnapshot := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", other, nil))
	if len(otherSnapshot.Routines) != 0 || f.spy.count.Load() != 1 {
		t.Fatalf("other subject received private routines or caused a scan: %+v", otherSnapshot)
	}
	path := fmt.Sprintf("/api/v1/smart-commute/routines/%d", routineID)
	expectStatus(t, f.request(t, http.MethodPut, path, other, manualRoutine(42)), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(43, true, false, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPut, path, owner, manualRoutine(43)), http.StatusNotFound)

	ownerPage := f.request(t, http.MethodGet, "/api/v1/action-center?vehicle_id=42", owner, nil)
	expectStatus(t, ownerPage, http.StatusOK)
	if ownerPage.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private recommendation response was cacheable")
	}
	var page actiondomain.Response
	if err := json.NewDecoder(ownerPage.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].SourceFeature != actiondomain.SourceSmartCommute ||
		page.Items[0].NavigationPath == nil || !strings.Contains(*page.Items[0].NavigationPath, "vehicle_id=42") {
		t.Fatalf("owner action center = %+v", page.Items)
	}
	if len(page.Items[0].Evidence) != 1 || page.Items[0].Evidence[0].RecurringDrive == nil ||
		page.Items[0].Evidence[0].RecurringDrive.RoutineID != routineID ||
		page.Items[0].Evidence[0].RecurringDrive.MatchingDays != 7 ||
		page.Items[0].Evidence[0].RecurringDrive.Weekday != int(time.Tuesday) {
		t.Fatalf("typed recurring-drive evidence = %+v", page.Items[0].Evidence)
	}
	for _, action := range []actiondomain.ActionType{
		actiondomain.ActionSmartCommuteUse, actiondomain.ActionSmartCommuteEdit,
		actiondomain.ActionSmartCommuteDecline, actiondomain.ActionSmartCommuteSnooze,
	} {
		found := false
		for _, available := range page.Items[0].SafeActions {
			found = found || available == action
		}
		if !found {
			t.Fatalf("missing routine action %q in %+v", action, page.Items[0].SafeActions)
		}
	}
	for _, path := range []string{"/api/v1/smart-commute?vehicle_id=42", "/api/v1/action-center?vehicle_id=42"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-Test-Subject", owner)
		req = req.WithContext(tsauth.WithImpersonationForTests(req.Context(), tsauth.ImpersonationClaim{
			OriginalAdmin: "synthetic-admin", Target: owner,
		}))
		rec := httptest.NewRecorder()
		f.router.ServeHTTP(rec, req)
		if strings.Contains(path, "/smart-commute?") {
			expectStatus(t, rec, http.StatusForbidden)
		} else {
			expectStatus(t, rec, http.StatusOK)
			var impersonated actiondomain.Response
			if err := json.NewDecoder(rec.Body).Decode(&impersonated); err != nil {
				t.Fatal(err)
			}
			if len(impersonated.Items) != 0 {
				t.Fatalf("impersonation exposed private recommendations: %+v", impersonated.Items)
			}
		}
	}
	otherPage := f.request(t, http.MethodGet, "/api/v1/action-center?vehicle_id=42", other, nil)
	expectStatus(t, otherPage, http.StatusOK)
	var otherActionPage actiondomain.Response
	if err := json.NewDecoder(otherPage.Body).Decode(&otherActionPage); err != nil {
		t.Fatal(err)
	}
	if len(otherActionPage.Items) != 0 {
		t.Fatalf("other subject received private recommendations: %+v", otherActionPage.Items)
	}
	item := page.Items[0]
	// A real forwarded subject can equal the open-mode fallback; disabling auth
	// must not expose that subject's saved recommendations to anonymous users.
	openService := actioncentersvc.New(
		emptyActionSources{}, actiondb.NewStateRepository(f.db),
		actioncentersvc.WithSmartCommute(smartcommutesvc.New(commutedb.NewRepository(f.db))),
		actioncentersvc.WithClock(func() time.Time { return f.now }),
	)
	openHandler := actionhandler.NewHandler(openService, "")
	openRouter := chi.NewRouter()
	openRouter.Get("/action-center", openHandler.List)
	openRouter.Post("/action-center/{recommendationID}/actions", openHandler.ApplyAction)
	openList := httptest.NewRecorder()
	openRouter.ServeHTTP(openList, httptest.NewRequest(http.MethodGet, "/action-center?vehicle_id=42", nil))
	expectStatus(t, openList, http.StatusOK)
	var openPage actiondomain.Response
	if err := json.NewDecoder(openList.Body).Decode(&openPage); err != nil {
		t.Fatal(err)
	}
	if len(openPage.Items) != 0 {
		t.Fatalf("open mode exposed private recommendations: %+v", openPage.Items)
	}
	unsupported := map[string]any{
		"fingerprint": item.Fingerprint, "action": "dismiss", "expected_version": 0, "confirmed": true,
	}
	openActionBody, err := json.Marshal(unsupported)
	if err != nil {
		t.Fatal(err)
	}
	openAction := httptest.NewRecorder()
	openRouter.ServeHTTP(openAction, httptest.NewRequest(
		http.MethodPost, "/action-center/"+item.ID+"/actions", bytes.NewReader(openActionBody),
	))
	expectStatus(t, openAction, http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPost, "/api/v1/action-center/"+item.ID+"/actions", owner, unsupported), http.StatusBadRequest)
	unsupported["action"] = actiondomain.ActionSmartCommuteDecline
	expectStatus(t, f.request(t, http.MethodPost, "/api/v1/action-center/"+item.ID+"/actions", owner, unsupported), http.StatusBadRequest)

	expectStatus(t, f.request(t, http.MethodPost, path+"/decline", owner, map[string]int64{"vehicle_id": 42}), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, "/api/v1/smart-commute/analyses", owner, map[string]int64{"vehicle_id": 42}), http.StatusNoContent)
	if got = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil)); len(got.Routines) != 0 {
		t.Fatalf("declined routine resurfaced: %+v", got.Routines)
	}
	expectStatus(t, f.request(t, http.MethodPost, "/api/v1/smart-commute/routines", owner, manualRoutine(42)), http.StatusCreated)
	beforePause := f.spy.count.Load()
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, true)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, "/api/v1/smart-commute/analyses", owner, map[string]int64{"vehicle_id": 42}), http.StatusConflict)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, false, false, false)), http.StatusNoContent)
	if f.spy.count.Load() != beforePause {
		t.Fatalf("pause or disable scanned history: %d -> %d", beforePause, f.spy.count.Load())
	}
	expectStatus(t, f.request(t, http.MethodDelete, "/api/v1/smart-commute?vehicle_id=42", owner, nil), http.StatusNoContent)
	got = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if got.Settings.Enabled || len(got.Routines) != 0 {
		t.Fatalf("deleted personal data remained: %+v", got)
	}
	var driveCount int
	if err := f.db.Pool.QueryRow(context.Background(), `SELECT count(*) FROM drives WHERE vehicle_id = 42`).Scan(&driveCount); err != nil || driveCount != 7 {
		t.Fatalf("source drives changed: count=%d err=%v", driveCount, err)
	}
}

func TestSnoozeSuggestionIsPrivateAndPersistsUntilExpiry(t *testing.T) {
	f := newFixture(t)
	const owner = "subject-a"
	const other = "subject-b"
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", other, settings(42, true, false, false)), http.StatusNoContent)
	got := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 {
		t.Fatalf("expected one suggestion, got %+v", got.Routines)
	}
	path := fmt.Sprintf("/api/v1/smart-commute/routines/%d/snooze", got.Routines[0].ID)
	snooze := map[string]int64{"vehicle_id": 42, "duration_s": 24 * 60 * 60}
	expectStatus(t, f.request(t, http.MethodPost, path, other, snooze), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPost, path, owner, map[string]int64{"vehicle_id": 42}), http.StatusBadRequest)
	expectStatus(t, f.request(t, http.MethodPost, path, owner, map[string]int64{"vehicle_id": 42, "duration_s": -1}), http.StatusBadRequest)
	expectStatus(t, f.request(t, http.MethodPost, path, owner, map[string]int64{"vehicle_id": 42, "duration_s": 30*24*60*60 + 1}), http.StatusBadRequest)
	expectStatus(t, f.request(t, http.MethodPost, path, owner, snooze), http.StatusNoContent)
	got = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 || got.Routines[0].SnoozedUntil == nil ||
		!got.Routines[0].SnoozedUntil.Equal(f.now.Add(24*time.Hour)) {
		t.Fatalf("snoozed suggestion = %+v", got.Routines)
	}
	assertCards := func(want int) {
		t.Helper()
		response := f.request(t, http.MethodGet, "/api/v1/action-center?vehicle_id=42", owner, nil)
		expectStatus(t, response, http.StatusOK)
		var page actiondomain.Response
		if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != want {
			t.Fatalf("recommendations = %+v, want %d", page.Items, want)
		}
	}
	assertCards(0)
	expectStatus(t, f.request(t, http.MethodPost, "/api/v1/smart-commute/analyses", owner, map[string]int64{"vehicle_id": 42}), http.StatusNoContent)
	assertCards(0)
	f.now = f.now.Add(24 * time.Hour)
	assertCards(1)
	got = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 || got.Routines[0].SnoozedUntil != nil {
		t.Fatalf("expired snooze remained active: %+v", got.Routines)
	}
	expectStatus(t, f.request(t, http.MethodPost, path, owner, snooze), http.StatusNoContent)
	assertCards(0)
	expectStatus(t, f.request(t, http.MethodPost, path, owner, map[string]int64{"vehicle_id": 42, "duration_s": 0}), http.StatusNoContent)
	assertCards(1)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, true)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, path, owner, snooze), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, false, false, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, path, owner, snooze), http.StatusConflict)
}

func TestConfirmEditAndPauseRecheck(t *testing.T) {
	f := newFixture(t)
	const owner = "subject-a"
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, false)), http.StatusNoContent)
	got := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 {
		t.Fatalf("expected one suggestion, got %+v", got.Routines)
	}
	path := fmt.Sprintf("/api/v1/smart-commute/routines/%d", got.Routines[0].ID)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, true)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPut, path, owner, manualRoutine(42)), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPost, path+"/decline", owner, map[string]int64{"vehicle_id": 42}), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPut, path, owner, manualRoutine(42)), http.StatusOK)
	got = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 || got.Routines[0].Status != commute.RoutineConfirmed || got.Routines[0].Name != "Office" {
		t.Fatalf("confirmed routine = %+v", got.Routines)
	}
	edited := manualRoutine(42)
	edited["name"] = "Workshop"
	expectStatus(t, f.request(t, http.MethodPut, path, owner, edited), http.StatusOK)
	got = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 || got.Routines[0].Name != "Workshop" {
		t.Fatalf("edited routine = %+v", got.Routines)
	}
	expectStatus(t, f.request(t, http.MethodDelete, path+"?vehicle_id=42", owner, nil), http.StatusNoContent)
}

func TestExpiredSuggestionCannotBeConfirmedOrDeclined(t *testing.T) {
	f := newFixture(t)
	const owner = "subject-a"
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, false)), http.StatusNoContent)
	got := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 1 {
		t.Fatalf("expected one suggestion, got %+v", got.Routines)
	}
	id := got.Routines[0].ID
	if _, err := f.db.Pool.Exec(context.Background(), `
		UPDATE smart_commute_routines SET evidence_first_at = $1, evidence_last_at = $2 WHERE id = $3`,
		f.now.Add(-70*24*time.Hour), f.now.Add(-60*24*time.Hour), id); err != nil {
		t.Fatal(err)
	}
	got = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(got.Routines) != 0 {
		t.Fatalf("expired suggestion remained visible: %+v", got.Routines)
	}
	path := fmt.Sprintf("/api/v1/smart-commute/routines/%d", id)
	expectStatus(t, f.request(t, http.MethodPut, path, owner, manualRoutine(42)), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPost, path+"/decline", owner, map[string]int64{"vehicle_id": 42}), http.StatusNotFound)
}

func TestDisableSerializesAgainstInFlightAnalysis(t *testing.T) {
	f := newFixture(t)
	const owner = "subject-a"
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, false)), http.StatusNoContent)
	f.spy.started = make(chan struct{})
	f.spy.release = make(chan struct{})
	f.spy.block.Store(true)
	analysisDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		analysisDone <- f.request(t, http.MethodPost, "/api/v1/smart-commute/analyses", owner, map[string]int64{"vehicle_id": 42})
	}()
	select {
	case <-f.spy.started:
	case <-time.After(5 * time.Second):
		t.Fatal("analysis did not reach the locked history query")
	}
	disableDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		disableDone <- f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, false, false, false))
	}()
	select {
	case result := <-disableDone:
		t.Fatalf("disable returned before in-flight analysis finished: %d", result.Code)
	case <-time.After(150 * time.Millisecond):
	}
	close(f.spy.release)
	expectStatus(t, <-analysisDone, http.StatusNoContent)
	expectStatus(t, <-disableDone, http.StatusNoContent)
	scans := f.spy.count.Load()
	expectStatus(t, f.request(t, http.MethodPost, "/api/v1/smart-commute/analyses", owner, map[string]int64{"vehicle_id": 42}), http.StatusConflict)
	if f.spy.count.Load() != scans {
		t.Fatal("analysis scanned history after disable completed")
	}
	got := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if got.Settings.Enabled || len(got.Routines) != 0 {
		t.Fatalf("disable left active suggestions: %+v", got)
	}
}

func TestSharedOpenCommuteIsIsolatedFromAuthenticatedUsers(t *testing.T) {
	f := newFixture(t)
	const owner = "open-mode"
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", owner, settings(42, true, true, false)), http.StatusNoContent)
	authenticated := snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(authenticated.Routines) != 1 {
		t.Fatalf("authenticated routines = %+v", authenticated.Routines)
	}

	router := f.sharedRouter()
	request := func(method, path, expected string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var payload bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&payload).Encode(body); err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, &payload)
		req.Header.Set("X-Test-Subject", owner)
		req.Header.Set(tsauth.ExpectedPrincipalHeader, expected)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("shared response was cacheable: %q", rec.Header().Get("Cache-Control"))
		}
		return rec
	}
	initial := snapshot(t, request(http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", "open", nil))
	if initial.Settings.Enabled || initial.Settings.LocalAnalysisEnabled || len(initial.Routines) != 0 {
		t.Fatalf("open scope exposed authenticated data: %+v", initial)
	}
	expectStatus(t, request(http.MethodPut, "/api/v1/smart-commute", "subject:open-mode", settings(42, true, true, false)), http.StatusConflict)
	expectStatus(t, request(http.MethodPut, "/api/v1/smart-commute", "open", settings(42, true, true, false)), http.StatusNoContent)
	shared := snapshot(t, request(http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", "open", nil))
	if len(shared.Routines) != 1 || shared.Routines[0].ID == authenticated.Routines[0].ID {
		t.Fatalf("shared routines = %+v, authenticated = %+v", shared.Routines, authenticated.Routines)
	}

	list := request(http.MethodGet, "/api/v1/action-center?vehicle_id=42", "open", nil)
	expectStatus(t, list, http.StatusOK)
	var page actiondomain.Response
	if err := json.NewDecoder(list.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || len(page.Items[0].Evidence) != 1 || page.Items[0].Evidence[0].RecurringDrive == nil ||
		page.Items[0].Evidence[0].RecurringDrive.RoutineID != shared.Routines[0].ID {
		t.Fatalf("shared recommendations = %+v", page.Items)
	}
	foreignPath := fmt.Sprintf("/api/v1/smart-commute/routines/%d/snooze", authenticated.Routines[0].ID)
	sharedPath := fmt.Sprintf("/api/v1/smart-commute/routines/%d/snooze", shared.Routines[0].ID)
	snooze := map[string]int64{"vehicle_id": 42, "duration_s": 3600}
	expectStatus(t, request(http.MethodPost, foreignPath, "open", snooze), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPost, sharedPath, owner, snooze), http.StatusNotFound)
	expectStatus(t, f.request(t, http.MethodPut, "/api/v1/smart-commute", "subject-b", settings(42, true, true, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, sharedPath, "subject-b", snooze), http.StatusNotFound)
	expectStatus(t, request(http.MethodPost, sharedPath, "open", snooze), http.StatusNoContent)
	list = request(http.MethodGet, "/api/v1/action-center?vehicle_id=42", "open", nil)
	expectStatus(t, list, http.StatusOK)
	if err := json.NewDecoder(list.Body).Decode(&page); err != nil || len(page.Items) != 0 {
		t.Fatalf("snoozed shared recommendations = %+v, %v", page.Items, err)
	}
	authenticated = snapshot(t, f.request(t, http.MethodGet, "/api/v1/smart-commute?vehicle_id=42", owner, nil))
	if len(authenticated.Routines) != 1 || authenticated.Routines[0].SnoozedUntil != nil {
		t.Fatalf("shared action changed authenticated data: %+v", authenticated)
	}
}
