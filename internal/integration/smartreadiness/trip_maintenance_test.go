package smartreadiness_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

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
)

func seedTripMaintenance(t *testing.T, db *database.DB, now time.Time) {
	t.Helper()
	for _, name := range []string{"000223_action_center_state.up", "000279_smart_trip_maintenance.up"} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	if _, err := db.Pool.Exec(t.Context(), `CREATE TABLE drives (
		id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		vehicle_id bigint NOT NULL REFERENCES vehicles(id),
		started_at timestamptz NOT NULL, ended_at timestamptz, end_odometer_m double precision);
		INSERT INTO vehicles (id, display_name) VALUES (8, 'Other synthetic vehicle');`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), `INSERT INTO drives (vehicle_id,started_at,ended_at,end_odometer_m)
		VALUES (7,$1::timestamptz-INTERVAL '7 hours',$1-INTERVAL '6 hours',80400000),
		  (7,$1-INTERVAL '15 hours',$1-INTERVAL '14 hours',80300000),
		  (8,$1-INTERVAL '2 hours',$1-INTERVAL '1 hour',99000000)`, now); err != nil {
		t.Fatal(err)
	}
}

func tripMaintenanceRouter(repo *readinessdb.Repository, db *database.DB, checks *smartreadinesssvc.TripMaintenance,
	header string, clock func() time.Time,
) http.Handler {
	readiness := smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}, smartreadinesssvc.WithClock(clock))
	recommendations := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithTripMaintenance(checks), actioncentersvc.WithClock(clock))
	r := chi.NewRouter()
	r.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(readiness, header, readinesshandler.WithTripMaintenance(checks)).MountRoutes(r)
		action := actionhandler.NewHandler(recommendations, header)
		r.Get("/action-center", action.List)
		r.Post("/action-center/{recommendationID}/actions", action.ApplyAction)
	})
	return r
}

func TestTripMaintenancePublishesPrivateRecordedCrossing(t *testing.T) {
	repo, db := testRepository(t)
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	seedTripMaintenance(t, db, now)
	const owner = "synthetic-maintenance-owner"
	const other = "synthetic-maintenance-other"
	plan, err := repo.SavePlan(t.Context(), owner, testPlan(now), now)
	if err != nil {
		t.Fatal(err)
	}

	checks := smartreadinesssvc.NewTripMaintenance(repo, clock)
	router := tripMaintenanceRouter(repo, db, checks, "X-Test-Subject", clock)
	open := tripMaintenanceRouter(repo, db, checks, "", clock)
	path := fmt.Sprintf("/api/v1/smart-charging/plans/%d/maintenance?vehicle_id=7", plan.ID)
	call := func(target http.Handler, method, path, subject string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("X-Test-Subject", subject)
		expected := "subject:" + subject
		if subject == "" {
			expected = "open"
		}
		r.Header.Set("X-TeslaSync-Expected-Principal", expected)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		target.ServeHTTP(w, r)
		if w.Code != status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d (%s), want %d no-store: %s", method, path, w.Code, w.Header().Get("Cache-Control"), status, w.Body.String())
		}
		return w
	}
	settings := func() domain.TripMaintenanceSettings {
		t.Helper()
		var data struct {
			Data domain.TripMaintenanceSettings
		}
		if err := json.Unmarshal(call(router, http.MethodGet, path, owner, nil, 200).Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		return data.Data
	}
	list := func(subject string) []actiondomain.Recommendation {
		t.Helper()
		var data actiondomain.Response
		response := call(router, http.MethodGet, "/api/v1/action-center?vehicle_id=7&source_feature=trip_maintenance", subject, nil, 200)
		if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		return data.Items
	}
	tick := func() smartreadinesssvc.TripMaintenanceBatch {
		t.Helper()
		batch, err := checks.ProcessDue(t.Context(), 10)
		if err != nil {
			t.Fatal(err)
		}
		return batch
	}
	input := struct {
		domain.TripMaintenanceSetup
		Confirmed bool `json:"local_analysis_confirmed"`
	}{TripMaintenanceSetup: domain.TripMaintenanceSetup{
		PlanVersion: plan.Version, ServiceLabel: "Synthetic inspection",
		ServiceCompletedAt: now.AddDate(0, -3, 0), ServiceOdometerM: 71_000_000, IntervalM: 10_000_000,
		TripDistanceLowM: 500_000, TripDistanceHighM: 900_000,
	}}
	if state := settings(); state.Setup != nil || state.Projection != nil || len(tick().Outcomes) != 0 {
		t.Fatalf("disabled plan had derivation or due work: %+v", state)
	}
	call(router, http.MethodPut, path, owner, input, 400)
	input.Confirmed = true
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var missing map[string]any
	if err := json.Unmarshal(data, &missing); err != nil {
		t.Fatal(err)
	}
	delete(missing, "service_odometer_m")
	call(router, http.MethodPut, path, owner, missing, 400)
	missing["service_odometer_m"] = nil
	call(router, http.MethodPut, path, owner, missing, 400)
	missing["service_odometer_m"] = 0
	call(router, http.MethodPut, path, owner, missing, 204)
	if state := settings(); state.Setup == nil || state.Setup.ServiceOdometerM != 0 {
		t.Fatalf("an explicitly recorded zero must remain valid: %+v", state)
	}
	call(open, http.MethodPut, path, "", input, 403)
	call(router, http.MethodPut, path, other, input, 404)
	call(router, http.MethodPut, path, owner, input, 204)
	if batch := tick(); batch.Outcomes[domain.TripMaintenanceBelowInterval] != 1 || batch.Published != 0 || len(list(owner)) != 0 {
		t.Fatalf("upper endpoint only triggered a reminder: %+v", batch)
	}
	input.TripDistanceLowM = 700_000
	call(router, http.MethodPut, path, owner, input, 204)
	if batch := tick(); batch.Outcomes[domain.TripMaintenanceEligible] != 1 || batch.Published != 1 {
		t.Fatalf("qualified crossing was not published exactly once: %+v", batch)
	}
	items := list(owner)
	if len(items) != 1 || len(list(other)) != 0 || items[0].NavigationPath == nil || *items[0].NavigationPath != "/maintenance?vehicle_id=7" ||
		settings().Projection == nil || settings().Projection.RecordedOdometerM != 80_400_000 {
		t.Fatalf("qualified plan or scoped interval evidence is missing: %+v", items)
	}
	if len(tick().Outcomes) != 0 {
		t.Fatal("restart or duplicate tick reprocessed the same interval")
	}
	call(router, http.MethodDelete, path, other, nil, 204)
	if len(list(owner)) != 1 {
		t.Fatal("foreign revoke deleted the owner's setup")
	}
	now = now.Add(time.Hour)
	checks = smartreadinesssvc.NewTripMaintenance(repo, clock)
	if batch := tick(); batch.Published != 0 || batch.Outcomes[domain.TripMaintenanceEligible] != 1 || list(owner)[0].ID != items[0].ID {
		t.Fatalf("daily refresh changed or republished the recommendation: %+v", batch)
	}
	plan.DepartureAt = plan.DepartureAt.Add(time.Hour)
	if _, err := repo.SavePlan(t.Context(), owner, *plan, now); err != nil {
		t.Fatal(err)
	}
	if state := settings(); !state.NeedsReview || state.Projection != nil || len(list(owner)) != 0 || len(tick().Outcomes) != 0 {
		t.Fatalf("changed plan retained an actionable prior-setup projection: %+v", state)
	}
	call(router, http.MethodDelete, path, owner, nil, 204)
	if settings().Setup != nil {
		t.Fatal("setup survived explicit withdrawal")
	}
	applyWarrantyFixtureMigration(t, db, "000279_smart_trip_maintenance.down")
	var drives int
	if err := db.Pool.QueryRow(t.Context(), `SELECT count(*) FROM drives`).Scan(&drives); err != nil || drives != 3 {
		t.Fatalf("rollback removed source drives: %d, %v", drives, err)
	}
	applyWarrantyFixtureMigration(t, db, "000279_smart_trip_maintenance.up")
	if settings().Setup != nil {
		t.Fatal("rollback restored removed consent")
	}
}

func TestPrivateTripMaintenanceBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MAINTENANCE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MAINTENANCE_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	repo, db := testRepository(t)
	now := time.Now().UTC().Truncate(time.Second)
	clock := func() time.Time { return now }
	seedTripMaintenance(t, db, now)
	checks := smartreadinesssvc.NewTripMaintenance(repo, clock)
	router := tripMaintenanceRouter(repo, db, checks, "X-Test-Subject", clock)
	runPrivatePlanningBrowser(t, router, "/__fixture/maintenance-tick", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		batch, err := checks.ProcessDue(r.Context(), 20)
		if err != nil {
			t.Errorf("synthetic maintenance check: %v", err)
			http.Error(w, "maintenance check failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(batch); err != nil {
			t.Errorf("write synthetic maintenance results: %v", err)
		}
	}), "smart-charging.smoke.spec.ts", "SMART_MAINTENANCE_REAL_BACKEND=1", []string{"--grep", "documented maintenance interval"})
}
