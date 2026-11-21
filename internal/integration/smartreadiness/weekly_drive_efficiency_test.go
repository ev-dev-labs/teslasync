package smartreadiness_test

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveefficiencysvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	efficiencydb "github.com/ev-dev-labs/teslasync/internal/database/driveefficiency"
	efficiency "github.com/ev-dev-labs/teslasync/internal/domain/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	efficiencyhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/driveefficiency"
	port "github.com/ev-dev-labs/teslasync/internal/port/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

const weeklyEndpoint = "/api/v1/analytics/route-efficiency/weekly-digest"
const weeklyPath = weeklyEndpoint + "?vehicle_id=7"

var weeklyRelease = time.Date(2026, 3, 9, 13, 0, 0, 0, time.UTC)

type weeklyMotion func(int64) map[string]*signal.Value

func (m weeklyMotion) GetAll(_ context.Context, vehicle int64, _ signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	return m(vehicle), nil
}

func weeklyWorker(db *database.DB, now func() time.Time) *driveefficiencysvc.Reviews {
	return driveefficiencysvc.NewReviews(efficiencydb.NewRepository(db.Pool), signal.NewLogStateReader(db.Pool, zerolog.Nop()), now).
		WithMotion(weeklyMotion(func(vehicle int64) map[string]*signal.Value {
			if vehicle != 7 {
				return nil
			}
			return map[string]*signal.Value{"Gear": {Raw: enums.GearPark, Timestamp: now()}}
		}))
}

func weeklyRouter(worker *driveefficiencysvc.Reviews, header string) http.Handler {
	h := efficiencyhandler.NewHandler(worker, header)
	router := chi.NewRouter()
	router.Get(weeklyEndpoint, h.Review)
	router.Put(weeklyEndpoint, h.Review)
	router.Patch(weeklyEndpoint, h.Review)
	router.Delete(weeklyEndpoint, h.Review)
	return router
}

func weeklyRead(t *testing.T, router http.Handler, path, subject string) port.State {
	t.Helper()
	response := invoiceRequest[struct {
		Data *port.State `json:"data"`
	}](t, router, http.MethodGet, path, subject, "", nil, http.StatusOK)
	if response.Data == nil {
		t.Fatal("weekly state response did not contain data")
	}
	return *response.Data
}

func weeklySeed(t *testing.T, otherRoad bool) *database.DB {
	t.Helper()
	_, db := testRepository(t)
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO vehicles(id,display_name) VALUES (8,'Another synthetic vehicle');
		CREATE TABLE drives (
		    id bigint PRIMARY KEY,vehicle_id bigint NOT NULL,started_at timestamptz NOT NULL,
		    ended_at timestamptz,distance_m double precision
		);
		CREATE TABLE signal_log (
		    ts timestamptz NOT NULL, vehicle_id bigint NOT NULL, field text NOT NULL, value_kind smallint NOT NULL,
		    float_value double precision, str_value text, bool_value boolean, int_value bigint, time_value timestamptz,
		    received_at timestamptz, PRIMARY KEY (vehicle_id,field,ts)
		);`); err != nil {
		t.Fatal(err)
	}
	applyWarrantyFixtureMigration(t, db, "000303_smart_weekly_drive_efficiency.up")
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	w := efficiency.Week(weeklyRelease.In(loc))
	for i := range 12 {
		localDay := w.RecentFrom.AddDate(0, 0, -31+i*3)
		amps := 12.0
		detour := 0.0
		if i >= 8 {
			localDay = w.RecentFrom.AddDate(0, 0, []int{0, 1, 4, 6}[i-8])
			amps = 18
			if otherRoad {
				detour = 0.003
			}
		}
		start := localDay.Add(10 * time.Hour)
		if _, err := db.Pool.Exec(t.Context(), `
			INSERT INTO drives VALUES ($1,7,$2::timestamptz,$2::timestamptz+INTERVAL '10 minutes',5005)`,
			801+i, start); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Pool.Exec(t.Context(), `
			INSERT INTO signal_log(ts,vehicle_id,field,value_kind,float_value)
			SELECT $1::timestamptz+sample*INTERVAL '15 seconds'+stagger,7,field,$2,val
			FROM generate_series(0,40) AS sample
			CROSS JOIN LATERAL (VALUES
			    ('LocationLatitude', 47.11+0.045*sample/40, INTERVAL '0 seconds'),
			    ('LocationLongitude', -122.3+CASE WHEN sample BETWEEN 9 AND 31 THEN $4::double precision ELSE 0 END, INTERVAL '0 seconds'),
			    ('OutsideTemp', 12::double precision, INTERVAL '0 seconds'),
			    ('PackVoltage',400::double precision, INTERVAL '-4 seconds'),
			    ('PackCurrent',$3::double precision, INTERVAL '-2 seconds')
			) AS atom(field,val,stagger)`, start, protomodel.ValueKindDouble, amps, detour); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestWeeklyEfficiencyPublishesOnlyMatchedObservedWeek(t *testing.T) {
	db := weeklySeed(t, false)
	now := weeklyRelease.Add(-time.Minute)
	clock := func() time.Time { return now }
	worker := weeklyWorker(db, clock)
	router := weeklyRouter(worker, "X-Test-Subject")
	if state := weeklyRead(t, router, weeklyPath, mediaOwner); state.Plan != nil || state.Digest != nil {
		t.Fatal("source history enrolled without consent")
	}
	if batch, err := worker.ProcessDue(t.Context(), 5); len(batch.Outcomes) != 0 || err != nil {
		t.Fatalf("checked history while off: %+v %v", batch, err)
	}
	enroll := map[string]any{"expected_revision": 0, "time_zone": "America/New_York", "confirmed": true}
	invoiceRequest[struct{}](t, weeklyRouter(worker, ""), http.MethodPut, weeklyPath, "", "open", enroll, http.StatusForbidden)
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "subject:"+mediaOther, enroll, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", enroll, http.StatusNoContent)
	if p := weeklyRead(t, router, weeklyPath, mediaOwner).Plan; p == nil || p.NextCheckAt == nil || !p.NextCheckAt.Equal(weeklyRelease) {
		t.Fatalf("private plan did not schedule 09:00 after US DST began: %+v", p)
	}
	if batch, err := worker.ProcessDue(t.Context(), 5); len(batch.Outcomes) != 0 || err != nil {
		t.Fatalf("checked before the complete week's release: %+v %v", batch, err)
	}
	now = weeklyRelease
	var workers sync.WaitGroup
	publications := make(chan int, 2)
	for range 2 {
		workers.Go(func() {
			batch, err := weeklyWorker(db, clock).ProcessDue(t.Context(), 5)
			if err != nil {
				t.Error(err)
			}
			publications <- batch.Published
		})
	}
	workers.Wait()
	if n := <-publications + <-publications; n != 1 {
		t.Fatalf("concurrent processes published %d weekly digests", n)
	}
	state := weeklyRead(t, router, weeklyPath, mediaOwner)
	e := state.Digest
	if e == nil || !e.Higher || e.ReferenceDriveID != 812 || e.BaselineDays != 8 || e.RecentDays != 4 ||
		math.Abs(e.Baseline.LowWhPerM-800.0/5005.0) > 1e-10 || math.Abs(e.Recent.HighWhPerM-1200.0/5005.0) > 1e-10 ||
		e.RecentUntil.Sub(e.RecentFrom) != 167*time.Hour {
		t.Fatalf("read did not return qualified telemetry evidence: %+v", e)
	}
	if weeklyRead(t, router, weeklyPath, mediaOther).Digest != nil || weeklyRead(t, router, weeklyEndpoint+"?vehicle_id=8", mediaOwner).Digest != nil {
		t.Fatal("private weekly digest escaped its subject or vehicle")
	}
	if batch, err := weeklyWorker(db, clock).ProcessDue(t.Context(), 5); len(batch.Outcomes) != 0 || err != nil {
		t.Fatalf("a restart rechecked the same completed week: %+v %v", batch, err)
	}
	dismiss := map[string]any{"expected_revision": state.Plan.Revision, "recent_until": e.RecentUntil}
	invoiceRequest[struct{}](t, router, http.MethodPatch, weeklyPath, mediaOwner, "", dismiss, http.StatusNoContent)
	invoiceRequest[struct{}](t, router, http.MethodPatch, weeklyPath, mediaOwner, "", dismiss, http.StatusConflict)
	if state = weeklyRead(t, router, weeklyPath, mediaOwner); !state.Dismissed || state.Digest != nil {
		t.Fatal("dismissal did not suppress this occurrence")
	}
	now = e.ExpiresAt
	invoiceRequest[struct{}](t, router, http.MethodPatch, weeklyPath, mediaOwner, "", dismiss, http.StatusConflict)
	clear := fmt.Sprintf("%s&expected_revision=%d", weeklyPath, state.Plan.Revision)
	invoiceRequest[struct{}](t, router, http.MethodDelete, clear, mediaOwner, "", nil, http.StatusNoContent)
	var drives int
	if err := db.Pool.QueryRow(t.Context(), `SELECT count(*) FROM drives`).Scan(&drives); err != nil || drives != 12 {
		t.Fatalf("clearing the private digest altered source drives: count=%d err=%v", drives, err)
	}
}

func TestWeeklyEfficiencyRejectsDifferentRoadsAndRevokedWork(t *testing.T) {
	db := weeklySeed(t, true)
	now := weeklyRelease.Add(-time.Minute)
	clock := func() time.Time { return now }
	worker := weeklyWorker(db, clock)
	router := weeklyRouter(worker, "X-Test-Subject")
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", map[string]any{
		"expected_revision": 0, "time_zone": "America/New_York", "confirmed": true,
	}, http.StatusNoContent)
	now = weeklyRelease
	if result, err := worker.ProcessDue(t.Context(), 5); err != nil || result.Published != 0 || result.Outcomes[efficiency.Insufficient] != 1 {
		t.Fatalf("same endpoints but alternate road produced a comparison: %+v %v", result, err)
	}
	state := weeklyRead(t, router, weeklyPath, mediaOwner)
	if state.Plan == nil || state.Plan.NextCheckAt == nil || state.Digest != nil {
		t.Fatalf("suppression did not advance an active plan: %+v", state)
	}
	now = *state.Plan.NextCheckAt
	repo := efficiencydb.NewRepository(db.Pool)
	job, err := repo.Claim(t.Context(), now, now.Add(5*time.Minute))
	if err != nil || job == nil {
		t.Fatalf("could not claim the next week: %+v %v", job, err)
	}
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", map[string]any{
		"expected_revision": job.Revision, "paused": true,
	}, http.StatusNoContent)
	if current, err := repo.Current(t.Context(), *job, now); err != nil || current {
		t.Fatalf("a paused plan still authorized history: %t %v", current, err)
	}
	if sent, err := repo.Finish(t.Context(), *job, now, now.AddDate(0, 0, 7), "2026-03-16", new(efficiency.Digest)); err != nil || sent {
		t.Fatalf("revoked work changed private state: %t %v", sent, err)
	}
	state = weeklyRead(t, router, weeklyPath, mediaOwner)
	if state.Plan == nil || !state.Plan.Paused || state.Digest != nil {
		t.Fatalf("revoked worker revived a paused plan: %+v", state)
	}
}

func TestWeeklyEfficiencyRequiresFreshParkForDiscretionaryActions(t *testing.T) {
	db := weeklySeed(t, false)
	now := weeklyRelease.Add(-time.Minute)
	gear := signal.Value{Raw: enums.GearDrive, Timestamp: now}
	var speed *signal.Value
	worker := weeklyWorker(db, func() time.Time { return now }).WithMotion(weeklyMotion(func(vehicle int64) map[string]*signal.Value {
		if vehicle != 7 {
			t.Fatalf("read live evidence for wrong vehicle: %d", vehicle)
		}
		return map[string]*signal.Value{"Gear": &gear, "VehicleSpeed": speed}
	}))
	router := weeklyRouter(worker, "X-Test-Subject")
	enroll := map[string]any{"expected_revision": 0, "time_zone": "America/New_York", "confirmed": true}
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", enroll, http.StatusConflict)
	gear = signal.Value{Raw: enums.GearPark, Timestamp: now.Add(-3 * time.Minute)}
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", enroll, http.StatusConflict)
	if state := weeklyRead(t, router, weeklyPath, mediaOwner); state.Plan != nil || state.ReviewAllowedUntil != nil {
		t.Fatalf("stale Park evidence authorized enrollment: %+v", state)
	}
	gear.Timestamp = now
	speed = &signal.Value{Raw: 2.0, Timestamp: now}
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", enroll, http.StatusConflict)
	speed = &signal.Value{Raw: 0.0, Timestamp: now}
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", enroll, http.StatusNoContent)
	now = weeklyRelease
	if batch, err := worker.ProcessDue(t.Context(), 5); batch.Published != 1 || err != nil {
		t.Fatalf("expected one passive private digest: %+v %v", batch, err)
	}
	gear = signal.Value{Raw: enums.GearDrive, Timestamp: now}
	state := weeklyRead(t, router, weeklyPath, mediaOwner)
	if state.ReviewAllowedUntil != nil || state.Digest == nil {
		t.Fatalf("motion must leave the digest passive and readable: %+v", state)
	}
	dismiss := map[string]any{"expected_revision": state.Plan.Revision, "recent_until": state.Digest.RecentUntil}
	invoiceRequest[struct{}](t, router, http.MethodPatch, weeklyPath, mediaOwner, "", dismiss, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodPut, weeklyPath, mediaOwner, "", map[string]any{
		"expected_revision": state.Plan.Revision, "paused": true,
	}, http.StatusNoContent)
}

func TestWeeklyEfficiencyBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	db := weeklySeed(t, false)
	now := weeklyRelease.Add(-time.Minute)
	clock := func() time.Time { return now }
	gear := enums.GearPark
	worker := weeklyWorker(db, clock).WithMotion(weeklyMotion(func(vehicle int64) map[string]*signal.Value {
		if vehicle != 7 {
			return nil
		}
		return map[string]*signal.Value{"Gear": {Raw: gear, Timestamp: now}}
	}))
	mounted := weeklyRouter(worker, "X-Test-Subject")
	var gate sync.Mutex
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		mounted.ServeHTTP(w, r)
	})
	tick := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gate.Lock()
		defer gate.Unlock()
		var want int
		switch r.URL.Query().Get("phase") {
		case "early":
			now, gear = weeklyRelease.Add(-time.Minute), enums.GearPark
		case "due":
			now, gear, want = weeklyRelease, enums.GearPark, 1
		case "moving":
			gear = enums.GearDrive
			w.WriteHeader(http.StatusNoContent)
			return
		case "parked":
			gear = enums.GearPark
			w.WriteHeader(http.StatusNoContent)
			return
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		got, err := worker.ProcessDue(r.Context(), 4)
		if err != nil || got.Published != want || (want == 0 && len(got.Outcomes) != 0) {
			t.Errorf("expected %d publication(s): %+v %v", want, got, err)
			http.Error(w, "unexpected worker result", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	runPrivateMediaBrowserWithWorker(t, router, "synthetic-efficiency", "smart-weekly-efficiency.smoke.spec.ts",
		"SMART_WEEKLY_EFFICIENCY_REAL_BACKEND", "/__fixture/weekly-efficiency", tick)
}
