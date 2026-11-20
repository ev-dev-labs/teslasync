package smartreadiness_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestPrivateChargingBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_CHARGING_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_CHARGING_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	repo, db := testRepository(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(context.Background(), string(migration)); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	seedSitePerformance(t, db, now)
	if _, err := db.Pool.Exec(context.Background(), `
		INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from, effective_to)
		VALUES (9, 0.0004, 'USD', $1, $2), (9, 0.0001, 'USD', $2, NULL)`,
		now.Add(-time.Hour), now.Add(3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var clockNanos atomic.Int64
	clockNanos.Store(now.UnixNano())
	clock := func() time.Time { return time.Unix(0, clockNanos.Load()).UTC() }
	live := &controlledLive{values: map[string]*signal.Value{
		"BatteryLevel":             {Raw: 45.0, Timestamp: now},
		"DetailedChargeState":      {Raw: "Disconnected", Timestamp: now},
		"Gear":                     {Raw: "P", Timestamp: now},
		"LocationLatitude":         {Raw: 47.1, Timestamp: now},
		"LocationLongitude":        {Raw: -122.1, Timestamp: now},
		"NominalFullPackEnergyKwh": {Raw: 80000.0, Timestamp: now},
		"ACChargingPower":          {Raw: 500.0, Timestamp: now},
		"ChargeCurrentRequest":     {Raw: 12.0, Timestamp: now},
		"ChargeCurrentRequestMax":  {Raw: 32.0, Timestamp: now},
	}}
	refresh := func() {
		live.mu.Lock()
		defer live.mu.Unlock()
		for _, value := range live.values {
			value.Timestamp = clock()
		}
	}
	authService := smartreadinesssvc.New(repo, live, controlledSite{},
		smartreadinesssvc.WithSitePerformance(repo), smartreadinesssvc.WithClock(clock))
	openService := smartreadinesssvc.New(repo, live, controlledSite{},
		smartreadinesssvc.WithSharedOpenMode(true), smartreadinesssvc.WithSitePerformance(repo), smartreadinesssvc.WithClock(clock))
	buildRouter := func(service *smartreadinesssvc.Service, header string) http.Handler {
		actionService := actioncentersvc.New(
			emptySources{}, actiondb.NewStateRepository(db), actioncentersvc.WithSmartCharging(service),
			actioncentersvc.WithChargingSitePerformance(service), actioncentersvc.WithClock(clock),
		)
		router := chi.NewRouter()
		router.Route("/api/v1", func(r chi.Router) {
			readinesshandler.NewHandler(service, header).MountRoutes(r)
			action := actionhandler.NewHandler(actionService, header)
			r.Get("/action-center", action.List)
		})
		return router
	}
	authRouter := buildRouter(authService, "X-Test-Subject")
	openRouter := buildRouter(openService, "")
	workerCtx, stopWorker := context.WithCancel(context.Background())
	workerDone := make(chan error, 1)
	var workMu sync.Mutex
	process := func(ctx context.Context) error {
		refresh()
		for _, service := range []*smartreadinesssvc.Service{authService, openService} {
			if _, err := service.ProcessDue(ctx, 10); err != nil {
				return err
			}
		}
		return nil
	}
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				workerDone <- nil
				return
			case <-ticker.C:
				workMu.Lock()
				err := process(workerCtx)
				workMu.Unlock()
				if err != nil && workerCtx.Err() == nil {
					workerDone <- err
					return
				}
			}
		}
	}()
	defer func() {
		stopWorker()
		if err := <-workerDone; err != nil {
			t.Errorf("synthetic readiness worker: %v", err)
		}
	}()

	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := filepath.Join(webRoot, "dist")
	index := filepath.Join(distRoot, "index.html")
	if _, err := os.Stat(index); err != nil {
		t.Fatalf("build the frontend before running the browser journey: %v", err)
	}
	static := http.FileServer(http.Dir(distRoot))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__fixture/charge" && r.Method == http.MethodPost {
			var body struct {
				State          string   `json:"state"`
				AdvanceSeconds int64    `json:"advance_seconds"`
				PowerW         *float64 `json:"power_w"`
				ScheduleClock  string   `json:"schedule_clock"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body) != nil ||
				(body.State != "Disconnected" && body.State != "Charging" && body.State != "NoPower") ||
				body.AdvanceSeconds < 0 || body.AdvanceSeconds > 60 ||
				(body.PowerW != nil && (*body.PowerW <= 0 || *body.PowerW > 500000)) {
				http.Error(w, "invalid fixture state", http.StatusBadRequest)
				return
			}
			var scheduleClock time.Time
			if body.ScheduleClock != "" {
				var parseErr error
				scheduleClock, parseErr = time.Parse("15:04", body.ScheduleClock)
				if parseErr != nil || body.State != "NoPower" {
					http.Error(w, "invalid fixture schedule", http.StatusBadRequest)
					return
				}
			}
			workMu.Lock()
			clockNanos.Add(body.AdvanceSeconds * int64(time.Second))
			live.mu.Lock()
			live.values["DetailedChargeState"].Raw = body.State
			live.values["ScheduledChargingPending"] = &signal.Value{Raw: !scheduleClock.IsZero()}
			live.values["ScheduledChargingStartTime"] = &signal.Value{Raw: scheduleClock}
			live.values["ChargePortLatch"] = &signal.Value{Raw: "Engaged"}
			if body.PowerW != nil {
				live.values["ACChargingPower"].Raw = *body.PowerW
			} else if body.State == "NoPower" {
				live.values["ACChargingPower"].Raw = 0.0
			}
			live.mu.Unlock()
			processErr := process(r.Context())
			workMu.Unlock()
			if processErr != nil {
				http.Error(w, "fixture processing failed", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/") {
			if r.Header.Get("X-Test-Open") == "1" {
				openRouter.ServeHTTP(w, r)
			} else {
				authRouter.ServeHTTP(w, r)
			}
			return
		}
		relative := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		file := filepath.Join(distRoot, filepath.FromSlash(relative))
		if info, statErr := os.Stat(file); statErr == nil && !info.IsDir() {
			static.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index)
	}))
	defer server.Close()

	// Each of the four real-handler browser variants has a two-minute deadline.
	runCtx, cancel := context.WithTimeout(context.Background(), 9*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "node",
		filepath.Join("node_modules", "@playwright", "test", "cli.js"), "test",
		filepath.Join("e2e", "smart-charging.smoke.spec.ts"),
		"--grep=charging readiness is consented and scoped:",
		"--project=chromium-smoke", "--workers=1", "--retries=0", "--reporter=line",
		"--output="+filepath.Join(os.TempDir(), "teslasync-smart-charging-browser-results"),
	)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(),
		"E2E_BASE_URL="+server.URL,
		"E2E_SENSITIVE=1",
		"SMART_CHARGING_REAL_BACKEND=1",
		"CI=1",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser journey failed: %v\n%s", err, output)
	}
	t.Logf("browser journey:\n%s", output)
}
