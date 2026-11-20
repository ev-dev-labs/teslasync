package smartcommute_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

func requireCommuteBrowser(t *testing.T) {
	t.Helper()
	if os.Getenv("TESLASYNC_SMART_COMMUTE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_COMMUTE_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
}

func TestPrivateCommuteBrowserJourney(t *testing.T) {
	requireCommuteBrowser(t)
	f := newFixture(t)
	ctx := context.Background()
	if _, err := f.db.Pool.Exec(ctx, `
		INSERT INTO vehicles(id, display_name) VALUES (7, 'Synthetic vehicle');
		INSERT INTO drives(vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng)
		SELECT 7, started_at, ended_at, start_lat, start_lng, end_lat, end_lng
		FROM drives WHERE vehicle_id = 42`); err != nil {
		t.Fatalf("seed browser fixture: %v", err)
	}
	runCommuteBrowserSpec(t, f, nil, "smart-commute.smoke.spec.ts")
}

func TestPrivateCommuteTrafficBrowserJourney(t *testing.T) {
	requireCommuteBrowser(t)
	live := &trafficLiveFixture{gear: "P"}
	var outbound atomic.Int64
	source := trafficSourceFixture(func(ctx context.Context, query domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error) {
		if err := authorize(ctx); err != nil {
			return domain.TrafficComparison{}, err
		}
		if len(query.Trace) < 3 || len(query.Trace) >= 21 || query.DepartureAt.Sub(live.now) != 15*time.Minute {
			return domain.TrafficComparison{}, errors.New("unreviewed trace or departure")
		}
		outbound.Add(1)
		return domain.TrafficComparison{
			Usual:       domain.TrafficEstimate{DurationS: 43 * 60, FlowUpdatedAt: live.now.Add(-time.Minute)},
			Alternative: domain.TrafficEstimate{DurationS: 29 * 60, FlowUpdatedAt: live.now.Add(-time.Minute)},
		}, nil
	})
	f := newFixture(t, smartcommutesvc.WithTrafficLiveReader(live),
		smartcommutesvc.WithTrafficEvaluator(source, func(context.Context, string, time.Time) (bool, error) { return false, nil }, nil))
	live.now = f.now
	var drive struct {
		ID      int64     `json:"id"`
		Start   time.Time `json:"start_ts"`
		End     time.Time `json:"end_ts"`
		Vehicle int64     `json:"vehicle_id"`
	}
	if err := f.db.Pool.QueryRow(context.Background(), `
		SELECT id, started_at, ended_at, vehicle_id FROM drives
		WHERE vehicle_id = 42 ORDER BY started_at DESC LIMIT 1`,
	).Scan(&drive.ID, &drive.Start, &drive.End, &drive.Vehicle); err != nil {
		t.Fatal(err)
	}
	seedObservedTrafficTrace(t, f, drive.Start)
	fixture := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/__fixture/traffic" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"drive": drive, "now": f.now, "outbound": outbound.Load()})
		case r.URL.Path == "/__fixture/traffic" && r.Method == http.MethodPost:
			if _, err := f.commute.ProcessTrafficChecks(r.Context(), 5); err != nil {
				t.Error(err)
				http.Error(w, "synthetic traffic evaluation failed", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	})
	runCommuteBrowserSpec(t, f, fixture, "smart-commute-traffic.smoke.spec.ts")
}

func runCommuteBrowserSpec(t *testing.T, f *fixture, synthetic http.Handler, name string) {
	t.Helper()
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
	sharedRouter := f.sharedRouter()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if synthetic != nil && strings.HasPrefix(r.URL.Path, "/__fixture/") {
			synthetic.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/") {
			if r.Header.Get("X-Test-Open") == "1" {
				sharedRouter.ServeHTTP(w, r)
			} else {
				f.router.ServeHTTP(w, r)
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

	runCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "node",
		filepath.Join("node_modules", "@playwright", "test", "cli.js"), "test",
		filepath.Join("e2e", name),
		"--project=chromium-smoke", "--workers=1", "--retries=0", "--reporter=line",
		"--output="+filepath.Join(os.TempDir(), "teslasync-"+name+"-results"),
	)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(),
		"E2E_BASE_URL="+server.URL,
		"E2E_SENSITIVE=1",
		"SMART_COMMUTE_REAL_BACKEND=1",
		"CI=1",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser journey failed: %v\n%s", err, output)
	}
	t.Logf("browser journey:\n%s", output)
}
