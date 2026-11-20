package smartcommute_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPrivateCommuteBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_COMMUTE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_COMMUTE_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	f := newFixture(t)
	ctx := context.Background()
	if _, err := f.db.Pool.Exec(ctx, `
		INSERT INTO vehicles(id, display_name) VALUES (7, 'Synthetic vehicle');
		INSERT INTO drives(vehicle_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng)
		SELECT 7, started_at, ended_at, start_lat, start_lng, end_lat, end_lng
		FROM drives WHERE vehicle_id = 42`); err != nil {
		t.Fatalf("seed browser fixture: %v", err)
	}

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

	runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "node",
		filepath.Join("node_modules", "@playwright", "test", "cli.js"), "test",
		filepath.Join("e2e", "smart-commute.smoke.spec.ts"),
		"--project=chromium-smoke", "--workers=1", "--retries=0", "--reporter=line",
		"--output="+filepath.Join(os.TempDir(), "teslasync-smart-commute-browser-results"),
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
