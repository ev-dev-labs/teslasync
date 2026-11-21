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

func TestParkedUnlockBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_UNLOCK_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_UNLOCK_BROWSER=1 to run the real-handler browser journey")
	}
	j := newParkedUnlockJourney(t)
	webRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	distRoot := os.Getenv("TESLASYNC_SMART_UNLOCK_BROWSER_DIST")
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
		case r.URL.Path == "/__fixture/parked-unlock" && r.Method == http.MethodPost:
			fixtureMu.Lock()
			defer fixtureMu.Unlock()
			switch r.URL.Query().Get("phase") {
			case "latest":
				count, payload := j.sender.last()
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(struct {
					Count   int             `json:"count"`
					Payload json.RawMessage `json:"payload"`
				}{count, payload})
				return
			case "setup":
				j.now = j.start
				j.completedPark(j.start.Add(time.Minute))
			case "grace":
				for i := 1; i <= 5; i++ {
					j.emit(j.start.Add(time.Duration(i)*time.Minute), false, 47.15, -122.25)
				}
			case "due":
				j.emit(j.start.Add(6*time.Minute), false, 47.15, -122.25)
			case "locked":
				j.emit(j.start.Add(7*time.Minute), true, 47.15, -122.25)
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
			case "synthetic-unlock-desktop", "synthetic-unlock-foreign-desktop":
				r.RemoteAddr = "192.0.2.61:12345"
			case "synthetic-unlock-mobile", "synthetic-unlock-foreign-mobile":
				r.RemoteAddr = "192.0.2.62:12345"
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
		privatePlanningBrowserArgs("smart-parked-unlock.smoke.spec.ts", filepath.Join(t.TempDir(), "browser-results"))...)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(), "E2E_BASE_URL="+server.URL, "E2E_SENSITIVE=1", "SMART_UNLOCK_REAL_BACKEND=1", "CI=1")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("real parked unlock browser journey failed: %v\n%s", err, output)
	}
	t.Logf("real parked unlock browser journey:\n%s", output)
}
