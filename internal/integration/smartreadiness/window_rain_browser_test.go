package smartreadiness_test

import (
	"encoding/json"
	"fmt"
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
)

func TestWindowRainBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_RAIN_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_RAIN_BROWSER=1 to run the real-handler browser journey")
	}
	j := newWindowRainJourney(t)
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := os.Getenv("TESLASYNC_SMART_RAIN_BROWSER_DIST")
	if distRoot == "" {
		distRoot = filepath.Join(webRoot, "dist")
	}
	index := filepath.Join(distRoot, "index.html")
	if _, err := os.Stat(index); err != nil {
		t.Fatalf("build the frontend before running the browser journey: %v", err)
	}
	static := http.FileServer(http.Dir(distRoot))
	var fixtureMu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/sw.js":
			w.Header().Set("Content-Type", "application/javascript")
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/__fixture/window-rain" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			if r.URL.Query().Get("phase") == "latest" {
				_, payload := j.sender.last()
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(struct {
					Forecasts int32           `json:"forecasts"`
					Payload   json.RawMessage `json:"payload"`
				}{j.calls.Load(), payload})
				return
			}
			switch r.URL.Query().Get("phase") {
			case "setup":
				j.advance(j.start)
				j.live.values["FdWindow"].Raw = "Closed"
			case "closed":
			case "due":
				j.advance(j.start.Add(time.Minute))
				j.live.values["FdWindow"].Raw = "PartiallyOpen"
			case "expiry":
				j.advance(j.start.Add(time.Hour))
			default:
				http.NotFound(w, r)
				return
			}
			if err := j.tick(r.Context()); err != nil {
				http.Error(w, fmt.Sprintf("fixture tick: %v", err), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(r.URL.Path, "/api/v1/"):
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			cookie, cookieErr := r.Cookie("personal_test_subject")
			if cookieErr != nil {
				http.Error(w, "missing synthetic identity", http.StatusUnauthorized)
				return
			}
			switch cookie.Value {
			case "synthetic-rain-desktop", "synthetic-rain-foreign-desktop":
				r.RemoteAddr = "192.0.2.41:12345"
			case "synthetic-rain-mobile", "synthetic-rain-foreign-mobile":
				r.RemoteAddr = "192.0.2.42:12345"
			default:
				http.Error(w, "unknown synthetic identity", http.StatusUnauthorized)
				return
			}
			r.Header.Set("X-Test-Subject", cookie.Value)
			j.router.ServeHTTP(w, r)
		default:
			relative := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
			if info, err := os.Stat(filepath.Join(distRoot, filepath.FromSlash(relative))); err == nil && !info.IsDir() {
				static.ServeHTTP(w, r)
				return
			}
			http.ServeFile(w, r, index)
		}
	}))
	defer server.Close()

	cmd := exec.CommandContext(t.Context(), "node",
		privatePlanningBrowserArgs("smart-window-rain.smoke.spec.ts", filepath.Join(t.TempDir(), "browser-results"))...)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", "SMART_RAIN_REAL_BACKEND=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real window rain browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real window rain browser journey:\n%s", output)
}
