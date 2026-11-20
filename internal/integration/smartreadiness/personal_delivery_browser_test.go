package smartreadiness_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/go-chi/chi/v5"
)

func TestPrivatePersonalDeliveryBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_CHARGING_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_CHARGING_BROWSER=1 to run the real-handler browser journey")
	}
	j := newChargingDeliveryJourney(t, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	j.ctx = ctx
	j.advance(time.Now().UTC())
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000223_action_center_state.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := j.db.Pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	actionService := actioncentersvc.New(
		emptySources{}, actiondb.NewStateRepository(j.db), actioncentersvc.WithSmartCharging(j.readiness),
		actioncentersvc.WithClock(func() time.Time { return j.now }),
	)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject").MountRoutes(r)
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
		r.Get("/action-center", actionhandler.NewHandler(actionService, "X-Test-Subject").List)
	})

	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := filepath.Join(webRoot, "dist")
	if os.Getenv("TESLASYNC_BROWSER_E2E_DIST") == "1" {
		distRoot = filepath.Join(webRoot, "e2e", ".app-dist")
	}
	index := filepath.Join(distRoot, "index.html")
	if _, err := os.Stat(index); err != nil {
		t.Fatalf("build the frontend before running the browser journey: %v", err)
	}
	static := http.FileServer(http.Dir(distRoot))
	var fixtureMu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/__fixture/latest-push" && r.Method == http.MethodGet:
			_, payload := j.sender.last()
			if len(payload) == 0 {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(payload)
			return
		case r.URL.Path == "/__fixture/process" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			j.advance(time.Now().UTC())
			if _, err := j.readiness.ProcessDue(r.Context(), 50); err != nil {
				http.Error(w, "fixture processing failed", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			cookie, cookieErr := r.Cookie("personal_test_subject")
			allowed := map[string]bool{
				"synthetic-personal-a-desktop": true, "synthetic-personal-b-desktop": true,
				"synthetic-personal-a-mobile": true, "synthetic-personal-b-mobile": true,
			}
			if cookieErr != nil || !allowed[cookie.Value] {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-Test-Subject", cookie.Value)
			router.ServeHTTP(w, r)
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

	cmd := exec.CommandContext(ctx, "node",
		filepath.Join("node_modules", "@playwright", "test", "cli.js"), "test",
		filepath.Join("e2e", "personal-delivery.real.smoke.spec.ts"),
		"--project=chromium-smoke", "--workers=1", "--retries=0", "--reporter=line", "--headed",
		"--output="+filepath.Join(os.TempDir(), "teslasync-personal-delivery-browser-results"),
	)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(),
		"E2E_BASE_URL="+server.URL,
		"E2E_SENSITIVE=1",
		"SMART_PERSONAL_REAL_BACKEND=1",
		"CI=1",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("personal delivery browser journey failed: %v\n%s", err, output)
	}
	t.Logf("personal delivery browser journey:\n%s", output)
}
