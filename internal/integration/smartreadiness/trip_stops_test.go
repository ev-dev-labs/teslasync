package smartreadiness_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
)

type controlledStopRouter struct {
	calls      atomic.Int32
	afterFirst func(context.Context)
}

func (s *controlledStopRouter) CompareStopRoutes(
	ctx context.Context, origin, destination readiness.RoutePoint, stops []readiness.RoutingStop,
	authorize func(context.Context) error,
) (readiness.StopRoutes, error) {
	if origin != (readiness.RoutePoint{Latitude: 47, Longitude: -122}) ||
		destination != (readiness.RoutePoint{Latitude: 48, Longitude: -121}) || len(stops) != 2 {
		return readiness.StopRoutes{}, fmt.Errorf("wrong reviewed fixture points")
	}
	if err := authorize(ctx); err != nil {
		return readiness.StopRoutes{}, err
	}
	s.calls.Add(1)
	if s.afterFirst != nil {
		s.afterFirst(ctx)
	}
	result := readiness.StopRoutes{Direct: readiness.RoadLeg{DistanceM: 130000, DurationS: 6400}}
	for i, stop := range stops {
		if err := authorize(ctx); err != nil {
			return readiness.StopRoutes{}, err
		}
		s.calls.Add(1)
		result.Via = append(result.Via, readiness.StopRoute{
			PlaceID: stop.PlaceID, ToStop: readiness.RoadLeg{DistanceM: 55000 + int64(i)*10000, DurationS: 2700 + int64(i)*500},
			AfterStop: readiness.RoadLeg{DistanceM: 78000 - int64(i)*5000, DurationS: 3800 - int64(i)*300},
		})
	}
	return result, authorize(ctx)
}

func seedTripStopHistory(t *testing.T, db *database.DB, now time.Time) time.Time {
	t.Helper()
	seedSitePerformance(t, db, now)
	revision := now.Add(-200 * 24 * time.Hour).Truncate(time.Microsecond)
	if _, err := db.Pool.Exec(t.Context(), `
		UPDATE geofences SET updated_at = $1,
		  polygon_wkt = 'POLYGON((-122.001 46.999,-121.999 46.999,-121.999 47.001,-122.001 47.001,-122.001 46.999))'
		WHERE id = 9`, revision); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO geofences(id, name, enabled, needs_review, is_charging_location, updated_at, polygon_wkt)
		VALUES
		(11,'Reviewed stop A',true,false,true,$1,'POLYGON((-121.751 47.249,-121.749 47.249,-121.749 47.251,-121.751 47.251,-121.751 47.249))'),
		(12,'Reviewed stop B',true,false,true,$1,'POLYGON((-121.501 47.499,-121.499 47.499,-121.499 47.501,-121.501 47.501,-121.501 47.499))'),
		(13,'Reviewed destination',true,false,false,$1,'POLYGON((-121.001 47.999,-120.999 47.999,-120.999 48.001,-121.001 48.001,-121.001 47.999))')`, revision); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO charging_sessions
		  (id,vehicle_id,geofence_id,started_at,ended_at,start_soc_pct,end_soc_pct,charger_type,cable_type,total_energy_added_wh,start_lat,start_lng)
		SELECT 20+i+place*10, 7, place, $1::timestamptz - i*INTERVAL '1 day' - make_interval(mins => 30 + (place-11)*15),
		  $1::timestamptz - i*INTERVAL '1 day', 14, 45, 'DC', 'NACS', 24800,
		  47.25+(place-11)*0.25, -121.75+(place-11)*0.25
		FROM generate_series(1,3) i CROSS JOIN generate_series(11,12) place`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO charging_telemetry
		SELECT c.vehicle_id, c.id, point, NULL, 500+24800*EXTRACT(EPOCH FROM(point-c.started_at)) /
		  EXTRACT(EPOCH FROM(c.ended_at-c.started_at))
		FROM charging_sessions c CROSS JOIN LATERAL generate_series(c.started_at,c.ended_at,INTERVAL '5 minutes') point
		WHERE c.geofence_id IN (11,12)`); err != nil {
		t.Fatal(err)
	}
	return revision
}

func tripStopInput(departure, revision time.Time, version int64) readiness.StopComparisonInput {
	input := readiness.StopComparisonInput{
		PlanVersion: version, OriginUpdatedAt: revision, DestinationPlaceID: 13, DestinationUpdatedAt: revision,
		CapacityWh: 80000, StartPct: 37.5, LimitPct: 80, HighUsageWhPerM: 0.25,
	}
	for i, waitS := range []int64{1200, 60} {
		stop := readiness.StopSetup{PlaceID: int64(11 + i), PlaceUpdatedAt: revision, TimeZone: "UTC"}
		for week := 1; week <= 8; week++ {
			stop.Waits = append(stop.Waits, readiness.StopWaitObservation{
				ArrivedAt: departure.Add(45*time.Minute).AddDate(0, 0, -7*week), WaitS: waitS,
			})
		}
		input.Stops = append(input.Stops, stop)
	}
	return input
}

func TestTripStopComparisonRequiresCurrentPrivateConsentAndQualifiedHistory(t *testing.T) {
	repo, db := testRepository(t)
	now := time.Date(2026, 4, 7, 7, 0, 0, 0, time.UTC)
	revision := seedTripStopHistory(t, db, now)
	plan := testPlan(now)
	plan.ReservePct, plan.DepartureAt = 12.5, now.Add(time.Hour)
	saved, err := repo.SavePlan(t.Context(), "owner", plan, now)
	if err != nil {
		t.Fatal(err)
	}
	live := &controlledLive{}
	provider := &controlledStopRouter{}
	clock := func() time.Time { return now }
	outcomes := make(map[string]int)
	stopService := smartreadinesssvc.NewTripStops(repo, provider, clock, func(outcome string) { outcomes[outcome]++ })
	service := smartreadinesssvc.New(repo, live, controlledSite{}, smartreadinesssvc.WithClock(clock))
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(service, "X-Test-Subject", readinesshandler.WithTripStops(stopService)).MountRoutes(r)
	})
	root := fmt.Sprintf("/api/v1/smart-charging/plans/%d/stops", saved.ID)
	request := func(method, path, subject string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d %s, expected %d and no-store", method, path, w.Code, w.Body, status)
		}
		return w
	}
	path := root + "?vehicle_id=7"
	read := func(path, subject string) readiness.StopComparisonSettings {
		t.Helper()
		w := request(http.MethodGet, path, subject, nil, http.StatusOK)
		var resp struct {
			Data readiness.StopComparisonSettings
		}
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatal(err)
		}
		return resp.Data
	}
	body := struct {
		readiness.StopComparisonInput
		Consent    bool `json:"provider_consent"`
		Compatible bool `json:"compatible_stops_confirmed"`
	}{tripStopInput(saved.DepartureAt, revision, saved.Version), true, true}
	if data := read(path, "owner"); !data.Available || data.HasSetup || data.Result != nil {
		t.Fatalf("comparison is not off by default: %+v", data)
	}
	request(http.MethodPost, path, "owner", nil, http.StatusNotFound)
	body.Consent = false
	request(http.MethodPut, path, "owner", body, http.StatusBadRequest)
	body.Consent = true
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	var missing struct {
		readiness.StopComparisonInput
		Stops []struct {
			readiness.StopSetup
			Waits []map[string]any `json:"waits"`
		} `json:"stops"`
		Consent    bool `json:"provider_consent"`
		Compatible bool `json:"compatible_stops_confirmed"`
	}
	if err := json.Unmarshal(encoded, &missing); err != nil {
		t.Fatal(err)
	}
	wait := missing.Stops[0].Waits[0]
	delete(wait, "wait_s")
	request(http.MethodPut, path, "owner", missing, http.StatusBadRequest)
	wait["wait_s"] = nil
	request(http.MethodPut, path, "owner", missing, http.StatusBadRequest)
	wait["wait_s"] = 0
	request(http.MethodPut, path, "owner", missing, http.StatusNoContent)
	explicit := read(path, "owner")
	if explicit.Setup == nil || explicit.Setup.Stops[0].Waits[len(explicit.Setup.Stops[0].Waits)-1].WaitS != 0 {
		t.Fatalf("an explicitly observed zero wait should be retained: %+v", explicit)
	}
	request(http.MethodPut, path, "foreign", body, http.StatusNotFound)
	request(http.MethodPut, path, "owner", body, http.StatusNoContent)
	if data := read(path, "owner"); data.Setup == nil || data.Result != nil || provider.calls.Load() != 0 {
		t.Fatalf("passive read or consent performed routing: %+v (%d calls)", data, provider.calls.Load())
	}
	if data := read(path, "foreign"); data.HasSetup || data.Result != nil {
		t.Fatalf("foreign subject saw trip evidence: %+v", data)
	}
	request(http.MethodPost, root+"?vehicle_id=8", "owner", nil, http.StatusNotFound)
	request(http.MethodPost, path, "owner", nil, http.StatusOK)
	result := read(path, "owner").Result
	if result == nil || len(result.Stops) != 2 || result.Stops[0].PlaceID != 12 ||
		result.Stops[0].ExpectedWaitS != 60 || result.Stops[0].DetourM != 8000 || result.Stops[0].StationArrivalWh != 13750 ||
		result.Stops[0].WaitSampleCount != 8 || result.Stops[0].ChargeSampleCount != 3 || provider.calls.Load() != 3 {
		t.Fatalf("saved comparison missing qualified evidence: %+v (%d calls)", result, provider.calls.Load())
	}
	request(http.MethodPost, path, "owner", nil, http.StatusConflict)
	request(http.MethodPut, path, "owner", body, http.StatusNoContent)
	if data := read(path, "owner"); data.NextCheckAt == nil || !data.NextCheckAt.After(now) || data.Result != nil {
		t.Fatalf("replacing consent lost the check limit or retained the old result: %+v", data)
	}
	request(http.MethodPost, path, "owner", nil, http.StatusConflict)
	now = now.Add(16 * time.Minute)
	provider.afterFirst = func(ctx context.Context) {
		if err := stopService.Revoke(ctx, readiness.StopPlanKey{Subject: "owner", PlanID: saved.ID, VehicleID: 7}); err != nil {
			t.Fatal(err)
		}
	}
	request(http.MethodPost, path, "owner", nil, http.StatusNotFound)
	if data := read(path, "owner"); data.HasSetup || data.Result != nil || provider.calls.Load() != 4 {
		t.Fatalf("revoked comparison leaked or continued routing: %+v (%d calls)", data, provider.calls.Load())
	}
	provider.afterFirst = nil
	if _, err := db.Pool.Exec(t.Context(), `DELETE FROM charging_telemetry WHERE session_id IN (141,142)`); err != nil {
		t.Fatal(err)
	}
	request(http.MethodPut, path, "owner", body, http.StatusNoContent)
	request(http.MethodPost, path, "owner", nil, http.StatusConflict)
	now = now.Add(16 * time.Minute)
	request(http.MethodPost, path, "owner", nil, http.StatusOK)
	if data := read(path, "owner"); data.Result != nil || provider.calls.Load() != 4 || live.readCount() != 0 {
		t.Fatalf("unqualified meter evidence produced advice or woke state: %+v (%d route calls, %d reads)", data, provider.calls.Load(), live.readCount())
	}
	if _, err := db.Pool.Exec(t.Context(), `UPDATE geofences SET updated_at = updated_at + INTERVAL '1 second' WHERE id = 12`); err != nil {
		t.Fatal(err)
	}
	if data := read(path, "owner"); !data.HasSetup || data.Setup != nil || data.Result != nil {
		t.Fatalf("an edited stop was reused without review: %+v", data)
	}
	request(http.MethodPut, path, "owner", body, http.StatusConflict)
	request(http.MethodDelete, path, "owner", nil, http.StatusNoContent)
	if data := read(path, "owner"); data.HasSetup {
		t.Fatal("removing comparison setup did not persist")
	}
	if outcomes["comparison_ready"] != 1 || outcomes["insufficient_history"] != 1 ||
		outcomes["cooldown"] != 3 || outcomes["setup_missing_or_stale"] != 2 || outcomes["scope_invalidated"] != 1 {
		t.Fatalf("unexpected comparison metrics: %v", outcomes)
	}
	if _, err := db.Pool.Exec(t.Context(), `WITH added AS (INSERT INTO geofences
		(id,name,enabled,needs_review,is_charging_location,updated_at,polygon_wkt)
		SELECT 14,'Third approved stop',true,false,true,$1,polygon_wkt FROM geofences WHERE id=12 RETURNING updated_at
	)
	UPDATE geofences SET updated_at=added.updated_at FROM added WHERE id=12`, revision); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO charging_telemetry
		SELECT c.vehicle_id, c.id, point, NULL, 500+24800*EXTRACT(EPOCH FROM(point-c.started_at)) /
		  EXTRACT(EPOCH FROM(c.ended_at-c.started_at))
		FROM charging_sessions c CROSS JOIN LATERAL generate_series(c.started_at,c.ended_at,INTERVAL '5 minutes') point
		WHERE c.id IN (141,142)`); err != nil {
		t.Fatal(err)
	}
	third := body.Stops[1]
	third.PlaceID = 14
	body.Stops = append(body.Stops, third)
	request(http.MethodPut, path, "owner", body, http.StatusNoContent)
	now = now.Add(16 * time.Minute)
	provider.afterFirst = func(ctx context.Context) {
		if _, err := db.Pool.Exec(ctx, `DELETE FROM geofences WHERE id=11`); err != nil {
			t.Fatal(err)
		}
	}
	request(http.MethodPost, path, "owner", nil, http.StatusNotFound)
	if data := read(path, "owner"); !data.HasSetup || data.Setup != nil || data.Result != nil || provider.calls.Load() != 5 {
		t.Fatalf("deleting an approved station left the surviving subset authorized: %+v (%d calls)", data, provider.calls.Load())
	}
}
