package smartreadiness_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
)

func seedTripReviewFixture(t *testing.T, db *database.DB) int64 {
	t.Helper()
	var journeyID int64
	if err := db.Pool.QueryRow(t.Context(), `INSERT INTO journey_sessions (vehicle_id, name) VALUES (7, 'Synthetic outbound')
		RETURNING id`).Scan(&journeyID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), `
		CREATE TABLE drives (
			id bigint PRIMARY KEY, vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz,
			start_geofence_id bigint, end_geofence_id bigint, end_soc_pct real
		);
		CREATE TABLE signal_log (
			vehicle_id bigint NOT NULL, ts timestamptz NOT NULL, field text NOT NULL,
			float_value float8, int_value bigint, source_emitted_at timestamptz, PRIMARY KEY (vehicle_id,ts,field)
		)`); err != nil {
		t.Fatal(err)
	}
	return journeyID
}

func completeTripReviewFixture(ctx context.Context, db *database.DB, journeyID int64, departure time.Time) error {
	return db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE journey_sessions SET status='completed',
			started_at = $1::timestamptz - INTERVAL '5 minutes', ended_at = $1::timestamptz + INTERVAL '145 minutes'
			WHERE id = $2 AND status = 'planned'`, departure, journeyID); err != nil {
			return fmt.Errorf("complete fixture journey: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO drives VALUES
			(1, 7, $1, $1::timestamptz + INTERVAL '40 minutes', 9, 11, 25),
			(2, 7, $1::timestamptz + INTERVAL '85 minutes', $1::timestamptz + INTERVAL '140 minutes', 11, 13, 14.5),
			(3, 8, $1, $1::timestamptz + INTERVAL '140 minutes', 9, 13, 80)`, departure); err != nil {
			return fmt.Errorf("seed fixture drive evidence: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO charging_sessions
			(id, vehicle_id, geofence_id, started_at, ended_at)
			VALUES (300, 7, 11, $1::timestamptz + INTERVAL '47 minutes', $1::timestamptz + INTERVAL '79 minutes')`, departure); err != nil {
			return fmt.Errorf("seed fixture charging evidence: %w", err)
		}
		_, err := tx.Exec(ctx, `INSERT INTO signal_log (vehicle_id, ts, field, float_value, source_emitted_at)
			SELECT vehicle_id, $1::timestamptz + minute * INTERVAL '1 minute', 'BatteryLevel', pct,
			       $1::timestamptz + minute * INTERVAL '1 minute'
			FROM (VALUES (7,139,14.5),(7,135,18),(8,140,80)) v(vehicle_id, minute, pct)`, departure)
		return err
	})
}

func TestTripReviewUsesMatchedCompletedJourneyAndSavesPrivateAdjustment(t *testing.T) {
	repo, db := testRepository(t)
	now := time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)
	revision := seedTripStopHistory(t, db, now)
	plan := testPlan(now)
	plan.DepartureAt = now.Add(time.Hour)
	saved, err := repo.SavePlan(t.Context(), "owner", plan, now)
	if err != nil {
		t.Fatal(err)
	}
	journeyID := seedTripReviewFixture(t, db)
	clock := func() time.Time { return now }
	main := smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}, smartreadinesssvc.WithClock(clock))
	reviewService := smartreadinesssvc.NewTripReviews(repo, clock)
	mount := func(header string) http.Handler {
		router := chi.NewRouter()
		router.Route("/api/v1", func(r chi.Router) {
			readinesshandler.NewHandler(main, header, readinesshandler.WithTripReviews(reviewService)).MountRoutes(r)
		})
		return router
	}
	router := mount("X-Test-Subject")
	root := fmt.Sprintf("/api/v1/smart-charging/plans/%d/review", saved.ID)
	path := root + "?vehicle_id=7"
	request := func(router http.Handler, method, path, subject string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(payload))
		req.Header.Set("X-Test-Subject", subject)
		req.Header.Set("Content-Type", "application/json")
		r := httptest.NewRecorder()
		router.ServeHTTP(r, req)
		if r.Code != status || r.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d %s, expected %d and no-store", method, path, r.Code, r.Body, status)
		}
		return r
	}
	settings := func(path, subject string) domain.TripReviewState {
		t.Helper()
		r := request(router, http.MethodGet, path, subject, nil, http.StatusOK)
		var payload struct{ Data domain.TripReviewState }
		if err := json.Unmarshal(r.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		return payload.Data
	}
	request(mount(""), http.MethodGet, path, "", nil, http.StatusForbidden)
	if state := settings(path, "owner"); state.HasSetup || state.Review != nil {
		t.Fatalf("review was not off by default: %+v", state)
	}
	stop := int64(11)
	body := struct {
		domain.TripReviewSetup
		Confirm bool `json:"local_review_confirmed"`
	}{TripReviewSetup: domain.TripReviewSetup{
		PlanVersion: saved.Version, JourneyID: journeyID, OriginUpdatedAt: revision,
		DestinationID: 13, DestinationUpdatedAt: revision, StopPlaceID: &stop, StopPlaceUpdatedAt: &revision,
		PlannedArrivalPct: 20, PlannedStopS: 1800,
	}}
	request(router, http.MethodPut, path, "owner", body, http.StatusBadRequest)
	body.Confirm = true
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	var missing map[string]any
	if err := json.Unmarshal(encoded, &missing); err != nil {
		t.Fatal(err)
	}
	delete(missing, "planned_arrival_pct")
	request(router, http.MethodPut, path, "owner", missing, http.StatusBadRequest)
	missing["planned_arrival_pct"] = nil
	request(router, http.MethodPut, path, "owner", missing, http.StatusBadRequest)
	missing["planned_arrival_pct"] = 0
	request(router, http.MethodPut, path, "owner", missing, http.StatusNoContent)
	if explicit := settings(path, "owner"); explicit.Setup == nil || explicit.Setup.PlannedArrivalPct != 0 {
		t.Fatalf("explicit zero should remain a valid baseline: %+v", explicit)
	}
	request(router, http.MethodPut, path, "foreign", body, http.StatusNotFound)
	request(router, http.MethodPut, path, "owner", body, http.StatusNoContent)
	pending := settings(path, "owner")
	if !pending.HasSetup || pending.Setup == nil || pending.Review != nil || pending.AdjustmentKey != "" {
		t.Fatalf("pending trip review leaked a comparison: %+v", pending)
	}
	if state := settings(root+"?vehicle_id=8", "owner"); state.HasSetup || state.Review != nil {
		t.Fatalf("wrong vehicle exposed review setup: %+v", state)
	}
	request(router, http.MethodPost, path, "owner", map[string]string{"adjustment_key": strings.Repeat("0", 64)}, http.StatusConflict)
	departure := saved.DepartureAt
	now = departure.Add(4 * time.Hour)
	if err := completeTripReviewFixture(t.Context(), db, journeyID, departure); err != nil {
		t.Fatal(err)
	}
	state := settings(path, "owner")
	if state.Review == nil || state.Review.ObservedArrivalPct != 14.5 || state.Review.ObservedStopS != 2700 ||
		state.Review.ObservedChargeS != 1920 || state.Adjustment != nil {
		t.Fatalf("unexpected completed comparison: %+v %+v", state, state.Review)
	}
	if foreign := settings(path, "foreign"); foreign.HasSetup || foreign.Review != nil {
		t.Fatalf("foreign subject saw completed journey: %+v", foreign)
	}
	pin := map[string]string{"adjustment_key": state.AdjustmentKey}
	request(router, http.MethodPost, path, "foreign", pin, http.StatusConflict)
	if _, err := db.Pool.Exec(t.Context(), `DELETE FROM signal_log WHERE vehicle_id=7 AND float_value=14.5`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(t.Context(), `INSERT INTO signal_log (vehicle_id,ts,field,float_value,source_emitted_at)
		VALUES (7,$1::timestamptz + INTERVAL '139 minutes','BatteryLevel',14.5,NULL),
		       (7,$1::timestamptz + INTERVAL '140 minutes','BatteryLevel',18,$1::timestamptz + INTERVAL '134 minutes')`, departure); err != nil {
		t.Fatal(err)
	}
	if unidentified := settings(path, "owner"); !unidentified.HasSetup || unidentified.Review != nil || unidentified.AdjustmentKey != "" {
		t.Fatalf("receipt-only, stale or summary data was promoted to an observed arrival charge: %+v", unidentified)
	}
	request(router, http.MethodPost, path, "owner", pin, http.StatusConflict)
	if _, err := db.Pool.Exec(t.Context(), `UPDATE signal_log SET float_value=15.5,source_emitted_at=ts
		WHERE vehicle_id=7 AND ts=$1::timestamptz + INTERVAL '139 minutes'`, departure); err != nil {
		t.Fatal(err)
	}
	var otherJourneyID int64
	if err := db.Pool.QueryRow(t.Context(), `INSERT INTO journey_sessions (vehicle_id,name,status,started_at,ended_at)
		VALUES (7,'Synthetic overlapping journey','completed',$1::timestamptz + INTERVAL '30 minutes',
		        $1::timestamptz + INTERVAL '150 minutes') RETURNING id`, departure).Scan(&otherJourneyID); err != nil {
		t.Fatal(err)
	}
	if ambiguous := settings(path, "owner"); !ambiguous.HasSetup || ambiguous.Review != nil || ambiguous.AdjustmentKey != "" {
		t.Fatalf("another journey could claim the same evidence: %+v", ambiguous)
	}
	if _, err := db.Pool.Exec(t.Context(), `DELETE FROM journey_sessions WHERE id=$1`, otherJourneyID); err != nil {
		t.Fatal(err)
	}
	request(router, http.MethodPost, path, "owner", pin, http.StatusConflict)
	corrected := settings(path, "owner")
	if corrected.Adjustment != nil || corrected.Review == nil || corrected.Review.ObservedArrivalPct != 15.5 {
		t.Fatalf("stale comparison saved an adjustment or hid the corrected value: %+v", corrected)
	}
	adjust := map[string]string{"adjustment_key": corrected.AdjustmentKey}
	request(router, http.MethodPost, path, "owner", adjust, http.StatusNoContent)
	request(router, http.MethodPost, path, "owner", adjust, http.StatusNoContent)
	state = settings(path, "owner")
	if state.Adjustment == nil || state.Adjustment.ExtraStopS != 900 || state.Adjustment.ExtraArrivalPct != 4.5 {
		t.Fatalf("unexpected saved adjustment: %+v", state.Adjustment)
	}
	futureReview := func(subject string, stopPlace int64) *domain.SimilarTripReviewAdjustment {
		t.Helper()
		future := testPlan(now)
		future.DepartureAt = now.Add(time.Hour)
		next, err := repo.SavePlan(t.Context(), subject, future, now)
		if err != nil {
			t.Fatal(err)
		}
		var nextJourneyID int64
		if err := db.Pool.QueryRow(t.Context(), `INSERT INTO journey_sessions (vehicle_id, name) VALUES (7, 'Synthetic next trip')
			RETURNING id`).Scan(&nextJourneyID); err != nil {
			t.Fatal(err)
		}
		nextPath := fmt.Sprintf("/api/v1/smart-charging/plans/%d/review?vehicle_id=7", next.ID)
		setup := body
		setup.JourneyID, setup.PlanVersion, setup.StopPlaceID = nextJourneyID, next.Version, &stopPlace
		request(router, http.MethodPut, nextPath, subject, setup, http.StatusNoContent)
		return settings(nextPath, subject).SimilarAdjustment
	}
	expiry := departure.Add(145*time.Minute + 30*24*time.Hour)
	if similar := futureReview("owner", 11); similar == nil || similar.ExtraStopS != 900 ||
		similar.ExtraArrivalPct != 4.5 || !similar.ExpiresAt.Equal(expiry) {
		t.Fatalf("next similar trip did not recover its personal adjustment: %+v", similar)
	}
	if wrongStop, foreign := futureReview("owner", 12), futureReview("foreign", 11); wrongStop != nil || foreign != nil {
		t.Fatalf("adjustment crossed route or subject: %+v %+v", wrongStop, foreign)
	}
	savedNow := now
	now = expiry
	if expired := settings(path, "owner"); expired.Review != nil || expired.Adjustment != nil || expired.AdjustmentKey != "" {
		t.Fatalf("expired evidence remained visible: %+v", expired)
	}
	request(router, http.MethodPost, path, "owner", adjust, http.StatusConflict)
	if expired := futureReview("owner", 11); expired != nil {
		t.Fatalf("expired allowance was reused: %+v", expired)
	}
	now = savedNow
	if _, err := db.Pool.Exec(t.Context(), `UPDATE geofences SET updated_at = updated_at + INTERVAL '1 second' WHERE id = 11`); err != nil {
		t.Fatal(err)
	}
	if state := settings(path, "owner"); !state.HasSetup || state.Setup != nil || state.Review != nil || state.Adjustment != nil {
		t.Fatalf("place change did not invalidate the review: %+v", state)
	}
	request(router, http.MethodDelete, path, "owner", nil, http.StatusNoContent)
	if state := settings(path, "owner"); state.HasSetup {
		t.Fatal("review revoke did not persist")
	}
	var drives int
	if err := db.Pool.QueryRow(t.Context(), `SELECT count(*) FROM drives`).Scan(&drives); err != nil || drives != 3 {
		t.Fatalf("revocation changed source drives: count=%d, err=%v", drives, err)
	}
}
