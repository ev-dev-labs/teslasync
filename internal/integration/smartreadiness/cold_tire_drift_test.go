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

func coldTireTestRouter(repo *readinessdb.Repository, db *database.DB, header string, clock func() time.Time) http.Handler {
	checks := smartreadinesssvc.NewColdTireChecks(repo, clock)
	service := smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}, smartreadinesssvc.WithClock(clock))
	recommendations := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithColdTireDrift(checks), actioncentersvc.WithClock(clock))
	r := chi.NewRouter()
	r.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(service, header, readinesshandler.WithColdTireChecks(checks)).MountRoutes(r)
		r.Route("/tire-pressure", func(r chi.Router) {
			r.Get("/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
		})
		r.Get("/action-center", actionhandler.NewHandler(recommendations, header).List)
	})
	return r
}

func TestPrivateColdTireBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_TIRE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_TIRE_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	repo, db := testRepository(t)
	for _, name := range []string{"000223_action_center_state.up", "000280_smart_cold_tire_reviews.up"} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	now := time.Now().UTC().Truncate(time.Second)
	router := coldTireTestRouter(repo, db, "X-Test-Subject", func() time.Time { return now })
	runPrivatePlanningBrowser(t, router, "", nil, "smart-tire-drift.smoke.spec.ts", "SMART_TIRE_REAL_BACKEND=1", nil)
}

func TestColdTireReviewPersistsOnlyScopedRepeatedDrift(t *testing.T) {
	repo, db := testRepository(t)
	for _, name := range []string{"000223_action_center_state.up", "000280_smart_cold_tire_reviews.up"} {
		applyWarrantyFixtureMigration(t, db, name)
	}
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	const owner = "synthetic-gauge-owner"
	const other = "synthetic-gauge-other"
	const endpoint = "/api/v1/tire-pressure/cold-checks?vehicle_id=7"
	const inbox = "/api/v1/action-center?vehicle_id=7&source_feature=cold_tire_drift"
	closed, open := coldTireTestRouter(repo, db, "X-Test-Subject", clock), coldTireTestRouter(repo, db, "", clock)
	call := func(router http.Handler, method, url, subject string, body any, status int) *httptest.ResponseRecorder {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, url, bytes.NewReader(data))
		expected := "open"
		if subject != "" {
			req.Header.Set("X-Test-Subject", subject)
			expected = "subject:" + subject
		}
		req.Header.Set("X-TeslaSync-Expected-Principal", expected)
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		if resp.Code != status || resp.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d (%s), want %d no-store: %s", method, url, resp.Code, resp.Header().Get("Cache-Control"), status, resp.Body.String())
		}
		return resp
	}
	read := func(subject string) domain.ColdTireReview {
		t.Helper()
		var decoded struct{ Data domain.ColdTireReview }
		if err := json.Unmarshal(call(closed, http.MethodGet, endpoint, subject, nil, 200).Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded.Data
	}
	list := func(subject string) []actiondomain.Recommendation {
		t.Helper()
		var decoded actiondomain.Response
		if err := json.Unmarshal(call(closed, http.MethodGet, inbox, subject, nil, 200).Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded.Items
	}
	type submission struct {
		domain.ColdTireReading
		SeriesID int64 `json:"expected_series_id"`
	}
	makeSample := func(i int, peerOnly bool, seriesID int64) submission {
		common := []float64{270_000, 278_000, 274_000, 282_000, 276_000}
		drop := []float64{0, 4_000, 9_000, 17_000, 23_000}
		left := common[i]
		if !peerOnly {
			left -= drop[i]
		}
		return submission{SeriesID: seriesID, ColdTireReading: domain.ColdTireReading{
			ObservedAt: now.Add(time.Duration(-9+i*2) * 24 * time.Hour), AmbientC: 7 + float64(i%2),
			FrontLeftPa: left, FrontRightPa: common[i], RearLeftPa: common[i] - 9_000, RearRightPa: common[i] - 8_000,
			ColdGaugeConfirmed: true,
		}}
	}
	if initial := read(owner); initial.SeriesID != 0 || initial.Drift != nil || len(list(owner)) != 0 {
		t.Fatalf("private cold gauge review was not off: %+v", initial)
	}
	first := makeSample(0, false, 0)
	call(open, http.MethodPost, endpoint, "", first, 403)
	first.ColdGaugeConfirmed = false
	call(closed, http.MethodPost, endpoint, owner, first, 400)
	for _, subject := range []string{owner, other} {
		var seriesID int64
		for i := range 5 {
			input := makeSample(i, subject == other, seriesID)
			call(closed, http.MethodPost, endpoint, subject, input, 204)
			seriesID = read(subject).SeriesID
			if i < 4 && len(list(subject)) != 0 {
				t.Fatal("fewer than five comparable readings published a decision")
			}
		}
	}
	review, items := read(owner), list(owner)
	if review.Drift == nil || review.Drift.Corner != domain.TireFrontLeft || review.Drift.RelativeDropPa != 13_000 ||
		len(items) != 1 || items[0].NavigationPath == nil || *items[0].NavigationPath != "/tire-differential-drift?vehicle_id=7#cold-tire-review" ||
		read(other).Drift != nil || len(list(other)) != 0 {
		t.Fatalf("private repeated-drift decision was not isolated from peer-only inputs: %+v, %+v", review, items)
	}
	call(closed, http.MethodPost, endpoint, owner, makeSample(4, false, review.SeriesID), 409)
	deletePath := fmt.Sprintf("%s&series_id=%d", endpoint, review.SeriesID)
	call(closed, http.MethodDelete, deletePath, other, nil, 204)
	if got := list(owner); len(got) != 1 || got[0].ID != items[0].ID {
		t.Fatal("duplicate reading or foreign revoke changed the owner's decision")
	}
	now = now.Add(72 * time.Hour)
	if read(owner).Drift != nil || len(list(owner)) != 0 {
		t.Fatal("stale gauge evidence remained actionable")
	}
	call(closed, http.MethodDelete, deletePath, owner, nil, 204)
	call(closed, http.MethodPost, endpoint, owner, makeSample(4, false, review.SeriesID), 409)
	if reset := read(owner); reset.SeriesID != 0 || reset.ReadingCount != 0 {
		t.Fatalf("a stale write restored removed review consent: %+v", reset)
	}
	applyWarrantyFixtureMigration(t, db, "000280_smart_cold_tire_reviews.down")
	applyWarrantyFixtureMigration(t, db, "000280_smart_cold_tire_reviews.up")
	if read(other).SeriesID != 0 {
		t.Fatal("explicit down retained derived cold tire observations")
	}
}
