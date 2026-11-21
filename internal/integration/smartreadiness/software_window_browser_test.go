package smartreadiness_test

import (
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

func TestSoftwareWindowBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_SOFTWARE_WINDOW_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_SOFTWARE_WINDOW_BROWSER=1 to run the real-handler browser journey")
	}
	j := newSoftwareWindowJourney(t)
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := os.Getenv("TESLASYNC_SMART_SOFTWARE_WINDOW_BROWSER_DIST")
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
		case r.URL.Path == "/__fixture/software-window" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			switch r.URL.Query().Get("phase") {
			case "setup":
				j.now = j.start.Add(75 * time.Second)
				j.exec("DELETE FROM drives; DELETE FROM signal_log")
				j.live.mu.Lock()
				clear(j.live.values)
				j.live.mu.Unlock()
			case "idle":
				j.completedPark(j.start)
				j.idleFrom(j.start)
			case "resume":
				j.idleFrom(j.start.Add(130 * time.Second))
			case "scheduled":
				j.emit("SoftwareUpdateScheduledStartTime", `"2026-11-20T19:00:00Z"`, j.now.Add(-time.Second))
			default:
				http.NotFound(w, r)
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
			case "synthetic-software-desktop", "synthetic-software-foreign-desktop":
				r.RemoteAddr = "192.0.2.71:12345"
			case "synthetic-software-mobile", "synthetic-software-foreign-mobile":
				r.RemoteAddr = "192.0.2.72:12345"
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
		privatePlanningBrowserArgs("smart-software-window.smoke.spec.ts", filepath.Join(t.TempDir(), "browser-results"))...)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", "SMART_SOFTWARE_WINDOW_REAL_BACKEND=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real software update window browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real software update window browser journey:\n%s", output)
}
