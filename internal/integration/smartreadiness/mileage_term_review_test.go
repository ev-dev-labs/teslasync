package smartreadiness_test

import (
	"fmt"
	"math"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	mileagesvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/mileageterm"
	"github.com/ev-dev-labs/teslasync/internal/database"
	ownershipdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	mileagedb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/mileageterm"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel/mileageterm"
	ownershiphandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/ownershipintel"
	"github.com/go-chi/chi/v5"
)

const mileageEndpoint = "/api/v1/analytics/mileage-budget/review"
const mileagePath = mileageEndpoint + "?vehicle_id=7"

var mileageEarly = time.Date(2026, 4, 2, 12, 59, 0, 0, time.UTC)

type mileageSelection struct {
	TimeZone   string  `json:"time_zone"`
	FirstDay   string  `json:"first_day"`
	EndDay     string  `json:"end_day"`
	OpeningM   float64 `json:"opening_odometer_m"`
	AllowanceM float64 `json:"allowance_m"`
	MinimumM   float64 `json:"minimum_overage_m"`
	Paused     bool    `json:"paused"`
	ExpectedID int64   `json:"expected_plan_id"`
	Confirmed  bool    `json:"terms_confirmed"`
}

func mileageRouter(db *database.DB, now func() time.Time, header string) http.Handler {
	svc := ownershipintelsvc.New(ownershipdb.NewSourceRepository(db), ownershipdb.NewDurableRepository(db))
	router := chi.NewRouter()
	router.Route("/api/v1", ownershiphandler.NewHandler(svc, header).
		WithMileageTermReviews(mileagesvc.NewReviews(mileagedb.NewRepository(db.Pool), now)).MountRoutes)
	return router
}

func seedMileageTerm(t *testing.T) (*database.DB, mileageSelection) {
	t.Helper()
	_, db := testRepository(t)
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO vehicles(id,display_name) VALUES (8,'Other synthetic vehicle');
		CREATE TABLE drives (
			id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz, end_odometer_m double precision
		);
		CREATE TABLE signal_log (
			vehicle_id bigint NOT NULL, field text NOT NULL, ts timestamptz NOT NULL,
			float_value double precision, source_emitted_at timestamptz, received_at timestamptz,
			PRIMARY KEY(vehicle_id,field,ts)
		);`); err != nil {
		t.Fatal(err)
	}
	applyWarrantyFixtureMigration(t, db, "000300_smart_mileage_term_reviews.up")
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 2, 1, 0, 0, 0, 0, loc)
	const opening = 8_000_000
	for day := 18; day <= 58; day += 5 {
		end := start.AddDate(0, 0, day)
		if _, err := db.Pool.Exec(t.Context(), `
			WITH completed AS (
			    INSERT INTO drives(vehicle_id,started_at,ended_at,end_odometer_m) VALUES
			    (7,$1,$2,$3),(8,$1,$2,42) RETURNING vehicle_id,end_odometer_m
			)
			INSERT INTO signal_log SELECT vehicle_id,'Odometer',$4,end_odometer_m,$4,$4::timestamptz+INTERVAL '1 second' FROM completed`,
			end.Add(-time.Hour), end, float64(opening+day*2000), end.Add(-time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	return db, mileageSelection{TimeZone: "America/New_York", FirstDay: "2026-02-01", EndDay: "2027-08-01",
		OpeningM: opening, AllowanceM: 700_000, MinimumM: 40_000, Confirmed: true}
}

func TestMileageTermReviewPublishesPrivateActualTerm(t *testing.T) {
	now := mileageEarly
	clock := func() time.Time { return now }
	db, selection := seedMileageTerm(t)
	repo := mileagedb.NewRepository(db.Pool)
	read := func(path, subject string) domain.Review {
		t.Helper()
		return invoiceRequest[domain.Review](t, mileageRouter(db, clock, "X-Test-Subject"), http.MethodGet, path, subject, "", nil, http.StatusOK)
	}
	if got := read(mileagePath, mediaOwner); got.Settings != nil || got.Digest != nil {
		t.Fatal("new vehicle unexpectedly opted in")
	}
	if out, err := mileagesvc.NewReviews(repo, clock).ProcessDue(t.Context(), 4); err != nil || len(out.Outcomes) != 0 {
		t.Fatalf("opt-out evaluated evidence: %+v %v", out, err)
	}
	router := mileageRouter(db, clock, "X-Test-Subject")
	open := mileageRouter(db, clock, "")
	invoiceRequest[struct{}](t, open, http.MethodPut, mileagePath, "", "open", selection, http.StatusForbidden)
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "subject:"+mediaOther, selection, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "",
		map[string]any{"expected_plan_id": 0, "time_zone": selection.TimeZone, "first_day": selection.FirstDay, "end_day": selection.EndDay,
			"allowance_m": selection.AllowanceM, "minimum_overage_m": selection.MinimumM, "terms_confirmed": true}, http.StatusBadRequest)
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	if out, err := mileagesvc.NewReviews(repo, clock).ProcessDue(t.Context(), 4); err != nil || len(out.Outcomes) != 0 {
		t.Fatalf("before local release: %+v %v", out, err)
	}
	now = now.Add(time.Minute)
	var wg sync.WaitGroup
	publications := make(chan int, 2)
	for range 2 {
		wg.Go(func() {
			out, err := mileagesvc.NewReviews(mileagedb.NewRepository(db.Pool), clock).ProcessDue(t.Context(), 4)
			if err != nil {
				t.Error(err)
			}
			publications <- out.Published
		})
	}
	wg.Wait()
	if count := <-publications + <-publications; count != 1 {
		t.Fatalf("new worker replicas published %d reviews", count)
	}
	current := read(mileagePath, mediaOwner)
	through := time.Date(2026, 4, 1, 4, 0, 0, 0, time.UTC)
	if current.Settings == nil || current.Digest == nil || !current.Digest.Through.Equal(through) {
		t.Fatalf("private estimate missing: %+v", current)
	}
	p := current.Digest.Projection
	const used, observedHours, termHours = 116_000.0, 1_391.0 - 1.0/60, 13_103
	if p.ObservedDays != 9 || p.UsedM != used || !p.ObservedAt.Equal(current.Digest.Through.Add(-24*time.Hour-time.Minute)) ||
		p.LowerM != math.Floor(used+used*.8*(termHours-observedHours)/observedHours) ||
		p.UpperM != math.Ceil(used+used*1.2*(termHours-observedHours)/observedHours) {
		t.Fatalf("wrong scope, term or measured distance: %+v", p)
	}
	for _, other := range []domain.Review{read(mileagePath, mediaOther), read(mileageEndpoint+"?vehicle_id=8", mediaOwner)} {
		if other.Settings != nil || other.Digest != nil {
			t.Fatal("leaked another subject or vehicle's private terms")
		}
	}
	id := current.Settings.ID
	invoiceRequest[struct{}](t, router, http.MethodPatch, mileagePath, mediaOwner, "",
		map[string]any{"plan_id": id, "through": current.Digest.Through}, http.StatusNoContent)
	if read(mileagePath, mediaOwner).Digest != nil {
		t.Fatal("dismissed estimate resurfaced")
	}
	selection.ExpectedID, selection.Paused, selection.Confirmed = id, true, false
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	paused := read(mileagePath, mediaOwner)
	if paused.Settings == nil || !paused.Settings.Paused {
		t.Fatal("plan did not pause")
	}
	selection.ExpectedID, selection.Paused, selection.Confirmed = paused.Settings.ID, false, true
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	if out, err := mileagesvc.NewReviews(repo, clock).ProcessDue(t.Context(), 4); err != nil || len(out.Outcomes) != 0 {
		t.Fatalf("resumed estimate repeated the finished month: %+v %v", out, err)
	}
	path := fmt.Sprintf("%s&plan_id=%d", mileagePath, read(mileagePath, mediaOwner).Settings.ID)
	invoiceRequest[struct{}](t, router, http.MethodDelete, path, mediaOther, "", nil, http.StatusConflict)
	invoiceRequest[struct{}](t, router, http.MethodDelete, path, mediaOwner, "", nil, http.StatusNoContent)
	if got := read(mileagePath, mediaOwner); got.Settings != nil || got.Digest != nil {
		t.Fatalf("revoked estimate or terms survived: %+v", got)
	}
	var drives int
	if err := db.Pool.QueryRow(t.Context(), `SELECT count(*) FROM drives`).Scan(&drives); err != nil || drives != 18 {
		t.Fatalf("revoking must preserve the drives: %d %v", drives, err)
	}
}

func TestMileageTermReviewSuppressesUnqualifiedEvidenceAndRevokedLease(t *testing.T) {
	now := mileageEarly.Add(time.Minute)
	clock := func() time.Time { return now }
	db, selection := seedMileageTerm(t)
	router, repo := mileageRouter(db, clock, "X-Test-Subject"), mileagedb.NewRepository(db.Pool)
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	job, err := repo.Claim(t.Context(), now, now.Add(15*time.Minute))
	if err != nil || job == nil {
		t.Fatalf("claim: %+v %v", job, err)
	}
	term, ok := job.Term()
	if !ok {
		t.Fatal("invalid stored terms")
	}
	through := time.Date(2026, 4, 1, 0, 0, 0, 0, term.Start.Location())
	samples, err := repo.ReadObservations(t.Context(), *job, term.Start, through, now)
	if err != nil {
		t.Fatal(err)
	}
	candidate, outcome := domain.Project(term, samples, through, now)
	if candidate == nil || outcome != domain.OffPace {
		t.Fatalf("the cancelled work had no qualified candidate: %+v %s", candidate, outcome)
	}
	invoiceRequest[struct{}](t, router, http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", mileagePath, job.ID),
		mediaOwner, "", nil, http.StatusNoContent)
	next := now.AddDate(0, 1, 0)
	if saved, err := repo.Finish(t.Context(), *job, now, next, &next, &domain.Digest{Through: through, CheckedAt: now,
		ExpiresAt: next, Projection: *candidate}); err != nil || saved {
		t.Fatalf("revoked lease completed: %t %v", saved, err)
	}
	if remaining, err := repo.ReadObservations(t.Context(), *job, term.Start, through, now); err != nil || len(remaining) != 0 {
		t.Fatalf("revoked lease read data: %d %v", len(remaining), err)
	}
	selection.AllowanceM = 880_000
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	service := mileagesvc.NewReviews(repo, clock)
	if batch, err := service.ProcessDue(t.Context(), 4); err != nil || batch.Published != 0 || batch.Outcomes[domain.NotMaterial] != 1 {
		t.Fatalf("small or uncertain overage was not suppressed: %+v %v", batch, err)
	}
	if _, err := db.Pool.Exec(t.Context(), `UPDATE signal_log SET float_value=1000 WHERE vehicle_id=7 AND ts=(SELECT max(ts) FROM signal_log)`); err != nil {
		t.Fatal(err)
	}
	selection.AllowanceM = 700_000
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOther, "", selection, http.StatusNoContent)
	if batch, err := service.ProcessDue(t.Context(), 4); err != nil || batch.Published != 0 || batch.Outcomes[domain.ConflictingEvidence] != 1 {
		t.Fatalf("inconsistent observation was not suppressed: %+v %v", batch, err)
	}
	for _, subject := range []string{mediaOwner, mediaOther} {
		result := invoiceRequest[domain.Review](t, router, http.MethodGet, mileagePath, subject, "", nil, http.StatusOK)
		if result.Digest != nil {
			t.Fatalf("an unqualified candidate became actionable: %+v", result.Digest)
		}
	}
}

func TestMileageTermReviewDoesNotCountCarriedForwardDriveOdometers(t *testing.T) {
	now := mileageEarly.Add(time.Minute)
	clock := func() time.Time { return now }
	db, selection := seedMileageTerm(t)
	router := mileageRouter(db, clock, "X-Test-Subject")
	// Nine completed drives retain estimates; only three drives carried a new,
	// attested reading. The newest attested reading is also outside the fresh window.
	if _, err := db.Pool.Exec(t.Context(), `
		WITH ordered AS (
		    SELECT ts,row_number() OVER (ORDER BY ts) AS observation FROM signal_log WHERE vehicle_id=7
		)
		UPDATE signal_log SET source_emitted_at=NULL
		WHERE vehicle_id=7 AND ts IN (SELECT ts FROM ordered WHERE observation NOT IN (1,4,7));
		UPDATE drives d SET end_odometer_m=(
		    SELECT s.float_value FROM signal_log s
		    WHERE s.vehicle_id=d.vehicle_id AND s.ts<=d.ended_at AND s.source_emitted_at=s.ts
		    ORDER BY s.ts DESC LIMIT 1
		) WHERE d.vehicle_id=7`); err != nil {
		t.Fatal(err)
	}
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	result, err := mileagesvc.NewReviews(mileagedb.NewRepository(db.Pool), clock).ProcessDue(t.Context(), 4)
	if err != nil || result.Published != 0 || result.Outcomes[domain.InsufficientEvidence] != 1 {
		t.Fatalf("carry-forward drive odometers qualified a projection: %+v %v", result, err)
	}
	current := invoiceRequest[domain.Review](t, router, http.MethodGet, mileagePath, mediaOwner, "", nil, http.StatusOK)
	if current.Digest != nil {
		t.Fatalf("unattested drive endpoints made a review actionable: %+v", current.Digest)
	}
}

func TestMileageTermReviewDoesNotRepeatLastCycleWhenExtended(t *testing.T) {
	now := mileageEarly.Add(time.Minute)
	clock := func() time.Time { return now }
	db, selection := seedMileageTerm(t)
	router := mileageRouter(db, clock, "X-Test-Subject")
	service := mileagesvc.NewReviews(mileagedb.NewRepository(db.Pool), clock)
	selection.EndDay, selection.AllowanceM, selection.MinimumM = "2026-04-20", 100_000, 5_000
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	if batch, err := service.ProcessDue(t.Context(), 4); err != nil || batch.Published != 1 {
		t.Fatalf("last actionable review did not publish: %+v %v", batch, err)
	}
	finished := invoiceRequest[domain.Review](t, router, http.MethodGet, mileagePath, mediaOwner, "", nil, http.StatusOK)
	if finished.Settings == nil || finished.Digest == nil || finished.Settings.Paused || finished.NextCheckAt != nil {
		t.Fatalf("completed term not readable without further checks: %+v", finished)
	}
	selection.ExpectedID, selection.EndDay = finished.Settings.ID, "2026-06-20"
	invoiceRequest[struct{}](t, router, http.MethodPut, mileagePath, mediaOwner, "", selection, http.StatusNoContent)
	extended := invoiceRequest[domain.Review](t, router, http.MethodGet, mileagePath, mediaOwner, "", nil, http.StatusOK)
	next := time.Date(2026, 5, 2, 13, 0, 0, 0, time.UTC)
	if extended.Digest != nil || extended.NextCheckAt == nil || !extended.NextCheckAt.Equal(next) {
		t.Fatalf("term extension did not keep the monthly cadence: %+v", extended)
	}
	if batch, err := service.ProcessDue(t.Context(), 4); err != nil || len(batch.Outcomes) != 0 || batch.Published != 0 {
		t.Fatalf("term extension repeated an already checked month: %+v %v", batch, err)
	}
}

func TestMileageTermReviewBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_MEDIA_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_MEDIA_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	now := mileageEarly
	clock := func() time.Time { return now }
	db, _ := seedMileageTerm(t)
	mounted := mileageRouter(db, clock, "X-Test-Subject")
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
			now = mileageEarly
		case "due":
			now, want = mileageEarly.Add(time.Minute), 1
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		out, err := mileagesvc.NewReviews(mileagedb.NewRepository(db.Pool), clock).ProcessDue(r.Context(), 4)
		if err != nil || out.Published != want || (want == 0 && len(out.Outcomes) != 0) {
			t.Errorf("expected %d publication(s): %+v %v", want, out, err)
			http.Error(w, "unexpected worker result", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	runPrivateMediaBrowserWithWorker(t, router, "synthetic-mileage", "smart-mileage-term-review.smoke.spec.ts",
		"SMART_MILEAGE_TERM_REAL_BACKEND", "/__fixture/mileage-term-review", tick)
}
