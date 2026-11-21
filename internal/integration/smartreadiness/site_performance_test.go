package smartreadiness_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
)

func createMeasuredChargingTables(t *testing.T, db *database.DB) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `
		CREATE TABLE charging_sessions (
			id bigint PRIMARY KEY, vehicle_id bigint NOT NULL, geofence_id bigint,
			started_at timestamptz NOT NULL, ended_at timestamptz,
			start_soc_pct float8, end_soc_pct float8, charger_type text, cable_type text, total_energy_added_wh float8,
			start_lat float8, start_lng float8
		);
		CREATE TABLE charging_telemetry (
			vehicle_id bigint, session_id bigint, ts timestamptz,
			ac_charging_energy_in_wh float8, dc_charging_energy_in_wh float8
		);
		INSERT INTO vehicles (id, display_name) VALUES (8, 'Different synthetic vehicle');
		INSERT INTO geofences (id, name, enabled, needs_review, is_charging_location)
		VALUES (10, 'Different synthetic place', true, false, true);`); err != nil {
		t.Fatal(err)
	}
}

func seedSitePerformance(t *testing.T, db *database.DB, now time.Time) {
	t.Helper()
	createMeasuredChargingTables(t, db)
	ctx := t.Context()
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO charging_sessions
		SELECT i, 7, 9, $1::timestamptz - i*INTERVAL '1 day' - (CASE WHEN i <= 2 THEN 2 ELSE 1 END)*INTERVAL '1 hour',
		       $1::timestamptz - i*INTERVAL '1 day', 25, 39, 'AC', 'NACS', 8400
		FROM generate_series(1,6) AS i
		UNION ALL
		SELECT 8, 8, 9, $1::timestamptz - INTERVAL '1 hour', $1::timestamptz, 25, 39, 'AC', 'NACS', 8400
		UNION ALL
		SELECT 9, 7, 10, $1::timestamptz - INTERVAL '1 hour', $1::timestamptz, 25, 39, 'AC', 'NACS', 8400`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `
		INSERT INTO charging_telemetry
		SELECT c.vehicle_id, c.id, point, 500 + 8000 * EXTRACT(EPOCH FROM (point-c.started_at)) /
		  EXTRACT(EPOCH FROM (c.ended_at-c.started_at)), NULL
		FROM charging_sessions c
		CROSS JOIN LATERAL generate_series(c.started_at,c.ended_at,INTERVAL '5 minutes') point`); err != nil {
		t.Fatal(err)
	}
}

func TestSitePerformanceUsesOptedInMeasuredHistory(t *testing.T) {
	repo, db := testRepository(t)
	ctx := t.Context()
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC)
	seedSitePerformance(t, db, now)
	live := &controlledLive{}
	service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithSitePerformance(repo),
		smartreadinesssvc.WithClock(func() time.Time { return now }))
	actionService := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithChargingSitePerformance(service), actioncentersvc.WithClock(func() time.Time { return now }))
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(service, "X-Test-Subject").MountRoutes(r)
		r.Get("/action-center", actionhandler.NewHandler(actionService, "X-Test-Subject").List)
	})
	const root = "/api/v1/smart-charging/site-performance"
	request := func(method, path, subject, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set("Content-Type", "application/json")
		r := httptest.NewRecorder()
		router.ServeHTTP(r, req)
		if r.Code != status || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d %s, expected %d and no-store", method, path, r.Code, r.Body.String(), status)
		}
		return r
	}
	read := func(subject string) readiness.SitePerformanceSettings {
		t.Helper()
		result := request(http.MethodGet, root+"?vehicle_id=7", subject, "", http.StatusOK)
		var response struct {
			Data readiness.SitePerformanceSettings
		}
		if err := json.NewDecoder(result.Body).Decode(&response); err != nil {
			t.Fatal(err)
		}
		return response.Data
	}
	set := func(enabled bool) {
		t.Helper()
		body := `{"vehicle_id":7,"charging_place_id":9,"enabled":true}`
		if !enabled {
			body = `{"vehicle_id":7,"enabled":false}`
		}
		request(http.MethodPut, root, "site-owner", body, http.StatusNoContent)
	}
	if initial := read("site-owner"); initial.Scope != nil || initial.Review != nil {
		t.Fatalf("analysis active before explicit opt-in: %+v", initial)
	}
	set(true)
	result := read("site-owner")
	if result.Scope == nil || result.Review == nil || result.Review.RecentW != 4_000 || result.Review.BaselineW != 8_000 ||
		result.Review.BaselineCount != 4 || result.Review.LatestID != 1 {
		t.Fatalf("expected measured comparison for chosen vehicle and place: %+v", result.Review)
	}
	const center = "/api/v1/action-center?vehicle_id=7"
	card := request(http.MethodGet, center, "site-owner", "", http.StatusOK)
	if !strings.Contains(card.Body.String(), `"kind":"site_performance"`) ||
		!strings.Contains(card.Body.String(), "#site-performance") {
		t.Fatalf("owner did not receive the comparison and review action: %s", card.Body.String())
	}
	if foreign := read("foreign"); foreign.Scope != nil || foreign.Review != nil {
		t.Fatalf("foreign subject received private preference or evidence: %+v", foreign)
	}
	if response := request(http.MethodGet, center, "foreign", "", http.StatusOK); strings.Contains(response.Body.String(), `"kind":"site_performance"`) {
		t.Fatalf("foreign subject received a private card: %s", response.Body.String())
	}
	if _, err := db.Pool.Exec(ctx, `DELETE FROM charging_telemetry WHERE session_id = 1`); err != nil {
		t.Fatal(err)
	}
	if unknown := read("site-owner"); unknown.Scope == nil || unknown.Review != nil {
		t.Fatalf("summary energy was substituted for missing meter evidence: %+v", unknown)
	}
	set(false)
	if ended := read("site-owner"); ended.Scope != nil || ended.Review != nil {
		t.Fatalf("revoked comparison still present: %+v", ended)
	}
	set(true)
	if _, err := db.Pool.Exec(ctx, `UPDATE geofences SET updated_at = updated_at + INTERVAL '1 second' WHERE id = 9`); err != nil {
		t.Fatal(err)
	}
	if changed := read("site-owner"); changed.Scope != nil || changed.Review != nil {
		t.Fatalf("place edit did not invalidate the reviewed scope: %+v", changed)
	}
	if live.readCount() != 0 {
		t.Fatal("historical comparison tried to read live signals")
	}
}
