package smartreadiness_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	overnightEndpoint = "/battery/overnight-drain-review?vehicle_id=7"
	overnightOwner    = "synthetic-overnight-owner"
	overnightOther    = "synthetic-overnight-other"
)

type overnightLogCounter struct {
	reader *signal.LogStateReader
	reads  atomic.Int64
}

func (l *overnightLogCounter) Timeline(ctx context.Context, vehicle int64, fields []signal.FieldMapping, start, end time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error) {
	l.reads.Add(1)
	return l.reader.Timeline(ctx, vehicle, fields, start, end, opts)
}

type overnightJourney struct {
	t       *testing.T
	repo    *readinessdb.Repository
	router  *chi.Mux
	reviews *smartreadinesssvc.OvernightDrainReviews
	log     *overnightLogCounter
	morning time.Time
	now     atomic.Int64
	exec    func(string, ...any)
}

func newOvernightJourney(t *testing.T, loss float64) *overnightJourney {
	t.Helper()
	repo, db := testRepository(t)
	morning, exec := seedOvernightEvidence(t, db, loss)
	j := &overnightJourney{
		t: t, repo: repo, morning: morning, exec: exec,
		log: &overnightLogCounter{reader: signal.NewLogStateReader(db.Pool, zerolog.Nop())},
	}
	j.setClock(morning)
	j.reviews = j.makeWorker()
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}), "X-Test-Subject",
			readinesshandler.WithOvernightDrain(j.reviews)).MountRoutes(r)
	})
	return j
}

func (j *overnightJourney) makeWorker() *smartreadinesssvc.OvernightDrainReviews {
	return smartreadinesssvc.NewOvernightDrainReviews(j.repo, smartreadinesssvc.NewOvernightDrainHistory(j.repo, j.log),
		func() time.Time { return time.Unix(j.now.Load(), 0).UTC() })
}

func (j *overnightJourney) setClock(now time.Time) { j.now.Store(now.Unix()) }

func (j *overnightJourney) request(method, path, subject string, body any, status int) *httptest.ResponseRecorder {
	j.t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		j.t.Fatal(err)
	}
	req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-Subject", subject)
	req.RemoteAddr = "192.0.2.10:12345"
	rec := httptest.NewRecorder()
	j.router.ServeHTTP(rec, req)
	if rec.Code != status || rec.Header().Get("Cache-Control") != "no-store" {
		j.t.Fatalf("%s %s: got %d (%s), cache=%q; want %d and no-store", method, path, rec.Code, rec.Body, rec.Header().Get("Cache-Control"), status)
	}
	return rec
}

func (j *overnightJourney) read(path, subject string) *domain.OvernightDrainPlan {
	j.t.Helper()
	rec := j.request(http.MethodGet, path, subject, nil, http.StatusOK)
	var out struct {
		Data domain.OvernightDrainSettings `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		j.t.Fatal(err)
	}
	return out.Data.Plan
}

func (j *overnightJourney) tick() smartreadinesssvc.OvernightDrainBatch {
	j.t.Helper()
	batch, err := j.reviews.ProcessDue(j.t.Context(), 5)
	if err != nil {
		j.t.Fatal(err)
	}
	return batch
}

func overnightSetup(id int64, confirmed, paused bool) map[string]any {
	return map[string]any{
		"expected_plan_id": id, "time_zone": "UTC", "local_review_confirmed": confirmed, "paused": paused,
	}
}

func TestOvernightDrainPrivateMorningLifecycle(t *testing.T) {
	j := newOvernightJourney(t, 7)
	j.request(http.MethodGet, overnightEndpoint, "", nil, http.StatusUnauthorized)
	j.request(http.MethodGet, "/battery/overnight-drain-review?vehicle_id=999", overnightOwner, nil, http.StatusNotFound)
	if j.tick().Published != 0 || j.read(overnightEndpoint, overnightOwner) != nil || j.log.reads.Load() != 0 {
		t.Fatal("default off should not read history")
	}
	j.request(http.MethodPut, overnightEndpoint, overnightOwner, overnightSetup(0, false, false), http.StatusBadRequest)
	j.request(http.MethodPut, overnightEndpoint, overnightOwner, overnightSetup(0, true, false), http.StatusNoContent)
	if j.tick().Published != 0 || j.log.reads.Load() != 0 {
		t.Fatal("collection should wait for a completed local morning")
	}

	j.setClock(j.morning.Add(20 * time.Minute))
	now := j.morning.Add(20 * time.Minute)
	lost, err := j.repo.ClaimOvernightDrain(t.Context(), now, now.Add(5*time.Minute))
	if err != nil || lost == nil || j.tick().Published != 0 {
		t.Fatalf("abandoned claim should not be double processed: %v, %v", lost, err)
	}
	j.setClock(now.Add(6 * time.Minute))
	var group sync.WaitGroup
	var publications atomic.Int64
	for range 3 {
		group.Go(func() {
			batch, err := j.makeWorker().ProcessDue(t.Context(), 5)
			if err != nil {
				t.Error(err)
			}
			publications.Add(int64(batch.Published))
		})
	}
	group.Wait()
	if publications.Load() != 1 || j.tick().Published != 0 {
		t.Fatal("a recovered occurrence must be published once")
	}
	if j.read(overnightEndpoint, overnightOther) != nil ||
		j.read("/battery/overnight-drain-review?vehicle_id=8", overnightOwner) != nil {
		t.Fatal("same-car second user and different car should not receive the card")
	}
	plan := j.read(overnightEndpoint, overnightOwner)
	if plan == nil || plan.Review == nil || plan.Review.MeasuredLossPct != 7 || plan.Review.ComparableNights != 4 ||
		!plan.Review.ExpiresAt.Equal(j.morning.Add(6*time.Hour)) {
		t.Fatalf("want private measured review, got %+v", plan)
	}
	j.exec(`INSERT INTO charging_sessions(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`,
		j.morning.Add(-28*time.Hour), j.morning.Add(-27*time.Hour))
	if j.read(overnightEndpoint, overnightOwner).Review != nil {
		t.Fatal("late overlapping baseline charge should withdraw the card")
	}
	j.exec(`DELETE FROM charging_sessions WHERE vehicle_id=7`)
	at := j.morning.Add(-24*time.Hour - 10*time.Minute)
	j.exec(`UPDATE signal_log SET float_value=57 WHERE vehicle_id=7 AND field='BatteryLevel' AND ts=$1`, at)
	if j.read(overnightEndpoint, overnightOwner).Review != nil {
		t.Fatal("a corrected baseline measurement must withdraw the published review")
	}
	j.exec(`UPDATE signal_log SET float_value=58 WHERE vehicle_id=7 AND field='BatteryLevel' AND ts=$1`, at)
	if j.read(overnightEndpoint, overnightOwner).Review == nil {
		t.Fatal("the matching measured review should remain available")
	}

	dismissal := map[string]any{"plan_id": plan.ID, "morning_at": plan.Review.MorningAt}
	j.request(http.MethodPatch, overnightEndpoint, overnightOther, dismissal, http.StatusConflict)
	j.request(http.MethodPatch, overnightEndpoint, overnightOwner, dismissal, http.StatusNoContent)
	j.request(http.MethodPatch, overnightEndpoint, overnightOwner, dismissal, http.StatusConflict)
	if j.read(overnightEndpoint, overnightOwner).Review != nil || j.tick().Published != 0 {
		t.Fatal("dismissed occurrence should stay quiet")
	}
	j.request(http.MethodPut, overnightEndpoint, overnightOwner, overnightSetup(plan.ID, false, true), http.StatusNoContent)
	paused := j.read(overnightEndpoint, overnightOwner)
	if paused == nil || !paused.Paused || paused.ID == plan.ID {
		t.Fatalf("pause must revoke previous work: %+v", paused)
	}
	if done, err := j.repo.FinishOvernightDrain(t.Context(), *lost, now, now, plan.Review); err != nil || done {
		t.Fatalf("stale worker could not finish: %v, %v", done, err)
	}
	reads := j.log.reads.Load()
	j.setClock(j.morning.Add(25 * time.Hour))
	if j.tick().Published != 0 || reads != j.log.reads.Load() {
		t.Fatal("paused plan performed a history read")
	}
	j.request(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", overnightEndpoint, paused.ID), overnightOther, nil, http.StatusConflict)
	j.request(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", overnightEndpoint, paused.ID), overnightOwner, nil, http.StatusNoContent)
	if j.read(overnightEndpoint, overnightOwner) != nil {
		t.Fatal("clear must delete derived settings")
	}
}

func TestOvernightDrainOrdinaryNightNeverPublishes(t *testing.T) {
	j := newOvernightJourney(t, 2)
	j.request(http.MethodPut, overnightEndpoint, overnightOwner, overnightSetup(0, true, false), http.StatusNoContent)
	j.setClock(j.morning.Add(20 * time.Minute))
	batch := j.tick()
	if batch.Published != 0 || batch.Outcomes[domain.OvernightWithinUsualRange] != 1 {
		t.Fatalf("ordinary night must stay quiet, got %+v", batch)
	}
	reads := j.log.reads.Load()
	if plan := j.read(overnightEndpoint, overnightOwner); plan == nil || plan.Review != nil {
		t.Fatalf("want active with no advice, got %+v", plan)
	}
	j.tick()
	if reads != j.log.reads.Load() {
		t.Fatal("do not rescan quiet nights each worker tick")
	}
	scope := port.OvernightDrainScope{Subject: overnightOwner, VehicleID: 7}
	if settings, err := j.repo.ReadOvernightDrain(t.Context(), scope, j.morning.Add(6*time.Hour)); err != nil || settings.Plan.Review != nil {
		t.Fatalf("quiet persisted result: %+v, %v", settings, err)
	}
}
