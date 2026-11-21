package smartreadiness_test

import (
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
)

func TestSharedTripBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_SHARED_TRIP_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_SHARED_TRIP_BROWSER=1 to run the real-handler browser journey")
	}
	repo, db := testRepository(t)
	applyWarrantyFixtureMigration(t, db, "000317_smart_shared_trip.up")
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic second vehicle'),(9,'Synthetic uncleared vehicle')`); err != nil {
		t.Fatal(err)
	}
	start := time.Date(2030, 1, 21, 12, 0, 0, 0, time.UTC)
	var unix atomic.Int64
	unix.Store(start.Add(-time.Minute).Unix())
	clock := func() time.Time { return time.Unix(unix.Load(), 0).UTC() }
	store := signal.New()
	live, err := signal.NewHybridLiveSignalStore(store, nil, signal.LiveSignalStoreModeLocal)
	if err != nil {
		t.Fatal(err)
	}
	operators := auth.NewOperatorAccess("X-Test-Subject", "synthetic-trip-operator")
	service := smartreadinesssvc.NewSharedTripService(repo, live, operators.Allows, clock)
	router := chi.NewRouter()
	router.Route("/api/v1", readinesshandler.NewSharedTripHandler(service, "X-Test-Subject").MountRoutes)
	runPrivatePlanningBrowser(t, router, "/__fixture/shared-trip-clock", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("stage") {
		case "start":
			unix.Add(int64(time.Minute / time.Second))
		case "stale":
			unix.Add(int64(3 * time.Minute / time.Second))
			w.WriteHeader(http.StatusNoContent)
			return
		case "fresh":
		default:
			http.Error(w, "unknown fixture stage", http.StatusBadRequest)
			return
		}
		now := clock()
		for i, soc := range []int32{70, 80, 95} {
			store.UpdateValues(int64(7+i), map[string]*signal.Value{
				"BatteryLevel": {Raw: soc, Timestamp: now},
			})
		}
		w.WriteHeader(http.StatusNoContent)
	}), "shared-trip.real.smoke.spec.ts", "SMART_SHARED_TRIP_REAL_BACKEND=1", nil)
}
