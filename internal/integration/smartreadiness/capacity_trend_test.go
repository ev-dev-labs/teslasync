package smartreadiness_test

import (
	"bytes"
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
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	capacityEndpoint = "/battery/capacity-digest?vehicle_id=7"
	capacityOwner    = "synthetic-capacity-owner"
	capacityOther    = "synthetic-capacity-other"
	capacityZone     = "America/New_York"
)

type capacityJourney struct {
	t          *testing.T
	repo       *readinessdb.Repository
	router     *chi.Mux
	reviews    *smartreadinesssvc.CapacityTrendReviews
	log        *overnightLogCounter
	now        atomic.Int64
	release    time.Time
	expiry     time.Time
	sampleFrom time.Time
	exec       func(string, ...any)
}

func newCapacityJourney(t *testing.T, recentWh float64) *capacityJourney {
	t.Helper()
	repo, db := testRepository(t)
	start, _, exec := seedCapacityObservations(t, db, recentWh)
	j := &capacityJourney{
		t: t, repo: repo, exec: exec, sampleFrom: start,
		release: time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC),
		expiry:  time.Date(2026, 12, 2, 10, 0, 0, 0, time.UTC),
		log:     &overnightLogCounter{reader: signal.NewLogStateReader(db.Pool, zerolog.Nop())},
	}
	j.setClock(j.release.Add(-time.Hour))
	j.reviews = j.makeWorker()
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}), "X-Test-Subject",
			readinesshandler.WithCapacityTrend(j.reviews)).MountRoutes(r)
	})
	return j
}

func (j *capacityJourney) makeWorker() *smartreadinesssvc.CapacityTrendReviews {
	return smartreadinesssvc.NewCapacityTrendReviews(j.repo, smartreadinesssvc.NewCapacityTrendHistory(j.repo, j.log),
		func() time.Time { return time.Unix(j.now.Load(), 0).UTC() })
}

func (j *capacityJourney) setClock(now time.Time) { j.now.Store(now.Unix()) }

func (j *capacityJourney) request(method, path, subject string, body any, status int) *httptest.ResponseRecorder {
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

func (j *capacityJourney) read(path, subject string) *domain.CapacityTrendPlan {
	j.t.Helper()
	rec := j.request(http.MethodGet, path, subject, nil, http.StatusOK)
	var out struct {
		Data domain.CapacityTrendSettings `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		j.t.Fatal(err)
	}
	return out.Data.Plan
}

func (j *capacityJourney) tick() smartreadinesssvc.CapacityTrendBatch {
	j.t.Helper()
	batch, err := j.reviews.ProcessDue(j.t.Context(), 5)
	if err != nil {
		j.t.Fatal(err)
	}
	return batch
}

func capacitySetup(id int64, confirmed, paused bool) map[string]any {
	return map[string]any{
		"expected_plan_id": id, "time_zone": capacityZone, "local_review_confirmed": confirmed, "paused": paused,
	}
}

func TestCapacityDigestPersistentPrivateLifecycle(t *testing.T) {
	j := newCapacityJourney(t, 69_000)
	j.request(http.MethodGet, capacityEndpoint, "", nil, http.StatusUnauthorized)
	j.request(http.MethodGet, "/battery/capacity-digest?vehicle_id=999", capacityOwner, nil, http.StatusNotFound)
	if j.tick().Published != 0 || j.read(capacityEndpoint, capacityOwner) != nil || j.log.reads.Load() != 0 {
		t.Fatal("default off should not read history")
	}
	j.request(http.MethodPut, capacityEndpoint, capacityOwner, capacitySetup(0, false, false), http.StatusBadRequest)
	j.request(http.MethodPut, capacityEndpoint, capacityOwner, capacitySetup(0, true, false), http.StatusNoContent)
	j.setClock(j.release.Add(-time.Second))
	if j.tick().Published != 0 || j.log.reads.Load() != 0 {
		t.Fatal("must wait until 05:00 local after the fall DST offset change")
	}

	j.setClock(j.release)
	lost, err := j.repo.ClaimCapacityTrend(t.Context(), j.release, j.release.Add(time.Minute))
	if err != nil || lost == nil || j.tick().Published != 0 {
		t.Fatalf("abandoned claim should not be double processed: %v, %v", lost, err)
	}
	j.setClock(j.release.Add(2 * time.Minute))
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
	if publications.Load() != 1 || j.tick().Published != 0 || j.log.reads.Load() != 16 {
		t.Fatalf("want one publication from one pass over 16 sessions, published=%d reads=%d", publications.Load(), j.log.reads.Load())
	}
	if j.read(capacityEndpoint, capacityOther) != nil ||
		j.read("/battery/capacity-digest?vehicle_id=8", capacityOwner) != nil {
		t.Fatal("same-car second user and different car should not receive the digest")
	}
	plan := j.read(capacityEndpoint, capacityOwner)
	if plan == nil || plan.Digest == nil {
		t.Fatalf("missing private digest: %+v", plan)
	}
	digest := plan.Digest
	if digest.BaselineDays != 8 || digest.RecentDays != 8 || digest.Change.HighWh >= -5_000 ||
		!digest.ExpiresAt.Equal(j.expiry) || !digest.RecentTo.Equal(time.Date(2026, 11, 1, 4, 0, 0, 0, time.UTC)) {
		t.Fatalf("incorrect samples, change, or local period: %+v", digest)
	}
	j.exec(`INSERT INTO charging_sessions(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`,
		j.sampleFrom.Add(time.Hour), j.sampleFrom.Add(2*time.Hour))
	if j.read(capacityEndpoint, capacityOwner).Digest != nil {
		t.Fatal("late overlapping session should withdraw the digest")
	}
	j.exec(`DELETE FROM charging_sessions WHERE vehicle_id=7 AND started_at=$1`, j.sampleFrom.Add(time.Hour))
	at := j.sampleFrom.Add(5*time.Hour - 9*time.Minute)
	j.exec(`UPDATE signal_log SET float_value=float_value+100 WHERE vehicle_id=7 AND field='DCChargingEnergyIn' AND ts=$1`, at)
	if j.read(capacityEndpoint, capacityOwner).Digest != nil {
		t.Fatal("an endpoint correction must withdraw the published digest even if the change is still material")
	}
	j.exec(`UPDATE signal_log SET float_value=float_value-100 WHERE vehicle_id=7 AND field='DCChargingEnergyIn' AND ts=$1`, at)
	if j.read(capacityEndpoint, capacityOwner).Digest == nil {
		t.Fatal("the matching measured digest should remain available")
	}

	j.setClock(j.expiry)
	if j.read(capacityEndpoint, capacityOwner).Digest != nil {
		t.Fatal("digest must expire even when the next monthly worker has not run")
	}
	j.setClock(j.release.Add(3 * time.Minute))
	dismissal := map[string]any{"plan_id": plan.ID, "recent_to": digest.RecentTo}
	j.request(http.MethodPatch, capacityEndpoint, capacityOther, dismissal, http.StatusConflict)
	j.request(http.MethodPatch, capacityEndpoint, capacityOwner, dismissal, http.StatusNoContent)
	j.request(http.MethodPatch, capacityEndpoint, capacityOwner, dismissal, http.StatusConflict)
	if j.read(capacityEndpoint, capacityOwner).Digest != nil || j.tick().Published != 0 {
		t.Fatal("dismissed occurrence should stay quiet")
	}
	j.request(http.MethodPut, capacityEndpoint, capacityOwner, capacitySetup(plan.ID, false, true), http.StatusNoContent)
	paused := j.read(capacityEndpoint, capacityOwner)
	if paused == nil || !paused.Paused || paused.ID == plan.ID {
		t.Fatalf("pause must revoke previous work: %+v", paused)
	}
	if done, err := j.repo.FinishCapacityTrend(t.Context(), *lost, j.release, j.expiry, nil); err != nil || done {
		t.Fatalf("stale worker could not finish: %v, %v", done, err)
	}
	reads := j.log.reads.Load()
	if j.tick().Published != 0 || j.log.reads.Load() != reads {
		t.Fatal("paused plan performed a history read")
	}
	j.request(http.MethodPut, capacityEndpoint, capacityOwner, capacitySetup(paused.ID, true, false), http.StatusNoContent)
	resumed := j.read(capacityEndpoint, capacityOwner)
	if resumed == nil || resumed.Paused || resumed.Digest != nil || j.tick().Published != 0 || j.log.reads.Load() != reads {
		t.Fatal("resuming must not reissue a dismissed monthly digest")
	}
	clear := fmt.Sprintf("%s&plan_id=%d", capacityEndpoint, resumed.ID)
	j.request(http.MethodDelete, clear, capacityOther, nil, http.StatusConflict)
	j.request(http.MethodDelete, clear, capacityOwner, nil, http.StatusNoContent)
	if j.read(capacityEndpoint, capacityOwner) != nil {
		t.Fatal("clear must delete derived settings")
	}
}

func TestCapacityDigestUnchangedBatteryNeverPublishes(t *testing.T) {
	j := newCapacityJourney(t, 75_000)
	j.request(http.MethodPut, capacityEndpoint, capacityOwner, capacitySetup(0, true, false), http.StatusNoContent)
	j.setClock(j.release)
	batch := j.tick()
	if batch.Published != 0 || batch.Outcomes[domain.CapacityTrendWithin] != 1 {
		t.Fatalf("no lasting change must stay quiet, got %+v", batch)
	}
	if plan := j.read(capacityEndpoint, capacityOwner); plan == nil || plan.Digest != nil {
		t.Fatalf("want active with no advice, got %+v", plan)
	}
	j.tick()
	if j.log.reads.Load() != 16 {
		t.Fatal("quiet months should not be scanned again on every tick")
	}
}
