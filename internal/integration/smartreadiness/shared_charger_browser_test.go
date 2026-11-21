package smartreadiness_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/go-chi/chi/v5"
)

func TestSharedChargerBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_SHARED_CHARGER_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_SHARED_CHARGER_BROWSER=1 to run the real-handler browser journey")
	}
	repo, db := testRepository(t)
	applyWarrantyFixtureMigration(t, db, "000316_smart_shared_charger.up")
	start := time.Date(2030, 1, 21, 12, 0, 0, 0, time.UTC)
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic second vehicle');
		UPDATE geofences SET updated_at='2030-01-21T12:00:00Z' WHERE id=9`); err != nil {
		t.Fatal(err)
	}
	var unix atomic.Int64
	unix.Store(start.Unix())
	clock := func() time.Time { return time.Unix(unix.Load(), 0).UTC() }
	operators := auth.NewOperatorAccess("X-Test-Subject", "synthetic-charger-operator")
	service := smartreadinesssvc.NewSharedChargerService(repo, func(ctx context.Context, subject string) (bool, error) {
		return operators.Allows(ctx, subject), nil
	}, clock)
	router := chi.NewRouter()
	router.Route("/api/v1", readinesshandler.NewSharedChargerHandler(service, "X-Test-Subject").MountRoutes)
	runPrivatePlanningBrowser(t, router, "/__fixture/shared-charger-clock", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("stage") {
		case "start":
			unix.Store(start.Unix())
		case "swap":
			unix.Store(start.Add(31 * time.Minute).Unix())
		default:
			http.Error(w, "unknown fixture stage", http.StatusBadRequest)
			return
		}
		count, err := service.PublishDueReminders(r.Context(), 10)
		if err != nil {
			t.Errorf("publish from the fixture clock: %v", err)
			http.Error(w, "fixture reminder failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]int{"published": count}); err != nil {
			t.Errorf("write fixture response: %v", err)
		}
	}), "shared-charger.real.smoke.spec.ts", "SMART_SHARED_CHARGER_REAL_BACKEND=1", nil)
}
